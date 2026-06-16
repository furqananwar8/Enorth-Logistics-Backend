import { CarrierAdapter } from 'src/types/shipment-carriers';
import { BadRequestException } from '@nestjs/common';
import { Carrier } from '../dto/create-carrier-shipment.dto';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface MinimaxCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

export interface MinimaxRateQuoteParams {
  vozip: string;
  vdzip: string;
  shipdate?: string;
  codamt?: number;
  declval?: number;
  vbterms?: 'P' | 'C';
  quotenumber?: 'yes';
  accessorials?: string;
  lines: MinimaxFreightLine[];
}

export interface MinimaxFreightLine {
  lineNumber: number;
  pieces: number;
  pallets: number;
  weight: number;
  length?: number;
  width?: number;
  height?: number;
  freightClass?: string;
}

export interface MinimaxRateQuoteRawResponse {
  ratequote?: {
    ratequoteline?: MinimaxRateQuoteLineRaw[] | MinimaxRateQuoteLineRaw;
    servicetype?: string;
    quotetotal?: string;
    totalpallets?: string;
    totalpieces?: string;
    totalweight?: string;
    busdays?: string;
    shipfromzip?: string;
    shiptozip?: string;
    shipdate?: string;
    shipdateiso?: string;
    expecteddeliverydate?: string;
    expecteddeliverydateiso?: string;
    quoteversion?: string;
    quotedatetime?: string;
  };
}

export interface MinimaxRateQuoteLineRaw {
  lineno?: string;
  pallets?: string;
  palletpositions?: string;
  chargecode?: string;
  pieces?: string;
  chargedesc?: string;
  weight?: string;
  dimweight?: string;
  class?: string;
  rate?: string;
  charge?: string;
  chrg?: string;  // Minimax uses <chrg> not <charge>
}

export interface MinimaxRateQuoteResponse {
  quoteNumber?: string;
  total: number;
  transitDays: number;
  currency: 'CAD' | 'USD';
  serviceType: string;
  lines: MinimaxRateQuoteLine[];
  breakdown: MinimaxChargeBreakdown[];
  raw: MinimaxRateQuoteRawResponse;
}

export interface MinimaxRateQuoteLine {
  lineNumber: number;
  pallets: number;
  pieces: number;
  weight: number;
  dimWeight: number;
  freightClass: string;
  rate: number;
  charge: number;
}

export interface MinimaxChargeBreakdown {
  description: string;
  charge: number;
}

// ============================================================================
// ADAPTER
// ============================================================================

export class MinimaxAdapter implements CarrierAdapter {
  readonly carrierName = 'minimax';

  private readonly credentials: MinimaxCredentials;

  constructor(params: {
    baseUrl: string;
    username: string;
    password: string;
  }) {
    this.credentials = {
      baseUrl: params.baseUrl.replace(/\/$/, ''),
      username: params.username,
      password: params.password,
    };
  }

  // --------------------------------------------------------------------------
  // CARRIER ADAPTER INTERFACE
  // --------------------------------------------------------------------------
  
  buildRequest(req: any): unknown {
    const fromZip = req.from?.postalCode || req.from?.postalCd || '';
    const toZip   = req.to?.postalCode   || req.to?.postalCd   || '';
      
    if (!fromZip || !toZip) {
        throw new BadRequestException('Minimax rate quote requires origin and destination postal codes');
    }
        
    const accessorialMap: Record<string, string> = {
        'residentialDelivery': 'RESDEL',
        'protectFromFreeze': 'PFFF',  // if Minimax supports it
        'tailgate': 'TLGD',
    };
    
    const accessorials = Object.entries(req.services || {})
        .filter(([_, v]) => v === true)
        .map(([k]) => accessorialMap[k])
        .filter(Boolean)
        .join(',');

    // Format ship date as MM/DD/YYYY
    let shipdate: string | undefined;
    if (req.shipDate) {
      const d = new Date(req.shipDate);
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day   = String(d.getDate()).padStart(2, '0');
      const year  = d.getFullYear();
      shipdate = `${month}/${day}/${year}`;
    }

    // Map line items from packages/pallets
    const units = req.pallets || req.packages || [];
    const lines: MinimaxFreightLine[] = units.map((unit: any, index: number) => ({
      lineNumber: index + 1,
      pieces:  unit.handlingUnits || unit.pieces || unit.unitsOnPallet || 1,
      pallets: unit.pallets || unit.handlingUnits || 1,
      weight:  Math.round(unit.weight || 0),
      length:  unit.length || undefined,
      width:   unit.width  || undefined,
      height:  unit.height || undefined,
      freightClass: unit.freightClass || '100',
    }));

    if (lines.length === 0) {
      throw new BadRequestException('Minimax rate quote requires at least one freight line');
    }

    // Only include fields we actually have data for
    const params: MinimaxRateQuoteParams = {
      vozip: fromZip,
      vdzip: toZip,
      lines,
      // Optional — only if present
      ...(shipdate ? { shipdate } : {}),
      ...(accessorials ? { accessorials } : {}),
      // vbterms: always prepaid (P) since ULS is the broker arranging shipment
      vbterms: 'P',
    };

    return { __minimaxParams: params };
}

