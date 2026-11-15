// Outbound mail. A tiny interface so the provider is swappable — route handlers
// keep calling `sendPasswordResetEmail` and don't care about the backend.
//
// Provider picked at boot: if RESEND_API_KEY is set we use Resend; otherwise
// we fall back to the console mailer so local dev still works with no setup.

import { Resend } from 'resend';

export type EmailLang = 'es' | 'en';

export interface ResetEmailPayload {
  to: string;
  resetUrl: string;
  expiresAt: Date;
  lang?: EmailLang;
}

export interface SupportTicketEmailPayload {
  /** The support inbox to notify (e.g. support.cesto@gmail.com). */
  to: string;
  /** Customer-facing fields straight from the ticket. */
  ticketId: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  body: string;
  /** "contact_form" | "help_center" | etc — where they submitted from. */
  source: string;
  /** "en" | "es" if the customer's UI language was captured. */
  language: string | null;
  /** Direct deep link into the admin inbox detail view. */
  adminUrl: string;
}

export interface WelcomeEmailPayload {
  to: string;
  name: string;
  lang: EmailLang;
  webUrl: string;
}

export interface OrderPlacedEmailPayload {
  to: string;
  name: string;
  lang: EmailLang;
  orderNumber: string;
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  /**
   * Recargo de equivalencia charged (2026-11-04) — part of `total`, its own
   * line on the receipt so the figures add up. 0 or absent: no line.
   */
  recargo?: number;
  /**
   * True when the fee has not been decided yet — a wholesale order, which the
   * office prices once it can see the drop.
   *
   * Without it the receipt says "Delivery: Free", in writing, to a customer
   * who is about to be charged for it. The screens already say otherwise; a
   * receipt that contradicts them is worse than one that says nothing.
   */
  deliveryFeePending?: boolean;
  /**
   * The fee is decided and it is nothing — our team waived it, or the basket
   * cleared the free-delivery line. Without it a zero reads as "not priced
   * yet", which is right for a wholesale checkout and wrong for these.
   */
  deliveryFeeFree?: boolean;
  /**
   * Our team built this order for them (staff in the panel or a sales rep),
   * rather than the customer checking out. Same receipt, but it says who put
   * it together instead of thanking them for an order they did not place.
   */
  placedForYou?: boolean;
  total: number;
  addressLines: string[];
  trackUrl: string;
}

export type OrderStatusEmailStatus =
  | 'confirmed'
  | 'preparing'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled';

export interface OrderStatusEmailPayload {
  to: string;
  name: string;
  lang: EmailLang;
  orderNumber: string;
  status: OrderStatusEmailStatus;
  reason: string | null;
  trackUrl: string;
}

export interface OrderEditedEmailPayload {
  to: string;
  name: string;
  lang: EmailLang;
  orderNumber: string;
  /** Short bullet-style summary lines, already in the target language —
   *  built by the caller (notifications.ts) so this module stays
   *  presentation-only and doesn't need DB access. */
  changeSummaryLines: string[];
  newTotal: number;
  trackUrl: string;
}

export interface SupportTicketReceiptPayload {
  to: string;
  name: string;
  lang: EmailLang;
  ticketId: string;
  subject: string;
}

// ─── MV Slice 1 partner-approval emails ──────────────────
// Four templates for the B2bLead approval workflow. All customer-facing
// (to the applicant), all bilingual. See docs/MULTIVENDOR_ROADMAP.md.

export interface PartnerWelcomeEmailPayload {
  to: string;
  /** Applicant's display name (first name shown in the greeting). */
  name: string;
  /** Store name as displayed to customers — appears in the subject/heading. */
  storeName: string;
  /** Login URL for the partner dashboard (Slice 2 wires this). */
  loginUrl: string;
  /** Partner's login email — usually equals `to`, but kept explicit so we
   *  don't ambiguate if the admin approves under a different address later. */
  loginEmail: string;
  /** 12-char temp password. Included in the email body — the partner has no
   *  other way to recover it. Slice 2's forced first-login pw change makes
   *  this a one-shot secret. */
  tempPassword: string;
  lang: EmailLang;
}

/**
 * A partner's access to their store, handed over by Cesto rather than won
 * through an application (2026-10-31, user: "connect the store to a user…
 * that user becomes a partner… and we should have that credentials resend
 * functionality for that too"). Unlike the welcome above it promises nothing
 * about an approval or a draft: a store linked this way may already be live.
 *
 *   linked       — they have just been given the store(s).
 *   credentials  — a new temporary password for the store(s) they manage.
 *
 * `tempPassword` is null only for `linked` when they keep a password of their
 * own: the mail then says to sign in as usual, and carries no secret.
 */
export interface PartnerAccessEmailPayload {
  to: string;
  name: string;
  kind: 'linked' | 'credentials';
  /** The stores they manage, as customers see them named. */
  storeNames: string[];
  loginUrl: string;
  loginEmail: string;
  tempPassword: string | null;
  lang: EmailLang;
}

/**
 * Credentials handoff for an approved B2B business (wholesale buyer). The
 * counterpart to PartnerWelcomeEmailPayload, but there is no store and the
 * login target is the customer storefront, not a dashboard.
 */
export interface BusinessWelcomeEmailPayload {
  to: string;
  /** Applicant's display name (first name shown in the greeting). */
  name: string;
  /** Trading name from the lead — appears in the subject/heading. */
  companyName: string;
  /** Customer storefront login URL. */
  loginUrl: string;
  /** Login email — kept explicit in case the admin approves under a
   *  different address than the one that submitted the lead. */
  loginEmail: string;
  /** 12-char temp password, one-shot: forced rotation fires on first login
   *  via User.password_is_temp. */
  tempPassword: string;
  lang: EmailLang;
}

/**
 * Credentials for an account a sales rep opened on the client's behalf.
 *
 * Separate from BusinessWelcomeEmailPayload because the client did not apply
 * for anything — someone walked into their shop and signed them up. The mail
 * has to say who that was, or it reads like a phishing attempt: an unexpected
 * message with a password in it.
 */
export interface SalesRepWelcomeEmailPayload {
  to: string;
  /** Rep's display name (first name shown in the greeting). */
  name: string;
  /** Where THEY log in — the rep screen, not the storefront. */
  loginUrl: string;
  loginEmail: string;
  /** One-shot temp password; rotation is forced by User.password_is_temp. */
  tempPassword: string;
  /** Their staff number, when one was given. */
  code?: string | null;
  lang: EmailLang;
}

export interface ClientWelcomeEmailPayload {
  to: string;
  /** Client's display name (first name shown in the greeting). */
  name: string;
  /** Set for a business client; drives the B2B pricing paragraph. */
  companyName?: string | null;
  /** Set when the client also got a shop; drives the vendor paragraph. */
  storeName?: string | null;
  /** The rep who signed them up. Omitted when nobody recorded a name. */
  salesManagerName?: string | null;
  /** Set when the account exists because a Home Grocery request was
   *  approved; drives the paragraph saying so. */
  homeGrocery?: boolean;
  /** Customer storefront login URL. */
  loginUrl: string;
  loginEmail: string;
  /** One-shot temp password; rotation is forced by User.password_is_temp. */
  tempPassword: string;
  lang: EmailLang;
}

export interface PartnerRequestInfoEmailPayload {
  to: string;
  name: string;
  /** Admin's message to the applicant, verbatim. */
  message: string;
  /** Magic-link URL to the public /apply/status/:token page. */
  statusUrl: string;
  /** When the magic link expires. Shown to the applicant so they don't lose
   *  the window. Typically 7 days from now. */
  expiresAt: Date;
  lang: EmailLang;
}

export interface PartnerRejectedEmailPayload {
  to: string;
  name: string;
  /** Rejection reason, verbatim. Free-text from admin. */
  reason: string;
  lang: EmailLang;
}

export interface PartnerInfoReceivedEmailPayload {
  to: string;
  name: string;
  lang: EmailLang;
}

/**
 * Home Grocery request approved, for a household that ALREADY had an
 * account. No credentials — their password is theirs and approval does not
 * touch it. A brand-new account gets client-welcome with `homeGrocery` set
 * instead, because that mail has to carry the login.
 */
export interface HomeGroceryApprovedEmailPayload {
  to: string;
  name: string;
  /** Where to see it — the /rashan page shows their subscriber status. */
  pageUrl: string;
  lang: EmailLang;
}

export interface HomeGroceryRejectedEmailPayload {
  to: string;
  name: string;
  /** Admin's reason, verbatim — written for the customer to read. */
  reason: string;
  /** The form, so they can apply again once the reason no longer holds. */
  pageUrl: string;
  lang: EmailLang;
}

/**
 * Plain-text admin alert. Used for the ops inbox: new B2B lead, new order,
 * new customer signup. Callers own subject/body so this stays generic —
 * no templates.
 */
export interface AdminAlertPayload {
  to: string;
  subject: string;
  /** Two-column "label: value" rows rendered as a compact table. */
  rows: Array<{ label: string; value: string }>;
  /** Deep link back into the admin panel. Optional. */
  ctaLabel?: string;
  ctaUrl?: string;
  /** Where a human replying should land. Defaults to REPLY_TO_EMAIL. */
  replyTo?: string;
}

export interface Mailer {
  sendPasswordResetEmail(payload: ResetEmailPayload): Promise<void>;
  sendSupportTicketNotification(payload: SupportTicketEmailPayload): Promise<void>;
  sendWelcomeEmail(payload: WelcomeEmailPayload): Promise<void>;
  sendOrderPlacedEmail(payload: OrderPlacedEmailPayload): Promise<void>;
  sendOrderStatusEmail(payload: OrderStatusEmailPayload): Promise<void>;
  sendOrderEditedEmail(payload: OrderEditedEmailPayload): Promise<void>;
  sendSupportTicketReceipt(payload: SupportTicketReceiptPayload): Promise<void>;
  sendAdminAlert(payload: AdminAlertPayload): Promise<void>;
  // MV Slice 1
  sendPartnerWelcomeEmail(payload: PartnerWelcomeEmailPayload): Promise<void>;
  sendPartnerAccessEmail(payload: PartnerAccessEmailPayload): Promise<void>;
  sendBusinessWelcomeEmail(payload: BusinessWelcomeEmailPayload): Promise<void>;
  sendClientWelcomeEmail(payload: ClientWelcomeEmailPayload): Promise<void>;
  sendSalesRepWelcomeEmail(payload: SalesRepWelcomeEmailPayload): Promise<void>;
  sendPartnerRequestInfoEmail(payload: PartnerRequestInfoEmailPayload): Promise<void>;
  sendPartnerRejectedEmail(payload: PartnerRejectedEmailPayload): Promise<void>;
  sendPartnerInfoReceivedEmail(payload: PartnerInfoReceivedEmailPayload): Promise<void>;
  sendHomeGroceryApprovedEmail(payload: HomeGroceryApprovedEmailPayload): Promise<void>;
  sendHomeGroceryRejectedEmail(payload: HomeGroceryRejectedEmailPayload): Promise<void>;
}

// ─── Console mailer (fallback, dev) ────────────────────
// Logs the reset URL to stdout so devs can copy-paste it during testing.

