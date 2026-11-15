import { useEffect, useState } from 'react';
import { diagnoseFailure } from '@grocery-app/shared';
import type { ConnectionVerdict, FailureKind } from '@grocery-app/shared';

/**
 * What checkout tells a shopper when something does not go through — and,
 * first of all, whose side it was on.
 *
 * A 600-line order on production (2026-10-16) was shown the server's "That
 * took too long to process" and then thrown onto "Something broke on our
 * end". Neither told the shopper whether to find better signal or to give us
 * a moment, nor whether they now had an order. Every message here answers
 * those: whose side, what to do, and what has (not) happened to their money.
 *
 * The diagnosis itself lives in packages/shared/src/api/connection.ts.
 */

type Lang = 'es' | 'en';

/** Which step failed: pushing the basket up, pricing it, or placing it. */
export type CheckoutStage = 'sync' | 'quote' | 'order';

export interface FailureCopy {
  /** null while the connection is still being checked. */
  kind: FailureKind | null;
  title: string;
  body: string;
}

const TITLE: Record<Lang, Record<FailureKind, string>> = {
  es: {
    offline: 'Sin conexión a internet',
    slow_connection: 'Tu conexión a internet va muy lenta',
    server_busy: 'Estamos tardando más de lo normal',
    server_error: 'Algo ha fallado de nuestro lado',
    no_answer: 'No ha llegado respuesta a tiempo',
    rejected: '', // per stage, below
  },
  en: {
    offline: 'No internet connection',
    slow_connection: 'Your internet connection is very slow',
    server_busy: "We're taking longer than usual",
    server_error: 'Something went wrong on our side',
    no_answer: 'No answer in time',
    rejected: '',
  },
};

const BODY: Record<Lang, Record<Exclude<FailureKind, 'rejected'>, string>> = {
  es: {
    offline: 'Tu dispositivo se ha quedado sin conexión. Conéctate y vuelve a intentarlo.',
    slow_connection:
      'El problema es la conexión, no tu pedido. Acércate al wifi o busca mejor cobertura y vuelve a intentarlo.',
    server_busy: 'Tu conexión funciona bien: el retraso es nuestro. Espera unos segundos y vuelve a intentarlo.',
    server_error: 'Vuelve a intentarlo en un momento. Si sigue fallando, escríbenos por WhatsApp.',
    no_answer: 'Puede ser tu conexión o nuestro servidor. Comprueba que tienes conexión y vuelve a intentarlo.',
  },
  en: {
    offline: 'Your device has lost its connection. Reconnect and try again.',
    slow_connection:
      "The problem is the connection, not your order. Move closer to the wifi or find better signal, then try again.",
    server_busy: "Your connection is fine — the delay is ours. Give it a few seconds and try again.",
    server_error: 'Try again in a moment. If it keeps failing, message us on WhatsApp.',
    no_answer: 'It could be your connection or our server. Check that you are online and try again.',
  },
};

/** Said when the step failed with a reason the server gave (a 4xx). */
const STAGE_TITLE: Record<Lang, Record<CheckoutStage, string>> = {
  es: {
    sync: 'No hemos podido guardar tu cesta',
    quote: 'No hemos podido calcular el precio',
    order: 'No hemos podido hacer el pedido',
  },
  en: {
    sync: "We couldn't save your basket",
    quote: "Couldn't price this order",
    order: "We couldn't place your order",
  },
};

/**
 * The money question, per step.
 *
 * After a failed ORDER we cannot promise it was not placed: a timeout or a
 * dropped connection can come after the server committed. What we can promise
 * is that pressing again is safe — the attempt key makes the server hand back
 * the order it already placed instead of placing a second — and that nothing
 * is paid before delivery.
 */
const REASSURANCE: Record<Lang, Record<CheckoutStage, string>> = {
  es: {
    sync: 'Tu pedido no se ha hecho y no se te ha cobrado nada.',
    quote: '',
    order: 'No pagas nada hasta recibirlo, y si el pedido llegó a hacerse, al volver a intentarlo te lo mostraremos en lugar de repetirlo.',
  },
  en: {
    sync: 'Your order has not been placed and nothing has been charged.',
    quote: '',
    order: "You pay nothing until it arrives, and if the order did go through, trying again shows it to you instead of placing it twice.",
  },
};

const CHECKING: Record<Lang, string> = {
  es: 'Comprobando tu conexión…',
  en: 'Checking your connection…',
};

export function checkoutFailure(
  kind: FailureKind,
  stage: CheckoutStage,
  lang: Lang,
  serverMessage: string,
): FailureCopy {
  const reassurance = REASSURANCE[lang][stage];
  if (kind === 'rejected') {
    return { kind, title: STAGE_TITLE[lang][stage], body: serverMessage };
  }
  return {
    kind,
    title: TITLE[lang][kind],
    body: reassurance ? `${BODY[lang][kind]} ${reassurance}` : BODY[lang][kind],
  };
}

/**
 * The failure of `err` at `stage`, worded for a shopper — or null with no
 * error. Says "checking your connection" for the moment the probe takes
 * (at most 5s), rather than nothing or a guess.
 */
export function useCheckoutFailure(err: unknown, stage: CheckoutStage, lang: Lang): FailureCopy | null {
  // Kept with the error it describes, so a new error reads as "checking"
  // until its own diagnosis lands rather than borrowing the last one's.
  const [diagnosis, setDiagnosis] = useState<{ err: unknown; kind: FailureKind } | null>(null);

  useEffect(() => {
    if (err == null) return;
    let live = true;
    void diagnoseFailure(err).then((kind) => { if (live) setDiagnosis({ err, kind }); });
    return () => { live = false; };
  }, [err]);

  if (err == null) return null;
  const kind = diagnosis?.err === err ? diagnosis.kind : null;
  if (!kind) return { kind: null, title: STAGE_TITLE[lang][stage], body: CHECKING[lang] };
  return checkoutFailure(kind, stage, lang, err instanceof Error ? err.message : '');
}

/**
 * Shown under the button once an order has been on its way for a while, so a
 * long wait says why instead of looking frozen — and keeps the shopper from
 * reloading mid-request.
 */
export function slowOrderHint(verdict: ConnectionVerdict, lang: Lang, lines: number): string {
  const stay = lang === 'es'
    ? 'No cierres ni recargues esta página.'
    : "Don't close or reload this page.";
  if (verdict === 'offline') {
    return lang === 'es'
      ? `Parece que te has quedado sin conexión. ${stay}`
      : `It looks like you have lost your connection. ${stay}`;
  }
  if (verdict === 'slow') {
    return lang === 'es'
      ? `Tu conexión a internet va lenta, así que el pedido tarda más en enviarse. ${stay}`
      : `Your internet connection is slow, so the order is taking longer to send. ${stay}`;
  }
  if (lines >= 100) {
    return lang === 'es'
      ? `Un pedido de ${lines} productos tarda un poco más. Seguimos con ello. ${stay}`
      : `An order of ${lines} products takes a little longer. We're still on it. ${stay}`;
  }
  return lang === 'es'
    ? `Está tardando un poco más de lo normal. Seguimos con ello. ${stay}`
    : `This is taking a little longer than usual. We're still on it. ${stay}`;
}
