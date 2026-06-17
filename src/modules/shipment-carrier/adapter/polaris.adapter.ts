import { CarrierAdapter } from 'src/types/shipment-carriers';
import { BadRequestException } from '@nestjs/common';
import { Carrier } from '../dto/create-carrier-shipment.dto';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface PolarisCredentials {
  baseUrl: string;
  apiKey: string;
}

// ── Rate Request ────────────────────────────────────

export interface PolarisRateRequest {
  RATE_API: {
    From_PC_ZIP: string;
    To_PC_ZIP: string;
    Total_Weight_lbs: number;
    Number_of_Skids: number;
    Class?: string;
    Pickup_Date?: string;
    Number_of_Pieces?: number;
    Description?: string;
    ShipInstructions?: PolarisShipInstructions;
    SkidDimensions?: PolarisSkidDimension[];
  };
}

export interface PolarisShipInstructions {
  Inside_Pickup?: 'Y' | 'N';
  Residential_Pickup?: 'Y' | 'N';
  Lifgate_Pickup?: 'Y' | 'N';
  Inside_Delivery?: 'Y' | 'N';
  Residential_Delivery?: 'Y' | 'N';
  Lifgate_Delivery?: 'Y' | 'N';
  Appointment_Delivery?: 'Y' | 'N';
  OverSizeFreight?: 'Y' | 'N';
  Do_Not_Stack?: 'Y' | 'N';
  In_Bond?: 'Y' | 'N';
  Limited_Access_Pickup?: 'Y' | 'N';
  Limited_Access_Delivery?: 'Y' | 'N';
}

export interface PolarisSkidDimension {
  Skid: number;
  Length: number;
  Width: number;
  Height: number;
}

// ── Rate Response ───────────────────────────────────

export interface PolarisRateRawResponse {
  Rate_API_Response?: {
    Bill_Number?: string;
    Customer_Name?: string;
    From_PC_ZIP?: string;
    To_PC_ZIP?: string;
    Class?: string;
    Total_Weight_lbs?: string;
    Pallets?: string;
    Pickup_Date?: string;
    Delivery_Date?: string;
    Currency?: string;
    Base_Charge?: string;
    Fuel_Charge?: string;
    Fuel_Charge_Percentage?: string;
    Border_Charge?: string;
    Arbitrary_Charge_Total?: string;
    Additional_Services_Total?: string;
    Additional_Services?: {
      Charge?: string;
      Charge_Amount?: string;
    };
    Total_Charge?: string;
    Terms?: string;
    Message?: string;
    Error?: string;
  };
}

export interface PolarisRateResponse {
  quoteNumber: string;
  customerName: string;
  fromZip: string;
  toZip: string;
  totalWeight: number;
  pallets: number;
  pickupDate: string;
  deliveryDate: string;
  currency: string;
  baseCharge: number;
  fuelCharge: number;
  fuelChargePercentage: number;
  borderCharge: number;
  arbitraryChargeTotal: number;
  additionalServicesTotal: number;
  additionalServices: { charge: string; chargeAmount: number }[];
  totalCharge: number;
  terms: string;
  message: string | null;
  error: boolean;
  raw: PolarisRateRawResponse;
}

// ============================================================================
// ADAPTER
// ============================================================================

export class PolarisAdapter implements CarrierAdapter {
  readonly carrierName = 'polaris';

  private readonly credentials: PolarisCredentials;

  constructor(params: {
    baseUrl: string;
    apiKey: string;
  }) {
    this.credentials = {
      baseUrl: params.baseUrl.replace(/\/$/, ''),
      apiKey: params.apiKey,
    };
  }

  // --------------------------------------------------------------------------
  // CARRIER ADAPTER INTERFACE
  // --------------------------------------------------------------------------

