import { CarrierAdapter } from 'src/types/shipment-carriers';
import { Carrier } from '../dto/create-carrier-shipment.dto';
import { LineItemUnitType } from 'src/common/enum/line-item-unit-type';
import { BadRequestException } from '@nestjs/common';

// ============================================================================
// TFORCE API TYPES
// ============================================================================

interface TForceCredentials {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  apiScope: string;
}

interface TForceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

// ============================================================================
// DOMAIN TYPES (shared with your app — mirror of FedEx adapter)
// ============================================================================

export enum ShipmentType {
  PALLET = 'PALLET',
  PACKAGE = 'PACKAGE',
  COURIER = 'COURIER',
  STANDARD_FTL = 'STANDARD_FTL',
  SPOT_LTL = 'SPOT_LTL',
  COURIER_PAK = "COURIER_PAK",
}

export interface Address {
  postalCode: string;
  countryCode: string;
  city: string;
  state: string;
  street: string;
  stateOrProvinceCode: string;
  streetLines?: string;
  isResidential?: boolean;
}

export interface PalletLineItem {
  length: number;
  width: number;
  height: number;
  weight: number;
  freightClass: string;
  nmfc?: string;
  nmfcSub?: string;
  stackable?: boolean;
  unitsOnPallet?: number;
  palletUnitType: string;
  description?: string;
  dangerousGoods?: boolean;
  handlingUnits?: number;
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
  stackable?: boolean;

  rateRequestType: string;
  dangerousGoods: boolean;
  pallets?: PalletLineItem[];
  packages?: PackageLineItem[];
  services?: Record<string, boolean>;
  serviceType: string;
  shipmentType: string;
}

// ============================================================================
// TFORCE RESPONSE TYPES
// ============================================================================

interface TForceRateResponse {
  transactionId?: string;
  rateResponse?: {
    totalCharges?: {
      monetaryValue?: number;
      currencyCode?: string;
    };
    totalChargesWithAccessorials?: {
      monetaryValue?: number;
      currencyCode?: string;
    };
    serviceCode?: string;
    serviceName?: string;
    timeInTransit?: {
      daysInTransit?: string;
    };
    quoteNumber?: string;
    rateCode?: string;
    billedWeight?: {
      weight?: number;
      unitOfMeasurement?: string;
    };
    accessorialCharges?: Array<{
      code?: string;
      name?: string;
      charge?: {
        monetaryValue?: number;
        currencyCode?: string;
      };
    }>;
    baseCharges?: Array<{
      currencyCode?: string;
      monetaryValue?: number;
    }>;
  };
  errors?: Array<{ code: string; message: string }>;
}

// ============================================================================
// PAYLOAD MAPPER INTERFACE (same pattern as FedEx)
// ============================================================================

interface CarrierPayloadMapper {
  supports(type: ShipmentType): boolean;
  map(request: ShipmentRateRequest, accountNumber: string, isVolume: boolean): unknown;
}

// ============================================================================
// LTL / PALLET MAPPER  (maps to TForce /getRate)
// ============================================================================

function mapWeightUnit(unit?: string): string {
    const map: Record<string, string> = {
      LB: 'LBS',
      LBS: 'LBS',
      KG: 'KGS',
      KGS: 'KGS',
    };
    return map[unit?.toUpperCase() || ''] || 'LBS';
  }

  function mapDimensionUnit(unit?: string): string {
    const map: Record<string, string> = {
      IN: 'IN',
      INCHES: 'IN',
      CM: 'CM',
      CENTIMETERS: 'CM',
      FT: 'FT',
      FEET: 'FT',
      M: 'M',
      METERS: 'M',
    };
    return map[unit?.toUpperCase() || ''] || 'inches';
  }

  function mapPackagingType(shipmentType: ShipmentType, stackable?: boolean): string {
  switch (shipmentType) {
    case ShipmentType.PALLET:
      return 'PLT';  // Pallet
    case ShipmentType.PACKAGE:
      return stackable ? 'PLT' : 'BOX';  // or 'CTN'
    case ShipmentType.COURIER_PAK:
      return 'BOX';  // or 'ENV' for envelope
    case ShipmentType.STANDARD_FTL:
      return 'PLT';  // FTL is always pallet/skid based
    default:
      return 'PLT';
  }
}

