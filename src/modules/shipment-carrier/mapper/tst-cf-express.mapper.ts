import { BadRequestException } from "@nestjs/common";
import { AddressType } from "src/common/enum/address-type.enum";
import { ShipmentType } from "src/common/enum/shipment-type.enum";
import { Quote } from "src/entities/quote.entity";
import { TSTCFRateRequest, TSTCFAddress, TSTCFShipLine, TSTCFAccessorials } from "src/types/tst-cf-express";

export class TSTCFExpressMapper {
  private readonly serviceMap: Record<string, string> = {
    'STANDARD': 'ST',
    'EXPRESS': 'EX',
    'GUARANTEED': 'GD',
  };

  private readonly accessorialMap: Record<string, string> = {
    'INSIDE_PICKUP': 'INSPU',
    'INSIDE_DELIVERY': 'INSD',
    'LIFTGATE_PICKUP': 'LGPU',
    'LIFTGATE_DELIVERY': 'LGD',
    'RESIDENTIAL_PICKUP': 'RESPU',
    'RESIDENTIAL_DELIVERY': 'RESD',
  };

private formatCountry(country: string | undefined): string {
    if (!country) return 'CN';
    const normalized = country.trim().toUpperCase();
    const map: Record<string, string> = {
        'USA': 'US',
        'UNITED STATES': 'US',
        'US': 'US',
        'CANADA': 'CN',   // ← TST uses CN, not CA!
        'CA': 'CN',       // ← Map CA to CN
        'CN': 'CN',
    };
    return map[normalized] || normalized.slice(0, 2);
}
  /**
   * Format date as CCYYMMDD integer (e.g. 20260430)
   */
  private formatDateInt(date: Date | string): number {
      const d = new Date(date);
      const year = d.getFullYear();                          // 2026
      const month = String(d.getMonth() + 1).padStart(2, '0'); // "04"
      const day = String(d.getDate()).padStart(2, '0');        // "30"
      return parseInt(`${year}${month}${day}`, 10);           // 20260430
  }

  /**
   * Format freight class to TST 3-digit code: 50 → "050", 55 → "055", 77.5 → "070"
   */
  private formatFreightClass(cls: string | number | undefined): string {
      if (!cls && cls !== 0) return '050'; // Default if undefined/null/empty
      const num = parseFloat(String(cls));
      if (isNaN(num)) return '050'; // Default if unparseable
      if (num === 77.5) return '070';
      return String(Math.round(num)).padStart(3, '0');
  }

  /**
   * Strip non-digits and return max 10 digits for phone
   */
  private formatPhone(phone: string | undefined): string {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    return digits.slice(-10); // Take last 10 digits
  }

  private readonly STATE_MAP: Record<string, string> = {
    // US States
    'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR',
    'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE',
    'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID',
    'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS',
    'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
    'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS',
    'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV',
    'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
    'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK',
    'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT',
    'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV',
    'WISCONSIN': 'WI', 'WYOMING': 'WY', 'WASHINGTON DC': 'DC', 'DISTRICT OF COLUMBIA': 'DC',
    
    // Canadian Provinces
    'ALBERTA': 'AB', 'BRITISH COLUMBIA': 'BC', 'MANITOBA': 'MB', 'NEW BRUNSWICK': 'NB',
    'NEWFOUNDLAND AND LABRADOR': 'NL', 'NEWFOUNDLAND': 'NL', 'LABRADOR': 'NL',
    'NOVA SCOTIA': 'NS', 'NORTHWEST TERRITORIES': 'NT', 'NUNAVUT': 'NU',
    'ONTARIO': 'ON', 'PRINCE EDWARD ISLAND': 'PE', 'QUEBEC': 'QC', 'SASKATCHEWAN': 'SK',
    'YUKON': 'YT',
  };

  private formatState(state: string | undefined): string {
    if (!state) return '';
    const normalized = state.trim().toUpperCase();
    // Already a 2-letter code
    if (/^[A-Z]{2}$/.test(normalized)) return normalized;
    // Full name lookup
    return this.STATE_MAP[normalized] || normalized.slice(0, 2);
  }

  private formatPhoneExt(phone: string | undefined): string {
      if (!phone) return '';
      const digits = String(phone).replace(/\D/g, '');
      return digits.slice(-4); // Last 4 digits
  }

  validate(request: any): string[] {
    return [];
  }

