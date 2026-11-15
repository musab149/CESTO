import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedHelpCenter } from './seedHelpCenter';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Guard catalog blocks so this script is idempotent. We only seed the
  // catalog/riders if NO data exists yet — otherwise leave
  // whatever the team has been building in the admin panel alone.
  const existingCategories = await prisma.category.count();
  const skipCatalog = existingCategories > 0;
  if (skipCatalog) {
    console.log('   - Catalog already populated, skipping categories/products/riders.');
  }

  // ─── CATEGORIES (3) ─────────────────────────────────────
  if (!skipCatalog) {

  const catGrains = await prisma.category.create({
    data: {
      name_es: 'Arroz y Legumbres',
      name_en: 'Rice & Pulses',
      icon_url: 'https://loremflickr.com/400/400/rice,grain?lock=1',
      sort_order: 1,
    },
  });

  const catSpices = await prisma.category.create({
    data: {
      name_es: 'Especias y Condimentos',
      name_en: 'Spices & Seasonings',
      icon_url: 'https://loremflickr.com/400/400/spices,curry?lock=2',
      sort_order: 2,
    },
  });

  const catSnacks = await prisma.category.create({
    data: {
      name_es: 'Snacks y Dulces',
      name_en: 'Snacks & Sweets',
      icon_url: 'https://loremflickr.com/400/400/snacks,namkeen?lock=3',
      sort_order: 3,
    },
  });

  // ─── SUBCATEGORIES (2 per category = 6) ──────────────────

  const subBasmati = await prisma.subCategory.create({
    data: { category_id: catGrains.id, name_es: 'Arroz Basmati', name_en: 'Basmati Rice', sort_order: 1 },
  });
  const subDals = await prisma.subCategory.create({
    data: { category_id: catGrains.id, name_es: 'Lentejas y Dals', name_en: 'Lentils & Dals', sort_order: 2 },
  });

  const subWhole = await prisma.subCategory.create({
    data: { category_id: catSpices.id, name_es: 'Especias Enteras', name_en: 'Whole Spices', sort_order: 1 },
  });
  const subGround = await prisma.subCategory.create({
    data: { category_id: catSpices.id, name_es: 'Especias Molidas', name_en: 'Ground Spices', sort_order: 2 },
  });

  const subNamkeen = await prisma.subCategory.create({
    data: { category_id: catSnacks.id, name_es: 'Namkeen y Mezclas', name_en: 'Namkeen & Mixtures', sort_order: 1 },
  });
  const subSweets = await prisma.subCategory.create({
    data: { category_id: catSnacks.id, name_es: 'Dulces Tradicionales', name_en: 'Traditional Sweets', sort_order: 2 },
  });

  // ─── PRODUCTS (5) with 2 VARIANTS each ───────────────────

  // Product 1: Basmati Rice
  const p1 = await prisma.product.create({
    data: {
      name_es: 'Arroz Basmati Tilda',
      name_en: 'Tilda Basmati Rice',
      description_es: 'Arroz basmati de grano largo premium, importado de India. Perfecto para biryani y pulao.',
      description_en: 'Premium long-grain basmati rice imported from India. Perfect for biryani and pulao.',
      brand: 'Tilda',
      origin: 'India',
      category_id: catGrains.id,
      subcategory_id: subBasmati.id,
      is_featured: true,
      variants: {
        create: [
          { name_es: '1 kg', name_en: '1 kg', price: 3.99, stock_quantity: 50, is_default: true, sku: 'TLD-BAS-1KG' },
          { name_es: '5 kg', name_en: '5 kg', price: 16.99, stock_quantity: 25, sku: 'TLD-BAS-5KG' },
        ],
      },
      images: {
        create: [
          { url: 'https://loremflickr.com/600/600/basmati,rice?lock=11', is_primary: true, sort_order: 0 },
        ],
      },
    },
  });

  // Product 2: Chana Dal
  const p2 = await prisma.product.create({
    data: {
      name_es: 'Chana Dal TRS',
      name_en: 'TRS Chana Dal',
      description_es: 'Garbanzos partidos de alta calidad. Ideal para dals y curries.',
      description_en: 'High-quality split chickpeas. Ideal for dals and curries.',
      brand: 'TRS',
      origin: 'India',
      category_id: catGrains.id,
      subcategory_id: subDals.id,
      is_featured: true,
      variants: {
        create: [
          { name_es: '500 g', name_en: '500 g', price: 1.99, stock_quantity: 80, is_default: true, sku: 'TRS-CHD-500G' },
          { name_es: '2 kg', name_en: '2 kg', price: 6.49, stock_quantity: 30, sku: 'TRS-CHD-2KG' },
        ],
      },
      images: {
        create: [
          { url: 'https://loremflickr.com/600/600/lentils,daal?lock=12', is_primary: true, sort_order: 0 },
        ],
      },
    },
  });

  // Product 3: Whole Cumin Seeds
  const p3 = await prisma.product.create({
    data: {
      name_es: 'Comino Entero Shan',
      name_en: 'Shan Whole Cumin Seeds',
      description_es: 'Semillas de comino entero de primera calidad. Esencial para templar y cocinar.',
      description_en: 'Premium whole cumin seeds. Essential for tempering and cooking.',
      brand: 'Shan',
      origin: 'Pakistan',
      category_id: catSpices.id,
      subcategory_id: subWhole.id,
      is_featured: true,
      variants: {
        create: [
          { name_es: '100 g', name_en: '100 g', price: 1.49, stock_quantity: 100, is_default: true, sku: 'SHN-CMN-100G' },
          { name_es: '400 g', name_en: '400 g', price: 4.49, stock_quantity: 40, sku: 'SHN-CMN-400G' },
        ],
      },
      images: {
        create: [
          { url: 'https://loremflickr.com/600/600/cumin,spice?lock=13', is_primary: true, sort_order: 0 },
        ],
      },
    },
  });

  // Product 4: Garam Masala
  const p4 = await prisma.product.create({
    data: {
      name_es: 'Garam Masala MDH',
      name_en: 'MDH Garam Masala',
      description_es: 'Mezcla de especias molidas auténtica. El toque final para cualquier curry.',
      description_en: 'Authentic ground spice blend. The finishing touch for any curry.',
      brand: 'MDH',
      origin: 'India',
      category_id: catSpices.id,
      subcategory_id: subGround.id,
      is_featured: false,
      variants: {
        create: [
          { name_es: '100 g', name_en: '100 g', price: 2.29, stock_quantity: 60, is_default: true, sku: 'MDH-GM-100G' },
          { name_es: '500 g', name_en: '500 g', price: 8.99, compare_at_price: 10.49, stock_quantity: 15, sku: 'MDH-GM-500G' },
        ],
      },
      images: {
        create: [
          { url: 'https://loremflickr.com/600/600/garam,masala?lock=14', is_primary: true, sort_order: 0 },
        ],
      },
    },
  });

  // Product 5: Haldiram's Aloo Bhujia
  const p5 = await prisma.product.create({
    data: {
      name_es: "Aloo Bhujia Haldiram's",
      name_en: "Haldiram's Aloo Bhujia",
      description_es: 'Snack crujiente de patata con especias. El favorito de toda la familia.',
      description_en: 'Crispy spiced potato snack. A family favourite.',
      brand: "Haldiram's",
      origin: 'India',
      category_id: catSnacks.id,
      subcategory_id: subNamkeen.id,
      is_featured: true,
      variants: {
        create: [
          { name_es: '200 g', name_en: '200 g', price: 2.49, stock_quantity: 90, is_default: true, sku: 'HLD-AB-200G' },
          { name_es: '400 g', name_en: '400 g', price: 4.29, compare_at_price: 4.99, stock_quantity: 45, sku: 'HLD-AB-400G' },
        ],
      },
      images: {
        create: [
          { url: 'https://loremflickr.com/600/600/indian,snack?lock=15', is_primary: true, sort_order: 0 },
        ],
      },
    },
  });

  // ─── RIDERS (2) ───────────────────────────────────────────

  const riderSeeds = [
    { name: 'Carlos García', phone: '+34612345678', vehicle_type: 'moto' as const },
    { name: 'Ahmed Khan',    phone: '+34698765432', vehicle_type: 'bicicleta' as const },
  ];
  for (const r of riderSeeds) {
    await prisma.rider.upsert({
      where:  { phone: r.phone },
      update: { name: r.name, vehicle_type: r.vehicle_type },
      create: r,
    });
  }

  } // end if (!skipCatalog)

  // ─── ADMIN ──────────────────────────────────────────────

  const adminEmail = 'admin@groceryapp.es';
  const existingAdmin = await prisma.admin.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.admin.create({
      data: {
        name: 'Super Admin',
        email: adminEmail,
        password_hash: await bcrypt.hash('admin1234', 12),
        role: 'super_admin',
      },
    });
    console.log(`   - Admin user: ${adminEmail} / admin1234`);
  }

  // ─── RASHAN PACKS ───────────────────────────────────────
  // Seed two curated templates + a "custom" placeholder. Idempotent — uses
  // upsert by slug so re-running won't duplicate.

  await prisma.rashanPack.upsert({
    where: { slug: 'essentials' },
    create: {
      slug: 'essentials',
      name_es: 'Esencial Mensual',
      name_en: 'Monthly Essentials',
      tagline_es: 'Lo básico para una cocina desi feliz',
      tagline_en: 'The basics for a happy desi kitchen',
      description_es: 'Un paquete cuidadosamente seleccionado con los esenciales que toda cocina del sur de Asia necesita.',
      description_en: 'A carefully curated pack with everything a South Asian kitchen needs.',
      badge_es: 'CESTO ELIGE',
      badge_en: 'CURATED BY CESTO',
      emoji: '🍚',
      gradient: 'linear-gradient(135deg, #022B91 0%, #054EE8 45%, #2A6AEF 100%)',
      accent: 'brand',
      base_price: 58.9,
      estimated_savings_pct: 8,
      household_default: 2,
      highlights_es: ['Marcas de confianza', 'Cubre 30 días para 2-3 personas', 'Personalizable antes de cada entrega'],
      highlights_en: ['Trusted brands', 'Covers 30 days for 2-3 people', 'Customisable before every delivery'],
      items: [], // admin can populate from real catalog
      sort_order: 1,
    },
    // Keep visual fields in sync with the rebrand on every seed run.
    update: {
      gradient: 'linear-gradient(135deg, #022B91 0%, #054EE8 45%, #2A6AEF 100%)',
      accent: 'brand',
    },
  });

  await prisma.rashanPack.upsert({
    where: { slug: 'premium' },
    create: {
      slug: 'premium',
      name_es: 'Premium Mensual',
      name_en: 'Monthly Premium',
      tagline_es: 'Las mejores marcas, sin compromisos',
      tagline_en: 'The finest brands, no compromises',
      description_es: 'Para quienes buscan lo mejor: arroz Tilda Basmati, ghee KTC, especias importadas y dátiles Medjool.',
      description_en: 'For those who want the best: Tilda Basmati rice, KTC ghee, imported spices and Medjool dates.',
      badge_es: 'EL MÁS POPULAR',
      badge_en: 'MOST POPULAR',
      emoji: '✨',
      gradient: 'linear-gradient(135deg, #3E2723 0%, #5D4037 45%, #8D6E63 100%)',
      accent: 'amber',
      base_price: 124.5,
      estimated_savings_pct: 12,
      household_default: 3,
      highlights_es: ['Marcas premium importadas', 'Cubre 30 días para 3-4 personas', 'Incluye snacks y frutos secos'],
      highlights_en: ['Premium imported brands', 'Covers 30 days for 3-4 people', 'Includes snacks & dried fruits'],
      items: [],
      sort_order: 2,
    },
    update: {},
  });

  await prisma.rashanPack.upsert({
    where: { slug: 'custom' },
    create: {
      slug: 'custom',
      name_es: 'Mi Rashan a Medida',
      name_en: 'My Custom Rashan',
      tagline_es: 'Crea tu propio paquete mensual',
      tagline_en: 'Build your own monthly pack',
      description_es: 'Empieza desde cero y añade exactamente lo que tu familia necesita cada mes.',
      description_en: 'Start from scratch and add exactly what your family needs each month.',
      badge_es: 'TÚ ELIGES',
      badge_en: 'YOUR CHOICE',
      emoji: '🛒',
      gradient: 'linear-gradient(135deg, #0D47A1 0%, #1565C0 45%, #1E88E5 100%)',
      accent: 'info',
      base_price: 0,
      estimated_savings_pct: 5,
      household_default: 2,
      highlights_es: ['Elige cualquier producto del catálogo', 'Sin mínimo de pedido', 'Edita la lista cada mes'],
      highlights_en: ['Pick any product from our catalog', 'No minimum order', 'Edit the list every month'],
      items: [],
      is_custom: true,
      sort_order: 3,
    },
    update: {},
  });
  console.log(`   - 3 rashan packs (essentials, premium, custom)`);

  // ─── BANNERS ────────────────────────────────────────────
  // Idempotent: only create if no banners exist yet.
  const bannerCount = await prisma.banner.count();
  if (bannerCount === 0) {
    await prisma.banner.createMany({
      data: [
        {
          title_es: 'Rashan mensual con un 12% de ahorro',
          title_en: 'Monthly Rashan — save 12%',
          subtitle_es: 'Suscríbete y recibe lo esencial cada mes',
          subtitle_en: 'Subscribe and get the essentials delivered each month',
          cta_es: 'Descubrir Rashan',
          cta_en: 'Explore Rashan',
          image_desktop: 'https://loremflickr.com/1600/600/grocery,delivery?lock=21',
          image_mobile: 'https://loremflickr.com/800/600/grocery,delivery?lock=22',
          link_type: 'url',
          link_target: '/rashan',
          display_order: 1,
          is_active: true,
        },
        {
          title_es: 'Envío gratis a partir de 30€',
          title_en: 'Free delivery from €30',
          subtitle_es: 'Madrid Centro · misma tarde si pides antes de las 14:00',
          subtitle_en: 'Madrid Centro · same day if you order before 14:00',
          cta_es: 'Empezar a comprar',
          cta_en: 'Start shopping',
          image_desktop: 'https://loremflickr.com/1600/600/delivery,van?lock=23',
          image_mobile: 'https://loremflickr.com/800/600/delivery,van?lock=24',
          link_type: null,
          link_target: null,
          display_order: 2,
          is_active: true,
        },
      ],
    });
    console.log(`   - 2 banners`);
  }

  // ─── HOME SECTIONS ──────────────────────────────────────
  // Idempotent: populate baked-in defaults for any missing key.
  {
    const { defaultPromoGrid, defaultAdsBanner } = await import('../src/lib/homeSectionsDefaults');
    for (const [key, config] of [
      ['promo-grid', defaultPromoGrid],
      ['ads-banner', defaultAdsBanner],
    ] as const) {
      const { updated_at: _drop, ...rest } = config as Record<string, unknown>;
      await prisma.homeSection.upsert({
        where: { key },
        create: { key, config: rest as object },
        update: {},
      });
    }
    console.log(`   - 2 home sections (promo-grid, ads-banner)`);
  }

  // ─── DEMO CUSTOMER + ADDRESS + ORDERS + SUBSCRIPTION ────
  // Idempotent: keyed by phone. Useful for demo login without
  // going through OTP — credentials: phone +34611111111 / pwd demo1234.

  const demoPhone = '+34611111111';
  const demoUser = await prisma.user.upsert({
    where: { phone: demoPhone },
    create: {
      name: 'Amir Khan',
      phone: demoPhone,
      email: 'demo@groceryapp.es',
      password_hash: await bcrypt.hash('demo1234', 12),
      preferred_language: 'es',
      status: 'active',
    },
    update: {
      // Re-hash if missing so existing demo accounts (without password) can still log in.
      password_hash: await bcrypt.hash('demo1234', 12),
      email: 'demo@groceryapp.es',
    },
  });
  console.log(`   - Demo user: phone ${demoPhone} / email demo@groceryapp.es / pwd demo1234`);

  // Default address inside Madrid Centro (postcode 28004).
  let demoAddress = await prisma.address.findFirst({
    where: { user_id: demoUser.id, is_default: true },
  });
  if (!demoAddress) {
    demoAddress = await prisma.address.create({
      data: {
        user_id: demoUser.id,
        contact_name: 'Amir Khan',
        contact_phone: demoPhone,
        street_line_1: 'Calle de Embajadores 42',
        street_line_2: '3º B',
        postcode: '28004',
        city: 'Madrid',
        province: 'Madrid',
        delivery_notes: 'Portero hasta las 21:00',
        is_default: true,
      },
    });
    console.log(`   - Demo address in Madrid (28004)`);
  }

  // Pre-load variants we want to use in orders. Prefer the original SKUs
  // but fall back to whatever active variants exist with a sensible price.
  // The DB may have been mutated by manual testing.
  const sampleVariants = await prisma.productVariant.findMany({
    where: { is_active: true, price: { gt: 0 } },
    take: 4,
    orderBy: { created_at: 'asc' },
  });
  const v1 = (await prisma.productVariant.findFirst({ where: { sku: 'TLD-BAS-1KG' } })) ?? sampleVariants[0];
  const v2 = (await prisma.productVariant.findFirst({ where: { sku: 'TRS-CHD-500G' } })) ?? sampleVariants[1];
  const v3 = (await prisma.productVariant.findFirst({ where: { sku: 'SHN-CMN-100G' } })) ?? sampleVariants[2];
  const v4 = (await prisma.productVariant.findFirst({ where: { sku: 'HLD-AB-200G' } })) ?? sampleVariants[3];

  // Helper to build an order with two items. Idempotent: skips if order_number exists.
  async function seedOrder(opts: {
    orderNumber: string;
    status: 'pending' | 'confirmed' | 'preparing' | 'on_the_way' | 'delivered' | 'cancelled';
    riderId?: string | null;
    createdDaysAgo: number;
  }) {
    const exists = await prisma.order.findUnique({ where: { order_number: opts.orderNumber } });
    if (exists) return exists;

    if (!v1 || !v2) throw new Error('Demo seed expects products to exist already.');
    const items = [
      { variant: v1, qty: 2 },
      { variant: v2, qty: 1 },
    ];
    const subtotal = items.reduce((s, i) => s + Number(i.variant.price) * i.qty, 0);
    const deliveryFee = subtotal >= 30 ? 0 : 3.5;
    const total = subtotal + deliveryFee;
    const createdAt = new Date(Date.now() - opts.createdDaysAgo * 24 * 60 * 60 * 1000);

    return prisma.order.create({
      data: {
        order_number: opts.orderNumber,
        user_id: demoUser.id,
        address_id: demoAddress!.id,
        address_snapshot: {
          contact_name: demoAddress!.contact_name,
          contact_phone: demoAddress!.contact_phone,
          street_line_1: demoAddress!.street_line_1,
          street_line_2: demoAddress!.street_line_2,
          postcode: demoAddress!.postcode,
          city: demoAddress!.city,
          province: demoAddress!.province,
          delivery_notes: demoAddress!.delivery_notes,
        },
        payment_method: 'cod',
        subtotal,
        delivery_fee: deliveryFee,
        total,
        status: opts.status,
        rider_id: opts.riderId ?? null,
        created_at: createdAt,
        items: {
          create: items.map((i) => ({
            product_id: i.variant.product_id,
            variant_id: i.variant.id,
            product_snapshot: {
              name_es: 'Producto',
              name_en: 'Product',
              variant_name_es: i.variant.name_es,
              variant_name_en: i.variant.name_en,
              sku: i.variant.sku,
            },
            quantity: i.qty,
            unit_price: i.variant.price,
            line_total: Number(i.variant.price) * i.qty,
          })),
        },
      },
    });
  }

  // Find the first rider for assigning to in-progress orders.
  const firstRider = await prisma.rider.findFirst();

  // 5 sample orders in different statuses across the recent timeline.
  await seedOrder({ orderNumber: 'CST-1001', status: 'delivered',  riderId: firstRider?.id, createdDaysAgo: 14 });
  await seedOrder({ orderNumber: 'CST-1002', status: 'delivered',  riderId: firstRider?.id, createdDaysAgo: 7 });
  await seedOrder({ orderNumber: 'CST-1003', status: 'on_the_way', riderId: firstRider?.id, createdDaysAgo: 0 });
  await seedOrder({ orderNumber: 'CST-1004', status: 'preparing',  riderId: null,           createdDaysAgo: 0 });
  await seedOrder({ orderNumber: 'CST-1005', status: 'pending',    riderId: null,           createdDaysAgo: 0 });
  console.log(`   - 5 sample orders (statuses: delivered, delivered, on_the_way, preparing, pending)`);

  // ─── DEMO SUBSCRIPTION + DELIVERIES ─────────────────────
  // One active monthly subscription for the demo user, with a mix of past
  // (delivered) and future (scheduled / awaiting_confirmation) deliveries.

  const essentialsPack = await prisma.rashanPack.findUnique({ where: { slug: 'essentials' } });
  let demoSub = await prisma.rashanSubscription.findFirst({
    where: { user_id: demoUser.id, pack_slug: 'essentials' },
  });
  if (!demoSub && essentialsPack) {
    demoSub = await prisma.rashanSubscription.create({
      data: {
        user_id: demoUser.id,
        pack_id: essentialsPack.id,
        pack_slug: 'essentials',
        items: v1 && v2 && v3
          ? [
              { product_id: v1.product_id, variant_id: v1.id, quantity: 2 },
              { product_id: v2.product_id, variant_id: v2.id, quantity: 3 },
              { product_id: v3.product_id, variant_id: v3.id, quantity: 1 },
            ]
          : [],
        household: 3,
        frequency: 'monthly',
        status: 'active',
        address_id: demoAddress.id,
        slot_preference: 'saturday-10:00',
        payment_method: 'cod',
        next_delivery_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        total_per_cycle: 58.9,
        cycles_completed: 2,
      },
    });
    // Past deliveries (already delivered)
    await prisma.subscriptionDelivery.create({
      data: {
        subscription_id: demoSub.id,
        scheduled_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        status: 'delivered',
        item_count: 6,
        total: 58.9,
        rider_id: firstRider?.id,
        delivered_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.subscriptionDelivery.create({
      data: {
        subscription_id: demoSub.id,
        scheduled_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        status: 'delivered',
        item_count: 6,
        total: 58.9,
        rider_id: firstRider?.id,
        delivered_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    });
    // Upcoming
    await prisma.subscriptionDelivery.create({
      data: {
        subscription_id: demoSub.id,
        scheduled_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        status: 'scheduled',
        item_count: 6,
        total: 58.9,
      },
    });
    console.log(`   - Demo subscription (essentials, monthly) with 3 deliveries`);
  }

  // ─── HELP CENTER ────────────────────────────────────────
  // Idempotent — re-running this script leaves admin-edited
  // articles in place.
  await seedHelpCenter(prisma);

  console.log('✅ Seed complete!');
  console.log(`   - 3 categories, 6 subcategories`);
  console.log(`   - 5 products with 2 variants each (10 variants)`);
  console.log(`   - 2 riders`);
  console.log(`   - 3 rashan packs + demo subscription with 3 deliveries`);
  console.log(`   - Demo customer (phone +34611111111 / email demo@groceryapp.es / pwd demo1234)`);
  console.log(`   - Admin: admin@groceryapp.es / admin1234`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