class TForceLTLMapper implements CarrierPayloadMapper {
  
  supports(type: ShipmentType): boolean {
    return (
      type === ShipmentType.PALLET ||
      type === ShipmentType.SPOT_LTL ||
      type === ShipmentType.STANDARD_FTL
    );
  }

  map(req: ShipmentRateRequest, accountNumber: string, isVolume: boolean = false): unknown {
    const pickupDate = req.shipDate
      ? new Date(req.shipDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

      // ── Standard LTL path (PACKAGE + PALLET) ─────────────────────────────────
      const units = req.packages ?? req.pallets ?? [];
  
      const commodities = units.map((unit: any) => {
        const commodity: Record<string, unknown> = {
          class: unit.freightClass ?? '50',
          pieces: unit.unitsOnPallet ?? unit.handlingUnits ?? 1,
          weight: {
            weight: unit.weight,
            // FIXED: was passing dimensionsUnit into weight unit mapper
            weightUnit: mapWeightUnit(unit.weightUnit ?? 'LB'),
          },
          packagingType: mapPackagingType(req.type, req.stackable),
          dangerousGoods: unit.dangerousGoods ?? req.dangerousGoods ?? false,
        };
  
        if (unit.nmfc) {
          commodity.nmfc = {
            prime: unit.nmfc,
            ...(unit.nmfcSub ? { sub: unit.nmfcSub } : {}),
          };
        }
  
        // Only add dimensions if all three are present
        if (unit.length && unit.width && unit.height) {
          commodity.dimensions = {
            length: unit.length,
            width: unit.width,
            height: unit.height,
            unit: mapDimensionUnit(unit.dimensionsUnit ?? 'IN'),
          };
        }
  
        return commodity;
      });
      
      return {
        requestOptions: {
          serviceCode: '308',
          pickupDate,
          type: 'L',
          densityEligible: false,
          timeInTransit: true,
          quoteNumber: true,
        },
        shipFrom: {
          address: {
            city: req.from.city,
            stateProvinceCode: req.from.stateOrProvinceCode || req.from.state,
            postalCode: req.from.postalCode,
            country: req.from.countryCode,
          },
          isResidential: req.from?.isResidential ?? false,
        },
        shipTo: {
          address: {
            city: req.to.city,
            stateProvinceCode: req.to.stateOrProvinceCode || req.to.state,
            postalCode: req.to.postalCode,
            country: req.to.countryCode,
          },
          isResidential: req.to?.isResidential ?? false,
        },
        payment: {
          payer: {
            address: {
              city: req.from.city,
              stateProvinceCode: req.from.stateOrProvinceCode || req.from.state,
              postalCode: req.from.postalCode,
              country: req.from.countryCode,
            },
          },
          billingCode: '10',
        },
        serviceOptions: {
          pickup: [],
          delivery: [],
          shipment: {
            ...(req.services?.protectFromFreeze ? { freezableProtection: true } : {}),
            ...(req.services?.excessValue ? {
              excessValue: {
                value: String(req.services.excessValue),
                currency: 'USD',
              },
            } : {}),
          },
        },
        commodities,
      };
    }
}

// ============================================================================
// VOLUME / FTL MAPPER  (maps to TForce /volumeRating)
// ============================================================================

class TForceVolumeMapper implements CarrierPayloadMapper {
  
  supports(type: ShipmentType): boolean {
    return type === ShipmentType.STANDARD_FTL;
  }