  map(request: any): TSTCFRateRequest {
    const shipDate = this.formatDate(request?.shipDate || new Date());
    const rawType = (request?.shipmentType || '').toString().toUpperCase();
    const isFTL = rawType === 'STANDARD_FTL' || rawType === 'SPOT_FTL';

    return {
      requestor: process.env.TST_CF_REQUESTOR || '',
      authorization: process.env.TST_CF_AUTHORIZATION || '',
      login: process.env.TST_CF_USERNAME || '',
      passwd: process.env.TST_CF_PASSWORD || '',
      testmode: request?.testMode === false ? 'N' : 'Y',
      language: 'en',
      assignpro: 'Y',
      xmlversion: '2.0',
      transit: request.tst?.includeTransit !== false ? 'Y' : 'N',
      shipdate: shipDate,
      origin: this.mapAddress(request.tst?.from),
      destination: this.mapAddress(request.tst?.to),
      service: isFTL ? 'TL' : 'ST',
      funds: 'C',
      rqby: 'S',
      terms: request?.paymentTerms || 'P',
      taxexempt: request?.taxExempt ? 'Y' : 'N',
      tllf: request?.tailgateLiftFee || 0,
      cod: request?.codAmount || 0,
      dclval: {
        amount: request.declaredValue?.amount || 0,
        funds: request.declaredValue?.currency || '',
      },
      shipdetail: {
        line: request.packages.map((pkg: any, index: number) =>
          isFTL ? this.mapFTLPackage(pkg, index) : this.mapPackageByType(pkg, index, request.shipmentType),
        ),
      },
      accitems: this.mapAccessorials(request.accessorials),
    };
  }

  private mapPackageByType(pkg: any, index: number, shipmentType: ShipmentType): any {
    switch (shipmentType) {
      case ShipmentType.STANDARD_FTL:
        return this.mapFTLPackage(pkg, index);
      case ShipmentType.COURIER_PAK:
        return this.mapCourierPakPackage(pkg, index);
      case ShipmentType.PALLET:
        return this.mapPalletPackage(pkg, index);
      case ShipmentType.PACKAGE:
      default:
        return this.mapStandardPackage(pkg, index);
    }
  }

  private mapStandardPackage(pkg: any, index: number): any {
    return this.mapPalletPackage(pkg, index);
  }

  private mapPalletPackage(pkg: any, index: number): any {
    const len = pkg.length || pkg.dimensions?.length;
    const wid = pkg.width || pkg.dimensions?.width;
    const hgt = pkg.height || pkg.dimensions?.height;

    if (!len || !wid || !hgt) {
      throw new BadRequestException(
        `Package ${index + 1}: PALLET/PACKAGE requires length, width, and height.`,
      );
    }

    return {
      seq: index + 1,
      weight: pkg.weight,
      class: pkg.freightClass || pkg.class || '050',
      nmfc: pkg.nmfc || '',
      stackable: pkg.stackable ? 'Y' : 'N',
      cubicft: pkg.cubicFeet || '',
      dimensions: {
        qty: pkg.handlingUnits || pkg.quantity || 1,
        len,
        wid,
        hgt,
      },
    };
  }

  private mapCourierPakPackage(pkg: any, index: number): any {
    return {
      seq: index + 1,
      weight: pkg.weight,
      pieces: pkg.handlingUnits || 1,
      description: pkg.description || 'Courier Pak',
    };
  }

  private mapFTLPackage(pkg: any, index: number): any {
    return {
      seq: index + 1,
      weight: pkg.weight,
      pieces: pkg.handlingUnits || 1,
      description: pkg.description || 'FTL Freight',
      class: '050',
    };
  }

  // ============================================================================
  // NEW: MAP QUOTE CREATION PAYLOAD (Pattern B)
  // ============================================================================

  // mapQuote(req: any, selectedRate: any): any {
  //   const shipDate = this.formatDate(req?.shipDate || new Date());
  //   const fromAddr = req.tst?.from || req.shipper || req.from;
  //   const toAddr = req.tst?.to || req.recipient || req.to;

