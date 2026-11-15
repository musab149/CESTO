import type { RashanLeadFrequency } from '@grocery-app/shared';

/* ═══════════════════════════════════════════════════════
   HOME GROCERY — words and configuration for /rashan.

   One module for the page, the list card and the form, so a phrase
   used in two places ("Pagas al recibir…") cannot drift between them.

   Every reassurance on this page is a real policy, taken from the
   FAQ and the order flow: pay on delivery (cash or card), refuse
   anything damaged at the door, no substitution without asking, an
   order can be changed until it leaves the shop, no account needed to
   apply. Nothing here promises a price, a delivery time or a fee —
   none of those is fixed for a Home Grocery order.
   ═══════════════════════════════════════════════════════ */

export type Lang = 'es' | 'en';

export const COPY = {
  es: {
    service: 'Compra del hogar',
    heroTitle: ['Atta, arroz, dal y todo lo demás.', 'Cada mes, en tu puerta.'],
    heroBody:
      'Dinos cuántos sois y qué no puede faltar en casa. Nuestro equipo prepara tu compra con tus marcas de siempre y la pagas al recibirla.',
    householdQuestion: '¿Cuántos sois en casa?',
    startRequest: 'Empezar mi solicitud',
    whatsappPrompt: '¿Prefieres hablarlo? Escríbenos por WhatsApp',
    whatsappMessage: 'Hola, quiero información sobre Compra del hogar.',
    trust: [
      'Pagas al recibir, en efectivo o con tarjeta',
      'Sin cuotas ni pagos por adelantado',
      'No necesitas cuenta para pedirlo',
    ],

    basketTitle: (month: string) => `Tu cesta de ${month}`,
    basketLabel: 'Una cesta con atta, arroz basmati, ghee, dal, chai, masala y cilantro.',
    listFor: (n: number) => (n >= 7 ? 'Para 7 personas o más' : `Para ${n} personas`),

    howTitle: 'Cómo funciona',
    howLead: 'Tres pasos, y nosotros hacemos el resto.',
    how: [
      {
        title: 'Nos cuentas cómo es tu casa',
        body: 'Cuántos sois, cada cuánto quieres tu compra y dónde vives. Son dos minutos.',
      },
      {
        title: 'La revisamos y te escribimos',
        body: 'Una persona del equipo mira cada solicitud. Si no tienes cuenta, te la creamos y te enviamos el acceso por email.',
      },
      {
        title: 'Preparamos tu compra',
        body: 'Montamos cada pedido para tu hogar y te avisamos de cada paso. Lo pagas al recibirlo.',
      },
    ],

    brandsTitle: 'Tus marcas de siempre',
    brandsBody: 'Las mismas que compras ahora, en los tamaños que usa una familia.',
    brandsAll: 'Ver todas las marcas',

    careTitle: 'Así cuidamos tu compra',
    careLead: 'En cada pedido, también en el primero.',
    care: [
      { title: 'La pagas al recibirla', body: 'En efectivo o con tarjeta, en la puerta. Nunca introduces datos bancarios.' },
      { title: 'La revisas antes de pagar', body: 'Si algo llega dañado o caducado, lo rechazas y no lo pagas.' },
      { title: 'Nada cambia sin avisarte', body: 'Si falta un producto te lo decimos. No lo cambiamos por otro sin preguntarte.' },
      { title: 'Tu pedido, a tu manera', body: 'Puedes cambiar cada pedido hasta que sale hacia tu casa.' },
    ],

    formTitle: 'Tu solicitud',
    formBody: 'Tres pasos cortos. Te respondemos por email.',
    steps: ['Tu casa', 'Dónde', 'Contacto'],
    stepOf: (i: number, n: number) => `Paso ${i} de ${n}`,
    now: 'Ahora',
    household: 'Personas en casa',
    fewer: 'Menos personas',
    more: 'Más personas',
    frequency: '¿Cada cuánto quieres tu compra?',
    notes: '¿Algo más que debamos saber?',
    notesPlaceholder: 'Halal, sin vacuno, alergias, marcas favoritas, tamaños…',
    addressIntro: 'Para saber si llegamos y preparar tu entrega.',
    address: 'Dirección',
    addressPlaceholder: 'Calle Mayor 12, 3º B',
    postcode: 'Código postal',
    postcodePlaceholder: '28013',
    city: 'Ciudad',
    cityPlaceholder: 'Madrid',
    contactIntro: 'Así te contestamos. Nunca compartimos tus datos.',
    name: 'Nombre y apellidos',
    namePlaceholder: 'Ej. Ayesha Khan',
    phone: 'Móvil o WhatsApp',
    phonePlaceholder: '600 123 456',
    email: 'Email',
    emailPlaceholder: 'tucorreo@ejemplo.com',
    emailHint: 'Aquí te escribimos. Si no tienes cuenta, aquí te llega el acceso.',
    back: 'Atrás',
    next: 'Continuar',
    submit: 'Enviar solicitud',
    errName: 'Escribe tu nombre.',
    errPhone: 'Necesitamos un móvil para contactarte.',
    errEmail: 'Escribe un email válido, por ejemplo nombre@gmail.com.',
    errAddress: 'Escribe tu calle y número.',
    errPostcode: 'Escribe tu código postal.',
    errCity: 'Escribe tu ciudad.',
    errSubmit: 'No se ha podido enviar. Revisa tu conexión e inténtalo de nuevo.',
    errAlready: 'Ya tenemos una solicitud tuya. Te enseñamos en qué punto está.',

    summaryTitle: 'Tu lista',
    summaryPeople: (n: number) => (n === 1 ? '1 persona' : `${n} personas`),

    sentTitle: 'Solicitud enviada',
    sentBody: (email: string) => `La revisamos y te escribimos a ${email}.`,
    sentNewAccount: 'Si la aprobamos y aún no tienes cuenta, te enviaremos el acceso a ese mismo email.',
    timeline: ['Recibida', 'En revisión', 'Te respondemos por email'],
    today: 'Hoy',
    keepShopping: 'Seguir comprando',

    pendingTitle: 'Tu solicitud está en revisión',
    pendingBody: (date: string, email: string | null) =>
      email
        ? `La enviaste el ${date}. Te escribiremos a ${email} en cuanto la revisemos.`
        : `La enviaste el ${date}. Te escribiremos en cuanto la revisemos.`,
    pendingCardTitle: 'Estado de tu solicitud',

    rejectedTitle: 'No pudimos aprobar tu última solicitud',
    rejectedReason: 'Motivo',
    rejectedAgain: 'Si algo ha cambiado, envíanos una nueva solicitud.',
    rejectedCta: 'Enviar una nueva solicitud',

    legacyOne: 'Tienes una suscripción del sistema anterior.',
    legacyMany: (n: number) => `Tienes ${n} suscripciones del sistema anterior.`,
    legacyManage: 'Gestionarla',

    faqTitle: 'Preguntas frecuentes',
    faqLead: 'Lo que suelen preguntarnos antes de pedirlo.',
    helpTitle: '¿Tienes otra pregunta?',
    helpBody: 'Escríbenos por WhatsApp y te contesta una persona del equipo.',
    helpCta: 'Escribir por WhatsApp',
    helpAll: 'Ver todas las preguntas frecuentes',
    faq: [
      {
        q: '¿Necesito una cuenta para pedirlo?',
        a: 'No. Si aprobamos tu solicitud y no tienes cuenta, te la creamos y te enviamos el acceso por email. Si ya tienes una, usamos esa.',
      },
      {
        q: '¿Cuánto cuesta?',
        a: 'Pagas cada pedido al recibirlo: los productos y, si lo hay, el envío. En efectivo o con tarjeta. No hay cuotas ni pagos por adelantado.',
      },
      {
        q: '¿Cómo sé si me han aprobado?',
        a: 'Te escribimos por email, y si tienes cuenta también te llega una notificación. Si no podemos aprobarla, te explicamos el motivo.',
      },
      {
        q: '¿Puedo cambiar o parar mi compra?',
        a: 'Sí. Puedes cambiar cada pedido hasta que sale hacia tu casa. Si quieres parar, nos lo dices y no preparamos más.',
      },
      {
        q: '¿A qué zonas llegáis?',
        a: 'Repartimos dentro de nuestras zonas de servicio en España. Pon tu código postal en la solicitud y te diremos si llegamos.',
      },
    ],

    finalTitle: ['La despensa llena,', 'sin listas en la nevera.'],
    finalBody: 'Una solicitud y nuestro equipo se encarga de la compra de tu casa.',
    noteTitle: 'Lista de la compra',
    noteItems: ['Atta, 10 kg', 'Arroz basmati, 5 kg', 'Dal masoor', 'Ghee', 'Té para el chai', 'Garam masala'],
    noteStamp: 'Lo hacemos nosotros',
    noteLabel: 'La lista de la compra de la nevera, con todo tachado: lo hacemos nosotros.',
  },

  en: {
    service: 'Home Grocery',
    heroTitle: ['Atta, rice, dal and everything else.', 'Every month, at your door.'],
    heroBody:
      "Tell us how many you are and what your home can't run out of. Our team puts your order together with the brands you know, and you pay when it arrives.",
    householdQuestion: 'How many of you are at home?',
    startRequest: 'Start my request',
    whatsappPrompt: 'Rather talk it through? Message us on WhatsApp',
    whatsappMessage: "Hi, I'd like to know more about Home Grocery.",
    trust: [
      'Pay on delivery, cash or card',
      'No fees or payments in advance',
      "You don't need an account to apply",
    ],

    basketTitle: (month: string) => `Your ${month} basket`,
    basketLabel: 'A basket with atta, basmati rice, ghee, dal, chai, masala and coriander.',
    listFor: (n: number) => (n >= 7 ? 'For 7 people or more' : `For ${n} people`),

    howTitle: 'How it works',
    howLead: 'Three steps, and we take it from there.',
    how: [
      {
        title: 'Tell us about your home',
        body: 'How many you are, how often you want your grocery and where you live. It takes two minutes.',
      },
      {
        title: 'We review it and write to you',
        body: "A person on our team reads every request. If you don't have an account, we open one and email you the login.",
      },
      {
        title: 'We put your grocery together',
        body: 'We build each order for your household and keep you posted at every step. You pay when it arrives.',
      },
    ],

    brandsTitle: 'The brands you already buy',
    brandsBody: 'The same ones you shop for now, in the sizes a family actually uses.',
    brandsAll: 'See all brands',

    careTitle: 'How we look after your order',
    careLead: 'On every order, the first one included.',
    care: [
      { title: 'You pay when it arrives', body: 'Cash or card, at the door. You never enter bank details.' },
      { title: 'You check it before paying', body: "If anything arrives damaged or out of date, refuse it and you don't pay for it." },
      { title: 'Nothing changes without asking', body: "If something is missing we tell you. We never swap it for something else without checking." },
      { title: 'Your order, your way', body: 'You can change any order until it leaves for your home.' },
    ],

    formTitle: 'Your request',
    formBody: "Three short steps. We'll reply by email.",
    steps: ['Your home', 'Where', 'Contact'],
    stepOf: (i: number, n: number) => `Step ${i} of ${n}`,
    now: 'Now',
    household: 'People at home',
    fewer: 'Fewer people',
    more: 'More people',
    frequency: 'How often do you want your grocery?',
    notes: 'Anything else we should know?',
    notesPlaceholder: 'Halal, no beef, allergies, favourite brands, pack sizes…',
    addressIntro: 'So we can check we reach you and plan your delivery.',
    address: 'Address',
    addressPlaceholder: 'Calle Mayor 12, 3º B',
    postcode: 'Postcode',
    postcodePlaceholder: '28013',
    city: 'City',
    cityPlaceholder: 'Madrid',
    contactIntro: 'This is how we reply. We never share your details.',
    name: 'Full name',
    namePlaceholder: 'e.g. Ayesha Khan',
    phone: 'Mobile or WhatsApp',
    phonePlaceholder: '600 123 456',
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    emailHint: "We'll write to you here. If you don't have an account, your login comes here too.",
    back: 'Back',
    next: 'Continue',
    submit: 'Send request',
    errName: 'Enter your name.',
    errPhone: 'We need a mobile number to reach you.',
    errEmail: 'Enter a valid email, for example name@gmail.com.',
    errAddress: 'Enter your street and number.',
    errPostcode: 'Enter your postcode.',
    errCity: 'Enter your city.',
    errSubmit: "Your request didn't send. Check your connection and try again.",
    errAlready: 'We already have a request from you. Showing you where it is.',

    summaryTitle: 'Your list',
    summaryPeople: (n: number) => (n === 1 ? '1 person' : `${n} people`),

    sentTitle: 'Request sent',
    sentBody: (email: string) => `We'll review it and write to you at ${email}.`,
    sentNewAccount: "If we approve it and you don't have an account yet, we'll send your login to that same email.",
    timeline: ['Received', 'In review', 'We reply by email'],
    today: 'Today',
    keepShopping: 'Keep shopping',

    pendingTitle: 'Your request is in review',
    pendingBody: (date: string, email: string | null) =>
      email
        ? `You sent it on ${date}. We'll write to ${email} as soon as we've reviewed it.`
        : `You sent it on ${date}. We'll write to you as soon as we've reviewed it.`,
    pendingCardTitle: 'Where your request is',

    rejectedTitle: "We couldn't approve your last request",
    rejectedReason: 'Reason',
    rejectedAgain: 'If something has changed, send us a new request.',
    rejectedCta: 'Send a new request',

    legacyOne: 'You have a subscription from the previous system.',
    legacyMany: (n: number) => `You have ${n} subscriptions from the previous system.`,
    legacyManage: 'Manage it',

    faqTitle: 'Common questions',
    faqLead: 'What people usually ask before applying.',
    helpTitle: 'Got another question?',
    helpBody: 'Message us on WhatsApp and a person on our team will reply.',
    helpCta: 'Message us on WhatsApp',
    helpAll: 'See all FAQs',
    faq: [
      {
        q: 'Do I need an account to apply?',
        a: "No. If we approve your request and you don't have an account, we open one and email you the login. If you already have one, we use it.",
      },
      {
        q: 'How much does it cost?',
        a: 'You pay for each order when it arrives: the products and, if there is one, delivery. Cash or card. No fees, nothing in advance.',
      },
      {
        q: 'How will I know if I am approved?',
        a: "We email you, and if you have an account you also get a notification. If we can't approve it, we tell you why.",
      },
      {
        q: 'Can I change or stop my grocery?',
        a: "Yes. You can change any order until it leaves for your home. If you want to stop, tell us and we won't prepare any more.",
      },
      {
        q: 'Which areas do you deliver to?',
        a: "We deliver within our service areas in Spain. Put your postcode in the request and we'll tell you if we reach you.",
      },
    ],

    finalTitle: ['A full pantry,', 'without the list on the fridge.'],
    finalBody: "One request and our team looks after your home's grocery.",
    noteTitle: 'Shopping list',
    noteItems: ['Atta, 10 kg', 'Basmati rice, 5 kg', 'Masoor dal', 'Ghee', 'Tea for chai', 'Garam masala'],
    noteStamp: "We've got it",
    noteLabel: "The shopping list from the fridge, every line crossed off: we've got it.",
  },
};

export type HomeGroceryCopy = (typeof COPY)['es'];

export const FREQUENCIES: { id: RashanLeadFrequency; es: string; en: string }[] = [
  { id: 'weekly',        es: 'Cada semana',    en: 'Every week' },
  { id: 'biweekly',      es: 'Cada 2 semanas', en: 'Every 2 weeks' },
  { id: 'every_3_weeks', es: 'Cada 3 semanas', en: 'Every 3 weeks' },
  { id: 'monthly',       es: 'Cada 4 semanas', en: 'Every 4 weeks' },
];

/** Hero household choices. 7 stands for "7 or more". */
export const HOUSEHOLD_CHOICES = [2, 3, 4, 5, 6, 7] as const;

/** The brands strip — slugs as stored in /api/brands. Missing ones are skipped. */
export const BRAND_SLUGS = [
  'national', 'shan', 'heera', 'laziza', 'mdh', 'trs', 'haldiram',
  'ahmed', 'aashirvaad', 'tilda', 'tapal', 'everest',
];
