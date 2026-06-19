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

// ── Rate Quote ──────────────────────────────────────

export interface MinimaxRateQuoteParams {
  vozip: string;
  vdzip: string;
  shipdate?: string;
  vbterms?: 'P' | 'C';
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
  chrg?: string;
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

// ── BOL Creation ────────────────────────────────────

export interface MinimaxBOLPayload {
  shipname: string;
  shipaddr: string;
  shipcity: string;
  shipst: string;
  shipzip: string;
  shipphone: string;
  shipcont: string;
  shipemail?: string;
  consname: string;
  consaddr: string;
  conscity: string;
  consst: string;
  conszip: string;
  conscont: string;
  consphone: string;
  consemail?: string;
  pieces1: number;
  pallets1?: number;
  weight1: number;
  length1?: number;
  width1?: number;
  height1?: number;
  descr1: string;
  class1?: string;
  pucontact: string;
  puphone: string;
  puemail?: string;
  putime: string;
  closetime: string;
  punotes?: string;
  spcinstr?: string;
  accessoriallist?: string;
  pono?: string;
  bolno?: string;
  billref?: string;
  declval?: number;
  codamt?: number;
  nopickup?: 'Yes' | 'No';
}

export interface MinimaxBOLRawResponse {
  response?: {
    responsetype?: string;
    success?: string;
    errors?: { errormessage?: string | string[] };
    bol?: {
      pronumber?: string;
      trackingnumber?: string;
      referencenumber?: string;
      shippername?: string;
      shipperaddress?: string;
      shippercity?: string;
      shipperstate?: string;
      shipperzip?: string;
      consigneename?: string;
      consigneeaddress?: string;
      consigneecity?: string;
      consigneestate?: string;
      consigneezip?: string;
      debtor?: string;
      pono?: string;
      servicetypecode?: string;
      servicetypedesc?: string;
      bolline?: MinimaxBOLLineRaw[] | MinimaxBOLLineRaw;
      bollink?: string;
      labellink?: string;
      quotetotal?: string;
      quotenumber?: string;
      quoteversion?: string;
      quotedatetime?: string;
    };
  };
}

export interface MinimaxBOLLineRaw {
  lineno?: string;
  pieces?: string;
  weight?: string;
  class?: string;
  description?: string;
  keyword?: string;
}

export interface MinimaxBOLResponse {
  success: boolean;
  proNumber: string;
  trackingNumber: string;
  referenceNumber?: string;
  bolLink?: string;
  labelLink?: string;
  quoteTotal?: number;
  quoteNumber?: string;
  serviceType: string;
  shipper: { name: string; address: string; city: string; state: string; zip: string };
  consignee: { name: string; address: string; city: string; state: string; zip: string };
  lines: { lineNumber: number; pieces: number; weight: number; freightClass: string; description: string }[];
  raw: MinimaxBOLRawResponse;
}

// ── Tracking ────────────────────────────────────────

export interface MinimaxTrackingRawResponse {
  protracexml?: {
    pro?: string;
    bolno?: string;
    shipdate?: string;
    shipper?: string;
    consignee?: string;
    status?: string;
    statusdesc?: string;
    statusdate?: string;
    statuscity?: string;
    statusstate?: string;
    deliverydate?: string;
    deliverytime?: string;
    signedby?: string;
    event?: MinimaxTrackingEventRaw[] | MinimaxTrackingEventRaw;
  };
}

export interface MinimaxTrackingEventRaw {
  eventdate?: string;
  eventtime?: string;
  eventcity?: string;
  eventstate?: string;
  eventdesc?: string;
}

export interface MinimaxTrackingResponse {
  proNumber: string;
  bolNumber?: string;
  shipDate?: string;
  shipper?: string;
  consignee?: string;
  status: string;
  statusDescription: string;
  statusDate?: string;
  statusCity?: string;
  statusState?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  signedBy?: string;
  events: { date: string; time: string; city: string; state: string; description: string }[];
  raw: MinimaxTrackingRawResponse;
}

// ============================================================================
// ADAPTER
// ============================================================================

export class MinimaxAdapter implements CarrierAdapter {
  readonly carrierName = 'MINIMAX';

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
  // RATE QUOTE
  // --------------------------------------------------------------------------

