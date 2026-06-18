// tst-cf-express.types.ts
export interface TSTCFExpressCredentials {
  requestor: string;
  authorization: string;
  login: string;
  passwd: string;
}

export interface TSTCFRateRequest {
  requestor: string;
  authorization: string;
  login: string;
  passwd: string;
  testmode: 'Y' | 'N';
  language: string;
  assignpro: string;
  xmlversion: string;
  transit: 'Y' | 'N';
  shipdate: string; // YYYYMMDD
  origin: TSTCFAddress;
  destination: TSTCFAddress;
  service: string;
  funds: string;
  rqby: string;
  terms: string;
  taxexempt: 'Y' | 'N';
  tllf: number;
  cod: number;
  dclval: TSTCFDeclaredValue;
  shipdetail: TSTCFShipDetail;
  accitems?: TSTCFAccessorials;
}

export interface TSTCFAddress {
  name: string;
  address: string;
  zip: string;
  city: string;
  state: string;
}

export interface TSTCFDeclaredValue {
  amount: number;
  funds: string;
}

export interface TSTCFShipDetail {
  line: TSTCFShipLine[];
}

export interface TSTCFShipLine {
  weight: number;
  class: string;
  nmfc?: string;
  stackable: 'Y' | 'N';
  cubicft?: string;
  dimensions: TSTCFDimensions;
}

export interface TSTCFDimensions {
  qty: number;
  len: number;
  wid: number;
  hgt: number;
}

export interface TSTCFAccessorials {
  item: string[];
}

export interface TSTCFRateResponse {
  quoteid: string;
  totalamt: string;
  freightamt: string;
  discountpct: string;
  discountamt: string;
  totalweight: string;
  accitems: {
    item: TSTCFAccessorialItem[];
  };
  g1amt: string;
  g2amt: string;
  g3amt: string;
  transitresults?: TSTCFTransitResults;
}

export interface TSTCFAccessorialItem {
  itemcode: string;
  itemdesc: string;
  itemstatus: string;
  itemamount: string;
  itemrate: string;
}

export interface TSTCFTransitResults {
  shipdate: string;
  status: string;
  servicedays: string;
  holidaydays: string;
  arrivaldate: string;
}