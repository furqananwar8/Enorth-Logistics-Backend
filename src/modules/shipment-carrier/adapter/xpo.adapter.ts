import { CarrierAdapter } from 'src/types/shipment-carriers';
import { Carrier, CreateCarrierShipmentDTO } from '../dto/create-carrier-shipment.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Quote } from 'src/entities/quote.entity';
import { getEnv } from 'src/utils/getEnv';
import { ENV } from 'src/common/constants/env';

// ============================================================================
// XPO API TYPES
// ============================================================================

interface XPOCredentials {
  consumerKey: string;
  consumerSecret: string;
  username: string;
  password: string;
}

interface XPOTokenResponse {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expires_in: number;
}

// ============================================================================
// DOMAIN TYPES
// ============================================================================

export enum ShipmentType {
  PALLET      = 'PALLET',
  PACKAGE     = 'PACKAGE',
  COURIER     = 'COURIER',
  STANDARD_FTL = 'STANDARD_FTL',
  SPOT_LTL    = 'SPOT_LTL',
}

export interface Address {
  postalCode: string;
  countryCode: string;
  city: string;
  state: string;
  street: string;
  stateOrProvinceCode: string;
}

export interface PalletLineItem {
  length: number;
  width: number;
  height: number;
  weight: number;
  freightClass: string;
  nmfc?: string;
  stackable?: boolean;
  unitsOnPallet: number;
  palletUnitType: string;
  description?: string;
  dangerousGoods?: boolean;
}

export interface PackageLineItem {
  length: number;
  width: number;
  height: number;
  weight: number;
  description?: string;
  specialHandlingRequired: boolean;
  dimensionsUnit: string;
  weightUnit: string;
  subPackagingType: string;
  packaging?: string;
}

export interface ShipmentRateRequest {
  type: ShipmentType;
  from: Address;
  to: Address;
  shipDate?: Date;
  dangerousGoods: boolean;
  pallets?: PalletLineItem[];
  packages?: PackageLineItem[];
  services?: Record<string, boolean>;
  serviceType?: string;
}

// ============================================================================
// XPO RESPONSE TYPES
// ============================================================================

interface XPORateQuoteResponse {
  rateQuote?: {
    confirmationNbr?: string;
    totalChargeAmt?: { amt?: number; currencyCd?: string };
    linehaulChrgAmt?: { amt?: number; currencyCd?: string };
    totalDiscountAmt?: { amt?: number; currencyCd?: string };
    actlDiscountPct?: number;
    fscAmt?: { amt?: number; currencyCd?: string };
    transitDays?: number;
    estimatedDeliveryDate?: string;
    shipmentInfo?: {
      accessorials?: Array<{
        accessorialCd?: string;
        accessorialDesc?: string;
        chargeAmt?: { amt?: number; currencyCd?: string };
      }>;
    };
  };
  errors?: Array<{ code: string; message: string }>;
}

// ============================================================================
// PAYLOAD MAPPER INTERFACE
// ============================================================================

interface CarrierPayloadMapper {
  supports(type: ShipmentType): boolean;
  map(request: ShipmentRateRequest, accountNumber: string): unknown;
}

// ============================================================================
// LTL MAPPER  (pallets → XPO commodity array)
// ============================================================================

class XPOLTLMapper implements CarrierPayloadMapper {
  supports(type: ShipmentType): boolean {
    return (
      type === ShipmentType.PALLET ||
      type === ShipmentType.SPOT_LTL ||
      type === ShipmentType.STANDARD_FTL
    );
  }

