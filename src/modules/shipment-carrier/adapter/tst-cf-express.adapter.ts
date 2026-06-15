import { TSTCFRateRequest, TSTCFRateResponse } from "src/types/tst-cf-express";
import { TSTCFExpressMapper } from "src/modules/shipment-carrier/mapper/tst-cf-express.mapper";
import { BadRequestException } from '@nestjs/common';
import { Builder } from 'xml2js';
import { parseStringPromise } from 'xml2js';
import { CarrierAdapter } from "src/types/shipment-carriers";
import { Carrier } from "../dto/create-carrier-shipment.dto";

export class TSTCFExpressAdapter implements CarrierAdapter {
  readonly carrierName = 'tst-cf-express';
  private readonly baseUrl: string;
  private readonly mapper: TSTCFExpressMapper;

  constructor(params?: {
    baseUrl?: string;
    useMock?: boolean;
  }) {
    this.baseUrl = process.env.TST_CF_BASE_URL as string;
    this.mapper = new TSTCFExpressMapper();
  }

  async getRates(req: any){
    const carrierPayload = this.buildRequest(req);
    const carrierResponse = await this.fetchRates(carrierPayload);
    return this.parseResponse(carrierResponse);
  }

  buildRequest(req: any): TSTCFRateRequest {
    return this.mapper.map(req);
  }

