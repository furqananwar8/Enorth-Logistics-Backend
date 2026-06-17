import { Address } from "cluster";
import { ShipmentType } from "src/common/enum/shipment-type.enum";
import { Pallet } from "src/entities/pallet.entity";


export type Carrier = 'FEDEX' | 'UPS' | 'TFORCE' | 'MINIMAX';

export interface CarrierShipment {
  shipmentType: ShipmentType;

  origin: Address;
  destination: Address;

  packages?: Package[];
  pallets?: Pallet[];

  accessorials?: string[];

  totalWeight?: number;
}

export interface CarrierRate {
  service: string;
  cost: number;
  currency: string;
  etaDays?: number;
}

export interface CarrierRateResult {
  carrier: Carrier;
  success: boolean;

  rates: CarrierRate[];

  error?: {
    code: string;
    message: string;
  };

  meta?: {
    durationMs: number;
  };
}
// Inbound — what your clients send
interface RateRequest {
  shipper: Address;
  consignee: Address;
  packages: Package[];
  serviceTypes?: string[];   // optional filter: ["GROUND", "EXPRESS"]
  carriers?: string[];       // optional filter: ["fedex", "tforce"]
  currency?: string;         // default "USD"
}

interface Package {
  weightLbs: number;
  dimensions?: { lengthIn: number; widthIn: number; heightIn: number };
  declaredValue?: number;
  freightClass?: string;     // for LTL carriers like TForce / Day&Ross
}

// Outbound — what you return
interface RateQuote {
  carrier: string;           // "fedex"
  serviceCode: string;       // "FEDEX_GROUND"
  serviceLabel: string;      // "FedEx Ground"
  totalChargeUSD: number;
  currency: string;
  transitDays?: number;
  estimatedDelivery?: string;
  surcharges?: { label: string; amount: number }[];
  rawCarrierResponse?: unknown; // passthrough for debugging
}

export interface CarrierAdapter {
  readonly carrierName: string | null;   // "fedex", "tforce", "dayandross"

  // Transform your RateRequest → carrier-specific payload
  buildRequest(req: RateRequest): unknown;

  // Call their API (handles auth, retries, headers)
  fetchRates(carrierPayload: unknown): Promise<unknown>;

  // Transform their response → your RateQuote[]
  parseResponse(carrierResponse: unknown): RateQuote[];
}

export interface RateRequestDto {
  shipmentType: 'PALLET' | 'PACKAGE' | 'COURIER' | 'STANDARD_FTL' | 'SPOT_LTL';
  from: {
    postalCode: string;
    countryCode: string;
    city?: string;
    state?: string;
    street?: string;
  };
  to: {
    postalCode: string;
    countryCode: string;
    city?: string;
    state?: string;
    street?: string;
  };
  shipDate?: string; // ISO date string
  dangerousGoods?: Record<string, any>;
  insurance?: {
    value: number;
    currency: string;
  };
  // Line items based on type
  pallets?: Array<{
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
  }>;
  packages?: Array<{
    length: number;
    width: number;
    height: number;
    weight: number;
    description?: string;
    specialHandlingRequired?: boolean;
  }>;
  courierItems?: Array<{
    weight: number;
    description?: string;
  }>;
  services?: Record<string, boolean>;
}