import { useRef, useState } from 'react';
import { ChevronRight, Megaphone } from 'lucide-react';
import type { BusinessAnnouncement } from '@grocery-app/shared';
import { Card, CardHeader } from '@/sales/components/ui';
import { useBusinessSeenStore } from '@/stores/businessSeenStore';
import { useBizT } from '../../lib/i18n';
import { notesOf, type Story } from '../../lib/stories';
import { TAG_TONE, TONE, dayParts, madridToday, nextDay, pick, type Lang } from '../../lib/homeLook';
import { StoryViewer } from './Stories';

/*
 * Cesto's announcements on the business home (2026-10-31, user: "and then
 * announcements"): the days coming up first, then the rest, as the team
 * writes them in Admin → Business home. One not opened yet carries a dot and
 * counts in "N nuevos" (and in the home tab's dot); a tap opens it full
 * screen, and the viewer carries on through the others (Stories).
 */
export function Announcements({ items, lang, onOpen, className = '' }: {
  items: BusinessAnnouncement[]; lang: Lang; onOpen: (link: string) => void; className?: string;
}) {
  const t = useBizT();
  const seen = useBusinessSeenStore((s) => s.seen);
  const [open, setOpen] = useState<{ list: Story[]; index: number } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const today = madridToday();
  const tomorrow = nextDay(today);
  const fresh = items.filter((a) => !seen.includes(a.id)).length;
  const stories = notesOf(items);

  return (
    <Card className={`overflow-hidden flex flex-col ${className}`}>
      <CardHeader
        title={t('biz.notes.title')}
        icon={Megaphone}
        subtitle={t('biz.notes.sub')}
        action={fresh > 0 ? (
          <span className="h-6 px-2.5 rounded-full bg-brand text-white text-[11.5px] font-bold font-display inline-flex items-center tabular-nums whitespace-nowrap">
            {t(fresh === 1 ? 'biz.notes.new_one' : 'biz.notes.new_other', { count: fresh })}
          </span>
        ) : undefined}
      />
      {/* Beside the banners it scrolls inside; the foot fades so more reads as more. */}
      <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-border xl:pb-6 xl:[mask-image:linear-gradient(to_bottom,black_80%,transparent)]">
        {items.map((a, i) => {
          const tone = TONE[TAG_TONE[a.tag] ?? 'violet'];
          const unseen = !seen.includes(a.id);
          const body = pick(a, 'body', lang);
          const near = a.date === today ? t('biz.home.today') : a.date === tomorrow ? t('biz.home.tomorrow') : null;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={(e) => { opener.current = e.currentTarget; setOpen({ list: stories, index: i }); }}
                className="group w-full px-4 sm:px-5 py-3.5 flex gap-3.5 text-left hover:bg-surface-cream transition-colors"
              >
                <span className={`relative w-12 h-12 shrink-0 rounded-xl flex flex-col items-center justify-center ${tone.tile}`}>
                  {a.date ? (
                    <>
                      <span className="text-[18px] font-bold font-display leading-none tabular-nums">{dayParts(a.date, lang).day}</span>
                      <span className="mt-0.5 text-[10.5px] font-semibold font-display leading-none">{dayParts(a.date, lang).month}</span>
                    </>
                  ) : (
                    <Megaphone size={20} strokeWidth={1.75} />
                  )}
                  {unseen && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-brand ring-2 ring-card" aria-label={t('biz.notes.unseen')} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={`h-[22px] px-2 rounded-full text-[11px] font-semibold font-display inline-flex items-center ${tone.tile}`}>
                      {t(`biz.home.tag.${a.tag}`)}
                    </span>
                    {near && <span className="text-[12px] font-semibold font-display text-brand">{near}</span>}
                  </span>
                  <span className={`block mt-1.5 text-[14.5px] leading-snug ${unseen ? 'font-bold' : 'font-semibold'} font-display text-ink`}>{pick(a, 'title', lang)}</span>
                  {body && <span className="block mt-0.5 text-[13px] text-gray leading-snug line-clamp-2">{body}</span>}
                </span>
                <ChevronRight size={18} strokeWidth={2} className="self-center text-muted shrink-0 transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          );
        })}
      </ul>
      {open && (
        <StoryViewer
          stories={open.list}
          start={open.index}
          lang={lang}
          onOpen={onOpen}
          onClose={() => { setOpen(null); opener.current?.focus(); }}
        />
      )}
    </Card>
  );
}
