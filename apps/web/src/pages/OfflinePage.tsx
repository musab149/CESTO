import { useNavigate } from 'react-router-dom';
import { WifiOff, RefreshCw, Home } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import ErrorPage from './ErrorPage';

const COPY = {
  es: {
    badge: 'SIN CONEXIÓN',
    title: 'No hay conexión a internet',
    body: 'No pudimos conectar con nuestros servidores. Comprueba tu Wi-Fi o datos móviles e inténtalo de nuevo.',
    retry: 'Reintentar',
    home: 'Ir al inicio',
  },
  en: {
    badge: 'OFFLINE',
    title: 'No internet connection',
    body: "We couldn't reach our servers. Check your Wi-Fi or mobile data and try again.",
    retry: 'Try again',
    home: 'Go home',
  },
} as const;

export default function OfflinePage() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const t = COPY[lang];

  return (
    <ErrorPage
      icon={WifiOff}
      accent="amber"
      badge={t.badge}
      title={t.title}
      body={t.body}
      actions={[
        { label: t.retry, icon: RefreshCw, onClick: () => window.location.reload() },
        { label: t.home,  icon: Home, variant: 'secondary', onClick: () => navigate('/') },
      ]}
    />
  );
}
