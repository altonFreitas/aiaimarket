export interface Country {
  code: string;  // calling code, no plus sign
  flag: string;
  name: string;
}

/** Timor-Leste first (the default), then the countries most likely to be
 * relevant to a Dili storefront's buyers: diaspora and near neighbours. */
export const COUNTRIES: Country[] = [
  { code: "670", flag: "🇹🇱", name: "Timor-Leste" },
  { code: "62", flag: "🇮🇩", name: "Indonesia" },
  { code: "61", flag: "🇦🇺", name: "Australia" },
  { code: "351", flag: "🇵🇹", name: "Portugal" },
  { code: "65", flag: "🇸🇬", name: "Singapore" },
  { code: "63", flag: "🇵🇭", name: "Philippines" },
  { code: "60", flag: "🇲🇾", name: "Malaysia" },
  { code: "44", flag: "🇬🇧", name: "United Kingdom" },
  { code: "1", flag: "🇺🇸", name: "United States" },
];

/** Sourcing countries, ISO 3166-1 alpha-2.
 *
 * A separate list from COUNTRIES above, which holds telephone calling codes
 * for the checkout phone field -- a different identifier for a different job,
 * and conflating them would mean storing "351" where a GROUP BY expects "PT".
 *
 * Covers the European and Asian manufacturing centres a Timorese importer
 * actually buys from, plus the near neighbours most goods physically transit.
 * Suppliers elsewhere are still recordable: any two-letter code is accepted,
 * and one not listed here simply shows as its raw code. */
export interface SourcingCountry { code: string; flag: string; name: string }

export const SOURCING_COUNTRIES: SourcingCountry[] = [
  { code: "TL", flag: "🇹🇱", name: "Timor-Leste" },
  { code: "ID", flag: "🇮🇩", name: "Indonesia" },
  { code: "CN", flag: "🇨🇳", name: "China" },
  { code: "SG", flag: "🇸🇬", name: "Singapore" },
  { code: "MY", flag: "🇲🇾", name: "Malaysia" },
  { code: "TH", flag: "🇹🇭", name: "Thailand" },
  { code: "VN", flag: "🇻🇳", name: "Vietnam" },
  { code: "IN", flag: "🇮🇳", name: "India" },
  { code: "JP", flag: "🇯🇵", name: "Japan" },
  { code: "KR", flag: "🇰🇷", name: "South Korea" },
  { code: "TW", flag: "🇹🇼", name: "Taiwan" },
  { code: "AU", flag: "🇦🇺", name: "Australia" },
  { code: "NZ", flag: "🇳🇿", name: "New Zealand" },
  { code: "PT", flag: "🇵🇹", name: "Portugal" },
  { code: "ES", flag: "🇪🇸", name: "Spain" },
  { code: "FR", flag: "🇫🇷", name: "France" },
  { code: "DE", flag: "🇩🇪", name: "Germany" },
  { code: "IT", flag: "🇮🇹", name: "Italy" },
  { code: "NL", flag: "🇳🇱", name: "Netherlands" },
  { code: "GB", flag: "🇬🇧", name: "United Kingdom" },
  { code: "US", flag: "🇺🇸", name: "United States" },
  { code: "BR", flag: "🇧🇷", name: "Brazil" },
  { code: "AE", flag: "🇦🇪", name: "United Arab Emirates" },
  { code: "TR", flag: "🇹🇷", name: "Türkiye" },
];

const BY_CODE = new Map(SOURCING_COUNTRIES.map((c) => [c.code, c]));

/** Display name for a country code, falling back to the code itself so an
 * unlisted country is still legible rather than blank. */
export function countryName(code: string): string {
  return BY_CODE.get(code)?.name || code || "Unknown";
}

export function countryFlag(code: string): string {
  return BY_CODE.get(code)?.flag || "🏳";
}

/** Currencies a purchase order is likely to be denominated in. Free text is
 * still accepted by the database (any three-letter code); this is the
 * shortlist the form offers. */
export const PO_CURRENCIES = ["USD", "EUR", "CNY", "IDR", "SGD", "AUD", "JPY", "GBP", "BRL"];
