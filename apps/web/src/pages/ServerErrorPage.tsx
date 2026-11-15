import { useNavigate } from 'react-router-dom';
import { AlertOctagon, Home, RefreshCw } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import ErrorPage from './ErrorPage';

const COPY = {
  es: {
    badge: 'ERROR 500',
    title: 'Algo se rompió de nuestro lado',
    body: 'Hubo un problema cargando esta página. Nuestro equipo ya lo está revisando. Mientras tanto, intenta de nuevo o vuelve al inicio.',
    refLabel: 'Referencia',
    retry: 'Reintentar',
    home: 'Ir al inicio',
  },
  en: {
    badge: 'ERROR 500',
    title: 'Something broke on our end',
    body: 'There was a problem loading this page. Our team is already looking into it. In the meantime, try again or head back home.',
    refLabel: 'Reference',
    retry: 'Try again',
    home: 'Go home',
  },
} as const;

interface Props {
  /** Optional error reference for support — shown verbatim. */
  reference?: string;
  /** Custom retry handler. Defaults to a full page reload. */
  onRetry?: () => void;
}

export default function ServerErrorPage({ reference, onRetry }: Props) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const t = COPY[lang];

  return (
    <ErrorPage
      icon={AlertOctagon}
      accent="danger"
      badge={t.badge}
      title={t.title}
      body={t.body}
      detail={
        reference ? (
          <>
            <span className="font-ui text-[11px] uppercase tracking-wider text-gray shrink-0">
              {t.refLabel}
            </span>
            <span className="truncate text-ink">{reference}</span>
          </>
        ) : undefined
      }
      actions={[
        { label: t.retry, icon: RefreshCw, onClick: onRetry ?? (() => window.location.reload()) },
        { label: t.home,  icon: Home, variant: 'secondary', onClick: () => navigate('/') },
      ]}
    />
  );
}
