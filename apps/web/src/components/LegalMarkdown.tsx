import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders the admin-managed privacy policy and terms.
 *
 * These pages used `prose prose-sm` from @tailwindcss/typography — a plugin
 * this project does not install. The classes were inert, so every element
 * rendered with Tailwind's preflight reset and nothing else: no heading
 * sizes, no margins between sections, tables with no borders. A 4,000-word
 * policy came out as one undifferentiated wall.
 *
 * Styling each element explicitly rather than adding the plugin keeps the
 * dependency tree (and package-lock.json) untouched, and lets the documents
 * use the project's own tokens instead of the plugin's opinions.
 *
 * Long legal text needs the hierarchy to be obvious at a glance — someone
 * looking for "how do I delete my account" should find §8 by scanning, and a
 * Play reviewer checking a specific disclosure should not have to read the
 * whole thing.
 */
export default function LegalMarkdown({ body }: { body: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="font-display text-[26px] leading-tight font-extrabold text-ink mt-0 mb-2">
            {children}
          </h1>
        ),
        // The document's section headers. The top border is the main visual
        // separator — it is what turns a wall of text into findable sections.
        h2: ({ children }) => (
          <h2 className="font-display text-[19px] leading-snug font-bold text-ink mt-10 mb-3 pt-6 border-t border-border first:mt-0 first:pt-0 first:border-t-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="font-display text-[15.5px] leading-snug font-bold text-ink mt-6 mb-2">
            {children}
          </h3>
        ),
        h4: ({ children }) => (
          <h4 className="font-display text-[14px] font-bold text-charcoal mt-5 mb-1.5">
            {children}
          </h4>
        ),
        p: ({ children }) => (
          <p className="font-body text-[14.5px] leading-[1.75] text-charcoal my-3">
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul className="my-3 pl-5 list-disc marker:text-muted space-y-1.5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-3 pl-5 list-decimal marker:text-muted space-y-1.5">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="font-body text-[14.5px] leading-[1.7] text-charcoal pl-1">
            {children}
          </li>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-ink">{children}</strong>
        ),
        em: ({ children }) => <em className="italic text-charcoal">{children}</em>,
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-brand font-medium underline underline-offset-2 hover:no-underline"
            target={href?.startsWith('http') ? '_blank' : undefined}
            rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
          >
            {children}
          </a>
        ),
        hr: () => <hr className="my-8 border-t border-border" />,
        blockquote: ({ children }) => (
          <blockquote className="my-4 pl-4 border-l-[3px] border-brand/30 text-charcoal italic">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="font-mono text-[13px] bg-surface-linen border border-border rounded px-1.5 py-0.5">
            {children}
          </code>
        ),
        // Tables carry the data / retention / recipient breakdowns, which are
        // the parts a reviewer is most likely to check line by line. Scrolls
        // horizontally rather than squashing on a phone.
        table: ({ children }) => (
          <div className="my-5 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[420px] border-collapse text-left">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-surface-linen">{children}</thead>,
        th: ({ children }) => (
          <th className="font-display text-[12px] uppercase tracking-wide text-muted font-bold px-4 py-2.5 border-b border-border align-top">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="font-body text-[13.5px] leading-[1.6] text-charcoal px-4 py-3 border-b border-border/60 align-top">
            {children}
          </td>
        ),
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
