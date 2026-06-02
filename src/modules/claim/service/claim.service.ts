// claims/services/consumer-claims.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { Shipment } from 'src/entities/shipment.entity';
import { Claim } from 'src/entities/claim.entity';
import { ClaimStatus, ClaimType } from 'src/common/enum/claims';
import { User } from 'src/entities/user.entity';
import { CreateClaimDto } from '../dto/create-claim.dto';
import { SessionData } from 'express-session';
import { ROLES } from 'src/common/constants/roles';
import { Company } from 'src/entities/company.entity';
import { buildQuery } from 'src/utils/api-query';
import { RequestContextService } from 'src/utils/request-context-service';
import { ClaimDocument } from 'src/entities/claim-document.entity';
import { allowedTransitions } from 'src/common/constants/claim';
import { UpdateClaimStatusDto } from '../dto/update-claim-status.dto';
import { join } from 'path';
import fs from 'fs/promises';


@Injectable()
export class ClaimService {
  constructor(private readonly em: EntityManager, private readonly requestContextService: RequestContextService) {}

  private serializeClaim(claim: Claim) {
  return {
    // --- Claim scalars ---
    id: claim.id,
    claimId: claim.claimId,
    status: claim.status,
    claimName: claim.claimName,
    claimType: claim.claimType,
    contactFullName: claim.contactFullName,
    contactPhoneNumber: claim.contactPhoneNumber,
    contactEmailAddress: claim.contactEmailAddress,
    additionalInsurancePurchased: claim.additionalInsurancePurchased,
    currency: claim.currency,
    goodsDescription: claim.goodsDescription,
    totalValueOfGoods: claim.totalValueOfGoods,
    totalValueOfMissingGoods: claim.totalValueOfMissingGoods,
    damageDescription: claim.damageDescription,
    valueOfDamageClaimed: claim.valueOfDamageClaimed,
    additionalNotes: claim.additionalNotes,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
    statusUpdatedAt: claim.statusUpdatedAt,
    statusUpdatedBy: `${claim.statusUpdatedBy?.firstName} ${claim.statusUpdatedBy?.lastName}`,

    // --- Shipment (with hidden quote override) ---
    shipment: claim.shipment
      ? {
          id: claim.shipment.id,
          shipDate: claim.shipment.shipDate,
          serviceType: claim.shipment.serviceType,
          carrier: claim.shipment.carrier,
          trackingNumber: claim.shipment.trackingNumber,
          bolNumber: claim.shipment.bolNumber,
          totalNetCharge: claim.shipment.totalNetCharge,
          totalBaseCharge: claim.shipment.totalBaseCharge,
          surcharges: claim.shipment.surcharges,
          currency: claim.shipment.currency,
          bookedBy: claim.shipment.bookedBy
            ? {
                id: claim.shipment.bookedBy.id,
                firstName: claim.shipment.bookedBy.firstName,
                lastName: claim.shipment.bookedBy.lastName,
              }
            : null,
          quote: claim.shipment.quote
            ? {
                id: claim.shipment.quote.id,
                insurance: claim.shipment.quote.insurance
                  ? {
                      id: claim.shipment.quote.insurance.id,
                      amount: claim.shipment.quote.insurance.amount,
                      currency: claim.shipment.quote.insurance.currency,
                    }
                  : null,
              }
            : null,
        }
      : null,

    // --- Documents ---
    documents: claim.documents.getItems().map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      uploadedBy: doc.uploadedBy
        ? {
            firstName: doc.uploadedBy.firstName,
            lastName: doc.uploadedBy.lastName,
          }
        : null,
    })),

    // --- SubmittedBy ---
    submittedBy: claim.submittedBy
      ? {
          firstName: claim.submittedBy.firstName,
          lastName: claim.submittedBy.lastName,
        }
      : null,
  };
}
 async create(dto: CreateClaimDto, session: SessionData) {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    const shipment = await this.em.findOne(Shipment, { id: dto.shipmentId }, { populate: ['company'] });
    if (!shipment) {
      throw new BadRequestException('Invalid shipment id or you do not have required permissions');
    }

    if (shipment?.company?.id !== ctx?.company?.id) {
      throw new ForbiddenException('You do not own this shipment.');
    }

    if (shipment.currentStatus === 'READY_FOR_SHIP') {
      throw new BadRequestException('Cannot file a claim for a shipment with "ready for ship" status.');
    }

    const existing = await this.em.findOne(Claim, { shipment: shipment.id });
    if (existing) {
      throw new BadRequestException('A claim already exists for this shipment.');
    }

    // --- Build claim ---
    const claim = new Claim();
    claim.shipment = shipment;
    claim.status = dto.status;
    claim.submittedBy = ctx.user;
    claim.company = ctx.company;

    claim.contactFullName = dto.contactFullName;
    claim.contactPhoneNumber = dto.contactPhoneNumber;
    claim.contactEmailAddress = dto.contactEmailAddress;
    claim.claimName = dto.claimName;
    claim.claimType = dto.claimType;

    claim.additionalInsurancePurchased = dto.additionalInsurancePurchased;
    claim.currency = dto.currency;

    if (dto.claimType === ClaimType.MISSING) {
      claim.goodsDescription = dto.goodsDescription;
      claim.totalValueOfGoods = dto.totalValueOfGoods;
      claim.totalValueOfMissingGoods = dto.totalValueOfMissingGoods;
      if (dto.additionalNotes) claim.additionalNotes = dto.additionalNotes;
    }

    if (dto.claimType === ClaimType.DAMAGED) {
      claim.damageDescription = dto.damageDescription;
      claim.valueOfDamageClaimed = dto.valueOfDamageClaimed;
    }

    // --- Attach documents (URIs from DTO) ---
    if (dto.documents?.length) {
      const docs = dto.documents.map((docDto) => {
        const doc = new ClaimDocument();
        doc.fileUrl = docDto.fileUrl;
        doc.fileName = docDto.fileName;
        doc.mimeType = docDto.mimeType;
        doc.documentType = docDto.documentType;
        doc.claim = claim;
        doc.uploadedBy = ctx.user;
        return doc;
      });

      claim.documents.add(docs);
    }

    await this.em.persist(claim).flush();

    return {
      message: "Successfully created claim"
    };
  }

  async findAll(
  session: SessionData,
  params: Record<string, any>
  ) {
    // 1) Validate session details
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    // 2) Allowed fields for search & orderBy (includes new sortable fields)
    const allowedFields: Record<string, string> = {
      claimId: 'claimId',
      status: 'status',
      createdAt: 'createdAt',          // adjust if your date field is named differently
      carrier: 'shipment.carrier',     // sorting by relation works if you populate it
      shipmentType: 'shipment.shipmentType',
    };

    // 3) Build pagination params
    const { search, page, limit, orderBy } = buildQuery(params, allowedFields);

    // 4) Base filter scoped to company
    const filter: any = { company: ctx.company };

    // 5) --- Date range filter ---
    if (params.fromDate || params.toDate) {
      filter.createdAt = {};
      if (params.fromDate) {
        filter.createdAt.$gte = new Date(params.fromDate);
      }
      if (params.toDate) {
        // Inclusive: set to end of the provided day
        const endOfDay = new Date(params.toDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endOfDay;
      }
    }

    // 6) --- Search by claimId / name (text search) ---
    if (search) {
      filter.$or = [
        { claimId: { $ilike: `%${search}%` } },
        // Add additional name fields here if your Claim has a claimant name/title:
        // { claimantName: { $ilike: `%${search}%` } },
      ];
    }

    // 7) --- Filter by claim status ---
    if (params.status) {
      filter.status = params.status;
    }

    // 8) --- Filter by carrier & packaging type via shipment relation ---
    const shipmentFilter: any = {};
    
    if (params.carrier) {
      shipmentFilter.carrier = params.carrier;
    }
    
    // Accept either `packagingType` or `shipmentType` query param
    const typeFilter = params.packagingType || params.shipmentType;
    if (typeFilter) {
      shipmentFilter.shipmentType = typeFilter;
    }

    if (Object.keys(shipmentFilter).length > 0) {
      filter.shipment = shipmentFilter;
    }

    // 9) Count & paginate
    const total = await this.em.count(Claim, filter);
    const totalPages = Math.ceil(total / limit) || 1;
    const clampedPage = Math.min(page, totalPages);
    const offset = (clampedPage - 1) * limit;

    // 10) Fetch data
    const claims = await this.em.find(
      Claim,
      filter,
      {
        limit,
        offset,
        orderBy: Object.entries(orderBy).map(([field, direction]) => ({
          [field]: direction,
        })),
        populate: [
          'shipment',
          'shipment.quote',
          'shipment.surcharges',
          'shipment.quote.insurance',
          'shipment.bookedBy',
          'documents',
          'documents.uploadedBy',
          'submittedBy',
          'statusUpdatedBy'
        ],
      },
    );

    // Map to plain objects so hidden: true doesn't apply
    const serializedClaims = claims.map((claim) => this.serializeClaim(claim));


    // 11) Return with pagination metadata
    return {
      message: 'Successfully retrieved claims',
      claims: serializedClaims,
      pagination: {
        page: clampedPage,
        limit,
        total,
        totalPages,
      },
    };
  }

  async findOne(id: number, session:SessionData) {
    const claim = await this.em.findOne(
      Claim,
      { id },
      { populate: [ 
          'shipment',
          'shipment.quote',
          'shipment.surcharges',
          'shipment.quote.insurance',
          'shipment.bookedBy',
          'documents',
          'documents.uploadedBy',
          'submittedBy',
          'statusUpdatedBy'
        ] 
      },
    );

    if (!claim) {
      throw new NotFoundException('Claim not found.');
    }

    if (session.role !== ROLES.SUPER_ADMIN && claim.shipment?.company?.id !== session.companyId) {
      throw new ForbiddenException('You do not own this claim.');
    }

    const serializedClaim = [claim].map((claim) => this.serializeClaim(claim));
    
    return {
      message: 'Claim retrieved successfully',
      claim: serializedClaim[0],
    };
  }

  async updateStatus(
    id: number,
    dto: UpdateClaimStatusDto,
    session: SessionData,
  ) {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    if (session.role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenException('Admin access required.');
    }

    const claim = await this.em.findOne(
      Claim,
      { id },
      {
        populate: [
          'shipment',
          'shipment.quote',
          'shipment.surcharges',
          'shipment.quote.insurance',
          'shipment.bookedBy',
          'documents',
          'documents.uploadedBy',
          'submittedBy',
        ],
      },
    );

    if (!claim) {
      throw new NotFoundException('Claim not found.');
    }

    const current = claim.status as ClaimStatus;
    const next = dto.status;

    if (!allowedTransitions[current]?.includes(next)) {
      throw new BadRequestException(
        `Cannot transition claim from "${current}" to "${next}".`,
      );
    }

    claim.status = next;

    if (dto.adminNotes && dto.status === ClaimStatus.REJECTED) {
      claim.adminNotes = dto.adminNotes;
    }

    claim.statusUpdatedAt = new Date();
    claim.statusUpdatedBy = ctx.user;

    await this.em.persist(claim).flush();

    return {
      message: `Claim status updated to ${next}`,
      claim: this.serializeClaim(claim),
    };
  }

  async deleteDocument(documentId: number) {
    //1) Fetch document and populate claim for ownership check
    const document = await this.em.findOne(
      ClaimDocument,
      { id: documentId },
      { populate: ['claim', 'claim.submittedBy'] },
    );

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    //2). unlink from disk (do not await)
    const filename = document.fileUrl.split('/').pop();
    if (filename) {
    const filePath = join(process.cwd(), 'uploads', 'claims', filename);
    
    //3) Just await it — single file unlink is ~1-5ms on local disk
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw new BadRequestException('Failed to delete claim document. Try again later')
      }
    }
  }
    // 4. Delete the DB record and flush
    this.em.remove(document);
    await this.em.flush();

    //5) Return back success response
    return {
      message: "Successfully removed document"
    }
  }
}