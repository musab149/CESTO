import { useNavigate } from 'react-router-dom';
import { ShieldOff, Home, LogIn } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import ErrorPage from './ErrorPage';

const COPY = {
  es: {
    badge: 'ERROR 403',
    title: 'No tienes acceso a esta página',
    body: 'Esta sección está restringida. Si crees que deberías poder verla, inicia sesión con la cuenta correcta o contacta con soporte.',
    home: 'Ir al inicio',
    login: 'Iniciar sesión',
  },
  en: {
    badge: 'ERROR 403',
    title: "You don't have access to this page",
    body: 'This section is restricted. If you think you should be able to see it, sign in with the right account or contact support.',
    home: 'Go home',
    login: 'Sign in',
  },
} as const;

export default function ForbiddenPage() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const t = COPY[lang];

  return (
    <ErrorPage
      icon={ShieldOff}
      accent="amber"
      badge={t.badge}
      title={t.title}
      body={t.body}
      actions={
        isAuthenticated
          ? [{ label: t.home, icon: Home, onClick: () => navigate('/') }]
          : [
              { label: t.login, icon: LogIn,  onClick: () => navigate('/login') },
              { label: t.home,  icon: Home,   variant: 'secondary', onClick: () => navigate('/') },
            ]
      }
    />
  );
}
