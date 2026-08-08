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
