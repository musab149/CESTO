/**
 * Spanish provinces, keyed by the first two digits of the postcode.
 *
 * This is not a lookup table for its own sake. A rep filling in an address on
 * a phone types the postcode anyway, and those two digits ARE the province —
 * so asking for the province separately is asking for something we already
 * know, and inviting a typo into a field that later has to match a delivery
 * zone.
 *
 * Names are the official ones, in the form a customer would recognise:
 * bilingual provinces use the local name where that is what appears on an
 * address (Girona, Lleida, A Coruña, Ourense, Gipuzkoa, Bizkaia, Araba/Álava).
 */
export const SPANISH_PROVINCES: Record<string, string> = {
  '01': 'Araba/Álava',
  '02': 'Albacete',
  '03': 'Alicante',
  '04': 'Almería',
  '05': 'Ávila',
  '06': 'Badajoz',
  '07': 'Illes Balears',
  '08': 'Barcelona',
  '09': 'Burgos',
  '10': 'Cáceres',
  '11': 'Cádiz',
  '12': 'Castellón',
  '13': 'Ciudad Real',
  '14': 'Córdoba',
  '15': 'A Coruña',
  '16': 'Cuenca',
  '17': 'Girona',
  '18': 'Granada',
  '19': 'Guadalajara',
  '20': 'Gipuzkoa',
  '21': 'Huelva',
  '22': 'Huesca',
  '23': 'Jaén',
  '24': 'León',
  '25': 'Lleida',
  '26': 'La Rioja',
  '27': 'Lugo',
  '28': 'Madrid',
  '29': 'Málaga',
  '30': 'Murcia',
  '31': 'Navarra',
  '32': 'Ourense',
  '33': 'Asturias',
  '34': 'Palencia',
  '35': 'Las Palmas',
  '36': 'Pontevedra',
  '37': 'Salamanca',
  '38': 'Santa Cruz de Tenerife',
  '39': 'Cantabria',
  '40': 'Segovia',
  '41': 'Sevilla',
  '42': 'Soria',
  '43': 'Tarragona',
  '44': 'Teruel',
  '45': 'Toledo',
  '46': 'Valencia',
  '47': 'Valladolid',
  '48': 'Bizkaia',
  '49': 'Zamora',
  '50': 'Zaragoza',
  '51': 'Ceuta',
  '52': 'Melilla',
};

/** The province a postcode belongs to, or null if it is not a valid one. */
export function provinceForPostcode(postcode: string): string | null {
  const digits = postcode.trim();
  if (!/^\d{5}$/.test(digits)) return null;
  return SPANISH_PROVINCES[digits.slice(0, 2)] ?? null;
}

/** Sorted for a picker. Spanish collation, so Á sorts with A. */
export const PROVINCE_NAMES: string[] = Object.values(SPANISH_PROVINCES)
  .sort((a, b) => a.localeCompare(b, 'es'));

/**
 * Domains people reach for when they mean a popular one.
 *
 * Narrow on purpose. This runs against the field that the client's password
 * is sent to, so a wrong "did you mean" is worse than no suggestion: it is
 * only ever a hint the rep can ignore, never a correction applied for them.
 */
const COMMON_DOMAIN_TYPOS: Record<string, string> = {
  'gmai.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'icloud.con': 'icloud.com',
  'iclod.com': 'icloud.com',
};

/**
 * A likely-intended correction for an email address, or null.
 *
 * Returns the whole corrected address so the caller can offer it as one tap.
 */
export function suggestEmailCorrection(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase().trim();
  const fixed = COMMON_DOMAIN_TYPOS[domain];
  return fixed ? `${local}@${fixed}` : null;
}
