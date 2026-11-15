/**
 * Editorial copy the apps render but do not own.
 *
 * Onboarding, About, the Rashan landing page and the home value ribbon were
 * hardcoded in the mobile binary, so correcting a sentence meant a Play build,
 * an upload and a review wait — and the fix only reached people who updated.
 * They now live here, editable in Admin → App content, with the app keeping
 * its bundled copy as an offline fallback.
 *
 * Stored in `AppSetting` under `app_content` (a generic key/JSON table, which
 * is why this needs no migration). A GET never 404s: an unset key returns
 * these defaults, and a stored value is merged over them section by section,
 * so adding a section later cannot break a row saved before it existed.
 *
 * The defaults below are deliberately conservative. Every earlier version of
 * this copy claimed something the code does not do — a 2-hour delivery window,
 * same-day across Madrid, being charged the day before delivery, substituting
 * out-of-stock items. If a sentence here cannot be traced to behaviour in the
 * codebase or to the published terms, it should not be here.
 */

export interface OnboardingSlide {
  /** Stable id; also selects the bundled illustration, which is not editable. */
  key: string;
  eyebrow_es: string;
  eyebrow_en: string;
  /** Two display lines, separated by a newline. */
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
}

export interface AboutValue {
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
}

export interface RashanStep {
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
}

export interface RashanFaq {
  q_es: string;
  q_en: string;
  a_es: string;
  a_en: string;
}

export interface RibbonItem {
  /** One of a fixed set the apps know how to draw; unknown names fall back. */
  icon: string;
  label_es: string;
  label_en: string;
  sub_es: string;
  sub_en: string;
}

export interface AppContent {
  onboarding: { slides: OnboardingSlide[] };
  about: { mission_es: string; mission_en: string; values: AboutValue[] };
  rashan: {
    hero_title_es: string;
    hero_title_en: string;
    hero_body_es: string;
    hero_body_en: string;
    steps: RashanStep[];
    faq: RashanFaq[];
  };
  ribbon: { items: RibbonItem[] };
}

export const APP_CONTENT_KEY = 'app_content';

/** Icon names the apps can render. Anything else falls back to a neutral mark. */
export const RIBBON_ICONS = ['truck', 'wallet', 'shield', 'sparkles', 'clock', 'leaf'] as const;

