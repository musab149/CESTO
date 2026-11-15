import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Image, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  ArrowLeft, ChevronDown, ChevronUp, ImagePlus, X, AlertTriangle, Zap, Copy,
} from 'lucide-react-native';
import {
  usePartnerStore as usePartnerStoreQuery, useUpdatePartnerStore,
  partnerUploads, resolveImageUrl,
  WEEKDAY_KEYS, weekdayLabel, defaultShopHours,
  type WeekdayKey, type ShopHours, type ShopHoursDay,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { useLanguageStore } from '@/stores/languageStore';
import { usePartnerT } from '@/partner/lib/i18n';
import { useToast } from '@/components/Toast';
import Skeleton from '@/components/Skeleton';

/**
 * Storefront editor.
 *
 * Web presents this as one long form. On a phone it is five collapsible
 * sections in one scroll, for the same reason the product form is: a partner
 * comes here to change one thing — usually the hours or the phone number — and
 * should not scroll past four sections they are not touching to find it.
 *
 * Everything saves together in a single PATCH. Per-section saves were
 * tempting, but the API takes one payload and a partial save would leave the
 * storefront in a state the partner did not choose to publish.
 */

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

export default function PartnerStoreEditor() {
  const router = useRouter();
  const t = usePartnerT();
  const { lang } = useLanguageStore();
  const toast = useToast();

  const store = usePartnerStoreQuery();
  const update = useUpdatePartnerStore();

  const [name, setName] = useState('');
  const [taglineEs, setTaglineEs] = useState('');
  const [taglineEn, setTaglineEn] = useState('');
  const [descEs, setDescEs] = useState('');
  const [descEn, setDescEn] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [fastDelivery, setFastDelivery] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hours, setHours] = useState<ShopHours>(defaultShopHours());

  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState({
    identity: true, images: false, contact: false, hours: false, delivery: false,
  });
  const toggle = (k: keyof typeof open) => setOpen((s) => ({ ...s, [k]: !s[k] }));

  useEffect(() => {
    const s = store.data;
    if (!s) return;
    setName(s.name ?? '');
    setTaglineEs(s.tagline_es ?? '');
    setTaglineEn(s.tagline_en ?? '');
    setDescEs(s.description_es ?? '');
    setDescEn(s.description_en ?? '');
    setLogoUrl(s.logo_url ?? null);
    setCoverUrl(s.cover_url ?? null);
    setEmail(s.contact_email ?? '');
    setPhone(s.contact_phone ?? '');
    setWebsite(s.website_url ?? '');
    setFastDelivery(Boolean(s.fast_delivery));
    setPaused(s.status === 'paused');
    setHours((s.shop_hours as ShopHours | null) ?? defaultShopHours());
  }, [store.data?.id]);

  // Only live and paused are self-serve. A draft or suspended store is an
  // admin decision, so the control is shown as locked rather than hidden —
  // hiding it would leave a partner wondering where the switch went.
  const statusLocked = store.data ? !['live', 'paused'].includes(store.data.status ?? '') : false;

  async function pickImage(kind: 'logo' | 'cover') {
    // The system Photo Picker needs no permission, so there is nothing to ask for.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      // A logo is square; a cover is a wide banner. Cropping at pick time
      // beats letting the storefront crop something the partner never saw.
      allowsEditing: true,
      aspect: kind === 'logo' ? [1, 1] : [16, 9],
      quality: 0.9,
    });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;

    setUploading(kind);
    setError(null);
    try {
      const resized = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: kind === 'logo' ? 512 : 1600 } }],
        { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG },
      );
      const file = { uri: resized.uri, name: `${kind}.jpg`, type: 'image/jpeg' } as unknown as File;
      const result = await partnerUploads.uploadImage(file);
      if (kind === 'logo') setLogoUrl(result.url); else setCoverUrl(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('store.uploadFailed'));
    } finally {
      setUploading(null);
    }
  }

  function save() {
    if (!name.trim()) { setError(t('store.needName')); setOpen((s) => ({ ...s, identity: true })); return; }

    // Reject a malformed time before sending it. The API would store it and
    // the storefront's open/closed logic would silently treat the day as shut.
    for (const k of WEEKDAY_KEYS) {
      const d = hours[k];
      if (d && !d.closed && (!HHMM.test(d.open) || !HHMM.test(d.close))) {
        setError(t('store.badTime'));
        setOpen((s) => ({ ...s, hours: true }));
        return;
      }
    }
    setError(null);

    update.mutate({
      name: name.trim(),
      tagline_es: taglineEs.trim() || null,
      tagline_en: taglineEn.trim() || null,
      description_es: descEs.trim() || null,
      description_en: descEn.trim() || null,
      logo_url: logoUrl,
      cover_url: coverUrl,
      contact_email: email.trim() || null,
      contact_phone: phone.trim() || null,
      website_url: website.trim() || null,
      fast_delivery: fastDelivery,
      shop_hours: hours as Record<string, unknown>,
      ...(statusLocked ? {} : { status: paused ? ('paused' as const) : ('live' as const) }),
    }, {
      onSuccess: () => toast.success(t('store.saved')),
      onError: (e) => setError(e instanceof Error ? e.message : t('store.saveFailed')),
    });
  }

  if (store.isLoading) {
    return (
      <Shell title={t('store.title')} onBack={() => router.back()}>
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={90} borderRadius={12} />)}
        </View>
      </Shell>
    );
  }

  if (store.isError) {
    return (
      <Shell title={t('store.title')} onBack={() => router.back()}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>
          <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('store.loadFailed')}</Text>
        </View>
      </Shell>
    );
  }

  return (
    <Shell title={t('store.title')} onBack={() => router.back()}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">

          <Section title={t('store.section.identity')} open={open.identity} onToggle={() => toggle('identity')}>
            <Field label={t('store.name')} required><Input value={name} onChangeText={setName} /></Field>
            <Field label={t('store.taglineEs')} hint={t('store.optional')}><Input value={taglineEs} onChangeText={setTaglineEs} /></Field>
            <Field label={t('store.taglineEn')} hint={t('store.optional')}><Input value={taglineEn} onChangeText={setTaglineEn} /></Field>
            <Field label={t('store.descriptionEs')} hint={t('store.optional')}><Input value={descEs} onChangeText={setDescEs} multiline /></Field>
            <Field label={t('store.descriptionEn')} hint={t('store.optional')}><Input value={descEn} onChangeText={setDescEn} multiline /></Field>
          </Section>

          <Section title={t('store.section.images')} open={open.images} onToggle={() => toggle('images')}>
            <ImageSlot
              label={t('store.logo')} url={logoUrl} square
              busy={uploading === 'logo'} t={t}
              onPick={() => void pickImage('logo')} onClear={() => setLogoUrl(null)}
            />
            <ImageSlot
              label={t('store.cover')} url={coverUrl}
              busy={uploading === 'cover'} t={t}
              onPick={() => void pickImage('cover')} onClear={() => setCoverUrl(null)}
            />
          </Section>

          <Section title={t('store.section.contact')} open={open.contact} onToggle={() => toggle('contact')}>
            <Field label={t('store.contactEmail')}>
              <Input value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            </Field>
            <Field label={t('store.contactPhone')}>
              <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            </Field>
            <Field label={t('store.website')} hint={t('store.optional')}>
              <Input value={website} onChangeText={setWebsite} autoCapitalize="none" />
            </Field>
          </Section>

          <Section title={t('store.section.hours')} open={open.hours} onToggle={() => toggle('hours')}>
            {WEEKDAY_KEYS.map((k) => (
              <DayRow
                key={k}
                dayKey={k}
                lang={lang}
                day={hours[k] ?? { closed: true }}
                t={t}
                onChange={(d) => setHours((prev) => ({ ...prev, [k]: d }))}
                onCopyToAll={() => {
                  const d = hours[k];
                  if (!d) return;
                  const next: ShopHours = {};
                  for (const key of WEEKDAY_KEYS) next[key] = { ...d };
                  setHours(next);
                  toast.success(t('store.copied'));
                }}
              />
            ))}
          </Section>

          <Section title={t('store.section.delivery')} open={open.delivery} onToggle={() => toggle('delivery')}>
            <ToggleRow
              icon={Zap}
              label={t('store.fastDelivery')}
              hint={t('store.fastDeliveryHint')}
              value={fastDelivery}
              onChange={setFastDelivery}
            />
            <ToggleRow
              label={paused ? t('store.statusPaused') : t('store.statusLive')}
              hint={statusLocked ? t('store.statusLocked') : t('store.statusHint')}
              value={!paused}
              disabled={statusLocked}
              onChange={(v) => setPaused(!v)}
            />
          </Section>
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
            onPress={save}
            disabled={update.isPending}
            style={{
              minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: update.isPending ? colors.brand.light : colors.brand.DEFAULT,
            }}
          >
            {update.isPending
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>{t('store.save')}</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Shell>
  );
}

