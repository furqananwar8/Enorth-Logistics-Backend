import { createHash } from 'crypto';
import { TrackingEventType } from 'src/entities/mock-carrier-tracking.entity';

// ── Type Extraction ──────────────────────────────────────────────────────
// TypeScript enums are distinct types from string literals. We extract the
// actual string values using template literal types so they can be used
// in union types and as Record keys.

type TrackingEventTypeValue = `${TrackingEventType}`;

export type CanonicalStatus = 
  | TrackingEventTypeValue
  | 'INFO_RECEIVED' 
  | 'PENDING' 
  | 'AT_FACILITY' 
  | 'ON_HOLD' 
  | 'SHIPMENT_EXCEPTION' 
  | 'UNKNOWN';

// ── Status Metadata ──────────────────────────────────────────────────────

interface StatusMeta {
  eventType: TrackingEventType | null; // null = state update only, no event entity
  label: string;
}

const META: Record<CanonicalStatus, StatusMeta> = {
  'SHIPMENT_CREATED':   { eventType: TrackingEventType.SHIPMENT_CREATED,    label: 'Shipment Created' },
  'PICKUP':             { eventType: TrackingEventType.PICKUP,              label: 'Picked Up' },
  'IN_TRANSIT':         { eventType: TrackingEventType.IN_TRANSIT,          label: 'In Transit' },
  'ARRIVED_AT_FACILITY':{ eventType: TrackingEventType.ARRIVED_AT_FACILITY, label: 'Arrived at Facility' },
  'OUT_FOR_DELIVERY':   { eventType: TrackingEventType.OUT_FOR_DELIVERY,    label: 'Out for Delivery' },
  'DELIVERED':          { eventType: TrackingEventType.DELIVERED,           label: 'Delivered' },
  'EXCEPTION':          { eventType: TrackingEventType.EXCEPTION,           label: 'Exception' },
  'RETURNED':           { eventType: TrackingEventType.RETURNED,            label: 'Returned' },
  'INFO_RECEIVED':      { eventType: TrackingEventType.SHIPMENT_CREATED,    label: 'Info Received' },
  'PENDING':            { eventType: null,                                label: 'Pending' },
  'AT_FACILITY':        { eventType: TrackingEventType.ARRIVED_AT_FACILITY, label: 'At Facility' },
  'ON_HOLD':            { eventType: TrackingEventType.EXCEPTION,          label: 'On Hold' },
  'SHIPMENT_EXCEPTION': { eventType: TrackingEventType.EXCEPTION,          label: 'Exception' },
  'UNKNOWN':            { eventType: null,                                label: 'Unknown' },
};

// ── Per-Carrier Raw → Canonical Mappings ───────────────────────────────

const REGISTRY: Record<string, Record<string, CanonicalStatus>> = {
  FEDEX: {
    'IN_TRANSIT': 'IN_TRANSIT',
    'DELIVERED': 'DELIVERED',
    'OUT_FOR_DELIVERY': 'OUT_FOR_DELIVERY',
    'PICKED_UP': 'PICKUP',
    'SHIPMENT': 'INFO_RECEIVED',
    'AT_DESTINATION': 'ARRIVED_AT_FACILITY',
    'EXCEPTION': 'SHIPMENT_EXCEPTION',
  },
  XPO: {
    'IN_TRANSIT': 'IN_TRANSIT',
    'DELIVERED': 'DELIVERED',
    'OUT_FOR_DELIVERY': 'OUT_FOR_DELIVERY',
    'PICKED_UP': 'PICKUP',
    'AT_TERMINAL': 'AT_FACILITY',
    'DOCK': 'AT_FACILITY',
    'EXCEPTION': 'SHIPMENT_EXCEPTION',
  },
  TST: {
    'PU': 'PICKUP', 'P': 'PICKUP',
    'IT': 'IN_TRANSIT', 'I': 'IN_TRANSIT',
    'AR': 'AT_FACILITY', 'A': 'AT_FACILITY',
    'DL': 'DELIVERED', 'D': 'DELIVERED',
    'DE': 'SHIPMENT_EXCEPTION',
    'CA': 'SHIPMENT_EXCEPTION', 'X': 'SHIPMENT_EXCEPTION',
    'HL': 'ON_HOLD',
    'RS': 'RETURNED',
    'OC': 'INFO_RECEIVED',
  },
  TFORCE: {
    'PU': 'PICKUP',
    'OC': 'INFO_RECEIVED',
    'IT': 'IN_TRANSIT',
    'AR': 'AT_FACILITY',
    'OD': 'OUT_FOR_DELIVERY',
    'DL': 'DELIVERED',
    'DE': 'SHIPMENT_EXCEPTION',
    'SE': 'SHIPMENT_EXCEPTION',
    'CA': 'SHIPMENT_EXCEPTION',
    'HL': 'ON_HOLD',
    'RS': 'RETURNED',
  },
  MINIMAX: {
    'In Transit': 'IN_TRANSIT',
    'Delivered': 'DELIVERED',
    'Out for Delivery': 'OUT_FOR_DELIVERY',
    'Picked Up': 'PICKUP',
    'At Terminal': 'AT_FACILITY',
  },
};

// ── Public API ───────────────────────────────────────────────────────────

export class CarrierStatusRegistry {
  static normalize(carrier: string, rawCode: string): { 
    canonical: CanonicalStatus; 
    eventType: TrackingEventType | null; 
    label: string 
  } {
    const c = (carrier || '').toUpperCase();
    const raw = (rawCode || '').toString().trim();
    const map = REGISTRY[c] || {};
    
    // Try exact match first
    let canonical = map[raw] || map[raw.toUpperCase()] || 'UNKNOWN';
    
    // Fuzzy fallback: normalize whitespace/underscores
    if (canonical === 'UNKNOWN') {
      const preprocessed = raw.toUpperCase().replace(/\s+/g, '_');
      canonical = map[preprocessed] || 'UNKNOWN';
    }
    
    const meta = META[canonical];
    return { canonical, eventType: meta?.eventType ?? null, label: meta?.label ?? raw };
  }

  static generateEventId(carrier: string, proNumber: string, event: any): string {
      // Use carrier event ID if provided
      if (event.id || event.eventId || event.eventNumber) {
          return `${carrier}:${proNumber}:${event.id || event.eventId || event.eventNumber}`;
      }
      
      // Carrier-specific stable identifiers
      const c = (carrier || '').toUpperCase();
      
      if (c === 'MINIMAX') {
          const code = event.histcode || event.statusCode || '';
          const desc = event.histremarks || event.description || event.status || '';
          const date = event.histdate || event.date || '';
          const time = event.histtime || event.time || '';
          const payload = `${c}:${proNumber}:${code}:${desc}:${date}:${time}`;
          return createHash('sha256').update(payload).digest('hex').substring(0, 24);
      }
      
      if (c === 'FEDEX') {
          // FedEx has scanEventIds usually
          const scanId = event.eventType || event.scanEventId || '';
          const payload = `${c}:${proNumber}:${scanId}:${event.date || ''}`;
          return createHash('sha256').update(payload).digest('hex').substring(0, 24);
      }
      
      // Default: full hash including time for precision
      const payload = [
          c,
          proNumber,
          event.statusCode || event.status || event.histcode || '',
          event.description || event.histremarks || '',
          event.location?.city || event.location || event.serviceCenter || event.histcity || '',
          event.timestamp || event.date || '',
      ].join('|');
      
      return createHash('sha256').update(payload).digest('hex').substring(0, 24);
  }
}