  buildRequest(req: any): unknown {
    const fromZip = req.from?.postalCode || req.from?.postalCd || '';
    const toZip   = req.to?.postalCode   || req.to?.postalCd   || '';

    if (!fromZip || !toZip) {
      throw new BadRequestException('Minimax rate quote requires origin and destination postal codes');
    }

    // Map services flags to Minimax accessorial codes
    const accessorialMap: Record<string, string> = {
      residentialPickup: 'PHP',
      residentialDelivery: 'PHD',
      protectFromFreeze: 'HTG',
      tailgatePickup: 'TLGP',
      tailgateDelivery: 'TLGD',
    };

    const accessorials = Object.entries(req.services || {})
      .filter(([_, v]) => v === true)
      .map(([k]) => accessorialMap[k])
      .filter(Boolean)
      .join(',');

    let shipdate: string | undefined;
    if (req.shipDate) {
      const d = new Date(req.shipDate);
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day   = String(d.getDate()).padStart(2, '0');
      const year  = d.getFullYear();
      shipdate = `${month}/${day}/${year}`;
    }

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

    const params: MinimaxRateQuoteParams = {
      vozip: fromZip,
      vdzip: toZip,
      lines,
      ...(shipdate ? { shipdate } : {}),
      // ...(accessorials ? { accessorials } : {}),
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
    console.log("Minimax data")
    console.log({rawXml})
    if (!response.ok) {
      throw new BadRequestException(`Minimax rate quote failed: ${response.status} - ${rawXml}`);
    }

    const parsed = this.parseXml(rawXml) as MinimaxRateQuoteRawResponse;
    console.dir(parsed, { depth: null })
    return this.normalizeRateQuoteResponse(parsed);
  }

  parseResponse(carrierResponse: unknown): any[] {
    const response = carrierResponse as MinimaxRateQuoteResponse;
    const rates: any[] = [];
    if (!response || response.total === 0) return rates;

    rates.push({
      carrierId: Carrier.MINIMAX,
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
    const grossCharges = minimaxResponse.lines.reduce((sum, l) => sum + l.charge, 0);
    const surcharges = minimaxResponse.breakdown.map((b) => ({
      code: null,
      name: b.description,
      value: b.charge,
      currency: minimaxResponse.currency,
    }));
    const fuelSurcharge = minimaxResponse.breakdown.find(
      (b) => b.description.toLowerCase().includes('fuel')
    )?.charge || 0;
    const totalSurcharges = minimaxResponse.breakdown.reduce((sum, b) => sum + b.charge, 0);

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
      // These fields are not returned by rate quote API — populated from user input at BOL time
      pono: null,
      bolno: null,
      billref: null,
      declaredValue: null,
    };
  }

  // --------------------------------------------------------------------------
  // BOL + PICKUP CREATION (single call)
  // --------------------------------------------------------------------------

  async createShipment(dto: {
    shipDate: Date;
    fromAddress: any;
    toAddress: any;
    lineItems: any[];
    quoteReference?: string;
    accessorials?: string;
    pucontact?: string;
    puphone?: string;
    puemail?: string;
    putime?: string;
    closetime?: string;
    punotes?: string;
    spcinstr?: string;
    pono?: string;
    bolno?: string;
    billref?: string;
    declval?: number;
    codamt?: number;
    nopickup?: boolean;
    services?: Record<string, boolean>;
  }): Promise<MinimaxBOLResponse> {
    const payload = this.buildBOLPayload(dto);
    const url = `${this.credentials.baseUrl}/tbolentry4.xml`;
    
    const formData = new URLSearchParams();
    formData.set('xmlv', 'yes');
    formData.set('xmluser', this.credentials.username);
    formData.set('xmlpass', this.credentials.password);
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) {
        formData.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const rawXml = await response.text();
    if (!response.ok) {
      throw new BadRequestException(`Minimax BOL creation failed: ${response.status} - ${rawXml}`);
    }

    const parsed = this.parseXml(rawXml) as MinimaxBOLRawResponse;
  
    return this.normalizeBOLResponse(parsed);
  }

  // --------------------------------------------------------------------------
  // TRACKING
  // --------------------------------------------------------------------------

  async getStatusAndEvents(proNumber: string): Promise<{ statusCd: string; events: any[] }> {
    if (!proNumber?.trim()) {
      throw new BadRequestException('Pro number is required for tracking');
    }

    const url = new URL(`${this.credentials.baseUrl}/protracexml.htm`);
    url.searchParams.set('xmluser', this.credentials.username);
    url.searchParams.set('xmlpass', this.credentials.password);
    url.searchParams.set('pronum', proNumber);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/xml' },
    });

    const rawXml = await response.text();

    if (!response.ok) {
      throw new BadRequestException(`Minimax tracking failed: ${response.status} - ${rawXml}`);
    }
    console.dir(rawXml, { depth: null })
    let parsed: any;
    try {
      parsed = this.parseXml(rawXml);
    } catch (err: any) {
      throw new BadRequestException(`Failed to parse Minimax tracking XML: ${err.message}`);
    }

    // FIX: Use 'protrace' as the root element (not 'protracexml')
    const root = parsed?.protrace;
    
    if (!root) {
      const availableRoots = Object.keys(parsed || {}).join(', ');
      throw new BadRequestException(
        `Invalid Minimax tracking response: missing 'protrace' root. Available roots: ${availableRoots}`
      );
    }
    console.dir(root, { depth: null })
    const normalized = this.normalizeTrackingResponse(root);
    console.dir(normalized, { depth: null })
    return {
      statusCd: normalized.status,
      events: normalized.events,
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
    if (params.vbterms) search.set('vbterms', params.vbterms);
    // if (params.accessorials) search.set('accessorials', params.accessorials);

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

  private buildBOLPayload(dto: any): Record<string, string> {
    const fromAddr = dto.fromAddress;
    const toAddr = dto.toAddress;
    const item = dto.lineItems?.[0] || {};

    const formatTime = (time?: string): string => {
      if (!time) return '0800';
      const cleaned = time.replace(/\s*(AM|PM)/i, '').trim();
      const parts = cleaned.split(':');
      if (parts.length >= 2) {
        return `${parts[0].padStart(2, '0')}${parts[1].padStart(2, '0')}`;
      }
      return cleaned.replace(/:/g, '').padStart(4, '0').slice(0, 4);
    };

    // Map service flags to Minimax accessorial codes
    const accessorialMap: Record<string, string> = {
      residentialPickup: 'PHP',
      residentialDelivery: 'PHD',
      protectFromFreeze: 'HTG',
      tailgatePickup: 'TLGP',
      tailgateDelivery: 'TLGD',
    };

    // Build accessorial list from dto.services or dto.accessorials
    // let accessoriallist = '';
    // if (dto.services) {
    //   const codes = Object.entries(dto.services)
    //     .filter(([_, v]) => v === true)
    //     .map(([k]) => accessorialMap[k])
    //     .filter(Boolean);
    //   accessoriallist = codes.join(',');
    // } else if (dto.accessorials) {
    //   // If accessorials is already a comma-separated string, pass through
    //   // (but ideally you should map them too)
    //   accessoriallist = dto.accessorials;
    // }

    const payload: Record<string, string> = {
      shipname: fromAddr?.companyName || fromAddr?.name || 'Shipper',
      shipaddr: fromAddr?.address?.address1 || fromAddr?.address || '',
      shipcity: fromAddr?.address?.city || fromAddr?.city || '',
      shipst: fromAddr?.address?.state || fromAddr?.state || '',
      shipzip: fromAddr?.address?.postalCode || fromAddr?.postalCode || '',
      shipphone: (fromAddr?.phoneNumber || '8005551212').replace(/\D/g, '').slice(0, 15),
      shipcont: fromAddr?.contactName || fromAddr?.name || 'Contact',
      ...(fromAddr?.email ? { shipemail: fromAddr.email } : {}),

      consname: toAddr?.companyName || toAddr?.name || 'Consignee',
      consaddr: toAddr?.address?.address1 || toAddr?.address || '',
      conscity: toAddr?.address?.city || toAddr?.city || '',
      consst: toAddr?.address?.state || toAddr?.state || '',
      conszip: toAddr?.address?.postalCode || toAddr?.postalCode || '',
      conscont: toAddr?.contactName || toAddr?.name || 'Contact',
      consphone: (toAddr?.phoneNumber || '8005551212').replace(/\D/g, '').slice(0, 15),
      ...(toAddr?.email ? { consemail: toAddr.email } : {}),

      pieces1: String(item.units || item.handlingUnits || item.pieces || 1),
      pallets1: String(item.pallets || item.units || 1),
      weight1: String(Math.round(item.weight || 0)),
      descr1: item.description || 'Freight',
      ...(item.freightClass ? { class1: item.freightClass } : {}),
      ...(item.length ? { length1: String(item.length) } : {}),
      ...(item.width ? { width1: String(item.width) } : {}),
      ...(item.height ? { height1: String(item.height) } : {}),

      pucontact: dto.pucontact || fromAddr?.contactName || fromAddr?.name || 'Pickup Contact',
      puphone: (dto.puphone || fromAddr?.phoneNumber || '8005551212').replace(/\D/g, '').slice(0, 15),
      ...(dto.puemail ? { puemail: dto.puemail } : {}),
      putime: formatTime(dto.putime || fromAddr?.palletShippingReadyTime),
      closetime: formatTime(dto.closetime || fromAddr?.palletShippingCloseTime),
      ...(dto.punotes ? { punotes: dto.punotes } : {}),
      ...(dto.spcinstr ? { spcinstr: dto.spcinstr } : {}),
      // ...(accessoriallist ? { accessoriallist } : {}),
      ...(dto.pono ? { pono: dto.pono } : {}),
      ...(dto.bolno ? { bolno: dto.bolno } : {}),
      ...(dto.billref ? { billref: dto.billref } : {}),
      ...(dto.declval ? { declval: String(dto.declval) } : {}),
      ...(dto.codamt ? { codamt: String(dto.codamt) } : {}),
      ...(dto.nopickup ? { nopickup: 'Yes' } : {}),
    };

    return payload;
  }

  // --------------------------------------------------------------------------
  // XML PARSER
  // --------------------------------------------------------------------------

private parseXml(xml: string): any {
    const getTag = (tag: string, text: string): string | null => {
      const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 's');
      const match = text.match(regex);
      return match ? match[1].trim() : null;
    };

    const getAllTags = (tag: string, text: string): string[] => {
      const regex = new RegExp(`<${tag}>.*?</${tag}>`, 'gs');
      return text.match(regex) || [];
    };

    // Try ratequote root
    const ratequoteXml = getTag('ratequote', xml);
    if (ratequoteXml) {
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
        chrg: getTag('chrg', lineXml),
      }));
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