  buildRequest(req: any): unknown {
    // ── Resolve addresses ──────────────────────────────────────────────────
    const fromZip = req.polaris.from.postalCode || '';

    const toZip = req.polaris.to.postalCode || '';

    if (!fromZip || !toZip) {
      throw new BadRequestException('Polaris rate quote requires origin and destination postal codes');
    }

    // ── Map packages to Polaris freight lines ────────────────────────────
    const packages = req.packages || req.pallets || [];

    const totalSkids = packages.length;
    const totalWeight = packages.reduce((sum: number, u: any) => sum + (u.weight || 0), 0);
    const totalPieces = packages.reduce((sum: number, u: any) => sum + (u.handlingUnits || 1), 0);

    // Validate limits
    if (totalSkids > 5) {
      throw new BadRequestException(`Polaris supports max 5 skids. Requested: ${totalSkids}`);
    }
    if (totalWeight > 7200) {
      throw new BadRequestException(`Polaris supports max 7,200 lbs. Requested: ${totalWeight}`);
    }

    // ── Format pickup date ───────────────────────────────────────────────
    let pickupDate: string | undefined;
    if (req.shipDate) {
      pickupDate = new Date(req.shipDate).toISOString();
    }

    // ── Map accessorials from services flags ─────────────────────────────
    const services = req.services || {};
    const shipInstructions: PolarisShipInstructions = {};

    if (services.insidePickup)        shipInstructions.Inside_Pickup = 'Y';
    if (services.residentialPickup)   shipInstructions.Residential_Pickup = 'Y';
    if (services.tailgatePickup)      shipInstructions.Lifgate_Pickup = 'Y';
    if (services.insideDelivery)      shipInstructions.Inside_Delivery = 'Y';
    if (services.residentialDelivery) shipInstructions.Residential_Delivery = 'Y';
    if (services.tailgateDelivery)    shipInstructions.Lifgate_Delivery = 'Y';
    if (services.appointmentDelivery) shipInstructions.Appointment_Delivery = 'Y';
    if (services.overSizeFreight)     shipInstructions.OverSizeFreight = 'Y';
    if (services.doNotStack)          shipInstructions.Do_Not_Stack = 'Y';
    if (services.inBond)              shipInstructions.In_Bond = 'Y';
    if (services.limitedAccessPickup) shipInstructions.Limited_Access_Pickup = 'Y';
    if (services.limitedAccessDelivery) shipInstructions.Limited_Access_Delivery = 'Y';

    // ── Map skid dimensions ────────────────────────────────────────────
    const skidDimensions: PolarisSkidDimension[] = packages.map((u: any, i: number) => ({
      Skid: i + 1,
      Length: u.length || 48,
      Width:  u.width  || 48,
      Height: u.height || 48,
    }));

    // Check total length ≤ 144 inches
    const totalLength = skidDimensions.reduce((sum: number, d: PolarisSkidDimension) => sum + d.Length, 0);
    if (totalLength > 144) {
      throw new BadRequestException(
        `Polaris max total length is 144 inches. Requested: ${totalLength}. Contact Polaris for a spot quote.`
      );
    }

    // ── Build payload ────────────────────────────────────────────────────
    const payload: PolarisRateRequest = {
      RATE_API: {
        From_PC_ZIP: fromZip,
        To_PC_ZIP: toZip,
        Total_Weight_lbs: Math.round(totalWeight),
        Number_of_Skids: totalSkids,
        ...(req.freightClass ? { Class: req.freightClass } : {}),
        ...(pickupDate ? { Pickup_Date: pickupDate } : {}),
        ...(totalPieces > 0 ? { Number_of_Pieces: totalPieces } : {}),
        ...(packages[0]?.description ? { Description: packages[0].description } : {}),
        ...(Object.keys(shipInstructions).length > 0 ? { ShipInstructions: shipInstructions } : {}),
        ...(skidDimensions.length > 0 ? { SkidDimensions: skidDimensions } : {}),
      },
    };

    return { __polarisPayload: payload };
  }

