import { Modal, View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Check, Store, Briefcase } from 'lucide-react-native';
import { useSetPricingMode, type PricingMode } from '@grocery-app/shared';
import { colors } from '../constants/colors';
import { useLanguageStore } from '../stores/languageStore';
import { useAuthStore } from '../stores/authStore';
import { useToast } from './Toast';

/**
 * Retail / business price switch for approved Cesto Business customers.
 *
 * The client does no price maths: the API substitutes ProductVariant.b2b_price
 * into `price` based on User.pricing_mode, and strips it entirely unless the
 * account is approved. Switching therefore means writing the mode, then
 * letting the catalogue refetch — which useSetPricingMode already awaits, so
 * `isPending` covers the refetch and not just the POST.
 */
export default function PricingModeSheet({
  visible, onClose,
}: { visible: boolean; onClose: () => void }) {
  const { lang } = useLanguageStore();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const setMode = useSetPricingMode();

  const current: PricingMode = user?.pricing_mode ?? 'retail';

  const options: { id: PricingMode; Icon: typeof Store; title_en: string; title_es: string; desc_en: string; desc_es: string }[] = [
    {
      id: 'retail', Icon: Store,
      title_en: 'Retail prices', title_es: 'Precios de tienda',
      desc_en: 'The usual shelf price, same as everyone else pays.',
      desc_es: 'El precio habitual, el mismo que paga cualquier cliente.',
    },
    {
      id: 'b2b', Icon: Briefcase,
      title_en: 'Business prices', title_es: 'Precios de empresa',
      desc_en: 'Your wholesale rates. Applies across the catalogue and at checkout.',
      desc_es: 'Tus precios mayoristas. Se aplican en todo el catálogo y al pagar.',
    },
  ];

  const choose = async (mode: PricingMode) => {
    if (mode === current || setMode.isPending) return;
    try {
      const updated = await setMode.mutateAsync(mode);
      // The mutation returns the patched user; keep the store and the request
      // header in step rather than waiting for the next hydrate.
      if (updated && typeof updated === 'object' && 'pricing_mode' in updated) {
        setUser({ ...(user ?? {}), ...(updated as object) } as never);
      } else if (user) {
        setUser({ ...user, pricing_mode: mode });
      }
      toast.success(
        mode === 'b2b'
          ? (lang === 'es' ? 'Precios de empresa activados' : 'Business prices on')
          : (lang === 'es' ? 'Precios de tienda activados' : 'Retail prices on'),
        lang === 'es' ? 'Hemos actualizado el catálogo.' : "We've refreshed the catalogue.",
      );
      onClose();
    } catch (err) {
      toast.error(
        lang === 'es' ? 'No se pudo cambiar' : "Couldn't switch",
        err instanceof Error ? err.message : undefined,
      );
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !setMode.isPending && onClose()}>
      <Pressable
        onPress={() => { if (!setMode.isPending) onClose(); }}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: colors.surface.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 34 }}
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>
            {lang === 'es' ? 'Qué precios ver' : 'Which prices to show'}
          </Text>
          <Text style={{ fontSize: 12, color: colors.gray, marginTop: 4, marginBottom: 16, lineHeight: 17 }}>
            {lang === 'es'
              ? 'Cambia entre tus precios de empresa y los de tienda cuando quieras.'
              : 'Switch between your business rates and the retail prices whenever you like.'}
          </Text>

          <View style={{ gap: 10 }}>
            {options.map((opt) => {
              const active = current === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => choose(opt.id)}
                  disabled={setMode.isPending}
                  style={{
                    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
                    borderRadius: 12, padding: 14,
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? colors.brand.DEFAULT : colors.border,
                    backgroundColor: active ? colors.brand.whisper : colors.surface.linen,
                    opacity: setMode.isPending && !active ? 0.5 : 1,
                  }}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: active ? colors.brand.mist : colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
                    <opt.Icon size={18} color={active ? colors.brand.deepest : colors.muted} strokeWidth={1.75} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                      {lang === 'es' ? opt.title_es : opt.title_en}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.gray, marginTop: 3, lineHeight: 17 }}>
                      {lang === 'es' ? opt.desc_es : opt.desc_en}
                    </Text>
                  </View>
                  {setMode.isPending && setMode.variables === opt.id
                    ? <ActivityIndicator size="small" color={colors.brand.DEFAULT} />
                    : active
                      ? <Check size={18} color={colors.brand.DEFAULT} strokeWidth={2.5} />
                      : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
