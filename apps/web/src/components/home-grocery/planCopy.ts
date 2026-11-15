import type { DeliveryWindow, PlanDeliveryRow, PlanFrequency, PlanHistoryFilter } from '@grocery-app/shared';

/* ═══════════════════════════════════════════════════════
   HOME GROCERY — the words of a household's Home Grocery page
   (/profile/home-grocery): its orders and its delivery information.

   There is no plan (2026-10-23). An approved household shops like anyone
   else and every order it places — or we or its rep place for it — is a
   Home Grocery order with its own day and part of the day. What it told us
   in its request — how often, which day, which part of the day, where —
   suggests them. Nobody is reminded. Prices are estimates until we prepare
   an order, and they pay on delivery.
   ═══════════════════════════════════════════════════════ */

export type Lang = 'es' | 'en';

export const PLAN_COPY = {
  es: {
    myPlan: 'Mi compra del hogar',
    profile: 'Mi cuenta',
    member: 'Eres un hogar de Compra del hogar: todos tus pedidos lo son.',
    memberSince: (date: string) => `Eres un hogar de Compra del hogar desde ${date}: todos tus pedidos lo son.`,
    householdTitle: 'En casa',
    householdCount: (n: number) => (n === 1 ? '1 persona' : `${n} personas`),
    tabs: { orders: 'Pedidos', details: 'Datos de entrega' },

    infoBanner: 'Compra como siempre: lo que añades va a tu lista de la compra, y al hacer el pedido eliges el día y la hora. Te los proponemos según tus datos de entrega, y en cada pedido puedes elegir otros.',

    upcomingStatus: {
      draft: 'Previsto',
      pending: 'Pendiente',
      confirmed: 'Confirmado',
      preparing: 'Preparando',
      on_the_way: 'En camino',
    } as Record<string, string>,
    upcomingNote: {
      draft: 'Lo prepararemos para ese día.',
      pending: 'Lo hemos recibido. Puedes cambiar los productos o el día hasta que empecemos a prepararlo.',
      confirmed: 'Está confirmado. Puedes cambiar los productos o el día hasta que empecemos a prepararlo.',
      preparing: 'Lo estamos preparando.',
      on_the_way: 'Va de camino.',
    } as Record<string, string>,
    viewOrder: 'Ver el pedido',
    home: 'Inicio',
    deliveryTitle: 'Tus datos de entrega',
    editSettings: 'Cambiar datos',
    noAddressSet: 'Sin dirección',
    deliveryFee: 'Envío',
    feeLater: 'Lo añadimos en breve',
    colProduct: 'Producto',
    colPrice: 'Precio',
    colQty: 'Cantidad',
    colTotal: 'Total',
    colDate: 'Fecha prevista',
    colOrder: 'Pedido',
    colItems: 'Productos',
    colStatus: 'Estado',
    summaryTitle: 'Resumen',
    howItWorks: 'Cómo funciona',
    noUpcoming: 'Aún no hay ninguna entrega prevista.',
    newOrder: 'Ir a comprar',
    slotDayTitle: 'Día de entrega',
    moreDays: 'Más días',
    notesTitle: 'Nota para el repartidor',
    notesPlaceholder: 'Timbre, piso, cuándo no estás…',
    shortfallTitle: 'No tenemos bastante de algunos productos',
    openTitle: 'Pedidos en curso',
    noOpen: 'No tienes ningún pedido en curso.',
    changeSlot: 'Cambiar día y hora',
    slotSaved: 'Día y hora cambiados',
    listCardTitle: 'Tu lista de la compra',
    listCount: (n: number) => (n === 1 ? '1 producto' : `${n} productos`),
    listEmpty: 'Está vacía. Añade productos mientras compras, o repite un pedido anterior.',
    viewList: 'Ver mi lista',
    placeFromList: 'Hacer mi pedido',
    repeatLast: 'Repetir mi último pedido',
    editProducts: 'Editar productos',
    editShort: 'Editar',
    reorderShort: 'Repetir',
    colActions: 'Acciones',
    shortfallLine: (name: string, n: number) => `${name}: quedan ${n}`,
    settingsSaved: 'Datos guardados',
    // Items
    cancel: 'Cancelar',
    save: 'Guardar cambios',
    saving: 'Guardando…',
    editItems: 'Cambiar productos',
    estTotal: 'Total estimado',
    // An order under way, as a card
    steps: { pending: 'Recibido', confirmed: 'Confirmado', preparing: 'Preparando', on_the_way: 'En camino', delivered: 'Entregado' } as Record<string, string>,
    feeLaterLine: 'Envío: lo añadimos en breve',
    feeIncludedLine: (fee: string) => `Envío de ${fee} incluido`,
    changeDay: 'Cambiar día',
    noOrdersYet: 'Todavía no tienes pedidos.',
    otherOrdersTitle: 'Pedidos anteriores',
    otherOrdersLead: 'De antes de tu compra del hogar.',
    allYourOrders: 'Todos tus pedidos son de tu compra del hogar: ábrelos, cámbialos mientras se pueda o repítelos.',
    itemsCount: (n: number) => (n === 1 ? '1 producto' : `${n} productos`),
    // Settings
    settingsLead: 'Lo que nos contaste en tu solicitud. Lo usamos para proponerte el día y la hora de cada pedido, y puedes cambiarlo cuando quieras.',
    freqTitle: 'Cada cuánto',
    freqLead: 'Cada cuánto sueles comprar.',
    dayTitle: 'Día preferido',
    dayLead: 'Lo proponemos como día de cada pedido; en cada uno puedes elegir otro.',
    noDay: 'Cualquiera',
    windowTitle: 'Momento del día',
    windowLead: 'Lo proponemos como hora de cada pedido; en cada uno puedes elegir otra.',
    noWindow: 'Cualquier hora',
    addressTitle: 'Dirección de entrega',
    manageAddresses: 'Gestionar direcciones',
    noAddress: 'Necesitas una dirección guardada para tu compra del hogar.',
    addAddress: 'Añadir dirección',
    settingsInfo: 'Puedes cambiarlos cuando quieras. Cada pedido tiene su propio día y hora.',
    saveSettings: 'Guardar datos',

    // History
    historyTitle: 'Tus pedidos',
    viewAll: 'Ver todos',
    viewAllOrders: 'Ver todos tus pedidos',
    historyLead: 'Todos tus pedidos de la compra del hogar: ábrelos, cámbialos mientras se pueda o repítelos.',
    filters: { all: 'Todos', delivered: 'Entregados', upcoming: 'En curso', cancelled: 'Cancelados' } as Record<PlanHistoryFilter, string>,
    rowStatus: {
      draft: 'Previsto', pending: 'Pendiente', confirmed: 'Confirmado', preparing: 'Preparando',
      on_the_way: 'En camino', delivered: 'Entregado', cancelled: 'Cancelado', skipped: 'Saltado',
    } as Record<string, string>,
    loadMore: 'Cargar más',
    noHistory: 'Todavía no hay pedidos con este filtro.',

    // Setup
    setupTitle: 'Tu compra del hogar',
    setupLead: 'Dinos dónde y cuándo te viene bien recibirla. Lo usamos para proponerte el día y la hora de cada pedido.',
    setupBack: 'Volver',
    setupCreate: 'Guardar mis datos',
    setupCreating: 'Guardando…',
    notSubscriberTitle: 'Primero, tu solicitud',
    notSubscriberBody: 'La compra del hogar es para hogares aprobados. Envíanos tu solicitud y te avisamos en cuanto la aprobemos.',
    notSubscriberCta: 'Ir a Compra del hogar',
    loadError: 'No hemos podido cargar tu compra del hogar.',
    retry: 'Reintentar',
  },
  en: {
    myPlan: 'My Home Grocery',
    profile: 'My account',
    member: 'You are a Home Grocery household: every order you place is one.',
    memberSince: (date: string) => `You have been a Home Grocery household since ${date}: every order you place is one.`,
    householdTitle: 'Household',
    householdCount: (n: number) => (n === 1 ? '1 person' : `${n} people`),
    tabs: { orders: 'Orders', details: 'Delivery information' },

    infoBanner: 'Shop as usual: what you add goes on your grocery list, and when you place the order you pick the day and time. We suggest them from your delivery information, and you can pick others on each order.',

    upcomingStatus: {
      draft: 'Planned',
      pending: 'Pending',
      confirmed: 'Confirmed',
      preparing: 'Preparing',
      on_the_way: 'On the way',
    } as Record<string, string>,
    upcomingNote: {
      draft: "We'll prepare it for that day.",
      pending: "We've received it. You can change the products or the day until we start preparing it.",
      confirmed: "It's confirmed. You can change the products or the day until we start preparing it.",
      preparing: "We're preparing it.",
      on_the_way: "It's on its way.",
    } as Record<string, string>,
    viewOrder: 'View order',
    home: 'Home',
    deliveryTitle: 'Your delivery information',
    editSettings: 'Change it',
    noAddressSet: 'No address',
    deliveryFee: 'Delivery',
    feeLater: 'Added shortly',
    colProduct: 'Product',
    colPrice: 'Price',
    colQty: 'Quantity',
    colTotal: 'Total',
    colDate: 'Planned for',
    colOrder: 'Order',
    colItems: 'Items',
    colStatus: 'Status',
    summaryTitle: 'Summary',
    howItWorks: 'How it works',
    noUpcoming: 'No delivery is planned yet.',
    newOrder: 'Go shopping',
    slotDayTitle: 'Delivery day',
    moreDays: 'More days',
    notesTitle: 'Note for the rider',
    notesPlaceholder: 'Doorbell, floor, when you are out…',
    shortfallTitle: "We don't have enough of some products",
    openTitle: 'Orders on their way',
    noOpen: 'You have no order on its way.',
    changeSlot: 'Change day and time',
    slotSaved: 'Day and time changed',
    listCardTitle: 'Your grocery list',
    listCount: (n: number) => (n === 1 ? '1 product' : `${n} products`),
    listEmpty: "It's empty. Add products as you shop, or repeat an earlier order.",
    viewList: 'View my list',
    placeFromList: 'Place my order',
    repeatLast: 'Repeat my last order',
    editProducts: 'Edit products',
    editShort: 'Edit',
    reorderShort: 'Repeat',
    colActions: 'Actions',
    shortfallLine: (name: string, n: number) => `${name}: ${n} left`,
    settingsSaved: 'Saved',
    // Items
    cancel: 'Cancel',
    save: 'Save changes',
    saving: 'Saving…',
    editItems: 'Edit items',
    estTotal: 'Total (est.)',
    steps: { pending: 'Received', confirmed: 'Confirmed', preparing: 'Preparing', on_the_way: 'On the way', delivered: 'Delivered' } as Record<string, string>,
    feeLaterLine: 'Delivery: added by us shortly',
    feeIncludedLine: (fee: string) => `Includes ${fee} delivery`,
    changeDay: 'Change day',
    noOrdersYet: 'You have no orders yet.',
    otherOrdersTitle: 'Earlier orders',
    otherOrdersLead: 'From before your Home Grocery.',
    allYourOrders: 'All your orders are Home Grocery orders: open them, change them while you still can, or repeat them.',
    itemsCount: (n: number) => (n === 1 ? '1 item' : `${n} items`),
    // Settings
    settingsLead: 'What you told us in your request. We use it to suggest the day and time of each order, and you can change it any time.',
    freqTitle: 'How often',
    freqLead: 'How often you usually shop.',
    dayTitle: 'Preferred day',
    dayLead: 'We suggest it as the day for each order; you can pick another on each one.',
    noDay: 'Any day',
    windowTitle: 'Time of day',
    windowLead: 'We suggest it as the time for each order; you can pick another on each one.',
    noWindow: 'Any time',
    addressTitle: 'Delivery address',
    manageAddresses: 'Manage addresses',
    noAddress: 'You need a saved address for your Home Grocery.',
    addAddress: 'Add address',
    settingsInfo: 'You can change these any time. Each order has its own day and time.',
    saveSettings: 'Save',

    // History
    historyTitle: 'Your orders',
    viewAll: 'View all',
    viewAllOrders: 'View all your orders',
    historyLead: 'All your Home Grocery orders: open them, change them while you still can, or repeat them.',
    filters: { all: 'All', delivered: 'Delivered', upcoming: 'In progress', cancelled: 'Cancelled' } as Record<PlanHistoryFilter, string>,
    rowStatus: {
      draft: 'Planned', pending: 'Pending', confirmed: 'Confirmed', preparing: 'Preparing',
      on_the_way: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled', skipped: 'Skipped',
    } as Record<string, string>,
    loadMore: 'Load more',
    noHistory: 'No orders with this filter yet.',

    // Setup
    setupTitle: 'Your Home Grocery',
    setupLead: 'Tell us where and when suits you. We use it to suggest the day and time of each order.',
    setupBack: 'Back',
    setupCreate: 'Save my details',
    setupCreating: 'Saving…',
    notSubscriberTitle: 'First, your request',
    notSubscriberBody: "Home Grocery is for approved households. Send us your request and we'll let you know as soon as it's approved.",
    notSubscriberCta: 'Go to Home Grocery',
    loadError: "We couldn't load your Home Grocery.",
    retry: 'Try again',
  },
};

