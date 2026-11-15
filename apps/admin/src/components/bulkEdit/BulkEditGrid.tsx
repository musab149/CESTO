import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComboboxOption } from '@/components/form/Combobox';
import BulkEditCell from './BulkEditCell';
import { BULK_COLUMNS, STICKY_COLUMN_KEY, type ColumnDef, type OptionsSource } from './columns';
import type { GridRow } from './types';
import type { BulkEditDraft } from './useBulkEditDraft';

interface Props {
  rows: GridRow[];
  visibleColumns: ColumnDef[];
  draft: BulkEditDraft;
  /** Options per source. Subcategory/productType are filtered per row. */
  optionsFor: (source: OptionsSource, row: GridRow) => ComboboxOption[];
}

const STICKY_COL = BULK_COLUMNS.find((c) => c.key === STICKY_COLUMN_KEY)!;

export default function BulkEditGrid({ rows, visibleColumns, draft, optionsFor }: Props) {
  const { t } = useTranslation();
  // Only one editor is mounted at a time — with 250 products × 20 columns,
  // mounting a controlled input per cell is what would actually be slow.
  const [active, setActive] = useState<{ rowKey: string; colKey: string } | null>(null);
  // Stable so the select editor's outside-click listener subscribes once.
  const deactivate = useCallback(() => setActive(null), []);

  const totalWidth = STICKY_COL.width + visibleColumns.reduce((s, c) => s + c.width, 0);

  return (
    // h-full + flex so the card fills whatever height the page gives it —
    // with only a couple of products the table shouldn't shrink to a sliver.
    <div className="bg-card border border-border rounded-xl overflow-hidden h-full flex flex-col">
      <div className="overflow-auto flex-1">
        <table className="border-separate border-spacing-0" style={{ width: totalWidth }}>
          <colgroup>
            <col style={{ width: STICKY_COL.width }} />
            {visibleColumns.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-surface-cream border-b border-r border-border text-left text-xs font-semibold text-gray uppercase px-3 py-2.5 font-display">
                {t(`products.bulk.fields.${STICKY_COL.labelKey}`)}
              </th>
              {visibleColumns.map((c) => (
                <th key={c.key} className="sticky top-0 z-20 bg-surface-cream border-b border-border text-left text-xs font-semibold text-gray uppercase px-3 py-2.5 font-display whitespace-nowrap">
                  {t(`products.bulk.fields.${c.labelKey}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isVariant = row.kind === 'variant';
              const rowBg = isVariant ? 'bg-surface-linen/40' : 'bg-card';
              return (
                <tr key={row.key} className="group">
                  <td className={`sticky left-0 z-10 ${rowBg} border-b border-r border-border`}>
                    {isVariant ? (
                      <div className="pl-8 pr-3 py-2 text-sm text-muted font-display truncate">
                        {row.variant.name_es || t('products.bulk.variantRow', { index: row.index })}
                      </div>
                    ) : (
                      <Cell row={row} col={STICKY_COL} draft={draft} active={active} setActive={setActive} deactivate={deactivate} optionsFor={optionsFor} />
                    )}
                  </td>
                  {visibleColumns.map((col) => (
                    <td key={col.key} className={`${rowBg} border-b border-border`}>
                      {col.scope === row.kind
                        ? <Cell row={row} col={col} draft={draft} active={active} setActive={setActive} deactivate={deactivate} optionsFor={optionsFor} />
                        : <div className="px-3 py-2 text-sm text-muted/50">—</div>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ row, col, draft, active, setActive, deactivate, optionsFor }: {
  row: GridRow;
  col: ColumnDef;
  draft: BulkEditDraft;
  active: { rowKey: string; colKey: string } | null;
  setActive: (a: { rowKey: string; colKey: string } | null) => void;
  deactivate: () => void;
  optionsFor: (source: OptionsSource, row: GridRow) => ComboboxOption[];
}) {
  const { t } = useTranslation();
  const scope = col.scope;
  const rowId = row.kind === 'product' ? row.productId : row.variant.id;
  const source = row.kind === 'product' ? row.product : row.variant;

  // Decimal columns arrive as strings from Prisma — normalise before diffing
  // or every price cell would read as dirty on first edit.
  const raw = source[col.field];
  const original = (col.type === 'currency' || col.type === 'number') && raw !== null && raw !== undefined
    ? Number(raw)
    : raw ?? null;

  const { value: edited, dirty } = draft.getCell(scope, rowId, col.field);
  const value = dirty ? edited : original;
  const error = draft.getError(scope, rowId, col.field);
  const isActive = active?.rowKey === row.key && active?.colKey === col.key;

  return (
    <BulkEditCell
      col={col}
      value={value}
      original={original}
      dirty={dirty}
      error={error}
      active={isActive}
      options={col.optionsSource ? optionsFor(col.optionsSource, row) : undefined}
      invalidMessage={t('products.bulk.fixErrors')}
      onActivate={() => setActive({ rowKey: row.key, colKey: col.key })}
      onDeactivate={deactivate}
      onError={(msg) => draft.setError(scope, rowId, col.field, msg)}
      onCommit={(next) => draft.setCell(scope, rowId, col.field, next, original)}
    />
  );
}
