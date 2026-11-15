/**
 * What to show while a big order is being placed, created, edited or
 * cancelled — the steps, their words, and how far along the bar is.
 *
 * The server reports the step it has reached (packages/api/src/lib/
 * orderProgress.ts) and the page polls for it. This turns that report — or its
 * absence — into something to draw. Pure, so every app draws the same thing
 * and it can be tested without rendering anything.
 *
 * The bar is honest about what it knows: finished steps are filled, the
 * current step eases toward most of its share, and nothing reaches 100%
 * before the server says it is done.
 *
 * Step ids MIRROR the API's PROGRESS_STEPS; test:order-progress fails if the
 * two drift.
 */

export type OrderProgressKind = 'checkout' | 'create' | 'edit' | 'cancel';
export type OrderProgressServerStep = 'checking' | 'reserving' | 'creating' | 'saving' | 'cancelling' | 'confirming';
/** Server steps plus the two the page does itself. */
export type OrderProgressStepId = OrderProgressServerStep | 'basket' | 'opening';

export const ORDER_PROGRESS_STEPS: Record<OrderProgressKind, OrderProgressServerStep[]> = {
  checkout: ['checking', 'reserving', 'creating', 'confirming'],
  create: ['checking', 'reserving', 'creating', 'confirming'],
  edit: ['checking', 'saving', 'confirming'],
  cancel: ['cancelling', 'confirming'],
};

/** What GET …/progress/:key answers. */
export interface OrderProgressView {
  kind: OrderProgressKind;
  step: OrderProgressServerStep;
  steps: Array<{ step: OrderProgressServerStep; ms: number }>;
  detail: { lines?: number; shops?: number };
  elapsedMs: number;
  done: boolean;
  failed: boolean;
}

export type OrderProgressPhase =
  /** The page's own work before the request (checkout: saving the basket). */
  | 'before'
  /** The request is running. */
  | 'server'
  /** The answer is in; the page is moving on. */
  | 'after';

export interface OrderProgressStep {
  id: OrderProgressStepId;
  label: string;
  state: 'done' | 'active' | 'todo';
}

export interface OrderProgressModel {
  title: string;
  steps: OrderProgressStep[];
  /** 0–100. Below 100 until the work is really finished. */
  percent: number;
}

type Lang = 'es' | 'en';

/**
 * Rough share of the wait each step takes, so the bar moves at a believable
 * pace. Read off production timings for 1,000-line orders (2026-10-19); they
 * only shape the bar, never what it claims.
 */
const WEIGHTS: Record<OrderProgressStepId, number> = {
  basket: 0.15,
  checking: 0.2,
  reserving: 0.1,
  creating: 0.2,
  saving: 0.45,
  cancelling: 0.55,
  confirming: 0.3,
  opening: 0.05,
};

/** How quickly the active step's share fills: about two-thirds by this time. */
const EASE_MS = 4_000;
/** The active step never fills past this much of its share on its own. */
const EASE_CAP = 0.9;

function count(n: number, lang: Lang) {
  return n.toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB');
}

function labelFor(id: OrderProgressStepId, kind: OrderProgressKind, lang: Lang, d: { lines?: number; shops?: number }): string {
  const en = lang === 'en';
  switch (id) {
    case 'basket':
      return en ? 'Saving your basket' : 'Guardando tu cesta';
    case 'checking':
      if (kind === 'edit') return en ? 'Checking the changes' : 'Comprobando los cambios';
      return d.lines
        ? (en ? `Checking ${count(d.lines, lang)} products` : `Comprobando ${count(d.lines, lang)} productos`)
        : (en ? 'Checking the products' : 'Comprobando los productos');
    case 'reserving':
      return en ? 'Reserving the stock' : 'Reservando el stock';
    case 'creating':
      if (kind === 'checkout' && d.shops && d.shops > 1) {
        return en ? `Creating the orders for ${d.shops} shops` : `Creando los pedidos de ${d.shops} tiendas`;
      }
      return kind === 'checkout'
        ? (en ? 'Creating your order' : 'Creando tu pedido')
        : (en ? 'Creating the order' : 'Creando el pedido');
    case 'saving':
      return en ? 'Saving the changes' : 'Guardando los cambios';
    case 'cancelling':
      return d.lines
        ? (en ? `Cancelling and returning ${count(d.lines, lang)} products to stock` : `Cancelando y devolviendo ${count(d.lines, lang)} productos al stock`)
        : (en ? 'Cancelling and returning the stock' : 'Cancelando y devolviendo el stock');
    case 'confirming':
      if (kind === 'checkout') return en ? 'Sending your confirmation' : 'Enviando tu confirmación';
      if (kind === 'create') return en ? 'Letting the customer know' : 'Avisando al cliente';
      return en ? 'Finishing up' : 'Terminando';
    case 'opening':
      return kind === 'checkout'
        ? (en ? 'Opening your order' : 'Abriendo tu pedido')
        : (en ? 'Opening the order' : 'Abriendo el pedido');
  }
}

