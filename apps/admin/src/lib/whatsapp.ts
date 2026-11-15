/**
 * A wa.me link for a phone number as people actually type it, or null when
 * there is not enough of a number to open a chat with.
 *
 * WhatsApp wants the country code and digits only. Most numbers on our forms
 * are Spanish and many are typed without the prefix ("602 173 016"), and a
 * bare nine digits opens a chat with nobody — so a nine-digit number gets
 * Spain's 34 in front. A "00" international prefix is dropped the same way
 * a "+" is.
 */
export function whatsappUrl(phone: string | null | undefined): string | null {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `34${digits}`;
  return digits.length >= 10 ? `https://wa.me/${digits}` : null;
}
