import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChevronDown, ChevronRight, MessageCircle, ThumbsUp, ThumbsDown,
  ArrowLeft, ArrowUpRight, BookOpen,
} from 'lucide-react';
import { useHelpArticle, useHelpCenter } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';

/* ─────────────────────────────────────────────────────────
   "Concierge corner" article page
   Magazine-style: numeric eyebrow + huge headline, generous
   body type, sidebar redesigned as a mint "shelf" of related
   reading, conversational helpful-prompt at the foot.
   ───────────────────────────────────────────────────────── */

export default function HelpArticlePage() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { lang } = useLanguageStore();

  const { data: article, isLoading, isError } = useHelpArticle(slug);
  const { data: allCategories } = useHelpCenter();

  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [helpful, setHelpful] = useState<'yes' | 'no' | null>(null);

  // ── Loading ────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="bg-surface-linen min-h-screen">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-10 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10">
          <div className="space-y-4">
            <div className="h-6 w-48 rounded skeleton" />
            <div className="h-14 w-4/5 rounded skeleton" />
            <div className="h-[500px] rounded-2xl skeleton" />
          </div>
          <div className="h-[400px] rounded-2xl skeleton" />
        </div>
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────
  if (isError || !article) {
    return (
      <div className="bg-surface-linen min-h-screen">
        <div className="max-w-[760px] mx-auto px-6 lg:px-10 py-20 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-mist mb-6">
            <BookOpen size={26} strokeWidth={1.5} className="text-brand" />
          </div>
          <h1
            className="font-display text-[28px] md:text-[36px] text-ink tracking-tight"
            style={{ fontWeight: 700 }}
          >
            {lang === 'es' ? 'Este artículo no existe' : "We couldn't find that article"}
          </h1>
          <p className="text-[15px] text-gray font-body mt-3 max-w-[520px] mx-auto leading-relaxed">
            {lang === 'es'
              ? 'Puede que haya sido movido o archivado. Echa un vistazo a los temas disponibles en el centro de ayuda.'
              : 'It may have moved or been archived. Browse the live topics in the help center.'}
          </p>
          <Link
            to="/help"
            className="mt-7 inline-flex items-center gap-2 h-12 px-6 rounded-full bg-brand text-white text-[14px] font-bold font-ui hover:bg-brand-deepest transition-colors shadow-brand"
          >
            <ArrowLeft size={15} strokeWidth={2} />
            {lang === 'es' ? 'Ir al centro de ayuda' : 'Open help center'}
          </Link>
        </div>
      </div>
    );
  }

  const title = lang === 'es' ? article.title_es : article.title_en;
  const body = lang === 'es' ? article.body_es : article.body_en;
  const cat = article.category!;
  const catTitle = lang === 'es' ? cat.title_es : cat.title_en;
  const siblings = cat.articles ?? [];
  const otherCategories = (allCategories ?? []).filter((c) => c.id !== cat.id);

  // Find article position in its category for the "01/13" indicator
  const positionIdx = siblings.findIndex((s) => s.slug === article.slug);
  const positionLabel = positionIdx >= 0
    ? `${String(positionIdx + 1).padStart(2, '0')} / ${String(siblings.length).padStart(2, '0')}`
    : null;

  function toggleCat(id: string) {
    setOpenCats((s) => ({ ...s, [id]: !s[id] }));
  }

  return (
    <div className="bg-surface-linen min-h-screen">
      {/* ════════════════════════════════════════════════
         Top breadcrumb + back row
         ════════════════════════════════════════════════ */}
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-8 flex items-center justify-between gap-4">
        <nav className="text-[12.5px] text-gray font-ui flex items-center gap-2 min-w-0">
          <Link to="/" className="hover:text-brand transition-colors shrink-0">Cesto</Link>
          <span className="text-muted">/</span>
          <Link to="/help" className="hover:text-brand transition-colors shrink-0">
            {lang === 'es' ? 'Ayuda' : 'Help'}
          </Link>
          <span className="text-muted">/</span>
          <Link to={`/help#${cat.slug}`} className="hover:text-brand transition-colors truncate">
            {catTitle}
          </Link>
        </nav>
        <button
          onClick={() => navigate('/help')}
          className="hidden sm:inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray hover:text-brand font-ui transition-colors"
        >
          <ArrowLeft size={13} strokeWidth={2} />
          {lang === 'es' ? 'Volver al centro de ayuda' : 'Back to help center'}
        </button>
      </div>

      {/* ════════════════════════════════════════════════
         Main grid: article + sticky shelf sidebar
         ════════════════════════════════════════════════ */}
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-8 lg:py-10 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10 lg:gap-14 items-start">

        {/* ── ARTICLE ────────────────────────────────── */}
        <article className="rise-in min-w-0">
          {/* eyebrow: category + position */}
          <div className="flex items-center gap-3 mb-5">
            <Link
              to={`/help#${cat.slug}`}
              className="inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.18em] uppercase text-brand font-ui hover:text-brand-ink transition-colors"
            >
              {catTitle}
            </Link>
            {positionLabel && (
              <>
                <span className="text-border">•</span>
                <span className="font-mono text-[11px] font-bold text-muted tracking-tight">
                  {positionLabel}
                </span>
              </>
            )}
          </div>

          {/* Big headline — magazine display */}
          <h1
            className="font-display text-[36px] md:text-[48px] lg:text-[56px] text-ink tracking-tight leading-[0.98]"
            style={{ fontWeight: 700 }}
          >
            {title}
          </h1>

          {/* hairline under headline */}
          <div className="hairline mt-8 mb-8" />

          {/* article body — magazine typography */}
          <div className="prose prose-base max-w-none font-body text-ink
              [&_h1]:font-display [&_h1]:text-[26px] [&_h1]:md:text-[30px] [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-ink [&_h1]:mt-10 [&_h1]:mb-3
              [&_h2]:font-display [&_h2]:text-[22px] [&_h2]:md:text-[26px] [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-ink [&_h2]:mt-9 [&_h2]:mb-3 [&_h2]:leading-[1.15]
              [&_h3]:font-display [&_h3]:text-[16px] [&_h3]:md:text-[18px] [&_h3]:font-bold [&_h3]:tracking-tight [&_h3]:text-ink [&_h3]:mt-7 [&_h3]:mb-2.5 [&_h3]:uppercase [&_h3]:tracking-[0.04em]
              [&_p]:text-[16px] [&_p]:md:text-[17px] [&_p]:text-charcoal [&_p]:leading-[1.7] [&_p]:my-4
              [&_ul]:list-none [&_ul]:pl-0 [&_ul]:my-5 [&_ul]:space-y-2.5
              [&_ul>li]:relative [&_ul>li]:pl-6 [&_ul>li]:text-[16px] [&_ul>li]:md:text-[16.5px] [&_ul>li]:text-charcoal [&_ul>li]:leading-[1.65]
              [&_ul>li]:before:absolute [&_ul>li]:before:left-0 [&_ul>li]:before:top-[10px] [&_ul>li]:before:w-2 [&_ul>li]:before:h-2 [&_ul>li]:before:rounded-sm [&_ul>li]:before:bg-amber [&_ul>li]:before:rotate-45
              [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-5 [&_ol]:space-y-2.5
              [&_ol>li]:text-[16px] [&_ol>li]:md:text-[16.5px] [&_ol>li]:text-charcoal [&_ol>li]:leading-[1.65] [&_ol>li]:marker:text-brand [&_ol>li]:marker:font-bold
              [&_a]:text-brand [&_a]:font-semibold [&_a]:underline [&_a]:decoration-brand/40 [&_a]:underline-offset-2 hover:[&_a]:decoration-brand
              [&_strong]:font-bold [&_strong]:text-ink
              [&_em]:italic [&_em]:text-charcoal
              [&_code]:bg-surface-sand [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[14px] [&_code]:font-mono [&_code]:text-brand-ink
              [&_blockquote]:relative [&_blockquote]:my-7 [&_blockquote]:py-4 [&_blockquote]:px-6 [&_blockquote]:bg-surface-mint [&_blockquote]:border-l-4 [&_blockquote]:border-amber [&_blockquote]:rounded-r-xl [&_blockquote]:text-[16px] [&_blockquote]:italic [&_blockquote]:text-ink [&_blockquote]:font-body
              [&>div>p:first-child]:text-[18px] [&>div>p:first-child]:md:text-[20px] [&>div>p:first-child]:leading-[1.55] [&>div>p:first-child]:text-ink [&>div>p:first-child]:font-medium
              [&_table]:my-5 [&_table]:w-full [&_table]:text-[14.5px] [&_th]:text-left [&_th]:font-bold [&_th]:text-ink [&_th]:py-2 [&_th]:border-b [&_th]:border-border [&_td]:py-2 [&_td]:border-b [&_td]:border-border
            ">
            <div>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
          </div>

          {/* ── Helpful prompt — conversational ─────── */}
          <div className="mt-12 relative overflow-hidden rounded-2xl bg-surface-mint border border-amber-mist p-6 md:p-8">
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-amber/15 blur-2xl pointer-events-none" />
            <div className="relative flex flex-col sm:flex-row sm:items-center gap-5 justify-between">
              <div>
                <p className="font-display text-[19px] md:text-[21px] text-ink tracking-tight leading-tight" style={{ fontWeight: 700 }}>
                  {lang === 'es' ? '¿Resolvió tu duda este artículo?' : 'Did this article answer your question?'}
                </p>
                <p className="text-[13.5px] text-gray font-body mt-1.5">
                  {lang === 'es' ? 'Tu opinión ayuda a mejorar el centro de ayuda.' : 'Your feedback helps us improve the help center.'}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setHelpful('yes')}
                  className={`inline-flex items-center gap-2 h-11 px-5 rounded-full border-2 text-[13.5px] font-bold font-ui transition-colors ${
                    helpful === 'yes'
                      ? 'bg-amber border-amber-deep text-on-accent'
                      : 'bg-card border-border text-ink hover:border-amber hover:bg-amber-mist'
                  }`}
                >
                  <ThumbsUp size={14} strokeWidth={2} />
                  {lang === 'es' ? 'Sí' : 'Yes'}
                </button>
                <button
                  type="button"
                  onClick={() => setHelpful('no')}
                  className={`inline-flex items-center gap-2 h-11 px-5 rounded-full border-2 text-[13.5px] font-bold font-ui transition-colors ${
                    helpful === 'no'
                      ? 'bg-card border-ink text-ink'
                      : 'bg-card border-border text-gray hover:border-ink hover:text-ink'
                  }`}
                >
                  <ThumbsDown size={14} strokeWidth={2} />
                  {lang === 'es' ? 'No' : 'No'}
                </button>
              </div>
            </div>
            {helpful && (
              <p className="relative mt-5 pt-5 border-t border-amber-mist text-[13.5px] text-gray font-body">
                {helpful === 'yes'
                  ? (lang === 'es' ? '¡Gracias! Nos alegra que te haya servido.' : 'Thanks! Glad it helped.')
                  : (lang === 'es' ? 'Lo sentimos. ' : "We're sorry to hear that. ")}
                {helpful === 'no' && (
                  <Link to="/contact?source=help_article" className="text-brand font-bold underline decoration-brand/40 hover:decoration-brand">
                    {lang === 'es' ? 'Cuéntanos qué falta →' : 'Tell us what\'s missing →'}
                  </Link>
                )}
              </p>
            )}
          </div>

          {/* ── Related — inline editorial list ─────── */}
          {siblings.filter((s) => s.slug !== article.slug).length > 0 && (
            <div className="mt-12">
              <div className="flex items-center gap-3 mb-5">
                <span className="text-[10.5px] font-bold tracking-[0.18em] uppercase text-brand font-ui">
                  {lang === 'es' ? 'Sigue leyendo' : 'Keep reading'}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {siblings.filter((s) => s.slug !== article.slug).slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/help/${a.slug}`}
                      className="group flex items-start gap-3 p-4 rounded-xl bg-card border border-border hover:border-brand hover:shadow-card-hover transition-all"
                    >
                      <span className="mt-1 w-8 h-8 rounded-lg bg-brand-whisper flex items-center justify-center shrink-0 group-hover:bg-brand group-hover:text-white transition-colors text-brand">
                        <ArrowUpRight size={14} strokeWidth={2.25} />
                      </span>
                      <span className="text-[14.5px] text-ink font-body font-medium leading-snug pt-0.5">
                        {lang === 'es' ? a.title_es : a.title_en}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Bottom contact CTA ──────────────────── */}
          <div className="mt-14 relative overflow-hidden rounded-2xl bg-night text-white p-7 md:p-9">
            <div className="absolute -bottom-16 -right-12 w-[260px] h-[260px] rounded-full bg-brand/30 blur-3xl pointer-events-none" />
            <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-5">
              <div>
                <p className="font-display text-[20px] md:text-[24px] tracking-tight leading-tight" style={{ fontWeight: 700 }}>
                  {lang === 'es' ? 'Aún tienes preguntas.' : 'Still got questions.'}
                </p>
                <p className="text-[14px] text-white/70 font-body mt-1.5">
                  {lang === 'es' ? 'Escríbenos y te respondemos.' : "Drop us a line and we'll reply."}
                </p>
              </div>
              <button
                onClick={() => navigate('/contact?source=help_article')}
                className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-amber text-on-accent text-[13.5px] font-bold font-ui hover:bg-amber-mid transition-colors"
              >
                <MessageCircle size={15} strokeWidth={2} />
                {lang === 'es' ? 'Hablar con nosotros' : 'Talk to us'}
              </button>
            </div>
          </div>
        </article>

        {/* ── SIDEBAR — sticky mint shelf ─────────────── */}
        <aside className="lg:sticky lg:top-[88px] rise-in-2">
          <div className="rounded-2xl bg-card border border-border overflow-hidden shadow-card">

            {/* Current category — mint header */}
            <div className="bg-surface-mint border-b border-amber-mist px-5 py-4">
              <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-amber-deep font-ui">
                {lang === 'es' ? 'En esta sección' : 'In this section'}
              </span>
              <p className="font-display text-[17px] text-ink tracking-tight mt-1 leading-tight" style={{ fontWeight: 700 }}>
                {catTitle}
              </p>
            </div>

            {/* Sibling list */}
            <ul className="p-2">
              {siblings.map((a) => {
                const active = a.slug === article.slug;
                return (
                  <li key={a.id}>
                    <Link
                      to={`/help/${a.slug}`}
                      className={`block px-3 py-2.5 rounded-lg text-[13.5px] font-body leading-snug transition-colors ${
                        active
                          ? 'bg-brand text-white font-semibold'
                          : 'text-ink hover:bg-brand-whisper hover:text-brand'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {active && <span className="w-1 h-1 rounded-full bg-card" />}
                        {lang === 'es' ? a.title_es : a.title_en}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Other categories — collapsed accordion */}
            <div className="border-t border-border">
              <div className="px-5 pt-4 pb-2">
                <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-gray font-ui">
                  {lang === 'es' ? 'Más temas' : 'More topics'}
                </span>
              </div>
              <div>
                {otherCategories.map((c) => {
                  const isOpen = openCats[c.id];
                  const cTitle = lang === 'es' ? c.title_es : c.title_en;
                  return (
                    <div key={c.id} className="border-t border-border first:border-t-0">
                      <button
                        type="button"
                        onClick={() => toggleCat(c.id)}
                        className="w-full flex items-center justify-between gap-2 px-5 py-3 text-left hover:bg-brand-whisper transition-colors"
                      >
                        <span className="text-[13.5px] font-semibold font-body text-ink">{cTitle}</span>
                        {isOpen
                          ? <ChevronDown size={14} strokeWidth={2} className="text-muted" />
                          : <ChevronRight size={14} strokeWidth={2} className="text-muted" />}
                      </button>
                      {isOpen && (
                        <ul className="pb-2 px-2">
                          {(c.articles ?? []).map((a) => (
                            <li key={a.id}>
                              <Link
                                to={`/help/${a.slug}`}
                                className="block px-3 py-1.5 rounded-lg text-[12.5px] text-gray hover:bg-brand-whisper hover:text-brand transition-colors leading-snug"
                              >
                                {lang === 'es' ? a.title_es : a.title_en}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sidebar CTA */}
            <div className="border-t border-border p-4 bg-surface-sand">
              <button
                onClick={() => navigate('/contact?source=help_article')}
                className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-full bg-brand text-white text-[13px] font-bold font-ui hover:bg-brand-deepest transition-colors"
              >
                <MessageCircle size={14} strokeWidth={2} />
                {lang === 'es' ? 'Contactar soporte' : 'Contact support'}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
