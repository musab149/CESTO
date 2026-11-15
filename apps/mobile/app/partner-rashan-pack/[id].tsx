import { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Image, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  ArrowLeft, Plus, Minus, Trash2, X, ChevronDown, ChevronUp, ImagePlus,
  AlertTriangle, ShieldAlert, Search, ShoppingBasket,
} from 'lucide-react-native';
import {
  usePartnerRashanPacks, useCreatePartnerRashanPack, useUpdatePartnerRashanPack,
  useDeletePartnerRashanPack, usePartnerProducts, usePartnerStore,
  partnerUploads, resolveImageUrl,
  type PartnerPackPayload, type RashanPackItem,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { usePartnerT } from '@/partner/lib/i18n';
import { useToast } from '@/components/Toast';
import { PickerSheet } from '@/partner/components/ui';
import { useDialog } from '@/components/AppDialog';

/**
 * Create or edit a rashan pack.
 *
 * Web runs this as an 828-line modal. A modal that tall is the wrong shape on
 * a phone, so this follows the product form's pattern instead: one full screen
 * of collapsible sections, validation pointing at the section that needs work.
 *
 * Route: /partner-rashan-pack/new to create, /partner-rashan-pack/<id> to edit.
 *
 * The list endpoint already returns whole packs, so an edit reads its subject
 * out of that cached list rather than fetching one — there is no /packs/:id
 * round trip to wait through, and the list is always warm because you arrive
 * here from it.
 */

const EMOJI_CHOICES = ['🧺', '🍚', '🌾', '🫘', '🧂', '🫒', '🥘', '🍜', '🧴', '📦'];

/** "Arroz Basmati Premium" -> "arroz-basmati-premium". Mirrors web's slugify. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function splitLines(value: string): string[] {
  return value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10);
}

function money(n: number): string {
  return Number(n).toFixed(2).replace('.', ',') + ' €';
}

type SectionKey = 'basics' | 'presentation' | 'items';

export default function PartnerRashanPackForm() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dialog = useDialog();
  const t = usePartnerT();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const packs = usePartnerRashanPacks();
  const store = usePartnerStore();
  // The picker only ever offers this store's own products — the API rejects
  // anything else, so offering more would just manufacture a 422.
  const productsPage = usePartnerProducts({ limit: 200, isActive: 'true' });
  const products = useMemo(() => productsPage.data?.items ?? [], [productsPage.data]);

  const create = useCreatePartnerRashanPack();
  const update = useUpdatePartnerRashanPack();
  const remove = useDeletePartnerRashanPack();
  const saving = create.isPending || update.isPending;

  const existing = isNew ? null : (packs.data ?? []).find((p) => p.id === id) ?? null;
  const blocked = !!existing?.admin_blocked_at;

  // Seeded once from the subject. `packs` is already cached when arriving from
  // the list; the loading branch below covers a cold deep link.
  const seeded = useMemo(() => {
    if (!existing) return null;
    const prefix = store.data?.slug ? `${store.data.slug}-` : null;
    return {
      // The stored slug carries the store prefix the API added; strip it so the
      // partner edits the same bare value they typed.
      slug: prefix && existing.slug.startsWith(prefix) ? existing.slug.slice(prefix.length) : existing.slug,
      name_es: existing.name_es,
      name_en: existing.name_en,
      tagline_es: existing.tagline_es ?? '',
      tagline_en: existing.tagline_en ?? '',
      cover_url: existing.cover_url ?? null,
      emoji: existing.emoji ?? '🧺',
      estimated_savings_pct: String(existing.estimated_savings_pct ?? 0),
      household_default: String(existing.household_default ?? 4),
      highlights_es: (existing.highlights_es ?? []).join('\n'),
      highlights_en: (existing.highlights_en ?? []).join('\n'),
      items: existing.items ?? [],
      is_active: existing.is_active,
      sort_order: existing.sort_order ?? 0,
    };
  }, [existing, store.data?.slug]);

  const [form, setForm] = useState(() => seeded ?? {
    slug: '', name_es: '', name_en: '', tagline_es: '', tagline_en: '',
    cover_url: null as string | null, emoji: '🧺',
    estimated_savings_pct: '0', household_default: '4',
    highlights_es: '', highlights_en: '',
    items: [] as RashanPackItem[], is_active: true, sort_order: 0,
  });
  const [hydrated, setHydrated] = useState(isNew);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [variantFor, setVariantFor] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    basics: true, presentation: false, items: true,
  });

  // A cold deep link lands before the list resolves; fill the form the first
  // time the subject appears rather than on every render.
  if (!hydrated && seeded) {
    setForm(seeded);
    setHydrated(true);
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Live total from current variant prices, so the cost is visible while the
  // pack is being built rather than after saving.
  const itemsTotal = useMemo(() => form.items.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.product_id);
    const variant = product?.variants?.find((v) => v.id === item.variant_id);
    return sum + Number(variant?.price ?? 0) * item.quantity;
  }, 0), [form.items, products]);

  const chosenIds = new Set(form.items.map((i) => i.product_id));
  const searchResults = productQuery.trim()
    ? products
      .filter((p) => !chosenIds.has(p.id))
      .filter((p) => `${p.name_es} ${p.name_en ?? ''} ${p.brand ?? ''}`
        .toLowerCase().includes(productQuery.trim().toLowerCase()))
      .slice(0, 12)
    : [];

  function addItem(productId: string) {
    const product = products.find((p) => p.id === productId);
    const variant = product?.variants?.find((v) => v.is_default) ?? product?.variants?.[0];
    if (!product || !variant) return;
    if (chosenIds.has(productId)) return;
    set('items', [...form.items, { product_id: productId, variant_id: variant.id, quantity: 1 }]);
    setProductQuery('');
  }

  function setQuantity(productId: string, qty: number) {
    set('items', qty <= 0
      ? form.items.filter((i) => i.product_id !== productId)
      : form.items.map((i) => (i.product_id === productId ? { ...i, quantity: qty } : i)));
  }

  function setVariant(productId: string, variantId: string) {
    set('items', form.items.map((i) => (i.product_id === productId ? { ...i, variant_id: variantId } : i)));
    setVariantFor(null);
  }

  async function pickCover() {
    // The system Photo Picker needs no permission, so there is nothing to ask for.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsEditing: true,
      aspect: [16, 9],
    });
    if (picked.canceled || !picked.assets?.[0]) return;
    setUploading(true);
    try {
      // Resize before upload for the same reason the product form does: a
      // phone camera file is far larger than the pull zone ever serves.
      const resized = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      const file = { uri: resized.uri, name: 'pack.jpg', type: 'image/jpeg' } as unknown as File;
      const result = await partnerUploads.uploadImage(file);
      set('cover_url', result.url);
    } catch {
      toast.error(t('packs.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    setError(null);
    if (!form.name_es.trim() || !form.name_en.trim()) {
      setOpen((o) => ({ ...o, basics: true }));
      setError(t('packs.needBothNames'));
      return;
    }
    if (form.items.length === 0) {
      setOpen((o) => ({ ...o, items: true }));
      setError(t('packs.needItems'));
      return;
    }
    const slug = slugify(form.slug || form.name_en);
    if (!slug) {
      setOpen((o) => ({ ...o, basics: true }));
      setError(t('packs.needSlug'));
      return;
    }

    const payload: PartnerPackPayload = {
      slug,
      name_es: form.name_es.trim(),
      name_en: form.name_en.trim(),
      tagline_es: form.tagline_es.trim() || null,
      tagline_en: form.tagline_en.trim() || null,
      cover_url: form.cover_url,
      emoji: form.emoji || null,
      // 0 tells the API to price the pack from its items.
      base_price: 0,
      estimated_savings_pct: Number(form.estimated_savings_pct) || 0,
      household_default: Number(form.household_default) || 4,
      highlights_es: splitLines(form.highlights_es),
      highlights_en: splitLines(form.highlights_en),
      items: form.items,
      sort_order: form.sort_order,
      is_active: form.is_active,
    };

    const done = {
      onSuccess: () => { toast.success(t('packs.saved')); router.back(); },
      onError: (err: unknown) => setError(
        err instanceof Error && err.message ? err.message : t('packs.saveFailed'),
      ),
    };
    if (isNew) create.mutate(payload, done);
    else update.mutate({ id: id!, payload }, done);
  }

  function confirmDelete() {
    if (isNew || !existing) return;
    const subscribers = existing._count?.subscriptions ?? 0;
    dialog.confirm({
      icon: Trash2,
      title: t('packs.delete'),
      message: subscribers > 0
        ? t('packs.deleteWithSubs').replace('{{n}}', String(subscribers))
        : t('packs.deleteConfirm'),
      cancelLabel: t('packs.cancel'),
      confirmLabel: t('packs.delete'),
      onConfirm: () => remove.mutate(existing.id, {
        onSuccess: () => { toast.success(t('packs.deleted')); router.back(); },
        onError: (err: unknown) => setError(
          err instanceof Error && err.message ? err.message : t('packs.deleteFailed'),
        ),
      }),
    });
  }

  // Cold deep link into an edit before the list has resolved.
  if (!isNew && !existing && packs.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface.linen, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand.DEFAULT} />
      </View>
    );
  }
  if (!isNew && !existing && !packs.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface.linen, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 }}>
        <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('packs.notFound')}</Text>
        <Pressable onPress={() => router.back()} style={{ minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{t('packs.back')}</Text>
        </Pressable>
      </View>
    );
  }

  const variantProduct = variantFor ? products.find((p) => p.id === variantFor) ?? null : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingHorizontal: 12, paddingTop: insets.top + 10, paddingBottom: 12,
          backgroundColor: colors.surface.cream, borderBottomWidth: 1, borderBottomColor: colors.border,
        }}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <ArrowLeft size={21} color={colors.ink} strokeWidth={2} />
          </Pressable>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.ink }}>
            {isNew ? t('packs.add') : t('packs.edit')}
          </Text>
          <Pressable
            onPress={submit}
            disabled={saving || blocked}
            style={{
              height: 38, paddingHorizontal: 16, borderRadius: 10,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: saving || blocked ? colors.brand.light : colors.brand.DEFAULT,
            }}
          >
            {saving
              ? <ActivityIndicator color="#FFFFFF" size="small" />
              : <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#FFFFFF' }}>{t('packs.save')}</Text>}
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {blocked && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, backgroundColor: colors.dangerBg }}>
              <ShieldAlert size={15} color={colors.danger} strokeWidth={2} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 17 }}>
                {t('packs.blockedForm')}
              </Text>
            </View>
          )}

          <Section
            title={t('packs.section.basics')}
            open={open.basics}
            onToggle={() => setOpen((o) => ({ ...o, basics: !o.basics }))}
          >
            <Field label={t('packs.nameEs')}>
              <Input
                value={form.name_es}
                onChangeText={(v) => set('name_es', v)}
                placeholder={t('packs.namePlaceholder')}
              />
            </Field>
            <Field label={t('packs.nameEn')}>
              <Input
                value={form.name_en}
                onChangeText={(v) => {
                  set('name_en', v);
                  // The slug follows the English name until it is edited by
                  // hand, then it stops moving under the partner.
                  if (!slugTouched) set('slug', slugify(v));
                }}
              />
            </Field>
            <Field label={t('packs.slug')} hint={t('packs.slugHint')}>
              <Input
                value={form.slug}
                onChangeText={(v) => { setSlugTouched(true); set('slug', v); }}
                autoCapitalize="none"
              />
              {!!store.data?.slug && !!form.slug && (
                <Text style={{ fontSize: 11, color: colors.muted, fontFamily: 'JetBrainsMono', marginTop: 4 }}>
                  /rashan/{store.data.slug}-{slugify(form.slug)}
                </Text>
              )}
            </Field>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label={t('packs.household')} hint={t('packs.householdHint')}>
                  <Input
                    value={form.household_default}
                    onChangeText={(v) => set('household_default', v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label={t('packs.savings')} hint={t('packs.savingsHint')}>
                  <Input
                    value={form.estimated_savings_pct}
                    onChangeText={(v) => set('estimated_savings_pct', v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                  />
                </Field>
              </View>
            </View>
            <Pressable
              onPress={() => set('is_active', !form.is_active)}
              disabled={blocked}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, opacity: blocked ? 0.5 : 1 }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('packs.active')}</Text>
                <Text style={{ fontSize: 11.5, color: colors.muted, lineHeight: 15 }}>{t('packs.activeHint')}</Text>
              </View>
              <View style={{
                width: 46, height: 28, borderRadius: 999, padding: 3,
                backgroundColor: form.is_active ? colors.brand.DEFAULT : colors.border,
                alignItems: form.is_active ? 'flex-end' : 'flex-start',
              }}>
                <View style={{ width: 22, height: 22, borderRadius: 999, backgroundColor: '#FFFFFF' }} />
              </View>
            </Pressable>
          </Section>

          <Section
            title={t('packs.section.presentation')}
            open={open.presentation}
            onToggle={() => setOpen((o) => ({ ...o, presentation: !o.presentation }))}
          >
            <Field label={t('packs.emoji')} hint={t('packs.emojiHint')}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {EMOJI_CHOICES.map((e) => {
                  const on = form.emoji === e;
                  return (
                    <Pressable
                      key={e}
                      onPress={() => set('emoji', e)}
                      style={{
                        width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: on ? colors.brand.mist : colors.surface.linen,
                        borderWidth: 1, borderColor: on ? colors.brand.DEFAULT : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 22 }}>{e}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            <Field label={t('packs.cover')} hint={t('packs.coverHint')}>
              {form.cover_url ? (
                <View style={{ gap: 8 }}>
                  <Image
                    source={{ uri: resolveImageUrl(form.cover_url, 'card') ?? form.cover_url }}
                    style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: colors.surface.sand }}
                  />
                  <Pressable
                    onPress={() => set('cover_url', null)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40 }}
                  >
                    <Trash2 size={14} color={colors.danger} strokeWidth={2} />
                    <Text style={{ fontSize: 13, fontWeight: '600', color: colors.danger }}>{t('packs.removeCover')}</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => void pickCover()}
                  disabled={uploading}
                  style={{
                    minHeight: 92, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 6,
                    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.surface.linen,
                  }}
                >
                  {uploading ? <ActivityIndicator color={colors.brand.DEFAULT} /> : (
                    <>
                      <ImagePlus size={20} color={colors.muted} strokeWidth={1.75} />
                      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.gray }}>{t('packs.addCover')}</Text>
                    </>
                  )}
                </Pressable>
              )}
            </Field>

            <Field label={t('packs.taglineEs')}>
              <Input value={form.tagline_es} onChangeText={(v) => set('tagline_es', v)} />
            </Field>
            <Field label={t('packs.taglineEn')}>
              <Input value={form.tagline_en} onChangeText={(v) => set('tagline_en', v)} />
            </Field>
            <Field label={t('packs.highlightsEs')} hint={t('packs.highlightsHint')}>
              <Input value={form.highlights_es} onChangeText={(v) => set('highlights_es', v)} multiline />
            </Field>
            <Field label={t('packs.highlightsEn')} hint={t('packs.highlightsHint')}>
              <Input value={form.highlights_en} onChangeText={(v) => set('highlights_en', v)} multiline />
            </Field>
          </Section>

          <Section
            title={t('packs.section.items')}
            badge={String(form.items.length)}
            open={open.items}
            onToggle={() => setOpen((o) => ({ ...o, items: !o.items }))}
          >
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              backgroundColor: colors.surface.linen, borderWidth: 1, borderColor: colors.border,
              borderRadius: 10, paddingHorizontal: 10, minHeight: 44,
            }}>
              <Search size={15} color={colors.muted} strokeWidth={1.75} />
              <TextInput
                value={productQuery}
                onChangeText={setProductQuery}
                placeholder={t('packs.searchProducts')}
                placeholderTextColor={colors.muted}
                style={{ flex: 1, fontSize: 13.5, color: colors.ink }}
              />
              {productQuery.length > 0 && (
                <Pressable onPress={() => setProductQuery('')} hitSlop={8}>
                  <X size={15} color={colors.muted} strokeWidth={2} />
                </Pressable>
              )}
            </View>

            {searchResults.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => addItem(p.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  minHeight: 48, paddingHorizontal: 12, borderRadius: 10,
                  backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border,
                }}
              >
                <Plus size={15} color={colors.brand.DEFAULT} strokeWidth={2.5} />
                <Text style={{ flex: 1, fontSize: 13.5, color: colors.ink }} numberOfLines={1}>{p.name_es}</Text>
                {p.variants?.[0]?.price != null && (
                  <Text style={{ fontSize: 12, color: colors.muted }}>{money(Number(p.variants[0].price))}</Text>
                )}
              </Pressable>
            ))}

            {form.items.length === 0 ? (
              <View style={{ alignItems: 'center', gap: 6, paddingVertical: 20 }}>
                <ShoppingBasket size={22} color={colors.muted} strokeWidth={1.75} />
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', maxWidth: 240, lineHeight: 18 }}>
                  {t('packs.noItems')}
                </Text>
              </View>
            ) : form.items.map((item) => {
              const product = products.find((p) => p.id === item.product_id);
              const variant = product?.variants?.find((v) => v.id === item.variant_id);
              const variantCount = product?.variants?.length ?? 0;
              return (
                <View
                  key={item.product_id}
                  style={{
                    gap: 8, padding: 12, borderRadius: 10,
                    backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.ink }} numberOfLines={2}>
                      {product?.name_es ?? t('packs.unknownProduct')}
                    </Text>
                    <Pressable onPress={() => setQuantity(item.product_id, 0)} hitSlop={8}>
                      <Trash2 size={15} color={colors.danger} strokeWidth={2} />
                    </Pressable>
                  </View>

                  {variantCount > 1 && (
                    <Pressable
                      onPress={() => setVariantFor(item.product_id)}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 6,
                        minHeight: 38, paddingHorizontal: 10, borderRadius: 8,
                        backgroundColor: colors.surface.linen, borderWidth: 1, borderColor: colors.border,
                      }}
                    >
                      <Text style={{ flex: 1, fontSize: 12.5, color: colors.gray }} numberOfLines={1}>
                        {variant?.name_es ?? t('packs.pickVariant')}
                      </Text>
                      <ChevronDown size={13} color={colors.muted} strokeWidth={2} />
                    </Pressable>
                  )}

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Stepper
                      quantity={item.quantity}
                      onChange={(q) => setQuantity(item.product_id, q)}
                    />
                    <Text style={{ flex: 1, textAlign: 'right', fontSize: 13.5, fontWeight: '700', color: colors.ink }}>
                      {money(Number(variant?.price ?? 0) * item.quantity)}
                    </Text>
                  </View>
                </View>
              );
            })}

            {form.items.length > 0 && (
              <View style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border,
              }}>
                <Text style={{ fontSize: 13, color: colors.gray }}>{t('packs.itemsTotal')}</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{money(itemsTotal)}</Text>
              </View>
            )}
          </Section>

          {error && (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, backgroundColor: colors.dangerBg }}>
              <AlertTriangle size={15} color={colors.danger} strokeWidth={2} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 17 }}>{error}</Text>
            </View>
          )}

          {!isNew && (
            <Pressable
              onPress={confirmDelete}
              disabled={remove.isPending}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48 }}
            >
              <Trash2 size={15} color={colors.danger} strokeWidth={2} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.danger }}>{t('packs.delete')}</Text>
            </Pressable>
          )}
        </ScrollView>

        <PickerSheet
          visible={variantFor !== null}
          title={t('packs.pickVariant')}
          selectedKey={form.items.find((i) => i.product_id === variantFor)?.variant_id}
          options={(variantProduct?.variants ?? []).map((v) => ({
            key: v.id,
            label: `${v.name_es ?? ''} · ${money(Number(v.price))}`.trim(),
          }))}
          emptyLabel={t('packs.noVariants')}
          onClose={() => setVariantFor(null)}
          onPick={(key) => { if (variantFor) setVariant(variantFor, key); }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

/* ── pieces ─────────────────────────────────────────────── */

function Section({
  title, badge, open, onToggle, children,
}: {
  title: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{
      backgroundColor: colors.surface.cream, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    }}>
      <Pressable
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 52 }}
      >
        <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.ink }}>{title}</Text>
        {!!badge && (
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.brand.mist }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brand.deepest }}>{badge}</Text>
          </View>
        )}
        {open
          ? <ChevronUp size={16} color={colors.muted} strokeWidth={2} />
          : <ChevronDown size={16} color={colors.muted} strokeWidth={2} />}
      </Pressable>
      {open && (
        <View style={{ padding: 14, paddingTop: 2, gap: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
          {children}
        </View>
      )}
    </View>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.gray }}>{label}</Text>
      {children}
      {!!hint && <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 15 }}>{hint}</Text>}
    </View>
  );
}

function Input({
  value, onChangeText, placeholder, keyboardType, multiline, autoCapitalize,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'number-pad';
  multiline?: boolean;
  autoCapitalize?: 'none';
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      keyboardType={keyboardType}
      multiline={multiline}
      autoCapitalize={autoCapitalize}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 10,
        paddingHorizontal: 12, paddingTop: multiline ? 10 : 0,
        minHeight: multiline ? 80 : 46,
        fontSize: 14, color: colors.ink, backgroundColor: colors.surface.linen,
        textAlignVertical: multiline ? 'top' : 'center',
      }}
    />
  );
}

function Stepper({ quantity, onChange }: { quantity: number; onChange: (q: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable
        onPress={() => onChange(quantity - 1)}
        style={{
          width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface.linen,
        }}
      >
        <Minus size={14} color={colors.ink} strokeWidth={2.5} />
      </Pressable>
      <Text style={{ minWidth: 24, textAlign: 'center', fontSize: 14.5, fontWeight: '700', color: colors.ink }}>
        {quantity}
      </Text>
      <Pressable
        onPress={() => onChange(quantity + 1)}
        style={{
          width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface.linen,
        }}
      >
        <Plus size={14} color={colors.ink} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}