  async fetchRates(carrierPayload: unknown): Promise<unknown> {
    const { __polarisPayload: payload } = carrierPayload as {
      __polarisPayload: PolarisRateRequest;
    };

    console.log({baseAddress: `${this.credentials.baseUrl}/Rate`})
    const response = await fetch(`${this.credentials.baseUrl}/Rate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'APIKey': this.credentials.apiKey,
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    console.log({response})
    const rawJson = await response.text();
    console.dir(rawJson, { depth: null })
    if (!response.ok) {
      throw new BadRequestException(`Polaris rate quote failed: ${response.status} - ${rawJson}`);
    }

    const parsed: PolarisRateRawResponse = JSON.parse(rawJson);
    console.dir(parsed, { depth: null })
    return this.normalizeRateResponse(parsed);
  }

  parseResponse(carrierResponse: unknown): any[] {
    const response = carrierResponse as PolarisRateResponse;
    const rates: any[] = [];
    if (!response || response.error || response.totalCharge === 0) return rates;

    rates.push({
      carrierId: this.carrierName,
      serviceType: 'LTL',
      serviceName: 'Polaris Transport Cross-Border LTL',
      totalCharge: response.totalCharge,
      currency: response.currency,
      transitDays: this.calculateTransitDays(response.pickupDate, response.deliveryDate),
      quoteNumber: response.quoteNumber,
      breakdown: [
        { description: 'Base Charge', charge: response.baseCharge },
        { description: 'Fuel Charge', charge: response.fuelCharge },
        { description: 'Border Charge', charge: response.borderCharge },
        { description: 'Arbitrary Charges', charge: response.arbitraryChargeTotal },
        { description: 'Additional Services', charge: response.additionalServicesTotal },
      ].filter(b => b.charge > 0),
      raw: response.raw,
    });
    return rates;
  }

  async getRates(req: any): Promise<unknown> {
    const carrierPayload = this.buildRequest(req);
    const carrierResponse = await this.fetchRates(carrierPayload);
    return this.parseResponse(carrierResponse);
  }

  mapPolarisToCarrierRate(polarisResponse: PolarisRateResponse): any {
    const surcharges = [
      { code: 'FUEL', name: 'Fuel Charge', value: polarisResponse.fuelCharge, currency: polarisResponse.currency },
      { code: 'BORDER', name: 'Border Charge', value: polarisResponse.borderCharge, currency: polarisResponse.currency },
      { code: 'ARBITRARY', name: 'Arbitrary Charges', value: polarisResponse.arbitraryChargeTotal, currency: polarisResponse.currency },
      { code: 'ADDL_SVC', name: 'Additional Services', value: polarisResponse.additionalServicesTotal, currency: polarisResponse.currency },
    ].filter(s => s.value > 0);

    const fuelSurcharge = polarisResponse.fuelCharge;
    const totalSurcharges = polarisResponse.fuelCharge + polarisResponse.borderCharge + polarisResponse.arbitraryChargeTotal + polarisResponse.additionalServicesTotal;

    return {
      carrier: Carrier.POLARIS,
      serviceType: 'LTL',
      serviceName: 'Polaris Transport Cross-Border LTL',
      totalPrice: polarisResponse.totalCharge,
      currency: polarisResponse.currency,
      shipDate: polarisResponse.pickupDate ? new Date(polarisResponse.pickupDate) : null,
      estimatedDeliveryDays: this.calculateTransitDays(polarisResponse.pickupDate, polarisResponse.deliveryDate)
        ? `${this.calculateTransitDays(polarisResponse.pickupDate, polarisResponse.deliveryDate)} business days`
        : null,
      fuelSurcharge,
      totalSurcharges,
      surcharges,
      quoteNumber: polarisResponse.quoteNumber,
      transactionId: null,
      grossCharges: polarisResponse.baseCharge + totalSurcharges,
      afterDiscount: null,
      alerts: polarisResponse.message ? [polarisResponse.message] : null,
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private inferCountry(postalCode: string): 'US' | 'CA' | 'UNKNOWN' {
    const caPattern = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
    const usPattern = /^\d{5}(-\d{4})?$/;
    if (caPattern.test(postalCode)) return 'CA';
    if (usPattern.test(postalCode)) return 'US';
    return 'UNKNOWN';
  }

  private calculateTransitDays(pickupDateStr?: string, deliveryDateStr?: string): number | null {
    if (!pickupDateStr || !deliveryDateStr) return null;
    const pickup = new Date(pickupDateStr);
    const delivery = new Date(deliveryDateStr);
    const diffMs = delivery.getTime() - pickup.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : null;
  }

  private normalizeRateResponse(raw: PolarisRateRawResponse): PolarisRateResponse {
    if (!raw.Rate_API_Response) {
      throw new BadRequestException('Invalid Polaris response: missing Rate_API_Response');
    }

    const r = raw.Rate_API_Response;

    const additionalServices: { charge: string; chargeAmount: number }[] = [];
    if (r.Additional_Services) {
      const svc = r.Additional_Services;
      if (svc.Charge && svc.Charge_Amount) {
        additionalServices.push({
          charge: svc.Charge,
          chargeAmount: parseFloat(svc.Charge_Amount) || 0,
        });
      }
    }

    return {
      quoteNumber: r.Bill_Number || '',
      customerName: r.Customer_Name || '',
      fromZip: r.From_PC_ZIP || '',
      toZip: r.To_PC_ZIP || '',
      totalWeight: parseInt(r.Total_Weight_lbs || '0', 10),
      pallets: parseInt(r.Pallets || '0', 10),
      pickupDate: r.Pickup_Date || '',
      deliveryDate: r.Delivery_Date || '',
      currency: r.Currency || 'USD',
      baseCharge: parseFloat(r.Base_Charge || '0') || 0,
      fuelCharge: parseFloat(r.Fuel_Charge || '0') || 0,
      fuelChargePercentage: parseFloat(r.Fuel_Charge_Percentage || '0') || 0,
      borderCharge: parseFloat(r.Border_Charge || '0') || 0,
      arbitraryChargeTotal: parseFloat(r.Arbitrary_Charge_Total || '0') || 0,
      additionalServicesTotal: parseFloat(r.Additional_Services_Total || '0') || 0,
      additionalServices,
      totalCharge: parseFloat(r.Total_Charge || '0') || 0,
      terms: r.Terms || '',
      message: r.Message || null,
      error: (r.Error || 'N').toUpperCase() === 'Y',
      raw,
    };
  }
}