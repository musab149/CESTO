import { useNavigate, useLocation } from 'react-router-dom';
import { Compass, Home, Search } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import ErrorPage from './ErrorPage';

const COPY = {
  es: {
    badge: 'ERROR 404',
    title: 'Esta página se perdió en el camino',
    body: 'No encontramos lo que buscabas. Puede que el enlace esté roto o que la página ya no exista.',
    pathLabel: 'Ruta',
    home: 'Ir al inicio',
    explore: 'Explorar catálogo',
    search: 'Buscar productos',
  },
  en: {
    badge: 'ERROR 404',
    title: 'This page wandered off',
    body: "We couldn't find what you were looking for. The link may be broken, or the page may no longer exist.",
    pathLabel: 'Path',
    home: 'Go home',
    explore: 'Browse catalogue',
    search: 'Search products',
  },
} as const;

export default function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { lang } = useLanguageStore();
  const t = COPY[lang];

  return (
    <ErrorPage
      icon={Compass}
      accent="brand"
      badge={t.badge}
      title={t.title}
      body={t.body}
      detail={
        <>
          <span className="font-ui text-[11px] uppercase tracking-wider text-gray shrink-0">
            {t.pathLabel}
          </span>
          <span className="truncate text-ink">{location.pathname}</span>
        </>
      }
      actions={[
        { label: t.home,    icon: Home,   onClick: () => navigate('/') },
        { label: t.explore, variant: 'secondary', onClick: () => navigate('/categories') },
        { label: t.search,  icon: Search, variant: 'secondary', onClick: () => navigate('/search') },
      ]}
    />
  );
}
