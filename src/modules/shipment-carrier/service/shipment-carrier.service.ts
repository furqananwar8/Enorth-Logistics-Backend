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

@Injectable()
export class ShipmentCarrierService {
    constructor(
        private readonly em: EntityManager,
        private readonly fedexAdapter: FedExAdapter,
        private readonly tstAdapter: TSTCFExpressAdapter,
        private readonly tforceAdapter: TForceAdapter,
        private readonly xpoAdapter: XPOAdapter,
        private readonly mockTracking: MockCarrierTrackingService,
        private readonly paymentService: PaymentService,
        private readonly requestContextService: RequestContextService
    ) {}
    
    async createShipment(dto: CreateCarrierShipmentDTO, session: SessionData) {
        let carrierResponse: any;

        if (![Carrier.FEDEX, Carrier.TST, Carrier.TFORCE, Carrier.XPO].includes(dto.carrier)) {
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

            const proNumber = carrierResponse?.pro || '';
            const bolPdfBase64 = carrierResponse?.bol?.imagedata || '';

            shipment.trackingNumber = proNumber;
            shipment.carrierQuoteId = proNumber;

            shipment.serviceName = dto.selectedRate?.serviceName || dto.selectedRate?.serviceType || 'STANDARD';
            shipment.serviceType = dto.selectedRate?.serviceType || 'ST';
            shipment.shipDate = quote?.shipment?.shipDate || new Date();
            shipment.currency = dto.selectedRate?.currency || Currency.CAD;

            shipment.shippingLabels = null;

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
            xpoResult
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
        };
    }

    // SSE stream — emits each carrier as it completes
    getShipmentCarriersRatesStream(dto: any, companyBasedRates: Record<string, any>): Observable<MessageEvent> {
        const carriers = [
            { name: Carrier.FEDEX,   fetch: () => this.getFedExRates(dto, companyBasedRates) },
            { name: Carrier.TST,     fetch: () => this.getTSTRates(dto, companyBasedRates) },
            { name: Carrier.TFORCE,  fetch: () => this.getTForceRates(dto, companyBasedRates) },
            { name: Carrier.XPO, fetch: () => this.getXPORates(dto, companyBasedRates) }
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
        console.dir({rates}, { depth: null})
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
}