  map(req: ShipmentRateRequest, accountNumber: string): unknown {
    // FIX: Full ISO 8601 with time and timezone (docs: "2018-05-10T12:00:00.000-0700")
    const shipmentDate = req.shipDate
      ? new Date(req.shipDate).toISOString()
      : new Date().toISOString();

    // Map pallets → XPO commodities
    const commodities = (req.pallets || req.packages || []).map((pallet) => {
      const commodity: Record<string, unknown> = {
        pieceCnt: pallet.handlingUnits,
        // FIX: Fallback to packaging for packages that don't have palletUnitType
        packageCode: this.mapPackagingType(pallet.packaging || pallet.palletUnitType),
        grossWeight: {
          weight: String(pallet.weight),
          weightUom: 'LBS',
        },
        nmfcClass: pallet.nmfcClass || '100',
        hazmatInd: pallet.dangerousGoods ?? req.dangerousGoods ?? false,
      };

      if (pallet.nmfc) {
        commodity.nmfcItemCd = pallet.nmfc;
      }

      // Dimensions — XPO requires ALL three if any are provided, in inches
      if (pallet.length && pallet.width && pallet.height) {
        commodity.dimensions = {
          length: pallet.length,
          width: pallet.width,
          height: pallet.height,
          dimensionsUom: 'INCH', // FIX: Must be INCH, not Inches
        };
      }

      return commodity;
    });

    const payload = {
      shipmentInfo: {
       shipper: {
          address: { postalCd: req.from.postalCode },
        },
        // shipper: {
        //   // FIX: acctInstId per docs, not acctMadCd
        //   ...(accountNumber ? { acctInstId: accountNumber } : {}),
        //   address: {
        //     postalCd: req.from.postalCode,
        //     // Only include cityName for Mexico (postal codes not used there)
        //     ...(req.from.countryCode === 'MX' ? { cityName: req.from.city } : {}),
        //     // ...(req.from.city ? { cityName: req.from.city } : {}),
        //     // REMOVED: stateCd and countryCd — docs say "*** not used ***"
        //   },
        // },
        consignee: {
          address: {
            postalCd: req.to.postalCode,
            // Only include cityName for Mexico (postal codes not used there)
            ...(req.from.countryCode === 'MX' ? { cityName: req.from.city } : {}),
            // ...(req.to.city ? { cityName: req.to.city } : {}),
            // REMOVED: stateCd and countryCd — docs say "*** not used ***"
          },
        },
        commodity: commodities,
        paymentTermCd: 'P',
        shipmentDate,
        // FIX: Added linealFt: 0 (required per docs)
        linealFt: 0,
        palletCnt: (req.pallets || req.packages || []).reduce(
          (sum, p: any) => sum + p.handlingUnits,
          0,
        ),
        hazmatInd: req.dangerousGoods ?? false,
        // FIX: Added bill2Party (required per docs even when empty)
        bill2Party: accountNumber
  ? { acctInstId: accountNumber }
  : { address: { usZip4: '' } },
        ...(req.services?.residentialPickup
          ? { accessorials: [{ accessorialCd: 'RPU' }] }
          : {}),
          
        ...(req.services?.residentialDelivery
          ? {
              accessorials: [
                ...(req.services?.residentialPickup
                  ? [{ accessorialCd: 'RPU' }]
                  : []),
                { accessorialCd: 'RDL' },
              ],
            }
          : {}),
      },
    };

    return payload;
  }

  private mapPackagingType(palletUnitType: string): string {
    const map: Record<string, string> = {
      PALLET:  'PLT',
      SKID:    'SKD',
      BOX:     'BOX',
      CRATE:   'CRT',
      BUNDLE:  'BDL',
      CARTON:  'CAS',
      PIECES:  'PCS',
    };
    return map[palletUnitType?.toUpperCase()] ?? 'PLT';
  }
}

// ============================================================================
// PACKAGE MAPPER  (packages → XPO commodity — treats each package as a piece)
// ============================================================================

class XPOPackageMapper implements CarrierPayloadMapper {
  supports(type: ShipmentType): boolean {
    return type === ShipmentType.PACKAGE || type === ShipmentType.COURIER;
  }

  map(req: ShipmentRateRequest, accountNumber: string): unknown {
    
    // FIX: Full ISO 8601 with time and timezone
    const shipmentDate = req.shipDate
      ? new Date(req.shipDate).toISOString()
      : new Date().toISOString();

    const commodities = (req.packages || []).map((pkg) => {
      const commodity: Record<string, unknown> = {
        pieceCnt: 1,
        packageCode: this.mapPackagingType(pkg.packaging ?? pkg.subPackagingType),
        grossWeight: {
          weight: String(pkg.weight),
          weightUom: pkg.weightUnit || 'LBS',
        },
        nmfcClass: '100',
        hazmatInd: false,
      };

      if (pkg.length && pkg.width && pkg.height) {
        commodity.dimensions = {
          length: pkg.length,
          width: pkg.width,
          height: pkg.height,
          dimensionsUom: 'INCH', // FIX: Must be INCH, not Inches
        };
      }

      return commodity;
    });

    const payload = {
      shipmentInfo: {
          address: { postalCd: req.from.postalCode },
        },
        consignee: {
          address: { postalCd: req.to.postalCode },
        },
        commodity: commodities,
        paymentTermCd: 'P',
        shipmentDate,
        // FIX: Added linealFt: 0
        linealFt: 0,
        // FIX: Added bill2Party
        bill2Party: accountNumber
  ? { acctInstId: accountNumber }
  : { address: { usZip4: '' } },

    };

    return payload;
  }

  private mapPackagingType(type?: string): string {
    const map: Record<string, string> = {
      BOX:    'BOX',
      PALLET: 'PLT',
      SKID:   'SKD',
      CRATE:  'CRT',
    };
    return map[type?.toUpperCase() ?? ''] ?? 'BOX';
  }
}

// ============================================================================
// MAIN ADAPTER
// ============================================================================

export class XPOAdapter implements CarrierAdapter {
  readonly carrierName = 'xpo';

