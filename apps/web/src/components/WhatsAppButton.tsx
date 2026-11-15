import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { whatsappLink } from '@/lib/contact';
import { useLanguageStore } from '@/stores/languageStore';

/** Once per browser session, so the button says what it is without nagging. */
const PEEK_KEY = 'cesto-whatsapp-peeked';
const PEEK_MS = 4000;

function shouldPeek(): boolean {
  try {
    return sessionStorage.getItem(PEEK_KEY) !== '1';
  } catch {
    return false;
  }
}

/**
 * A chat with us on WhatsApp, from any page — the way most of our customers
 * already ask a shop something. Opens in a new tab (WhatsApp Web, or the app
 * on a phone) with a first line typed, so asking takes one tap rather than
 * finding our number.
 *
 * A green circle that widens into a pill with its words inside, the same
 * shape as the cart pill under it: on hover or keyboard focus, and on its
 * own for a few seconds the first time it appears in a session — a phone
 * has no hover, and would otherwise never see what the bubble is for.
 *
 * Sits in FloatingActions, which places it; this is just the button.
 */
export default function WhatsAppButton() {
  const { lang } = useLanguageStore();
  const en = lang === 'en';
  const hint = en ? 'Questions? Message us' : '¿Dudas? Escríbenos';
  const message = en ? 'Hi Cesto, I have a question.' : 'Hola Cesto, tengo una consulta.';

  const [peek, setPeek] = useState(shouldPeek);
  useEffect(() => {
    if (!peek) return;
    try { sessionStorage.setItem(PEEK_KEY, '1'); } catch { /* private mode: it just peeks again */ }
    const t = window.setTimeout(() => setPeek(false), PEEK_MS);
    return () => window.clearTimeout(t);
  }, [peek]);

  return (
    <a
      href={whatsappLink(message)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={en ? 'Message us on WhatsApp' : 'Escríbenos por WhatsApp'}
      className="pointer-events-auto group relative flex items-stretch rounded-full bg-whatsapp text-white overflow-hidden shadow-[0_10px_28px_rgba(37,211,102,0.45)] transition-shadow duration-300 hover:shadow-[0_14px_36px_rgba(37,211,102,0.55)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-whatsapp focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className={`relative overflow-hidden transition-[max-width] duration-300 ease-out motion-reduce:transition-none group-hover:max-w-[240px] group-focus-visible:max-w-[240px] ${
          peek ? 'max-w-[240px]' : 'max-w-0'
        }`}
      >
        <span className="flex items-center h-full pl-5 pr-1 whitespace-nowrap text-[14px] font-bold font-ui [text-shadow:0_1px_1px_rgba(0,0,0,0.18)]">
          {hint}
        </span>
      </span>
      <span className="flex items-center justify-center shrink-0 w-[52px] h-[52px]">
        <MessageCircle size={26} strokeWidth={2} />
      </span>
    </a>
  );
}
