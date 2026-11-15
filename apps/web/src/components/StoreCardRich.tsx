import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useToggleFollowStore,
  useMyFollowedStores,
} from '@grocery-app/shared';
import type { Store } from '@grocery-app/shared';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/components/Toast';
import StoreHeroCard from '@/components/StoreHeroCard';

export interface StoreCardRichStore extends Store {
  _count?: { products: number };
}

interface Props {
  store: StoreCardRichStore;
  lang: 'en' | 'es';
}

/**
 * Store card for the /stores grid. Renders the same StoreHeroCard at
 * every breakpoint so mobile and desktop share the full details panel
 * (rating / reviews / favourite / products / followers + open hours /
 * distance / min order / delivery fee / free-over + Follow + Share).
 * The parent grid caps at 4 cols on 2xl so the 5-pill rows keep
 * ~300px per card even at the densest breakpoint.
 */
export default function StoreCardRich({ store, lang }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const toggleFollow = useToggleFollowStore();
  const { data: followed } = useMyFollowedStores(isAuthenticated);
  const isFollowed = useMemo(
    () => Array.isArray(followed) && followed.some((s) => s.id === store.id),
    [followed, store.id],
  );

  const t = (en: string, es: string) => (lang === 'en' ? en : es);
  const go = () => navigate(`/stores/${store.slug}`);

  async function handleFollow(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isAuthenticated) {
      toast.info(t('Sign in required', 'Inicia sesión'), t('Sign in to follow this store.', 'Inicia sesión para seguir esta tienda.'));
      navigate('/login');
      return;
    }
    try {
      await toggleFollow.mutateAsync({ slug: store.slug, follow: !isFollowed });
    } catch (err) {
      toast.error(
        t("Couldn't update follow", 'No se pudo actualizar'),
        err instanceof Error ? err.message : t('Please try again.', 'Inténtalo de nuevo.'),
      );
    }
  }

  async function handleShare(e: React.MouseEvent) {
    e.stopPropagation();
    const url = `${window.location.origin}/stores/${store.slug}`;
    const shareData = {
      title: store.name,
      text: t(`Check out ${store.name} on Cesto`, `Descubre ${store.name} en Cesto`),
      url,
    };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch { /* user dismissed — fall through to copy */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('Link copied', 'Enlace copiado'));
    } catch {
      toast.error(t('Unable to share', 'No se pudo compartir'));
    }
  }

  return (
    <StoreHeroCard
      store={store}
      lang={lang}
      isFollowed={isFollowed}
      onFollow={handleFollow}
      followPending={toggleFollow.isPending}
      onShare={handleShare}
      onClick={go}
    />
  );
}