  async fetchRates(carrierPayload: unknown): Promise<unknown> {
    const payload = carrierPayload as TSTCFRateRequest;

    const builder = new Builder({
      xmldec: { version: '1.0', encoding: 'ISO-8859-1' },
      renderOpts: { pretty: false },
      headless: false,
    });

    const xmlPayload = builder.buildObject({ raterequest: payload });

    const response = await fetch(`${this.baseUrl}/xml/rate-quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body: xmlPayload,
    });

    if (!response.ok) {
      throw new BadRequestException(`TST CF Express API error: ${response.status}`);
    }

    const xmlText = await response.text();
    const parsed = await parseStringPromise(xmlText, { explicitArray: false });

    if (parsed.rqresults?.errorcode) {
      throw new BadRequestException({
        carrier: this.carrierName,
        code: parsed.rqresults.errorcode,
        message: parsed.rqresults.errormsg,
      });
    }

    return parsed.rqresults as TSTCFRateResponse;
  }

  private readonly TST_SURCHARGE_MAP: Record<string, string> = {
    SCHOLP: 'School Pickup',
    TGPU: 'Liftgate at Pickup',
    TGDL: 'Liftgate at Delivery',
    HCOSTP: 'High Cost Delivery/Pickup Charge',
    HCOSTD: 'High Cost Delivery Charge',
    BPSC: 'Border Processing Service Charge',
    FS: 'Fuel Surcharge',
    FSC: 'Fuel Surcharge',
    FUEL: 'Fuel Surcharge',
    SC: 'Currency Exchange',
    RESPU: 'Residential Pickup',
    RESDL: 'Residential Delivery',
    RES: 'Residential Delivery',
    REP: 'Residential Pickup',
    LIFT: 'Liftgate Service',
    LIFTG: 'Liftgate Service',
    INSIDE: 'Inside Delivery',
    APPT: 'Appointment / Notify Delivery',
  };

  parseResponse(carrierResponse: unknown): any {
    // Defensive unwrap — handle if parser wraps the payload
    const raw = carrierResponse as any;
    const tstResponse = raw?.quote ?? raw?.rateResponse ?? raw;

    const totalCAD = parseFloat(tstResponse?.totalamt ?? tstResponse?.TotalAmt) || 0;
    const exchangeRate = 0.73;
    const totalUSD = totalCAD ? +(totalCAD * exchangeRate).toFixed(2) : 0;

    const shipDate = tstResponse?.transitresults?.shipdate ?? tstResponse?.ShipDate;
    const arrivalDate = tstResponse?.transitresults?.arrivaldate ?? tstResponse?.ArrivalDate;
    const totalDiscount = parseFloat(tstResponse?.discountamt ?? tstResponse?.DiscountAmt) || 0;
    const billingWeight = tstResponse?.totalweight ?? tstResponse?.TotalWeight;
    const transactionId = tstResponse?.quoteid ?? tstResponse?.QuoteId;
    const grossCharges = parseFloat(tstResponse?.freightamt ?? tstResponse?.FreightAmt) || 0;

    // Normalize accitems — handle both { item: [...] } and direct array
    let accItems = tstResponse?.accitems?.item ?? tstResponse?.AccItems?.Item ?? tstResponse?.accitems ?? [];
    if (!Array.isArray(accItems)) accItems = accItems ? [accItems] : [];

    const chargedItems = accItems.filter((item: any) => 
      (item?.itemstatus ?? item?.ItemStatus) === 'OK'
    );

    const surcharges = chargedItems.map((item: any) => {
      const code = (item?.itemcode ?? item?.ItemCode ?? '').toString();
      const rawDesc = (item?.itemdesc ?? item?.ItemDesc ?? '').toString();
      const amount = parseFloat(item?.itemamount ?? item?.ItemAmount) || 0;
      const isFuel = /fuel/i.test(code) || /fuel/i.test(rawDesc);

      return {
        code,
        name: this.TST_SURCHARGE_MAP[code] || (isFuel ? 'Fuel Surcharge' : 'Freight charge'),
        rawDescription: rawDesc,
        value: amount,
        currency: 'CAD',
      };
    });

    const totalSurcharges = Math.round(surcharges.reduce((sum, s) => sum + s.value, 0) * 100) / 100;
    
    const fuelSurcharge = surcharges.find((s) => /fuel/i.test(s.code) || /fuel/i.test(s.rawDescription || ''))?.value || 0;

    const afterDiscount = Math.round((grossCharges - totalDiscount) * 100) / 100;

    return {
      carrier: Carrier.TST,
      serviceType: 'ST',
      serviceName: 'TST-CF Express LTL',
      totalPrice: totalUSD,
      totalPriceCAD: totalCAD,
      currency: 'USD',
      originalCurrency: 'CAD',
      shipDate,
      arrivalDate,
      estimatedDeliveryDays: tstResponse?.transitresults?.servicedays 
        ? `${parseInt(tstResponse.transitresults.servicedays)} business days` 
        : undefined,
      billingWeight,
      transactionId,
      totalDiscount,
      grossCharges,
      afterDiscount,
      fuelSurcharge,
      totalSurcharges,
      surcharges,
    };
  }

  // // ============================================================================
  // // NEW: CREATE CARRIER QUOTE (Pattern B — required for TST)
  // // ============================================================================

  // async createQuote(quote: any, selectedRate: any): Promise<{ quoteId: string; expiresAt: Date }> {
  //   const payload = this.mapper.mapQuote(quote, selectedRate);

  //   const builder = new Builder({
  //     xmldec: { version: '1.0', encoding: 'ISO-8859-1' },
  //     renderOpts: { pretty: false },
  //     headless: false,
  //   });

  //   const xmlPayload = builder.buildObject({ quote: payload });

  //   const response = await fetch(`${this.baseUrl}/xml/quote`, {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/xml',
  //     },
  //     body: xmlPayload,
  //   });
  //   if (!response.ok) {
  //     throw new BadRequestException(`TST CF Express quote API error: ${response.status}`);
  //   }

  //   const xmlText = await response.text();
  //   const parsed = await parseStringPromise(xmlText, { explicitArray: false });

  //   if (parsed.quoteresults?.errorcode) {
  //     throw new BadRequestException({
  //       carrier: this.carrierName,
  //       code: parsed.quoteresults.errorcode,
  //       message: parsed.quoteresults.errormsg,
  //     });
  //   }

  //   const quoteId = parsed.quoteresults?.quoteid;
  //   if (!quoteId) {
  //     throw new BadRequestException('TST CF Express quote response missing quoteid');
  //   }

  //   // TST quotes typically valid for 24 hours
  //   const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  //   return { quoteId, expiresAt };
  // }

  // ============================================================================
  // NEW: CREATE SHIPMENT / PICKUP (Pattern B — uses quoteId)
  // ============================================================================

  async createShipment(quote: any, selectedRate: any): Promise<any> {
    try {
      const payload = this.mapper.mapShipment(quote, selectedRate);
      const builder = new Builder({
        xmldec: { version: '1.0', encoding: 'ISO-8859-1' },
        renderOpts: { pretty: false },
        headless: false,
      });

      const xmlPayload = builder.buildObject({ bolpickuprequest: payload });

      // FIX: removed trailing space
      const response = await fetch(`${this.baseUrl}/xml/bol-pickup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: xmlPayload,
      });


      const responseText = await response.text();

      if (!response.ok) {
        throw new BadRequestException(
          `TST CF Express BOL API error: ${response.status} — ${responseText}`
        );
      }

      const parsed = await parseStringPromise(responseText, { explicitArray: false });

      // FIX: include bolpuresults (the actual root element from TST XML)
      const results = parsed.bolpuresults || parsed.bolpickupresults || parsed.bolresults || parsed.pickupresults;

      if (results?.errorcode) {
        throw new BadRequestException({
          carrier: this.carrierName,
          code: results.errorcode,
          message: results.errormsg,
        });
      }

      return results;

    } catch (err: any) {
      console.error('>>> TST fetch threw:', err.message);
      throw err;
    }
  }
}