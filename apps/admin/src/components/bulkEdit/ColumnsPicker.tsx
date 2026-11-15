import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns3, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BULK_COLUMNS, COLUMN_GROUPS, STICKY_COLUMN_KEY } from './columns';

interface Props {
  visible: string[];
  onChange: (keys: string[]) => void;
}

export default function ColumnsPicker({ visible, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visibleSet = useMemo(() => new Set(visible), [visible]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COLUMN_GROUPS.map((group) => ({
      group,
      cols: BULK_COLUMNS.filter((c) => {
        if (c.group !== group) return false;
        if (!q) return true;
        return t(`products.bulk.fields.${c.labelKey}`).toLowerCase().includes(q);
      }),
    })).filter((g) => g.cols.length > 0);
  }, [query, t]);

  function toggle(key: string) {
    onChange(visibleSet.has(key) ? visible.filter((k) => k !== key) : [...visible, key]);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 bg-card border-2 border-border hover:border-brand hover:bg-brand-mist/40 text-ink font-semibold font-display text-sm px-4 h-10 rounded-lg transition"
      >
        <Columns3 className="w-4 h-4" strokeWidth={1.75} />
        {t('products.bulk.columns')}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-card border border-border rounded-xl shadow-modal z-40 overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.75} />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('products.bulk.columnsSearch')}
                className="w-full h-9 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-sm font-display text-ink outline-none focus:border-brand"
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto py-1">
            {grouped.map(({ group, cols }) => (
              <div key={group}>
                <p className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-display">
                  {t(`products.bulk.groups.${group}`)}
                </p>
                {cols.map((c) => {
                  const locked = c.key === STICKY_COLUMN_KEY;
                  return (
                    <label
                      key={c.key}
                      className={`flex items-center gap-2.5 px-3 py-1.5 text-sm font-display text-ink transition ${locked ? 'opacity-60' : 'hover:bg-brand-mist/40 cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={locked || visibleSet.has(c.key)}
                        disabled={locked}
                        onChange={() => toggle(c.key)}
                        className="w-4 h-4 rounded border-border text-brand focus:ring-brand"
                      />
                      {t(`products.bulk.fields.${c.labelKey}`)}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
