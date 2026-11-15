import { useCallback, useMemo, useState } from 'react';
import type { AdminBulkUpdateItem, AdminProductPatch, AdminVariantPatch } from '@grocery-app/shared';

type Patch = Record<string, unknown>;

export interface CellRef {
  rowId: string;
  field: string;
}

/**
 * Dirty-state for the grid.
 *
 * Two maps keyed by row id. The important bit is that writing a value back to
 * its original un-dirties the cell — without that, Save stays enabled forever
 * and re-sends no-op patches.
 */
export function useBulkEditDraft() {
  const [productEdits, setProductEdits] = useState<Map<string, Patch>>(new Map());
  const [variantEdits, setVariantEdits] = useState<Map<string, Patch>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  const isDirty = productEdits.size > 0 || variantEdits.size > 0;
  const dirtyCount = productEdits.size + variantEdits.size;
  const hasErrors = errors.size > 0;

  const setCell = useCallback((
    scope: 'product' | 'variant',
    rowId: string,
    field: string,
    value: unknown,
    original: unknown,
  ) => {
    const apply = (prev: Map<string, Patch>) => {
      const next = new Map(prev);
      const entry: Patch = { ...(next.get(rowId) ?? {}) };
      // Object.is treats null/undefined distinctly, which is what we want —
      // clearing a nullable field to null is a real change.
      if (Object.is(value, original ?? null) || Object.is(value, original)) {
        delete entry[field];
      } else {
        entry[field] = value;
      }
      if (Object.keys(entry).length === 0) next.delete(rowId);
      else next.set(rowId, entry);
      return next;
    };
    if (scope === 'product') setProductEdits(apply);
    else setVariantEdits(apply);
  }, []);

  const getCell = useCallback((
    scope: 'product' | 'variant',
    rowId: string,
    field: string,
  ): { value: unknown; dirty: boolean } => {
    const map = scope === 'product' ? productEdits : variantEdits;
    const entry = map.get(rowId);
    if (entry && field in entry) return { value: entry[field], dirty: true };
    return { value: undefined, dirty: false };
  }, [productEdits, variantEdits]);

  const errorKey = (scope: string, rowId: string, field: string) => `${scope}:${rowId}:${field}`;

  const setError = useCallback((scope: 'product' | 'variant', rowId: string, field: string, message: string | null) => {
    setErrors((prev) => {
      const key = errorKey(scope, rowId, field);
      if (!message && !prev.has(key)) return prev;
      const next = new Map(prev);
      if (message) next.set(key, message);
      else next.delete(key);
      return next;
    });
  }, []);

  const getError = useCallback((scope: 'product' | 'variant', rowId: string, field: string) =>
    errors.get(errorKey(scope, rowId, field)) ?? null, [errors]);

  /**
   * Clear every edit on a product and its variants. Used after a chunk saves
   * so the failed rows stay dirty and the succeeded ones don't.
   */
  const clearProduct = useCallback((productId: string, variantIds: string[]) => {
    setProductEdits((prev) => {
      if (!prev.has(productId)) return prev;
      const next = new Map(prev);
      next.delete(productId);
      return next;
    });
    setVariantEdits((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const vid of variantIds) if (next.delete(vid)) changed = true;
      return changed ? next : prev;
    });
  }, []);

  const reset = useCallback(() => {
    setProductEdits(new Map());
    setVariantEdits(new Map());
    setErrors(new Map());
  }, []);

  /**
   * Roll the two maps up into the API payload. `variantOwner` maps a variant
   * id to its product id so variant-only edits still produce an item.
   */
  const buildItems = useCallback((variantOwner: Map<string, string>): AdminBulkUpdateItem[] => {
    const byProduct = new Map<string, AdminBulkUpdateItem>();

    for (const [productId, patch] of productEdits) {
      byProduct.set(productId, { id: productId, product: patch as AdminProductPatch });
    }
    for (const [variantId, patch] of variantEdits) {
      const productId = variantOwner.get(variantId);
      if (!productId) continue;
      const item = byProduct.get(productId) ?? { id: productId };
      item.variants = [...(item.variants ?? []), { id: variantId, ...patch } as AdminVariantPatch];
      byProduct.set(productId, item);
    }
    return Array.from(byProduct.values());
  }, [productEdits, variantEdits]);

  return useMemo(() => ({
    productEdits, variantEdits,
    isDirty, dirtyCount, hasErrors,
    setCell, getCell, setError, getError,
    clearProduct, reset, buildItems,
  }), [
    productEdits, variantEdits, isDirty, dirtyCount, hasErrors,
    setCell, getCell, setError, getError, clearProduct, reset, buildItems,
  ]);
}

export type BulkEditDraft = ReturnType<typeof useBulkEditDraft>;
