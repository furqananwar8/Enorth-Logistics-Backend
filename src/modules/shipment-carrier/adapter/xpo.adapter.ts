import { CarrierAdapter } from 'src/types/shipment-carriers';
import { Carrier } from '../dto/create-carrier-shipment.dto';

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

  private readonly baseUrl     = 'https://api.ltl.xpo.com';
  private readonly tokenUrl    = 'https://api.ltl.xpo.com/token';
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
    
    const url = `${this.baseUrl}/rating/1.0/ratequotes`;
    
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
}