  map(req: ShipmentRateRequest, _accountNumber: string): unknown {
    console.log("INSIDE SHIPMENT CARRIER")
    console.log({req})
    const pickupDate = req.shipDate
      ? new Date(req.shipDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const totalWeight = (req.pallets || []).reduce(
      (sum, p) => sum + p.weight,
      0,
    );
    const totalPieces = (req.pallets || []).reduce(
      (sum, p) => sum + (p.handlingUnits as number),
      0,
    );

    const units = req.packages ?? req.pallets ?? [];

    return {
      requestOptions: {
        serviceCode: '308',
        pickupDate,
        type: 'L',
        timeInTransit: true,
        quoteNumber: true,
      },
      shipFrom: {
        address: {
          city: req.from.city,
          stateProvinceCode: req.from.stateOrProvinceCode || req.from.state,
          postalCode: req.from.postalCode,
          country: req.from.countryCode,
        },
        isResidential: false,
      },
      shipTo: {
        address: {
          city: req.to.city,
          stateProvinceCode: req.to.stateOrProvinceCode || req.to.state,
          postalCode: req.to.postalCode,
          country: req.to.countryCode,
        },
        isResidential: false,
      },
      serviceOptions: {
        pickup: [],
        delivery: [],
        shipment: {},
      },
      commodity: 
        {
          linearfeet: this.estimateLinearFeet(units as any),
          pieces: totalPieces,
          weight: {
            weight: totalWeight,
            weightUnit: 'LBS',
          },
          packagingType: mapPackagingType(req.type, req.stackable),
          dangerousGoods: req.dangerousGoods ?? false,
        }
    };
  }

  private estimateLinearFeet(pallets: PalletLineItem[]): number {
    if (!pallets || pallets.length === 0) {
      throw new BadRequestException('At least one pallet line item is required.');
    }

    // Sum total handling units across ALL line items
    const totalPalletCount = pallets.reduce((sum, p) => sum + (p.handlingUnits ?? 1), 0);

    if (totalPalletCount === 0) {
      throw new BadRequestException('Total handling units cannot be zero.');
    }

    // Use the first item's dimensions as the uniform pallet footprint
    // For FTL, length/width should be the pallet size (e.g., 48x40), not box size
    const unit = pallets[0];
    const palletLength = unit.length ?? 48;   // inches
    const palletWidth  = unit.width  ?? 40;   // inches
    const trailerWidth = 96;                  // standard dry van width in inches

    // Orientation A: palletWidth across trailer, palletLength along trailer
    const perRowA = Math.floor(trailerWidth / palletWidth);
    const rowsA   = Math.ceil(totalPalletCount / Math.max(perRowA, 1));
    const feetA   = rowsA * (palletLength / 12);

    // Orientation B: palletLength across trailer, palletWidth along trailer
    const perRowB = Math.floor(trailerWidth / palletLength);
    const rowsB   = Math.ceil(totalPalletCount / Math.max(perRowB, 1));
    const feetB   = rowsB * (palletWidth / 12);

    const linearFeet = Math.ceil(Math.min(feetA, feetB));

    // Guardrail: TForce volume rating requires 8–28 ft
    if (linearFeet < 8) {
      throw new BadRequestException(
        `Estimated linear feet (${linearFeet}) is below TForce minimum of 8. ` +
        `This shipment should use PALLET type (standard LTL /getRate) instead of FTL.`
      );
    }

    return linearFeet;
  }
}

// ============================================================================
// MAIN ADAPTER
// ============================================================================

export class TForceAdapter implements CarrierAdapter {
  readonly carrierName = 'tforce';

  private readonly baseUrl = 'https://api.tforcefreight.com/rating';
  private readonly credentials: TForceCredentials;
  private readonly accountNumber: string;
  private readonly apiVersion: string;
  private readonly mappers: CarrierPayloadMapper[];
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(params: {
    name: string;
    clientId: string;
    clientSecret: string;
    accountNumber: string;
    apiScope: string;
    tokenUrl?: string;
    apiVersion?: string;
  }) {
    this.credentials = {
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      // TForce uses Microsoft CIAM / Azure AD B2C for OAuth
      tokenUrl: params.tokenUrl || '',
      apiScope: params.apiScope || ''
    };
    this.accountNumber = params.accountNumber;
    this.apiVersion = params.apiVersion ?? 'v1';
    // FTL uses volumeRating endpoint, everything else uses getRate
    this.mappers = [new TForceVolumeMapper(), new TForceLTLMapper()];
  }

