// ─── The partner-access mail, rendered ─────────────────────────────────────
//
// A test run never reaches a mail provider (lib/mailer pickMailer), so the
// mail a partner gets when the office gives them a store, or sends their login
// again, is checked here by rendering it: every kind, with and without a
// password, in both languages.
//
//   · it names the store(s), and lists two as "A and B" / "A y B"
//   · the password appears only when there is one; "your usual password" else
//   · it says where the store is once signed in ("Manage store")
//   · it promises nothing an application approval would (no "approved", no
//     "draft" — a store linked this way may already be live)
//   · a store name with HTML in it is escaped in the HTML part
//
// Run:  cd packages/api && npm run test:partner-access-email
// Set PREVIEW_DIR to also write each variant's HTML there, to look at.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { buildPartnerAccessEmail, type PartnerAccessEmailPayload } from './mailer';

const base: PartnerAccessEmailPayload = {
  to: 'lucia@tienda.test',
  name: 'Lucía Prueba',
  kind: 'linked',
  storeNames: ['Frutería El Olivo'],
  loginUrl: 'https://www.cestoshop.com/login',
  loginEmail: 'lucia@tienda.test',
  tempPassword: 'Abc123Def456',
  lang: 'es',
};

let passed = 0;
let failed = 0;
const test = (name: string, run: () => void) => {
  try { run(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${(e as Error).message}`); }
};
const render = (over: Partial<PartnerAccessEmailPayload>) => buildPartnerAccessEmail({ ...base, ...over });
const all = (m: { subject: string; text: string; html: string }) => `${m.subject}\n${m.text}\n${m.html}`;

const VARIANTS: Array<[string, Partial<PartnerAccessEmailPayload>]> = [
  ['es-linked-password', {}],
  ['es-linked-own', { tempPassword: null }],
  ['es-credentials', { kind: 'credentials', storeNames: ['Frutería El Olivo', 'Olivo Express'] }],
  ['en-linked-password', { lang: 'en' }],
  ['en-linked-own', { lang: 'en', tempPassword: null }],
  ['en-credentials', { lang: 'en', kind: 'credentials', storeNames: ['Frutería El Olivo', 'Olivo Express'] }],
];

console.log('\nThe words');
test('es, linked, with a password: subject, store, password, where to go', () => {
  const m = render({});
  assert.strictEqual(m.subject, 'Ya gestionas Frutería El Olivo en Cesto Shop');
  assert.ok(m.text.includes('Hola Lucía,'));
  assert.ok(m.text.includes('Contraseña: Abc123Def456'));
  assert.ok(m.html.includes('Abc123Def456'));
  assert.ok(m.text.includes('«Gestionar tienda»') && m.html.includes('Gestionar tienda'));
  assert.ok(m.text.includes('https://www.cestoshop.com/login') && m.html.includes('https://www.cestoshop.com/login'));
  assert.ok(m.text.includes('solo funciona una vez'));
});
test('es, linked, keeping their own password: no password, "the one you already use"', () => {
  const m = render({ tempPassword: null });
  assert.ok(!m.text.includes('Abc123Def456') && !m.html.includes('Abc123Def456'));
  assert.ok(m.text.includes('Contraseña: la que ya usas en Cesto Shop.'));
  assert.ok(m.html.includes('la contraseña que ya usas'));
  assert.ok(m.text.includes('«¿Olvidaste tu contraseña?»'), 'points at the sign-in page\'s own link text');
});
test('es, credentials, two stores: "A y B", the old password is dead', () => {
  const m = render({ kind: 'credentials', storeNames: ['Frutería El Olivo', 'Olivo Express'] });
  assert.strictEqual(m.subject, 'Tus nuevos datos de acceso a Cesto Shop para Frutería El Olivo y Olivo Express');
  assert.ok(m.text.includes('La anterior ya no funciona.'));
});
test('three stores read "A, B y C"', () => {
  const m = render({ storeNames: ['A', 'B', 'C'] });
  assert.strictEqual(m.subject, 'Ya gestionas A, B y C en Cesto Shop');
});
test('en, linked, with a password', () => {
  const m = render({ lang: 'en' });
  assert.strictEqual(m.subject, 'You now manage Frutería El Olivo on Cesto Shop');
  assert.ok(m.text.includes('Hi Lucía,') && m.text.includes('Password: Abc123Def456'));
  assert.ok(m.text.includes('"Manage store"') && m.html.includes('Manage store'));
});
test('en, linked, own password', () => {
  const m = render({ lang: 'en', tempPassword: null });
  assert.ok(m.text.includes('Password: the one you already use for Cesto Shop.'));
  assert.ok(m.text.includes('"Forgot password?"'));
  assert.ok(!all(m).includes('Abc123Def456'));
});
test('en, credentials, two stores: "A and B"', () => {
  const m = render({ lang: 'en', kind: 'credentials', storeNames: ['Frutería El Olivo', 'Olivo Express'] });
  assert.strictEqual(m.subject, 'Your new Cesto Shop sign-in for Frutería El Olivo and Olivo Express');
  assert.ok(m.text.includes('The previous one no longer works.'));
});

console.log('\nWhat it must not say');
test('no approval or draft promise in any variant', () => {
  for (const [name, over] of VARIANTS) {
    const s = all(render(over)).toLowerCase();
    for (const word of ['approved', 'aprobad', 'draft', 'borrador', 'application', 'solicitud', 'delivery area', 'zona de reparto']) {
      assert.ok(!s.includes(word), `${name} says "${word}"`);
    }
  }
});
test('a store name with HTML in it is escaped in the HTML part', () => {
  const m = render({ storeNames: ['Café <b>&</b> Co'] });
  assert.ok(!m.html.includes('<b>&</b>'), 'raw tag reached the HTML');
  assert.ok(m.html.includes('Café &lt;b&gt;&amp;&lt;/b&gt; Co'));
});
test('a person with no name is greeted plainly', () => {
  assert.ok(render({ name: '' }).text.startsWith('Hola,'));
  assert.ok(render({ name: '', lang: 'en' }).text.startsWith('Hi,'));
});

if (process.env.PREVIEW_DIR) {
  fs.mkdirSync(process.env.PREVIEW_DIR, { recursive: true });
  for (const [name, over] of VARIANTS) {
    fs.writeFileSync(path.join(process.env.PREVIEW_DIR, `${name}.html`), render(over).html);
  }
  console.log(`\npreviews in ${process.env.PREVIEW_DIR}`);
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
