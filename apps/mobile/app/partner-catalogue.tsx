import { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, FlatList, Pressable, Image, Modal, TextInput,
  ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Grid3X3, Award, Globe, Info, Plus, X, Clock, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, AlertTriangle, Package,
} from 'lucide-react-native';
import {
  usePartnerCategories, usePartnerSubcategories, usePartnerProductTypes,
  usePartnerMyCategories, useCreatePartnerCategory, useDismissPartnerCategorySubmission,
  usePartnerBrands, usePartnerOrigins, resolveImageUrl,
  type PartnerCategory, type PartnerCategorySubmission,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { usePartnerT } from '@/partner/lib/i18n';
import { useToast } from '@/components/Toast';
import Skeleton from '@/components/Skeleton';
import { PartnerHeader, SearchField, FilterChips, Centered, PrimaryButton } from '@/partner/components/ui';

/**
 * The Cesto-wide reference lists a product gets filed under: categories (with
 * their subcategories and product types), brands, and origins.
 *
 * Web gives these three sidebar entries and three pages. They are folded into
 * one screen with tabs here because on a phone they are the same errand — "what
 * can I file a product under?" — and three More rows leading to three
 * near-identical read-only lists is clutter, not navigation.
 *
 * Read-only, as on web: admin curates all three and a partner picks from them
 * on the product form. Categories are the single carve-out — a partner can
 * REQUEST one, and it appears in the picker only once an admin approves it.
 *
 * Cards do not navigate. Web links each into /partner/products with a filter
 * pre-applied; the mobile products screen takes no filter params yet, and a
 * card that silently does nothing is worse than one that plainly does not
 * invite a tap. Wire these up when that screen learns to read them.
 */

const TABS = ['categories', 'brands', 'origins'] as const;
type Tab = (typeof TABS)[number];

export default function PartnerCatalogue() {
  const router = useRouter();
  const t = usePartnerT();

  const [tab, setTab] = useState<Tab>('categories');
  const [q, setQ] = useState('');

  const categories = usePartnerCategories();
  const brands = usePartnerBrands();
  const origins = usePartnerOrigins();

  const active = tab === 'categories' ? categories : tab === 'brands' ? brands : origins;
  const needle = q.trim().toLowerCase();

  const visibleCategories = useMemo(() => {
    const list = categories.data ?? [];
    if (!needle) return list;
    return list.filter((c) =>
      c.name_es.toLowerCase().includes(needle) || c.name_en.toLowerCase().includes(needle));
  }, [categories.data, needle]);

  const visibleBrands = useMemo(() => {
    const list = brands.data ?? [];
    if (!needle) return list;
    return list.filter((b) =>
      b.name.toLowerCase().includes(needle) || b.slug.toLowerCase().includes(needle));
  }, [brands.data, needle]);

  const visibleOrigins = useMemo(() => {
    const list = origins.data ?? [];
    if (!needle) return list;
    return list.filter((o) =>
      o.label_es.toLowerCase().includes(needle)
      || o.label_en.toLowerCase().includes(needle)
      || o.key.toLowerCase().includes(needle));
  }, [origins.data, needle]);

  const count = tab === 'categories'
    ? visibleCategories.length
    : tab === 'brands' ? visibleBrands.length : visibleOrigins.length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <PartnerHeader
        title={t('catalogue.title')}
        subtitle={active.data ? t('catalogue.count').replace('{{n}}', String(count)) : null}
        onBack={() => router.back()}
      >
        <SearchField
          value={q}
          onChangeText={setQ}
          placeholder={t(`catalogue.searchPlaceholder.${tab}`)}
        />
        <FilterChips
          options={TABS}
          value={tab}
          labelFor={(x) => t(`catalogue.tab.${x}`)}
          onChange={(next) => { setTab(next); setQ(''); }}
        />
      </PartnerHeader>

      {active.isError ? (
        <Centered>
          <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('catalogue.loadFailed')}</Text>
          <PrimaryButton label={t('catalogue.retry')} onPress={() => void active.refetch()} />
        </Centered>
      ) : active.isLoading ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={64} borderRadius={12} />)}
        </View>
      ) : tab === 'categories' ? (
        <CategoriesTab categories={visibleCategories} searching={!!needle} t={t} />
      ) : tab === 'brands' ? (
        <TileGrid
          data={visibleBrands.map((b) => ({
            id: b.id,
            title: b.name,
            subtitle: b.slug,
            mono: true,
            imageUrl: b.logo_url ? resolveImageUrl(b.logo_url, 'logo') : null,
            bg: b.logo_bg ?? colors.surface.cream,
            fallbackIcon: Award,
          }))}
          emptyLabel={t('catalogue.noResults')}
          refreshing={brands.isRefetching}
          onRefresh={() => void brands.refetch()}
        />
      ) : (
        <TileGrid
          data={visibleOrigins.map((o) => ({
            id: o.id,
            title: o.label_es,
            subtitle: o.label_en,
            imageUrl: o.image_url ? resolveImageUrl(o.image_url, 'tile') : null,
            bg: o.bg_color ?? colors.surface.sand,
            accent: o.accent_color ?? colors.ink,
            letter: o.label_es.charAt(0).toUpperCase(),
            fallbackIcon: Globe,
          }))}
          emptyLabel={t('catalogue.noResults')}
          refreshing={origins.isRefetching}
          onRefresh={() => void origins.refetch()}
        />
      )}
    </View>
  );
}

