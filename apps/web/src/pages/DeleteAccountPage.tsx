import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Clock, Globe, Mail, Smartphone, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Public account-deletion page — the URL declared in Play Console's Data
 * safety form. Google requires it to name the app, lead with the steps, say
 * what is deleted and what is kept (and for how long), and work WITHOUT the
 * app installed. That last point is why it sits outside ProtectedRoute and
 * offers the email route first-class: a user who has uninstalled Cesto, or
 * forgotten their password, must still be able to ask.
 *
 * What it promises has to stay in step with privacy policy §7 and §8 and with
 * packages/api/src/lib/eraseUser.ts, which is what actually does it — and
 * whose integration test checks each item listed here.
 */

const PRIVACY_EMAIL = 'support.cesto@gmail.com';

type Route = { icon: LucideIcon; title: string; steps: string[] };

const COPY = {
  es: {
    title: 'Eliminar tu cuenta de Cesto',
    intro:
      'Puedes eliminar tu cuenta de Cesto y los datos asociados en cualquier momento. Aquí tienes cómo hacerlo, qué borramos y qué tenemos que conservar por ley.',
    howTitle: 'Cómo eliminar tu cuenta',
    routes: [
      {
        icon: Smartphone,
        title: 'Desde la app',
        steps: [
          'Abre la app de Cesto e inicia sesión.',
          'Ve a Perfil → Editar perfil.',
          'Pulsa «Eliminar mi cuenta» y escribe DELETE para confirmar.',
        ],
      },
      {
        icon: Globe,
        title: 'Desde la web',
        steps: [
          'Inicia sesión en www.cestoshop.com.',
          'Ve a Perfil → Editar perfil.',
          'Pulsa «Delete my account» y escribe DELETE para confirmar.',
        ],
      },
      {
        icon: Mail,
        title: 'Por email, sin la app',
        steps: [
          `Escribe a ${PRIVACY_EMAIL} desde el email de tu cuenta.`,
          'Pon «Eliminar mi cuenta» en el asunto.',
          'Te confirmaremos la eliminación en un plazo máximo de un mes.',
        ],
      },
    ] as Route[],
    webCta: 'Ir a Editar perfil',
    emailCta: 'Solicitar por email',
    emailSubject: 'Eliminar mi cuenta',
    deletedTitle: 'Lo que borramos',
    deleted: [
      'Tu nombre, email y teléfono',
      'Tu contraseña',
      'Tus direcciones de entrega',
      'Tu foto de perfil',
      'Tus tokens de notificaciones',
      'Tus reseñas',
    ],
    keptTitle: 'Lo que conservamos, y durante cuánto tiempo',
    kept:
      'La ley española nos obliga a conservar las facturas y los registros de pedidos a efectos fiscales. Los conservamos anonimizados, sin tu nombre ni tus datos de contacto, durante el plazo que exige la normativa fiscal y mercantil (actualmente, al menos 4 años). Pasado ese plazo, los eliminamos.',
    notesTitle: 'Antes de eliminarla',
    notes: [
      'Si tienes un pedido en curso, podrás eliminar tu cuenta cuando se haya entregado o cancelado.',
      'Al eliminar tu cuenta se cancela cualquier suscripción de Compra del hogar.',
      'Se cerrará la sesión en todos tus dispositivos.',
    ],
    permanent: 'La eliminación es definitiva y no se puede deshacer.',
    more: 'Más detalles en nuestra',
    privacyLink: 'Política de privacidad',
    back: 'Volver',
  },
  en: {
    title: 'Delete your Cesto account',
    intro:
      'You can delete your Cesto account and the data linked to it at any time. Here is how, what we delete, and what the law requires us to keep.',
    howTitle: 'How to delete your account',
    routes: [
      {
        icon: Smartphone,
        title: 'In the app',
        steps: [
          'Open the Cesto app and sign in.',
          'Go to Profile → Edit profile.',
          'Tap "Delete my account" and type DELETE to confirm.',
        ],
      },
      {
        icon: Globe,
        title: 'On the website',
        steps: [
          'Sign in at www.cestoshop.com.',
          'Go to Profile → Edit profile.',
          'Click "Delete my account" and type DELETE to confirm.',
        ],
      },
      {
        icon: Mail,
        title: 'By email, without the app',
        steps: [
          `Write to ${PRIVACY_EMAIL} from the email address on your account.`,
          'Put "Delete my account" in the subject line.',
          'We will confirm the deletion within one month at the latest.',
        ],
      },
    ] as Route[],
    webCta: 'Go to Edit profile',
    emailCta: 'Request by email',
    emailSubject: 'Delete my account',
    deletedTitle: 'What we delete',
    deleted: [
      'Your name, email address and phone number',
      'Your password',
      'Your delivery addresses',
      'Your profile photo',
      'Your notification tokens',
      'Your reviews',
    ],
    keptTitle: 'What we keep, and for how long',
    kept:
      'Spanish law requires us to keep invoices and order records for tax purposes. We keep them anonymised, with your name and contact details removed, for the period tax and commercial law requires (currently at least 4 years). After that, we delete them.',
    notesTitle: 'Before you delete',
    notes: [
      'If you have an order in progress, you can delete your account once it has been delivered or cancelled.',
      'Deleting your account cancels any Home Grocery subscription.',
      'You will be signed out on every device.',
    ],
    permanent: 'Deletion is permanent and cannot be undone.',
    more: 'More detail in our',
    privacyLink: 'Privacy Policy',
    back: 'Back',
  },
};