    // Try response root (BOL)
    const responseXml = getTag('response', xml);
    if (responseXml) {
      const bolXml = getTag('bol', responseXml);
      const errorsXml = getTag('errors', responseXml);
      const errorMessages = errorsXml
        ? getAllTags('errormessage', errorsXml).map((e) =>
            getTag('errormessage', e) || e.replace(/<\/?errormessage>/g, '').trim()
          )
        : [];

      console.log({bolXml, errorsXml})
      let bolLines: any[] = [];
      if (bolXml) {
        const lineXmls = getAllTags('bolline', bolXml);
        bolLines = lineXmls.map((lineXml) => ({
          lineno: getTag('lineno', lineXml),
          pieces: getTag('pieces', lineXml),
          weight: getTag('weight', lineXml),
          class: getTag('class', lineXml),
          description: getTag('description', lineXml),
          keyword: getTag('keyword', lineXml),
        }));
      }

      return {
        response: {
          responsetype: getTag('responsetype', responseXml) || undefined,
          success: getTag('success', responseXml) || undefined,
          errors:
            errorMessages.length > 0
              ? { errormessage: errorMessages.length === 1 ? errorMessages[0] : errorMessages }
              : undefined,
          bol: bolXml
            ? {
                pronumber: getTag('pronumber', bolXml) || undefined,
                trackingnumber: getTag('trackingnumber', bolXml) || undefined,
                referencenumber: getTag('referencenumber', bolXml) || undefined,
                shippername: getTag('shippername', bolXml) || undefined,
                shipperaddress: getTag('shipperaddress', bolXml) || undefined,
                shippercity: getTag('shippercity', bolXml) || undefined,
                shipperstate: getTag('shipperstate', bolXml) || undefined,
                shipperzip: getTag('shipperzip', bolXml) || undefined,
                consigneename: getTag('consigneename', bolXml) || undefined,
                consigneeaddress: getTag('consigneeaddress', bolXml) || undefined,
                consigneecity: getTag('consigneecity', bolXml) || undefined,
                consigneestate: getTag('consigneestate', bolXml) || undefined,
                consigneezip: getTag('consigneezip', bolXml) || undefined,
                debtor: getTag('debtor', bolXml) || undefined,
                pono: getTag('pono', bolXml) || undefined,
                servicetypecode: getTag('servicetypecode', bolXml) || undefined,
                servicetypedesc: getTag('servicetypedesc', bolXml) || undefined,
                bolline: bolLines.length === 1 ? bolLines[0] : bolLines,
                bollink: getTag('bollink', bolXml) || undefined,
                labellink: getTag('labellink', bolXml) || undefined,
                quotetotal: getTag('quotetotal', bolXml) || undefined,
                quotenumber: getTag('quotenumber', bolXml) || undefined,
                quoteversion: getTag('quoteversion', bolXml) || undefined,
                quotedatetime: getTag('quotedatetime', bolXml) || undefined,
              }
            : undefined,
        },
      };
    }

