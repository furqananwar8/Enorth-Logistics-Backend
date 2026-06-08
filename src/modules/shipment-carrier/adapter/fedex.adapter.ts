import { BadRequestException } from "@nestjs/common";
import { CarrierAdapter } from "src/types/shipment-carriers";
import { toFedExCountryCode } from "src/utils/fedex-country-code";
import { toFedExStateCode } from "src/utils/fedex-state-code";
import { Carrier } from "../dto/create-carrier-shipment.dto";
import { getEnv } from "src/utils/getEnv";
import { ENV } from "src/common/constants/env";

// ============================================================================
// TYPES
// ============================================================================

interface FedExCredentials {
  clientId: string;
  clientSecret: string;
}

interface FedExTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export enum ShipmentType {
  PALLET = 'PALLET',
  PACKAGE = 'PACKAGE',
  COURIER = 'COURIER',
  STANDARD_FTL = 'STANDARD_FTL',
  SPOT_LTL = 'SPOT_LTL',
}

export interface Address {
  postalCode: string;
  countryCode: string;
  city: string;
  state: string;
  street: string;
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

export interface CourierLineItem {
  weight: number;
  description?: string;
}

export interface ShipmentRateRequest {
  type: ShipmentType;
  fedex: {
    from: Address,
    to: Address
  }
  shipDate?: Date;
  rateRequestType: string;
  dangerousGoods: boolean;
  pallets?: PalletLineItem[];
  packages?: PackageLineItem[];
  courierItems?: CourierLineItem[];
  services?: Record<string, boolean>;
  serviceType: string;
  shipmentType: string;
}

// ============================================================================
// MAPPERS
// ============================================================================

interface CarrierPayloadMapper {
  supports(type: ShipmentType): boolean;
  map(request: ShipmentRateRequest, accountNumber: string): unknown;
}

class FedExParcelMapper implements CarrierPayloadMapper {
  supports(type: ShipmentType): boolean {
    return type === ShipmentType.PACKAGE || type === ShipmentType.COURIER;
  }

  map(req: ShipmentRateRequest, accountNumber: string): unknown {
    return {
      accountNumber: { value: accountNumber },
      requestedShipment: {
        quoteDate: req.shipDate || new Date(),
        shipper: { address: this.toFedExAddress(req.fedex.from) },
        recipient: { address: this.toFedExAddress(req.fedex.to) },
        pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
        rateRequestType: ['ACCOUNT', 'LIST'],
        requestedPackageLineItems: this.mapLineItems(req),
      }
    };
  }

  private mapLineItems(req: ShipmentRateRequest) {
    if (req.type === ShipmentType.COURIER) {
      return (req.courierItems || []).map(item => ({
        weight: { units: "LB", value: item.weight },
        ...(item.description ? { customerReferences: [{ value: item.description }] } : {})
      }));
    }

    return (req.packages || req.pallets ||  []).map(pkg => ({
      weight: { units: pkg.weightUnit || "LB", value: pkg.weight },
      dimensions: pkg.length && pkg.width && pkg.height ? {
        length: pkg.length,
        width: pkg.width,
        height: pkg.height,
        units: pkg.dimensionsUnit || "IN"
      } : undefined,
      ...(pkg.subPackagingType ? { subPackagingType: pkg.subPackagingType } : {}),
      ...(pkg.specialHandlingRequired ? {
        packageSpecialServices: { specialServiceTypes: ["SIGNATURE_OPTION"] }
      } : {})
    }));
  }

  private toFedExAddress(addr: Address) {
    return {
      postalCode: addr.postalCode,
      countryCode: addr.countryCode,
      ...(addr.city ? { city: addr.city } : {}),
      ...(addr.state ? { stateOrProvinceCode: addr.state } : {}),
      ...(addr.street ? { streetLines: [addr.street] } : {})
    };
  }
}

class FedExFreightMapper implements CarrierPayloadMapper {
  supports(type: ShipmentType): boolean {
    return type === ShipmentType.PALLET || type === ShipmentType.SPOT_LTL;
  }