export type PlanCopy = (typeof PLAN_COPY)['es'];

export const FREQ_LABELS: Record<PlanFrequency | 'every_6_weeks', { es: string; en: string; weeks: number }> = {
  weekly: { es: 'Cada semana', en: 'Every week', weeks: 1 },
  biweekly: { es: 'Cada 2 semanas', en: 'Every 2 weeks', weeks: 2 },
  every_3_weeks: { es: 'Cada 3 semanas', en: 'Every 3 weeks', weeks: 3 },
  monthly: { es: 'Cada 4 semanas', en: 'Every 4 weeks', weeks: 4 },
  every_6_weeks: { es: 'Cada 6 semanas', en: 'Every 6 weeks', weeks: 6 },
};

/** ISO weekday 1–7. */
export const WEEKDAYS: { id: number; short: { es: string; en: string }; long: { es: string; en: string } }[] = [
  { id: 1, short: { es: 'Lun', en: 'Mon' }, long: { es: 'lunes', en: 'Monday' } },
  { id: 2, short: { es: 'Mar', en: 'Tue' }, long: { es: 'martes', en: 'Tuesday' } },
  { id: 3, short: { es: 'Mié', en: 'Wed' }, long: { es: 'miércoles', en: 'Wednesday' } },
  { id: 4, short: { es: 'Jue', en: 'Thu' }, long: { es: 'jueves', en: 'Thursday' } },
  { id: 5, short: { es: 'Vie', en: 'Fri' }, long: { es: 'viernes', en: 'Friday' } },
  { id: 6, short: { es: 'Sáb', en: 'Sat' }, long: { es: 'sábado', en: 'Saturday' } },
  { id: 7, short: { es: 'Dom', en: 'Sun' }, long: { es: 'domingo', en: 'Sunday' } },
];

