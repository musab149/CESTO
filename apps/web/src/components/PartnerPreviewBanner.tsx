import { Eye, LogOut, ArrowLeft } from 'lucide-react';
import { usePreviewModeStore } from '@/stores/previewModeStore';

/** Sticky banner rendered above the customer chrome when the visitor is
 *  actually a partner previewing their storefront. Non-preview visitors
 *  render nothing. See usePreviewModeStore for the toggle mechanics.
 *
 *  Two escape hatches:
 *    · "Dashboard" — primary, brand-blue. Clears the preview flag and
 *      navigates back to the admin `/partner/dashboard`. Read the admin
 *      URL from VITE_ADMIN_URL (defaults to localhost:5174 for dev).
 *    · "Exit preview" — secondary, dark. Clears the flag but stays on
 *      the customer web, for when the partner wants to browse as an
 *      ordinary customer after previewing. */
export default function PartnerPreviewBanner() {
  const isPreview = usePreviewModeStore((s) => s.isPartnerPreview);
  const exit = usePreviewModeStore((s) => s.exit);

  if (!isPreview) return null;

  const adminUrl = (import.meta.env.VITE_ADMIN_URL as string | undefined) || 'http://localhost:5174';

  function goToDashboard() {
    // Clear the flag first so the partner isn't immediately re-thrown
    // into preview mode if they toggle back later without re-entering.
    // exit() reloads the page, so we short-circuit that with a manual
    // localStorage clear + navigate.
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('mvPreviewMode');
      window.location.assign(`${adminUrl.replace(/\/$/, '')}/partner/dashboard`);
    }
  }

  return (
    <div className="sticky top-0 z-50 bg-amber-500 text-black">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 min-h-10 py-1.5 flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-display font-semibold">
          <Eye size={14} strokeWidth={2} />
          Partner Preview
        </span>
        <span className="hidden md:inline text-xs font-body opacity-80">
          Prices, add-to-cart, and checkout are hidden.
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={goToDashboard}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-brand text-white text-xs font-display font-semibold hover:bg-brand-mid transition-colors"
          >
            <ArrowLeft size={12} strokeWidth={2.5} />
            Dashboard
          </button>
          <button
            onClick={exit}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-black text-white text-xs font-display font-semibold hover:bg-black/85 transition-colors"
          >
            <LogOut size={12} strokeWidth={2} />
            Exit preview
          </button>
        </div>
      </div>
    </div>
  );
}
