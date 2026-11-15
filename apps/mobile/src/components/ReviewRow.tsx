import { View, Text, Pressable, Image, Modal, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { MoreVertical, Pencil, Trash2, Flag, X, Check } from 'lucide-react-native';
import { resolveImageUrl } from '@grocery-app/shared';
import { colors } from '../constants/colors';
import { useLanguageStore } from '../stores/languageStore';
import { useAuthStore } from '../stores/authStore';
import { useToast } from './Toast';
import { useDeleteMyReview, useReportReview, type Review, type ReviewReportReason } from '../lib/reviews';
import StarRow from './StarRow';

/** Reasons offered when reporting. Short on purpose: a long list makes people
 *  pick the first plausible option, which tells a moderator nothing. Mirrors
 *  the API's ReviewReportReason enum. */
const REPORT_REASONS: { key: ReviewReportReason; en: string; es: string }[] = [
  { key: 'spam',                en: 'Spam or advertising',        es: 'Spam o publicidad' },
  { key: 'offensive',           en: 'Offensive or hateful',       es: 'Ofensiva o de odio' },
  { key: 'off_topic',           en: 'Not about this product',     es: 'No trata de este producto' },
  { key: 'personal_info',       en: 'Contains personal details',  es: 'Contiene datos personales' },
  { key: 'not_a_real_purchase', en: 'Looks fake',                 es: 'Parece falsa' },
];

/** A single review rendered as a content row (no card chrome of its own). The
 *  parent View provides the surrounding card border and any dividers between
 *  rows — kept that way so a long reviews list can be one card with hairlines
 *  instead of N independent cards. */
export default function ReviewRow({
  review,
  onEdit,
}: {
  review: Review;
  onEdit?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { lang } = useLanguageStore();
  const deleteMine = useDeleteMyReview();
  const reportReview = useReportReview();
  const currentUser = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const ownedAvatar = review.owned && currentUser?.avatar_url ? resolveImageUrl(currentUser.avatar_url, 'logo') : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<ReviewReportReason | null>(null);

  // Your own review offers edit and delete; anyone else's offers reporting.
  // The menu therefore exists on every row, where before it appeared only on
  // your own — the report path is required by Google Play's UGC policy.
  const canReport = !review.owned;
  const showMenu = (review.owned && !!onEdit) || canReport;

  function openReport() {
    setMenuOpen(false);
    // Reporting is tied to an account so one person cannot flag the same
    // review repeatedly, which the server's per-reporter unique key enforces.
    if (!isAuthenticated) {
      toast.error(lang === 'en' ? 'Sign in to report a review' : 'Inicia sesión para reportar');
      router.push('/(auth)/login' as never);
      return;
    }
    setReason(null);
    setReportOpen(true);
  }

  function submitReport() {
    if (!reason) return;
    reportReview.mutate(
      { productId: review.productId, reviewId: review.id, payload: { reason } },
      {
        onSuccess: () => {
          setReportOpen(false);
          toast.success(lang === 'en'
            ? 'Thanks — we will take a look.'
            : 'Gracias, lo revisaremos.');
        },
        onError: () => {
          setReportOpen(false);
          toast.error(lang === 'en' ? 'Could not send the report' : 'No se pudo enviar');
        },
      },
    );
  }

  function formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return iso.slice(0, 10); }
  }

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{
          width: 42, height: 42, borderRadius: 21,
          backgroundColor: review.owned ? colors.brand.DEFAULT : colors.brand.mist,
          justifyContent: 'center', alignItems: 'center',
          overflow: 'hidden',
        }}>
          {ownedAvatar ? (
            <Image source={{ uri: ownedAvatar }} style={{ width: 42, height: 42 }} />
          ) : (
            <Text style={{
              fontSize: 13, fontWeight: '800',
              color: review.owned ? '#fff' : colors.brand.deepest,
            }}>
              {review.initials}
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>{review.name}</Text>
            {review.owned && (
              <View style={{
                paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
                backgroundColor: colors.brand.whisper,
                borderWidth: 1, borderColor: colors.brand.mist,
              }}>
                <Text style={{ fontSize: 9.5, fontWeight: '800', color: colors.brand.deepest, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                  {lang === 'en' ? 'You' : 'Tú'}
                </Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2 }}>
            {formatDate(review.createdAt)}
          </Text>
        </View>

        {showMenu ? (
          <View style={{ position: 'relative' }}>
            <Pressable
              onPress={() => setMenuOpen((v) => !v)}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 32, height: 32, borderRadius: 16,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: pressed || menuOpen ? colors.surface.linen : 'transparent',
              })}
            >
              <MoreVertical size={18} color={colors.gray} strokeWidth={2} />
            </Pressable>
            {menuOpen && (
              <>
                <Pressable
                  onPress={() => setMenuOpen(false)}
                  style={{ position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000 }}
                />
                <View style={{
                  position: 'absolute', top: 36, right: 0, minWidth: 160,
                  backgroundColor: '#fff',
                  borderRadius: 12,
                  borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
                  overflow: 'hidden',
                  zIndex: 10,
                }}>
                  {review.owned && onEdit ? (
                    <>
                      <Pressable
                        onPress={() => { setMenuOpen(false); onEdit(); }}
                        style={({ pressed }) => ({
                          flexDirection: 'row', alignItems: 'center', gap: 10,
                          paddingVertical: 12, paddingHorizontal: 14,
                          backgroundColor: pressed ? colors.surface.linen : '#fff',
                        })}
                      >
                        <Pencil size={15} color={colors.ink} strokeWidth={2} />
                        <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.ink }}>
                          {lang === 'en' ? 'Edit review' : 'Editar reseña'}
                        </Text>
                      </Pressable>
                      <View style={{ height: 1, backgroundColor: colors.border }} />
                      <Pressable
                        onPress={() => { setMenuOpen(false); setConfirmDelete(true); }}
                        style={({ pressed }) => ({
                          flexDirection: 'row', alignItems: 'center', gap: 10,
                          paddingVertical: 12, paddingHorizontal: 14,
                          backgroundColor: pressed ? colors.dangerBg : '#fff',
                        })}
                      >
                        <Trash2 size={15} color={colors.danger} strokeWidth={2} />
                        <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.danger }}>
                          {lang === 'en' ? 'Delete' : 'Eliminar'}
                        </Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      onPress={openReport}
                      style={({ pressed }) => ({
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        paddingVertical: 12, paddingHorizontal: 14,
                        backgroundColor: pressed ? colors.surface.linen : '#fff',
                      })}
                    >
                      <Flag size={15} color={colors.ink} strokeWidth={2} />
                      <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.ink }}>
                        {lang === 'en' ? 'Report review' : 'Reportar reseña'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <StarRow rating={review.rating} size={13} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>{review.rating}.0</Text>
      </View>

      {review.title && (
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, letterSpacing: -0.2 }}>
          {review.title}
        </Text>
      )}
      <Text style={{ fontSize: 13.5, color: 'rgba(15,23,42,0.82)', lineHeight: 20 }}>{review.body}</Text>

      {/* Reporting asks for a reason rather than firing on the tap. A bare
          "Report" gives a moderator a flagged row and no idea what to look
          for, and the confirmation step also catches a mis-tap. */}
      <Modal
        visible={reportOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setReportOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.5)' }}
          onPress={() => setReportOpen(false)}
        />
        <View style={{
          backgroundColor: '#fff',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32, gap: 6,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>
                {lang === 'en' ? 'Report this review' : 'Reportar esta reseña'}
              </Text>
              <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 2, lineHeight: 17 }}>
                {lang === 'en'
                  ? 'Tell us what is wrong with it. Someone will read it — nothing is hidden automatically.'
                  : 'Cuéntanos qué le pasa. Alguien lo revisará; nada se oculta automáticamente.'}
              </Text>
            </View>
            <Pressable onPress={() => setReportOpen(false)} hitSlop={10} style={{ paddingLeft: 12 }}>
              <X size={19} color={colors.muted} strokeWidth={2} />
            </Pressable>
          </View>

          {/* Pick first, send second. Firing on the tap meant the only place
              to show progress was the rows themselves, which put a spinner on
              every one of them — and left no way back from a mis-tap. */}
          {REPORT_REASONS.map((r) => {
            const on = reason === r.key;
            return (
              <Pressable
                key={r.key}
                onPress={() => setReason(r.key)}
                disabled={reportReview.isPending}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  minHeight: 52, paddingHorizontal: 14, borderRadius: 12,
                  backgroundColor: on ? colors.brand.mist : pressed ? colors.surface.linen : colors.surface.sand,
                  borderWidth: 1, borderColor: on ? colors.brand.DEFAULT : 'transparent',
                  opacity: reportReview.isPending ? 0.6 : 1,
                })}
              >
                <Text style={{
                  flex: 1, fontSize: 14.5,
                  fontWeight: on ? '700' : '600',
                  color: on ? colors.brand.deepest : colors.ink,
                }}>
                  {lang === 'en' ? r.en : r.es}
                </Text>
                {on && <Check size={17} color={colors.brand.DEFAULT} strokeWidth={2.5} />}
              </Pressable>
            );
          })}

          <Pressable
            onPress={submitReport}
            disabled={!reason || reportReview.isPending}
            style={{
              marginTop: 8, minHeight: 52, borderRadius: 12,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: !reason ? colors.surface.sand : colors.danger,
            }}
          >
            {reportReview.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={{
                fontSize: 15, fontWeight: '700',
                color: !reason ? colors.muted : '#FFFFFF',
              }}>
                {lang === 'en' ? 'Send report' : 'Enviar reporte'}
              </Text>
            )}
          </Pressable>
        </View>
      </Modal>

      <Modal
        visible={confirmDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDelete(false)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
          justifyContent: 'center', alignItems: 'center',
          paddingHorizontal: 28,
        }}>
          <Pressable onPress={() => setConfirmDelete(false)} style={{ position: 'absolute', inset: 0 }} />
          <View style={{
            width: '100%', maxWidth: 360,
            backgroundColor: '#fff', borderRadius: 18,
            paddingHorizontal: 22, paddingTop: 28, paddingBottom: 22,
            alignItems: 'center',
            borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
          }}>
            <View style={{
              width: 56, height: 56, borderRadius: 28,
              backgroundColor: colors.dangerBg,
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <Trash2 size={24} color={colors.danger} strokeWidth={2} />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
              {lang === 'en' ? 'Delete this review?' : '¿Eliminar esta reseña?'}
            </Text>
            <Text style={{ fontSize: 13, color: colors.gray, lineHeight: 19, textAlign: 'center', marginTop: 8 }}>
              {lang === 'en'
                ? 'Your review will be permanently removed. This cannot be undone.'
                : 'Tu reseña se eliminará de forma permanente. Esta acción no se puede deshacer.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 22, alignSelf: 'stretch' }}>
              <Pressable
                onPress={() => setConfirmDelete(false)}
                style={{
                  flex: 1, height: 50, borderRadius: 12,
                  borderWidth: 1, borderColor: colors.border,
                  justifyContent: 'center', alignItems: 'center',
                  backgroundColor: '#fff',
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                  {lang === 'en' ? 'Cancel' : 'Cancelar'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { setConfirmDelete(false); deleteMine.mutate(review.productId); }}
                style={({ pressed }) => ({
                  flex: 1, height: 50, borderRadius: 12,
                  backgroundColor: pressed ? '#B91C1C' : colors.danger,
                  justifyContent: 'center', alignItems: 'center',
                })}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
                  {lang === 'en' ? 'Delete' : 'Eliminar'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