/* ── pieces ─────────────────────────────────────────────── */

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

function Section({ title, open, onToggle, children }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <View style={{ backgroundColor: colors.surface.cream, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
      <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, minHeight: 52 }}>
        <Text style={{ fontSize: 14.5, fontWeight: '700', color: colors.ink }}>{title}</Text>
        {open ? <ChevronUp size={18} color={colors.muted} strokeWidth={2} /> : <ChevronDown size={18} color={colors.muted} strokeWidth={2} />}
      </Pressable>
      {open && <View style={{ padding: 14, paddingTop: 0, gap: 12 }}>{children}</View>}
    </View>
  );
}

function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode;
}) {
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
  value, onChangeText, multiline, keyboardType, autoCapitalize, placeholder,
}: {
  value: string; onChangeText: (v: string) => void; multiline?: boolean;
  keyboardType?: 'email-address' | 'phone-pad' | 'number-pad'; autoCapitalize?: 'none';
  placeholder?: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      multiline={multiline}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 10,
        paddingHorizontal: 12, paddingVertical: 10,
        minHeight: multiline ? 76 : 44,
        fontSize: 14, color: colors.ink, backgroundColor: colors.surface.linen,
        textAlignVertical: multiline ? 'top' : 'center',
      }}
    />
  );
}

