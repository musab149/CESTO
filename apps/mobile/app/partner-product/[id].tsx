import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Image, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  ArrowLeft, Plus, Trash2, X, ChevronDown, ChevronUp, ImagePlus, Star, AlertTriangle,
} from 'lucide-react-native';
import {
  usePartnerProduct, useCreatePartnerProduct, useUpdatePartnerProduct, useDeletePartnerProduct,
  usePartnerCategories, usePartnerSubcategories, usePartnerBrands, usePartnerOrigins,
  partnerUploads, resolveImageUrl,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { useLanguageStore } from '@/stores/languageStore';
import { usePartnerT } from '@/partner/lib/i18n';
import { useToast } from '@/components/Toast';
import Skeleton from '@/components/Skeleton';
import { useDialog } from '@/components/AppDialog';

/**
 * Create or edit a product.
 *
 * Web runs this as a 973-line four-tab form. Tabs are the wrong shape on a
 * phone: they hide the fact that something further along is incomplete, so you
 * hit save and get told about a tab you never opened. This is one scroll of
 * collapsible sections instead — everything is reachable, the sections say
 * what they contain, and validation points at the section that needs work.
 *
 * Route: /partner-product/new for a create, /partner-product/<id> for an edit.
 * One screen rather than two because the only differences are the title, the
 * delete action, and whether the fields start populated.
 */

interface VariantDraft {
  id?: string;
  name_es: string;
  price: string;
  compare_at_price: string;
  stock_quantity: string;
  low_stock_threshold: string;
  is_default: boolean;
}

const emptyVariant = (): VariantDraft => ({
  name_es: '', price: '', compare_at_price: '',
  stock_quantity: '0', low_stock_threshold: '10', is_default: false,
});

export default function PartnerProductForm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const router = useRouter();
  const dialog = useDialog();
  const t = usePartnerT();
  const { lang } = useLanguageStore();
  const toast = useToast();

  const existing = usePartnerProduct(isNew ? undefined : id);
  const create = useCreatePartnerProduct();
  const update = useUpdatePartnerProduct();
  const remove = useDeletePartnerProduct();

  const categories = usePartnerCategories();
  const [categoryId, setCategoryId] = useState('');
  const subcategories = usePartnerSubcategories(categoryId || undefined);
  const brands = usePartnerBrands();
  const origins = usePartnerOrigins();

  const [nameEs, setNameEs] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [descEs, setDescEs] = useState('');
  const [descEn, setDescEn] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [brand, setBrand] = useState('');
  const [origin, setOrigin] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState({ basics: true, classify: true, variants: true, images: true });
  const toggle = (k: keyof typeof open) => setOpen((s) => ({ ...s, [k]: !s[k] }));

  // Populate once the existing product arrives. Keyed on the id so switching
  // products re-fills rather than merging two products' fields together.
  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    setNameEs(p.name_es ?? '');
    setNameEn(p.name_en ?? '');
    setDescEs(p.description_es ?? '');
    setDescEn(p.description_en ?? '');
    setCategoryId(p.category_id ?? '');
    setSubcategoryId(p.subcategory_id ?? '');
    setBrand(p.brand ?? '');
    setOrigin(p.origin ?? '');
    setIsActive(p.is_active ?? true);
    setImageUrls((p.images ?? []).map((i) => i.url));
    setVariants(
      (p.variants ?? []).length
        ? (p.variants ?? []).map((v) => ({
            id: v.id,
            name_es: v.name_es ?? '',
            price: v.price != null ? String(v.price) : '',
            compare_at_price: v.compare_at_price != null ? String(v.compare_at_price) : '',
            stock_quantity: String(v.stock_quantity ?? 0),
            low_stock_threshold: String(v.low_stock_threshold ?? 10),
            is_default: v.is_default ?? false,
          }))
        : [emptyVariant()],
    );
  }, [existing.data?.id]);

  const saving = create.isPending || update.isPending;

  function validate(): string | null {
    if (!nameEs.trim()) return t('productFormM.needName');
    if (!categoryId) return t('productFormM.needCategory');
    if (!variants.some((v) => parseFloat(v.price) > 0)) return t('productFormM.needVariant');
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError(null);

    const hasDefault = variants.some((v) => v.is_default);
    const payload = {
      name_es: nameEs.trim(),
      // Mirrors web: the form does not offer a separate English name per
      // variant, and an empty EN name renders as blank on an English device.
      name_en: nameEn.trim() || nameEs.trim(),
      description_es: descEs.trim() || null,
      description_en: descEn.trim() || null,
      brand: brand.trim() || null,
      origin: origin.trim() || null,
      category_id: categoryId,
      subcategory_id: subcategoryId || null,
      is_active: isActive,
      variants: variants.map((v, idx) => ({
        ...(v.id ? { id: v.id } : {}),
        name_es: v.name_es.trim(),
        name_en: v.name_es.trim(),
        price: parseFloat(v.price) || 0,
        compare_at_price: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
        stock_quantity: parseInt(v.stock_quantity, 10) || 0,
        low_stock_threshold: parseInt(v.low_stock_threshold, 10) || 10,
        // Exactly one default. If the partner set none, the first line is it —
        // the storefront picks the default variant to show, so a product with
        // none renders priceless.
        is_default: hasDefault ? v.is_default : idx === 0,
        is_active: true,
      })),
      images: imageUrls.map((url, idx) => ({
        url, alt_text: nameEs.trim(), sort_order: idx, is_primary: idx === 0,
      })),
    };

    try {
      if (isNew) await create.mutateAsync(payload as never);
      else await update.mutateAsync({ id, payload } as never);
      toast.success(t('productFormM.saved'));
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('productFormM.saveFailed'));
    }
  }

  async function pickImage() {
    // The system Photo Picker needs no permission, so there is nothing to ask for.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;

    setUploading(true);
    setError(null);
    try {
      // Resize before upload for the same reason the avatar flow does: a phone
      // photo is several megabytes, the server caps the stored master at
      // 1600px anyway, and the difference on mobile data is a progress bar.
      const resized = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
      );
      const file = { uri: resized.uri, name: 'product.jpg', type: 'image/jpeg' } as unknown as File;
      const result = await partnerUploads.uploadImage(file);
      setImageUrls((prev) => [...prev, result.url]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('productFormM.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  function confirmDelete() {
    dialog.confirm({
      icon: Trash2,
      title: t('productFormM.deleteProduct'),
      message: t('productFormM.deleteConfirm'),
      cancelLabel: t('productFormM.cancel'),
      confirmLabel: t('productFormM.deleteProduct'),
      onConfirm: () => remove.mutate(id, {
        onSuccess: () => { toast.success(t('productFormM.deleted')); router.back(); },
        onError: () => toast.error(t('productFormM.deleteFailed')),
      }),
    });
  }

  if (!isNew && existing.isLoading) {
    return (
      <Shell title={t('productForm.titleEdit')} onBack={() => router.back()}>
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={90} borderRadius={12} />)}
        </View>
      </Shell>
    );
  }

  if (!isNew && existing.isError) {
    return (
      <Shell title={t('productForm.titleEdit')} onBack={() => router.back()}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>
          <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('productFormM.loadFailed')}</Text>
        </View>
      </Shell>
    );
  }

  return (
    <Shell title={isNew ? t('productForm.titleNew') : t('productForm.titleEdit')} onBack={() => router.back()}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">

          <Section title={t('productForm.tabs.basic')} open={open.basics} onToggle={() => toggle('basics')}>
            <Field label={t('productForm.basic.nameEs')} required>
              <Input value={nameEs} onChangeText={setNameEs} />
            </Field>
            <Field label={t('productForm.basic.nameEn')} hint={t('productFormM.optional')}>
              <Input value={nameEn} onChangeText={setNameEn} />
            </Field>
            <Field label={t('productForm.basic.descriptionEs')} hint={t('productFormM.optional')}>
              <Input value={descEs} onChangeText={setDescEs} multiline />
            </Field>
            <Field label={t('productForm.basic.descriptionEn')} hint={t('productFormM.optional')}>
              <Input value={descEn} onChangeText={setDescEn} multiline />
            </Field>
            <Toggle label={t('productForm.basic.active')} value={isActive} onChange={setIsActive} />
          </Section>

          <Section title={t('productForm.basic.category')} open={open.classify} onToggle={() => toggle('classify')}>
            <Field label={t('productForm.basic.category')} required>
              <Picker
                value={categoryId}
                placeholder={t('productFormM.pickCategory')}
                options={(categories.data ?? []).map((c) => [c.id, lang === 'es' ? c.name_es : c.name_en])}
                onChange={(v) => { setCategoryId(v); setSubcategoryId(''); }}
              />
            </Field>
            <Field label={t('productForm.basic.subcategory')} hint={t('productFormM.optional')}>
              <Picker
                value={subcategoryId}
                placeholder={t('productFormM.none')}
                disabled={!categoryId}
                options={(subcategories.data ?? []).map((s) => [s.id, lang === 'es' ? s.name_es : s.name_en])}
                onChange={setSubcategoryId}
                allowEmpty
                emptyLabel={t('productFormM.none')}
              />
            </Field>
            {/* Brand and origin are free text on the API, and web canonicalises
                what you type against the known list. The picker offers the
                known values; the field still accepts anything. */}
            <Field label={t('productForm.basic.brand')} hint={t('productFormM.optional')}>
              <Picker
                value={brand}
                placeholder={t('productFormM.none')}
                options={(brands.data ?? []).map((b) => [b.name, b.name])}
                onChange={setBrand}
                allowEmpty
                emptyLabel={t('productFormM.none')}
              />
            </Field>
            <Field label={t('productForm.basic.origin')} hint={t('productFormM.optional')}>
              <Picker
                value={origin}
                placeholder={t('productFormM.none')}
                options={(origins.data ?? []).map((o) => [o.label_es, lang === 'es' ? o.label_es : (o.label_en ?? o.label_es)])}
                onChange={setOrigin}
                allowEmpty
                emptyLabel={t('productFormM.none')}
              />
            </Field>
          </Section>

          <Section
            title={`${t('productForm.variants.title')} (${variants.length})`}
            open={open.variants}
            onToggle={() => toggle('variants')}
          >
            {variants.map((v, i) => (
              <VariantCard
                key={v.id ?? `new-${i}`}
                index={i}
                variant={v}
                t={t}
                canDelete={variants.length > 1}
                onChange={(patch) => setVariants((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                onDelete={() => setVariants((prev) => prev.filter((_, j) => j !== i))}
                onMakeDefault={() => setVariants((prev) => prev.map((x, j) => ({ ...x, is_default: j === i })))}
              />
            ))}
            <Pressable
              onPress={() => setVariants((prev) => [...prev, emptyVariant()])}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.brand.DEFAULT,
                borderStyle: 'dashed',
              }}
            >
              <Plus size={16} color={colors.brand.DEFAULT} strokeWidth={2.5} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand.DEFAULT }}>
                {t('productForm.variants.addVariant')}
              </Text>
            </Pressable>
          </Section>

          <Section title={t('productForm.tabs.images')} open={open.images} onToggle={() => toggle('images')}>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>{t('productFormM.photoHint')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {imageUrls.map((url, i) => (
                <View key={url} style={{ width: 88, height: 88, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface.sand }}>
                  <Image source={{ uri: resolveImageUrl(url, 'thumb') }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  {i === 0 && (
                    <View style={{ position: 'absolute', left: 4, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(15,23,42,0.7)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 999 }}>
                      <Star size={9} color="#FFFFFF" strokeWidth={2.5} fill="#FFFFFF" />
                      <Text style={{ fontSize: 8.5, fontWeight: '700', color: '#FFFFFF' }}>{t('productForm.images.primary')}</Text>
                    </View>
                  )}
                  <Pressable
                    onPress={() => setImageUrls((prev) => prev.filter((u) => u !== url))}
                    hitSlop={6}
                    style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.7)', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={12} color="#FFFFFF" strokeWidth={2.5} />
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={pickImage}
                disabled={uploading}
                style={{
                  width: 88, height: 88, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 4,
                  borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', backgroundColor: colors.surface.linen,
                }}
              >
                {uploading
                  ? <ActivityIndicator color={colors.brand.DEFAULT} />
                  : <><ImagePlus size={19} color={colors.brand.DEFAULT} strokeWidth={1.75} />
                      <Text style={{ fontSize: 10.5, fontWeight: '600', color: colors.brand.DEFAULT }}>{t('productFormM.addPhoto')}</Text></>}
              </Pressable>
            </View>
          </Section>

          {!isNew && (
            <Pressable onPress={confirmDelete} style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.danger }}>{t('productFormM.deleteProduct')}</Text>
            </Pressable>
          )}
        </ScrollView>

        <View style={{
          padding: 16, paddingBottom: 24, gap: 8,
          backgroundColor: colors.surface.cream, borderTopWidth: 1, borderTopColor: colors.border,
        }}>
          {error && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.dangerBg }}>
              <AlertTriangle size={15} color={colors.danger} strokeWidth={2} />
              <Text style={{ flex: 1, fontSize: 12.5, color: colors.danger }}>{error}</Text>
            </View>
          )}
          <Pressable
            onPress={() => void save()}
            disabled={saving}
            style={{
              minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: saving ? colors.brand.light : colors.brand.DEFAULT,
            }}
          >
            {saving
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>
                  {isNew ? t('productForm.create') : t('productForm.save')}
                </Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Shell>
  );
}

