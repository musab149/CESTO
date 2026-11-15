import { PrismaClient } from '@prisma/client';

/* ─────────────────────────────────────────────────────────
   Help Center seed
   Idempotent: skips entirely if categories already exist.
   Seeds the 8 Walmart-style categories from the spec plus
   ~90 article stubs. Bodies are short placeholders — admin
   fills the real copy from /help-center.
   ───────────────────────────────────────────────────────── */

interface SeedArticle {
  slug: string;
  title_en: string;
  title_es: string;
}

interface SeedCategory {
  slug: string;
  title_en: string;
  title_es: string;
  icon: string;
  articles: SeedArticle[];
}

const placeholderBody = (titleEn: string) =>
  `## About this topic\n\nThis article will explain everything you need to know about **${titleEn.toLowerCase()}**. The Cesto team is preparing the full content.\n\n### What you'll find here\n\n- Step-by-step instructions\n- Common questions answered\n- Direct links to the relevant pages\n\n### Need more help?\n\nIf you can't find what you're looking for, [contact our support team](/contact) and we'll get back to you within 24 hours.`;

const placeholderBodyEs = (titleEs: string) =>
  `## Sobre este tema\n\nEste artículo te explicará todo lo que necesitas saber sobre **${titleEs.toLowerCase()}**. El equipo de Cesto está preparando el contenido completo.\n\n### Qué encontrarás aquí\n\n- Instrucciones paso a paso\n- Preguntas frecuentes respondidas\n- Enlaces directos a las páginas relevantes\n\n### ¿Necesitas más ayuda?\n\nSi no encuentras lo que buscas, [contacta con nuestro equipo de soporte](/contact) y te responderemos en menos de 24 horas.`;