/* ── categories ─────────────────────────────────────────── */

function CategoriesTab({
  categories, searching, t,
}: {
  categories: PartnerCategory[];
  searching: boolean;
  t: (k: string) => string;
}) {
  const mine = usePartnerMyCategories();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 96 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'flex-start', gap: 8,
          padding: 12, borderRadius: 10, backgroundColor: colors.infoBg,
        }}>
          <Info size={15} color={colors.info} strokeWidth={1.75} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.charcoal, lineHeight: 17 }}>
            {t('catalogue.readOnlyNote')}
          </Text>
        </View>

        {(mine.data ?? []).length > 0 && (
          <MySubmissions submissions={mine.data ?? []} t={t} />
        )}

        {categories.length === 0 ? (
          <View style={{ alignItems: 'center', gap: 8, paddingVertical: 32 }}>
            <Package size={24} color={colors.muted} strokeWidth={1.75} />
            <Text style={{ fontSize: 13, color: colors.muted }}>
              {searching ? t('catalogue.noResults') : t('catalogue.noCategories')}
            </Text>
          </View>
        ) : categories.map((c) => (
          <CategoryRow
            key={c.id}
            category={c}
            expanded={expanded === c.id}
            onToggle={() => setExpanded((prev) => (prev === c.id ? null : c.id))}
            t={t}
          />
        ))}
      </ScrollView>

      <Pressable
        onPress={() => setRequesting(true)}
        style={{
          position: 'absolute', right: 20, bottom: 28,
          flexDirection: 'row', alignItems: 'center', gap: 6,
          height: 52, paddingHorizontal: 20, borderRadius: 999,
          backgroundColor: colors.brand.DEFAULT,
          shadowColor: '#0F172A', shadowOpacity: 0.2, shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 }, elevation: 5,
        }}
      >
        <Plus size={17} color="#FFFFFF" strokeWidth={2.5} />
        <Text style={{ fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' }}>
          {t('catalogue.requestCategory')}
        </Text>
      </Pressable>

      <RequestCategorySheet
        key={requesting ? 'open' : 'closed'}
        visible={requesting}
        t={t}
        onClose={() => setRequesting(false)}
      />
    </>
  );
}

/**
 * One category, expanding to its subcategories and their product types.
 * Only one is open at a time — nesting three levels in an accordion that can
 * all be open at once turns into a wall you have to scroll past.
 *
 * The subcategory query lives here rather than in the parent so it is only
 * issued for the row actually open; the hook is disabled until then.
 */