export default function DeleteAccountPage() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const c = COPY[lang] ?? COPY.es;
  const mailto = `mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent(c.emailSubject)}`;

  return (
    <div className="max-w-[800px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2 text-sm font-semibold font-display text-muted hover:text-brand transition-colors mb-6"
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
        {c.back}
      </button>

      <div className="flex items-center gap-3 mb-3">
        <Trash2 size={28} className="text-brand shrink-0" strokeWidth={1.75} />
        <h1 className="text-3xl font-extrabold text-ink font-display leading-tight">{c.title}</h1>
      </div>
      <p className="text-[15px] text-charcoal font-body leading-relaxed mb-10">{c.intro}</p>

      <h2 className="text-xl font-bold text-ink font-display mb-4">{c.howTitle}</h2>
      <div className="flex flex-col gap-3 mb-10">
        {c.routes.map((route, i) => {
          const Icon = route.icon;
          return (
            <section key={route.title} className="bg-surface-cream rounded-lg shadow-card p-5 sm:p-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-brand/10 text-brand shrink-0">
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <h3 className="text-base font-bold text-ink font-display">{route.title}</h3>
              </div>
              <ol className="list-decimal pl-5 space-y-1.5 marker:text-muted marker:font-display">
                {route.steps.map((step) => (
                  <li key={step} className="text-sm text-charcoal font-body leading-relaxed pl-1">
                    {step}
                  </li>
                ))}
              </ol>
              {i === 1 && (
                <Link
                  to="/profile/edit"
                  className="mt-4 inline-flex items-center justify-center min-h-[52px] px-6 rounded-xl border-2 border-brand text-brand text-sm font-bold font-display hover:bg-brand hover:text-white transition-colors"
                >
                  {c.webCta}
                </Link>
              )}
              {i === 2 && (
                <a
                  href={mailto}
                  className="mt-4 inline-flex items-center justify-center gap-2 min-h-[52px] px-6 rounded-xl bg-brand text-white text-sm font-bold font-display hover:opacity-90 transition-opacity"
                >
                  <Mail size={16} strokeWidth={1.75} />
                  {c.emailCta}
                </a>
              )}
            </section>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 mb-6">
        <section className="bg-surface-cream rounded-lg shadow-card p-5 sm:p-6">
          <h2 className="text-base font-bold text-ink font-display mb-3">{c.deletedTitle}</h2>
          <ul className="space-y-2">
            {c.deleted.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-charcoal font-body leading-relaxed">
                <Check size={16} strokeWidth={1.75} className="text-brand mt-0.5 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </section>
        <section className="bg-surface-cream rounded-lg shadow-card p-5 sm:p-6">
          <h2 className="text-base font-bold text-ink font-display mb-3 flex items-center gap-2">
            <Clock size={16} strokeWidth={1.75} className="text-muted shrink-0" />
            {c.keptTitle}
          </h2>
          <p className="text-sm text-charcoal font-body leading-relaxed">{c.kept}</p>
        </section>
      </div>

      <section className="bg-surface-cream rounded-lg shadow-card p-5 sm:p-6 mb-6">
        <h2 className="text-base font-bold text-ink font-display mb-3">{c.notesTitle}</h2>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-muted">
          {c.notes.map((note) => (
            <li key={note} className="text-sm text-charcoal font-body leading-relaxed pl-1">{note}</li>
          ))}
        </ul>
      </section>

      <p className="text-sm text-charcoal font-body leading-relaxed">
        <strong className="font-semibold text-ink">{c.permanent}</strong>{' '}
        {c.more}{' '}
        <Link to="/privacy" className="text-brand font-medium underline underline-offset-2 hover:no-underline">
          {c.privacyLink}
        </Link>
        .
      </p>
    </div>
  );
}