const HELP_CENTER_SEED: SeedCategory[] = [
  {
    slug: 'about-cesto',
    title_en: 'About Cesto',
    title_es: 'Sobre Cesto',
    icon: 'Sparkles',
    articles: [
      { slug: 'about-cesto-overview',          title_en: 'About Cesto',                       title_es: 'Sobre Cesto' },
      { slug: 'mission-vision',                title_en: 'Our Mission & Vision',              title_es: 'Nuestra misión y visión' },
      { slug: 'cesto-grocery',                 title_en: 'Cesto Grocery',                     title_es: 'Cesto Supermercado' },
      { slug: 'cesto-mall',                    title_en: 'Cesto Mall',                        title_es: 'Cesto Mall' },
      { slug: 'how-cesto-works',               title_en: 'How Cesto Works',                   title_es: 'Cómo funciona Cesto' },
      { slug: 'affiliate-partner-program',     title_en: 'Affiliate & Partner Program',       title_es: 'Programa de afiliados y partners' },
      { slug: 'seller-vendor-network',         title_en: 'Seller & Vendor Network',           title_es: 'Red de vendedores y proveedores' },
      { slug: 'expansion-strategy',            title_en: 'Expansion Strategy',                title_es: 'Estrategia de expansión' },
      { slug: 'sustainability-community',      title_en: 'Sustainability & Community Impact', title_es: 'Sostenibilidad e impacto en la comunidad' },
    ],
  },
  {
    slug: 'orders-delivery',
    title_en: 'Orders & Delivery',
    title_es: 'Pedidos y entrega',
    icon: 'Package',
    articles: [
      { slug: 'order-tracking',         title_en: 'Order Tracking',            title_es: 'Seguimiento de pedidos' },
      { slug: 'modify-cancel-orders',   title_en: 'Modify or Cancel Orders',   title_es: 'Modificar o cancelar pedidos' },
      { slug: 'delivery-updates',       title_en: 'Delivery Updates',          title_es: 'Actualizaciones de entrega' },
      { slug: 'delayed-orders',         title_en: 'Delayed Orders',            title_es: 'Pedidos retrasados' },
      { slug: 'missing-damaged-items',  title_en: 'Missing or Damaged Items',  title_es: 'Artículos faltantes o dañados' },
      { slug: 'order-not-received',     title_en: 'Order Not Received',        title_es: 'Pedido no recibido' },
      { slug: 'reorder-products',       title_en: 'Reorder Products',          title_es: 'Volver a pedir productos' },
      { slug: 'pickup-services',        title_en: 'Pickup Services',           title_es: 'Servicios de recogida' },
      { slug: 'home-delivery-services', title_en: 'Home Delivery Services',    title_es: 'Servicios de entrega a domicilio' },
      { slug: 'delivery-instructions',  title_en: 'Delivery Instructions',     title_es: 'Instrucciones de entrega' },
      { slug: 'address-management',     title_en: 'Address Management',        title_es: 'Gestión de direcciones' },
      { slug: 'customer-support-orders',title_en: 'Customer Support for Orders',title_es: 'Atención al cliente para pedidos' },
      { slug: 'delivery-partner-services', title_en: 'Delivery Partner Services', title_es: 'Servicios para partners de entrega' },
    ],
  },
  {
    slug: 'account-payments',
    title_en: 'Account & Payments',
    title_es: 'Cuenta y pagos',
    icon: 'CreditCard',
    articles: [
      { slug: 'create-account',         title_en: 'Create Your Account',       title_es: 'Crear tu cuenta' },
      { slug: 'manage-profile',         title_en: 'Manage Your Profile',       title_es: 'Gestionar tu perfil' },
      { slug: 'account-security',       title_en: 'Account Security',          title_es: 'Seguridad de la cuenta' },
      { slug: 'password-login-support', title_en: 'Password & Login Support',   title_es: 'Soporte de contraseña e inicio de sesión' },
      { slug: 'payment-methods',        title_en: 'Payment Methods',           title_es: 'Métodos de pago' },
      { slug: 'wallet-rewards',         title_en: 'Wallet & Rewards',          title_es: 'Monedero y recompensas' },
      { slug: 'billing-information',    title_en: 'Billing Information',       title_es: 'Información de facturación' },
      { slug: 'taxes-invoices',         title_en: 'Taxes & Invoices',          title_es: 'Impuestos y facturas' },
      { slug: 'purchase-history',       title_en: 'Purchase History',          title_es: 'Historial de compras' },
      { slug: 'payment-verification',   title_en: 'Payment Verification',      title_es: 'Verificación de pago' },
      { slug: 'subscription-management',title_en: 'Subscription Management',   title_es: 'Gestión de suscripciones' },
      { slug: 'regional-settings',      title_en: 'Regional Settings',         title_es: 'Configuración regional' },
    ],
  },
  {
    slug: 'returns-refunds',
    title_en: 'Returns & Refunds',
    title_es: 'Devoluciones y reembolsos',
    icon: 'RotateCcw',
    articles: [
      { slug: 'return-policy',          title_en: 'Return Policy',             title_es: 'Política de devoluciones' },
      { slug: 'request-return',         title_en: 'Request a Return',          title_es: 'Solicitar una devolución' },
      { slug: 'refund-process',         title_en: 'Refund Process',            title_es: 'Proceso de reembolso' },
      { slug: 'exchange-options',       title_en: 'Exchange Options',          title_es: 'Opciones de cambio' },
      { slug: 'marketplace-return-rules', title_en: 'Marketplace Return Rules', title_es: 'Reglas de devolución del marketplace' },
      { slug: 'non-returnable-products', title_en: 'Non-Returnable Products',  title_es: 'Productos no retornables' },
      { slug: 'warranty-claims',        title_en: 'Warranty Claims',           title_es: 'Reclamaciones de garantía' },
      { slug: 'damaged-product-claims', title_en: 'Damaged Product Claims',    title_es: 'Reclamaciones de producto dañado' },
    ],
  },
  {
    slug: 'shopping-with-cesto',
    title_en: 'Shopping with Cesto',
    title_es: 'Comprar con Cesto',
    icon: 'ShoppingBag',
    articles: [
      { slug: 'shopping-guide',         title_en: 'Shopping Guide',            title_es: 'Guía de compras' },
      { slug: 'international-orders',   title_en: 'International Orders',      title_es: 'Pedidos internacionales' },
      { slug: 'promotions-special-offers', title_en: 'Promotions & Special Offers', title_es: 'Promociones y ofertas especiales' },
      { slug: 'gift-purchases',         title_en: 'Gift Purchases',            title_es: 'Compras de regalo' },
      { slug: 'wishlist-management',    title_en: 'Wishlist Management',       title_es: 'Gestión de favoritos' },
      { slug: 'product-availability',   title_en: 'Product Availability',      title_es: 'Disponibilidad de productos' },
      { slug: 'bulk-orders',            title_en: 'Bulk Orders',               title_es: 'Pedidos al por mayor' },
      { slug: 'customer-reviews',       title_en: 'Customer Reviews',          title_es: 'Reseñas de clientes' },
      { slug: 'product-quality-standards', title_en: 'Product Quality Standards', title_es: 'Estándares de calidad' },
      { slug: 'food-grocery-safety',    title_en: 'Food & Grocery Safety',     title_es: 'Seguridad alimentaria' },
      { slug: 'registry-gift-lists',    title_en: 'Registry & Gift Lists',     title_es: 'Listas de regalos' },
      { slug: 'seasonal-campaigns',     title_en: 'Seasonal Campaigns',        title_es: 'Campañas de temporada' },
    ],
  },
  {
    slug: 'terms-conditions',
    title_en: 'Terms & Conditions',
    title_es: 'Términos y condiciones',
    icon: 'FileText',
    articles: [
      { slug: 'platform-terms',         title_en: 'Platform Terms of Use',     title_es: 'Términos de uso de la plataforma' },
      { slug: 'buyer-terms',            title_en: 'Buyer Terms',               title_es: 'Términos del comprador' },
      { slug: 'seller-terms',           title_en: 'Seller Terms',              title_es: 'Términos del vendedor' },
      { slug: 'affiliate-terms',        title_en: 'Affiliate Terms',           title_es: 'Términos del programa de afiliados' },
      { slug: 'delivery-service-terms', title_en: 'Delivery Service Terms',    title_es: 'Términos del servicio de entrega' },
      { slug: 'subscription-terms',     title_en: 'Subscription Terms',        title_es: 'Términos de suscripción' },
      { slug: 'gift-card-terms',        title_en: 'Gift Card Terms',           title_es: 'Términos de tarjetas regalo' },
      { slug: 'rewards-program-terms',  title_en: 'Rewards Program Terms',     title_es: 'Términos del programa de recompensas' },
      { slug: 'user-content-guidelines', title_en: 'User Content Guidelines',  title_es: 'Directrices de contenido del usuario' },
      { slug: 'promotions-campaign-rules', title_en: 'Promotions & Campaign Rules', title_es: 'Reglas de promociones y campañas' },
      { slug: 'international-order-terms', title_en: 'International Order Terms', title_es: 'Términos de pedidos internacionales' },
    ],
  },
  {
    slug: 'policies-guidelines',
    title_en: 'Policies & Guidelines',
    title_es: 'Políticas y directrices',
    icon: 'Lock',
    articles: [
      { slug: 'privacy-policy',         title_en: 'Privacy Policy',            title_es: 'Política de privacidad' },
      { slug: 'cookie-policy',          title_en: 'Cookie Policy',             title_es: 'Política de cookies' },
      { slug: 'marketplace-policy',     title_en: 'Marketplace Policy',        title_es: 'Política del marketplace' },
      { slug: 'pricing-policy',         title_en: 'Pricing Policy',            title_es: 'Política de precios' },
      { slug: 'intellectual-property-policy', title_en: 'Intellectual Property Policy', title_es: 'Política de propiedad intelectual' },
      { slug: 'accessibility-policy',   title_en: 'Accessibility Policy',      title_es: 'Política de accesibilidad' },
      { slug: 'community-standards',    title_en: 'Community Standards',       title_es: 'Normas de la comunidad' },
      { slug: 'responsible-disclosure-policy', title_en: 'Responsible Disclosure Policy', title_es: 'Política de divulgación responsable' },
      { slug: 'environmental-recycling-policy', title_en: 'Environmental & Recycling Policy', title_es: 'Política ambiental y de reciclaje' },
      { slug: 'data-protection-policy', title_en: 'Data Protection Policy',    title_es: 'Política de protección de datos' },
      { slug: 'consumer-rights-policy', title_en: 'Consumer Rights Policy',    title_es: 'Política de derechos del consumidor' },
    ],
  },
  {
    slug: 'marketplace',
    title_en: 'Marketplace',
    title_es: 'Marketplace',
    icon: 'Store',
    articles: [
      { slug: 'marketplace-overview',    title_en: 'Marketplace Overview',          title_es: 'Resumen del marketplace' },
      { slug: 'become-a-seller',         title_en: 'Become a Seller',               title_es: 'Conviértete en vendedor' },
      { slug: 'seller-performance-standards', title_en: 'Seller Performance Standards', title_es: 'Estándares de rendimiento del vendedor' },
      { slug: 'seller-reviews-ratings',  title_en: 'Seller Reviews & Ratings',      title_es: 'Reseñas y valoraciones de vendedores' },
      { slug: 'report-marketplace-issues', title_en: 'Report Marketplace Issues',   title_es: 'Reportar problemas del marketplace' },
      { slug: 'product-listing-standards', title_en: 'Product Listing Standards',   title_es: 'Estándares de listado de productos' },
      { slug: 'product-condition-guidelines', title_en: 'Product Condition Guidelines', title_es: 'Directrices de condición del producto' },
      { slug: 'category-specific-selling-rules', title_en: 'Category-Specific Selling Rules', title_es: 'Reglas de venta específicas por categoría' },
      { slug: 'large-item-delivery-guidelines', title_en: 'Large Item Delivery Guidelines', title_es: 'Directrices de entrega de artículos grandes' },
      { slug: 'marketplace-dispute-resolution', title_en: 'Marketplace Dispute Resolution', title_es: 'Resolución de disputas del marketplace' },
      { slug: 'vendor-resource-center',  title_en: 'Vendor Resource Center',        title_es: 'Centro de recursos para proveedores' },
    ],
  },
];

export async function seedHelpCenter(prisma: PrismaClient) {
  const existing = await prisma.helpCategory.count();
  if (existing > 0) {
    console.log('   - Help Center already populated, skipping.');
    return;
  }

  let totalArticles = 0;
  for (let catIdx = 0; catIdx < HELP_CENTER_SEED.length; catIdx++) {
    const cat = HELP_CENTER_SEED[catIdx];
    const created = await prisma.helpCategory.create({
      data: {
        slug: cat.slug,
        title_en: cat.title_en,
        title_es: cat.title_es,
        icon: cat.icon,
        sort_order: catIdx + 1,
      },
    });

    for (let i = 0; i < cat.articles.length; i++) {
      const a = cat.articles[i];
      await prisma.helpArticle.create({
        data: {
          category_id: created.id,
          slug: a.slug,
          title_en: a.title_en,
          title_es: a.title_es,
          body_en: placeholderBody(a.title_en),
          body_es: placeholderBodyEs(a.title_es),
          sort_order: i + 1,
        },
      });
      totalArticles++;
    }
  }
  console.log(`   - ${HELP_CENTER_SEED.length} help categories, ${totalArticles} article stubs`);
}
