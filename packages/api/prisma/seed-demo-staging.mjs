#!/usr/bin/env node
/*
 * Demo-data seeder for the staging environment.
 *
 * Runs entirely against the public + admin HTTP API — never touches the DB
 * directly. Idempotent: uses slug (stores) / name_en+category (products) as
 * the identity key and skips whatever already exists.
 *
 * Usage:
 *   API_BASE=https://cesto-api-staging.onrender.com \
 *   ADMIN_EMAIL=admin@cestoshop.com \
 *   ADMIN_PASSWORD=<the seed password> \
 *   node packages/api/prisma/seed-demo-staging.mjs
 *
 * Defaults to the staging URL + `admin@cestoshop.com`. Password MUST be
 * supplied via env — the script has no default.
 */

const API_BASE = process.env.API_BASE || 'https://cesto-api-staging.onrender.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@cestoshop.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('✖ ADMIN_PASSWORD env var is required.');
  process.exit(1);
}

let accessToken = '';

async function req(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return payload;
}

// ─── login ───────────────────────────────────────────────────────────

async function login() {
  const r = await req('POST', '/api/admin/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  accessToken = r.data.accessToken;
  console.log(`✔ logged in as ${r.data.admin.email}`);
}

// ─── categories ──────────────────────────────────────────────────────

const CATEGORY_SEEDS = [
  { name_es: 'Arroz y Legumbres', name_en: 'Rice & Pulses',       sort_order: 1 },
  { name_es: 'Especias y Condimentos', name_en: 'Spices & Seasonings', sort_order: 2 },
  { name_es: 'Snacks y Dulces',     name_en: 'Snacks & Sweets',    sort_order: 3 },
];

async function ensureCategories() {
  const existing = await req('GET', '/api/admin/categories');
  const byNameEn = new Map(existing.data.map((c) => [c.name_en.toLowerCase(), c]));
  const result = new Map();
  for (const seed of CATEGORY_SEEDS) {
    const key = seed.name_en.toLowerCase();
    let cat = byNameEn.get(key);
    if (cat) {
      console.log(`  · category exists: ${cat.name_en}`);
    } else {
      const created = await req('POST', '/api/admin/categories', seed);
      cat = created.data;
      console.log(`  + created category: ${cat.name_en}`);
    }
    result.set(seed.name_en, cat);
  }
  return result;
}

// ─── stores ──────────────────────────────────────────────────────────

const HOURS_STANDARD = {
  mon: { closed: false, open: '09:00', close: '21:00' },
  tue: { closed: false, open: '09:00', close: '21:00' },
  wed: { closed: false, open: '09:00', close: '21:00' },
  thu: { closed: false, open: '09:00', close: '21:00' },
  fri: { closed: false, open: '09:00', close: '22:00' },
  sat: { closed: false, open: '10:00', close: '22:00' },
  sun: { closed: true },
};

function logoUrl(name, bg, accent) {
  const clean = (c) => c.replace('#', '');
  const label = encodeURIComponent(name);
  return `https://placehold.co/240x120/${clean(bg)}/${clean(accent)}/png?text=${label}&font=montserrat`;
}
function coverUrl(slug) {
  return `https://picsum.photos/seed/${slug}-cover/1200/400`;
}

const STORE_SEEDS = [
  {
    slug: 'shan',
    name: 'Shan Foods',
    tagline_en: 'Legendary Pakistani spice blends',
    tagline_es: 'Mezclas de especias pakistaníes legendarias',
    origin: 'Pakistan',
    is_verified: true,
    fast_delivery: true,
    rating: 4.7, rating_count: 312,
    logo_bg: '#F5D0A9',
    logo_accent: '#C4362A',
  },
  {
    slug: 'tilda',
    name: 'Tilda',
    tagline_en: 'The basmati rice specialists',
    tagline_es: 'Los especialistas del arroz basmati',
    origin: 'India',
    is_verified: true,
    fast_delivery: false,
    rating: 4.8, rating_count: 458,
    logo_bg: '#E8F0DA',
    logo_accent: '#587C2E',
  },
  {
    slug: 'haldirams',
    name: "Haldiram's",
    tagline_en: 'Iconic Indian snacks & sweets',
    tagline_es: 'Snacks y dulces icónicos de la India',
    origin: 'India',
    is_verified: true,
    fast_delivery: true,
    rating: 4.6, rating_count: 289,
    logo_bg: '#FFE7B0',
    logo_accent: '#C22E1F',
  },
  {
    slug: 'trs',
    name: 'TRS Wholesale',
    tagline_en: 'Pulses, lentils, staples in bulk',
    tagline_es: 'Legumbres, lentejas y básicos al por mayor',
    origin: 'UK / India',
    is_verified: false,
    fast_delivery: false,
    rating: 4.4, rating_count: 156,
    logo_bg: '#F0EBE1',
    logo_accent: '#6E4B29',
  },
  {
    slug: 'deep',
    name: 'Deep Foods',
    tagline_en: 'Frozen paratha, ready meals, pastes',
    tagline_es: 'Paratha congelada, listos y pastas',
    origin: 'USA / India',
    is_verified: true,
    fast_delivery: true,
    rating: 4.5, rating_count: 201,
    logo_bg: '#E0EAF7',
    logo_accent: '#1F4C8B',
  },
];

async function ensureStores() {
  const existing = await req('GET', '/api/admin/stores?limit=100');
  const bySlug = new Map(existing.data.items.map((s) => [s.slug, s]));
  const result = new Map();
  for (const seed of STORE_SEEDS) {
    let store = bySlug.get(seed.slug);
    if (store) {
      console.log(`  · store exists: ${store.slug}`);
    } else {
      const payload = {
        slug: seed.slug,
        name: seed.name,
        tagline_en: seed.tagline_en,
        tagline_es: seed.tagline_es,
        description_en: `${seed.name} — a trusted partner shop on Cesto. Specialties from ${seed.origin}.`,
        description_es: `${seed.name} — una tienda asociada de confianza en Cesto. Especialidades de ${seed.origin}.`,
        logo_url: logoUrl(seed.name, seed.logo_bg, seed.logo_accent),
        logo_bg: seed.logo_bg,
        cover_url: coverUrl(seed.slug),
        origin: seed.origin,
        is_verified: seed.is_verified,
        fast_delivery: seed.fast_delivery,
        rating: seed.rating,
        rating_count: seed.rating_count,
        shop_hours: HOURS_STANDARD,
        sort_order: STORE_SEEDS.indexOf(seed),
      };
      const created = await req('POST', '/api/admin/stores', payload);
      store = created.data;
      console.log(`  + created store: ${store.slug}`);
    }
    result.set(seed.slug, store);
  }
  return result;
}

// ─── products ────────────────────────────────────────────────────────

function productImg(sku) {
  return `https://picsum.photos/seed/${sku.toLowerCase()}/600/600`;
}

const PRODUCT_SEEDS = [
  // Rice & Pulses
  { name_en: 'Tilda Pure Basmati Rice 1kg',   name_es: 'Arroz Basmati Tilda 1kg',   brand: 'Tilda',      origin: 'India',    store: 'tilda',      cat: 'Rice & Pulses', sponsored: true,  price: 4.29, compare: null,  sku: 'TLD-BAS-1KG',    desc_en: 'Premium long-grain aromatic basmati. Aged for depth of flavour.' },
  { name_en: 'Tilda Brown Basmati 500g',      name_es: 'Basmati Integral Tilda 500g', brand: 'Tilda',    origin: 'India',    store: 'tilda',      cat: 'Rice & Pulses', sponsored: false, price: 2.99, compare: 3.49,  sku: 'TLD-BBS-500', desc_en: 'Wholegrain basmati with a nutty flavour. High in fibre.' },
  { name_en: 'TRS Chana Dal 500g',            name_es: 'Chana Dal TRS 500g',        brand: 'TRS',        origin: 'India',    store: 'trs',        cat: 'Rice & Pulses', sponsored: false, price: 1.79, compare: null,  sku: 'TRS-CHD-500', desc_en: 'Split yellow chickpeas — the base for classic dals.' },
  { name_en: 'TRS Toor Dal 500g',             name_es: 'Toor Dal TRS 500g',         brand: 'TRS',        origin: 'India',    store: 'trs',        cat: 'Rice & Pulses', sponsored: false, price: 1.89, compare: null,  sku: 'TRS-TOR-500', desc_en: 'Split pigeon peas. Essential in South Indian sambar.' },

  // Spices & Seasonings
  { name_en: 'Shan Biryani Masala 60g',       name_es: 'Masala Biryani Shan 60g',   brand: 'Shan',       origin: 'Pakistan', store: 'shan',       cat: 'Spices & Seasonings', sponsored: true,  price: 1.49, compare: null,  sku: 'SHN-BRY-60',  desc_en: "Shan's classic biryani spice blend. One pack, one pot, restaurant flavour." },
  { name_en: 'Shan Chicken Karahi Masala',    name_es: 'Masala Chicken Karahi Shan', brand: 'Shan',      origin: 'Pakistan', store: 'shan',       cat: 'Spices & Seasonings', sponsored: false, price: 1.59, compare: 1.89,  sku: 'SHN-KRH-50',  desc_en: 'Tomato-forward Punjabi karahi blend. Add chicken, tomatoes, ginger.' },
  { name_en: 'Shan Nihari Masala 60g',        name_es: 'Masala Nihari Shan 60g',    brand: 'Shan',       origin: 'Pakistan', store: 'shan',       cat: 'Spices & Seasonings', sponsored: false, price: 1.69, compare: null,  sku: 'SHN-NIH-60',  desc_en: 'Slow-cooked beef stew blend. Traditional Lahori breakfast.' },
  { name_en: 'MDH Garam Masala 100g',         name_es: 'Garam Masala MDH 100g',     brand: 'MDH',        origin: 'India',    store: null,         cat: 'Spices & Seasonings', sponsored: true,  price: 2.29, compare: null,  sku: 'MDH-GM-100',  desc_en: 'Ground spice blend — the finishing touch for curries.' },
  { name_en: 'MDH Kitchen King 100g',         name_es: 'MDH Kitchen King 100g',     brand: 'MDH',        origin: 'India',    store: null,         cat: 'Spices & Seasonings', sponsored: false, price: 2.19, compare: null,  sku: 'MDH-KK-100',  desc_en: 'All-purpose Indian curry masala. Works with everything.' },
  { name_en: 'TRS Turmeric Powder 400g',      name_es: 'Cúrcuma TRS 400g',          brand: 'TRS',        origin: 'India',    store: 'trs',        cat: 'Spices & Seasonings', sponsored: false, price: 2.49, compare: null,  sku: 'TRS-TUR-400', desc_en: 'Bright, earthy turmeric. Family-size pack.' },
  { name_en: 'Everest Kashmiri Chili 100g',   name_es: 'Chile Cachemir Everest 100g', brand: 'Everest', origin: 'India',    store: null,         cat: 'Spices & Seasonings', sponsored: false, price: 2.39, compare: null,  sku: 'EVR-KCH-100', desc_en: 'Deep red colour, mild heat. The colour magic behind rogan josh.' },
  { name_en: 'Deep Ginger-Garlic Paste 283g', name_es: 'Pasta de Jengibre-Ajo Deep 283g', brand: 'Deep', origin: 'India',   store: 'deep',       cat: 'Spices & Seasonings', sponsored: false, price: 2.99, compare: null,  sku: 'DP-GGP-283',  desc_en: 'Ready-to-use blend. Saves 10 minutes on every curry.' },

  // Snacks & Sweets
  { name_en: "Haldiram's Aloo Bhujia 400g",   name_es: "Aloo Bhujia Haldiram's 400g", brand: "Haldiram's", origin: 'India',  store: 'haldirams',  cat: 'Snacks & Sweets', sponsored: true,  price: 3.99, compare: 4.49,  sku: 'HLD-AB-400',  desc_en: 'Crunchy spiced potato snack. A tea-time classic.' },
  { name_en: "Haldiram's Bhujia Sev 200g",    name_es: "Bhujia Sev Haldiram's 200g",  brand: "Haldiram's", origin: 'India',  store: 'haldirams',  cat: 'Snacks & Sweets', sponsored: false, price: 2.29, compare: null,  sku: 'HLD-SEV-200', desc_en: 'Fine gram-flour noodles, gently spiced. Sprinkle over chaats.' },
  { name_en: "Haldiram's Soan Papdi 250g",    name_es: "Soan Papdi Haldiram's 250g",  brand: "Haldiram's", origin: 'India',  store: 'haldirams',  cat: 'Snacks & Sweets', sponsored: false, price: 3.49, compare: null,  sku: 'HLD-SP-250',  desc_en: 'Flaky cardamom-spiced sweet. Melts on the tongue.' },
  { name_en: 'Deep Frozen Malabar Paratha (5)', name_es: 'Paratha Malabar Deep congelada (5)', brand: 'Deep', origin: 'India', store: 'deep',   cat: 'Snacks & Sweets', sponsored: true,  price: 4.49, compare: null,  sku: 'DP-PAR-5',    desc_en: 'Flaky layered flatbread. Straight from freezer to pan.' },
  { name_en: 'Ashoka Butter Chicken RTE 280g', name_es: 'Butter Chicken Ashoka RTE 280g', brand: 'Ashoka', origin: 'India', store: null,         cat: 'Snacks & Sweets', sponsored: true,  price: 3.79, compare: 4.29,  sku: 'ASH-BC-280',  desc_en: 'Ready-to-eat curry. Boil the pouch, dinner in 3 minutes.' },
  { name_en: 'KTC Pure Ghee 500g',            name_es: 'Ghee Puro KTC 500g',        brand: 'KTC',        origin: 'UK',       store: null,         cat: 'Snacks & Sweets', sponsored: false, price: 6.99, compare: null,  sku: 'KTC-GHE-500', desc_en: 'Clarified butter. Nutty, aromatic — the heart of Indian cooking.' },
];

async function ensureProducts(cats, stores) {
  const existing = await req('GET', '/api/admin/products?limit=200');
  const byNameEn = new Map(existing.data.items.map((p) => [p.name_en.toLowerCase(), p]));
  let created = 0, skipped = 0;

  for (const seed of PRODUCT_SEEDS) {
    if (byNameEn.has(seed.name_en.toLowerCase())) {
      skipped += 1;
      continue;
    }
    const cat = cats.get(seed.cat);
    if (!cat) throw new Error(`Category not found: ${seed.cat}`);
    const store = seed.store ? stores.get(seed.store) : null;

    const payload = {
      name_en: seed.name_en,
      name_es: seed.name_es,
      description_en: seed.desc_en,
      description_es: seed.desc_en,
      brand: seed.brand,
      origin: seed.origin,
      category_id: cat.id,
      store_id: store ? store.id : null,
      is_active: true,
      is_featured: seed.sponsored, // sponsored picks are also worth featuring
      is_sponsored: seed.sponsored,
      is_top_seller: false,
      is_verified: !!store,
      rating: 4.5,
      rating_count: 20,
      variants: [
        {
          name_en: 'Default',
          name_es: 'Estándar',
          price: seed.price,
          compare_at_price: seed.compare,
          stock_quantity: 40,
          low_stock_threshold: 10,
          is_default: true,
          is_active: true,
          sku: seed.sku,
        },
      ],
      images: [
        { url: productImg(seed.sku), alt_text: seed.name_en, sort_order: 0, is_primary: true },
      ],
    };
    await req('POST', '/api/admin/products', payload);
    created += 1;
    console.log(`  + product: ${seed.name_en}${seed.sponsored ? ' [sponsored]' : ''}${seed.store ? ` @${seed.store}` : ''}`);
  }
  console.log(`✔ products: ${created} created, ${skipped} already existed`);
}

// ─── top brands home section ─────────────────────────────────────────

const BRAND_TILES = [
  { name: 'Tilda',       bg: '#E8F0DA', accent: '#587C2E' },
  { name: 'Shan',        bg: '#F5D0A9', accent: '#C4362A' },
  { name: "Haldiram's",  bg: '#FFE7B0', accent: '#C22E1F' },
  { name: 'MDH',         bg: '#FDE2E4', accent: '#B7263B' },
  { name: 'TRS',         bg: '#F0EBE1', accent: '#6E4B29' },
  { name: 'Deep',        bg: '#E0EAF7', accent: '#1F4C8B' },
  { name: 'Ashoka',      bg: '#F1E7F9', accent: '#6B2B8F' },
  { name: 'Everest',     bg: '#F7E4D8', accent: '#B14A1D' },
  { name: 'KTC',         bg: '#FFF3B0', accent: '#8A6A11' },
];

async function updateTopBrands() {
  const payload = {
    brands: BRAND_TILES.map((b, i) => ({
      name: b.name,
      image_url: logoUrl(b.name, b.bg, b.accent),
      link: `/categories?brand=${encodeURIComponent(b.name)}`,
      is_active: true,
      display_order: i,
      bg_color: b.bg,
    })),
  };
  await req('PUT', '/api/admin/home-sections/top-brands', payload);
  console.log(`✔ top-brands section updated (${BRAND_TILES.length} brands)`);
}

// ─── main ────────────────────────────────────────────────────────────

async function main() {
  console.log(`→ target: ${API_BASE}`);
  await login();

  console.log('\n· categories');
  const cats = await ensureCategories();

  console.log('\n· stores');
  const stores = await ensureStores();

  console.log('\n· products');
  await ensureProducts(cats, stores);

  console.log('\n· home sections');
  await updateTopBrands();

  console.log('\n✅ done.');
}

main().catch((err) => {
  console.error('\n✖ seed failed:', err.message);
  process.exit(1);
});
