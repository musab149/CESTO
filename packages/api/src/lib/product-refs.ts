import prisma from './prisma';

/**
 * Given a free-text brand string and origin string (as typed by the admin
 * in the product form), resolve them to Brand/Origin FK ids. Returns null
 * for anything not matching an existing row — a fully-blank match rather
 * than a create, because the form user hasn't opted into auto-creating a
 * new brand. (The Excel importer's behaviour is different — it auto-creates
 * as is_active=false — because the volume warrants it.)
 *
 * Lives in lib/ so both the products route and the bulk router can use it
 * without a circular import.
 */
export async function resolveProductRefs(
  brand: string | null,
  origin: string | null,
): Promise<{ brand_id: string | null; origin_id: string | null }> {
  let brand_id: string | null = null;
  let origin_id: string | null = null;
  if (brand && brand.trim()) {
    const row = await prisma.brand.findFirst({
      where: { name: { equals: brand.trim(), mode: 'insensitive' } },
      select: { id: true },
    });
    brand_id = row?.id ?? null;
  }
  if (origin && origin.trim()) {
    // Origins accept a match against `key`, `label_es`, or `label_en`.
    const row = await prisma.origin.findFirst({
      where: {
        OR: [
          { key:      { equals: origin.trim(), mode: 'insensitive' } },
          { label_es: { equals: origin.trim(), mode: 'insensitive' } },
          { label_en: { equals: origin.trim(), mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    origin_id = row?.id ?? null;
  }
  return { brand_id, origin_id };
}