/* ── building blocks ────────────────────────────────────── */

function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 12, paddingTop: insets.top + 10, paddingBottom: 12,
        backgroundColor: colors.surface.cream, borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <ArrowLeft size={21} color={colors.ink} strokeWidth={2} />
        </Pressable>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Section({
  title, open, onToggle, children,
}: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.surface.cream, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      <Pressable
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, minHeight: 52 }}
      >
        <Text style={{ fontSize: 14.5, fontWeight: '700', color: colors.ink }}>{title}</Text>
        {open ? <ChevronUp size={18} color={colors.muted} strokeWidth={2} /> : <ChevronDown size={18} color={colors.muted} strokeWidth={2} />}
      </Pressable>
      {open && <View style={{ padding: 14, paddingTop: 0, gap: 12 }}>{children}</View>}
    </View>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.gray }}>{label}</Text>
        {required && <Text style={{ fontSize: 12.5, color: colors.danger }}>*</Text>}
        {hint && <Text style={{ fontSize: 11, color: colors.muted }}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

function Input({
  value, onChangeText, multiline, keyboardType, placeholder,
}: {
  value: string; onChangeText: (v: string) => void; multiline?: boolean;
  keyboardType?: 'decimal-pad' | 'number-pad'; placeholder?: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      multiline={multiline}
      keyboardType={keyboardType}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 10,
        paddingHorizontal: 12, paddingVertical: 10,
        minHeight: multiline ? 76 : 44,
        fontSize: 14, color: colors.ink,
        backgroundColor: colors.surface.linen,
        textAlignVertical: multiline ? 'top' : 'center',
      }}
    />
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}
    >
      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{label}</Text>
      <View style={{
        width: 46, height: 28, borderRadius: 999, padding: 3,
        backgroundColor: value ? colors.brand.DEFAULT : colors.border,
        alignItems: value ? 'flex-end' : 'flex-start',
      }}>
        <View style={{ width: 22, height: 22, borderRadius: 999, backgroundColor: '#FFFFFF' }} />
      </View>
    </Pressable>
  );
}