function CategoryRow({
  category, expanded, onToggle, t,
}: {
  category: PartnerCategory;
  expanded: boolean;
  onToggle: () => void;
  t: (k: string) => string;
}) {
  const subs = usePartnerSubcategories(expanded ? category.id : undefined);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const icon = category.icon_url ? resolveImageUrl(category.icon_url, 'thumb') : null;

  return (
    <View style={{
      backgroundColor: colors.surface.cream, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    }}>
      <Pressable
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 56 }}
      >
        {icon ? (
          <Image source={{ uri: icon }} style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surface.sand }} />
        ) : (
          <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand.mist }}>
            <Grid3X3 size={15} color={colors.brand.DEFAULT} strokeWidth={1.75} />
          </View>
        )}
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }} numberOfLines={1}>
            {category.name_es}
          </Text>
          <Text style={{ fontSize: 11.5, color: colors.muted }} numberOfLines={1}>{category.name_en}</Text>
        </View>
        {expanded
          ? <ChevronDown size={16} color={colors.muted} strokeWidth={2} />
          : <ChevronRight size={16} color={colors.muted} strokeWidth={2} />}
      </Pressable>

      {expanded && (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: 12, gap: 8 }}>
          {subs.isLoading ? (
            <ActivityIndicator color={colors.brand.DEFAULT} style={{ paddingVertical: 8 }} />
          ) : (subs.data ?? []).length === 0 ? (
            <Text style={{ fontSize: 12, color: colors.muted, paddingVertical: 4 }}>
              {t('catalogue.noSubcategories')}
            </Text>
          ) : (subs.data ?? []).map((sub) => (
            <SubcategoryRow
              key={sub.id}
              id={sub.id}
              nameEs={sub.name_es}
              nameEn={sub.name_en}
              expanded={openSub === sub.id}
              onToggle={() => setOpenSub((prev) => (prev === sub.id ? null : sub.id))}
              t={t}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function SubcategoryRow({
  id, nameEs, nameEn, expanded, onToggle, t,
}: {
  id: string;
  nameEs: string;
  nameEn: string;
  expanded: boolean;
  onToggle: () => void;
  t: (k: string) => string;
}) {
  const types = usePartnerProductTypes(expanded ? id : undefined);

  return (
    <View style={{ borderRadius: 10, backgroundColor: colors.surface.linen, borderWidth: 1, borderColor: colors.border }}>
      <Pressable
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 46 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.charcoal }} numberOfLines={1}>{nameEs}</Text>
          <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>{nameEn}</Text>
        </View>
        {expanded
          ? <ChevronDown size={14} color={colors.muted} strokeWidth={2} />
          : <ChevronRight size={14} color={colors.muted} strokeWidth={2} />}
      </Pressable>
      {expanded && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 6 }}>
          {types.isLoading ? (
            <ActivityIndicator color={colors.brand.DEFAULT} size="small" />
          ) : (types.data ?? []).length === 0 ? (
            <Text style={{ fontSize: 11.5, color: colors.muted }}>{t('catalogue.noProductTypes')}</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {(types.data ?? []).map((pt) => (
                <View
                  key={pt.id}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
                    backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border,
                  }}
                >
                  <Text style={{ fontSize: 11.5, color: colors.gray }}>{pt.name_es}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function MySubmissions({
  submissions, t,
}: { submissions: PartnerCategorySubmission[]; t: (k: string) => string }) {
  const dismiss = useDismissPartnerCategorySubmission();

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.muted }}>
        {t('catalogue.mySubmissions')}
      </Text>
      {submissions.map((s) => {
        const tone = s.approval_status === 'approved'
          ? { bg: colors.successBg, fg: colors.success, Icon: CheckCircle2 }
          : s.approval_status === 'rejected'
            ? { bg: colors.dangerBg, fg: colors.danger, Icon: XCircle }
            : { bg: colors.amber.mist, fg: colors.amber.deep, Icon: Clock };
        const settled = s.approval_status !== 'pending';
        return (
          <View
            key={s.id}
            style={{
              flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12,
              borderRadius: 10, backgroundColor: colors.surface.cream,
              borderWidth: 1, borderColor: colors.border,
            }}
          >
            <tone.Icon size={15} color={tone.fg} strokeWidth={2} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.ink }}>{s.name_es}</Text>
              <View style={{ alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: tone.bg }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: tone.fg }}>
                  {t(`catalogue.status.${s.approval_status}`)}
                </Text>
              </View>
              {!!s.rejection_reason && (
                <Text style={{ fontSize: 11.5, color: colors.danger, lineHeight: 16 }}>{s.rejection_reason}</Text>
              )}
            </View>
            {settled && (
              <Pressable
                onPress={() => dismiss.mutate(s.id)}
                disabled={dismiss.isPending}
                hitSlop={8}
                style={{ padding: 2 }}
              >
                <X size={15} color={colors.muted} strokeWidth={2} />
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function RequestCategorySheet({
  visible, t, onClose,
}: { visible: boolean; t: (k: string) => string; onClose: () => void }) {
  const create = useCreatePartnerCategory();
  const toast = useToast();
  const [nameEs, setNameEs] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!nameEs.trim() || !nameEn.trim()) { setError(t('catalogue.requestNeedNames')); return; }
    setError(null);
    create.mutate({ name_es: nameEs.trim(), name_en: nameEn.trim() }, {
      onSuccess: () => { toast.success(t('catalogue.requestSent')); onClose(); },
      onError: (err: unknown) => setError(
        err instanceof Error && err.message ? err.message : t('catalogue.requestFailed'),
      ),
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{
          backgroundColor: colors.surface.cream,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: 20, paddingBottom: 32, gap: 14,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{t('catalogue.requestTitle')}</Text>
            <Pressable onPress={onClose} hitSlop={10}><X size={19} color={colors.muted} strokeWidth={2} /></Pressable>
          </View>
          <Text style={{ fontSize: 12.5, color: colors.muted, lineHeight: 17 }}>{t('catalogue.requestHint')}</Text>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.gray }}>{t('catalogue.requestNameEs')}</Text>
            <SheetInput value={nameEs} onChangeText={setNameEs} />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.gray }}>{t('catalogue.requestNameEn')}</Text>
            <SheetInput value={nameEn} onChangeText={setNameEn} />
          </View>

          {error && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.dangerBg }}>
              <AlertTriangle size={15} color={colors.danger} strokeWidth={2} />
              <Text style={{ flex: 1, fontSize: 12.5, color: colors.danger }}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={submit}
            disabled={create.isPending}
            style={{
              minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: create.isPending ? colors.brand.light : colors.brand.DEFAULT,
            }}
          >
            {create.isPending
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>{t('catalogue.requestSubmit')}</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetInput({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 10,
        paddingHorizontal: 12, minHeight: 46,
        fontSize: 14, color: colors.ink, backgroundColor: colors.surface.linen,
      }}
    />
  );
}

/* ── brands + origins ───────────────────────────────────── */

interface Tile {
  id: string;
  title: string;
  subtitle: string;
  mono?: boolean;
  imageUrl: string | null;
  bg: string;
  accent?: string;
  letter?: string;
  fallbackIcon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
}

function TileGrid({
  data, emptyLabel, refreshing, onRefresh,
}: {
  data: Tile[];
  emptyLabel: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  if (data.length === 0) {
    return (
      <Centered>
        <Package size={24} color={colors.muted} strokeWidth={1.75} />
        <Text style={{ fontSize: 13, color: colors.muted }}>{emptyLabel}</Text>
      </Centered>
    );
  }

  return (
    <FlatList
      data={data}
      keyExtractor={(x) => x.id}
      numColumns={2}
      columnWrapperStyle={{ gap: 10 }}
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.DEFAULT} />
      }
      renderItem={({ item }) => (
        <View style={{
          flex: 1, borderRadius: 12, overflow: 'hidden',
          backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border,
        }}>
          <View style={{
            aspectRatio: 4 / 3, alignItems: 'center', justifyContent: 'center', padding: 14,
            backgroundColor: item.bg,
          }}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            ) : item.letter ? (
              <Text style={{ fontSize: 28, fontWeight: '700', color: item.accent ?? colors.ink, opacity: 0.8 }}>
                {item.letter}
              </Text>
            ) : (
              <item.fallbackIcon size={28} color={colors.muted} strokeWidth={1.5} />
            )}
          </View>
          <View style={{ paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, gap: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }} numberOfLines={1}>{item.title}</Text>
            <Text
              style={{
                fontSize: 10.5, color: colors.muted,
                fontFamily: item.mono ? 'JetBrainsMono' : undefined,
              }}
              numberOfLines={1}
            >
              {item.subtitle}
            </Text>
          </View>
        </View>
      )}
    />
  );
}