const consoleMailer: Mailer = {
  async sendPasswordResetEmail({ to, resetUrl, expiresAt }) {
    console.log(`[mail:reset] to=${to} url=${resetUrl} expires=${expiresAt.toISOString()}`);
  },
  async sendSupportTicketNotification({ to, ticketId, name, email, subject, source }) {
    console.log(`[mail:support] to=${to} ticket=${ticketId} from="${name} <${email}>" source=${source} subject="${subject}"`);
  },
  async sendWelcomeEmail({ to, name, lang }) {
    console.log(`[mail:welcome] to=${to} name="${name}" lang=${lang}`);
  },
  async sendOrderPlacedEmail({ to, orderNumber, total, lang }) {
    console.log(`[mail:order-placed] to=${to} order=${orderNumber} total=${total} lang=${lang}`);
  },
  async sendOrderStatusEmail({ to, orderNumber, status, lang }) {
    console.log(`[mail:order-status] to=${to} order=${orderNumber} status=${status} lang=${lang}`);
  },
  async sendOrderEditedEmail({ to, orderNumber, changeSummaryLines, newTotal, lang }) {
    console.log(`[mail:order-edited] to=${to} order=${orderNumber} lang=${lang} newTotal=${newTotal} changes=${changeSummaryLines.join(' | ')}`);
  },
  async sendSupportTicketReceipt({ to, ticketId, lang }) {
    console.log(`[mail:support-receipt] to=${to} ticket=${ticketId} lang=${lang}`);
  },
  async sendAdminAlert({ to, subject, rows }) {
    const summary = rows.map((r) => `${r.label}=${r.value}`).join(' | ');
    console.log(`[mail:admin-alert] to=${to} subject="${subject}" ${summary}`);
  },
  async sendPartnerWelcomeEmail({ to, storeName, loginEmail, tempPassword, loginUrl }) {
    console.log(`[mail:partner-welcome] to=${to} store="${storeName}" email=${loginEmail} tempPw=${tempPassword} url=${loginUrl}`);
  },
  async sendPartnerAccessEmail({ to, kind, storeNames, loginEmail, tempPassword, loginUrl }) {
    console.log(`[mail:partner-access] to=${to} kind=${kind} stores="${storeNames.join(', ')}" email=${loginEmail} tempPw=${tempPassword ?? '(their own)'} url=${loginUrl}`);
  },
  async sendBusinessWelcomeEmail({ to, companyName, loginEmail, tempPassword, loginUrl }) {
    console.log(`[mail:business-welcome] to=${to} company="${companyName}" email=${loginEmail} tempPw=${tempPassword} url=${loginUrl}`);
  },
  async sendClientWelcomeEmail({ to, companyName, storeName, loginEmail, tempPassword, loginUrl, salesManagerName }) {
    console.log(`[mail:client-welcome] to=${to} company="${companyName ?? '-'}" store="${storeName ?? '-'}" rep="${salesManagerName ?? '-'}" email=${loginEmail} tempPw=${tempPassword} url=${loginUrl}`);
  },
  async sendSalesRepWelcomeEmail({ to, name, code, loginEmail, tempPassword, loginUrl }) {
    console.log(`[mail:salesrep-welcome] to=${to} name="${name}" code="${code ?? '-'}" email=${loginEmail} tempPw=${tempPassword} url=${loginUrl}`);
  },
  async sendPartnerRequestInfoEmail({ to, statusUrl, expiresAt }) {
    console.log(`[mail:partner-request-info] to=${to} url=${statusUrl} expires=${expiresAt.toISOString()}`);
  },
  async sendPartnerRejectedEmail({ to, reason }) {
    console.log(`[mail:partner-rejected] to=${to} reason="${reason}"`);
  },
  async sendPartnerInfoReceivedEmail({ to }) {
    console.log(`[mail:partner-info-received] to=${to}`);
  },
  async sendHomeGroceryApprovedEmail({ to, pageUrl }) {
    console.log(`[mail:home-grocery-approved] to=${to} url=${pageUrl}`);
  },
  async sendHomeGroceryRejectedEmail({ to, reason }) {
    console.log(`[mail:home-grocery-rejected] to=${to} reason="${reason}"`);
  },
};

// ─── Shared HTML helpers ───────────────────────────────

const BRAND_GREEN = '#2E7D5B';
const SURFACE_LINEN = '#F5F0E8';
const INK = '#1A1A1A';
const MUTED = '#6B6B6B';
const SUBTLE = '#9A9A9A';

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtEur(amount: number, lang: EmailLang) {
  // Spanish uses comma decimal + "€" suffix ("12,50 €"); English uses dot + "€" prefix.
  if (lang === 'en') return `€${amount.toFixed(2)}`;
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

/**
 * Logo block for the top of an email.
 *
 * Absolute URL off WEB_URL, because a mail client has no page to resolve a
 * relative path against and cannot read anything from the bundle. The
 * wordmark rather than the icon: at 1:1 in an inbox it says the name, which
 * a bare basket does not.
 *
 * Sized in HTML attributes as well as CSS — Outlook ignores width/height in
 * a style attribute on images and would otherwise render this at its natural
 * pixel size. Wrapped in a link to the site, which is what people expect a
 * logo in an email to do.
 *
 * Alt text carries the brand for the many clients that block images by
 * default, so a blocked logo still reads as "Cesto Shop" rather than a broken
 * icon.
 */
function logoHtml() {
  const base = (process.env.WEB_URL?.trim() || 'http://localhost:5173').replace(/\/+$/, '');
  return `<div style="text-align:center;margin:0 0 20px;">
    <a href="${base}" style="text-decoration:none;">
      <img src="${base}/cesto-wordmark.png" alt="Cesto Shop" width="108" height="32"
           style="display:inline-block;border:0;outline:none;width:108px;height:auto;max-width:108px;" />
    </a>
  </div>`;
}

function shellHtml(langAttr: EmailLang, headingText: string, innerHtml: string, footerText: string) {
  return `<!doctype html>
<html lang="${langAttr}">
  <body style="margin:0;padding:0;background:${SURFACE_LINEN};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${INK};">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      ${logoHtml()}
      <div style="background:#FFFFFF;border-radius:16px;padding:32px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:${INK};">${escapeHtml(headingText)}</h1>
        ${innerHtml}
      </div>
      <p style="margin:16px 0 0;font-size:12px;color:${SUBTLE};text-align:center;">${escapeHtml(footerText)}</p>
    </div>
  </body>
</html>`;
}

function ctaButtonHtml(url: string, label: string) {
  return `<div style="text-align:center;margin:28px 0;">
    <a href="${url}"
       style="display:inline-block;background:${BRAND_GREEN};color:#FFFFFF;text-decoration:none;
              padding:14px 28px;border-radius:999px;font-weight:700;font-size:15px;">
      ${escapeHtml(label)}
    </a>
  </div>`;
}

function buildAdminAlertEmail(p: AdminAlertPayload) {
  const rowsHtml = p.rows.map((r) =>
    `<tr>
      <td style="padding:8px 0;color:${MUTED};width:130px;font-size:13px;vertical-align:top;">${escapeHtml(r.label)}</td>
      <td style="padding:8px 0;color:${INK};font-size:14px;">${escapeHtml(r.value)}</td>
    </tr>`,
  ).join('');
  const rowsText = p.rows.map((r) => `${r.label}: ${r.value}`).join('\n');
  const cta = p.ctaUrl && p.ctaLabel ? ctaButtonHtml(p.ctaUrl, p.ctaLabel) : '';
  const inner = `
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 4px;">${rowsHtml}</table>
    ${cta}`;
  const text = `${p.subject}\n\n${rowsText}\n${p.ctaUrl ? `\n${p.ctaLabel ?? 'Open'}: ${p.ctaUrl}\n` : ''}`;
  return {
    subject: p.subject,
    text,
    html: shellHtml('es', p.subject, inner, 'Cesto Shop — Panel de administración'),
  };
}

function firstName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
}

// ─── Password reset ────────────────────────────────────

