import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Session,
} from '@nestjs/common';
import { PaymentService } from '../service/payment.service';
import { SessionAuthGuard } from 'src/guards/sessionAuth.guard';
import { EntityManager } from '@mikro-orm/postgresql';
import type { SessionData } from 'express-session';
import { CreateSetupIntentDto, SaveCardDto, ChargeCardDto } from '../dto/payment.dto';

@Controller('payments')
@UseGuards(SessionAuthGuard)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly em: EntityManager,
  ) {}

  @Post('setup-intent')
  async createSetupIntent(@Body() dto: CreateSetupIntentDto) {
    const config = await this.paymentService.createSetupIntent(dto.customerId);
    return {
      applicationId: config.applicationId,
      locationId: config.locationId,
    };
  }

  @Post('customers')
  async createCustomer(@Session() session: SessionData) {
    return this.paymentService.createCustomer(session);
  }

  @Get('my-cards')
  async listCards(@Session() session: SessionData) {
    const cards = await this.paymentService.listCards(session);
    return cards.map((card) => ({
      id: card.id,
      brand: card.cardBrand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
    }));
  }

  @Post('cards')
  async saveCard(@Body() dto: SaveCardDto, @Session() session: SessionData) {
    return this.paymentService.saveCard(session, dto.nonce);
  }

  @Get('saved-cards')
  async listSavedCards(@Session() session: SessionData) {
    return this.paymentService.listSavedCards(session);
  }

  @Get('wallet')
  async getWallet(@Session() session: SessionData) {
    return this.paymentService.getWallet(session);
  }

  @Post('charge')
  async chargeCard(
    @Body() dto: ChargeCardDto,
    @Session() session: SessionData,
  ) {
    return this.paymentService.chargeSavedCard(session, {
      cardId: dto.cardId,
      amount: dto.amount,
      currency: dto.currency,
    });
  }

  @Delete('cards/:cardId')
  async removeCard(@Param('cardId') cardId: string) {
    await this.paymentService.detachCard(cardId);
    return { message: 'Card removed successfully' };
  }

  @Get('payments/:paymentId')
  async getPayment(@Param('paymentId') paymentId: string) {
    const { payment } = await this.paymentService['square'].payments.get({ paymentId });
    return {
      id: payment?.id,
      status: payment?.status,
      amount: Number(payment?.amountMoney?.amount),
      currency: payment?.amountMoney?.currency,
      createdAt: payment?.createdAt,
      locationId: payment?.locationId,
    };
  }
}