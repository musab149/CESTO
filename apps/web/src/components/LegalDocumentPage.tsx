import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import LegalMarkdown from '@/components/LegalMarkdown';
import { Skeleton } from '@/components/Skeleton';

const SUPPORT_EMAIL = 'support.cesto@gmail.com';

/**
 * Shell for the two admin-managed legal documents.
 *
 * Both pages used to carry a hardcoded copy of the document, rendered
 * whenever the admin copy was blank. Those copies were written long before
 * the real documents and contradicted them — the privacy one told readers
 * that Stripe processed their card payments, which this app has never done,
 * and gave an email nobody reads. They appeared exactly when nobody was
 * watching: with the field empty. An unfinished document is better than a
 * confidently wrong one, so the fallback is now a short notice.
 *
 * There is no "last updated" line here either. Each document carries its own
 * effective and updated dates in its own text; the hardcoded one said
 * "April 2026" regardless of what the document underneath it said.
 */
export default function LegalDocumentPage({
  icon: Icon,
  title,
  body,
  isLoading,
}: {
  icon: LucideIcon;
  title: string;
  body: string | undefined;
  isLoading: boolean;
}) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();

  return (
    <div className="max-w-[800px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm font-semibold font-display text-muted hover:text-brand transition-colors mb-6"
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
        {lang === 'es' ? 'Volver' : 'Back'}
      </button>

      <div className="flex items-center gap-3 mb-8">
        <Icon size={28} className="text-brand shrink-0" strokeWidth={1.75} />
        <h1 className="text-3xl font-extrabold text-ink font-display leading-tight">{title}</h1>
      </div>

      <div className="bg-surface-cream rounded-lg shadow-card px-6 py-7 sm:px-9 sm:py-9">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className={`h-4 ${i % 4 === 3 ? 'w-2/3' : 'w-full'}`} />
            ))}
          </div>
        ) : body ? (
          <LegalMarkdown body={body} />
        ) : (
          <p className="font-body text-[14.5px] leading-[1.75] text-charcoal">
            {lang === 'es' ? (
              <>
                Estamos actualizando este documento. Mientras tanto, escríbenos a{' '}
                <a className="text-brand font-medium underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>{' '}
                y te enviamos la versión vigente.
              </>
            ) : (
              <>
                We are updating this document. In the meantime, email{' '}
                <a className="text-brand font-medium underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>{' '}
                and we will send you the current version.
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
