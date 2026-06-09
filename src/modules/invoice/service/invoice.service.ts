// src/modules/invoice/invoice.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Invoice } from 'src/entities/invoice.entity';
import { Company } from 'src/entities/company.entity';
import { User } from 'src/entities/user.entity';
import type { SessionData } from 'express-session';
import { PaymentService } from 'src/modules/payment/service/payment.service';
import { plainToInstance } from 'class-transformer';
import { buildQuery } from 'src/utils/api-query';
import { GetAllInvoicesQueryParams } from '../dto/get-all-invoices.dto';
import { InvoiceListDto } from '../dto/invoice-list.dto';
import { RequestContextService } from 'src/utils/request-context-service';
import { wrap } from '@mikro-orm/core';
import { startOfDay, endOfDay } from 'src/utils/dates';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly em: EntityManager,
    private readonly paymentService: PaymentService,
    private readonly requestContextService: RequestContextService
  ) {}

  async payInvoice(invoiceId: number, session: SessionData) {
    // 1) Fetch invoice scoped to current user's company
    const invoice = await this.em.findOne(Invoice, {
      id: invoiceId,
      company: this.em.getReference(Company, session.companyId as number),
    }, {
      populate: ['shipment', 'company', 'surcharges']
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found or you do not have access to this resource');
    }

    if (invoice.paid) {
      throw new BadRequestException('Invoice has already been paid');
    }

    // 2) Calculate total from surcharges
    const totalAmount = invoice.surcharges.reduce((sum, s) => sum + Number(s.amount), 0);

    if (totalAmount <= 0) {
      throw new BadRequestException('Invoice has no chargeable amount');
    }

    // 3) Deduct from wallet via PaymentService (creates transaction + updates wallet)
    const transaction = await this.paymentService.deductFromWallet(session, {
      amount: totalAmount,
      description: `Payment for invoice ${invoice.invoiceNumber}`,
    });

    // 4) Mark invoice as paid
    invoice.paid = true;
    invoice.paidBy = this.em.getReference(User, session.userId as number);

    await this.em.persist(invoice).flush();

    return {
      message: 'Invoice paid successfully',
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        paid: true,
        paidAt: invoice.updatedAt,
      },
      payment: {
        transactionId: transaction.id,
        amount: totalAmount,
        currency: invoice.surcharges[0]?.currency || 'USD',
        balanceAfter: transaction.balanceAfter,
      }
    };
  }

  async getAllInvoicesAgainstCurrentUserCompany(session: SessionData, queryParams: GetAllInvoicesQueryParams) {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });
    const { page, limit } = buildQuery(queryParams as any, {});
    const offset = (page - 1) * limit;

    // ── Step 1: Build QueryBuilder for complex filters ──
    const qb = this.em.getRepository(Invoice).createQueryBuilder('i')
      .select(['i.id', 'i.createdAt'])
      .distinct()
      .leftJoin('i.shipment', 's')
      .leftJoin('s.quote', 'q')
      .leftJoin('q.addresses', 'qa')
      .leftJoin('qa.address', 'addr')
      .leftJoin('qa.addressBookEntry', 'abe')
      .leftJoin('abe.address', 'abea')
      .leftJoin('s.bookedBy', 'b')
      .where({ 'i.company': ctx?.company?.id });

    // Date range (normalized to full days)
    if (queryParams.startDate) {
      qb.andWhere({ 'i.createdAt': { $gte: startOfDay(queryParams.startDate) } });
    }
    if (queryParams.endDate) {
      qb.andWhere({ 'i.createdAt': { $lte: endOfDay(queryParams.endDate) } });
    }

    // Status filters
    if (queryParams.paid !== undefined) {
      qb.andWhere({ 'i.paid': queryParams.paid === 'true' });
    }
    if (queryParams.urgent !== undefined) {
      qb.andWhere({ 'i.urgent': queryParams.urgent === 'true' });
    }

    // Booked by email
    if (queryParams.bookedBy) {
      qb.andWhere({ 'b.email': { $like: `%${queryParams.bookedBy}%` } });
    }

    // Packaging / shipment type
    if (queryParams.shipmentType) {
      qb.andWhere({ 'q.shipmentType': queryParams.shipmentType });
    }

    // Search: invoiceNumber OR trackingNumber OR location fields
    if (queryParams.search) {
      const term = `%${queryParams.search}%`;
      qb.andWhere({
        $or: [
          { 'i.invoiceNumber': { $like: term } },
          { 's.trackingNumber': { $like: term } },
          { 'addr.city': { $like: term } },
          { 'addr.state': { $like: term } },
          { 'addr.address1': { $like: term } },
          { 'addr.postalCode': { $like: term } },
          { 'abea.city': { $like: term } },
          { 'abea.state': { $like: term } },
          { 'abea.address1': { $like: term } },
          { 'abea.postalCode': { $like: term } },
        ]
      });
    }

    // ── Step 2: Get total count ──
    const total = await qb.getCount();

    // ── Step 3: Get paginated IDs ──
    qb.limit(limit).offset(offset).orderBy({ 'i.createdAt': 'DESC' });
    const idResults = await qb.getResultList();
    const invoiceIds = idResults.map((r) => r.id);

    if (invoiceIds.length === 0) {
      return {
        message: 'No invoices found',
        data: [],
        meta: { total: 0, page, limit, totalPages: 0 },
      };
    }

    // ── Step 4: Fetch full entities with population ──
    const invoices = await this.em.find(
      Invoice,
      { id: { $in: invoiceIds } },
      {
        populate: [
          'shipment',
          'shipment.quote',
          'shipment.quote.addresses',
          'shipment.quote.addresses.address',
          'shipment.quote.addresses.addressBookEntry',
          'shipment.quote.addresses.addressBookEntry.address',
          'shipment.quote.lineItems',
          'shipment.quote.lineItems.units',
          'shipment.bookedBy',
          'surcharges',
          'company',
          'paidBy',
        ],
        orderBy: { createdAt: 'DESC' },
      },
    );

    // ── Step 5: Transform ──
    const transformed = invoices.map((inv) => {
      // Serialize invoice to plain object (hidden fields stripped)
      const plain: any = wrap(inv).toObject();

      // Bypass hidden: true — manually patch the quote back in
      if (inv.shipment?.quote) {
        plain.shipment ??= {};
        plain.shipment.quote = wrap(inv.shipment.quote).toObject();
      }

      // class-transformer filters through your DTO @Expose rules
      return plainToInstance(InvoiceListDto, plain, {
        excludeExtraneousValues: true,
      });
    });

    return {
      message: 'Invoices retrieved successfully',
      data: transformed,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSingleInvoiceAgainstCurrentUserCompany(invoiceId: number, session: SessionData) {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    const invoice = await this.em.findOne(
      Invoice,
      {
        id: invoiceId,
        company: ctx.company,
      },
      {
        populate: [
          'company',
          'paidBy',
          'shipment',
          'shipment.bookedBy',
          'shipment.quote',
          'shipment.quote.addresses',
          'shipment.quote.addresses.addressBookEntry',
          'shipment.quote.addresses.addressBookEntry.address',
          'shipment.quote.addresses.address',
          'shipment.quote.lineItems',
          'shipment.quote.lineItems.units',
          'surcharges',
        ],
      }
    );

    if (!invoice) {
      throw new NotFoundException('Invoice not found or you do not have access to this resource');
    }

    return {
      message: 'Invoice retrieved successfully',
      invoice,
    };
  }
}