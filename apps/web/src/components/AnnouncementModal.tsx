import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Full-image announcement shown on every visit to a customer-facing page.
 *
 * Deliberately not remembered: closing it applies to that page load only, and
 * the next arrival or reload shows it again. It is a temporary notice about
 * prices being incomplete, so a shopper who dismissed it last week still needs
 * it this week.
 *
 * The artwork carries all the copy, so there is no text to translate here —
 * only the close control needs a label. That also means the image itself is
 * the message: it gets an alt describing what it says, because unlike the home
 * banner there is no button beside it doing the explaining.
 *
 * ─── Why it stops showing on its own ────────────────────────────────────────
 *
 * The artwork announces a date ("fully activated on 1 October 2026"). Once that
 * has passed the modal is not merely unnecessary, it actively misinforms — and
 * since nothing else ever stops it (it is shown on every visit and dismissal is
 * not remembered), this date is the ONLY thing that does. Without it the site
 * would keep promising a past activation until someone shipped a removal, and
 * the person who remembers is rarely the person who notices.
 *
 * Change or remove EXPIRES_AT when the announcement changes.
 */
const EXPIRES_AT = new Date('2026-10-02T00:00:00Z');

const IMAGE_SRC = '/announcement.webp';

export default function AnnouncementModal() {
  const { lang } = useLanguageStore();
  const label = (en: string, es: string) => (lang === 'en' ? en : es);
  const [open, setOpen] = useState(false);

  // Shown on EVERY visit, by request — closing it is for this page load only
  // and is not remembered. The layout mounts once per full page load, so an
  // SPA navigation between customer pages does not bring it back; a reload or
  // a fresh arrival does.
  useEffect(() => {
    if (Date.now() >= EXPIRES_AT.getTime()) return;
    setOpen(true);
  }, []);

  // Esc closes, and the page behind does not scroll while it is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-veil/60 backdrop-blur-[2px]"
        onClick={close}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={label('Important announcement', 'Aviso importante')}
        /* The artwork is portrait and taller than it is wide, so the height is
           what constrains it on almost every screen — max-h with w-auto, not a
           max-w. A width cap alone would push the bottom of the image off a
           laptop screen. */
        className="relative max-h-[88vh] w-auto max-w-[min(92vw,560px)] flex"
      >
        <img
          src={IMAGE_SRC}
          alt={label(
            'Important announcement: we are working on our mobile app and data entry. The system will be fully activated on 1 October 2026. Some products may not have prices yet, or prices may be higher or lower than the final price. Thank you for your patience.',
            'Aviso importante: estamos trabajando en nuestra aplicación móvil y en la introducción de datos. El sistema estará totalmente activo el 1 de octubre de 2026. Puede que algunos productos aún no tengan precio, o que los precios sean superiores o inferiores al precio final. Gracias por su paciencia.',
          )}
          className="max-h-[88vh] w-auto max-w-full object-contain rounded-2xl shadow-float"
          /* The artwork IS the modal — there is no fallback copy to fall back
             to. If it 404s (not deployed yet, cache miss, typo'd filename),
             showing an empty box with a close button on it is worse than
             showing nothing, so the whole thing gets out of the way. Without
             this, shipping the code before the image blocks every visitor
             behind a broken overlay. */
          onError={() => setOpen(false)}
        />

        {/* Sits ON the artwork's top-right corner. White on a solid dark
            circle rather than a bare icon: the corner behind it is mid-blue
            and a plain white glyph would half-disappear into it. */}
        <button
          type="button"
          onClick={close}
          aria-label={label('Close announcement', 'Cerrar aviso')}
          className="absolute top-2 right-2 w-9 h-9 rounded-full bg-veil/70 hover:bg-veil text-white flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-card focus-visible:ring-offset-2 focus-visible:ring-offset-veil/40"
        >
          <X size={18} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