  //   return {
  //     requestor: process.env.TST_CF_REQUESTOR || '',
  //     authorization: process.env.TST_CF_AUTHORIZATION || '',
  //     login: process.env.TST_CF_USERNAME || '',
  //     passwd: process.env.TST_CF_PASSWORD || '',
  //     testmode: req?.testMode === false ? 'N' : 'Y',
  //     language: 'en',
  //     xmlversion: '2.0',
  //     shipdate: shipDate,
  //     origin: this.mapAddress(fromAddr),
  //     destination: this.mapAddress(toAddr),
  //     service: this.serviceMap[selectedRate?.serviceType] || selectedRate?.serviceType || 'ST',
  //     funds: 'C',
  //     rqby: 'S',
  //     terms: req?.paymentTerms || 'P',
  //     taxexempt: req?.taxExempt ? 'Y' : 'N',
  //     tllf: req?.tailgateLiftFee || 0,
  //     cod: req?.codAmount || 0,
  //     dclval: {
  //       amount: req.declaredValue?.amount || 0,
  //       funds: req.declaredValue?.currency || '',
  //     },
  //     shipdetail: {
  //       line: (req.packages || []).map((pkg: any, index: number) => this.mapPackage(pkg, index)),
  //     },
  //     accitems: this.mapAccessorials(req.accessorials),
  //     confirm: 'Y',
  //   };
  // }

  mapQuote(quote: Quote, selectedRate: any): any {
    const addresses = quote.addresses.getItems(); // or however MikroORM gives you the collection
    const origin = addresses.find(a => a.type === 'FROM') || addresses[0];
    const dest = addresses.find(a => a.type === 'TO') || addresses[1];
    
    const originEntry = origin?.addressBookEntry;
    const destEntry = dest?.addressBookEntry;

    // Flatten line items + units for TST shipdetail.lines
   const lines = (quote.lineItems?.units as any).map((unit, index) => ({
        weight: unit.weight || 0,
        class: unit.freightClass || '050',
        nmfc: unit.nmfc || '',
        stackable: unit.stackable ? 'Y' : 'N',
        cubicft: unit.cubicFeet || '',
        dimensions: {
            qty: unit.quantity || 1,
            len: unit.length || 0,
            wid: unit.width || 0,
            hgt: unit.height || 0,
        },
    }));

    return {
        requestor: process.env.TST_CF_REQUESTOR,
        authorization: process.env.TST_CF_AUTHORIZATION,
        login: process.env.TST_CF_USERNAME,
        passwd: process.env.TST_CF_PASSWORD,
        testmode: 'Y',
        language: 'en',
        xmlversion: '2.0',
        shipdate: this.formatDate(new Date()),
        origin: this.mapAddress(originEntry),
        destination: this.mapAddress(destEntry),
        service: this.serviceMap[selectedRate.serviceType] || 'ST',
         funds: 'C',
      rqby: 'S',
      terms: 'P',
      taxexempt: 'Y',
      tllf: 0,
      cod: 0,
      dclval: {
        amount: 0,
        funds: '',
      },
        shipdetail: { line: lines },
        confirm: 'Y'
    };
}

  // ============================================================================
  // NEW: MAP SHIPMENT / PICKUP PAYLOAD (Pattern B — uses quoteId)
  // ============================================================================