export const DEFAULT_APP_CONTENT: AppContent = {
  onboarding: {
    slides: [
      {
        key: 'fresh',
        eyebrow_es: 'Bienvenido a Cesto',
        eyebrow_en: 'Welcome to Cesto',
        title_es: 'La compra fresca,\na tu puerta.',
        title_en: 'Fresh groceries,\nquietly delivered.',
        body_es: 'Atta, basmati, especias y todo lo de tu despensa. Añade, ajusta y confirma en segundos.',
        body_en: 'Atta, basmati, spices and the rest of your pantry. Add, fine-tune and check out in seconds.',
      },
      {
        key: 'rashan',
        eyebrow_es: 'Compra del hogar',
        eyebrow_en: 'Home Grocery',
        title_es: 'Una despensa\nsiempre llena.',
        title_en: 'A pantry that\nnever runs empty.',
        body_es: 'Dinos cuántos sois y cada cuánto quieres tu compra. La preparamos con tus marcas de siempre y la pagas al recibirla.',
        body_en: 'Tell us your household and how often you want your grocery. We put it together with your usual brands, and you pay when it arrives.',
      },
      {
        key: 'delivery',
        eyebrow_es: 'Paso a paso',
        eyebrow_en: 'Step by step',
        title_es: 'En tu cocina,\nsin salir de casa.',
        title_en: 'On your counter,\nwithout leaving home.',
        body_es: 'Sigue el estado de tu pedido en cada paso y paga al recibirlo: efectivo o tarjeta.',
        body_en: 'Follow your order at every step and pay when it arrives: cash or card.',
      },
    ],
  },

  about: {
    mission_es: 'Llevar los sabores auténticos del sur de Asia a tu puerta en España. Conectamos a nuestra comunidad con los productos que ama, entregados con cuidado.',
    mission_en: 'Bringing authentic South Asian flavours to your door in Spain. We connect our community with the products they love, delivered with care.',
    values: [
      {
        title_es: 'Productos auténticos',
        title_en: 'Authentic products',
        body_es: 'Una selección de productos del sur de Asia, de proveedores de confianza.',
        body_en: 'A curated selection of South Asian groceries from trusted suppliers.',
      },
      {
        title_es: 'Entrega a domicilio',
        title_en: 'Delivered to your door',
        // Was "Same-day delivery across Madrid. Choose your preferred 2-hour
        // delivery window." There is no slot picker, and delivery is not
        // limited to Madrid.
        body_es: 'Repartimos dentro de nuestras zonas de servicio en España. Indica tu código postal y te diremos si llegamos.',
        body_en: 'We deliver within our published service areas in Spain. Enter your postcode and we will tell you whether we reach you.',
      },
      {
        title_es: 'Paga al recibir',
        title_en: 'Pay on delivery',
        body_es: 'No se introduce ningún dato bancario en la app. Pagas al recibir: efectivo o tarjeta.',
        body_en: 'No bank details are ever entered in the app. You pay on arrival: cash or card.',
      },
      {
        title_es: 'Comunidad primero',
        title_en: 'Community first',
        body_es: 'Creado por y para la comunidad del sur de Asia en España. Tu opinión da forma a lo que vendemos.',
        body_en: 'Built by and for the South Asian community in Spain. Your feedback shapes what we stock.',
      },
    ],
  },

  rashan: {
    hero_title_es: 'Tu despensa, resuelta.',
    hero_title_en: 'Your pantry, handled.',
    hero_body_es: 'Un pack de rashan que llega con la frecuencia que elijas. Sin contratos y sin pagar nada por adelantado.',
    hero_body_en: 'A rashan pack that arrives as often as you choose. No contracts, and nothing paid up front.',
    steps: [
      {
        title_es: 'Elige tu pack',
        title_en: 'Choose your pack',
        body_es: 'Elige el tamaño que encaja con tu hogar y ajusta lo que lleva dentro.',
        body_en: 'Pick the size that fits your household and adjust what goes in it.',
      },
      {
        title_es: 'Elige la frecuencia',
        title_en: 'Pick the cadence',
        body_es: 'Cada dos semanas o cada mes. Puedes pausar, saltar una entrega o cancelar cuando quieras.',
        body_en: 'Every two weeks or every month. Pause, skip a delivery or cancel whenever you like.',
      },
      {
        title_es: 'Paga al recibir',
        title_en: 'Pay at the door',
        body_es: 'Pagas cada entrega cuando llega: efectivo o tarjeta.',
        body_en: 'You pay for each delivery when it arrives: cash or card.',
      },
    ],
    faq: [
      {
        q_es: '¿Puedo cambiar mi suscripción?',
        q_en: 'Can I change my subscription?',
        a_es: 'Sí. Desde la app puedes cambiar el pack y la frecuencia, saltar la próxima entrega, pausarla o cancelarla cuando quieras.',
        a_en: 'Yes. In the app you can change the pack and the cadence, skip the next delivery, pause it or cancel it at any time.',
      },
      {
        q_es: '¿Cómo se paga?',
        q_en: 'How do I pay?',
        // Was "You are charged the day before delivery." Nothing is ever
        // charged in the app; there is no payment gateway.
        a_es: 'No se cobra nada en la app. Pagas cada entrega al recibirla: en efectivo o con tarjeta.',
        a_en: 'Nothing is charged in the app. You pay for each delivery when it arrives: cash or card.',
      },
      {
        q_es: '¿Y si un producto no está disponible?',
        q_en: 'What if a product is unavailable?',
        // Was "We swap it for an equivalent" — the terms promise the opposite.
        a_es: 'Te lo decimos y no lo pagas. Nunca sustituimos un producto por otro sin avisarte.',
        a_en: 'We tell you, and you do not pay for it. We never substitute one product for another without telling you.',
      },
      {
        q_es: '¿Dónde entregáis?',
        q_en: 'Where do you deliver?',
        a_es: 'Repartimos dentro de nuestras zonas de servicio en España. Indica tu código postal y la app te dirá si llegamos hasta ti.',
        a_en: 'We deliver within our published service areas in Spain. Enter your postcode and the app will tell you whether we reach you.',
      },
    ],
  },

  ribbon: {
    items: [
      {
        icon: 'wallet',
        label_es: 'Paga al recibir',
        label_en: 'Pay on delivery',
        sub_es: 'Efectivo o tarjeta',
        sub_en: 'Cash or card',
      },
      {
        icon: 'sparkles',
        label_es: 'Sabores del sur de Asia',
        label_en: 'South Asian groceries',
        sub_es: 'Las marcas que conoces',
        sub_en: 'The brands you know',
      },
    ],
  },
};