  private readonly baseUrl     =  getEnv(ENV.XPO_BASE_URL);
  private readonly tokenUrl    = getEnv(ENV.XPO_TOKEN_URL)
  private readonly credentials: XPOCredentials;
  private readonly accountNumber: string;
  private readonly mappers: CarrierPayloadMapper[];

  private tokenCache: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } | null = null;

  constructor(params: {
    name: string;
    consumerKey: string;
    consumerSecret: string;
    accountNumber: string;
    username: string;
    password: string;
  }) {
    this.credentials = {
      consumerKey: params.consumerKey,
      consumerSecret: params.consumerSecret,
      username: params.username,
      password: params.password,
    };
    this.accountNumber = params.accountNumber;
    this.mappers = [new XPOLTLMapper(), new XPOPackageMapper()];
  }

  // --------------------------------------------------------------------------
  // AUTH
  // --------------------------------------------------------------------------

  private async getAuthToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 300_000) {
      return this.tokenCache.accessToken;
    }

    if (this.tokenCache?.refreshToken) {
      try {
        return await this.refreshAuthToken(this.tokenCache.refreshToken);
      } catch {
        // Fall through to full re-auth
      }
    }

    return this.fetchNewToken();
  }

  private async fetchNewToken(): Promise<string> {
    const basicAuth = Buffer.from(
      `${this.credentials.consumerKey}:${this.credentials.consumerSecret}`,
    ).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'password',
      username: this.credentials.username,
      password: this.credentials.password,
    });

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`XPO auth failed: ${response.status} - ${errorText}`);
    }

    const data: XPOTokenResponse = await response.json();
    this.cacheToken(data);
    return data.access_token;
  }

  private async refreshAuthToken(refreshToken: string): Promise<string> {
    const basicAuth = Buffer.from(
      `${this.credentials.consumerKey}:${this.credentials.consumerSecret}`,
    ).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) throw new Error('XPO refresh token failed');

    const data: XPOTokenResponse = await response.json();
    this.cacheToken(data);
    return data.access_token;
  }

  private cacheToken(data: XPOTokenResponse): void {
    this.tokenCache = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  // --------------------------------------------------------------------------
  // BUILD REQUEST
  // --------------------------------------------------------------------------

  buildRequest(req: any): unknown {
    const mapper = this.mappers.find((m) => m.supports(req.type));
    if (!mapper) {
      throw new Error(`XPO does not support shipment type: ${req.type}`);
    }
    return mapper.map(req, this.accountNumber);
  }

  // --------------------------------------------------------------------------
  // FETCH RATES
  // --------------------------------------------------------------------------

 async fetchRates(carrierPayload: unknown): Promise<unknown> {
    const token = await this.getAuthToken();
    
    const url = `${this.baseUrl}/rating/1.0/ratequotes?showSpecialServiceCharges=true`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
                'User-Agent': 'YourApp/1.0',
            },
            body: JSON.stringify(carrierPayload),
        });

        const responseBody = await response.text();

        if (!response.ok) {
            throw new Error(`XPO API error: ${response.status} - ${responseBody}`);
        }

        return JSON.parse(responseBody);
    } catch (error) {
        // Re-throw with more context
        throw new Error(`fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

  // --------------------------------------------------------------------------
  // PARSE RESPONSE
  // --------------------------------------------------------------------------

  parseResponse(carrierResponse: any): any[] {
    const response = carrierResponse as XPORateQuoteResponse;
    const quotes: any[] = [];

    if (response.errors && response.errors.length > 0) {
      const messages = response.errors.map((e) => e.message);
      throw new Error(`XPO returned errors: ${messages.join(', ')}`);
    }

    const rate = response.rateQuote;
    if (!rate) return quotes;

    quotes.push({
      carrierId: this.carrierName,
      serviceType: 'LTL',
      serviceName: 'XPO LTL',
      totalCharge: rate.totalChargeAmt?.amt,
      currency: rate.totalChargeAmt?.currencyCd ?? 'USD',
      transitDays: rate.transitDays,
      estimatedDelivery: rate.estimatedDeliveryDate,
      confirmationNumber: rate.confirmationNbr,
    });

    return quotes;
  }

  // --------------------------------------------------------------------------
  // GET RATES
  // --------------------------------------------------------------------------

  async getRates(req: any) {
    const payload = this.buildRequest(req);
    return this.fetchRates(payload);
  }

  // --------------------------------------------------------------------------
  // MAP TO NORMALIZED CARRIER RATE
  // --------------------------------------------------------------------------

  mapXPOToCarrierRate(xpoResponse: any) {
    const data = xpoResponse?.data;
    if (!data) return [];

    const rateQuote = data.rateQuote;
    const transitTime = data.transitTime;
    if (!rateQuote || !transitTime) return [];

    const shipmentInfo = rateQuote.shipmentInfo ?? {};
    const accessorials = shipmentInfo.accessorials ?? [];

    // Pick primary charge (USD preferred, fallback to first)
    const primaryCharge = rateQuote.totCharge?.find(
      (c: any) => c.currencyCd === 'USD',
    ) ?? rateQuote.totCharge?.[0];

    // Find FSC specifically from accessorials array
    const fscAccessorial = accessorials.find(
      (a: any) => a.accessorialCd === 'FSC',
    );

    return {
        carrier: Carrier.XPO,
        serviceType: 'LTL',
        serviceName: 'XPO LTL Freight',
        totalPrice: primaryCharge?.amt ?? null,
        totalDiscount: rateQuote.totDiscountAmt?.amt ?? 0,
        discountPercent: rateQuote.actlDiscountPct ?? 0,
        currency: primaryCharge?.currencyCd ?? 'USD',
        linehaulCharge: null, // XPO does not expose a separate linehaul field
        fuelSurcharge: fscAccessorial?.chargeAmt?.amt ?? 0,
        totalSurcharges: accessorials.reduce(
          (sum: number, a: any) => sum + (a.chargeAmt?.amt ?? 0),
          0,
        ),
        estimatedDeliveryDays: transitTime.transitDays
          ? `${transitTime.transitDays} business day${transitTime.transitDays === 1 ? '' : 's'}`
          : 'Varies by destination',
        estimatedDeliveryDate: transitTime.estdDlvrDate ?? null,
        confirmationNumber: rateQuote.confirmationNbr ?? null,
        transactionId: null,
    }
  }

  // ============================================================================
// XPO ADAPTER — ADD THESE METHODS
// ============================================================================

  // private toXPOTime = (d: Date): string => this.snapTime(d).toISOString();

  private isWeekend = (dateStr: string): boolean => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
    return dayOfWeek === 0 || dayOfWeek === 6;
  };

  private parseTimeStr = (timeStr: string | null | undefined, fallbackHour: number): { h: number; m: number } => {
    if (!timeStr) return { h: fallbackHour, m: 0 };
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return { h: fallbackHour, m: 0 };
    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const ampm = match[3]?.toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return { h, m };
  };
 
  private isTooFarInFuture = (dateStr: string, maxDays: number = 30): boolean => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const inputDate = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + maxDays);
    return inputDate > maxDate;
  };

  private formatPhone = (phone: string): string => {
    const digits = (phone ?? '').replace(/\D/g, '').slice(-10);
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  };

  private snapTime = (d: Date): Date => {
    const snapped = new Date(d);
    const mins = snapped.getMinutes();
    const snappedMins = [0, 15, 30, 45].reduce((prev, curr) =>
      Math.abs(curr - mins) < Math.abs(prev - mins) ? curr : prev
    );
    snapped.setMinutes(snappedMins, 0, 0);

    const hours = snapped.getHours();
    if (hours < 1)  snapped.setHours(8,  0, 0, 0);
    if (hours >= 23) snapped.setHours(22, 0, 0, 0);

    return snapped;
  };

  async createShipment(dto: CreateCarrierShipmentDTO, quote: Quote): Promise<any> {
    const testMode = process.env.XPO_TEST_MODE === 'Y' ? 'Y' : 'N';
    const quoteId = quote.id ?? 'unknown';
    const logPrefix = `[XPO][Quote:${quoteId}]`;

    // ═══════════════════════════════════════════════════════════════════════
    // 0. GET AUTH TOKEN
    // ═══════════════════════════════════════════════════════════════════════
    console.log(`${logPrefix} Starting shipment creation. Test mode: ${testMode}`);
    const token = await this.getAuthToken();
    console.log(`${logPrefix} Auth token acquired (length: ${token?.length ?? 0})`);

    // ═══════════════════════════════════════════════════════════════════════
    // 1. RESOLVE ADDRESSES & COMMODITIES
    // ═══════════════════════════════════════════════════════════════════════
    const fromAddress = quote.addresses?.find((a: any) => a.type === 'FROM')?.addressBookEntry;
    const toAddress   = quote.addresses?.find((a: any) => a.type === 'TO')?.addressBookEntry;
    const units       = quote.lineItems?.units || [];

    console.log(`${logPrefix} Resolved addresses — FROM: ${fromAddress?.companyName ?? 'N/A'}, TO: ${toAddress?.companyName ?? 'N/A'}`);
    console.log(`${logPrefix} Commodity units count: ${units.length}`);

    if (!fromAddress || !toAddress) {
      console.error(`${logPrefix} VALIDATION FAILED: Missing FROM or TO address`);
      throw new BadRequestException('Quote missing FROM or TO address');
    }

    if (!dto.shipDate) {
      console.error(`${logPrefix} VALIDATION FAILED: Ship date missing`);
      throw new BadRequestException('Ship date is required');
    }

    if (this.isTooFarInFuture(dto.shipDate)) {
      console.error(`${logPrefix} VALIDATION FAILED: Ship date ${dto.shipDate} > 30 days future`);
      throw new BadRequestException(
        `Pickup date ${dto.shipDate} is more than 30 days in the future. XPO only allows pickup dates within 30 days.`
      );
    }

    if (this.isWeekend(dto.shipDate)) {
      console.error(`${logPrefix} VALIDATION FAILED: Ship date ${dto.shipDate} is weekend`);
      throw new BadRequestException(
        `Pickup date ${dto.shipDate} falls on a weekend. XPO does not offer weekend pickup. Please select a weekday (Monday–Friday).`
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FIX: Build pickup times correctly for XPO
    // pkupDate  = date ONLY (no time) — "2026-07-30"
    // pkupTime  = full datetime with ready time — "2026-07-30T09:00:00.000"
    // dockClose = full datetime with close time — "2026-07-30T17:00:00.000"
    // ═══════════════════════════════════════════════════════════════════════
    const shipDate = new Date(dto.shipDate);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${shipDate.getFullYear()}-${pad(shipDate.getMonth() + 1)}-${pad(shipDate.getDate())}`;

    const readyTime = this.parseTimeStr(fromAddress.palletShippingReadyTime, 9);
    let closeTime = this.parseTimeStr(fromAddress.palletShippingCloseTime, 17);

    // Guardrail: dock close must be AFTER ready time
    if (closeTime.h < readyTime.h || (closeTime.h === readyTime.h && closeTime.m <= readyTime.m)) {
      console.warn(`${logPrefix} Close time (${pad(closeTime.h)}:${pad(closeTime.m)}) is before or equal to ready time (${pad(readyTime.h)}:${pad(readyTime.m)}). Defaulting close time to 17:00.`);
      closeTime = { h: 17, m: 0 };
    }

    // FIX 1: pkupDate = date string only (no time component)
    const pkupDateISO  = dateStr;  // "2026-07-30"

    // FIX 2: pkupTime = full datetime with READY time
    const pkupTimeISO  = `${dateStr}T${pad(readyTime.h)}:${pad(readyTime.m)}:00.000`;

    // FIX 3: dockCloseTime = full datetime with CLOSE time
    const dockCloseISO = `${dateStr}T${pad(closeTime.h)}:${pad(closeTime.m)}:00.000`;

    console.log(`${logPrefix} Pickup window — Date: ${pkupDateISO}, Ready: ${pkupTimeISO}, Dock Close: ${dockCloseISO}`);
    const [firstName, ...lastParts] = (fromAddress.contactName ?? 'Freight Shipper').split(' ');
    const lastName = lastParts.join(' ') || 'Shipper';

    const commodityLines = units.map((item: any, idx: number) => ({
      pieceCnt: item.handlingUnits ?? item.units?.length ?? 1,
      packaging: {
        packageCd: this.mapPackagingType(item.packaging ?? item.palletUnitType ?? 'PLT'),
        packageWeight: {
          weight:    Number(item.weight) || 500,
          weightUom: item.weightUnit ?? 'LBS',
        },
        ...(item.length && item.width && item.height ? {
          packageDimensions: {
            length:        item.length,
            width:         item.width,
            height:        item.height,
            dimensionsUom: 'INCH',
          },
        } : {}),
      },
      grossWeight: {
        weight:    Number(item.weight) || 500,
        weightUom: item.weightUnit ?? 'LBS',
      },
      desc:      item.description || `Freight Item ${idx + 1}`,
      nmfcClass: item.nmfcClass ?? '100',
      hazmatInd: item.dangerousGoods ?? false,
      ...(item.nmfc ? { nmfcItemCd: item.nmfc } : {}),
    }));

    console.log(`${logPrefix} Built ${commodityLines.length} commodity lines`);

    const additionalService: Array<{ accsrlCode: string; prepaidOrCollect: string }> = [];
    if (dto.tailgatePickup)   additionalService.push({ accsrlCode: 'OLG', prepaidOrCollect: 'P' });
    if (dto.tailgateDelivery) additionalService.push({ accsrlCode: 'DLG', prepaidOrCollect: 'P' });

    if (additionalService.length > 0) {
      console.log(`${logPrefix} Additional services: ${additionalService.map(s => s.accsrlCode).join(', ')}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. BUILD BOL PAYLOAD
    // ═══════════════════════════════════════════════════════════════════════
    const bolPayload: any = {
      autoAssignPro: true,
      bol: {
        requester: {
          role: 'S',
          userId: 'anmol@ulsfreight.ca',
          requester: { firstName, lastName },
        },
        shipper: {
          address: {
            name:         fromAddress.companyName ?? fromAddress.contactName ?? '',
            addressLine1: fromAddress.address.address1 ?? '',
            addressLine2: fromAddress.address.address2 ?? '',
            cityName:     fromAddress.address.city ?? '',
            stateCd:      fromAddress.address.state ?? '',
            countryCd:    fromAddress.address.country === 'CA' ? 'CN' : 'US',
            postalCd:     fromAddress.address.postalCode ?? '',
          },
          contactInfo: {
            companyName: fromAddress.companyName ?? '',
            fullName:    fromAddress.contactName ?? '',
            email: { emailAddr: fromAddress.email ?? '' },
            phone: { phoneNbr: this.formatPhone(fromAddress.phoneNumber ?? '') },
          },
        },
        consignee: {
          address: {
            name:         toAddress.companyName ?? toAddress.contactName ?? '',
            addressLine1: toAddress.address.address1 ?? '',
            addressLine2: toAddress.address.address2 ?? '',
            cityName:     toAddress.address.city ?? '',
            stateCd:      toAddress.address.state ?? '',
            countryCd:    toAddress.address.country === 'CA' ? 'CN' : 'US',
            postalCd:     toAddress.address.postalCode ?? '',
          },
          contactInfo: {
            companyName: toAddress.companyName ?? '',
            fullName:    toAddress.contactName ?? '',
            email: { emailAddr: toAddress.email ?? '' },
            phone: { phoneNbr: this.formatPhone(toAddress.phoneNumber ?? '') },
          },
        },
        commodityLine: commodityLines,
        chargeToCd: 'P',
        ...(additionalService.length > 0 ? { additionalService } : {}),
        pickupInfo: {
          pkupDate:      pkupDateISO,
          pkupTime:      pkupDateISO,
          dockCloseTime: dockCloseISO,
          contact: {
            companyName: fromAddress.companyName ?? '',
            fullName:    fromAddress.contactName ?? '',
            phone: { phoneNbr: this.formatPhone(fromAddress.phoneNumber ?? '') },
          },
        },
        remarks: `Quote Reference: ${quote.id ?? ''}`,
      },
    };

    console.log(`${logPrefix} ═══════════════════════════════════════════════`);
    console.log(`${logPrefix} BOL PAYLOAD:`);
    console.log(JSON.stringify(bolPayload, null, 2));
    console.log(`${logPrefix} ═══════════════════════════════════════════════`);

    // ═══════════════════════════════════════════════════════════════════════
    // 3. CREATE BOL — NON-BLOCKING
    // ═══════════════════════════════════════════════════════════════════════
    let bolData: any = null;
    let bolInstId: string | null = null;
    let bolError: string | null = null;
    let pkupTrmnlSic: string | null = null;

    try {
      const bolUrl = `${this.baseUrl}/billoflading/1.0/billsoflading?testMode=${testMode}`;
      console.log(`${logPrefix} POST ${bolUrl}`);

      const bolResponse = await fetch(bolUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
          Accept:         'application/json',
        },
        body: JSON.stringify(bolPayload),
      });

      console.log(`${logPrefix} BOL response status: ${bolResponse.status} ${bolResponse.statusText}`);

      // Log raw response headers for debugging
      const responseHeaders: Record<string, string> = {};
      bolResponse.headers.forEach((value, key) => { responseHeaders[key] = value; });
      console.log(`${logPrefix} BOL response headers:`, JSON.stringify(responseHeaders));

      const responseText = await bolResponse.text();
      console.log(`${logPrefix} BOL raw response body:`, responseText);

      // Parse only if there's content
      bolData = responseText ? JSON.parse(responseText) : null;
      console.log(`${logPrefix} BOL parsed response:`, JSON.stringify(bolData, null, 2));

      // Deep-dive into the response structure
      console.log(`${logPrefix} BOL response structure check:`);
      console.log(`  - bolData exists: ${!!bolData}`);
      console.log(`  - bolData.data exists: ${!!bolData?.data}`);
      console.log(`  - bolData.data.bolInfo exists: ${!!bolData?.data?.bolInfo}`);
      console.log(`  - bolData.data.bolInfo.bolInstId: ${bolData?.data?.bolInfo?.bolInstId ?? 'MISSING'}`);
      console.log(`  - bolData.error exists: ${!!bolData?.error}`);
      console.log(`  - bolData.errors exists: ${!!bolData?.errors}`);

      if (bolData?.error) {
        console.error(`${logPrefix} BOL API returned error object:`, JSON.stringify(bolData.error, null, 2));
      }
      if (bolData?.errors?.length > 0) {
        console.error(`${logPrefix} BOL API returned errors array:`, JSON.stringify(bolData.errors, null, 2));
      }

      bolInstId = bolData?.data?.bolInfo?.bolInstId ?? null;
      console.log(`${logPrefix} Extracted bolInstId: ${bolInstId ?? 'NULL — THIS IS THE PROBLEM'}`);

      if (!bolResponse.ok) {
        const errorMsg =
          bolData?.error?.message ??
          bolData?.errors?.[0]?.message ??
          `BOL creation failed (HTTP ${bolResponse.status})`;
        console.error(`${logPrefix} HTTP ERROR — Status ${bolResponse.status}, Message: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      if (!bolInstId) {
        console.error(`${logPrefix} CRITICAL: BOL response was HTTP 200-ish but NO bolInstId found in response`);
        console.error(`${logPrefix} Full response body for inspection:`, JSON.stringify(bolData, null, 2));
        throw new Error('BOL creation succeeded but no bolInstId returned in response');
      }

      pkupTrmnlSic = bolData.data?.bolInfo?.pkupTrmnlSic ?? null;
      console.log(`${logPrefix} BOL created successfully — bolInstId: ${bolInstId}, pkupTrmnlSic: ${pkupTrmnlSic}`);

    } catch (err: any) {
      bolError = err?.message || 'BOL creation failed';
      console.error(`${logPrefix} ═══════════════════════════════════════════════`);
      console.error(`${logPrefix} BOL CREATION FAILED:`);
      console.error(`${logPrefix} Error message: ${bolError}`);
      console.error(`${logPrefix} Error stack:`, err?.stack);
      console.error(`${logPrefix} bolData at time of failure:`, JSON.stringify(bolData, null, 2));
      console.error(`${logPrefix} ═══════════════════════════════════════════════`);
      // DO NOT THROW — shipment creation must continue
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. FETCH BOL PDF + LABELS — NON-BLOCKING
    // ═══════════════════════════════════════════════════════════════════════
    let bolPdfBase64: string | null = null;
    let labelPdfBase64: string | null = null;

    if (bolInstId) {
      const totalPieces = commodityLines.reduce((sum: number, c: any) => sum + (c.pieceCnt || 1), 0);
      console.log(`${logPrefix} Fetching documents for bolInstId: ${bolInstId}, totalPieces: ${totalPieces}`);

      const [pdfResult, labelResult] = await Promise.all([
        // 4a. BOL PDF
        (async () => {
          const pdfUrl = `${this.baseUrl}/billoflading/1.0/billsoflading/${bolInstId}/pdf?testMode=${testMode}`;
          console.log(`${logPrefix} GET BOL PDF: ${pdfUrl}`);
          try {
            const res = await fetch(pdfUrl, {
              headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
            });
            console.log(`${logPrefix} BOL PDF response status: ${res.status}`);
            if (!res.ok) {
              console.error(`${logPrefix} BOL PDF fetch failed — HTTP ${res.status}`);
              return null;
            }
            const data = await res.json();
            console.log(`${logPrefix} BOL PDF response:`, JSON.stringify(data, null, 2));
            const pdfContent = data.data?.bolpdf?.contentType ?? null;
            console.log(`${logPrefix} BOL PDF extracted contentType: ${pdfContent ?? 'NULL'}`);
            return pdfContent;
          } catch (err: any) {
            console.error(`${logPrefix} BOL PDF fetch exception:`, err.message);
            return null;
          }
        })(),

        // 4b. Shipping Labels
        (async () => {
          const labelUrl = `${this.baseUrl}/billoflading/1.0/billsoflading/${bolInstId}/shippinglabels/pdf?testMode=${testMode}`;
          const labelBody = {
            nbrOfLabels: totalPieces,
            labelPosition: 1,
            printerSettings: 'Normal Printer Settings',
            bolInstId: String(bolInstId),
          };
          console.log(`${logPrefix} POST Shipping Labels: ${labelUrl}`);
          console.log(`${logPrefix} Label request body:`, JSON.stringify(labelBody, null, 2));
          try {
            const res = await fetch(labelUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                Accept: 'application/json',
              },
              body: JSON.stringify(labelBody),
            });
            console.log(`${logPrefix} Label response status: ${res.status}`);
            if (!res.ok) {
              console.error(`${logPrefix} Label fetch failed — HTTP ${res.status}`);
              return null;
            }
            const data = await res.json();
            console.log(`${logPrefix} Label response:`, JSON.stringify(data, null, 2));
            const labelContent = data.data?.shippingLabel?.contentType ?? null;
            console.log(`${logPrefix} Label extracted contentType: ${labelContent ?? 'NULL'}`);
            return labelContent;
          } catch (err: any) {
            console.error(`${logPrefix} Label fetch exception:`, err.message);
            return null;
          }
        })(),
      ]);

      bolPdfBase64 = pdfResult;
      labelPdfBase64 = labelResult;
      console.log(`${logPrefix} Documents fetched — BOL PDF: ${bolPdfBase64 ? 'YES' : 'NO'}, Labels: ${labelPdfBase64 ? 'YES' : 'NO'}`);
    } else {
      console.log(`${logPrefix} Skipping PDF/Label fetch — no bolInstId available`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. RETURN
    // ═══════════════════════════════════════════════════════════════════════
    const result = {
      raw:          { bol: bolData, bolError },
      bolId:        bolInstId,
      proNumber:    bolData?.data?.bolInfo?.proNbr ?? null,
      pkupTrmnlSic,
      pkupConfNbr:  bolData?.data?.bolInfo?.pkupConfNbr ?? null,
      pkupCallDate: bolData?.data?.bolInfo?.pkupCallDate ?? null,
      pkupCallSeq:  bolData?.data?.bolInfo?.pkupCallSeq ?? null,
      bolPdfBase64,
      labelPdfBase64,
    };

    console.log(`${logPrefix} ═══════════════════════════════════════════════`);
    console.log(`${logPrefix} FINAL RETURN OBJECT:`);
    console.log(JSON.stringify(result, null, 2));
    console.log(`${logPrefix} ═══════════════════════════════════════════════`);

    return result;
  }
  async cancelShipment(bolInstId: string): Promise<any> {
      const token = await this.getAuthToken();
      const testMode = process.env.XPO_TEST_MODE === 'Y' ? 'Y' : 'N';

      const url = `${this.baseUrl}/billoflading/1.0/billsoflading/${bolInstId}/cancel?testMode=${testMode}`;

      const response = await fetch(url, {
          method: 'PUT',
          headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              Accept: 'application/json',
          },
          body: JSON.stringify({
              bolInstId: String(bolInstId),
          }),
      });

      const data = await response.json();

      if (!response.ok) {
          const errorMsg =
              data.error?.message ??
              data.errors?.[0]?.message ??
              'Unknown cancel error';
          throw new BadRequestException(`XPO BOL cancel failed: ${errorMsg}`);
      }

      return {
          success: true,
          bolInstId,
          raw: data,
      };
  }


  async getStatusAndEvents(proNbr: string): Promise<{
    statusCd: string | undefined;
    events: any[];
  }> {
    const token = await this.getAuthToken();
    const testMode = process.env.XPO_TEST_MODE === 'Y' ? 'Y' : 'N';

    const [statusRes, eventsRes] = await Promise.all([
      fetch(
        `${this.baseUrl}/tracking/1.0/shipments/shipment-status-details?referenceNumbers=${proNbr}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      ),
      fetch(
        `${this.baseUrl}/tracking/1.0/shipments/${proNbr}/tracking-events?testMode=${testMode}&detailLevel=DETAIL`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      ),
    ]);

    const [statusData, eventsData] = await Promise.all([
      statusRes.json(),
      eventsRes.json(),
    ]);

    // Handle "No data found" — PRO exists in XPO system but no tracking events yet
    const statusMsg = statusData.error?.message ?? statusData.errors?.[0]?.message ?? '';
    const eventsMsg = eventsData.error?.message ?? eventsData.errors?.[0]?.message ?? '';
    
    if (statusMsg.includes('No data found') || eventsMsg.includes('No data found')) {
      return {
        statusCd: 'CREATED', // Shipment booked, not yet picked up / in transit
        events: [],
      };
    }

    if (!statusRes.ok) {
      const msg = statusData.error?.message ?? statusData.errors?.[0]?.message ?? 'Unknown error';
      throw new BadRequestException(`XPO status failed: ${msg}`);
    }
    if (!eventsRes.ok) {
      const msg = eventsData.error?.message ?? eventsData.errors?.[0]?.message ?? 'Unknown error';
      throw new BadRequestException(`XPO events failed: ${msg}`);
    }

    const shipmentStatus = statusData.data?.shipmentStatusDtls?.[0];
    if (!shipmentStatus) {
      throw new NotFoundException(`No tracking found for PRO ${proNbr}`);
    }

    return {
      statusCd: shipmentStatus.shipmentStatus?.statusCd,
      events: (eventsData.data?.shipmentTrackingEvent ?? []).map((e: any) => e.eventHdr),
    };
  }
// ── Helpers ───────────────────────────────────────────────────────────────

private addHoursToISO(isoString: string, hours: number): string {
  const d = new Date(isoString);
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

private mapPackagingType(type?: string): string {
  const map: Record<string, string> = {
    BOX: 'BOX', PALLET: 'PLT', SKID: 'SKD', CRATE: 'CRT',
    BUNDLE: 'BDL', CARTON: 'CAS', PIECES: 'PCS',
  };
  return map[type?.toUpperCase() ?? ''] ?? 'PLT';
}
}