import { formatInTimeZone } from 'date-fns-tz';
import * as zipToTz from 'zipcode-to-timezone';

/**
 * Maps a Canadian province code to its IANA timezone.
 * Most provinces map 1:1. BC, ON, and QC technically span more than
 * one zone, but we default to the zone covering the vast majority
 * of population/addresses.
 */
export const getCanadianTimezone = (postalCd: string, stateCd?: string): string => {
  const provinceTzMap: Record<string, string> = {
    BC: 'America/Vancouver',   // Pacific
    AB: 'America/Edmonton',    // Mountain
    SK: 'America/Regina',      // Fixed CST, no DST
    MB: 'America/Winnipeg',    // Central
    ON: 'America/Toronto',     // Eastern
    QC: 'America/Montreal',    // Eastern
    NB: 'America/Moncton',     // Atlantic
    NS: 'America/Halifax',     // Atlantic
    PE: 'America/Halifax',     // Atlantic
    NL: 'America/St_Johns',    // UTC-3:30
    YT: 'America/Whitehorse',  // Fixed MST, no DST
    NT: 'America/Yellowknife', // Mountain
    NU: 'America/Iqaluit',     // Eastern (majority)
  };

  const province = stateCd?.toUpperCase();
  const tz = province ? provinceTzMap[province] : undefined;

  if (!tz) {
    console.warn(`No timezone mapping for Canadian province "${province}" (postal: ${postalCd}), defaulting to America/Toronto`);
    return 'America/Toronto';
  }

  return tz;
};

/**
 * Resolves the UTC offset (e.g. "-07:00") for a given address and date,
 * DST-aware, for US and Canadian addresses.
 */
export const getUtcOffset = (
  address: { postalCode: string; country: string; state?: string },
  referenceDate: Date
): string => {
  const tz =
    address.country === 'CA'
      ? getCanadianTimezone(address.postalCode, address.state)
      : zipToTz.lookup(address.postalCode) ?? 'America/New_York';

  return formatInTimeZone(referenceDate, tz, 'XXX');
};