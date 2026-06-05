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
import { TransactionStatus, TransactionType } from 'src/common/enum/wallet';
import { Company } from 'src/entities/company.entity';
import { Currency, SquareClient, SquareEnvironment } from 'square';
import { randomUUID } from 'crypto';

@Injectable()
export class PaymentService {
  private square: SquareClient;

  constructor(
    private configService: ConfigService,
    private readonly requestContextService: RequestContextService,
    private readonly em: EntityManager,
  ) {
    const accessToken = getEnv(ENV.SQUARE_ACCESS_TOKEN);
     const envString = (getEnv(ENV.SQUARE_ENVIRONMENT) || 'sandbox').toLowerCase();
    
    this.square = new SquareClient({
      token: accessToken,
      environment: envString === 'production' 
        ? SquareEnvironment.Production 
        : SquareEnvironment.Sandbox,
    });
  }

  async convertUsdToCadCents(usdAmount: number): Promise<number> {
    // usdAmount = 56.00 (full dollars)
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = await response.json();
    const rate = data.rates.CAD;
    
    const cadAmount = usdAmount * rate;     // 56 * 1.35 = 75.60 CAD
    return Math.round(cadAmount * 100);     // 7560 cents for Square
  }

  // ── Square SDK Config (replaces Stripe Setup Intent) ────────────
  async createSetupIntent(_customerId: string): Promise<any> {
    // Frontend uses these to initialize Square Web Payments SDK
    return {
      applicationId: getEnv(ENV.SQUARE_APPLICATION_ID),
      locationId: getEnv(ENV.SQUARE_LOCATION_ID),
      clientSecret: null,
      setupIntentId: null,
    };
  }

  // ── Create Square Customer ──────────────────────────────────────
  async createCustomer(session: SessionData): Promise<{ customerId: string }> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    if (ctx.user.squareCustomerId) {
      return { customerId: ctx.user.squareCustomerId };
    }

    const { customer } = await this.square.customers.create({
      idempotencyKey: randomUUID(),
      givenName: ctx.user.firstName,
      familyName: ctx.user.lastName,
      emailAddress: ctx.user.email,
    });

    ctx.user.squareCustomerId = customer!.id;
    this.em.persist(ctx.user);
    await this.em.flush();

    await this.getOrCreateWallet(ctx.company);

