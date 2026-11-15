import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  useAdminBanners,
  useUpdateBanner,
  useDeleteBanner,
  resolveImageUrl,
} from '@grocery-app/shared';
import ConfirmModal from '@/components/ConfirmModal';
import EmptyState from '@/components/EmptyState';

// ── Helpers ────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ── Component ──────────────────────────────────────────────

export default function BannersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: banners, isLoading } = useAdminBanners();
  const updateBanner = useUpdateBanner();
  const deleteBanner = useDeleteBanner();

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  function getLinkTypeLabel(type: string): string {
    const key = `banners.linkType.${type}` as const;
    return t(key) || type;
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try { await deleteBanner.mutateAsync(deleteConfirm); } catch (err) { console.error(err); }
    setDeleteConfirm(null);
  }

  // ── Loading skeleton ──────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-0">
        <div className="flex items-center justify-between mb-8">
          <div className="h-8 w-40 bg-surface-cream rounded-lg animate-pulse" />
          <div className="h-11 w-36 bg-surface-cream rounded-xl animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="h-40 bg-surface-cream animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-5 w-3/4 bg-surface-cream rounded animate-pulse" />
                <div className="h-4 w-1/2 bg-surface-cream rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">Banners</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate('/banners/new')}
          className="h-[52px] px-5 bg-brand text-white rounded-xl text-sm font-semibold font-display hover:bg-brand-mid transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" strokeWidth={1.75} />
          {t('banners.newBanner')}
        </button>
      </div>

      {/* Banner cards */}
      {!banners || banners.length === 0 ? (
        <EmptyState
          title={t('banners.noBanners')}
          description={t('banners.noBannersDesc')}
          action={{ label: t('banners.createBanner'), onClick: () => navigate('/banners/new') }}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {banners.map((banner, i) => {
            // Banners no longer carry a title — the storefront shows artwork
            // and a button, so the form stopped collecting one. Older rows
            // still have theirs, so use it when present; otherwise fall back
            // to the button text, then to a position, so this never degrades
            // to a column of "—". The thumbnail above is what actually
            // identifies a banner now; this is the accessible label for it.
            const cardTitle =
              banner.title_es || banner.title_en ||
              banner.cta_es || banner.cta_en ||
              `${t('banners.fallbackName')} ${i + 1}`;

            return (
              <div
                key={banner.id}
                className="bg-card rounded-xl border border-border overflow-hidden"
              >
                {/* Image preview */}
                <img
                  src={resolveImageUrl(banner.image_desktop, 'tile')}
                  alt={cardTitle}
                  className="w-full h-40 object-cover"
                />

                {/* Details */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 className="text-sm font-bold font-display text-ink leading-tight">
                      {cardTitle}
                    </h3>
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display flex-shrink-0 ${
                        banner.is_active
                          ? 'bg-success-bg text-success'
                          : 'bg-border text-muted'
                      }`}
                    >
                      {banner.is_active ? t('banners.status.active') : t('banners.status.inactive')}
                    </span>
                  </div>

                  <div className="space-y-1.5 mb-4">
                    <div className="flex items-center gap-2">
                      <ExternalLink className="w-3.5 h-3.5 text-muted" strokeWidth={1.75} />
                      <span className="text-xs text-muted font-display">
                        {t('banners.link')} <span className="text-ink">{getLinkTypeLabel(banner.link_type ?? 'none')}</span>
                      </span>
                    </div>
                    <div className="text-xs text-muted font-display">
                      {t('banners.order')} <span className="text-ink font-semibold">{banner.display_order}</span>
                      <span className="mx-2">|</span>
                      {t('banners.from')} <span className="text-ink">{formatDate(banner.active_from)}</span>
                      <span className="mx-2">—</span>
                      {t('banners.until')} <span className="text-ink">{formatDate(banner.active_until)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/banners/${banner.id}/edit`)}
                      className="h-9 px-3 rounded-lg text-sm font-semibold font-display border-2 border-brand text-brand hover:bg-brand-mist transition-colors flex items-center gap-1.5"
                    >
                      <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {t('banners.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(banner.id)}
                      className="h-9 px-3 rounded-lg text-sm font-semibold font-display border-2 border-danger text-danger hover:bg-danger-bg transition-colors flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {t('banners.delete')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateBanner.mutate({
                          id: banner.id,
                          payload: { ...banner, is_active: !banner.is_active },
                        })
                      }
                      className={`ml-auto w-9 h-9 sm:w-auto sm:h-auto sm:p-2 inline-flex items-center justify-center rounded-lg transition-colors ${
                        banner.is_active
                          ? 'hover:bg-surface-linen text-muted'
                          : 'hover:bg-brand-mist text-brand'
                      }`}
                      title={banner.is_active ? t('banners.deactivate') : t('banners.activate')}
                    >
                      {banner.is_active ? (
                        <EyeOff className="w-4 h-4" strokeWidth={1.75} />
                      ) : (
                        <Eye className="w-4 h-4" strokeWidth={1.75} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={deleteConfirm !== null}
        title={t('banners.deleteConfirmTitle')}
        message={t('banners.deleteConfirmMsg')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