 mapShipment(quote: Quote, selectedRate: any): any {
    const addresses = quote.addresses.getItems();
    console.log({addresses})
    const origin = addresses.find(a => a.type === AddressType.FROM);
    const dest = addresses.find(a => a.type === AddressType.TO);
    
    const originEntry = origin?.addressBookEntry;
    const destEntry = dest?.addressBookEntry;
    
    const originAddr: any = originEntry;
    const destAddr: any =  destEntry;
    const shipDate = this.formatDateInt(quote?.shipment?.shipDate || new Date());
   console.dir({originAddr})
    const lines = (quote.lineItems?.units as any)?.map((unit: any) => ({
      description1: unit.description || 'General Freight',
      description2: '',
      pkg: unit.packagingCode || 'SKD',
      pcs: unit.quantity || 1,
      swgt: Math.round(unit.weight || 0),
      cls: this.formatFreightClass(unit.freightClass),
      nmfc: unit.nmfc || '',
      haz: unit.hazardous ? 'Y' : '',
      hazun: unit.hazardous ? (unit.hazun || '') : '',
      hazcls: unit.hazardous ? (unit.hazcls || '') : '',
      hazsubcls: unit.hazardous ? (unit.hazsubcls || '') : '',
      hazpg: unit.hazardous ? (unit.hazpg || '') : '',
    })) || [];

    const dimensions = (quote.lineItems?.units as any)?.map((unit: any) => ({
      qty: unit.quantity || 1,
      len: unit.length || 0,
      wid: unit.width || 0,
      hgt: unit.height || 0,
    })) || [];

    return {
      requestor: process.env.TST_CF_REQUESTOR || '',
      authorization: process.env.TST_CF_AUTHORIZATION || '',
      login: process.env.TST_CF_USERNAME || '',
      passwd: process.env.TST_CF_PASSWORD || '',
      testmode: process.env.NODE_ENV !== 'production' ? 'Y' : '',
      language: 'en',
      assignpro: 'Y',
      
      shipper: {
        country: this.formatCountry(originAddr?.address?.country),
        company: originAddr?.companyName || originAddr?.contactName || '',
        address1: originAddr?.address?.address1 || '',
        unit: originAddr?.address?.unit || '',
        address2: originAddr?.address?.address2 || '',
        city: originAddr?.address?.city || '',
        state: this.formatState(originAddr?.address?.state),
        zip: originAddr?.address?.postalCode || '',
        contact: originAddr?.contactName || '',
        phone: this.formatPhone(originAddr?.phoneNumber),
        phoneext: this.formatPhoneExt(originAddr?.phoneNumber) || '',
      },
      
      consignee: {
        country: this.formatCountry(destAddr?.address?.country),
        company: destAddr?.companyName || destAddr?.contactName || '',
        address1: destAddr?.address?.address1 || '',
        unit: destAddr?.address?.unit || '',
        address2: destAddr?.address?.address2 || '',
        city: destAddr?.address?.city || '',
        state: this.formatState(destAddr?.address?.state),
        zip: destAddr?.address?.postalCode || '',
        contact: destAddr?.contactName || '',
        phone: this.formatPhone(destAddr?.phoneNumber),
        phoneext: this.formatPhoneExt(destAddr?.phoneNumber) || '',
      },
      brokername: 'Test Broker',
      ptype: 'S',
      pickupdate: shipDate,
      readytime: this.convertToHHMM(originAddr?.palletShippingReadyTime) ?? '0800',
      closetime: this.convertToHHMM(originAddr?.palletShippingCloseTime) ?? '1700',
      service: this.serviceMap[selectedRate?.serviceType] || 'ST',
      pff: '',
      
      rqby: {
        email: originAddr?.email || '',
        phone: this.formatPhone(originAddr?.phoneNumber),
        name: originAddr?.contactName || '',
      },
      
      kg: '',
      
      shipdetail: {
        line: lines,
      },
      
      emerphone: '',
      erapnbr: '',
      
      bolnbr: '',      // TST generates
      rqnbr: '',       // No quote — leave empty
      custrefnbr: '',  // Your internal ref if you have one
      ponbr: '',
      
      dvamt: 0,
      accitems: [],
      dimensions: dimensions.length > 0 ? dimensions : undefined,
      si: [],
    };
  }

  // Add this helper method to your TSTCFExpressMapper class

  private convertToHHMM(timeStr: string | undefined): string {
      if (!timeStr) return '0800'; // default fallback
      
      const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
      if (!match) {
          // Already in HH:MM 24h format?
          const simpleMatch = timeStr.match(/^(\d{2}):(\d{2})$/);
          if (simpleMatch) return `${simpleMatch[1]}${simpleMatch[2]}`;
          return '0800'; // fallback
      }
      
      let hour = parseInt(match[1], 10);
      const minute = match[2];
      const period = match[3].toUpperCase();
      
      if (period === 'PM' && hour !== 12) hour += 12;
      if (period === 'AM' && hour === 12) hour = 0;
      
      return `${hour.toString().padStart(2, '0')}${minute}`;
  }

  private mapAddress(addr: any): TSTCFAddress {
    return {
      name: addr?.name || 'USER',
      address: addr?.streetAddress || addr?.address || '',
      zip: addr?.postalCode || '',
      city: addr?.city || '',
      state: addr?.state || addr?.province || '',
    };
  }

  private mapPackage(pkg: any, index: number): TSTCFShipLine {
    return {
      weight: pkg.weight,
      class: pkg.freightClass || pkg.class || '050',
      nmfc: pkg.nmfc || '',
      stackable: pkg.stackable ? 'Y' : 'N',
      cubicft: pkg.cubicFeet || '',
      dimensions: {
        qty: pkg.handlingUnits || pkg.quantity || 1,
        len: pkg.length || pkg.dimensions?.length || 0,
        wid: pkg.width || pkg.dimensions?.width || 0,
        hgt: pkg.height || pkg.dimensions?.height || 0,
      },
    };
  }

  private mapAccessorials(accessorials?: string[]): TSTCFAccessorials | undefined {
    if (!accessorials || accessorials.length === 0) return undefined;

    return {
      item: accessorials.map(acc => this.accessorialMap[acc] || acc),
    };
  }

  private formatDate(date: string | Date): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
}