function buildResetEmail(resetUrl: string, expiresAt: Date, lang: EmailLang) {
  const expiresMins = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60000));

  if (lang === 'en') {
    const subject = 'Reset your Cesto Shop password';
    const text = [
      'Hi,',
      '',
      'We received a request to reset the password on your Cesto Shop account.',
      `Open the following link to create a new password (valid for ${expiresMins} minutes):`,
      '',
      resetUrl,
      '',
      "If it wasn't you, you can safely ignore this email — your current password still works.",
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        We received a request to reset the password on your Cesto Shop account.
        Tap the button below to create a new one. The link expires in <strong>${expiresMins} minutes</strong>.
      </p>
      ${ctaButtonHtml(resetUrl, 'Reset password')}
      <p style="margin:0 0 8px;font-size:13px;color:${MUTED};">Button not working? Copy this link into your browser:</p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:${BRAND_GREEN};">${resetUrl}</p>
      <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
        If it wasn't you, you can safely ignore this email — your current password still works.
      </p>`;
    const html = shellHtml('en', 'Reset your password', inner, 'Cesto Shop — Your desi supermarket in Spain');
    return { subject, text, html };
  }

  const subject = 'Restablece tu contraseña de Cesto Shop';
  const text = [
    'Hola,',
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta de Cesto Shop.',
    `Abre el siguiente enlace para crear una nueva contraseña (válido durante ${expiresMins} minutos):`,
    '',
    resetUrl,
    '',
    'Si no fuiste tú, puedes ignorar este correo — tu contraseña actual seguirá funcionando.',
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      Recibimos una solicitud para restablecer la contraseña de tu cuenta de Cesto Shop.
      Pulsa el botón para crear una nueva. El enlace caduca en <strong>${expiresMins} minutos</strong>.
    </p>
    ${ctaButtonHtml(resetUrl, 'Restablecer contraseña')}
    <p style="margin:0 0 8px;font-size:13px;color:${MUTED};">¿No funciona el botón? Copia este enlace en tu navegador:</p>
    <p style="margin:0 0 24px;font-size:12px;word-break:break-all;color:${BRAND_GREEN};">${resetUrl}</p>
    <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
      Si no fuiste tú, puedes ignorar este correo — tu contraseña actual seguirá funcionando.
    </p>`;
  const html = shellHtml('es', 'Restablece tu contraseña', inner, 'Cesto Shop — Tu supermercado desi en España');
  return { subject, text, html };
}

// ─── Support ticket → admin ────────────────────────────

function buildSupportEmail(p: SupportTicketEmailPayload) {
  const subject = `[Cesto Shop · ${p.source}] ${p.subject}`;
  const text = [
    `New support ticket from ${p.name} <${p.email}>${p.phone ? ` · ${p.phone}` : ''}`,
    `Source: ${p.source}${p.language ? ` · Language: ${p.language}` : ''}`,
    `Ticket ID: ${p.ticketId}`,
    `Admin link: ${p.adminUrl}`,
    '',
    `Subject: ${p.subject}`,
    '',
    p.body,
    '',
    '— Reply directly to this email or triage the ticket in the admin inbox.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#FAFBF8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0F172A;">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      ${logoHtml()}
      <div style="background:#FFFFFF;border-radius:16px;padding:28px;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#054EE8;">New support ticket · ${escapeHtml(p.source)}</p>
        <h1 style="margin:0 0 18px;font-size:22px;font-weight:700;line-height:1.2;color:#0F172A;">${escapeHtml(p.subject)}</h1>

        <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13.5px;color:#475569;border-collapse:collapse;margin-bottom:18px;">
          <tr><td style="padding:4px 12px 4px 0;color:#94A3B8;width:80px;">From</td><td style="padding:4px 0;"><strong style="color:#0F172A;">${escapeHtml(p.name)}</strong> &lt;${escapeHtml(p.email)}&gt;</td></tr>
          ${p.phone ? `<tr><td style="padding:4px 12px 4px 0;color:#94A3B8;">Phone</td><td style="padding:4px 0;">${escapeHtml(p.phone)}</td></tr>` : ''}
          ${p.language ? `<tr><td style="padding:4px 12px 4px 0;color:#94A3B8;">Language</td><td style="padding:4px 0;">${escapeHtml(p.language)}</td></tr>` : ''}
          <tr><td style="padding:4px 12px 4px 0;color:#94A3B8;">Ticket</td><td style="padding:4px 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;">${escapeHtml(p.ticketId)}</td></tr>
        </table>

        <div style="background:#FAFBF8;border-left:3px solid #054EE8;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px;">
          <p style="margin:0;font-size:14.5px;line-height:1.6;color:#1E293B;white-space:pre-wrap;">${escapeHtml(p.body)}</p>
        </div>

        <div style="text-align:center;margin:0 0 8px;">
          <a href="${p.adminUrl}"
             style="display:inline-block;background:#054EE8;color:#FFFFFF;text-decoration:none;
                    padding:12px 24px;border-radius:999px;font-weight:700;font-size:13.5px;">
            Open in admin inbox
          </a>
        </div>
        <p style="margin:14px 0 0;font-size:12px;color:#94A3B8;text-align:center;">
          Reply to <a href="mailto:${escapeHtml(p.email)}" style="color:#054EE8;text-decoration:none;font-weight:600;">${escapeHtml(p.email)}</a> to continue the conversation with the customer.
        </p>
      </div>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

// ─── Welcome ───────────────────────────────────────────

function buildWelcomeEmail(p: WelcomeEmailPayload) {
  const first = firstName(p.name);

  if (p.lang === 'en') {
    const subject = `Welcome to Cesto Shop${first ? `, ${first}` : ''}!`;
    const greet = first ? `Hi ${first},` : 'Hi,';
    const text = [
      greet,
      '',
      'Welcome to Cesto Shop — your desi supermarket in Spain.',
      'Fresh groceries, halal meats, and South Asian pantry staples delivered to your door.',
      '',
      `Start shopping: ${p.webUrl}`,
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        Welcome to <strong>Cesto Shop</strong> — your desi supermarket in Spain. Fresh groceries, halal meats,
        and South Asian pantry staples delivered right to your door.
      </p>
      ${ctaButtonHtml(p.webUrl, 'Start shopping')}
      <p style="margin:8px 0 0;font-size:13px;color:${MUTED};line-height:1.55;">
        Our team adds delivery to your order and lets you know. Track every order live from the app.
      </p>`;
    return { subject, text, html: shellHtml('en', `Welcome${first ? `, ${first}` : ''}!`, inner, 'Cesto Shop — Your desi supermarket in Spain') };
  }

  const subject = `¡Bienvenido a Cesto Shop${first ? `, ${first}` : ''}!`;
  const greet = first ? `Hola ${first},` : 'Hola,';
  const text = [
    greet,
    '',
    'Bienvenido a Cesto Shop — tu supermercado desi en España.',
    'Alimentación fresca, carnes halal y productos del sur de Asia hasta tu puerta.',
    '',
    `Empieza a comprar: ${p.webUrl}`,
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      Bienvenido a <strong>Cesto Shop</strong> — tu supermercado desi en España. Alimentación fresca,
      carnes halal y productos del sur de Asia entregados en tu puerta.
    </p>
    ${ctaButtonHtml(p.webUrl, 'Empezar a comprar')}
    <p style="margin:8px 0 0;font-size:13px;color:${MUTED};line-height:1.55;">
      Nuestro equipo añade el envío a tu pedido y te avisa. Sigue cada pedido en vivo desde la app.
    </p>`;
  return { subject, text, html: shellHtml('es', `¡Bienvenido${first ? `, ${first}` : ''}!`, inner, 'Cesto Shop — Tu supermercado desi en España') };
}

// ─── Order placed ──────────────────────────────────────

/** The delivery line: a price, free, or not priced yet (wholesale). */
function feeText(p: OrderPlacedEmailPayload, lang: EmailLang, capital = false) {
  if (!p.deliveryFeePending && p.deliveryFee > 0) return fmtEur(p.deliveryFee, lang);
  if (!p.deliveryFeePending && p.deliveryFeeFree) return lang === 'en' ? 'Free' : 'Gratis';
  const later = lang === 'en' ? 'added once we have priced your delivery' : 'lo añadimos al calcular tu entrega';
  return capital ? later.charAt(0).toUpperCase() + later.slice(1) : later;
}

function buildOrderPlacedEmail(p: OrderPlacedEmailPayload) {
  const first = firstName(p.name);
  const addrHtml = p.addressLines
    .filter(Boolean)
    .map((l) => escapeHtml(l))
    .join('<br />');
  const num = `#${p.orderNumber}`;

  if (p.lang === 'en') {
    const subject = p.placedForYou ? `We've placed order ${num} for you` : `Order ${num} received — thanks!`;
    const greet = first ? `Hi ${first},` : 'Hi,';
    const text = [
      greet,
      '',
      p.placedForYou
        ? `Our team has put together order ${num} for you. Here's a quick summary:`
        : `We've received your order ${num}. Here's a quick summary:`,
      '',
      `Items:        ${p.itemCount}`,
      `Subtotal:     ${fmtEur(p.subtotal, 'en')}`,
      `Delivery fee: ${feeText(p, 'en')}`,
      ...(p.recargo ? [`Recargo de equivalencia: ${fmtEur(p.recargo, 'en')}`] : []),
      `Total:        ${fmtEur(p.total, 'en')}`,
      '',
      'Delivering to:',
      ...p.addressLines.filter(Boolean),
      '',
      `Track your order: ${p.trackUrl}`,
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        ${p.placedForYou ? 'Our team has put together order' : "We've received your order"} <strong style="font-family:'JetBrains Mono',ui-monospace,monospace;">${escapeHtml(num)}</strong>${p.placedForYou ? ' for you' : ''}.
        We'll ping you the moment it's on the way.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:${INK};border-collapse:collapse;margin:16px 0 4px;">
        <tr><td style="padding:6px 0;color:${MUTED};">Items</td><td style="padding:6px 0;text-align:right;">${p.itemCount}</td></tr>
        <tr><td style="padding:6px 0;color:${MUTED};">Subtotal</td><td style="padding:6px 0;text-align:right;">${escapeHtml(fmtEur(p.subtotal, 'en'))}</td></tr>
        <tr><td style="padding:6px 0;color:${MUTED};">Delivery</td><td style="padding:6px 0;text-align:right;">${escapeHtml(feeText(p, 'en', true))}</td></tr>
        ${p.recargo ? `<tr><td style="padding:6px 0;color:${MUTED};">Recargo de equivalencia</td><td style="padding:6px 0;text-align:right;">${escapeHtml(fmtEur(p.recargo, 'en'))}</td></tr>` : ''}
        <tr><td style="padding:10px 0 6px;font-weight:700;border-top:1px solid #EDE7DD;">Total</td><td style="padding:10px 0 6px;text-align:right;font-weight:700;border-top:1px solid #EDE7DD;">${escapeHtml(fmtEur(p.total, 'en'))}</td></tr>
      </table>
      <p style="margin:18px 0 6px;font-size:13px;color:${MUTED};">Delivering to</p>
      <p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:${INK};">${addrHtml}</p>
      ${ctaButtonHtml(p.trackUrl, 'Track order')}`;
    return { subject, text, html: shellHtml('en', `Order ${num} received`, inner, 'Cesto Shop — Your desi supermarket in Spain') };
  }

  const subject = p.placedForYou ? `Hemos preparado el pedido ${num} para ti` : `Pedido ${num} recibido — ¡gracias!`;
  const greet = first ? `Hola ${first},` : 'Hola,';
  const text = [
    greet,
    '',
    p.placedForYou
      ? `Nuestro equipo ha preparado el pedido ${num} para ti. Aquí tienes un resumen:`
      : `Hemos recibido tu pedido ${num}. Aquí tienes un resumen:`,
    '',
    `Artículos:      ${p.itemCount}`,
    `Subtotal:       ${fmtEur(p.subtotal, 'es')}`,
    `Envío:          ${feeText(p, 'es')}`,
    ...(p.recargo ? [`Recargo de equivalencia: ${fmtEur(p.recargo, 'es')}`] : []),
    `Total:          ${fmtEur(p.total, 'es')}`,
    '',
    'Enviando a:',
    ...p.addressLines.filter(Boolean),
    '',
    `Sigue tu pedido: ${p.trackUrl}`,
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      ${p.placedForYou ? 'Nuestro equipo ha preparado el pedido' : 'Hemos recibido tu pedido'} <strong style="font-family:'JetBrains Mono',ui-monospace,monospace;">${escapeHtml(num)}</strong>${p.placedForYou ? ' para ti' : ''}.
      Te avisaremos en cuanto salga hacia ti.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:${INK};border-collapse:collapse;margin:16px 0 4px;">
      <tr><td style="padding:6px 0;color:${MUTED};">Artículos</td><td style="padding:6px 0;text-align:right;">${p.itemCount}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};">Subtotal</td><td style="padding:6px 0;text-align:right;">${escapeHtml(fmtEur(p.subtotal, 'es'))}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};">Envío</td><td style="padding:6px 0;text-align:right;">${escapeHtml(feeText(p, 'es', true))}</td></tr>
      ${p.recargo ? `<tr><td style="padding:6px 0;color:${MUTED};">Recargo de equivalencia</td><td style="padding:6px 0;text-align:right;">${escapeHtml(fmtEur(p.recargo, 'es'))}</td></tr>` : ''}
      <tr><td style="padding:10px 0 6px;font-weight:700;border-top:1px solid #EDE7DD;">Total</td><td style="padding:10px 0 6px;text-align:right;font-weight:700;border-top:1px solid #EDE7DD;">${escapeHtml(fmtEur(p.total, 'es'))}</td></tr>
    </table>
    <p style="margin:18px 0 6px;font-size:13px;color:${MUTED};">Enviando a</p>
    <p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:${INK};">${addrHtml}</p>
    ${ctaButtonHtml(p.trackUrl, 'Seguir pedido')}`;
  return { subject, text, html: shellHtml('es', `Pedido ${num} recibido`, inner, 'Cesto Shop — Tu supermercado desi en España') };
}

// ─── Order status change ───────────────────────────────

interface StatusCopy {
  headline: string;
  message: string;
  cta: string;
  subjectPrefix: string;
}

function statusCopy(status: OrderStatusEmailStatus, lang: EmailLang, num: string, reason: string | null): StatusCopy {
  if (lang === 'en') {
    switch (status) {
      case 'confirmed':
        return {
          subjectPrefix: 'Order confirmed',
          headline: 'Order confirmed',
          message: `Your order ${num} has been confirmed. We'll let you know when it starts moving.`,
          cta: 'Track order',
        };
      case 'preparing':
        return {
          subjectPrefix: 'Preparing your order',
          headline: 'Preparing your order',
          message: `We're preparing your order ${num} right now.`,
          cta: 'Track order',
        };
      case 'on_the_way':
        return {
          subjectPrefix: 'On the way',
          headline: 'Your order is on the way',
          message: `Your order ${num} is on the way. It will be with you shortly.`,
          cta: 'Track live',
        };
      case 'delivered':
        return {
          subjectPrefix: 'Delivered',
          headline: 'Delivered — enjoy!',
          message: `Your order ${num} has been delivered. Thanks for shopping with Cesto Shop!`,
          cta: 'View receipt',
        };
      case 'cancelled':
        return {
          subjectPrefix: 'Order cancelled',
          headline: 'Order cancelled',
          message: reason
            ? `Your order ${num} has been cancelled: ${reason}`
            : `Your order ${num} has been cancelled.`,
          cta: 'View order',
        };
    }
  }
  switch (status) {
    case 'confirmed':
      return {
        subjectPrefix: 'Pedido confirmado',
        headline: 'Pedido confirmado',
        message: `Tu pedido ${num} ha sido confirmado. Te avisaremos cuando salga.`,
        cta: 'Seguir pedido',
      };
    case 'preparing':
      return {
        subjectPrefix: 'Preparando tu pedido',
        headline: 'Preparando tu pedido',
        message: `Estamos preparando tu pedido ${num}.`,
        cta: 'Seguir pedido',
      };
    case 'on_the_way':
      return {
        subjectPrefix: 'En camino',
        headline: 'Tu pedido está en camino',
        message: `Tu pedido ${num} está en camino. Estará contigo en breve.`,
        cta: 'Seguir en vivo',
      };
    case 'delivered':
      return {
        subjectPrefix: 'Entregado',
        headline: '¡Pedido entregado!',
        message: `Tu pedido ${num} ha sido entregado. ¡Gracias por comprar en Cesto Shop!`,
        cta: 'Ver recibo',
      };
    case 'cancelled':
      return {
        subjectPrefix: 'Pedido cancelado',
        headline: 'Pedido cancelado',
        message: reason
          ? `Tu pedido ${num} ha sido cancelado: ${reason}`
          : `Tu pedido ${num} ha sido cancelado.`,
        cta: 'Ver pedido',
      };
  }
}

function buildOrderStatusEmail(p: OrderStatusEmailPayload) {
  const first = firstName(p.name);
  const num = `#${p.orderNumber}`;
  const copy = statusCopy(p.status, p.lang, num, p.reason);
  const greet = p.lang === 'en'
    ? (first ? `Hi ${first},` : 'Hi,')
    : (first ? `Hola ${first},` : 'Hola,');
  const footer = p.lang === 'en'
    ? 'Cesto Shop — Your desi supermarket in Spain'
    : 'Cesto Shop — Tu supermercado desi en España';

  const subject = `${copy.subjectPrefix} · ${num}`;
  const text = [greet, '', copy.message, '', `${p.lang === 'en' ? 'Track:' : 'Seguir:'} ${p.trackUrl}`, '', p.lang === 'en' ? '— The Cesto Shop team' : '— El equipo de Cesto Shop'].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">${escapeHtml(copy.message)}</p>
    ${ctaButtonHtml(p.trackUrl, copy.cta)}`;
  return { subject, text, html: shellHtml(p.lang, copy.headline, inner, footer) };
}

function buildOrderEditedEmail(p: OrderEditedEmailPayload) {
  const first = firstName(p.name);
  const num = `#${p.orderNumber}`;
  const greet = p.lang === 'en'
    ? (first ? `Hi ${first},` : 'Hi,')
    : (first ? `Hola ${first},` : 'Hola,');
  const headline = p.lang === 'en' ? 'Your order was updated' : 'Tu pedido fue modificado';
  const intro = p.lang === 'en'
    ? `Your order ${num} was updated by our team. Here's what changed:`
    : `Tu pedido ${num} fue actualizado por nuestro equipo. Esto es lo que cambió:`;
  const newTotalLabel = p.lang === 'en' ? 'New order total' : 'Nuevo total del pedido';
  const cta = p.lang === 'en' ? 'View order' : 'Ver pedido';
  const footer = p.lang === 'en'
    ? 'Cesto Shop — Your desi supermarket in Spain'
    : 'Cesto Shop — Tu supermercado desi en España';

  const changesText = p.changeSummaryLines.map((l) => `• ${l}`).join('\n');
  const changesHtml = `<ul style="margin:0 0 16px;padding-left:18px;color:#3A3A3A;font-size:14px;line-height:1.6;">${p.changeSummaryLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;

  const subject = `${headline} · ${num}`;
  const text = [greet, '', intro, '', changesText, '', `${newTotalLabel}: ${fmtEur(p.newTotal, p.lang)}`, '', `${p.lang === 'en' ? 'View:' : 'Ver:'} ${p.trackUrl}`, '', p.lang === 'en' ? '— The Cesto Shop team' : '— El equipo de Cesto Shop'].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3A3A3A;">${escapeHtml(intro)}</p>
    ${changesHtml}
    <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#3A3A3A;">${escapeHtml(newTotalLabel)}: ${escapeHtml(fmtEur(p.newTotal, p.lang))}</p>
    ${ctaButtonHtml(p.trackUrl, cta)}`;
  return { subject, text, html: shellHtml(p.lang, headline, inner, footer) };
}

// ─── Support ticket receipt (to customer) ──────────────

function buildSupportReceiptEmail(p: SupportTicketReceiptPayload) {
  const first = firstName(p.name);
  const shortId = p.ticketId.slice(0, 8);

  if (p.lang === 'en') {
    const subject = `We got your message — Cesto Shop support`;
    const greet = first ? `Hi ${first},` : 'Hi,';
    const text = [
      greet,
      '',
      `Thanks for reaching out. We've received your message and our team will get back to you shortly.`,
      '',
      `Reference: ${shortId}`,
      `Subject: ${p.subject}`,
      '',
      'You can reply to this email if you want to add anything to your ticket.',
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        Thanks for reaching out. We've received your message and our team will get back to you shortly.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:${INK};border-collapse:collapse;margin:12px 0 4px;">
        <tr><td style="padding:6px 0;color:${MUTED};width:100px;">Reference</td><td style="padding:6px 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;">${escapeHtml(shortId)}</td></tr>
        <tr><td style="padding:6px 0;color:${MUTED};">Subject</td><td style="padding:6px 0;">${escapeHtml(p.subject)}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:${MUTED};line-height:1.55;">
        You can reply to this email if you want to add anything to your ticket.
      </p>`;
    return { subject, text, html: shellHtml('en', 'We got your message', inner, 'Cesto Shop — Your desi supermarket in Spain') };
  }

  const subject = `Hemos recibido tu mensaje — soporte de Cesto Shop`;
  const greet = first ? `Hola ${first},` : 'Hola,';
  const text = [
    greet,
    '',
    'Gracias por escribirnos. Hemos recibido tu mensaje y nuestro equipo te responderá en breve.',
    '',
    `Referencia: ${shortId}`,
    `Asunto: ${p.subject}`,
    '',
    'Puedes responder a este correo si quieres añadir algo a tu ticket.',
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      Gracias por escribirnos. Hemos recibido tu mensaje y nuestro equipo te responderá en breve.
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:${INK};border-collapse:collapse;margin:12px 0 4px;">
      <tr><td style="padding:6px 0;color:${MUTED};width:100px;">Referencia</td><td style="padding:6px 0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;">${escapeHtml(shortId)}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};">Asunto</td><td style="padding:6px 0;">${escapeHtml(p.subject)}</td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:13px;color:${MUTED};line-height:1.55;">
      Puedes responder a este correo si quieres añadir algo a tu ticket.
    </p>`;
  return { subject, text, html: shellHtml('es', 'Hemos recibido tu mensaje', inner, 'Cesto Shop — Tu supermercado desi en España') };
}

// ─── MV Slice 1 · partner approval emails ──────────────

/** Monospaced credentials block — shows the temp password prominently so
 *  the applicant knows it's a one-time secret they need to change. */
function credentialsBlockHtml(email: string, password: string, emailLabel: string, passwordLabel: string) {
  return `<div style="background:#F5F0E8;border-radius:10px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">${escapeHtml(emailLabel)}</p>
      <p style="margin:0 0 14px;font-size:15px;font-family:'JetBrains Mono',ui-monospace,monospace;color:${INK};word-break:break-all;">${escapeHtml(email)}</p>
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">${escapeHtml(passwordLabel)}</p>
      <p style="margin:0;font-size:18px;font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:700;color:${INK};letter-spacing:0.04em;">${escapeHtml(password)}</p>
    </div>`;
}

function buildPartnerWelcomeEmail(p: PartnerWelcomeEmailPayload) {
  const first = firstName(p.name);

  if (p.lang === 'en') {
    const subject = `Welcome to Cesto Shop Partners — ${p.storeName} is approved`;
    const greet = first ? `Hi ${first},` : 'Hi,';
    const text = [
      greet,
      '',
      `Great news — your partner application for ${p.storeName} has been approved. You can now log in to your Cesto Shop Partners dashboard and set up your store.`,
      '',
      'Your store starts as a draft, so customers cannot see it yet. Three steps to go live:',
      '  1. Add your products',
      '  2. Set your delivery area — the postcodes you deliver to, your delivery fee and your minimum order',
      '  3. Hit Publish',
      '',
      'A delivery area is required before you can publish, because it is what tells customers where you deliver and what you charge for it.',
      '',
      `Login URL: ${p.loginUrl}`,
      `Email:     ${p.loginEmail}`,
      `Password:  ${p.tempPassword}`,
      '',
      "You'll be asked to set a new password on your first login. This temporary password only works once.",
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        Great news — your partner application for <strong>${escapeHtml(p.storeName)}</strong> has been approved. Log in to your Cesto Shop Partners dashboard to set up your store, add products, and start receiving orders.
      </p>
      <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        Your store starts as a <strong>draft</strong>, so customers cannot see it yet. Three steps to go live: add your products, set your <strong>delivery area</strong> (the postcodes you cover, your delivery fee and your minimum order), then hit <strong>Publish</strong>. A delivery area is required before publishing — it is what tells customers where you deliver and what you charge for it.
      </p>
      ${credentialsBlockHtml(p.loginEmail, p.tempPassword, 'Email', 'Temporary password')}
      ${ctaButtonHtml(p.loginUrl, 'Log in to Cesto Shop Partners')}
      <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
        You'll be asked to set a new password on first login — the temporary password above only works once. Keep this email safe until then.
      </p>`;
    return { subject, text, html: shellHtml('en', `Welcome — ${p.storeName} approved`, inner, 'Cesto Shop Partners') };
  }

  const subject = `Bienvenido a Cesto Shop Partners — ${p.storeName} aprobado`;
  const greet = first ? `Hola ${first},` : 'Hola,';
  const text = [
    greet,
    '',
    `Buenas noticias — tu solicitud como partner para ${p.storeName} ha sido aprobada. Ya puedes acceder a tu panel de Cesto Shop Partners y configurar tu tienda.`,
    '',
    'Tu tienda empieza como borrador, así que los clientes todavía no pueden verla. Tres pasos para publicarla:',
    '  1. Añade tus productos',
    '  2. Define tu zona de reparto — los códigos postales a los que entregas, tu coste de envío y tu pedido mínimo',
    '  3. Pulsa Publicar',
    '',
    'Necesitas una zona de reparto antes de publicar: es lo que indica a los clientes dónde entregas y cuánto cobras por hacerlo.',
    '',
    `URL de acceso: ${p.loginUrl}`,
    `Correo:        ${p.loginEmail}`,
    `Contraseña:    ${p.tempPassword}`,
    '',
    'Al iniciar sesión por primera vez te pediremos que establezcas una nueva contraseña. Esta contraseña temporal solo funciona una vez.',
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      Buenas noticias — tu solicitud como partner para <strong>${escapeHtml(p.storeName)}</strong> ha sido aprobada. Accede a tu panel de Cesto Shop Partners para configurar tu tienda, añadir productos y empezar a recibir pedidos.
    </p>
    <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      Tu tienda empieza como <strong>borrador</strong>, así que los clientes todavía no pueden verla. Tres pasos para publicarla: añade tus productos, define tu <strong>zona de reparto</strong> (los códigos postales que cubres, tu coste de envío y tu pedido mínimo) y pulsa <strong>Publicar</strong>. La zona de reparto es obligatoria antes de publicar: indica a los clientes dónde entregas y cuánto cobras por hacerlo.
    </p>
    ${credentialsBlockHtml(p.loginEmail, p.tempPassword, 'Correo', 'Contraseña temporal')}
    ${ctaButtonHtml(p.loginUrl, 'Acceder a Cesto Shop Partners')}
    <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
      Al iniciar sesión por primera vez te pediremos que establezcas una nueva contraseña — la contraseña temporal solo funciona una vez. Guarda este correo hasta entonces.
    </p>`;
  return { subject, text, html: shellHtml('es', `Bienvenido — ${p.storeName} aprobado`, inner, 'Cesto Shop Partners') };
}

/** "A", "A and B", "A, B and C" — the stores as a reader would list them. */
function listStores(names: string[], and: string): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}

/**
 * Access to a store handed over by Cesto (see PartnerAccessEmailPayload). The
 * partner area is reached from the shop's own login — partners are ordinary
 * accounts with a role — so the mail says where the button is once inside.
 *
 * Exported for lib/partnerAccessEmail.test.ts: a test run never reaches a
 * provider, so the words are checked by rendering them.
 */
export function buildPartnerAccessEmail(p: PartnerAccessEmailPayload) {
  const first = firstName(p.name);
  const linked = p.kind === 'linked';

  if (p.lang === 'en') {
    const stores = listStores(p.storeNames, 'and');
    const subject = linked
      ? `You now manage ${stores} on Cesto Shop`
      : `Your new Cesto Shop sign-in for ${stores}`;
    const greet = first ? `Hi ${first},` : 'Hi,';
    const lead = linked
      ? `Cesto has given you access to manage ${stores} on Cesto Shop: its products, its orders and its shop details.`
      : `Here is a new temporary password to sign in to Cesto Shop and manage ${stores}. The previous one no longer works.`;
    const how = 'Sign in at the link below, then choose "Manage store" to reach your store\'s dashboard.';
    const text = [
      greet,
      '',
      lead,
      how,
      '',
      `Sign in: ${p.loginUrl}`,
      `Email:   ${p.loginEmail}`,
      p.tempPassword ? `Password: ${p.tempPassword}` : 'Password: the one you already use for Cesto Shop.',
      '',
      p.tempPassword
        ? "You'll be asked to choose your own password when you sign in — this temporary one only works once."
        : 'Forgotten it? Use "Forgot password?" on the sign-in page.',
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">${escapeHtml(lead)}</p>
      <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">Sign in, then choose <strong>Manage store</strong> to reach your store's dashboard.</p>
      ${p.tempPassword
        ? credentialsBlockHtml(p.loginEmail, p.tempPassword, 'Email', 'Temporary password')
        : `<p style="margin:12px 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">Sign in with <strong>${escapeHtml(p.loginEmail)}</strong> and the password you already use for Cesto Shop.</p>`}
      ${ctaButtonHtml(p.loginUrl, 'Sign in to Cesto Shop')}
      <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
        ${p.tempPassword
          ? "You'll be asked to choose your own password when you sign in — the temporary one above only works once."
          : 'Forgotten your password? Use “Forgot password?” on the sign-in page.'}
      </p>`;
    return { subject, text, html: shellHtml('en', linked ? `You now manage ${stores}` : 'Your new sign-in', inner, 'Cesto Shop Partners') };
  }

  const stores = listStores(p.storeNames, 'y');
  const subject = linked
    ? `Ya gestionas ${stores} en Cesto Shop`
    : `Tus nuevos datos de acceso a Cesto Shop para ${stores}`;
  const greet = first ? `Hola ${first},` : 'Hola,';
  const lead = linked
    ? `Cesto te ha dado acceso para gestionar ${stores} en Cesto Shop: sus productos, sus pedidos y los datos de la tienda.`
    : `Aquí tienes una contraseña temporal nueva para entrar en Cesto Shop y gestionar ${stores}. La anterior ya no funciona.`;
  const how = 'Inicia sesión en el enlace de abajo y pulsa «Gestionar tienda» para ir al panel de tu tienda.';
  const text = [
    greet,
    '',
    lead,
    how,
    '',
    `Acceso:     ${p.loginUrl}`,
    `Correo:     ${p.loginEmail}`,
    p.tempPassword ? `Contraseña: ${p.tempPassword}` : 'Contraseña: la que ya usas en Cesto Shop.',
    '',
    p.tempPassword
      ? 'Al iniciar sesión te pediremos que elijas tu propia contraseña: esta temporal solo funciona una vez.'
      : '¿No la recuerdas? Usa «¿Olvidaste tu contraseña?» en la página de acceso.',
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">${escapeHtml(lead)}</p>
    <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">Inicia sesión y pulsa <strong>Gestionar tienda</strong> para ir al panel de tu tienda.</p>
    ${p.tempPassword
      ? credentialsBlockHtml(p.loginEmail, p.tempPassword, 'Correo', 'Contraseña temporal')
      : `<p style="margin:12px 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">Entra con <strong>${escapeHtml(p.loginEmail)}</strong> y la contraseña que ya usas en Cesto Shop.</p>`}
    ${ctaButtonHtml(p.loginUrl, 'Entrar en Cesto Shop')}
    <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
      ${p.tempPassword
        ? 'Al iniciar sesión te pediremos que elijas tu propia contraseña: la temporal de arriba solo funciona una vez.'
        : '¿No recuerdas tu contraseña? Usa «¿Olvidaste tu contraseña?» en la página de acceso.'}
    </p>`;
  return { subject, text, html: shellHtml('es', linked ? `Ya gestionas ${stores}` : 'Tus nuevos datos de acceso', inner, 'Cesto Shop Partners') };
}

/**
 * Business (wholesale buyer) welcome. Distinct from the partner welcome in
 * three ways: it names the company rather than a store, it points at the
 * customer storefront login rather than a dashboard, and it says what they
 * will see: only their wholesale prices, never a retail one.
 */
function buildBusinessWelcomeEmail(p: BusinessWelcomeEmailPayload) {
  const first = firstName(p.name);

  if (p.lang === 'en') {
    const subject = `Your Cesto Shop business account is ready — ${p.companyName}`;
    const greet = first ? `Hi ${first},` : 'Hi,';
    const text = [
      greet,
      '',
      `Your business account for ${p.companyName} has been approved. Log in to Cesto Shop and you'll see wholesale (B2B) pricing across the catalogue.`,
      '',
      `Login URL: ${p.loginUrl}`,
      `Email:     ${p.loginEmail}`,
      `Password:  ${p.tempPassword}`,
      '',
      "You'll be asked to set a new password on your first login. This temporary password only works once.",
      '',
      'Once you are in, your catalogue lists the products you can buy at wholesale, and every price you see is the one you pay.',
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        Your business account for <strong>${escapeHtml(p.companyName)}</strong> has been approved. Log in to Cesto Shop and you'll see wholesale <strong>B2B pricing</strong> across the catalogue.
      </p>
      ${credentialsBlockHtml(p.loginEmail, p.tempPassword, 'Email', 'Temporary password')}
      ${ctaButtonHtml(p.loginUrl, 'Log in to Cesto Shop')}
      <p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
        You'll be asked to set a new password on first login — the temporary password above only works once.
      </p>
      <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
        Your catalogue lists the products you can buy at wholesale, and every price you see is the one you pay.
      </p>`;
    return { subject, text, html: shellHtml('en', `Business account approved — ${p.companyName}`, inner, 'Cesto Shop Business') };
  }

  const subject = `Tu cuenta de empresa en Cesto Shop está lista — ${p.companyName}`;
  const greet = first ? `Hola ${first},` : 'Hola,';
  const text = [
    greet,
    '',
    `Tu cuenta de empresa para ${p.companyName} ha sido aprobada. Accede a Cesto Shop y verás los precios mayoristas (B2B) en todo el catálogo.`,
    '',
    `URL de acceso: ${p.loginUrl}`,
    `Correo:        ${p.loginEmail}`,
    `Contraseña:    ${p.tempPassword}`,
    '',
    'Al iniciar sesión por primera vez te pediremos que establezcas una nueva contraseña. Esta contraseña temporal solo funciona una vez.',
    '',
    'Una vez dentro, tu catálogo reúne los productos que puedes comprar al por mayor, y cada precio que ves es el que pagas.',
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      Tu cuenta de empresa para <strong>${escapeHtml(p.companyName)}</strong> ha sido aprobada. Accede a Cesto Shop y verás los <strong>precios mayoristas (B2B)</strong> en todo el catálogo.
    </p>
    ${credentialsBlockHtml(p.loginEmail, p.tempPassword, 'Correo', 'Contraseña temporal')}
    ${ctaButtonHtml(p.loginUrl, 'Acceder a Cesto Shop')}
    <p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
      Al iniciar sesión por primera vez te pediremos que establezcas una nueva contraseña — la contraseña temporal solo funciona una vez.
    </p>
    <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
      Tu catálogo reúne los productos que puedes comprar al por mayor, y cada precio que ves es el que pagas.
    </p>`;
  return { subject, text, html: shellHtml('es', `Cuenta de empresa aprobada — ${p.companyName}`, inner, 'Cesto Shop Business') };
}

/**
 * Credentials for an account a sales rep opened in person.
 *
 * Two things this has to do that the business welcome does not. It must say
 * WHO signed them up — an unexpected email containing a password reads as
 * phishing unless it names the person who was just standing there. And it has
 * to serve both client types from one template, because a rep picks retail or
 * business per client; the B2B paragraph is the only part that differs.
 */
/**
 * The mail that turns somebody into a sales rep.
 *
 * Deliberately NOT the client welcome with different words. That one tells
 * people they can now shop, and the whole point of this role is the opposite:
 * they shop for OTHER people. It names the two things the job is — open
 * accounts, build orders — and points at /sales rather than the storefront,
 * because landing a new rep on the shop front is a support call.
 */
function buildSalesRepWelcomeEmail(p: SalesRepWelcomeEmailPayload) {
  const first = firstName(p.name);

  if (p.lang === 'en') {
    const subject = 'You can now sell on Cesto Shop';
    const greet = first ? `Hi ${first},` : 'Hi,';
    const text = [
      greet,
      '',
      'You have been set up as a sales rep on Cesto Shop. From your sales screen you can open client accounts and build orders for them.',
      '',
      `Sales screen: ${p.loginUrl}`,
      `Email:        ${p.loginEmail}`,
      `Password:     ${p.tempPassword}`,
      p.code ? `Staff number: ${p.code}` : '',
      '',
      "You'll be asked to set a new password on your first login. This temporary password only works once.",
      '',
      "If you weren't expecting this, you can ignore this email — the account stays locked until someone sets a password on it.",
      '',
      '— The Cesto Shop team',
    ].filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        You have been set up as a <strong>sales rep</strong> on Cesto Shop. From your sales screen you can open client accounts and build orders for them.
      </p>
      ${credentialsBlockHtml(p.loginEmail, p.tempPassword, 'Email', 'Temporary password')}
      ${ctaButtonHtml(p.loginUrl, 'Open your sales screen')}
      ${p.code ? `<p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
        Your staff number is <strong>${escapeHtml(p.code)}</strong>.
      </p>` : ''}
      <p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
        You'll be asked to set a new password on first login — the temporary password above only works once.
      </p>
      <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
        If you weren't expecting this, you can ignore this email — the account stays locked until someone sets a password on it.
      </p>`;
    return { subject, text, html: shellHtml('en', 'You can now sell on Cesto Shop', inner, 'Cesto Shop') };
  }

  const subject = 'Ya puedes vender en Cesto Shop';
  const greet = first ? `Hola ${first},` : 'Hola,';
  const text = [
    greet,
    '',
    'Te hemos dado de alta como comercial en Cesto Shop. Desde tu pantalla de ventas puedes abrir cuentas de cliente y crear pedidos para ellos.',
    '',
    `Pantalla de ventas: ${p.loginUrl}`,
    `Correo:             ${p.loginEmail}`,
    `Contraseña:         ${p.tempPassword}`,
    p.code ? `Número de empleado: ${p.code}` : '',
    '',
    'Al iniciar sesión por primera vez te pediremos que establezcas una nueva contraseña. Esta contraseña temporal solo funciona una vez.',
    '',
    'Si no esperabas este correo, puedes ignorarlo — la cuenta permanece bloqueada hasta que alguien establezca una contraseña.',
    '',
    '— El equipo de Cesto Shop',
  ].filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      Te hemos dado de alta como <strong>comercial</strong> en Cesto Shop. Desde tu pantalla de ventas puedes abrir cuentas de cliente y crear pedidos para ellos.
    </p>
    ${credentialsBlockHtml(p.loginEmail, p.tempPassword, 'Correo', 'Contraseña temporal')}
    ${ctaButtonHtml(p.loginUrl, 'Abrir mi pantalla de ventas')}
    ${p.code ? `<p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
      Tu número de empleado es <strong>${escapeHtml(p.code)}</strong>.
    </p>` : ''}
    <p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
      Al iniciar sesión por primera vez te pediremos que establezcas una nueva contraseña — la contraseña temporal solo funciona una vez.
    </p>
    <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
      Si no esperabas este correo, puedes ignorarlo — la cuenta permanece bloqueada hasta que alguien establezca una contraseña.
    </p>`;
  return { subject, text, html: shellHtml('es', 'Ya puedes vender en Cesto Shop', inner, 'Cesto Shop') };
}

function buildClientWelcomeEmail(p: ClientWelcomeEmailPayload) {
  const first = firstName(p.name);
  const isBusiness = !!p.companyName;

  if (p.lang === 'en') {
    const subject = isBusiness
      ? `Your Cesto Shop business account is ready — ${p.companyName}`
      : 'Your Cesto Shop account is ready';
    const greet = first ? `Hi ${first},` : 'Hi,';
    const opened = p.salesManagerName
      ? `${p.salesManagerName} set up a Cesto Shop account for you`
      : 'A Cesto Shop account has been set up for you';
    const b2bText = isBusiness
      ? `\nAs a business account, your catalogue lists the products you can buy at wholesale (B2B), and every price you see is the one you pay.\n`
      : '';
    const hgLine = "Your Home Grocery request has been approved. Our team will put your grocery order together and keep you posted on each delivery.";
    const text = [
      greet,
      '',
      ...(p.homeGrocery ? [hgLine, ''] : []),
      `${opened}${isBusiness ? ` for ${p.companyName}` : ''}. Here is how to get in:`,
      '',
      `Login URL: ${p.loginUrl}`,
      `Email:     ${p.loginEmail}`,
      `Password:  ${p.tempPassword}`,
      '',
      "You'll be asked to set a new password on your first login. This temporary password only works once.",
      b2bText,
      "If you weren't expecting this, you can ignore this email — the account stays locked until someone sets a password on it.",
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      ${p.homeGrocery ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3A3A3A;">${escapeHtml(hgLine)}</p>` : ''}
      <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        ${escapeHtml(opened)}${isBusiness ? ` for <strong>${escapeHtml(p.companyName!)}</strong>` : ''}. Here is how to get in:
      </p>
      ${credentialsBlockHtml(p.loginEmail, p.tempPassword, 'Email', 'Temporary password')}
      ${ctaButtonHtml(p.loginUrl, 'Log in to Cesto Shop')}
      <p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
        You'll be asked to set a new password on first login — the temporary password above only works once.
      </p>
      ${isBusiness ? `<p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
        As a business account, your catalogue lists the products you can buy at <strong>wholesale (B2B)</strong>, and every price you see is the one you pay.
      </p>` : ''}
      ${p.storeName ? `<p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
        Your shop <strong>${escapeHtml(p.storeName)}</strong> has been created as a draft. Sign in, add your products and delivery area, and publish it when you're ready — nothing is visible to shoppers until you do.
      </p>` : ''}
      <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
        If you weren't expecting this, you can ignore this email — the account stays locked until someone sets a password on it.
      </p>`;
    return {
      subject,
      text,
      html: shellHtml('en', isBusiness ? `Account ready — ${p.companyName}` : 'Your account is ready', inner, isBusiness ? 'Cesto Shop Business' : 'Cesto Shop'),
    };
  }

  const subject = isBusiness
    ? `Tu cuenta de empresa en Cesto Shop está lista — ${p.companyName}`
    : 'Tu cuenta de Cesto Shop está lista';
  const greet = first ? `Hola ${first},` : 'Hola,';
  const opened = p.salesManagerName
    ? `${p.salesManagerName} ha creado una cuenta de Cesto Shop para ti`
    : 'Se ha creado una cuenta de Cesto Shop para ti';
  const b2bText = isBusiness
    ? `\nAl ser una cuenta de empresa, tu catálogo reúne los productos que puedes comprar al por mayor (B2B), y cada precio que ves es el que pagas.\n`
    : '';
  const hgLine = 'Hemos aprobado tu solicitud de Compra del hogar. Nuestro equipo preparará tu compra y te avisará de cada entrega.';
  const text = [
    greet,
    '',
    ...(p.homeGrocery ? [hgLine, ''] : []),
    `${opened}${isBusiness ? ` para ${p.companyName}` : ''}. Así puedes acceder:`,
    '',
    `URL de acceso: ${p.loginUrl}`,
    `Correo:        ${p.loginEmail}`,
    `Contraseña:    ${p.tempPassword}`,
    '',
    'Al iniciar sesión por primera vez te pediremos que establezcas una nueva contraseña. Esta contraseña temporal solo funciona una vez.',
    b2bText,
    'Si no esperabas este correo, puedes ignorarlo — la cuenta permanece bloqueada hasta que alguien establezca una contraseña.',
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    ${p.homeGrocery ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3A3A3A;">${escapeHtml(hgLine)}</p>` : ''}
    <p style="margin:0 0 4px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      ${escapeHtml(opened)}${isBusiness ? ` para <strong>${escapeHtml(p.companyName!)}</strong>` : ''}. Así puedes acceder:
    </p>
    ${credentialsBlockHtml(p.loginEmail, p.tempPassword, 'Correo', 'Contraseña temporal')}
    ${ctaButtonHtml(p.loginUrl, 'Acceder a Cesto Shop')}
    <p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
      Al iniciar sesión por primera vez te pediremos que establezcas una nueva contraseña — la contraseña temporal solo funciona una vez.
    </p>
    ${isBusiness ? `<p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
      Al ser una cuenta de empresa, tu catálogo reúne los productos que puedes comprar <strong>al por mayor (B2B)</strong>, y cada precio que ves es el que pagas.
    </p>` : ''}
    ${p.storeName ? `<p style="margin:0 0 10px;font-size:13px;color:${MUTED};line-height:1.55;">
      Tu tienda <strong>${escapeHtml(p.storeName)}</strong> se ha creado como borrador. Accede, añade tus productos y tu zona de reparto, y publícala cuando quieras — no será visible para los clientes hasta entonces.
    </p>` : ''}
    <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
      Si no esperabas este correo, puedes ignorarlo — la cuenta permanece bloqueada hasta que alguien establezca una contraseña.
    </p>`;
  return {
    subject,
    text,
    html: shellHtml('es', isBusiness ? `Cuenta lista — ${p.companyName}` : 'Tu cuenta está lista', inner, isBusiness ? 'Cesto Shop Business' : 'Cesto Shop'),
  };
}

function buildPartnerRequestInfoEmail(p: PartnerRequestInfoEmailPayload) {
  const first = firstName(p.name);
  const expiresDate = p.expiresAt.toLocaleDateString(p.lang === 'en' ? 'en-GB' : 'es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  if (p.lang === 'en') {
    const subject = 'We need a bit more info on your Cesto Shop partner application';
    const greet = first ? `Hi ${first},` : 'Hi,';
    const text = [
      greet,
      '',
      "Thanks for applying to become a Cesto Shop partner. Before we can approve your application we need a bit more information:",
      '',
      p.message,
      '',
      `Open the following link to add the missing information (valid until ${expiresDate}):`,
      p.statusUrl,
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        Thanks for applying to become a Cesto Shop partner. Before we can approve your application we need a bit more information:
      </p>
      <div style="background:#FFF7E6;border-left:3px solid #C4763B;border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 16px;">
        <p style="margin:0;font-size:14.5px;line-height:1.6;color:#1E293B;white-space:pre-wrap;">${escapeHtml(p.message)}</p>
      </div>
      ${ctaButtonHtml(p.statusUrl, 'Add missing information')}
      <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
        This link is valid until <strong>${escapeHtml(expiresDate)}</strong>. If it expires, reply to this email and we'll send a fresh one.
      </p>`;
    return { subject, text, html: shellHtml('en', 'More info needed', inner, 'Cesto Shop Partners') };
  }

  const subject = 'Necesitamos algo más para tu solicitud de partner en Cesto Shop';
  const greet = first ? `Hola ${first},` : 'Hola,';
  const text = [
    greet,
    '',
    'Gracias por solicitar unirte a Cesto Shop como partner. Antes de aprobar tu solicitud necesitamos algo más de información:',
    '',
    p.message,
    '',
    `Abre el siguiente enlace para añadir la información pendiente (válido hasta el ${expiresDate}):`,
    p.statusUrl,
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      Gracias por solicitar unirte a Cesto Shop como partner. Antes de aprobar tu solicitud necesitamos algo más de información:
    </p>
    <div style="background:#FFF7E6;border-left:3px solid #C4763B;border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 16px;">
      <p style="margin:0;font-size:14.5px;line-height:1.6;color:#1E293B;white-space:pre-wrap;">${escapeHtml(p.message)}</p>
    </div>
    ${ctaButtonHtml(p.statusUrl, 'Añadir información pendiente')}
    <p style="margin:0;font-size:13px;color:${MUTED};line-height:1.55;">
      Este enlace es válido hasta el <strong>${escapeHtml(expiresDate)}</strong>. Si caduca, responde a este correo y te enviaremos uno nuevo.
    </p>`;
  return { subject, text, html: shellHtml('es', 'Necesitamos más información', inner, 'Cesto Shop Partners') };
}

function buildPartnerRejectedEmail(p: PartnerRejectedEmailPayload) {
  const first = firstName(p.name);

  if (p.lang === 'en') {
    const subject = 'Update on your Cesto Shop partner application';
    const greet = first ? `Hi ${first},` : 'Hi,';
    const text = [
      greet,
      '',
      "Thanks for your interest in joining Cesto Shop as a partner. After reviewing your application we're unable to move forward at this time.",
      '',
      p.reason,
      '',
      'If your situation changes in the future, you\'re welcome to apply again.',
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
        Thanks for your interest in joining Cesto Shop as a partner. After reviewing your application we're unable to move forward at this time.
      </p>
      <div style="background:#FAFAFA;border-left:3px solid ${MUTED};border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 16px;">
        <p style="margin:0;font-size:14.5px;line-height:1.6;color:#1E293B;white-space:pre-wrap;">${escapeHtml(p.reason)}</p>
      </div>
      <p style="margin:0;font-size:14px;color:#3A3A3A;line-height:1.55;">
        If your situation changes in the future, you're welcome to apply again. Thanks for considering Cesto Shop.
      </p>`;
    return { subject, text, html: shellHtml('en', 'Application update', inner, 'Cesto Shop Partners') };
  }

  const subject = 'Actualización sobre tu solicitud de partner en Cesto Shop';
  const greet = first ? `Hola ${first},` : 'Hola,';
  const text = [
    greet,
    '',
    'Gracias por tu interés en unirte a Cesto Shop como partner. Tras revisar tu solicitud, en este momento no podemos seguir adelante.',
    '',
    p.reason,
    '',
    'Si tu situación cambia en el futuro, eres bienvenido a solicitarlo de nuevo.',
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">
      Gracias por tu interés en unirte a Cesto Shop como partner. Tras revisar tu solicitud, en este momento no podemos seguir adelante.
    </p>
    <div style="background:#FAFAFA;border-left:3px solid ${MUTED};border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 16px;">
      <p style="margin:0;font-size:14.5px;line-height:1.6;color:#1E293B;white-space:pre-wrap;">${escapeHtml(p.reason)}</p>
    </div>
    <p style="margin:0;font-size:14px;color:#3A3A3A;line-height:1.55;">
      Si tu situación cambia en el futuro, eres bienvenido a solicitarlo de nuevo. Gracias por considerar Cesto Shop.
    </p>`;
  return { subject, text, html: shellHtml('es', 'Actualización de solicitud', inner, 'Cesto Shop Partners') };
}

function buildHomeGroceryApprovedEmail(p: HomeGroceryApprovedEmailPayload) {
  const first = firstName(p.name);

  if (p.lang === 'en') {
    const subject = "You're now a Cesto Home Grocery subscriber";
    const greet = first ? `Hi ${first},` : 'Hi,';
    const body = "Good news — we've approved your Home Grocery request. Our team will put your grocery order together and keep you posted on each delivery. You can sign in with your usual email and password.";
    const text = [greet, '', body, '', p.pageUrl, '', '— The Cesto Shop team'].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">${escapeHtml(body)}</p>
      ${ctaButtonHtml(p.pageUrl, 'See my Home Grocery')}`;
    return { subject, text, html: shellHtml('en', 'Request approved', inner, 'Cesto Shop') };
  }

  const subject = 'Ya eres suscriptor de Compra del hogar en Cesto';
  const greet = first ? `Hola ${first},` : 'Hola,';
  const body = 'Buenas noticias: hemos aprobado tu solicitud de Compra del hogar. Nuestro equipo preparará tu compra y te avisará de cada entrega. Puedes acceder con tu correo y contraseña de siempre.';
  const text = [greet, '', body, '', p.pageUrl, '', '— El equipo de Cesto Shop'].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">${escapeHtml(body)}</p>
    ${ctaButtonHtml(p.pageUrl, 'Ver mi Compra del hogar')}`;
  return { subject, text, html: shellHtml('es', 'Solicitud aprobada', inner, 'Cesto Shop') };
}

function buildHomeGroceryRejectedEmail(p: HomeGroceryRejectedEmailPayload) {
  const first = firstName(p.name);
  const reasonBlock = `
      <div style="background:#FAFAFA;border-left:3px solid ${MUTED};border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 16px;">
        <p style="margin:0;font-size:14.5px;line-height:1.6;color:#1E293B;white-space:pre-wrap;">${escapeHtml(p.reason)}</p>
      </div>`;

  if (p.lang === 'en') {
    const subject = 'Update on your Cesto Home Grocery request';
    const greet = first ? `Hi ${first},` : 'Hi,';
    const intro = "Thanks for asking us to look after your household's grocery. We're unable to approve your request at the moment:";
    const outro = "If things change, you're welcome to send a new request at any time.";
    const text = [greet, '', intro, '', p.reason, '', outro, p.pageUrl, '', '— The Cesto Shop team'].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">${escapeHtml(intro)}</p>
      ${reasonBlock}
      <p style="margin:0 0 16px;font-size:14px;color:#3A3A3A;line-height:1.55;">${escapeHtml(outro)}</p>
      ${ctaButtonHtml(p.pageUrl, 'Send a new request')}`;
    return { subject, text, html: shellHtml('en', 'Request update', inner, 'Cesto Shop') };
  }

  const subject = 'Actualización sobre tu solicitud de Compra del hogar';
  const greet = first ? `Hola ${first},` : 'Hola,';
  const intro = 'Gracias por confiarnos la compra de tu hogar. En este momento no podemos aprobar tu solicitud:';
  const outro = 'Si tu situación cambia, puedes enviarnos una nueva solicitud cuando quieras.';
  const text = [greet, '', intro, '', p.reason, '', outro, p.pageUrl, '', '— El equipo de Cesto Shop'].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#3A3A3A;">${escapeHtml(intro)}</p>
    ${reasonBlock}
    <p style="margin:0 0 16px;font-size:14px;color:#3A3A3A;line-height:1.55;">${escapeHtml(outro)}</p>
    ${ctaButtonHtml(p.pageUrl, 'Enviar una nueva solicitud')}`;
  return { subject, text, html: shellHtml('es', 'Actualización de solicitud', inner, 'Cesto Shop') };
}

function buildPartnerInfoReceivedEmail(p: PartnerInfoReceivedEmailPayload) {
  const first = firstName(p.name);

  if (p.lang === 'en') {
    const subject = "We've received your updated application";
    const greet = first ? `Hi ${first},` : 'Hi,';
    const text = [
      greet,
      '',
      "Thanks — we've received your updated application. Our team will review it and get back to you.",
      '',
      '— The Cesto Shop team',
    ].join('\n');
    const inner = `
      <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
      <p style="margin:0;font-size:15px;line-height:1.55;color:#3A3A3A;">
        Thanks — we've received your updated application. Our team will review it and get back to you.
      </p>`;
    return { subject, text, html: shellHtml('en', 'Application received', inner, 'Cesto Shop Partners') };
  }

  const subject = 'Hemos recibido tu solicitud actualizada';
  const greet = first ? `Hola ${first},` : 'Hola,';
  const text = [
    greet,
    '',
    'Gracias — hemos recibido tu solicitud actualizada. Nuestro equipo la revisará y te responderemos.',
    '',
    '— El equipo de Cesto Shop',
  ].join('\n');
  const inner = `
    <p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#3A3A3A;">${escapeHtml(greet)}</p>
    <p style="margin:0;font-size:15px;line-height:1.55;color:#3A3A3A;">
      Gracias — hemos recibido tu solicitud actualizada. Nuestro equipo la revisará y te responderemos.
    </p>`;
  return { subject, text, html: shellHtml('es', 'Solicitud recibida', inner, 'Cesto Shop Partners') };
}

// ─── Resend mailer ─────────────────────────────────────

function makeResendMailer(apiKey: string, from: string): Mailer {
  const client = new Resend(apiKey);
  // Default reply-to for customer-facing sends. If the customer hits Reply
  // on a welcome/reset/order email, it lands in this human inbox instead of
  // bouncing at Resend's postmaster. Falls back to no reply-to when unset.
  const defaultReplyTo = process.env.REPLY_TO_EMAIL?.trim() || undefined;

  async function send(label: string, args: {
    to: string;
    subject: string;
    text: string;
    html: string;
    replyTo?: string;
    throwOnFail?: boolean;
  }) {
    const { error } = await client.emails.send({
      from,
      to: args.to,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
      subject: args.subject,
      text: args.text,
      html: args.html,
    });
    if (error) {
      console.error(`[mail:${label}:resend-error] to=${args.to} err=${error.message}`);
      if (args.throwOnFail) throw new Error(`Email send failed: ${error.message}`);
    }
  }

  return {
    async sendPasswordResetEmail({ to, resetUrl, expiresAt, lang }) {
      // Reset stays authoritative — if it fails the route returns 500 so the
      // user knows to try again rather than silently getting no email.
      const { subject, text, html } = buildResetEmail(resetUrl, expiresAt, lang ?? 'es');
      await send('reset', { to, subject, text, html, replyTo: defaultReplyTo, throwOnFail: true });
    },
    async sendSupportTicketNotification(payload) {
      const { subject, text, html } = buildSupportEmail(payload);
      // Best-effort — the ticket is already in the DB, admin can still triage.
      // reply-to is the customer's email so admin can reply directly.
      await send('support', {
        to: payload.to,
        replyTo: payload.email,
        subject,
        text,
        html,
      });
    },
    async sendWelcomeEmail(payload) {
      const { subject, text, html } = buildWelcomeEmail(payload);
      await send('welcome', { to: payload.to, subject, text, html, replyTo: defaultReplyTo });
    },
    async sendOrderPlacedEmail(payload) {
      const { subject, text, html } = buildOrderPlacedEmail(payload);
      await send('order-placed', { to: payload.to, subject, text, html, replyTo: defaultReplyTo });
    },
    async sendOrderStatusEmail(payload) {
      const { subject, text, html } = buildOrderStatusEmail(payload);
      await send('order-status', { to: payload.to, subject, text, html, replyTo: defaultReplyTo });
    },
    async sendOrderEditedEmail(payload) {
      const { subject, text, html } = buildOrderEditedEmail(payload);
      await send('order-edited', { to: payload.to, subject, text, html, replyTo: defaultReplyTo });
    },
    async sendSupportTicketReceipt(payload) {
      const { subject, text, html } = buildSupportReceiptEmail(payload);
      await send('support-receipt', { to: payload.to, subject, text, html, replyTo: defaultReplyTo });
    },
    async sendAdminAlert(payload) {
      const { subject, text, html } = buildAdminAlertEmail(payload);
      // Best-effort: DB row / notification is already persisted upstream,
      // so a failed email doesn't fail the request.
      await send('admin-alert', {
        to: payload.to,
        subject,
        text,
        html,
        replyTo: payload.replyTo ?? defaultReplyTo,
      });
    },
    // MV Slice 1 — partner approval flow. Welcome carries the temp password
    // so it MUST reach the applicant; throwOnFail so the admin endpoint can
    // rollback the Store+PartnerUser creation if the email bounces.
    async sendPartnerWelcomeEmail(payload) {
      const { subject, text, html } = buildPartnerWelcomeEmail(payload);
      await send('partner-welcome', { to: payload.to, subject, text, html, replyTo: defaultReplyTo, throwOnFail: true });
    },
    async sendPartnerAccessEmail(payload) {
      const { subject, text, html } = buildPartnerAccessEmail(payload);
      // throwOnFail: the admin is told whether it went, and a temporary
      // password in it is the partner's only way in.
      await send('partner-access', { to: payload.to, subject, text, html, replyTo: defaultReplyTo, throwOnFail: true });
    },
    async sendBusinessWelcomeEmail(payload) {
      const { subject, text, html } = buildBusinessWelcomeEmail(payload);
      // throwOnFail: the caller catches and logs so the admin can retry —
      // these credentials are the applicant's only way in.
      await send('business-welcome', { to: payload.to, subject, text, html, replyTo: defaultReplyTo, throwOnFail: true });
    },
    async sendClientWelcomeEmail(payload) {
      const { subject, text, html } = buildClientWelcomeEmail(payload);
      // Same reasoning as business-welcome: this mail IS the account. The rep
      // is standing in front of the client, so a failure needs to surface
      // while they can still act on it.
      await send('client-welcome', { to: payload.to, subject, text, html, replyTo: defaultReplyTo, throwOnFail: true });
    },
    async sendSalesRepWelcomeEmail(payload) {
      const { subject, text, html } = buildSalesRepWelcomeEmail(payload);
      // Best-effort, unlike client-welcome. The rep row is already committed
      // and an admin at a desk can resend; throwing here would report a rep
      // that was not created as one that was not created, which is false.
      // throwOnFail, like every other mail that carries a password.
      //
      // Without it a Resend rejection — an unverified from-domain, a
      // recipient the key is not allowed to reach, a rate limit — was logged
      // by send() and then swallowed, this function resolved, and the route
      // reported `credentials_sent: true`. The admin was told the login was
      // on its way and the rep never got it. partner-welcome,
      // business-welcome and client-welcome have all always thrown; this one
      // was written without it and was the only credential mail that lied.
      await send('salesrep-welcome', { to: payload.to, subject, text, html, replyTo: defaultReplyTo, throwOnFail: true });
    },
    async sendPartnerRequestInfoEmail(payload) {
      const { subject, text, html } = buildPartnerRequestInfoEmail(payload);
      await send('partner-request-info', { to: payload.to, subject, text, html, replyTo: defaultReplyTo, throwOnFail: true });
    },
    async sendPartnerRejectedEmail(payload) {
      const { subject, text, html } = buildPartnerRejectedEmail(payload);
      // Best-effort: the lead is already marked rejected in the DB. If the
      // email bounces the applicant will just never hear back — sad but
      // recoverable via admin follow-up.
      await send('partner-rejected', { to: payload.to, subject, text, html, replyTo: defaultReplyTo });
    },
    async sendPartnerInfoReceivedEmail(payload) {
      const { subject, text, html } = buildPartnerInfoReceivedEmail(payload);
      await send('partner-info-received', { to: payload.to, subject, text, html, replyTo: defaultReplyTo });
    },
    async sendHomeGroceryApprovedEmail(payload) {
      const { subject, text, html } = buildHomeGroceryApprovedEmail(payload);
      // Best-effort: no credential in it — they already have a password —
      // and the in-app notification says the same thing.
      await send('home-grocery-approved', { to: payload.to, subject, text, html, replyTo: defaultReplyTo });
    },
    async sendHomeGroceryRejectedEmail(payload) {
      const { subject, text, html } = buildHomeGroceryRejectedEmail(payload);
      // Best-effort, like partner-rejected: the decision is already in the DB
      // and shown on /rashan to a requester who has an account.
      await send('home-grocery-rejected', { to: payload.to, subject, text, html, replyTo: defaultReplyTo });
    },
  };
}

// ─── Provider selection ────────────────────────────────

/**
 * A test run must never reach a real provider.
 *
 * Every suite in this package is a `*.test.ts` executed directly by ts-node,
 * so the entrypoint is the whole signal — no env var to set, no npm script to
 * remember, nothing a new suite can forget to opt into.
 *
 * This is not tidiness. A developer machine has a real RESEND_API_KEY in
 * .env, and the key is PRODUCTION's: the suites were sending live email
 * through the account the shop runs on. One pass of test:big-orders attempts
 * eleven — an order-placed per order it creates, plus the edit and cancel
 * notifications — and a session that runs it a dozen times exhausts a
 * hundred-a-day quota on its own. Which is exactly what happened on
 * 2026-10-11: password resets started returning 500 on production and
 * customers stopped receiving order confirmations, because a test suite had
 * spent the allowance.
 */
function isTestRun(): boolean {
  const entry = process.argv[1] ?? '';
  return /\.test\.[cm]?[jt]s$/.test(entry);
}

function pickMailer(): { mailer: Mailer; delivers: boolean } {
  if (isTestRun()) {
    console.log('[mail] test run — using console mailer, no provider will be contacted');
    return { mailer: consoleMailer, delivers: false };
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  const replyTo = process.env.REPLY_TO_EMAIL?.trim();
  if (apiKey && from) {
    console.log(`[mail] using Resend (from="${from}"${replyTo ? `, reply-to="${replyTo}"` : ', no reply-to set'})`);
    return { mailer: makeResendMailer(apiKey, from), delivers: true };
  }
  console.log('[mail] RESEND_API_KEY / RESEND_FROM missing — using console mailer');
  return { mailer: consoleMailer, delivers: false };
}

const picked = pickMailer();

export const mailer: Mailer = picked.mailer;

/**
 * Whether mail actually LEAVES this process.
 *
 * The console mailer's every method is a `console.log` that resolves, so a
 * caller awaiting it cannot tell a logged email from a delivered one. Screens
 * that report "we emailed them their password" were therefore reporting it on
 * any environment with no provider configured — staging has none, so an admin
 * creating a rep there was told the credentials had been sent and then waited
 * for an email that was sitting in a Render log.
 *
 * It would be worse in production: if the key were ever revoked or missed off
 * a new service, the UI would keep claiming success while nobody received
 * anything.
 *
 * So the flag is exported and the three screens that report a send AND it in.
 * Deliberately not an exception from the console mailer: logging the mail is
 * the right behaviour in development, and the thing that was broken was the
 * claim, not the fallback.
 */
export const mailerDelivers: boolean = picked.delivers;

export const sendPasswordResetEmail = (p: ResetEmailPayload) => mailer.sendPasswordResetEmail(p);
export const sendSupportTicketNotification = (p: SupportTicketEmailPayload) =>
  mailer.sendSupportTicketNotification(p);
export const sendWelcomeEmail = (p: WelcomeEmailPayload) => mailer.sendWelcomeEmail(p);
export const sendOrderPlacedEmail = (p: OrderPlacedEmailPayload) => mailer.sendOrderPlacedEmail(p);
export const sendOrderStatusEmail = (p: OrderStatusEmailPayload) => mailer.sendOrderStatusEmail(p);
export const sendOrderEditedEmail = (p: OrderEditedEmailPayload) => mailer.sendOrderEditedEmail(p);
export const sendSupportTicketReceipt = (p: SupportTicketReceiptPayload) =>
  mailer.sendSupportTicketReceipt(p);
export const sendAdminAlert = (p: AdminAlertPayload) => mailer.sendAdminAlert(p);
// MV Slice 1
export const sendPartnerWelcomeEmail = (p: PartnerWelcomeEmailPayload) => mailer.sendPartnerWelcomeEmail(p);
export const sendPartnerAccessEmail = (p: PartnerAccessEmailPayload) => mailer.sendPartnerAccessEmail(p);
export const sendBusinessWelcomeEmail = (p: BusinessWelcomeEmailPayload) => mailer.sendBusinessWelcomeEmail(p);
export const sendClientWelcomeEmail = (p: ClientWelcomeEmailPayload) => mailer.sendClientWelcomeEmail(p);
export const sendSalesRepWelcomeEmail = (p: SalesRepWelcomeEmailPayload) => mailer.sendSalesRepWelcomeEmail(p);
export const sendPartnerRequestInfoEmail = (p: PartnerRequestInfoEmailPayload) => mailer.sendPartnerRequestInfoEmail(p);
export const sendPartnerRejectedEmail = (p: PartnerRejectedEmailPayload) => mailer.sendPartnerRejectedEmail(p);
export const sendPartnerInfoReceivedEmail = (p: PartnerInfoReceivedEmailPayload) => mailer.sendPartnerInfoReceivedEmail(p);
export const sendHomeGroceryApprovedEmail = (p: HomeGroceryApprovedEmailPayload) => mailer.sendHomeGroceryApprovedEmail(p);
export const sendHomeGroceryRejectedEmail = (p: HomeGroceryRejectedEmailPayload) => mailer.sendHomeGroceryRejectedEmail(p);

// Helper — normalize a User.preferred_language into our EmailLang.
export function resolveEmailLang(preferred: string | null | undefined): EmailLang {
  return preferred === 'en' ? 'en' : 'es';
}

/**
 * Resolve which inbox admin-alert emails should land in. Fallback chain:
 *   1. ADMIN_NOTIFY_EMAIL — the primary ops inbox (support.cesto@gmail.com in prod)
 *   2. SUPPORT_INBOX_EMAIL — kept for backward compat with the earlier
 *      support-ticket-only wiring
 *   3. RESEND_FROM — never a real human inbox but at least keeps the
 *      console mailer chatty in dev
 * Returns null if nothing is configured, so callers can early-return
 * without a fake "to".
 */
export function resolveAdminNotifyEmail(): string | null {
  return (
    process.env.ADMIN_NOTIFY_EMAIL?.trim()
    || process.env.SUPPORT_INBOX_EMAIL?.trim()
    || process.env.RESEND_FROM?.trim()
    || null
  );
}
