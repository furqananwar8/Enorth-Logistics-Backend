// src/modules/quote/config/update-quote-fields.config.ts

import { ShipmentType } from "src/common/enum/shipment-type.enum";

/**
 * STRICT WHITELIST: Only these fields can be updated per shipment type
 * Any field not listed here will be stripped from the DTO before processing
 */
export const UPDATE_WHITELIST: Record<ShipmentType, string[]> = {
  [ShipmentType.PALLET]: [
    "addresses",           // Can modify FROM/TO addresses
    "lineItem",             // Can modify pallet details, units, dimensions
    "services",             // Can modify limitedAccess, appointmentDelivery, etc.
    "knownShipper",         // Can toggle known shipper status
    "status",               // Can transition status (DRAFT -> CONFIRMED, etc.)
    "insurance",
  ],

  [ShipmentType.STANDARD_FTL]: [
    "addresses",
    "includeStraps",        // FTL-specific
    "appointmentDelivery",  // FTL-specific
    "insurance",            // Can add/modify insurance
    "services",             // looseFreight, pallets
    "knownShipper",
    "status",
  ],

  [ShipmentType.COURIER_PAK]: [
    "addresses",
    "lineItem",             // Can modify courier pack units (weight, quantity)
    "signature",            // Courier requires signature selection
    "knownShipper",
    "status",
  ],

  [ShipmentType.PACKAGE]: [
    "addresses",
    "lineItem",             // Can modify package units (dimensions, weight)
    "signature",            // Package requires signature
    "services",             // limitedAccess, appointmentDelivery, etc.
    "knownShipper",
    "status",
    "insurance",
  ],

  [ShipmentType.SPOT_LTL]: [
    "addresses",            // Can modify with locationType, additionalNotes
    "spotDetails",          // Can modify contact, equipment, requirements
    "services",             // inbound, protectFromFreeze, limitedAccess
    "knownShipper",
    "status",
  ],

  [ShipmentType.SPOT_FTL]: [
    "addresses",
    "spotDetails",          // Can modify contact, equipment
    "knownShipper",
    "status",
  ],

  [ShipmentType.TIME_CRITICAL]: [
    "addresses",
    "spotDetails",          // Can modify contact (includes deliveryDate), equipment
    "knownShipper",
    "status",
  ],
};

/**
 * Fields that CANNOT be updated after quote creation (immutable)
 */
export const IMMUTABLE_FIELDS = [
  "quoteType",      // Cannot switch between STANDARD and SPOT
  "shipmentType",   // Cannot switch between PALLET, FTL, etc.
  "createdBy",    // Cannot change ownership
  "createdAt",    // Cannot modify timestamps
  "id",           // Cannot change ID
];

/**
 * Nested field whitelists for complex objects
 */
export const NESTED_UPDATE_WHITELIST: Record<string, string[]> = {
  // Addresses - can update these fields
  "addresses": [
    "type", "address1", "address2", "city", "state", 
    "postalCode", "country", "locationType", "additionalNotes",
    "addressBookId", "isResidential"
  ],

  // Line item root fields
  "lineItem": [
    "type", "description", "measurementUnit", 
    "dangerousGoods", "stackable", "units"
  ],

  // Unit fields within line items
  "lineItem.units": [
    "id",
    "quantity", "weight", "description",           // Common
    "length", "width", "height",                   // PACKAGE/PALLET only
    "freightClass", "nmfc", "unitsOnPallet" ,"palletUnitType",       // PALLET only
    "stackable", "specialHandlingRequired"         // PACKAGE/PALLET
  ],

  // Insurance fields
  "insurance": ["amount", "currency"],

  // Services by type
  "services": [
    // PALLET services
    "limitedAccess", "appointmentDelivery", 
    "thresholdDelivery", "thresholdPickup",
    // STANDARD_FTL services  
    "looseFreight", "pallets",
    // SPOT_LTL services
    "inbound", "protectFromFreeze"
  ],

  // Spot details
  "spotDetails": [
    "spotType", "spotContact", "spotEquipment", "spotRequirements"
  ],

  "spotDetails.spotContact": [
    "contactName", "phoneNumber", "email", 
    "shipDate", "deliveryDate", "spotQuoteName"
  ],

  "spotDetails.spotEquipment": [
    "car", "dryVan", "flatbed", "truck", "van", 
    "ventilated", "refrigerated", "nextFlightOut"
  ],
};

interface FieldRule {
  field: string;
  required: boolean;
  condition?: (data: any) => boolean;
}

export const packageRules: FieldRule[] = [
  { field: 'length', required: true },
  { field: 'width', required: true },
  { field: 'height', required: true },
  { field: 'weight', required: true },
  { field: 'description', required: false },
  { field: 'specialHandlingRequired', required: false }
];

export const palletRules: FieldRule[] = [
  { field: 'length', required: true },
  { field: 'width', required: true },
  { field: 'height', required: true },
  { field: 'weight', required: true },
  { field: 'freightClass', required: true },
  { field: 'nmfc', required: false },
  { field: 'stackable', required: false },
  { field: 'unitsOnPallet', required: false },
  { field: 'palletUnitType', required: false },
  { field: 'description', required: false },

];
export const spotFTLRules: FieldRule[] = [
  { field: 'weight', required: true },
  { field: 'unitsOnPallet', required: true },
  { field: 'description', required: true },
]
export const courierPakRules: FieldRule[] = [
  { field: 'weight', required: true },
  { field: 'description', required: false },
];

export const standardFTLRule: FieldRule[] = [
  { field: 'looseFreight', required: false },
  { field: 'pallets', required: false }
]

export const requiredServiceFields: Record<ShipmentType, string[]> = {
    [ShipmentType.PALLET]: [
      'limitedAccess',
      'appointmentDelivery',
      'thresholdDelivery',
      'thresholdPickup',
      'inBound', 
      'protectFromFreeze',
      'tradeShowDelivery',
      'amazonOrFbaDelivery',
      'refrigeratedServices'
    ],
    [ShipmentType.STANDARD_FTL]: ['looseFreight', 'pallets'],
    [ShipmentType.SPOT_LTL]: ['inBound', 'protectFromFreeze', 'limitedAccess', 
      'tradeShowDelivery', 'amazonOrFbaDelivery', 'groceryDistributionCenter',
      'appointmentDelivery', 'thresholdDelivery','thresholdPickup', 'dangerousGoods'
    ],
    [ShipmentType.PACKAGE]: [],
    [ShipmentType.COURIER_PAK]: [],
    [ShipmentType.TIME_CRITICAL]: [],
    [ShipmentType.SPOT_FTL]: [],
  };
