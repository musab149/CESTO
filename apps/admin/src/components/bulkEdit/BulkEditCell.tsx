import { useEffect, useRef, useState } from 'react';
import type { ComboboxOption } from '@/components/form/Combobox';
import Combobox from '@/components/form/Combobox';
import { parseNumericCell, type ColumnDef } from './columns';

export interface BulkEditCellProps {
  col: ColumnDef;
  /** Current effective value — the edited one if dirty, else the original. */
  value: unknown;
  original: unknown;
  dirty: boolean;
  error: string | null;
  active: boolean;
  options?: ComboboxOption[];
  onActivate: () => void;
  onDeactivate: () => void;
  onCommit: (value: unknown) => void;
  onError: (message: string | null) => void;
  invalidMessage: string;
}

function formatDisplay(col: ColumnDef, value: unknown, options?: ComboboxOption[]): string {
  if (value === null || value === undefined || value === '') return '—';
  if (col.type === 'currency') {
    return `${Number(value).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  }
  if (col.type === 'select') {
    const match = options?.find((o) => o.kind !== 'separator' && o.value === String(value));
    return match && match.kind !== 'separator' ? match.label : String(value);
  }
  return String(value);
}

/** Raw text an editor should start with — never the "—" placeholder. */
function toEditText(col: ColumnDef, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (col.type === 'currency') return String(value).replace('.', ',');
  return String(value);
}

const CELL_BASE = 'w-full h-full px-3 py-2 text-sm text-ink font-display text-left truncate transition';

export default function BulkEditCell({
  col, value, original, dirty, error, active, options,
  onActivate, onDeactivate, onCommit, onError, invalidMessage,
}: BulkEditCellProps) {
  // Booleans and radios have no edit mode — one click is the whole interaction.
  if (col.type === 'boolean') {
    return (
      <div className="flex items-center justify-center h-full px-3 py-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onCommit(e.target.checked)}
          className={`w-4 h-4 rounded border-border text-brand focus:ring-brand cursor-pointer ${dirty ? 'ring-2 ring-brand/40' : ''}`}
        />
      </div>
    );
  }

  if (col.type === 'default-radio') {
    return (
      <div className="flex items-center justify-center h-full px-3 py-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          // Only ever turned on — the server clears the siblings, so letting
          // an admin untick would leave the product with no default at all.
          disabled={Boolean(value)}
          onChange={() => onCommit(true)}
          className="w-4 h-4 rounded-full border-border text-brand focus:ring-brand cursor-pointer disabled:cursor-default"
        />
      </div>
    );
  }

  if (col.type === 'select') {
    if (!active) {
      return (
        <button type="button" onClick={onActivate} className={`${CELL_BASE} ${dirty ? 'bg-brand-mist/50' : ''} ${error ? 'bg-danger-bg' : ''}`}>
          {formatDisplay(col, value, options)}
        </button>
      );
    }
    return (
      <SelectEditor
        col={col} value={value} options={options}
        onCommit={onCommit} onDeactivate={onDeactivate}
      />
    );
  }

  return (
    <TextlikeCell
      col={col} value={value} original={original} dirty={dirty} error={error} active={active}
      onActivate={onActivate} onDeactivate={onDeactivate} onCommit={onCommit}
      onError={onError} invalidMessage={invalidMessage}
    />
  );
}

function SelectEditor({
  col, value, options, onCommit, onDeactivate,
}: Pick<BulkEditCellProps, 'col' | 'value' | 'options' | 'onCommit' | 'onDeactivate'>) {
  const wrapRef = useRef<HTMLDivElement>(null);

  // Clicking elsewhere should drop the cell out of edit mode, not leave a
  // stray closed combobox sitting in the row. (onDeactivate is stable — the
  // grid memoises it — so this subscribes once.)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Element | null;
      if (wrapRef.current?.contains(t as Node)) return;
      // The menu is portalled to body, so it's technically outside the cell —
      // ignoring it here keeps a click on an option from unmounting the
      // combobox before the option's own click handler fires.
      if (t?.closest?.('[role="listbox"]')) return;
      onDeactivate();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onDeactivate]);

  return (
    <div ref={wrapRef} className="px-1.5 py-1">
      <Combobox
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(next) => {
          onCommit(next === '' ? (col.nullable ? null : undefined) : next);
          onDeactivate();
        }}
        options={options ?? []}
        searchable={(options?.length ?? 0) > 8}
        placeholder="—"
        className="h-9"
        // The grid scrolls, so an in-flow menu gets clipped to the cell.
        menuPortal
        menuMinWidth={280}
      />
    </div>
  );
}

function TextlikeCell({
  col, value, dirty, error, active,
  onActivate, onDeactivate, onCommit, onError, invalidMessage,
}: Omit<BulkEditCellProps, 'options' | 'original'> & { original?: unknown }) {
  if (!active) {
    return (
      <button
        type="button"
        onClick={onActivate}
        title={error ?? undefined}
        className={`${CELL_BASE} ${dirty ? 'bg-brand-mist/50' : ''} ${error ? 'bg-danger-bg text-danger' : ''} hover:bg-surface-cream`}
      >
        {formatDisplay(col, value)}
      </button>
    );
  }
  // Mounted only while editing, so the draft seeds from the current value at
  // mount — no effect syncing prop → state.
  return (
    <TextlikeEditor
      col={col} value={value} error={error}
      onDeactivate={onDeactivate} onCommit={onCommit}
      onError={onError} invalidMessage={invalidMessage}
    />
  );
}

function TextlikeEditor({
  col, value, error, onDeactivate, onCommit, onError, invalidMessage,
}: Pick<BulkEditCellProps, 'col' | 'value' | 'error' | 'onDeactivate' | 'onCommit' | 'onError' | 'invalidMessage'>) {
  const [draft, setDraft] = useState(() => toEditText(col, value));
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // autoFocus on a conditionally-mounted input doesn't reliably fire in
  // React 19 when the swap happens inside the same commit.
  useEffect(() => { ref.current?.focus(); }, []);

  function commit() {
    if (col.type === 'number' || col.type === 'currency') {
      const parsed = parseNumericCell(draft, col);
      if (parsed === undefined) {
        onError(invalidMessage);
        return;
      }
      onError(null);
      onCommit(parsed);
    } else {
      const trimmed = draft.trim();
      if (trimmed === '' && !col.nullable) {
        onError(invalidMessage);
        return;
      }
      onError(null);
      onCommit(trimmed === '' ? null : trimmed);
    }
    onDeactivate();
  }

  const inputClass =`w-full bg-card border-2 ${error ? 'border-danger' : 'border-brand'} rounded-lg px-2 py-1.5 text-sm font-display text-ink outline-none`;

  if (col.type === 'textarea') {
    return (
      <div className="px-1.5 py-1">
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { onError(null); onDeactivate(); }
          }}
          className={inputClass}
        />
      </div>
    );
  }

  return (
    <div className="px-1.5 py-1">
      <input
        ref={ref as React.RefObject<HTMLInputElement>}
        type="text"
        inputMode={col.type === 'number' || col.type === 'currency' ? 'decimal' : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { onError(null); onDeactivate(); }
        }}
        className={inputClass}
      />
    </div>
  );
}