/** A select rendered as a sheet — a native picker on Android is inconsistent
 *  across versions and cannot be styled to match anything else here. */
function Picker({
  value, options, onChange, placeholder, disabled, allowEmpty, emptyLabel,
}: {
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(([v]) => v === value)?.[1];

  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          borderWidth: 1, borderColor: colors.border, borderRadius: 10,
          paddingHorizontal: 12, minHeight: 44,
          backgroundColor: disabled ? colors.surface.sand : colors.surface.linen,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Text style={{ fontSize: 14, color: current ? colors.ink : colors.muted }} numberOfLines={1}>
          {current ?? placeholder}
        </Text>
        <ChevronDown size={17} color={colors.muted} strokeWidth={2} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }} onPress={() => setOpen(false)} />
        <View style={{
          backgroundColor: colors.surface.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20,
          paddingBottom: 32, maxHeight: '70%',
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', padding: 16 }}>
            <Pressable onPress={() => setOpen(false)} hitSlop={10}>
              <X size={19} color={colors.muted} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView>
            {allowEmpty && (
              <Pressable
                onPress={() => { onChange(''); setOpen(false); }}
                style={{ paddingHorizontal: 20, paddingVertical: 14, minHeight: 52, justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 14.5, color: colors.muted }}>{emptyLabel}</Text>
              </Pressable>
            )}
            {options.map(([v, label]) => (
              <Pressable
                key={v}
                onPress={() => { onChange(v); setOpen(false); }}
                style={{ paddingHorizontal: 20, paddingVertical: 14, minHeight: 52, justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 14.5, fontWeight: v === value ? '700' : '400', color: v === value ? colors.brand.DEFAULT : colors.ink }}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function VariantCard({
  index, variant, t, canDelete, onChange, onDelete, onMakeDefault,
}: {
  index: number;
  variant: VariantDraft;
  t: (k: string) => string;
  canDelete: boolean;
  onChange: (patch: Partial<VariantDraft>) => void;
  onDelete: () => void;
  onMakeDefault: () => void;
}) {
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 10, backgroundColor: colors.surface.linen }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.gray }}>
          {t('productFormM.variantN')} {index + 1}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={onMakeDefault} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Star
              size={14}
              color={variant.is_default ? colors.amber.DEFAULT : colors.muted}
              strokeWidth={2}
              fill={variant.is_default ? colors.amber.DEFAULT : 'none'}
            />
            <Text style={{ fontSize: 11.5, fontWeight: '600', color: variant.is_default ? colors.amber.deep : colors.muted }}>
              {t('productForm.variants.default')}
            </Text>
          </Pressable>
          {canDelete && (
            <Pressable onPress={onDelete} hitSlop={8}>
              <Trash2 size={15} color={colors.danger} strokeWidth={2} />
            </Pressable>
          )}
        </View>
      </View>

      <Input value={variant.name_es} onChangeText={(v) => onChange({ name_es: v })} placeholder={t('productForm.variants.nameEs')} />

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.gray }}>{t('productForm.variants.price')}</Text>
          <Input value={variant.price} onChangeText={(v) => onChange({ price: v })} keyboardType="decimal-pad" placeholder="0.00" />
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.gray }}>{t('productForm.variants.stock')}</Text>
          <Input value={variant.stock_quantity} onChangeText={(v) => onChange({ stock_quantity: v })} keyboardType="number-pad" placeholder="0" />
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.gray }}>{t('productForm.variants.lowStockThreshold')}</Text>
          <Input value={variant.low_stock_threshold} onChangeText={(v) => onChange({ low_stock_threshold: v })} keyboardType="number-pad" placeholder="10" />
        </View>
      </View>
    </View>
  );
}
