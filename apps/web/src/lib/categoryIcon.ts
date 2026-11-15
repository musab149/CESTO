/**
 * Fallback icon for a category that has no icon_url set.
 *
 * Keyed on the category NAME, not its id. An id-keyed map was tried first
 * and silently broke: it held the mock ids ('cat-001'…'cat-008'), real
 * categories carry cuids, so every lookup missed and every category on the
 * page rendered the same generic basket. Names are matched in both Spanish
 * and English because the catalogue is bilingual and either may be active.
 */
export function emojiForCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('rice') || n.includes('arroz')) return '🍚';
  if (n.includes('flour') || n.includes('harina') || n.includes('atta')) return '🌾';
  if (n.includes('lentil') || n.includes('lenteja') || n.includes('dal') || n.includes('pulse')) return '🫘';
  if (n.includes('spice') || n.includes('especia') || n.includes('masala')) return '🌶️';
  if (n.includes('sauce') || n.includes('salsa') || n.includes('chutney') || n.includes('pickle')) return '🥫';
  if (n.includes('oil') || n.includes('ghee') || n.includes('aceite')) return '🫒';
  if (n.includes('snack') || n.includes('namkeen')) return '🍿';
  if (n.includes('tea') || n.includes('chai') || n.includes('coffee') || n.includes('café') || n.includes('té')) return '🍵';
  if (n.includes('drink') || n.includes('bebida') || n.includes('juice') || n.includes('zumo')) return '🥤';
  if (n.includes('sweet') || n.includes('dulce') || n.includes('dessert') || n.includes('postre')) return '🍬';
  if (n.includes('fruit') || n.includes('fruta') || n.includes('nut') || n.includes('fruto')) return '🥜';
  if (n.includes('meat') || n.includes('carne') || n.includes('halal') || n.includes('chicken')) return '🥩';
  if (n.includes('dairy') || n.includes('milk') || n.includes('cheese') || n.includes('leche') || n.includes('queso')) return '🥛';
  if (n.includes('bread') || n.includes('pan') || n.includes('pasta')) return '🍞';
  if (n.includes('frozen') || n.includes('congelado')) return '🧊';
  if (n.includes('vegetable') || n.includes('verdura')) return '🥬';
  if (n.includes('recipe') || n.includes('mix') || n.includes('seasoning')) return '🥘';
  return '🛒';
}