function ImageSlot({
  label, url, square, busy, t, onPick, onClear,
}: {
  label: string; url: string | null; square?: boolean; busy: boolean;
  t: (k: string) => string; onPick: () => void; onClear: () => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.gray }}>{label}</Text>
      <Pressable
        onPress={onPick}
        disabled={busy}
        style={{
          width: square ? 96 : '100%',
          height: square ? 96 : 120,
          borderRadius: 12, overflow: 'hidden',
          backgroundColor: colors.surface.linen,
          borderWidth: 1, borderColor: colors.border,
          borderStyle: url ? 'solid' : 'dashed',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {busy ? (
          <ActivityIndicator color={colors.brand.DEFAULT} />
        ) : url ? (
          <>
            <Image source={{ uri: resolveImageUrl(url, square ? 'logo' : 'banner') }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            <Pressable
              onPress={onClear}
              hitSlop={6}
              style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.7)', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={13} color="#FFFFFF" strokeWidth={2.5} />
            </Pressable>
          </>
        ) : (
          <View style={{ alignItems: 'center', gap: 4 }}>
            <ImagePlus size={20} color={colors.brand.DEFAULT} strokeWidth={1.75} />
            <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.brand.DEFAULT }}>{t('store.addImage')}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function ToggleRow({
  icon: Icon, label, hint, value, onChange, disabled,
}: {
  icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, opacity: disabled ? 0.55 : 1 }}
    >
      {Icon && <Icon size={18} color={colors.gray} strokeWidth={1.75} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{label}</Text>
        {hint && <Text style={{ fontSize: 11.5, color: colors.muted, lineHeight: 15 }}>{hint}</Text>}
      </View>
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

/**
 * One weekday. Closed collapses the row to a single switch; open reveals two
 * time fields and a "copy to every day" shortcut — most shops keep the same
 * hours all week, and typing the same two times seven times is the kind of
 * thing that makes a partner give up and do it on a computer.
 */
function DayRow({
  dayKey, day, lang, t, onChange, onCopyToAll,
}: {
  dayKey: WeekdayKey;
  day: ShopHoursDay;
  lang: 'en' | 'es';
  t: (k: string) => string;
  onChange: (d: ShopHoursDay) => void;
  onCopyToAll: () => void;
}) {
  const closed = day.closed;

  return (
    <View style={{ gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink }}>
          {weekdayLabel(dayKey, lang)}
        </Text>
        {!closed && (
          <Pressable onPress={onCopyToAll} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Copy size={13} color={colors.brand.DEFAULT} strokeWidth={2} />
            <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.brand.DEFAULT }}>{t('store.copyToAll')}</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => onChange(closed ? { closed: false, open: '09:00', close: '20:00' } : { closed: true })}
          style={{
            width: 44, height: 26, borderRadius: 999, padding: 3,
            backgroundColor: closed ? colors.border : colors.brand.DEFAULT,
            alignItems: closed ? 'flex-start' : 'flex-end',
          }}
        >
          <View style={{ width: 20, height: 20, borderRadius: 999, backgroundColor: '#FFFFFF' }} />
        </Pressable>
      </View>

      {closed ? (
        <Text style={{ fontSize: 12, color: colors.muted }}>{t('store.closed')}</Text>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 11, color: colors.muted }}>{t('store.open')}</Text>
            <Input
              value={day.open}
              onChangeText={(v) => onChange({ closed: false, open: v, close: day.close })}
              placeholder="09:00"
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 11, color: colors.muted }}>{t('store.close')}</Text>
            <Input
              value={day.close}
              onChangeText={(v) => onChange({ closed: false, open: day.open, close: v })}
              placeholder="20:00"
            />
          </View>
        </View>
      )}
    </View>
  );
}