    return { customerId: customer!.id as string};
  }

  // ── List cards from Square (stored on Square customer) ──────────
  async listCards(session: SessionData): Promise<any[]> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    if (!ctx.user.squareCustomerId) {
      throw new BadRequestException('No Square customer found for user');
    }

    const response = await this.square.cards.list({
      customerId: ctx.user.squareCustomerId,
    });

    return response.data || [];
  }

  // ── Save card: store in Square + persist in DB ─────────────────
  async saveCard(session: SessionData, nonce: string): Promise<any> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    if (!ctx.user.squareCustomerId) {
      throw new BadRequestException('User has no Square customer. Create one first.');
    }

    // Store card in Square against the customer
    const { card } = await this.square.cards.create({
      idempotencyKey: randomUUID(),
      sourceId: nonce,
      card: {
        customerId: ctx.user.squareCustomerId,
      },
    });

    const exists = await this.em.findOne(SavedCard, {
      squareCardId: card!.id,
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

    const savedCard = this.em.create(SavedCard, {
      user: ctx.user,
      squareCardId: card!.id,
      squareCustomerId: ctx.user.squareCustomerId,
      brand: card!.cardBrand,
      last4: card!.last4,
      company: this.em.getReference(Company, session.companyId as number),
      expMonth: Number(card!.expMonth),   // Convert BigInt → Number
      expYear: Number(card!.expYear),      // Convert BigInt → Number
    } as any);

    await this.em.persist(savedCard).flush();

    return {
      id: savedCard.id,
      brand: savedCard.brand,
      last4: savedCard.last4,
      expMonth: savedCard.expMonth,
      expYear: savedCard.expYear,
    };
  }

  // ── List saved cards from local DB ──────────────────────────────
  async listSavedCards(session: SessionData): Promise<any[]> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });
    const cards = await this.em.find(SavedCard, { company: ctx.company });
    return cards.map((card) => ({
      id: card.id,
      brand: card.brand,
      last4: card.last4,
      expMonth: Number(card.expMonth),
      expYear: Number(card.expYear),
    }));
  }

  // ── Charge saved card + credit wallet ───────────────────────────
  async chargeSavedCard(
    session: SessionData,
    payload: {
      cardId: string;
      amount: number;      // e.g., 5000.00
      currency: string;    // "USD" or "CAD"
    },
  ): Promise<any> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });

    // ── 1. Determine Square charge vs. wallet credit ───────────────────────
    const depositCurrency = payload.currency.toUpperCase();
    let squareAmountCents: number;
    let squareCurrency = 'CAD';
    let walletCreditAmount: number;

    if (depositCurrency === 'USD') {
      // Square account is CAD-only: convert for the charge
      squareAmountCents = await this.convertUsdToCadCents(payload.amount);
      walletCreditAmount = payload.amount; // Wallet keeps the original USD
    } else if (depositCurrency === 'CAD') {
      squareAmountCents = Math.round(payload.amount * 100);
      walletCreditAmount = payload.amount; // Wallet keeps the original CAD
    } else {
      throw new BadRequestException('Unsupported currency. Only USD and CAD are supported.');
    }

    // ── 2. Pre-flight validations ────────────────────────────────────────
    if (!ctx.user.squareCustomerId) {
      throw new BadRequestException('No Square customer found for user');
    }

    const card = ctx?.company?.savedCards?.find((c) => c.id === payload.cardId);
    if (!card) {
      throw new BadRequestException('Invalid cardId');
    }

    if (!payload.amount || payload.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    if (payload.amount < 0.50) {
      throw new BadRequestException('Minimum amount is 50 cents');
    }

    const savedCard = await this.em.findOne(SavedCard, {
      squareCardId: card.squareCardId,
      company: ctx.company,
    });
    if (!savedCard) {
      throw new BadRequestException('Payment method not found or not owned by user');
    }

    // ── 3. Create PENDING transaction ──────────────────────────────────────
    const pendingTx = await this.em.transactional(async (em: any) => {
      const wallet = await this.getOrCreateWallet(ctx.company, em);
      const transaction = em.create(WalletTransaction, {
        user: ctx.user,
        wallet: wallet,
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.PENDING,
        amount: walletCreditAmount,
        currency: depositCurrency,
        processedAmount: squareAmountCents / 100,
        processedCurrency: squareCurrency,
        balanceBefore: wallet.balance,
        description: `Wallet deposit via ${savedCard.brand} •••• ${savedCard.last4}`,
      });
      await em.persist(transaction).flush();
      return transaction;
    });

    // ── 4. Call Square (external, non-transactional) ─────────────────────
    let payment: any;
    try {
      const response = await this.square.payments.create({
        idempotencyKey: randomUUID(),
        sourceId: savedCard.squareCardId as string,
        amountMoney: {
          amount: BigInt(squareAmountCents),
          currency: squareCurrency as Currency,
        },
        customerId: ctx.user.squareCustomerId,
        referenceId: String(pendingTx.id).slice(0, 40),
        note: `Wallet deposit for company ${ctx?.company?.id}`,
        autocomplete: true,
      });
      payment = response.payment;
    } catch (error: any) {
      // ── 5a. Square failed → mark FAILED ────────────────────────────────
      await this.em.transactional(async (em) => {
        const tx = await em.findOne(WalletTransaction, pendingTx.id);
        if (tx) {
          tx.status = TransactionStatus.FAILED;
          tx.failureReason = error.message || error.result?.errors?.[0]?.detail || 'Payment failed';
        }
      });
      throw new BadRequestException(
        `Payment failed: ${error.message || error.result?.errors?.[0]?.detail}`
      );
    }

    // ── 5b. Square succeeded → finalize ──────────────────────────────────
    if (payment?.status === 'COMPLETED' || payment?.status === 'APPROVED') {
      const finalized = await this.em.transactional(async (em) => {
        const tx = await em.findOne(
          WalletTransaction,
          pendingTx.id,
          { populate: ['wallet'] }
        );
        if (!tx) {
          throw new InternalServerErrorException('Transaction lost during processing');
        }

        const wallet = tx.wallet;
        tx.status = TransactionStatus.COMPLETED;
        tx.squarePaymentId = payment.id;

        // Credit the wallet with the ORIGINAL currency amount, NOT the converted CAD
        wallet.balance! += walletCreditAmount;
        wallet.totalDeposited! += walletCreditAmount;
        tx.balanceAfter = wallet.balance;

        await em.persist([tx, wallet]).flush();
        return { tx, wallet };
      });

      return {
        success: true,
        paymentId: payment.id,
        amountCharged: {
          value: squareAmountCents / 100,
          currency: squareCurrency,
        },
        amountDeposited: {
          value: walletCreditAmount,
          currency: depositCurrency,
        },
        walletBalance: finalized.wallet.balance,
        transactionId: finalized.tx.id,
      };
    }

    // ── 5c. Square PENDING → update record ───────────────────────────────
    if (payment?.status === 'PENDING') {
      await this.em.transactional(async (em) => {
        const tx = await em.findOne(WalletTransaction, pendingTx.id);
        if (tx) {
          tx.squarePaymentId = payment.id;
        }
      });

      return {
        success: false,
        requiresAction: true,
        paymentId: payment.id,
        transactionId: pendingTx.id,
      };
    }

    // ── 5d. Any other status → mark FAILED ───────────────────────────────
    await this.em.transactional(async (em) => {
      const tx = await em.findOne(WalletTransaction, pendingTx.id);
      if (tx) {
        tx.status = TransactionStatus.FAILED;
        tx.squarePaymentId = payment?.id;
        tx.failureReason = `Payment status: ${payment?.status}`;
      }
    });

    return {
      success: false,
      status: payment?.status,
      message: 'Payment failed',
      transactionId: pendingTx.id,
    };
  }

  async getOrCreateWallet(company: any, em?: EntityManager){
    const manager = em || this.em;
    let wallet = await manager.findOne(Wallet, { company });

    if (!wallet) {
      wallet = manager.create(Wallet, {
        company,
        balance: 0,
        totalDeposited: 0,
      } as any);
      await manager.persist(wallet).flush();
    }

    return wallet;
  }

  async deductFromWallet(
    session: SessionData,
    payload: {
      amount: number;
      description: string;
    },
  ): Promise<WalletTransaction> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });
    const wallet = await this.getOrCreateWallet(ctx.company);
    const currentBalance = Number(wallet.balance || 0);

    if (currentBalance < payload.amount) {
      throw new BadRequestException(
        `Insufficient wallet balance. Required: ${payload.amount.toFixed(2)}, Available: ${currentBalance.toFixed(2)}`,
      );
    }

    const transaction = this.em.create(WalletTransaction, {
      user: ctx.user,
      wallet: wallet,
      type: TransactionType.PAYMENT,
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

  async getWallet(session: SessionData): Promise<any> {
    const ctx = await this.requestContextService.resolve({ session, em: this.em });
    const wallet = await this.getOrCreateWallet(ctx.company);
    return {
      balance: wallet.balance,
      totalDeposited: wallet.totalDeposited,
      updatedAt: wallet.updatedAt,
    };
  }

  // ── Retrieve Payment status ─────────────────────────────────────
  async getPayment(paymentId: string): Promise<any> {
    const { payment } = await this.square.payments.get({ paymentId });
    return payment;
  }

  // ── Remove stored card from Square ──────────────────────────────
  async detachCard(cardId: string): Promise<any> {
    await this.square.cards.disable({ cardId });
    return { message: 'Card removed successfully' };
  }

  // ── Handle async payment success (webhook / frontend callback) ──
  async handlePaymentSuccess(paymentId: string): Promise<any> {
    const { payment } = await this.square.payments.get({ paymentId });

    if (payment?.status !== 'COMPLETED' && payment?.status !== 'APPROVED') {
      throw new BadRequestException('Payment not completed');
    }

    const transaction = await this.em.findOne(WalletTransaction, {
      squarePaymentId: paymentId,
      status: TransactionStatus.PENDING,
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const wallet = transaction.wallet;
    wallet.balance! += transaction.amount;
    wallet.totalDeposited! += transaction.amount;
    transaction.status = TransactionStatus.COMPLETED;
    transaction.balanceAfter = wallet.balance;

    await this.em.persist([transaction, wallet]).flush();

    return {
      success: true,
      walletBalance: wallet.balance,
      transactionId: transaction.id,
    };
  }
}