export const WINDOWS: Record<DeliveryWindow, { es: string; en: string; hours: string }> = {
  morning: { es: 'por la mañana', en: 'morning', hours: '9:00 – 12:00' },
  afternoon: { es: 'por la tarde', en: 'afternoon', hours: '12:00 – 17:00' },
  evening: { es: 'al final del día', en: 'evening', hours: '17:00 – 21:00' },
};

export const WINDOW_TITLES: Record<DeliveryWindow, { es: string; en: string }> = {
  morning: { es: 'Mañana', en: 'Morning' },
  afternoon: { es: 'Tarde', en: 'Afternoon' },
  evening: { es: 'Noche', en: 'Evening' },
};

/** A plan date ("2026-10-26T00:00:00.000Z") read as the calendar day it is. */
export function planDate(iso: string | null | undefined, lang: Lang, style: 'long' | 'short' = 'long'): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', style === 'long'
    ? { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }
    : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** An order's part of the day in words — "Mañana, 9:00 – 12:00" — or "Cualquier hora". */
export function windowLine(w: DeliveryWindow | null | undefined, lang: Lang): string {
  return w ? `${WINDOW_TITLES[w][lang]}, ${WINDOWS[w].hours}` : PLAN_COPY[lang].noWindow;
}

export function euros(n: number | string, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(Number(n));
}

/** "Skipped" is a cancel the household chose — said as such, not as a failure. */
export function rowStatusKey(r: Pick<PlanDeliveryRow, 'status' | 'cancelled_reason'>): string {
  return r.status === 'cancelled' && r.cancelled_reason === 'Skipped' ? 'skipped' : r.status;
}