  map(req: any, accountNumber: string): unknown {
    const from = req.fedex?.from || req.from;
    const to = req.fedex?.to || req.to;

    return {
      accountNumber: { value: accountNumber },
      serviceType: "FEDEX_EXPRESS",
      rateRequestControlParameters: {
        returnTransitTimes: true,
        servicesNeededOnRateFailure: true,
        rateSortOrder: 'COMMITASCENDING',
      },
      freightRequestedShipment: {
        shipper: { address: this.toFedExAddress(from) },
        recipient: { address: this.toFedExAddress(to) },
        rateRequestType: ['ACCOUNT', 'LIST'],
        shippingChargesPayment: {
          paymentType: 'SENDER',
          payor: {
            responsibleParty: {
              accountNumber: { value: accountNumber }
            }
          }
        },
        freightShipmentDetail: {
          role: 'SHIPPER',
          lineItems: (req.packages || []).map((item: any, idx: number) => ({
            id: String(idx + 1),
            freightClass: item.freightClass || 'CLASS_050',
            weight: {
              units: item.weightUnit || 'LB',
              value: item.weight,
            },
            dimensions: item.length ? {
              length: item.length,
              width: item.width,
              height: item.height,
              units: item.palletUnitType || 'IN',
            } : undefined,
            description: item.description || 'Freight',
            stackable: item.stackable ?? false,
            nmfc: item.nmfc,
          })),
        }
      }
    };
  }

  private toFedExAddress(addr: any) {
    return {
      postalCode: addr.postalCode,
      countryCode: addr.countryCode,
      ...(addr.city ? { city: addr.city } : {}),
      ...(addr.state ? { stateOrProvinceCode: addr.state } : {}),
      ...(addr.street ? { streetLines: [addr.street] } : {})
    };
  }
}

// ============================================================================
// ADAPTER
// ============================================================================

export class FedExAdapter implements CarrierAdapter {
  readonly carrierName = "fedex";
  private readonly baseUrl = "https://apis-sandbox.fedex.com";
  private readonly credentials: FedExCredentials;
  private readonly accountNumber: string;
  private readonly mappers: CarrierPayloadMapper[];
  private tokenCache: { token: string; expiresAt: number } | null = null;

  private readonly LTL_TYPES = new Set(['PALLET', 'STANDARD_LTL', 'SPOT_LTL']);
  private readonly PARCEL_TYPES = new Set(['PACKAGE', 'COURIER_PAK', 'COURIER']);
  private readonly EXPRESS_SERVICES = new Set([
    'SAME_DAY', 'SAME_DAY_CITY', 'FIRST_OVERNIGHT', 'PRIORITY_OVERNIGHT',
    'STANDARD_OVERNIGHT', 'FEDEX_2_DAY_AM', 'FEDEX_2_DAY',
    'FEDEX_EXPRESS_SAVER', 'INTERNATIONAL_PRIORITY', 'INTERNATIONAL_ECONOMY'
  ]);

  constructor(params: {
    name: string;
    clientId: string;
    clientSecret: string;
    accountNumber: string;
  }) {
    this.credentials = {
      clientId: params.clientId,
      clientSecret: params.clientSecret,
    };
    this.accountNumber = params.accountNumber;
    this.mappers = [new FedExParcelMapper(), new FedExFreightMapper()];
  }

  // --------------------------------------------------------------------------
  // INTERFACE METHODS (must be public)
  // --------------------------------------------------------------------------

  buildRequest(req: any): unknown {
    const type = (req.shipmentType || req.type || 'PACKAGE').toUpperCase();
    const isLTL = this.LTL_TYPES.has(type);
    return isLTL ? this.buildFreightRequest(req) : this.buildParcelRequest(req);
  }

  async fetchRates(carrierPayload: unknown): Promise<any> {
    const payload = carrierPayload as any;
    const isFreight = !!payload.freightRequestedShipment;
    return isFreight ? this.fetchFreightRates(payload) : this.fetchParcelRates(payload);
  }

  parseResponse(carrierResponse: any): any[] {
    return this.mapFedExToCarrierRate(carrierResponse);
  }

  // --------------------------------------------------------------------------
  // AUTH
  // --------------------------------------------------------------------------