  private readonly TFORCE_SURCHARGE_MAP: Record<string, string> = {
    PFFF: 'Protect from Freezing',
    RESP: 'Residential Pickup',
    RESD: 'Residential Delivery',
    FUEL_SUR: 'Fuel Surcharge',
    HICST: 'High Cost Service Area',
    // Add new known codes here as they appear
  };
  // --------------------------------------------------------------------------
  // AUTH
  // --------------------------------------------------------------------------

  private async getAuthToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 300_000) {
      return this.tokenCache.token;
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      scope: this.credentials.apiScope,
    });

    const response = await fetch(this.credentials.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TForce auth failed: ${response.status} - ${errorText}`);
    }

    const data: TForceTokenResponse = await response.json();
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return data.access_token;
  }

  // --------------------------------------------------------------------------
  // BUILD REQUEST  (matches CarrierAdapter interface: buildRequest(req: RateRequest): unknown)
  // The returned object is an internal envelope { endpoint, payload } that
  // fetchRates unwraps — callers outside this class only see `unknown`.
  // --------------------------------------------------------------------------

  buildRequest(req: any): unknown {
    const mapper = this.mappers.find((m) => m.supports(req.type));
    if (!mapper) {
      throw new Error(`TForce does not support shipment type: ${req.type}`);
    }

    const isVolume = req.type === ShipmentType.STANDARD_FTL;
    const endpoint = isVolume ? `${this.baseUrl}/volumeRating?api-version=${this.apiVersion}` : `${this.baseUrl}/getRate?api-version=${this.apiVersion}`;

    return {
      __tforceEndpoint: endpoint,
      payload: mapper.map(req, this.accountNumber, isVolume),
    };
  }

  // --------------------------------------------------------------------------
  // FETCH RATES  (matches CarrierAdapter interface: fetchRates(payload: unknown): Promise<unknown>)
  // --------------------------------------------------------------------------

  async fetchRates(carrierPayload: unknown): Promise<unknown> {
    const { __tforceEndpoint: endpoint, payload } = carrierPayload as {
      __tforceEndpoint: string;
      payload: unknown;
    };
  
    const token = await this.getAuthToken();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(`TForce API error: ${response.status} - ${errorText}`);
    }
    const responseInJson = await response.json();

    return responseInJson;
  }

  // --------------------------------------------------------------------------
  // PARSE RESPONSE  (mirrors FedExAdapter.parseResponse)
  // --------------------------------------------------------------------------

  parseResponse(carrierResponse: any): any[] {
    const response = carrierResponse as TForceRateResponse;
    const quotes: any[] = [];

    // Surface any API-level errors early
    if (response.errors && response.errors.length > 0) {
      const messages = response.errors.map((e) => e.message);
      throw new Error(`TForce returned errors: ${messages.join(', ')}`);
    }

    const rate = response.rateResponse;
    if (!rate) return quotes;

    quotes.push({
      carrierId: this.carrierName,
      serviceType: rate.serviceCode ?? 'LTL',
      serviceName: rate.serviceName ?? 'TForce Freight LTL',
      totalCharge: rate.totalChargesWithAccessorials?.monetaryValue
        ?? rate.totalCharges?.monetaryValue,
      currency: rate.totalCharges?.currencyCode ?? 'USD',
      transitDays: rate.timeInTransit?.daysInTransit
        ? parseInt(rate.timeInTransit.daysInTransit)
        : undefined,
      quoteNumber: rate.quoteNumber,
      rateCode: rate.rateCode,
      billedWeight: rate.billedWeight?.weight,
    });

    return quotes;
  }

  // --------------------------------------------------------------------------
  // CREATE SHIPMENT  (creates BOL + schedules pickup in a single API call)
  // TForce Shipping API: POST https://api.tforcefreight.com/shipping/bol/create
  // --------------------------------------------------------------------------
  private toTForceCommodityPackagingType(unitType: LineItemUnitType): string {
    switch (unitType) {
      case LineItemUnitType.PALLET:         return 'PLT';
      case LineItemUnitType.DRUM:           return 'DRM';
      case LineItemUnitType.BOXES:          return 'BOX';
      case LineItemUnitType.ROLLS:          return 'ROL';
      case LineItemUnitType.PIPES_OR_TUBES: return 'TBE';
      case LineItemUnitType.BALES:          return 'BAL';
      case LineItemUnitType.BAGS:           return 'BAG';
      case LineItemUnitType.Cylinder:       return 'CYL';
      case LineItemUnitType.PAILS:          return 'PAL';
      case LineItemUnitType.REELS:          return 'REL';
      case LineItemUnitType.CRATE:          return 'CRT';
      case LineItemUnitType.LOOSE:          return 'LOO';
      case LineItemUnitType.PIECES:         return 'PCS';
      default:                              return 'PLT';
    }
  }

  private toTForceHandlingUnitTypeCode(shipmentType: ShipmentType): string {
    switch (shipmentType) {
      case ShipmentType.PALLET:      return 'PLT';

      case ShipmentType.STANDARD_FTL:
        // TForce supports FTL *rating* via volumeRating endpoint
        // but has no API for FTL BOL creation — must go through TForce customer service
        throw new Error(`TForce does not support BOL creation for FTL shipments via API`);

      default:
        return 'SKD';
    }
  }

  // ── Fix #2: state name → 2-char code helper ───────────────────────────────
  private toTForceStateCode(state: string | undefined): string {
    if (!state) return '';
    if (state.length === 2) return state.toUpperCase(); // already a code

    const map: Record<string, string> = {
      'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
      'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
      'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
      'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
      'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
      'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
      'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
      'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
      'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
      'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
      'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
      'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
      'wisconsin': 'WI', 'wyoming': 'WY',
      // Canadian provinces
      'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB', 'new brunswick': 'NB',
      'newfoundland and labrador': 'NL', 'northwest territories': 'NT', 'nova scotia': 'NS',
      'nunavut': 'NU', 'ontario': 'ON', 'prince edward island': 'PE', 'quebec': 'QC',
      'saskatchewan': 'SK', 'yukon': 'YT',
    };
    return map[state.toLowerCase()] ?? state.toUpperCase().slice(0, 2);
  }

  // ── Fix #3: strip CLASS_ prefix from freight class ────────────────────────
  private normalizeFreightClass(freightClass: string | undefined): string {
    if (!freightClass) return '50';
    // handles 'CLASS_70' → '70', '100' → '100', 'class_85' → '85'
    return String(freightClass).replace(/^class_/i, '');
  }

  // ── Fix #4: normalize time to HH:MM:SS ───────────────────────────────────
  private normalizeTime(time: string | undefined, fallback: string): string {
    if (!time) return fallback;
    // strip AM/PM and ensure HH:MM:SS format
    const cleaned = time.replace(/\s*(AM|PM)/i, '').trim();
    // if HHMM format (4 digits) → convert to HH:MM:SS
    if (/^\d{4}$/.test(cleaned)) {
      return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}:00`;
    }
    // if already HH:MM:SS or HH:MM → pad seconds
    const parts = cleaned.split(':');
    if (parts.length === 2) return `${parts[0]}:${parts[1]}:00`;
    if (parts.length === 3) return cleaned;
    return fallback;
  }

  // ── Fix #1: postal code normalizer ───────────────────────────────────────
  private normalizePostalCode(postalCode: string | undefined): string {
    if (!postalCode) return '';
    // Canadian postal codes: 'M5H 3T4' → 'M5H3T4'
    // US zip codes: '90210' or '90210-1234' → keep as-is (TForce accepts both)
    return postalCode.replace(/\s+/g, '').toUpperCase();
  }

  async createShipment(req: any, quote: any): Promise<any> {
    const token = await this.getAuthToken();

    // ── Resolve addresses ────────────────────────────────────────────────────
    const addresses = await quote.addresses.loadItems();
    const originShippingAddress = addresses.find((a: any) => a.type === 'FROM') || addresses[0];
    const destShippingAddress   = addresses.find((a: any) => a.type === 'TO')   || addresses[1];

    const originAddrBook = originShippingAddress?.addressBookEntry;
    const destAddrBook   = destShippingAddress?.addressBookEntry;

    const origin = originAddrBook?.address || originShippingAddress?.address;
    const dest   = destAddrBook?.address   || destShippingAddress?.address;

    const TFORCE_SUPPORTED_COUNTRIES = new Set(['US', 'CA']);  // MX excluded per business decision
    const originCountry = (origin?.country || origin?.countryCode || '').toUpperCase();
    const destCountry   = (dest?.country   || dest?.countryCode   || '').toUpperCase();

    // ── Fix #2: ensure closeTime is always after openTime ────────────────────
    const openTime  = this.normalizeTime(originAddrBook?.palletShippingOpenTime,  '08:00:00');
    const closeTime = this.normalizeTime(originAddrBook?.palletShippingCloseTime, '17:00:00');

    // if closeTime <= openTime the value from DB is bad — fall back to default
    const safeCloseTime = closeTime > openTime ? closeTime : '17:00:00';

    if (!TFORCE_SUPPORTED_COUNTRIES.has(originCountry)) {
      throw new BadRequestException(
        `TForce does not support shipments originating from country: ${originCountry}. Supported: US, CA`
      );
    }

    if (!TFORCE_SUPPORTED_COUNTRIES.has(destCountry)) {
      throw new BadRequestException(
        `TForce does not support shipments destined for country: ${destCountry}. Supported: US, CA`
      );
    }

    // ── Contact info ─────────────────────────────────────────────────────────
    const originContactName = originAddrBook?.contactName || originAddrBook?.companyName || 'Shipper';
    const originCompany     = originAddrBook?.companyName || originContactName;
    const originPhone       = (originAddrBook?.phoneNumber || '8005551212').replace(/\D/g, '').slice(0, 15);
    const originEmail       = originAddrBook?.email || undefined;

    const destContactName   = destAddrBook?.contactName || destAddrBook?.companyName || 'Consignee';
    const destPhone         = (destAddrBook?.phoneNumber || '8005551212').replace(/\D/g, '').slice(0, 15);
    const destEmail         = destAddrBook?.email || undefined;

    // ── Line items / handling units ──────────────────────────────────────────
    const lineItem = quote.lineItems;
    const units    = lineItem?.units || [];


    // TForce is LTL — map each unit to a commodity entry.
    // Use handlingUnitOne (grouped pieces) for the pallet/skid count.
    const totalPieces = units.reduce((sum: number, u: any) => sum + (u.unitsOnPallet || 1), 0);

    const commodities = units.map((unit: any, i: number) => ({
      description:   unit.description || `Commodity ${i + 1}`,
      class:         this.normalizeFreightClass(unit.freightClass),
      pieces:        unit.unitsOnPallet || 1,
      weight: {
        weight:     unit.weight,
        weightUnit: (unit.weightUnit || 'LBS').toUpperCase() === 'KG' ? 'KGS' : 'LBS',
      },
      packagingType:   mapPackagingType(quote.shipmentType, quote.lineItems?.stackable),
      dangerousGoods: quote?.lineItem?.dangerousGoods ? true : false,
      ...(unit.length && unit.width && unit.height ? {
        dimensions: { length: unit.length, width: unit.width, height: unit.height, unit: 'IN' },
      } : {}),
      ...(unit.declaredValue ? {
        commodityValue: { value: unit.declaredValue, currency: 'USD' },
      } : {}),
      commodityID: i + 1,
    }));

    // ── Pickup date ───────────────────────────────────────────────────────────
    const pickupDate = req.shipDate ? new Date(req.shipDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    // ── Service code ──────────────────────────────────────────────────────────
    // 308 = TForce Freight LTL (US/CA), 349 = US/MX, 309 = Guaranteed
    const serviceCode: string = req.selectedRate?.serviceCode || '308';

    const handlingTypeCode = this.toTForceHandlingUnitTypeCode(quote.shipmentType);

    // ── Build payload ─────────────────────────────────────────────────────────
    const payload = {
      requestOptions: {
        serviceCode,
        pickupDate,
        previewRate:    true,
        timeInTransit:  true,
        bolPrintFormat: 'TFF',
      },

     shipFrom: {
        name:    originCompany,
        ...(originEmail ? { email: originEmail } : {}),
        phone:   { number: originPhone },
        contact: originContactName,
        address: {
          addressLine:       origin?.address1  || '',
          city:              origin?.city      || '',
          stateProvinceCode: this.toTForceStateCode(origin?.state),
          postalCode:        this.normalizePostalCode(origin?.postalCode) || '',
          country:           origin?.country || origin?.countryCode || 'US',
        },
      },

      shipTo: {
        name:    destContactName,
        ...(destEmail ? { email: destEmail } : {}),
        phone:   { number: destPhone },
        address: {
          addressLine:       dest?.address1  || '',
          city:              dest?.city      || '',
          stateProvinceCode: this.toTForceStateCode(dest?.state),
          postalCode:        this.normalizePostalCode(dest?.postalCode) || '',
          country:           dest?.country || dest?.countryCode || 'US',
        },
      },

      // Billing: TForce only accepts billingCode '10' (prepaid/sender pays)
      payment: {
        payer: {
          name:  originCompany,
          phone: { number: originPhone },
          address: {
            addressLine:       origin?.address1  || '',
            city:              origin?.city      || '',
            stateProvinceCode: this.toTForceStateCode(origin?.state),
            postalCode:        this.normalizePostalCode(origin?.postalCode) || '',
            country:           origin?.country || origin?.countryCode || 'US',
          },
        },
        billingCode: '10',
      },

      // handlingUnitOne = grouped/palletised pieces (skids, pallets, etc.)
      handlingUnitOne: {
        quantity: totalPieces,
        typeCode: handlingTypeCode || 'SKD',
      },

      commodities,

      // ── Optional: embed pickup scheduling (avoids a separate Pickup API call)
      // ── Fix #1 + #4 in pickupRequest ─────────────────────────────────────────
      pickupRequest: {
        pickup: {
          date:      pickupDate,
            time: this.normalizeTime(req.pickupReadyTime, '10:00:00'),
            openTime,
            closeTime: safeCloseTime,
        },
        requester: {
          companyName: originCompany,
          contactName: originContactName,
          email:       originEmail || 'noreply@shipment.com', // ✅ Fix #1 — required by API
          phone:       { number: originPhone },
          thirdParty:  req.isThirdParty ?? false,
        },
        pomIndicator: false,
      },

      // Request both the BOL document (type 20) and a shipping label (type 30)
      documents: {
        image: [
          {
            type:   '20',    // BOL document
            format: '01',    // PDF
          },
          {
            type:   '30',    // Shipping label
            format: '01',
            label: {
              type:             '07',  // Thermal 4x6
              startPosition:    1,
              numberOfStickers: totalPieces,
            },
          },
        ],
      },
    };
    console.dir(payload, { depth: null })
    // ── Call the Shipping API ─────────────────────────────────────────────────
    // Note: shipping uses a different base URL than rating
    const shippingBaseUrl = 'https://api.tforcefreight.com/shipping';
    const endpoint        = `${shippingBaseUrl}/bol/create?api-version=${this.apiVersion}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TForce Shipping API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // ── Normalise response to mirror FedEx shape ──────────────────────────────
    const detail = result?.detail ?? {};
    return {
      raw: result,

      // BOL / tracking identifiers
      bolId:                detail.bolId,
      proNumber:            detail.pro,           // ← This is your BOL/tracking number
      originServiceCenter:  detail.originServiceCenter,

      // Pickup confirmation (embedded — no separate call needed)
      pickupConfirmationNumber: detail.pickup?.transactionReference?.confirmationNumber,
      pickupStatus:             detail.pickup?.responseStatus?.description,

      // Documents (base64-encoded PDFs)
      documents: detail.documents?.image ?? [],

      // Rate preview (present when previewRate: true)
      rateDetail: detail.rateDetail ?? [],
    };
  }

  // --------------------------------------------------------------------------
  // GET RATES  (top-level convenience — mirrors FedExAdapter.getRates)
  // --------------------------------------------------------------------------

  async getRates(req: any): Promise<unknown> {
    const carrierPayload = this.buildRequest(req);
    return this.fetchRates(carrierPayload);
  }

  // --------------------------------------------------------------------------
  // MAP TO NORMALIZED CARRIER RATE  (mirrors FedExAdapter.mapFedExToCarrierRate)
  // --------------------------------------------------------------------------

  mapTForceToCarrierRate(tforceResponse: any): any[] {
    const detailArray = tforceResponse?.detail;
    if (!Array.isArray(detailArray) || detailArray.length === 0) return [];

    return detailArray.map((detail: any) => {
      const rateLines = detail.rate || [];
      const excludedBaseCodes = new Set(['DSCNT', 'DSCNT_RATE', 'LND_GROSS', 'AFTR_DSCNT']);

      // Fuel surcharge (top-level convenience)
      const fuelLine = rateLines.find(
        (r: any) => r.code === 'FUEL_SUR' || r.description?.toLowerCase().includes('fuel')
      );
      const fuelSurcharge = parseFloat(fuelLine?.value ?? 0);

      // Total surcharges
      const totalSurcharges = rateLines.reduce((sum: number, r: any) => {
        if (!excludedBaseCodes.has(r.code)) {
          return sum + (parseFloat(r.value) || 0);
        }
        return sum;
      }, 0);

      // Discount amount
      const discountLine = rateLines.find((r: any) => r.code === 'DSCNT');
      const totalDiscount = discountLine ? parseFloat(discountLine.value) : 0;

      // Mapped surcharges array — known codes get clean names, unknowns fall back to "Freight charge"
      const surcharges = rateLines
        .filter((r: any) => !excludedBaseCodes.has(r.code))
        .map((r: any) => ({
          code: r.code,
          name: this.TFORCE_SURCHARGE_MAP[r.code] || 'Freight charge',
          rawDescription: r.description || null, // keep original if you ever need it
          value: parseFloat(r.value) || 0,
          currency: detail.shipmentCharges?.total?.currency ?? 'USD',
        }));

      return {
        carrier: Carrier.TFORCE,
        serviceType: detail.service?.code ?? 'LTL',
        serviceName: detail.service?.description ?? 'TForce Freight LTL',
        totalPrice: parseFloat(detail.shipmentCharges?.total?.value ?? 0),
        totalDiscount,
        currency: detail.shipmentCharges?.total?.currency ?? 'USD',
        shipDate: null,
        estimatedDeliveryDays: detail.timeInTransit?.timeInTransit ? `${parseInt(detail.timeInTransit?.timeInTransit)} business days` : null,
        billingWeight: detail.shipmentWeights?.billable?.value ?? null,
        fuelSurcharge,
        totalSurcharges,
        surcharges,
        quoteNumber: tforceResponse.summary?.quoteNumber ?? null,
        transactionId: tforceResponse.summary?.transactionReference?.transactionId ?? null,
        grossCharges: parseFloat(rateLines.find((r: any) => r.code === 'LND_GROSS')?.value ?? 0),
        afterDiscount: parseFloat(rateLines.find((r: any) => r.code === 'AFTR_DSCNT')?.value ?? 0),
        alerts: detail.alerts ?? null,
      };
    });
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private getTForceTransitTime(
    serviceCode?: string,
    daysInTransit?: string,
  ): string {
    if (daysInTransit) {
      const days = parseInt(daysInTransit);
      return isNaN(days)
        ? daysInTransit
        : `${days} business day${days === 1 ? '' : 's'}`;
    }

    // TForce service code reference (see API appendix)
    const map: Record<string, string> = {
      '308': '1-5 business days', // Standard LTL
      '309': '1-3 business days', // Guaranteed LTL
      '310': '1-2 business days', // Accelerated
      '334': 'Same day',           // Same Day
      '335': '1 business day',     // Next Day
    };
    return map[serviceCode ?? ''] ?? 'Varies by destination';
  }
}