  async fetchRates(carrierPayload: unknown): Promise<unknown> {
    const { __minimaxParams: params } = carrierPayload as {
      __minimaxParams: MinimaxRateQuoteParams;
    };

    const url = this.buildRateQuoteUrl(params);

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/xml' },
    });

    const rawXml = await response.text();

    if (!response.ok) {
      throw new BadRequestException(
        `Minimax rate quote failed: ${response.status} - ${rawXml}`,
      );
    }

    const parsed = this.parseXml(rawXml);
    return this.normalizeRateQuoteResponse(parsed);
  }

  parseResponse(carrierResponse: unknown): any[] {
    const response = carrierResponse as MinimaxRateQuoteResponse;
    const rates: any[] = [];

    if (!response || response.total === 0) {
      return rates;
    }

    rates.push({
      carrierId: this.carrierName,
      serviceType: response.serviceType || 'LTL',
      serviceName: 'Minimax Express LTL',
      totalCharge: response.total,
      currency: response.currency,
      transitDays: response.transitDays,
      quoteNumber: response.quoteNumber,
      breakdown: response.breakdown,
      raw: response.raw,
    });

    return rates;
  }

  async getRates(req: any): Promise<unknown> {
    const carrierPayload = this.buildRequest(req);
    const carrierResponse = await this.fetchRates(carrierPayload);
    return this.parseResponse(carrierResponse);
  }

  mapMinimaxToCarrierRate(minimaxResponse: MinimaxRateQuoteResponse): any {
    // Calculate gross charges from lines that have actual charges
    const grossCharges = minimaxResponse.lines.reduce((sum, l) => sum + l.charge, 0);

    // Build surcharges from breakdown lines
    const surcharges = minimaxResponse.breakdown.map((b) => ({
      code: null,
      name: b.description,
      value: b.charge,
      currency: minimaxResponse.currency,
    }));

    // Fuel surcharge from breakdown
    const fuelSurcharge = minimaxResponse.breakdown.find(
      (b) => b.description.toLowerCase().includes('fuel')
    )?.charge || 0;

    // Total surcharges = breakdown charges
    const totalSurcharges = minimaxResponse.breakdown.reduce(
      (sum, b) => sum + b.charge, 0
    );

    return {
      carrier: Carrier.MINIMAX,
      serviceType: minimaxResponse.serviceType || 'LTL',
      serviceName: 'Minimax Express LTL',
      totalPrice: minimaxResponse.total,
      currency: minimaxResponse.currency,
      shipDate: null,
      estimatedDeliveryDays: minimaxResponse.transitDays
        ? `${minimaxResponse.transitDays} business day${minimaxResponse.transitDays === 1 ? '' : 's'}`
        : null,
      fuelSurcharge,
      totalSurcharges,
      surcharges,
      quoteNumber: minimaxResponse.quoteNumber,
      transactionId: null,
      grossCharges,
      afterDiscount: null,
      alerts: null,
    };
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private buildRateQuoteUrl(params: MinimaxRateQuoteParams): string {
    const url = new URL(this.credentials.baseUrl + '/ratequote.xml');
    const search = url.searchParams;

    search.set('xmlv', 'yes');
    search.set('xmluser', this.credentials.username);
    search.set('xmlpass', this.credentials.password);
    search.set('vozip', params.vozip);
    search.set('vdzip', params.vdzip);

    if (params.shipdate) search.set('shipdate', params.shipdate);
    if (params.codamt !== undefined) search.set('codamt', String(params.codamt));
    if (params.declval !== undefined) search.set('declval', String(params.declval));
    if (params.vbterms) search.set('vbterms', params.vbterms);
    if (params.quotenumber) search.set('quotenumber', params.quotenumber);
    if (params.accessorials) search.set('accessorials', params.accessorials);

    for (const line of params.lines) {
      const n = line.lineNumber;
      search.set(`wpieces[${n}]`, String(line.pieces));
      search.set(`wpallets[${n}]`, String(line.pallets));
      search.set(`wweight[${n}]`, String(line.weight));
      if (line.freightClass) search.set(`vclass[${n}]`, line.freightClass);
      if (line.length) search.set(`wlength[${n}]`, String(line.length));
      if (line.width) search.set(`wwidth[${n}]`, String(line.width));
      if (line.height) search.set(`wheight[${n}]`, String(line.height));
    }

    return url.toString();
  }

  /**
   * Lightweight XML parser — no external dependency needed.
   */
  private parseXml(xml: string): MinimaxRateQuoteRawResponse {
    const getTag = (tag: string, text: string): string | null => {
      const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 's');
      const match = text.match(regex);
      return match ? match[1].trim() : null;
    };

    const getAllTags = (tag: string, text: string): string[] => {
      const regex = new RegExp(`<${tag}>.*?</${tag}>`, 'gs');
      return text.match(regex) || [];
    };

    const ratequoteXml = getTag('ratequote', xml);
    if (!ratequoteXml) return {};

    const lineXmls = getAllTags('ratequoteline', ratequoteXml);
    const lines = lineXmls.map((lineXml) => ({
      lineno: getTag('lineno', lineXml),
      pallets: getTag('pallets', lineXml),
      palletpositions: getTag('palletpositions', lineXml),
      chargecode: getTag('chargecode', lineXml),
      pieces: getTag('pieces', lineXml),
      chargedesc: getTag('chargedesc', lineXml),
      weight: getTag('weight', lineXml),
      dimweight: getTag('dimweight', lineXml),
      class: getTag('class', lineXml),
      rate: getTag('rate', lineXml),
      charge: getTag('charge', lineXml),
      chrg: getTag('chrg', lineXml),  // Minimax uses <chrg> not <charge>
    })) as any;

    return {
      ratequote: {
        ratequoteline: lines.length === 1 ? lines[0] : lines,
        servicetype: getTag('servicetype', ratequoteXml) || undefined,
        quotetotal: getTag('quotetotal', ratequoteXml) || undefined,
        totalpallets: getTag('totalpallets', ratequoteXml) || undefined,
        totalpieces: getTag('totalpieces', ratequoteXml) || undefined,
        totalweight: getTag('totalweight', ratequoteXml) || undefined,
        busdays: getTag('busdays', ratequoteXml) || undefined,
        shipfromzip: getTag('shipfromzip', ratequoteXml) || undefined,
        shiptozip: getTag('shiptozip', ratequoteXml) || undefined,
        shipdate: getTag('shipdate', ratequoteXml) || undefined,
        shipdateiso: getTag('shipdateiso', ratequoteXml) || undefined,
        expecteddeliverydate: getTag('expecteddeliverydate', ratequoteXml) || undefined,
        expecteddeliverydateiso: getTag('expecteddeliverydateiso', ratequoteXml) || undefined,
        quoteversion: getTag('quoteversion', ratequoteXml) || undefined,
        quotedatetime: getTag('quotedatetime', ratequoteXml) || undefined,
      },
    };
  }

  private normalizeRateQuoteResponse(
    raw: MinimaxRateQuoteRawResponse,
  ): MinimaxRateQuoteResponse {
    if (!raw.ratequote) {
      throw new BadRequestException('Invalid Minimax response: missing ratequote root');
    }

    const rq = raw.ratequote;
    const linesRaw = Array.isArray(rq.ratequoteline)
      ? rq.ratequoteline
      : rq.ratequoteline
      ? [rq.ratequoteline]
      : [];

    const itemLines: MinimaxRateQuoteLine[] = [];
    const breakdown: MinimaxChargeBreakdown[] = [];

    for (const line of linesRaw) {
      const desc = line.chargedesc?.trim() || '';
      // Minimax uses <chrg> for charge, not <charge>. Fallback to charge if present.
      const chargeValue = line.chrg || line.charge || '0';
      const charge = this.parseCurrency(chargeValue);
      const rate = this.parseCurrency(line.rate || '0');

      // A freight line has pallets/pieces/weight and a charge description of "FREIGHT"
      // OR it has a charge value (chrg tag)
      const hasFreightData = line.pallets && line.pieces && line.weight;
      const isFreightLine = desc.toUpperCase() === 'FREIGHT' || (hasFreightData && charge > 0);

      if (isFreightLine && hasFreightData) {
        itemLines.push({
          lineNumber: parseInt(line.lineno || '0', 10),
          pallets: parseInt(line.pallets || '0', 10),
          pieces: parseInt(line.pieces || '0', 10),
          weight: parseInt(line.weight || '0', 10),
          dimWeight: parseInt(line.dimweight || '0', 10),
          freightClass: line.class?.trim() || '',
          rate,
          charge,
        });
      } else if (desc && !desc.toUpperCase().startsWith('RATED AT') && !desc.toUpperCase().startsWith('BOL DIM WGT')) {
        // Descriptive lines (dim weight breakdowns) go to breakdown if they have a charge
        // Or just skip them if they're info-only
        if (charge > 0) {
          breakdown.push({ description: desc, charge });
        }
      }
    }

    return {
      quoteNumber: undefined,
      total: this.parseCurrency(rq.quotetotal || '0'),
      transitDays: parseInt(rq.busdays || '0', 10),
      currency: 'CAD',
      serviceType: rq.servicetype || 'LTL',
      lines: itemLines,
      breakdown,
      raw,
    };
  }

  private parseCurrency(value: string): number {
    return parseFloat(value.replace(/,/g, '').replace(/\s+/g, '')) || 0;
  }
}