    // FIX: Try protrace root (tracking) — NOT protracexml
    const protraceXml = getTag('protrace', xml);
    if (protraceXml) {
      // Events are nested inside <shiphists><shiphist>...</shiphist></shiphists>
      const shiphistsXml = getTag('shiphists', protraceXml);
      const shiphistXmls = shiphistsXml ? getAllTags('shiphist', shiphistsXml) : [];
      
      const events = shiphistXmls.map((shiphistXml) => ({
        histcode: getTag('histcode', shiphistXml),
        histdate: getTag('histdate', shiphistXml),
        histtime: getTag('histtime', shiphistXml),
        histremarks : getTag('histremarks', shiphistXml),
        histcity: getTag('histcity', shiphistXml),
        histstate: getTag('histstate', shiphistXml),
      }));

      return {
        protrace: {
          pronumb: getTag('pronumb', protraceXml) || undefined,
          trn: getTag('trn', protraceXml) || undefined,
          billno: getTag('billno', protraceXml) || undefined,
          pono: getTag('pono', protraceXml) || undefined,
          shipdate: getTag('shipdate', protraceXml) || undefined,
          shipdateiso: getTag('shipdateiso', protraceXml) || undefined,
          shipper: getTag('shipper', protraceXml) || undefined,
          shipaddr: getTag('shipaddr', protraceXml) || undefined,
          shipaddr2: getTag('shipaddr2', protraceXml) || undefined,
          origcity: getTag('origcity', protraceXml) || undefined,
          origstate: getTag('origstate', protraceXml) || undefined,
          origzip: getTag('origzip', protraceXml) || undefined,
          origterm: getTag('origterm', protraceXml) || undefined,
          consignee: getTag('consignee', protraceXml) || undefined,
          consaddr: getTag('consaddr', protraceXml) || undefined,
          consaddr2: getTag('consaddr2', protraceXml) || undefined,
          destcity: getTag('destcity', protraceXml) || undefined,
          deststate: getTag('deststate', protraceXml) || undefined,
          destzip: getTag('destzip', protraceXml) || undefined,
          destterm: getTag('destterm', protraceXml) || undefined,
          pallets: getTag('pallets', protraceXml) || undefined,
          palletpositions: getTag('palletpositions', protraceXml) || undefined,
          pieces: getTag('pieces', protraceXml) || undefined,
          weight: getTag('weight', protraceXml) || undefined,
          prodelivered: getTag('prodelivered', protraceXml) || undefined,
          deldate: getTag('deldate', protraceXml) || undefined,
          deltime: getTag('deltime', protraceXml) || undefined,
          delstatus: getTag('delstatus', protraceXml) || undefined,
          estdeliverydate: getTag('estdeliverydate', protraceXml) || undefined,
          estdeliverydateiso: getTag('estdeliverydateiso', protraceXml) || undefined,
          estdeliverytimestart: getTag('estdeliverytimestart', protraceXml) || undefined,
          estdeliverytimeend: getTag('estdeliverytimeend', protraceXml) || undefined,
          bollink: getTag('bollink', protraceXml) || undefined,
          labellink: getTag('labellink', protraceXml) || undefined,
          receivedby: getTag('receivedby', protraceXml) || undefined,
          status: getTag('status', protraceXml) || undefined,
          lifecycle: getTag('lifecycle', protraceXml) || undefined,
          lifecyclestatuscode: getTag('lifecyclestatuscode', protraceXml) || undefined,
          temperaturecode: getTag('temperaturecode', protraceXml) || undefined,
          temperaturedesc: getTag('temperaturedesc', protraceXml) || undefined,
          shiphists: {
            shiphist: events.length === 1 ? events[0] : events,
          },
        },
      };
    }

