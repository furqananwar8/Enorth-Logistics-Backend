import { EntityManager } from "@mikro-orm/postgresql";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { FedExAdapter, ShipmentType } from "../adapter/fedex.adapter";
import { TSTCFExpressAdapter } from "../adapter/tst-cf-express.adapter";
import { TForceAdapter } from "../adapter/tforce.adapter";
import { Observable, catchError, from, map, merge, of } from "rxjs";
import { Carrier, CreateCarrierShipmentDTO } from "../dto/create-carrier-shipment.dto";
import { Shipment } from "src/entities/shipment.entity";
import { Quote } from "src/entities/quote.entity";
import { Currency } from "src/common/enum/currency.enum";
import { XPOAdapter } from "../adapter/xpo.adapter";
import { MockCarrierTrackingService } from "src/modules/mock-carrier-tracking/service/mock-carrier-tracking.service";
import { Surcharge } from "src/entities/surcharge";
import { getEnv } from "src/utils/getEnv";
import { ENV } from "src/common/constants/env";
import { PaymentService } from "src/modules/payment/service/payment.service";
import { SessionData } from "express-session";
import { RequestContextService } from "src/utils/request-context-service";
import { ShipmentStatusDTO } from "../dto/get-shipment-status.dto";
import { ShipmentStatus } from "src/common/enum/shipment-status";
import { MinimaxAdapter } from "../adapter/minimax.adapter";
import { PolarisAdapter } from "../adapter/polaris.adapter";
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ShipmentCarrierService {
    constructor(
        private readonly em: EntityManager,
        private readonly fedexAdapter: FedExAdapter,
        private readonly tstAdapter: TSTCFExpressAdapter,
        private readonly tforceAdapter: TForceAdapter,
        private readonly xpoAdapter: XPOAdapter,
        private readonly minimaxAdapter: MinimaxAdapter,
        private readonly polarisAdapter: PolarisAdapter,
        private readonly mockTracking: MockCarrierTrackingService,
        private readonly paymentService: PaymentService,
        private readonly tstcfAdapter: TSTCFExpressAdapter,
        private readonly requestContextService: RequestContextService,
    ) {}
    
    private readonly uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'shipping-labels');

    private ensureDir(dir: string): void {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    private sanitize(input: string): string {
        return input.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
    }

    async saveBolPdf(carrier: string, trackingNumber: string, base64Data: string): Promise<string> {
        const safeCarrier = this.sanitize(carrier);
        const safeTracking = this.sanitize(trackingNumber);
        const timestamp = Date.now();

        const carrierDir = path.join(this.uploadDir, safeCarrier);
        this.ensureDir(carrierDir);

        const filename = `${safeTracking}_${timestamp}.pdf`;
        const filePath = path.join(carrierDir, filename);

        await fs.promises.writeFile(filePath, Buffer.from(base64Data, 'base64'));

        // Return relative URL — served by static middleware or a controller method
        return `/uploads/shipping-labels/${safeCarrier}/${filename}`;
    }

    async createShipment(dto: CreateCarrierShipmentDTO, session: SessionData) {
        let carrierResponse: any;

        if (![Carrier.FEDEX, Carrier.TST, Carrier.TFORCE, Carrier.XPO, Carrier.MINIMAX].includes(dto.carrier)) {
            throw new BadRequestException("This carrier hasn't been implemented for shipment");
        }

        const ctx = await this.requestContextService.resolve({ session, em: this.em });
        
        const quote = await this.em.findOne(
            Quote,
            { id: dto.quoteId },
            {
            populate: [
                "shipment",
                "addresses",
                "lineItems",
                "lineItems.units",
                "addresses.address",
                "addresses.addressBookEntry",
                "addresses.addressBookEntry.address",
                "addresses.addressBookEntry.phoneNumber",
                "addresses.addressBookEntry.contactName",
                "standardFTLService"
            ] as any,
            }
        ) as Quote;

        if (!quote) {
            throw new NotFoundException("Invalid quote id or you don't have the required permissions")
        }

        if (!quote?.shipment) {
            throw new BadRequestException("Convert quote into shipment to proceed further")
        }

        if(quote?.shipment?.carrier && quote.shipment.carrier !== null){
            throw new BadRequestException("Shipment already processed, create a new one")
        }
        
        if (dto.carrier === Carrier.TFORCE && [ShipmentType.COURIER, ShipmentType.PACKAGE].includes(quote.shipmentType as any)) {
            throw new BadRequestException("TFORCE support only pallet & FTL shipment type for shipment creation")
        }

        const companyBasedRates = ([ShipmentType.PACKAGE, ShipmentType.PALLET].includes(quote.shipmentType as any) ? ctx.company?.ltlRateToBeChargedPerShipment : ctx.company?.ftlRateToBeChargedPerShipment) || 0;

        const selectedRateCharge = Number(dto.selectedRate.totalCharge);

        const finalBalanceToDeduct = Number(companyBasedRates) + Number(selectedRateCharge)
        
        const walletBalance = await this.paymentService.getWalletBalance(session);
        
        if (walletBalance < finalBalanceToDeduct) {
            throw new BadRequestException(`Insufficient wallet balance. Required: ${selectedRateCharge.toFixed(2)}, Available: ${walletBalance.toFixed(2)}`)
        }
        
        let shipment = quote.shipment as Shipment;

        if (dto.carrier === Carrier.FEDEX) {
            carrierResponse = await this.fedexAdapter.createShipment(dto, quote);
        
            const tx = carrierResponse?.output?.transactionShipments?.[0];
            const shipmentRating = tx?.completedShipmentDetail?.shipmentRating?.shipmentRateDetails[0];
            shipment.trackingNumber = tx?.masterTrackingNumber;
            shipment.shipDate = tx?.shipDatestamp || Date.now();
            shipment.serviceName = tx?.serviceName;
            shipment.serviceType = tx?.serviceType;
            shipment.shippingLabels = tx?.shipmentDocuments?.[0]?.url;
            shipment.totalBaseCharge = shipmentRating?.totalBaseCharge || 0;
            shipment.totalSurcharges = shipmentRating?.totalSurcharges || 0;
            shipment.totalFreightDiscounts = shipmentRating?.totalFreightDiscounts || 0;
            shipment.totalNetCharge = shipmentRating?.totalNetChargeWithDutiesAndTaxes || 0;
            shipment.totalTax = shipmentRating?.totalTaxes || 0;
            shipment.carrier = Carrier.FEDEX;

            const surchargeEntities = shipmentRating.surcharges.map((surcharge) =>
                this.em.create(Surcharge, {
                    shipment,
                    carrier: Carrier.FEDEX,
                    name: this.fedexAdapter.getSurchargeName(surcharge.surchargeType),
                    amount: surcharge.amount,
                    currency: shipmentRating.currency,
                    createdAt: new Date()
                })
            );

            shipment.surcharges.add(surchargeEntities);
        }
        
        if (dto.carrier === Carrier.TST) {
            carrierResponse = await this.tstAdapter.createShipment(quote, dto.selectedRate);

            const proNumber = carrierResponse.proNumber;
            const bolPdfBase64 = carrierResponse.bolImage;
            const confirmationNumber = carrierResponse.pickupConfirmation;

    
            shipment.trackingNumber = proNumber;
            shipment.carrierQuoteId = proNumber;
            shipment.pickupConfirmation = confirmationNumber;

            let bolPdfUrl: string | null = null;
            if (bolPdfBase64) {
                bolPdfUrl = await this.saveBolPdf(
                    'TST',
                    proNumber || shipment.trackingNumber || 'unknown',
                    bolPdfBase64,
                );
            }

            shipment.shippingLabels = bolPdfUrl;

            shipment.serviceName = dto.selectedRate?.serviceName || dto.selectedRate?.serviceType || 'STANDARD';
            shipment.serviceType = dto.selectedRate?.serviceType || 'ST';
            shipment.shipDate = quote?.shipment?.shipDate || new Date();
            shipment.currency = dto.selectedRate?.currency || Currency.CAD;


            const quotedTotal = Number(dto.selectedRate?.totalCharge || 0);
            
            shipment.totalBaseCharge = Number(carrierResponse?.charges || quotedTotal);
            shipment.totalSurcharges = Number(carrierResponse?.surcharges || 0);
            shipment.totalFreightDiscounts = Number(carrierResponse?.discounts || 0);
            shipment.totalNetCharge = Number(carrierResponse?.totalnet || carrierResponse?.total || quotedTotal);
            shipment.totalTax = Number(carrierResponse?.taxes || 0);
            shipment.totalCharge = quotedTotal;
            shipment.carrier = Carrier.TST;
        }

        if (dto.carrier === Carrier.TFORCE) {
            carrierResponse = await this.tforceAdapter.createShipment(dto, quote);
            console.dir(carrierResponse, { depth: null })
            const detail = carrierResponse?.raw?.detail ?? {};
            const rateDetail = carrierResponse?.rateDetail?.[0];
    
            // Rate breakdown using TForce rate codes from docs:
            // LND_GROSS = gross base charge before discount
            // DSCNT     = discount amount
            // FUEL_SUR  = fuel surcharge
            // shipmentCharges.total = final total

            const summary = carrierResponse?.raw?.summary;
            const statusCode = summary?.responseStatus?.code;
            const statusMessage = summary?.responseStatus?.message;

            // ── Handle non-success TForce codes ─────────────────────────────────────
            if (statusCode && statusCode !== '200') {
                // BOL may have been created, but rate is missing or requires manual action
                if (detail?.bolId) {
                // BOL exists but is unrateable — do NOT save as a normal shipment
                throw new BadRequestException(
                    `TForce shipment created (BOL ${detail.bolId}, PRO ${detail.pro}) ` +
                    `but requires manual rating: ${statusMessage}. ` +
                    `Please contact TForce Customer Service at 800-333-7400 to resolve.`
                );
                }

                // Complete failure
                throw new BadRequestException(
                `TForce shipment failed: ${statusMessage} (Code ${statusCode})`
                );
            }

            const rates: Array<{ code: string; value: string }> = rateDetail?.rate ?? [];
            const findRate = (code: string) => Number(rates.find((r) => r.code === code)?.value || 0);

            const grossCharge   = findRate('LND_GROSS');
            const discount      = findRate('DSCNT');
            const fuelSurcharge = findRate('FUEL_SUR') || findRate('FUEL_SUR_FEE');
            const totalCharge   = Number(rateDetail?.shipmentCharges?.total?.value || 0);
            const currency      = rateDetail?.shipmentCharges?.total?.currency || 'USD';

            // All non-base surcharges (everything except gross, discount, and after-discount lines)
            const excludedRateCodes = new Set(['LND_GROSS', 'DSCNT', 'DSCNT_RATE', 'AFTR_DSCNT']);
            const surchargeRates = rates.filter((r) => !excludedRateCodes.has(r.code));
            const totalSurcharges = surchargeRates.reduce((sum, r) => sum + Number(r.value || 0), 0);

            // PRO number is the TForce BOL/tracking number
            shipment.trackingNumber  = carrierResponse.proNumber;
            shipment.carrierQuoteId  = String(carrierResponse.bolId ?? '');

            shipment.serviceName = rateDetail?.service?.description || 'TForce Freight LTL';
            shipment.serviceType = rateDetail?.service?.code       || dto.selectedRate?.serviceCode || '308';
            shipment.shipDate    = dto.shipDate ? new Date(dto.shipDate) : new Date();
            shipment.currency    = currency as Currency;

            // Label: documents array contains base64 PDFs — type '30' is the shipping label
            const labelDoc = carrierResponse.documents?.find((d: any) => d.type === '30');
            const bolDoc   = carrierResponse.documents?.find((d: any) => d.type === '20');
            // Store base64 label data if available (adjust field name to match your entity)
            shipment.shippingLabels = labelDoc?.data ?? bolDoc?.data ?? null;

            shipment.totalBaseCharge      = grossCharge - discount;   // after-discount base
            shipment.totalSurcharges      = totalSurcharges;
            shipment.totalFreightDiscounts = discount;
            shipment.totalNetCharge       = totalCharge;
            shipment.totalTax             = 0;                        // TForce doesn't return tax separately
            shipment.totalCharge          = totalCharge;
            shipment.carrier = Carrier.TFORCE;

            // Persist individual surcharge line items (mirrors FedEx pattern)
            if (surchargeRates.length > 0) {
                const surchargeEntities = surchargeRates.map((r) =>
                    this.em.create(Surcharge, {
                        shipment,
                        carrier: Carrier.TFORCE,
                        name:     r.code,
                        amount:   Number(r.value),
                        currency,
                        createdAt: new Date(),
                    })
                );
                shipment.surcharges.add(surchargeEntities);
            }
        }

        if (dto.carrier === Carrier.XPO) {
            // ═══════════════════════════════════════════════════════════════════════
            // 1. CREATE BOL (dto.selectedRate already contains the live-fetched rate)
            // ═══════════════════════════════════════════════════════════════════════
            const carrierResponse = await this.xpoAdapter.createShipment(dto, quote);

            const bolId = carrierResponse?.bolId;
            if (!bolId) {
                throw new BadRequestException(
                    'XPO BOL creation failed: No bolInstId returned from carrier'
                );
            }

            // ═══════════════════════════════════════════════════════════════════════
            // 2. USE DTO SELECTED RATE (already verified/fetched before this step)
            // ═══════════════════════════════════════════════════════════════════════
            const selectedRate = dto.selectedRate ?? {};
            const rateCurrency = selectedRate.currency ?? 'USD';
            const rateTotal    = selectedRate.totalCharge  ?? 0;

            // ── Map shipment fields ───────────────────────────────────────────────
            shipment.bolNumber       = bolId;
            shipment.carrierQuoteId  = bolId;
            shipment.trackingNumber  = carrierResponse.proNumber;

            shipment.serviceName = selectedRate.serviceName ?? 'XPO LTL Freight';
            shipment.serviceType = selectedRate.serviceType ?? 'LTL';
            shipment.shipDate    = dto.shipDate ? new Date(dto.shipDate) : new Date();
            shipment.currency    = rateCurrency;

            // BOL PDF if available
            shipment.shippingLabels = carrierResponse?.bolPdfBase64 ?? null;

            // Pricing from DTO selectedRate (the live rate fetched before booking)
            shipment.totalBaseCharge       = selectedRate.totalCharge ?? 0;
            shipment.totalSurcharges       = selectedRate.totalSurcharges ?? 0;
            shipment.totalFreightDiscounts = selectedRate.totalDiscount ?? 0;
            shipment.totalNetCharge        = rateTotal;
            shipment.totalCharge           = rateTotal;
            shipment.carrier               = Carrier.XPO;

            // Persist surcharges from selectedRate
            const quoteSurcharges = selectedRate.surcharges ?? [];
            if (quoteSurcharges.length > 0) {
                const surchargeEntities = quoteSurcharges
                    .filter((s: any) => (s.amount ?? 0) > 0)
                    .map((s: any) =>
                        this.em.create(Surcharge, {
                            shipment,
                            carrier: Carrier.XPO,
                            name: s.name || s.code || 'Surcharge',
                            amount: s.amount,
                            currency: s.currency || rateCurrency,
                            createdAt: new Date(),
                        })
                    );
                if (surchargeEntities.length > 0) {
                    shipment.surcharges.add(surchargeEntities);
                }
            }
        }

        if (dto.carrier === Carrier.MINIMAX) {
            // ═══════════════════════════════════════════════════════════════════════
            // 1. CREATE BOL + PICKUP (single call)
            // ═══════════════════════════════════════════════════════════════════════
            const addresses = await quote.addresses.loadItems();
            const fromAddrBook = addresses.find((a: any) => a.type === 'FROM')?.addressBookEntry;
            const toAddrBook   = addresses.find((a: any) => a.type === 'TO')?.addressBookEntry;

            // Build accessorials from address flags
            const accessorialCodes: string[] = [];
            if (shipment?.tailgateRequiredInFromAddress || shipment.tailgateRequiredInToAddress) accessorialCodes.push('TLGD');
            if (fromAddrBook?.isResidential) accessorialCodes.push('RESP');  // residential pickup
            if (toAddrBook?.isResidential) accessorialCodes.push('RESDEL');  // residential delivery

            const carrierResponse = await this.minimaxAdapter.createShipment({
                shipDate: dto.shipDate ? new Date(dto.shipDate) : new Date(),
                fromAddress: fromAddrBook,
                toAddress: toAddrBook,
                lineItems: (quote as any).lineItems.units,
                accessorials: accessorialCodes.length > 0 ? accessorialCodes.join(',') : undefined,
                pucontact: fromAddrBook?.contactName,
                puphone: fromAddrBook?.phoneNumber,
                // billref: getEnv(ENV.MINIMAX_ACCOUNT_NUMBER),
                puemail: fromAddrBook?.email,
                putime: fromAddrBook?.palletShippingReadyTime,
                closetime: fromAddrBook?.palletShippingCloseTime,
            });

            const proNumber = carrierResponse.proNumber;
            if (!proNumber) {
                throw new BadRequestException('Minimax BOL creation failed: No PRO number returned');
            }

            // ═══════════════════════════════════════════════════════════════════════
            // 2. USE DTO SELECTED RATE
            // ═══════════════════════════════════════════════════════════════════════
            const selectedRate = dto.selectedRate ?? {};
            const rateTotal = selectedRate.totalCharge ?? 0;

            shipment.bolNumber       = carrierResponse.quoteNumber || proNumber;
            shipment.carrierQuoteId  = carrierResponse.quoteNumber || proNumber;
            shipment.trackingNumber  = proNumber;
            shipment.serviceName     = selectedRate.serviceName ?? 'Minimax Express LTL';
            shipment.serviceType     = selectedRate.serviceType ?? 'LTL';
            shipment.shipDate        = dto.shipDate ? new Date(dto.shipDate) : new Date();
            shipment.currency        = selectedRate.currency ?? 'CAD';
            shipment.totalBaseCharge = rateTotal;
            shipment.totalNetCharge  = rateTotal;
            shipment.totalCharge     = rateTotal;
            shipment.carrier         = Carrier.MINIMAX;

            // BOL PDF link if available
            shipment.shippingLabels = carrierResponse.bolLink ?? null;

            // Surcharges from selectedRate
            const quoteSurcharges = selectedRate.surcharges ?? [];
            if (quoteSurcharges.length > 0) {
                const surchargeEntities = quoteSurcharges
                    .filter((s: any) => (s.value ?? 0) > 0)
                    .map((s: any) =>
                        this.em.create(Surcharge, {
                            shipment,
                            carrier: Carrier.MINIMAX,
                            name: s.name || s.code || 'Surcharge',
                            amount: s.value,
                            currency: s.currency || 'CAD',
                            createdAt: new Date(),
                        })
                    );
                if (surchargeEntities.length > 0) {
                    shipment.surcharges.add(surchargeEntities);
                }
            }
        }

        shipment.tailgateRequiredInFromAddress = dto.tailgatePickup  ?? false;
        shipment.tailgateRequiredInToAddress   = dto.tailgateDelivery ?? false;
        shipment.carrier  = dto.carrier;
        shipment.currency = dto.selectedRate?.currency || Currency.USD;
    
        this.em.persist([shipment, quote]);
        await this.em.flush();

        const chargeAmount = shipment.totalNetCharge || shipment.totalCharge || 0;
        const finalAmountToDeduct = Number(chargeAmount) + Number(companyBasedRates);
        
        if (chargeAmount > 0) {
            try {
                await this.paymentService.deductFromWallet(session, {
                    amount: finalAmountToDeduct,
                    description: `Shipment ${shipment.trackingNumber} via ${dto.carrier}`,
                });
            } catch (walletError: any) {
                // IMPORTANT: The shipment is already live with the carrier at this point.
                // Options:
                // 1. Log and alert (allow shipment, handle payment async/offline)
                // 2. Throw here so the API returns an error (shipment exists but user sees failure)
                // 3. Implement a compensation/cancellation flow
                console.error('Wallet deduction failed after shipment creation:', walletError);
                // For now, re-throwing makes the failure visible:
                // throw new BadRequestException(`Shipment created, but wallet deduction failed: ${walletError.message}`);
            }
        }

        await this.mockTracking.scheduleTrackingTimeline(
            dto.carrier,
            shipment.trackingNumber as string,
            'standard_delivery',
        );

        return {
            message: 'Shipment created successfully',
            shipment,
            trackingNumber: shipment.trackingNumber,
        };
    }

    async getShipmentCarriersRates(dto: any, companyBasedRates: Record<string, any>) {
        const [
            tstResult, 
            fedexResult, 
            tforceResult,
            xpoResult,
            minimaxResult,
            polarisResult
        ] = await Promise.all([
            this.getTSTRates(dto, companyBasedRates)
                .then(r => ({ success: true as const, data: r }))
                .catch(e => ({ success: false as const, error: e.message })),
            this.getFedExRates(dto, companyBasedRates)
                .then(r => ({ success: true as const, data: r }))
                .catch(e => ({ success: false as const, error: e.message })),
            this.getTForceRates(dto, companyBasedRates)
                .then(r => ({ success: true as const, data: r }))
                .catch(e => ({ success: false as const, error: e.message })),
            this.getXPORates(dto, companyBasedRates)
                .then(r => ({ success: true as const, data: r }))
                .catch(e => ({ success: false as const, error: e.message })),
            this.getMinimaxRates(dto, companyBasedRates)
                .then(r => ({ success: true as const, data: r }))
                .catch(e => ({ success: false as const, error: e.message })),
            this.getPolarisRates(dto, companyBasedRates)
                .then(r => ({ success: true as const, data: r }))
                .catch(e => 
                {
                    console.log(e)
                    return  ({ success: false as const, error: e.message })
                }
                ),
        ]);

        return {
            message: "Rates fetched",
            fedexQuotes: fedexResult.success ? fedexResult.data : null,
            fedexError: fedexResult.success ? null : fedexResult.error,
            tstQuotes: tstResult.success ? tstResult.data : null,
            tstError: tstResult.success ? null : tstResult.error,
            tforceQuotes: tforceResult.success ? tforceResult.data : null,
            tforceError: tforceResult.success ? null : tforceResult.error,
            xpoQuotes: xpoResult.success ? xpoResult.data : null,
            xpoError: xpoResult.success ? null : xpoResult.error,
            minimaxQuotes: minimaxResult.success ? minimaxResult.data : null,
            minimaxError: minimaxResult.success ? null : minimaxResult.error,
            polarisQuotes: polarisResult.success ? polarisResult.data : null,
            polarisError: polarisResult.success ? null : polarisResult.error,
        };
    }

    // SSE stream — emits each carrier as it completes
    getShipmentCarriersRatesStream(dto: any, companyBasedRates: Record<string, any>): Observable<MessageEvent> {
        const carriers = [
            { name: Carrier.FEDEX,   fetch: () => this.getFedExRates(dto, companyBasedRates) },
            { name: Carrier.TST,     fetch: () => this.getTSTRates(dto, companyBasedRates) },
            { name: Carrier.TFORCE,  fetch: () => this.getTForceRates(dto, companyBasedRates) },
            { name: Carrier.XPO,     fetch: () => this.getXPORates(dto, companyBasedRates) },
            { name: Carrier.MINIMAX, fetch: () => this.getMinimaxRates(dto, companyBasedRates) },
            { name: Carrier.POLARIS, fetch: () => this.getPolarisRates(dto, companyBasedRates) },
        ];

        const streams = carriers.map(c =>
            from(c.fetch()).pipe(
                map(quotes => ({
                    data: JSON.stringify({ carrier: c.name, quotes, error: null })
                } as MessageEvent)),
                catchError(err => of({
                    data: JSON.stringify({ carrier: c.name, quotes: null, error: err.message })
                } as MessageEvent))
            )
        );

        return merge(...streams);
    }

    private async getFedExRates(fedexDto: any, companyBasedRates: Record<string,any>) {
        const countryCode = fedexDto?.fedex?.from?.countryCode ?? 'US';
        const isUS = countryCode === 'US';

        const accountNumber = getEnv(
            isUS ? ENV.FEDEX_US_ACCOUNT_NUMBER : ENV.FEDEX_CA_ACCOUNT_NUMBER
        )!;

        const fedex = new FedExAdapter({
            name: 'FedEx',
            clientId: getEnv(ENV.FEDEX_CLIENT_ID)!,
            clientSecret: getEnv(ENV.FEDEX_CLIENT_SECRET)!,
            accountNumber,
        });
        let rates = await fedex.getRates(fedexDto);
        let normalizedRates = fedex.mapFedExToCarrierRate(rates);
            normalizedRates = normalizedRates.find( rate => rate.serviceType === "FEDEX_GROUND") as any;

        const chargesSetByAdmin = [ShipmentType.PACKAGE, ShipmentType.PALLET].includes(fedexDto.shipmentType) ? companyBasedRates.LTLRate : companyBasedRates.FTLRate;
     
        return {...normalizedRates, chargesSetByAdmin, finalTotalWithAdminCut: Number(normalizedRates?.totalPrice as number + (chargesSetByAdmin ||0))};
    }

    private async getTSTRates(tstDto: any, companyBasedRates: Record<string,any>) {
        const shipmentType = tstDto?.shipmentType as ShipmentType;
        const isFTL = shipmentType === ShipmentType.STANDARD_FTL;

        if (isFTL) {
            throw new BadRequestException(`Unsupported shipmentType: ${shipmentType}`);
           
        }

        const tstAdapter = new TSTCFExpressAdapter();
        let rates = await tstAdapter.getRates(tstDto);
        
        const chargesSetByAdmin = [ShipmentType.PACKAGE, ShipmentType.PALLET].includes(tstDto.shipmentType) ? companyBasedRates.LTLRate : companyBasedRates.FTLRate;
        return {...rates, chargesSetByAdmin, finalTotalWithAdminCut: Number(rates?.totalPrice as number + (chargesSetByAdmin ||0))};
    }

    private async getTForceRates(dto: any, companyBasedRates: Record<string, any>) {
        if([ShipmentType.COURIER, ShipmentType.PACKAGE].includes(dto.shipmentType)) {
            return null;
        }
        
        const tforceDto = {
            ...dto,
            type: dto.shipmentType,
            from: dto.tforce?.from,
            to: dto.tforce?.to,
            stackable: dto.stackable || false,
            pallets: dto.packages || dto.pallets || [],
            dangerousGoods: dto.dangerousGoods || false,
        };

        const rates = await this.tforceAdapter.getRates(tforceDto);
        let normalizedRates = this.tforceAdapter.mapTForceToCarrierRate(rates) as any;
        
        if(Array.isArray(normalizedRates)) normalizedRates = normalizedRates[0]
        
        const chargesSetByAdmin = [ShipmentType.PACKAGE, ShipmentType.PALLET].includes(dto.shipmentType) ? companyBasedRates.LTLRate : companyBasedRates.FTLRate;

        return {...normalizedRates, chargesSetByAdmin, finalTotalWithAdminCut: Number(normalizedRates?.totalPrice as number + (chargesSetByAdmin ||0))};
    }

     private async getXPORates(dto: any, companyBasedRates: Record<string,any>) {
        const xpoDto = {
            ...dto,
            type: 'PALLET',
            from: dto.xpo?.from,
            to: dto.xpo?.to,
            pallets: dto.packages || [],
            dangerousGoods: false,
        };

        const rates = await this.xpoAdapter.getRates(xpoDto) as any;
        const normalizedRates = this.xpoAdapter.mapXPOToCarrierRate(rates) as Record<string, any>;
        const chargesSetByAdmin = [ShipmentType.PACKAGE, ShipmentType.PALLET].includes(dto.shipmentType) ? companyBasedRates.LTLRate : companyBasedRates.FTLRate;
        return {...normalizedRates, chargesSetByAdmin, finalTotalWithAdminCut: Number(normalizedRates?.totalPrice as number + (chargesSetByAdmin ||0))};
    }

    private async getMinimaxRates(dto: any, companyBasedRates: Record<string, any>) {
        if ([ShipmentType.COURIER, ShipmentType.PACKAGE].includes(dto.shipmentType)) {
            return null;
        }

        const fromAddress = dto.addresses?.find((a: any) => a.type === 'FROM')?.addressBookEntry;
        const toAddress   = dto.addresses?.find((a: any) => a.type === 'TO')?.addressBookEntry;

        const tailgateRequired = fromAddress?.tailgateRequired === true || toAddress?.tailgateRequired === true;
        const residentialAddress = fromAddress?.isResidential === true || toAddress?.isResidential === true;

        // Build Minimax accessorial codes from flags
        const accessorialCodes: string[] = [];
        if (tailgateRequired) accessorialCodes.push('TLGD');
        if (residentialAddress) accessorialCodes.push('RESDEL');
        const accessorials = accessorialCodes.length > 0 ? accessorialCodes.join(',') : undefined;

        const minimaxDto = {
            ...dto,
            type: dto.shipmentType,
            from: dto.minimax?.from || {
                postalCode: dto.tst?.from?.postalCode || dto.tforce?.from?.postalCode || dto.xpo?.from?.postalCode,
                city: dto.tst?.from?.city || dto.tforce?.from?.city || dto.xpo?.from?.city,
                state: dto.tst?.from?.state || dto.tforce?.from?.state || dto.xpo?.from?.state,
                countryCode: dto.tst?.from?.state ? 'CA' : (dto.tforce?.from?.countryCode || dto.xpo?.from?.countryCode || 'CA'),
            },
            to: dto.minimax?.to || {
                postalCode: dto.tst?.to?.postalCode || dto.tforce?.to?.postalCode || dto.xpo?.to?.postalCode,
                city: dto.tst?.to?.city || dto.tforce?.to?.city || dto.xpo?.to?.city,
                state: dto.tst?.to?.state || dto.tforce?.to?.state || dto.xpo?.to?.state,
                countryCode: dto.tst?.to?.state ? 'CA' : (dto.tforce?.to?.countryCode || dto.xpo?.to?.countryCode || 'CA'),
            },
            pallets: dto.packages || [],
            dangerousGoods: dto.dangerousGoods || false,
            accessorials,
            shipDate: dto.shipDate,
        };

        const carrierPayload = this.minimaxAdapter.buildRequest(minimaxDto);
        const normalizedResponse = await this.minimaxAdapter.fetchRates(carrierPayload) as any;

        if (!normalizedResponse || normalizedResponse.total === 0) {
            return null;
        }

        const mappedRate = this.minimaxAdapter.mapMinimaxToCarrierRate(normalizedResponse);

        const chargesSetByAdmin = [ShipmentType.PACKAGE, ShipmentType.PALLET].includes(dto.shipmentType) 
            ? companyBasedRates.LTLRate 
            : companyBasedRates.FTLRate;

        return {
            ...mappedRate,
            chargesSetByAdmin,
            finalTotalWithAdminCut: Number(mappedRate?.totalPrice + (chargesSetByAdmin || 0)),
        };
    }

    private async getPolarisRates(dto: any, companyBasedRates: Record<string, any>) {
        const fromCountry = dto.polaris.from.countryCode;
        const toCountry = dto.polaris.to.countryCode;
        const domesticShipping = fromCountry === toCountry;
        // Polaris only does cross-border
        if (domesticShipping) {
            throw new BadRequestException(
                `Polaris only supports cross-border shipping (US ↔ Canada). Both addresses appear to be in ${fromCountry}.`
            );
        }

        if ([ShipmentType.COURIER, ShipmentType.PACKAGE].includes(dto.shipmentType)) {
            return null;
        }

        const polarisDto = {
            ...dto,
            type: dto.shipmentType,
            from: dto.polaris?.from,
            to: dto.polaris?.to,
            pallets: dto.packages || dto.pallets || [],
            services: dto.services || {},
            shipDate: dto.shipDate,
            freightClass: dto.packages?.[0]?.freightClass || '',
        };
        const carrierPayload = this.polarisAdapter.buildRequest(polarisDto);
        
        const normalizedResponse = await this.polarisAdapter.fetchRates(carrierPayload) as any;
        if (!normalizedResponse || normalizedResponse.error || normalizedResponse.totalCharge === 0) {
            return null;
        }

        const mappedRate = this.polarisAdapter.mapPolarisToCarrierRate(normalizedResponse);
        
        const chargesSetByAdmin = [ShipmentType.PACKAGE, ShipmentType.PALLET].includes(dto.shipmentType) 
            ? companyBasedRates.LTLRate 
            : companyBasedRates.FTLRate;

        return {
            ...mappedRate,
            chargesSetByAdmin,
            finalTotalWithAdminCut: Number(mappedRate?.totalPrice + (chargesSetByAdmin || 0)),
        };
    }


    async trackShipment(dto: ShipmentStatusDTO): Promise<any> {
        // ── 1. Find shipment by ID and carrier ─────────────────────────────────
        const shipment = await this.em.findOne(Shipment, {
            id: dto.shipmentId,
            carrier: dto.carrier,
        });

        if (!shipment) {
            throw new NotFoundException(
            `Shipment not found for ID ${dto.shipmentId} and carrier ${dto.carrier}`
            );
        }

        // ── 2. Get tracking number / PRO ───────────────────────────────────────
        const proNumber = shipment.trackingNumber;
        if (!proNumber) {
            throw new BadRequestException(
            `No tracking number available for shipment ${dto.shipmentId}`
            );
        }

        // ── 3. Call carrier-specific adapter ───────────────────────────────────
        let status: any;
        let events: any;

        switch (dto.carrier) {
            case Carrier.XPO: {
                const { statusCd, events: trackingEvents } = await this.xpoAdapter.getStatusAndEvents(proNumber);
                status = this.mapCarrierStatusToInternal(dto.carrier, statusCd || '');
                events = trackingEvents ?? (trackingEvents as any)?.events ?? [];
            }
            break;

            case Carrier.MINIMAX: {
                const { statusCd, events: trackingEvents } = await this.minimaxAdapter.getStatusAndEvents(proNumber);
                status = statusCd;
                events = trackingEvents;
            }
            break;
            
            case Carrier.FEDEX: {
                // Express: PACKAGE, COURIER_PAK  |  Freight: PALLET, FTL
                const isFreight = shipment.shipmentType === ShipmentType.PALLET || shipment.shipmentType === ShipmentType.STANDARD_FTL;

                // FDXE = Express (packages/parcels), FXFR = Freight (pallets/FTL)
                const carrierCode = isFreight ? 'FXFR' : 'FDXE';

                const { statusCd, events: trackingEvents } = await this.fedexAdapter.getStatusAndEvents(proNumber, carrierCode);

                status = this.fedexAdapter.mapStatusToInternal(statusCd);
                events = trackingEvents;
            }
            break;

            case Carrier.TST: {
                try {
                    const { statusCd, events: trackingEvents } = await this.tstcfAdapter.getStatusAndEvents(proNumber);
                    status = this.tstcfAdapter.mapStatusToInternal(statusCd);
                    events = trackingEvents;
                } catch (err: any) {
                    // If tracking fails (sandbox PRO or not yet in system), return pending
                    if (err.message?.includes('Invalid or unknown PRO')) {
                        status = 'PENDING';
                        events = [];
                    } else {
                        throw err;
                    }
                }
            }
            break;

            default:
            throw new BadRequestException(`Tracking not supported for carrier: ${dto.carrier}`);
        }

        // ── 4. Update shipment status in DB ──────────────────────────────────────
        if (status) {
            shipment.currentStatus = status;
            shipment.lastTrackedAt = new Date();
            await this.em.flush();
        }

        // ── 5. Return combined response ────────────────────────────────────────
        return {
            status: shipment.currentStatus,
            events: events ?? []
        };
    }

    private mapCarrierStatusToInternal(carrier: Carrier, carrierStatusCd: string): ShipmentStatus {
    if (carrier === Carrier.XPO) {
        const map: Record<string, ShipmentStatus> = {
        '1':  ShipmentStatus.PICKED_UP,
        '8':  ShipmentStatus.OUT_FOR_DELIVERY,
        '13': ShipmentStatus.APPOINTMENT_REQUIRED,
        '17': ShipmentStatus.RETURNED_TO_DOCK,
        '21': ShipmentStatus.REFUSED,
        '23': ShipmentStatus.DELIVERED,
        '26': ShipmentStatus.CANCELLED,
        '29': ShipmentStatus.IN_TRANSIT,
        '32': ShipmentStatus.CREATED,
        '33': ShipmentStatus.DELAYED,
        '37': ShipmentStatus.DELAYED,
        };
        return map[carrierStatusCd] ?? ShipmentStatus.UNKNOWN;
    }

    // Add other carrier mappings here
    return ShipmentStatus.UNKNOWN;
    }
}