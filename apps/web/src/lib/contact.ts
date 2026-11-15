/**
 * How a customer reaches a person at Cesto.
 *
 * WhatsApp is hard-coded rather than read from store settings because there is
 * no settings field for it yet — the phone number has one (`contactPhone`),
 * WhatsApp does not. Lives here so the contact page and Home Grocery link to
 * the same number instead of each keeping a copy.
 */
export const WHATSAPP_NUMBER = '34602848222';

/** A wa.me link, optionally opening the chat with a message already typed. */
export function whatsappLink(text?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