    return {};
  }

  // --------------------------------------------------------------------------
  // NORMALIZERS
  // --------------------------------------------------------------------------

  private normalizeRateQuoteResponse(raw: MinimaxRateQuoteRawResponse): MinimaxRateQuoteResponse {
    console.dir(raw)
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
      const chargeValue = line.chrg || line.charge || '0';
      const charge = this.parseCurrency(chargeValue);
      const rate = this.parseCurrency(line.rate || '0');
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

  private normalizeBOLResponse(raw: MinimaxBOLRawResponse): MinimaxBOLResponse {
    if (!raw.response) {
      throw new BadRequestException('Invalid Minimax BOL response: missing response root');
    }

    const resp = raw.response;
    const success = (resp.success || '').toLowerCase() === 'yes';

    if (!success) {
      const errors = resp.errors?.errormessage;
      const errorMsg = Array.isArray(errors) ? errors.join(', ') : errors || 'Unknown BOL creation error';
      throw new BadRequestException(`Minimax BOL creation failed: ${errorMsg}`);
    }

    const bol = resp.bol!;
    const linesRaw = Array.isArray(bol.bolline)
      ? bol.bolline
      : bol.bolline
      ? [bol.bolline]
      : [];

    const lines = linesRaw.map((line) => ({
      lineNumber: parseInt(line.lineno || '0', 10),
      pieces: parseInt(line.pieces || '0', 10),
      weight: parseInt(line.weight || '0', 10),
      freightClass: line.class?.trim() || '',
      description: line.description?.trim() || '',
    }));

    return {
      success: true,
      proNumber: bol.pronumber || '',
      trackingNumber: bol.trackingnumber || bol.pronumber || '',
      referenceNumber: bol.referencenumber || undefined,
      bolLink: bol.bollink || undefined,
      labelLink: bol.labellink || undefined,
      quoteTotal: this.parseCurrency(bol.quotetotal || '0'),
      quoteNumber: bol.quotenumber || undefined,
      serviceType: bol.servicetypedesc || 'NORMAL SERVICE',
      shipper: {
        name: bol.shippername || '',
        address: bol.shipperaddress || '',
        city: bol.shippercity || '',
        state: bol.shipperstate || '',
        zip: bol.shipperzip || '',
      },
      consignee: {
        name: bol.consigneename || '',
        address: bol.consigneeaddress || '',
        city: bol.consigneecity || '',
        state: bol.consigneestate || '',
        zip: bol.consigneezip || '',
      },
      lines,
      raw,
    };
  }

  private normalizeTrackingResponse(raw: any): MinimaxTrackingResponse {
    // FIX: Handle both wrapped { protrace: {...} } and flat {...} formats
    const pt = raw.protrace || raw;
    
    if (!pt || !pt.pronumb) {
      throw new BadRequestException(
        `Invalid Minimax tracking response: missing protrace data. Got keys: ${Object.keys(raw).join(', ')}`
      );
    }
    console.log({pt})
    const shipHistRaw = pt.shiphists?.shiphist;
    const eventsRaw = Array.isArray(shipHistRaw) 
      ? shipHistRaw 
      : shipHistRaw ? [shipHistRaw] : [];

    const events = eventsRaw.map((e: any) => ({
      date: e.histdate || '',
      time: e.histtime || '',
      city: e.histcity || '',
      state: e.histstate || '',
      description: e.histremarks || e.histdesc || e.histcode || '',
    }));

    const latestEvent = events[events.length - 1]; // or events[0] if API returns oldest first
    const eventStatus = latestEvent?.description || 'UNKNOWN';

    return {
      proNumber: pt.pronumb || '',
      bolNumber: pt.billno || undefined,
      shipDate: pt.shipdateiso || pt.shipdate || undefined,
      shipper: pt.shipper || undefined,
      consignee: pt.consignee || undefined,
      status: eventStatus,
      statusDescription: pt.lifecycle || pt.status || 'Unknown',
      statusDate: pt.shipdateiso || undefined,
      statusCity: pt.origcity || undefined,
      statusState: pt.origstate || undefined,
      deliveryDate: pt.deldate || pt.estdeliverydateiso || undefined,
      deliveryTime: pt.deltime || undefined,
      signedBy: pt.receivedby || undefined,
      events,
      raw,
    };
  }

  private parseCurrency(value: string): number {
    return parseFloat(value.replace(/,/g, '').replace(/\s+/g, '')) || 0;
  }
}