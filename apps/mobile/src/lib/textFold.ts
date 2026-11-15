/**
 * Accent- and case-insensitive comparison key, shared by every catalogue
 * filter in the app.
 *
 * Spanish brand, origin and product names carry diacritics shoppers rarely
 * type, so "espana" has to find "España" or the search reads as broken.
 */

/**
 * U+0300–U+036F, the Combining Diacritical Marks block — what NFD leaves
 * behind once it has split "é" into "e" plus its accent.
 *
 * Built from codepoints rather than written as a literal character class:
 * spelled literally the range is two invisible characters in the source, which
 * survives a copy-paste or a reformat only by luck. Web can use
 * /\p{Diacritic}/gu instead; Hermes support for property escapes is not
 * something this app should bet a search box on.
 */
const COMBINING_MARKS = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  'g',
);

/**
 * `normalize` is feature-checked because this is the only NFD call in the
 * mobile app: a Hermes build without it would take the calling screen down
 * rather than merely fail to match an accent.
 */
export function foldText(s: string): string {
  const lower = s.toLowerCase().trim();
  if (typeof (lower as string).normalize !== 'function') return lower;
  return lower.normalize('NFD').replace(COMBINING_MARKS, '');
}