  private async getAuthToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 300000) {
      return this.tokenCache.token;
    }

    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
    });

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FedEx auth failed: ${response.status} - ${errorText}`);
    }

    const data: FedExTokenResponse = await response.json();

    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };

    return data.access_token;
  }

  // --------------------------------------------------------------------------
  // RATES
  // --------------------------------------------------------------------------

  async getRates(req: ShipmentRateRequest): Promise<any> {
    const type = (req.shipmentType || req.type || 'PACKAGE').toUpperCase();
    if (!this.LTL_TYPES.has(type) && !this.PARCEL_TYPES.has(type)) {
      throw new BadRequestException(`Unsupported shipmentType: ${req.shipmentType || req.type}`);
    }

    const isLTL = this.LTL_TYPES.has(type);

     if (isLTL && this.accountNumber === getEnv(ENV.FEDEX_US_ACCOUNT_NUMBER)) {
        console.warn('FedEx Freight rate request skipped: no freight account configured');
        return { output: { rateReplyDetails: [] } };
    }
    const payload = isLTL ? this.buildFreightRequest(req) : this.buildParcelRequest(req);
    const response = isLTL ? await this.fetchFreightRates(payload) : await this.fetchParcelRates(payload);
    const rateDetails = response?.output?.rateReplyDetails ?? [];
    const filtered = rateDetails;
    // const filtered = isLTL ? rateDetails : rateDetails.filter((d: any) => this.EXPRESS_SERVICES.has(d.serviceType));

    return {
      ...response,
      output: {
        ...response.output,
        rateReplyDetails: filtered,
      },
    };
  }

  private buildParcelRequest(req: ShipmentRateRequest): unknown {
    const mapper = this.mappers.find(m => m.supports(req.shipmentType as any));
    if (!mapper) throw new Error(`FedEx does not support shipment type: ${req.shipmentType}`);
    return mapper.map(req, this.accountNumber);
  }

  private buildFreightRequest(req: ShipmentRateRequest): unknown {
    const mapper = this.mappers.find(m => m.supports(req.shipmentType as any));
    if (!mapper) throw new Error(`FedEx does not support shipment type: ${req.shipmentType}`);
    return mapper.map(req, this.accountNumber);
  }

  private async fetchParcelRates(payload: unknown): Promise<any> {
    const token = await this.getAuthToken();
    const transactionId = crypto.randomUUID();

    const response = await fetch(`${this.baseUrl}/rate/v1/rates/quotes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "x-customer-transaction-id": transactionId,
        "x-locale": "en_US",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FedEx Parcel API error: ${response.status} - ${errorText}`);
    }
    return response.json();
  }

  private async fetchFreightRates(payload: unknown): Promise<any> {
    const token = await this.getAuthToken();
    const transactionId = crypto.randomUUID();

    const response = await fetch(`${this.baseUrl}/rate/v1/freight/rates/quotes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "x-customer-transaction-id": transactionId,
        "x-locale": "en_US",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FedEx Freight API error: ${response.status} - ${errorText}`);
    }
    return response.json();
  }

  // --------------------------------------------------------------------------
  // SHIPMENT CREATION
  // --------------------------------------------------------------------------

  async createShipment(req: any, quote: any): Promise<any> {
    const token = await this.getAuthToken();
    const transactionId = crypto.randomUUID();

    const addresses = await quote.addresses.loadItems();
    const originShippingAddress = addresses.find((a: any) => a.type === 'FROM') || addresses[0];
    const destShippingAddress = addresses.find((a: any) => a.type === 'TO') || addresses[1];

    const originAddrBook = originShippingAddress?.addressBookEntry;
    const destAddrBook = destShippingAddress?.addressBookEntry;

    const origin = originAddrBook?.address || originShippingAddress?.address;
    const dest = destAddrBook?.address || destShippingAddress?.address;

    const originContactName = originAddrBook?.contactName || originAddrBook?.companyName || 'Test Shipper';
    const originPhone = (originAddrBook?.phoneNumber || '0000000000').replace(/\D/g, '').slice(0, 15);
    const destContactName = destAddrBook?.contactName || destAddrBook?.companyName || 'Test Recipient';
    const destPhone = (destAddrBook?.phoneNumber || '0000000000').replace(/\D/g, '').slice(0, 15);

    const lineItem = quote.lineItems;
    const units = lineItem?.units || [];
    const isInternational = toFedExCountryCode(origin?.country) !== toFedExCountryCode(dest?.country);

    const mappedPackages = units.map((unit: any, i: number) => ({
      sequenceNumber: i + 1,
      weight: {
        units: unit.weightUnit || 'LB',
        value: String(unit.weight),
      },
      dimensions: unit.length && unit.width && unit.height
        ? {
            length: String(unit.length),
            width: String(unit.width),
            height: String(unit.height),
            units: unit.dimensionsUnit || 'IN',
          }
        : undefined,
    }));

    const payload = {
      labelResponseOptions: 'URL_ONLY',
      accountNumber: { value: this.accountNumber },
      requestedShipment: {
        shipper: {
          contact: { personName: originContactName, phoneNumber: originPhone },
          address: {
            streetLines: [origin?.address1 || ''],
            city: origin?.city || '',
            stateOrProvinceCode: toFedExStateCode(origin?.state || ''),
            postalCode: origin?.postalCode || '',
            countryCode: toFedExCountryCode(origin?.country || origin?.countryCode),
          },
        },
        recipients: [{
          contact: { personName: destContactName, phoneNumber: destPhone },
          address: {
            streetLines: [dest?.address1 || ''],
            city: dest?.city || '',
            stateOrProvinceCode: toFedExStateCode(dest?.state || ''),
            postalCode: dest?.postalCode || '',
            countryCode: toFedExCountryCode(dest?.country || dest?.countryCode),
          },
        }],
        serviceType: isInternational ? 'INTERNATIONAL_PRIORITY' : 'STANDARD_OVERNIGHT',
        packagingType: req.selectedRate?.packagingType || 'YOUR_PACKAGING',
        pickupType: req.pickupType || 'DROPOFF_AT_FEDEX_LOCATION',
        shipDateStamp: req.shipDate
          ? new Date(req.shipDate).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        shippingChargesPayment: {
          paymentType: 'SENDER',
          payor: {
            responsibleParty: {
              accountNumber: { value: this.accountNumber, key: '' },
            },
            address: {
              streetLines: [origin?.address1 || ''],
              city: origin?.city || '',
              stateOrProvinceCode: toFedExStateCode(origin?.state || ''),
              postalCode: origin?.postalCode || '',
              countryCode: toFedExCountryCode(origin?.country || origin?.countryCode),
            },
          },
        },
        labelSpecification: {},
        customsClearanceDetail: isInternational ? {
          dutiesPayment: {
            paymentType: 'SENDER',
            payor: {
              responsibleParty: {
                accountNumber: { value: this.accountNumber },
              },
            },
          },
          commodities: mappedPackages.map((pkg, i) => ({
            description: `Package ${i + 1}`,
            quantity: 1,
            quantityUnits: 'EA',
            weight: {
              units: pkg.weight.units,
              value: Number(pkg.weight.value),
            },
            customsValue: {
              currency: req.selectedRate?.currency || 'USD',
              amount: 100,
            },
            unitPrice: {
              currency: req.selectedRate?.currency || 'USD',
              amount: 100,
            },
            countryOfManufacture: toFedExCountryCode(origin?.country) || 'US',
          })),
          totalCustomsValue: {
            currency: req.selectedRate?.currency || 'USD',
            amount: 100 * mappedPackages.length,
          },
        } : undefined,
        requestedPackageLineItems: mappedPackages,
      },
    };

    const response = await fetch(`${this.baseUrl}/ship/v1/shipments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "x-customer-transaction-id": transactionId,
        "x-locale": "en_US",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.json();
      const errorMessages = errorText?.errors?.map((e: any) => e.message) || ['Unknown FedEx error'];
      throw new BadRequestException(errorMessages.join('\n'));
    }

    return response.json();
  }

  // --------------------------------------------------------------------------
  // RESPONSE MAPPING
  // --------------------------------------------------------------------------

  mapFedExToCarrierRate(fedexQuotes: any, originCountryCode?: string): any[] {
    if (!fedexQuotes?.output?.rateReplyDetails) return [];

    const accountNumber =
      fedexQuotes?.output?.accountNumber?.value ||
      fedexQuotes?.input?.freightAccountNumber?.value ||
      fedexQuotes?.input?.requestedShipment?.shipper?.accountNumber?.value ||
      'unknown';

    return fedexQuotes.output.rateReplyDetails.map((rate: any) => {
      const selectedRate =
        rate.ratedShipmentDetails?.find((r: any) => r.rateType === 'ACCOUNT') ||
        rate.ratedShipmentDetails?.find((r: any) => r.rateType === 'LIST') ||
        rate.ratedShipmentDetails?.[0];

      const detail = selectedRate?.shipmentRateDetail;
      const freightDetail = rate.freightShipmentDetail;

      const surcharges = this.buildStandardSurcharges(
        detail?.surCharges,
        selectedRate?.currency
      );

      return {
        carrier: Carrier.FEDEX,
        accountNumber,
        serviceType: rate.serviceType,
        serviceName: rate.serviceName,
        packagingType: rate.packagingType || 'YOUR_PACKAGING',
        freightClass: freightDetail?.freightClass || null,
        handlingUnitCount: freightDetail?.handlingUnits?.length || rate.totalPackageCount || null,
        totalPrice: selectedRate?.totalNetCharge ?? null,
        totalDiscount: selectedRate?.totalDiscounts ?? 0,
        currency: selectedRate?.currency ?? 'USD',
        shipDate: fedexQuotes.output?.quoteDate,
        estimatedDeliveryDays:
          rate.operationalDetail?.transitTime ||
          rate.operationalDetail?.deliveryDate ||
          this.getFedExTransitTime(rate.serviceType),
        transitDate: rate.operationalDetail?.deliveryDate || null,
        billingWeight: detail?.totalBillingWeight ?? null,
        billingWeightUnit: detail?.totalBillingWeight?.units || 'LB',
        surcharges,
        totalSurcharges: detail?.totalSurcharges ?? 0,
        transactionId: fedexQuotes.transactionId,
        originCountry: originCountryCode || null,
      };
    });
  }

  getSurchargeName(val: string): string {
    return this.SURCHARGE_NAME_MAP[val] || "Freight fee";
  }

  private readonly SURCHARGE_NAME_MAP: Record<string, string> = {
    DEMAND: 'Demand Surcharge',
    FUEL: 'Fuel Surcharge',
    ADDITIONAL_HANDLING: 'Additional Handling',
    LIFTGATE: 'Liftgate',
    INSIDE_DELIVERY: 'Inside Delivery',
    INSIDE_PICKUP: 'Inside Pickup',
    LIMITED_ACCESS_DELIVERY: 'Limited Access Delivery',
    LIMITED_ACCESS_PICKUP: 'Limited Access Pickup',
    OVER_LENGTH: 'Over Length',
    DELIVERY_AREA: 'Delivery Area Surcharge',
    RESIDENTIAL: 'Residential Delivery',
    COD: 'Collect on Delivery',
    DANGEROUS_GOODS: 'Dangerous Goods',
    DRY_ICE: 'Dry Ice',
  };

  private buildStandardSurcharges(
    surchargesRaw: any[] | undefined,
    currency: string = 'USD'
  ): Array<{ name: string; value: number; currency: string }> {
    if (!Array.isArray(surchargesRaw)) return [];

    return surchargesRaw.map((s: any) => {
      const rawType = s.type || 'UNKNOWN';
      const mappedName = this.SURCHARGE_NAME_MAP[rawType] ||
        this.toTitleCase(rawType.replace(/_/g, ' '));

      return {
        name: mappedName,
        value: s.amount ?? 0,
        currency: currency ?? 'USD',
      };
    });
  }

  private toTitleCase(str: string): string {
    return str.replace(/\w\S*/g, (txt) =>
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }

  private getFedExTransitTime(serviceType: string): string {
    const map: Record<string, string> = {
      'SAME_DAY': 'Same day',
      'SAME_DAY_CITY': 'Same day',
      'FIRST_OVERNIGHT': '1 business day (morning)',
      'PRIORITY_OVERNIGHT': '1 business day (morning)',
      'STANDARD_OVERNIGHT': '1 business day (afternoon)',
      'FEDEX_2_DAY_AM': '2 business days (morning)',
      'FEDEX_2_DAY': '2 business days',
      'FEDEX_EXPRESS_SAVER': '3 business days',
      'FEDEX_GROUND': '1-5 business days',
      'FEDEX_HOME_DELIVERY': '1-5 business days',
      'INTERNATIONAL_PRIORITY': '1-3 business days',
      'INTERNATIONAL_ECONOMY': '2-5 business days',
    };
    return map[serviceType] || 'Varies by destination';
  }
}