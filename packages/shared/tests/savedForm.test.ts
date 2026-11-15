/**
 * A form's unsaved changes kept in the browser (factura editor, 2026-11-04).
 * What must hold: it comes back as it was, only for the same panel, person
 * and thing, only for a day, never in a shape the screen does not recognise;
 * it never clears a saved basket (nor a basket sweep it); and storage that is
 * missing or throws never breaks the screen.
 *
 *   npm run test:saved-form --workspace=packages/shared
 */
import assert from 'assert';
import {
  formKey, readSavedForm, writeSavedForm, clearSavedForm, sweepSavedForms, SAVED_FORM_TTL_MS,
} from '../src/savedForm';
import { basketKey, readBasket, writeBasket, sweepBaskets } from '../src/savedBasket';

/** Just enough of the Web Storage API. */
class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const g = globalThis as unknown as { localStorage?: unknown };
const mem = new MemoryStorage();
g.localStorage = mem;

interface Form { notes: string; lines: string[] }
const isForm = (v: unknown): v is Form =>
  !!v && typeof (v as Form).notes === 'string' && Array.isArray((v as Form).lines);

let passed = 0;
const check = (name: string, fn: () => void) => {
  mem.clear();
  fn();
  passed += 1;
  console.log(`  PASS  ${name}`);
};

const NOW = 1_800_000_000_000;
const key = formKey('admin', 'admin-1', 'invoice:inv-1');

check('a written form comes back as it was, with its baseline', () => {
  writeSavedForm<Form>(key, { notes: 'hola', lines: ['a', 'b'] }, 'base-1', NOW);
  const s = readSavedForm(key, isForm, NOW + 1000);
  assert.deepEqual(s, { savedAt: NOW, baseline: 'base-1', form: { notes: 'hola', lines: ['a', 'b'] } });
});

check('one per panel, person and thing', () => {
  writeSavedForm<Form>(key, { notes: 'x', lines: [] }, 'b', NOW);
  assert.equal(readSavedForm(formKey('admin', 'admin-2', 'invoice:inv-1'), isForm, NOW), null);
  assert.equal(readSavedForm(formKey('admin', 'admin-1', 'invoice:inv-2'), isForm, NOW), null);
  assert.equal(readSavedForm(formKey('sales', 'admin-1', 'invoice:inv-1'), isForm, NOW), null);
});

check('older than a day: gone, and cleared', () => {
  writeSavedForm<Form>(key, { notes: 'x', lines: [] }, 'b', NOW);
  assert.equal(readSavedForm(key, isForm, NOW + SAVED_FORM_TTL_MS + 1), null);
  assert.equal(mem.getItem(key), null);
});

check('a shape the screen does not recognise: gone, and cleared', () => {
  mem.setItem(key, JSON.stringify({ savedAt: NOW, baseline: 'b', form: { notes: 3 } }));
  assert.equal(readSavedForm(key, isForm, NOW), null);
  assert.equal(mem.getItem(key), null);
  mem.setItem(key, '{not json');
  assert.equal(readSavedForm(key, isForm, NOW), null);
  mem.setItem(key, JSON.stringify({ savedAt: NOW, form: { notes: '', lines: [] } }));
  assert.equal(readSavedForm(key, isForm, NOW), null, 'no baseline, no restore');
});

check('clearing removes it', () => {
  writeSavedForm<Form>(key, { notes: 'x', lines: [] }, 'b', NOW);
  clearSavedForm(key);
  assert.equal(readSavedForm(key, isForm, NOW), null);
});

check('a form sweep drops only stale forms — never a basket; a basket sweep never drops a form', () => {
  const stale = formKey('admin', 'admin-1', 'invoice:old');
  writeSavedForm<Form>(stale, { notes: '', lines: [] }, 'b', NOW - SAVED_FORM_TTL_MS - 10);
  writeSavedForm<Form>(key, { notes: 'keep', lines: [] }, 'b', NOW);
  const bKey = basketKey('admin', 'admin-1', 'client-1');
  writeBasket(bKey, {
    lines: [{ key: 'k', variantId: 'v', quantity: 1 }], addressId: '', feeInput: null, notes: '', hgSlot: null, attemptKey: null, baseline: null,
  }, NOW);
  sweepSavedForms('admin', NOW);
  assert.equal(mem.getItem(stale), null);
  assert.ok(readSavedForm(key, isForm, NOW));
  assert.ok(readBasket(bKey, NOW));
  sweepBaskets('admin', NOW);
  assert.ok(readSavedForm(key, isForm, NOW), 'the basket sweep left the form alone');
});

check('no storage, or storage that throws: nothing saved, nothing breaks', () => {
  g.localStorage = {
    getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); },
    removeItem() { throw new Error('blocked'); }, key() { return null; }, length: 0,
  };
  writeSavedForm<Form>(key, { notes: 'x', lines: [] }, 'b', NOW);
  assert.equal(readSavedForm(key, isForm, NOW), null);
  clearSavedForm(key);
  sweepSavedForms('admin', NOW);
  delete g.localStorage;
  assert.equal(readSavedForm(key, isForm, NOW), null);
  g.localStorage = mem;
});

console.log(`\n${passed}/${passed} passed`);
