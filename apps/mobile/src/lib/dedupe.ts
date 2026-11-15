/**
 * Collapse repeated ids, keeping first occurrence and original order.
 *
 * Offset pagination over a non-unique sort (`name_asc` across a catalogue with
 * repeated names) can hand back the same row on two adjacent pages when rows
 * shift between fetches. Concatenating the pages then gives React duplicate
 * keys, and a FlatList with numColumns reconciles them as one item — which
 * paints the same product in both cells of a row until something forces a
 * re-render.
 *
 * The home screen has carried this fix inline since the infinite catalogue
 * shipped; the rashan picker was written without it and reproduced the bug.
 * Shared so the next infinite list starts from the fixed version.
 */
export function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Collapse products that are the same thing sold by different shops.
 *
 * This catalogue holds ~2,100 products across 8 stores, and the same item is
 * routinely listed by several of them — 318 such groups. In a storefront that
 * is meaningful: you pick who you buy from. In the rashan picker it is noise,
 * because you are naming an item for a recurring pack, not choosing a seller.
 * Five identical trays there read as a broken list.
 *
 * Identity is the normalised name plus brand — deliberately looser than
 * admin's fingerprint, which also keys on category and product type. Those
 * differ across stores for the same physical product, so including them would
 * leave the visible duplicates in place.
 *
 * First occurrence wins, which is the cheapest listing under `name_asc` order
 * only by accident — if picking the cheapest ever matters, sort before this.
 */
export function dedupeProductIdentity<
  T extends { id: string; name_es?: string | null; name_en?: string | null; brand?: string | null },
>(items: readonly T[]): T[] {
  const normalize = (s: string | null | undefined) =>
    (s ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');

  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = `${normalize(item.name_es)}|${normalize(item.name_en)}|${normalize(item.brand)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
