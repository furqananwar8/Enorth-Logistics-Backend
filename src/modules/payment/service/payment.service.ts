import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionData } from 'express-session';
import { ENV } from 'src/common/constants/env';
import { getEnv } from 'src/utils/getEnv';
import { RequestContextService } from 'src/utils/request-context-service';
import { SavedCard } from 'src/entities/saved-card.entity';
import { Wallet } from 'src/entities/wallet.entity';
import { WalletTransaction } from 'src/entities/wallet-transaction.entity';
import Stripe from 'stripe';
import { TransactionStatus, TransactionType } from 'src/common/enum/wallet';
import { Company } from 'src/entities/company.entity';

@Injectable()
export class PaymentService {
  private stripe: any;

  constructor(
    private configService: ConfigService,
    private readonly requestContextService: RequestContextService,
    private readonly em: EntityManager,
  ) {
    const secretKey = getEnv(ENV.STRIPE_SECRET_KEY);
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2026-04-22.dahlia',
    });
  }

  // ── Setup Intent (for saving cards) ─────────────────────────────
  async createSetupIntent(customerId: string): Promise<any> {
    return this.stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });
  }

  // ── Create Stripe Customer (one-time per user) ─────────────────
  async createCustomer(session: SessionData): Promise<{ customerId: string }> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    if (ctx.user.stripeCustomerId) {
      return { customerId: ctx.user.stripeCustomerId };
    }

    const customer = await this.stripe.customers.create({
      email: ctx.user.email,
      name: `${ctx.user.firstName} ${ctx.user.lastName}`.trim(),
    });

    ctx.user.stripeCustomerId = customer.id;
    this.em.persist(ctx.user);
    await this.em.flush();

    // Auto-create wallet for new customer
    await this.getOrCreateWallet(ctx.user);

    return { customerId: customer.id };
  }

  // ── List saved cards from Stripe ────────────────────────────────
  async listCards(session: SessionData): Promise<any[]> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    if (!ctx.user.stripeCustomerId) {
      throw new BadRequestException('No Stripe customer found for user');
    }

    const methods = await this.stripe.paymentMethods.list({
      customer: ctx.user.stripeCustomerId,
      type: 'card',
    });

    return methods.data;
  }

  // ── Save card to DB after Stripe confirmCardSetup ─────────────────
  async saveCard(session: SessionData, paymentMethodId: string): Promise<any> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    if (!ctx.user.stripeCustomerId) {
      throw new BadRequestException('User has no Stripe customer. Create one first.');
    }

    const method = await this.stripe.paymentMethods.retrieve(paymentMethodId);

    if (method.customer !== ctx.user.stripeCustomerId) {
      throw new BadRequestException('Payment method does not belong to user');
    }

    const exists = await this.em.findOne(SavedCard, {
      stripePaymentMethodId: paymentMethodId,
      company: ctx.company,
    });

    if (exists) {
      return {
        id: exists.id,
        brand: exists.brand,
        last4: exists.last4,
        expMonth: exists.expMonth,
        expYear: exists.expYear,
        message: 'Card already saved',
      };
    }

    const card = this.em.create(SavedCard, {
      user: ctx.user,
      stripePaymentMethodId: paymentMethodId,
      stripeCustomerId: ctx.user.stripeCustomerId,
      brand: method.card!.brand,
      last4: method.card!.last4,
      company: this.em.getReference(Company, session.companyId as number),
      expMonth: method.card!.exp_month,
      expYear: method.card!.exp_year,
    } as any);

    await this.em.persist(card).flush();

    return {
      id: card.id,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
    };
  }

  // ── List saved cards from DB ────────────────────────────────────
  async listSavedCards(session: SessionData): Promise<any[]> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    const cards = await this.em.find(SavedCard, { company: ctx.company });

    return cards.map((card) => ({
      id: card.id,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
    }));
  }

  // ── Charge saved card + update wallet ────────────────────────────
  async chargeSavedCard(
    session: SessionData,
    payload: {
      cardId: string;
      amountCents: number;
      currency: string;
    },
  ): Promise<any> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });
    if (!ctx.user.stripeCustomerId) {
      throw new BadRequestException('No Stripe customer found for user');
    }

    const card = ctx.company.savedCards.find((card) => card.id === payload.cardId)

    if(!card){
      throw new BadRequestException('Invalid cardId')
    }

    // Validate amount
    if (!payload.amountCents || payload.amountCents <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    if (payload.amountCents < 50) { // Stripe minimum for most currencies
      throw new BadRequestException('Minimum amount is 50 cents');
    }

    // Get or create wallet
    const wallet = await this.getOrCreateWallet(ctx.company);

    // Verify payment method belongs to user (security check)
    const savedCard = await this.em.findOne(SavedCard, {
      stripePaymentMethodId: card.stripePaymentMethodId,
      company: ctx.company,
    });

    if (!savedCard) {
      throw new BadRequestException('Payment method not found or not owned by user');
    }

    // Create pending transaction record first (for audit trail)
    const transaction = this.em.create(WalletTransaction, {
      user: ctx.user,
      wallet: wallet,
      type: TransactionType.DEPOSIT,
      status: TransactionStatus.PENDING,
      amount: payload.amountCents / 100, // convert cents to dollars
      balanceBefore: wallet.balance,
      description: `Wallet deposit via ${savedCard.brand} •••• ${savedCard.last4}`,
    });

    await this.em.persist(transaction).flush();

    // Attempt Stripe charge
    let paymentIntent: any;
    try {
      paymentIntent = await this.stripe.paymentIntents.create({
        amount: payload.amountCents,
        currency: payload.currency ?? 'usd',
        customer: ctx.user.stripeCustomerId,
        payment_method: card.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          userId: ctx.user.id,
          walletTransactionId: transaction.id,
          type: 'WALLET_DEPOSIT',
        },
      });
    } catch (stripeError: any) {
      // Stripe API error (network, invalid request, etc.)
      transaction.status = TransactionStatus.FAILED;
      transaction.failureReason = stripeError.message;
      await this.em.persist(transaction).flush();
      throw new BadRequestException(`Payment failed: ${stripeError.message}`);
    }

    // Handle different PaymentIntent statuses
    if (paymentIntent.status === 'succeeded') {
      // Update transaction
      transaction.status = TransactionStatus.COMPLETED;
      transaction.stripePaymentIntentId = paymentIntent.id;
      transaction.stripeChargeId = paymentIntent.latest_charge as string;

      // Credit wallet (convert cents to dollars for storage)
      const amountDollars = payload.amountCents / 100;
      wallet.balance! += amountDollars;
      wallet.totalDeposited! += amountDollars;
      transaction.balanceAfter = wallet.balance;

      await this.em.persist([transaction, wallet]).flush();

      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        status: paymentIntent.status,
        walletBalance: wallet.balance,
        transactionId: transaction.id,
      };
    }

    if (paymentIntent.status === 'requires_action') {
      // 3D Secure needed - update transaction to pending (will handle via webhook or frontend)
      transaction.stripePaymentIntentId = paymentIntent.id;
      await this.em.persist(transaction).flush();

      return {
        success: false,
        requiresAction: true,
        clientSecret: paymentIntent.client_secret,
        transactionId: transaction.id,
      };
    }

    // Payment failed (card declined, insufficient funds, etc.)
    transaction.status = TransactionStatus.FAILED;
    transaction.stripePaymentIntentId = paymentIntent.id;
    transaction.failureReason = paymentIntent.last_payment_error?.message || 'Payment failed';
    await this.em.persist(transaction).flush();

    return {
      success: false,
      status: paymentIntent.status,
      message: paymentIntent.last_payment_error?.message || 'Payment failed',
      transactionId: transaction.id,
    };
  }

  // ── Get or Create Wallet ────────────────────────────────────────
  private async getOrCreateWallet(company: any): Promise<Wallet> {
    let wallet = await this.em.findOne(Wallet, { company });

    if (!wallet) {
      wallet = this.em.create(Wallet, {
        company,
        balance: 0,
        totalDeposited: 0,
      } as any);
      await this.em.persist(wallet).flush();
    }

    return wallet;
  }

  async deductFromWallet(
    session: SessionData,
    payload: {
      amount: number;
      description: string;
    }
  ): Promise<WalletTransaction> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    // Use company (not user) for wallet lookup
    const wallet = await this.getOrCreateWallet(ctx.company);

    const currentBalance = Number(wallet.balance || 0);

    if (currentBalance < payload.amount) {
      throw new BadRequestException(
        `Insufficient wallet balance. Required: ${payload.amount.toFixed(2)}, Available: ${currentBalance.toFixed(2)}`
      );
    }

    const transaction = this.em.create(WalletTransaction, {
      user: ctx.user,
      wallet: wallet,
      type: TransactionType.PAYMENT, // add to your enum if missing
      status: TransactionStatus.COMPLETED,
      amount: -payload.amount,
      balanceBefore: currentBalance,
      balanceAfter: parseFloat((currentBalance - payload.amount).toFixed(2)),
      description: payload.description,
    });

    wallet.balance = transaction.balanceAfter;
    wallet.updatedAt = new Date();

    await this.em.persist([transaction, wallet]).flush();

    return transaction;
  }

  async getWalletBalance(session: SessionData): Promise<number> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });
    const wallet = await this.getOrCreateWallet(ctx.company);
    return Number(wallet.balance || 0);
  }

  // ── Retrieve PaymentIntent status ───────────────────────────────
  async getPaymentIntent(paymentIntentId: string): Promise<any> {
    return this.stripe.paymentIntents.retrieve(paymentIntentId);
  }

  // ── Detach (remove) saved card ──────────────────────────────────
  async detachCard(paymentMethodId: string): Promise<any> {
    return this.stripe.paymentMethods.detach(paymentMethodId);
  }

  // ── Handle 3D Secure completion (call this from webhook or frontend callback)
  async handlePaymentIntentSuccess(paymentIntentId: string): Promise<any> {
    const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      throw new BadRequestException('Payment not succeeded');
    }

    // Find pending transaction
    const transaction = await this.em.findOne(WalletTransaction, {
      stripePaymentIntentId: paymentIntentId,
      status: TransactionStatus.PENDING,
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    // Credit wallet
    const wallet = transaction.wallet;
    wallet.balance! += transaction.amount;
    wallet.totalDeposited! += transaction.amount;
    transaction.status = TransactionStatus.COMPLETED;
    transaction.balanceAfter = wallet.balance;
    transaction.stripeChargeId = paymentIntent.latest_charge as string;

    await this.em.persist([transaction, wallet]).flush();

    return {
      success: true,
      walletBalance: wallet.balance,
      transactionId: transaction.id,
    };
  }
}