export function orderProgressTitle(kind: OrderProgressKind, lang: Lang): string {
  const en = lang === 'en';
  switch (kind) {
    case 'checkout': return en ? 'Placing your order' : 'Estamos haciendo tu pedido';
    case 'create': return en ? 'Creating the order' : 'Creando el pedido';
    case 'edit': return en ? 'Saving the changes' : 'Guardando los cambios';
    case 'cancel': return en ? 'Cancelling the order' : 'Cancelando el pedido';
  }
}

/** Said under the steps: why it takes a while, and what not to do. */
export function orderProgressNote(lang: Lang): string {
  return lang === 'en'
    ? 'Big orders take a little while. Keep this page open — it moves on by itself.'
    : 'Los pedidos grandes tardan un poco. No cierres esta página: avanzará sola.';
}

export function orderProgressModel(input: {
  kind: OrderProgressKind;
  lang: Lang;
  phase: OrderProgressPhase;
  /** The server's report, or null when there is none (yet, or at all). */
  view: OrderProgressView | null;
  /** Time spent in the current phase, on the page's own clock. */
  phaseElapsedMs: number;
  /** What the page already knows (basket size), until the server says more. */
  detail?: { lines?: number; shops?: number };
  /** Show the page's own first step (checkout's basket upload). */
  withBasket?: boolean;
  /** Show the page's own last step (moving to the order). */
  withOpening?: boolean;
}): OrderProgressModel {
  const { kind, lang, phase, view } = input;
  const serverSteps = ORDER_PROGRESS_STEPS[kind];
  const ids: OrderProgressStepId[] = [
    ...(input.withBasket ? ['basket' as const] : []),
    ...serverSteps,
    ...(input.withOpening ? ['opening' as const] : []),
  ];
  const detail = { ...input.detail, ...view?.detail };

  // Which step is under way, and how long it has been.
  let active: OrderProgressStepId;
  let activeMs: number;
  const serverFinished = phase === 'after' || (view?.done ?? false);
  if (phase === 'before') {
    active = input.withBasket ? 'basket' : serverSteps[0];
    activeMs = input.phaseElapsedMs;
  } else if (serverFinished) {
    active = input.withOpening ? 'opening' : serverSteps[serverSteps.length - 1];
    activeMs = phase === 'after' ? input.phaseElapsedMs : 0;
  } else if (view) {
    active = view.step;
    const startedAt = view.steps[view.steps.length - 1]?.ms ?? 0;
    // The report is a snapshot, and a slow connection delivers it late: taken
    // alone it dragged the bar from 29% back to 0% (staging, 2026-10-21) and
    // froze it until the next poll. The page's clock started before the
    // server's, so measured on it the step has run at least this long — and
    // that keeps moving between reports.
    activeMs = Math.max(0, view.elapsedMs - startedAt, input.phaseElapsedMs - startedAt);
  } else {
    active = serverSteps[0];
    activeMs = input.phaseElapsedMs;
  }

  const activeIndex = ids.indexOf(active);
  const total = ids.reduce((s, id) => s + WEIGHTS[id], 0);
  let filled = 0;
  ids.forEach((id, i) => {
    if (i < activeIndex) filled += WEIGHTS[id];
    if (i === activeIndex) filled += WEIGHTS[id] * EASE_CAP * (1 - Math.exp(-activeMs / EASE_MS));
  });
  // Truly finished only when the server is done AND nothing of the page's own
  // is left to do. Otherwise 99 at most, whatever the arithmetic says.
  const allDone = serverFinished && !input.withOpening;
  const percent = allDone ? 100 : Math.min(99, Math.round((filled / total) * 100));

  return {
    title: orderProgressTitle(kind, lang),
    steps: ids.map((id, i) => ({
      id,
      label: labelFor(id, kind, lang, detail),
      state: allDone || i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo',
    })),
    percent,
  };
}

/** A fresh key for one operation's progress (and nothing else). */
export function newProgressKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
