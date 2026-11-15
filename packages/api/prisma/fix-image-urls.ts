/**
 * One-off: rewrite the seeded image URLs (which point at a non-existent
 * `grocery-app` Cloudinary cloud) to Lorem Flickr themed placeholders so the
 * MVP demo actually shows pictures.
 *
 *   npx ts-node prisma/fix-image-urls.ts
 *
 * Idempotent — only rewrites URLs that still match the old pattern.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OLD = 'https://res.cloudinary.com/grocery-app/image/upload/';

function flickr(keywords: string, w = 400, h = 400, lock = 1): string {
  return `https://loremflickr.com/${w}/${h}/${keywords}?lock=${lock}`;
}

// Map old paths → new URLs. Keep keywords meaningful so the photo at least
// resembles the thing it represents.
const REPLACEMENTS: Record<string, string> = {
  // Categories
  'categories/rice.png':   flickr('rice,grain', 400, 400, 1),
  'categories/spices.png': flickr('spices,curry', 400, 400, 2),
  'categories/snacks.png': flickr('snacks,namkeen', 400, 400, 3),

  // Products
  'products/tilda-basmati-1.jpg':       flickr('basmati,rice',   600, 600, 11),
  'products/trs-chana-dal.jpg':         flickr('lentils,daal',   600, 600, 12),
  'products/shan-cumin.jpg':            flickr('cumin,spice',    600, 600, 13),
  'products/mdh-garam-masala.jpg':      flickr('garam,masala',   600, 600, 14),
  'products/haldirams-aloo-bhujia.jpg': flickr('indian,snack',   600, 600, 15),

  // Banners
  'banners/rashan-desktop.jpg':   flickr('grocery,delivery', 1600, 600, 21),
  'banners/rashan-mobile.jpg':    flickr('grocery,delivery', 800,  600, 22),
  'banners/freeship-desktop.jpg': flickr('delivery,van',     1600, 600, 23),
  'banners/freeship-mobile.jpg':  flickr('delivery,van',     800,  600, 24),
};

function rewrite(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(OLD)) return null;
  const tail = url.slice(OLD.length);
  return REPLACEMENTS[tail] ?? null;
}

async function main() {
  let updated = 0;

  // Categories
  const cats = await prisma.category.findMany({ select: { id: true, icon_url: true } });
  for (const c of cats) {
    const next = rewrite(c.icon_url);
    if (next) {
      await prisma.category.update({ where: { id: c.id }, data: { icon_url: next } });
      updated++;
    }
  }

  // Product images
  const imgs = await prisma.productImage.findMany({ select: { id: true, url: true } });
  for (const img of imgs) {
    const next = rewrite(img.url);
    if (next) {
      await prisma.productImage.update({ where: { id: img.id }, data: { url: next } });
      updated++;
    }
  }

  // Banners (desktop + mobile fields)
  const banners = await prisma.banner.findMany({
    select: { id: true, image_desktop: true, image_mobile: true },
  });
  for (const b of banners) {
    const d = rewrite(b.image_desktop);
    const m = rewrite(b.image_mobile);
    if (d || m) {
      await prisma.banner.update({
        where: { id: b.id },
        data: {
          ...(d ? { image_desktop: d } : {}),
          ...(m ? { image_mobile: m } : {}),
        },
      });
      updated++;
    }
  }

  console.log(`✅ Rewrote ${updated} image URL(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
