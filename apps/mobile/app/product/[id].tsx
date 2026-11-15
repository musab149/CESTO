import {
  View, Text, Pressable, Image, FlatList, ScrollView, Dimensions, ActivityIndicator,
  TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft, Plus, Minus, ChevronDown, ChevronUp, ChevronRight,
  Heart, Share2, Check, Star, Truck, RotateCcw, ShieldCheck, MapPin, Clock, Trash2, ArrowRight, AlertCircle,
  FileText, LogIn,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useValidationMessages } from '../../src/lib/validation/messages';
import { rules } from '../../src/lib/validation/rules';
import {
  useProduct, useCategories, useFeaturedProducts, resolveImageUrl,
  useTopShops, defaultTopShops, resolveShop, CESTO_SHOP, ApiError,
} from '@grocery-app/shared';
import type { TopShop } from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { shopForProduct } from '../../src/lib/shopForProduct';
import { useLanguageStore } from '../../src/stores/languageStore';
import { useCartStore } from '../../src/stores/cartStore';
import { useFavoritesStore } from '../../src/stores/favoritesStore';
import { useReviewsFor, useWriteReview, type Review } from '../../src/lib/reviews';
import StarRow from '../../src/components/StarRow';
import ReviewRow from '../../src/components/ReviewRow';
import { useAuthStore } from '../../src/stores/authStore';
import { useToast } from '../../src/components/Toast';
import ProductCard from '../../src/components/ProductCard';
import { usePriceTone, useIsB2bPricing } from '../../src/lib/priceTone';
import QuotationRequestModal from '../../src/components/QuotationRequestModal';
import AppDialog, { type DialogTone, type AppDialogAction } from '../../src/components/AppDialog';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/* ───────── Reusable atoms ───────── */
function PriceTag({ value, color }: { value: number; color: string }) {
  const [whole, cents] = value.toFixed(2).split('.');
  return (
    <Text style={{ color, fontWeight: '800', letterSpacing: -0.5 }}>
      <Text style={{ fontSize: 16 }}>€</Text>
      <Text style={{ fontSize: 34 }}>{whole}</Text>
      <Text style={{ fontSize: 16 }}>.{cents}</Text>
    </Text>
  );
}

function formatShopCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

function isHexBgDark(hex: string): boolean {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return false;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
}

/** "Sold by" card shown in the buy box — mirrors web ProductShopCard. */
function ProductShopCard({ shop, lang, onPress }: { shop: TopShop; lang: 'en' | 'es'; onPress?: () => void }) {
  // Cesto's logo is a web-app static asset, not API-hosted, so it bypasses
  // resolveImageUrl which would prefix it with the API base URL. On mobile
  // it won't resolve to a fetchable URI — fall back to a letter avatar.
  const isCesto = shop.id === CESTO_SHOP.id;
  const logoSrc = !isCesto && shop.logo_url ? resolveImageUrl(shop.logo_url, 'logo') : null;
  const onDarkBg = isHexBgDark(shop.logo_bg);
  const initial = (shop.name?.trim()?.[0] || '?').toUpperCase();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14,
        padding: 12, borderRadius: 16,
        borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
        backgroundColor: pressed && onPress ? colors.surface.linen : '#fff',
      })}
    >
      <View style={{
        width: 56, height: 56, borderRadius: 12,
        backgroundColor: shop.logo_bg,
        alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {logoSrc ? (
          <Image
            source={{ uri: logoSrc }}
            style={{ width: 56, height: 56 }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{
            fontSize: 22, fontWeight: '800',
            color: onDarkBg ? '#fff' : colors.brand.deepest,
            letterSpacing: -0.5,
          }}>
            {initial}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 }} numberOfLines={1}>
          {shop.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {shop.rating_count > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Star size={12} color={colors.amber.deep} fill={colors.amber.deep} strokeWidth={2} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>{shop.rating.toFixed(1)}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>({formatShopCount(shop.rating_count)})</Text>
            </View>
          )}
          {shop.fast_delivery && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Truck size={12} color={colors.success} strokeWidth={2} />
              <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.success }}>
                {lang === 'en' ? 'Fast' : 'Rápido'}
              </Text>
            </View>
          )}
        </View>
      </View>
      <View style={{
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: colors.surface.linen,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <ChevronRight size={16} color={colors.ink} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

/* ───────── PAGE ───────── */
export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { lang, t } = useLanguageStore();
  const toast = useToast();

  const { data: product, isLoading } = useProduct(id);
  const { data: categories } = useCategories();
  const { data: featured } = useFeaturedProducts(20);
  const { data: shopsData } = useTopShops();
  const category = categories?.find((c) => c.id === product?.category_id);
  const shops = (shopsData ?? defaultTopShops).shops;
  const productShop = product ? shopForProduct(product, resolveShop(product.shop_id, shops)) : null;

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [fulfilment, setFulfilment] = useState<'delivery' | 'pickup'>('delivery');
  const [openSpecs, setOpenSpecs] = useState(true);
  const [descExpanded, setDescExpanded] = useState(true);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [reviewNotice, setReviewNotice] = useState<{
    title: string; message: string; tone: DialogTone;
    icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
    actions: AppDialogAction[];
  } | null>(null);

  const addItem = useCartStore((s) => s.addItem);
  const removeItem = useCartStore((s) => s.removeItem);
  const updateQty = useCartStore((s) => s.updateQuantity);
  // Subscribe to the cart items themselves so the buy box re-renders when
  // anything changes. Selecting the getter function alone returns a stable
  // reference and the screen would never reflect cart updates.
  const cartItems = useCartStore((s) => s.items);
  const isFavorite = useFavoritesStore((s) => (id ? s.productIds.includes(id) : false));
  const toggleFavorite = useFavoritesStore((s) => s.toggle);

  // Real, verified-purchase reviews. This used to merge device-local rows with
  // five invented reviewers seeded onto every product.
  const {
    reviews, stats: reviewStats, mine: myReview,
    canReview, isAuthenticated: reviewerSignedIn,
  } = useReviewsFor(product?.id);
  /**
   * The one way into the review form.
   *
   * `canReview` was already being computed here and then ignored, so both
   * entry points opened the form for anyone — and the server rejected most of
   * them with a 403 the customer never saw. Refusing up front, in their own
   * language, beats letting them write a review and then explaining it cannot
   * be posted. ReviewFormModal still handles a 403 as a backstop, for the
   * cases this cannot know about (eligibility gone stale, a race).
   */
  function openReviewForm(existingReview: Review | null) {
    // An edit is always allowed: it is their own review, already accepted.
    if (existingReview) {
      setEditingReview(existingReview);
      setReviewModalOpen(true);
      return;
    }
    if (!reviewerSignedIn) {
      setReviewNotice({
        tone: 'brand',
        icon: LogIn,
        title: lang === 'en' ? 'Sign in to review' : 'Inicia sesión para opinar',
        message: lang === 'en'
          ? 'You need an account to write a review.'
          : 'Necesitas una cuenta para escribir una reseña.',
        actions: [
          { label: lang === 'en' ? 'Not now' : 'Ahora no', variant: 'secondary', onPress: () => setReviewNotice(null) },
          {
            label: lang === 'en' ? 'Sign in' : 'Iniciar sesión',
            onPress: () => { setReviewNotice(null); router.push('/(auth)/login' as never); },
          },
        ],
      });
      return;
    }
    if (!canReview) {
      setReviewNotice({
        tone: 'warning',
        icon: Truck,
        title: lang === 'en' ? 'Not yet' : 'Todavía no',
        message: lang === 'en'
          ? 'You can review this product once an order containing it has been delivered to you.'
          : 'Podrás opinar sobre este producto cuando recibas un pedido que lo incluya.',
        actions: [{ label: lang === 'en' ? 'OK' : 'Entendido', onPress: () => setReviewNotice(null) }],
      });
      return;
    }
    setEditingReview(null);
    setReviewModalOpen(true);
  }

  const ratingMeta = useMemo(() => {
    if (reviews.length === 0) return { rating: 0, count: 0, dist: [0, 0, 0, 0, 0] as [number, number, number, number, number] };
    const dist: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    let sum = 0;
    for (const r of reviews) { dist[r.rating - 1]++; sum += r.rating; }
    return { rating: +(sum / reviews.length).toFixed(1), count: reviews.length, dist };
  }, [reviews]);

  const relatedProducts = useMemo(() => {
    if (!featured || !product) return [];
    return featured.filter((p) => p.id !== product.id).slice(0, 6);
  }, [featured, product]);

  // The server already swaps b2b_price into `price` for a wholesale customer,
  // so the number is right either way — what these add is the tint that says
  // WHICH catalogue it came from. The grid and the categories tab tint it; the
  // detail screen did not, so opening an item from a blue grid showed a black
  // price. Same rule web's detail page uses.
  //
  // Must stay ABOVE the early returns below. They used to sit further down,
  // next to the price maths they feed, which meant a cold open rendered the
  // loading branch with two fewer hooks than the loaded one — "Rendered more
  // hooks than during the previous render", and a crashed screen. It only
  // showed on a product that was not already in the query cache, which is why
  // arriving from a grid looked fine and arriving from search did not.
  const priceTone = usePriceTone();
  const isB2b = useIsB2bPricing();

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.brand.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (!product) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>😕</Text>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 6 }}>{t('detail.not_found')}</Text>
        <Text style={{ fontSize: 13, color: colors.gray, textAlign: 'center', marginBottom: 24 }}>{t('detail.not_found_desc')}</Text>
        <Pressable onPress={() => router.push('/')} style={{ height: 44, paddingHorizontal: 24, borderRadius: 999, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>{t('detail.back_home')}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const variants = product.variants ?? [];
  const images = product.images ?? [];
  const defaultVariant = variants.find((x) => x.is_default) ?? variants[0];
  const variant = variants.find((vr) => vr.id === (selectedVariantId ?? defaultVariant?.id)) ?? defaultVariant;

  if (!variant) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 16, color: colors.muted }}>This product has no variants.</Text>
      </SafeAreaView>
    );
  }

  const name = lang === 'es' ? product.name_es : product.name_en;
  const description = lang === 'es' ? product.description_es : product.description_en;
  const variantName = (v: { name_en: string; name_es: string }) => (lang === 'en' ? v.name_en : v.name_es);
  const catName = (c: { name_en: string; name_es: string }) => (lang === 'en' ? c.name_en : c.name_es);

  const cartQty = cartItems.find((i) => i.variantId === variant.id)?.quantity ?? 0;
  const inCart = cartQty > 0;
  const price = Number(variant.price);
  const compareAt = variant.compare_at_price != null ? Number(variant.compare_at_price) : null;
  const hasDiscount = compareAt != null;
  const discountPct = hasDiscount ? Math.round((1 - price / compareAt!) * 100) : 0;
  const isOutOfStock = variant.stock_quantity === 0;
  const isLowStock = variant.stock_quantity > 0 && variant.stock_quantity <= variant.low_stock_threshold;

  const handleAdd = () => {
    if (isOutOfStock || !variant) return;
    const primaryImage = images.find((i) => i.is_primary) ?? images[0];
    for (let i = 0; i < qty; i++) {
      addItem({
        productId: product.id,
        variantId: variant.id,
        name_es: product.name_es,
        name_en: product.name_en,
        variantName_es: variant.name_es,
        variantName_en: variant.name_en,
        price,
        compare_at_price: compareAt,
        image: primaryImage?.url ?? '',
        maxStock: variant.stock_quantity,
      });
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* ───── Image carousel + back + heart + discount ───── */}
        <View style={{ position: 'relative', backgroundColor: '#fff' }}>
          <FlatList
            data={images}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setActiveImageIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
            keyExtractor={(item, i) => `${item.url}-${i}`}
            renderItem={({ item }) => (
              <View style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 0.78, backgroundColor: '#fff' }}>
                <Image source={{ uri: resolveImageUrl(item.url, 'hero') }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              </View>
            )}
            ListEmptyComponent={
              <View style={{ width: SCREEN_WIDTH, height: SCREEN_WIDTH * 0.78, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontSize: 96, opacity: 0.2 }}>🛒</Text>
              </View>
            }
          />

          {/* Top chrome */}
          <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0 }} edges={['top']}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
              <Pressable
                onPress={() => router.back()}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border, shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}
              >
                <ArrowLeft size={18} color={colors.ink} strokeWidth={2} />
              </Pressable>
              <Pressable
                onPress={() => toggleFavorite(product.id)}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border, shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 2 }}
              >
                <Heart
                  size={18}
                  strokeWidth={1.75}
                  color={isFavorite ? colors.danger : 'rgba(15,23,42,0.55)'}
                  fill={isFavorite ? colors.danger : 'transparent'}
                />
              </Pressable>
            </View>
          </SafeAreaView>

          {/* Discount badge — anchored bottom-left of the image to avoid the
              back button at the top, with enough clearance above the pagination
              dots (which sit bottom-center). */}
          {hasDiscount && (
            <View style={{ position: 'absolute', bottom: 14, left: 16, backgroundColor: colors.danger, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 1, textTransform: 'uppercase' }}>
                −{discountPct}%
              </Text>
            </View>
          )}

          {/* Pagination dots */}
          {images.length > 1 && (
            <View style={{ position: 'absolute', bottom: 16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
              {images.map((_, i) => (
                <View key={i} style={{ width: i === activeImageIndex ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === activeImageIndex ? colors.brand.deepest : 'rgba(15,23,42,0.25)' }} />
              ))}
            </View>
          )}
        </View>

        {/* ───── Product info ───── */}
        <View style={{ padding: 20, gap: 14 }}>
          {/* Name + brand chip (right-aligned) */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Text style={{ flex: 1, fontSize: 22, fontWeight: '600', color: colors.ink, letterSpacing: -0.5, lineHeight: 27 }}>
              {name}
            </Text>
            {product.brand && (
              <View style={{
                marginTop: 4,
                paddingHorizontal: 9, paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: colors.brand.mist,
                borderWidth: 1, borderColor: colors.brand.soft + '70',
              }}>
                <Text style={{ fontSize: 10.5, fontWeight: '800', color: colors.brand.deepest, letterSpacing: 1.2, textTransform: 'uppercase' }}>
                  {product.brand}
                </Text>
              </View>
            )}
          </View>

          {/* Rating row + share */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <StarRow rating={ratingMeta.count > 0 ? ratingMeta.rating : 0} size={14} />
            {ratingMeta.count > 0 ? (
              <>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>{ratingMeta.rating.toFixed(1)}</Text>
                <Text style={{ fontSize: 12.5, color: colors.brand.DEFAULT }}>
                  ({ratingMeta.count} {t('detail.reviews')})
                </Text>
              </>
            ) : (
              <Pressable onPress={() => openReviewForm(null)}>
                <Text style={{ fontSize: 12.5, color: colors.brand.DEFAULT }}>
                  {lang === 'en' ? 'Be the first to review' : 'Sé el primero en opinar'}
                </Text>
              </Pressable>
            )}
            <Text style={{ fontSize: 12.5, color: colors.muted }}>·</Text>
            <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Share2 size={12} color={colors.muted} strokeWidth={2} />
              <Text style={{ fontSize: 12.5, color: colors.muted }}>{lang === 'en' ? 'Share' : 'Compartir'}</Text>
            </Pressable>
          </View>

          {/* Hassle-free / Bestseller / Origin chips */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.successBg }}>
              <Check size={11} color={colors.success} strokeWidth={2.5} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.success }}>
                {lang === 'en' ? 'Hassle-free returns' : 'Devoluciones fáciles'}
              </Text>
            </View>
            {product.is_featured && (
              <View style={{ height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center' }}>
                <Text style={{ fontSize: 10.5, fontWeight: '800', color: '#fff', letterSpacing: 1, textTransform: 'uppercase' }}>
                  {lang === 'en' ? 'Bestseller' : 'Top'}
                </Text>
              </View>
            )}
            {product.origin && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 12 }}>🌍</Text>
                <Text style={{ fontSize: 11.5, fontWeight: '600', color: 'rgba(15,23,42,0.7)' }}>{product.origin}</Text>
              </View>
            )}
          </View>

          {/* Meta line */}
          {category && (
            <Text style={{ fontSize: 12.5, color: 'rgba(15,23,42,0.7)', lineHeight: 18 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{lang === 'en' ? 'Category' : 'Categoría'}: </Text>
              {catName(category)}
              {variant && (
                <>
                  {' · '}
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{lang === 'en' ? 'Item type' : 'Tipo'}: </Text>
                  {variantName(variant)}
                </>
              )}
              {variant?.sku ? (
                <>
                  {' · '}
                  <Text style={{ fontWeight: '700', color: colors.ink }}>SKU: </Text>
                  <Text style={{ fontFamily: 'monospace' }}>{variant.sku}</Text>
                </>
              ) : null}
            </Text>
          )}

          {/* Variant selector */}
          {variants.length > 1 && (
            <View style={{ paddingTop: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink, marginBottom: 8 }}>
                {t('detail.size_variant')}:{' '}
                <Text style={{ fontWeight: '600', color: 'rgba(15,23,42,0.7)' }}>{variant ? variantName(variant) : ''}</Text>
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {variants.map((v) => {
                  const selected = v.id === variant.id;
                  const out = v.stock_quantity === 0;
                  return (
                    <Pressable
                      key={v.id}
                      onPress={() => !out && setSelectedVariantId(v.id)}
                      disabled={out}
                      style={{
                        position: 'relative',
                        minWidth: 110,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 12,
                        borderWidth: 2,
                        borderColor: selected ? colors.brand.DEFAULT : out ? 'rgba(226,232,240,0.4)' : colors.border,
                        backgroundColor: selected ? '#DCE6FD66' : '#fff',
                        opacity: out ? 0.5 : 1,
                      }}
                    >
                      <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.ink }}>{variantName(v)}</Text>
                      <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.success, marginTop: 2 }}>
                        €{Number(v.price).toFixed(2)}
                      </Text>
                      {selected && (
                        <View style={{ position: 'absolute', top: -8, right: -8, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}>
                          <Check size={10} color="#fff" strokeWidth={3} />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* Description */}
          <View style={{ marginTop: 6, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(226,232,240,0.6)' }}>
            <Pressable onPress={() => setDescExpanded(!descExpanded)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 }}>{t('detail.description')}</Text>
              {descExpanded ? <ChevronUp size={16} color="rgba(15,23,42,0.6)" /> : <ChevronDown size={16} color="rgba(15,23,42,0.6)" />}
            </Pressable>
            {descExpanded && (
              <Text style={{ fontSize: 13.5, color: 'rgba(15,23,42,0.8)', lineHeight: 20 }}>
                {description || (lang === 'en' ? 'No description available for this product.' : 'No hay descripción disponible para este producto.')}
              </Text>
            )}
          </View>

          {/* Specifications */}
          <View style={{ paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(226,232,240,0.6)' }}>
            <Pressable onPress={() => setOpenSpecs(!openSpecs)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 }}>
                {lang === 'en' ? 'Specifications' : 'Especificaciones'}
              </Text>
              {openSpecs ? <ChevronUp size={16} color="rgba(15,23,42,0.6)" /> : <ChevronDown size={16} color="rgba(15,23,42,0.6)" />}
            </Pressable>
            {openSpecs && (
              <View style={{ gap: 2 }}>
                {product.brand && <SpecRow label={lang === 'en' ? 'Brand' : 'Marca'} value={product.brand} />}
                {product.origin && <SpecRow label={t('detail.origin')} value={product.origin} />}
                {category && <SpecRow label={lang === 'en' ? 'Category' : 'Categoría'} value={catName(category)} />}
                {variant && <SpecRow label={lang === 'en' ? 'Selected size' : 'Tamaño'} value={variantName(variant)} />}
                {variant?.sku && <SpecRow label="SKU" value={variant.sku} mono />}
                <SpecRow label={lang === 'en' ? 'Variants' : 'Variantes'} value={String(variants.length)} />
              </View>
            )}
          </View>

          {/* Stock + quantity strip — price lives on the sticky bottom CTA, so
              the pricing card it used to share with these controls was just
              duplicating the same numbers. Stock state and the quantity
              selector are the only buy-box bits the CTA doesn't cover. */}
          <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6 }}>
            <View style={{ flex: 1 }}>
              {isOutOfStock ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted }} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted }}>{t('product.out_of_stock')}</Text>
                </View>
              ) : isLowStock ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.amber.deep }} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.amber.deep }}>
                    {t('product.low_stock')} — {variant.stock_quantity} {t('detail.low_stock_left')}
                  </Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Check size={13} color={colors.success} strokeWidth={3} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.success }}>{t('detail.in_stock')}</Text>
                </View>
              )}
            </View>

            {!isOutOfStock && (
              <View style={{ flexDirection: 'row', alignItems: 'center', height: 38, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', backgroundColor: '#fff', overflow: 'hidden' }}>
                <Pressable onPress={() => setQty((q) => Math.max(1, q - 1))} style={{ width: 38, height: 38, justifyContent: 'center', alignItems: 'center' }}>
                  <Minus size={14} color={colors.ink} strokeWidth={2.5} />
                </Pressable>
                <Text style={{ paddingHorizontal: 12, fontFamily: 'monospace', fontSize: 14, fontWeight: '700', minWidth: 32, textAlign: 'center', color: colors.ink }}>{qty}</Text>
                <Pressable
                  onPress={() => setQty((q) => Math.min(variant.stock_quantity, q + 1))}
                  disabled={qty >= variant.stock_quantity}
                  style={{ width: 38, height: 38, justifyContent: 'center', alignItems: 'center', opacity: qty >= variant.stock_quantity ? 0.3 : 1 }}
                >
                  <Plus size={14} color={colors.ink} strokeWidth={2.5} />
                </Pressable>
              </View>
            )}
          </View>

          {/* Fulfilment toggle */}
          <View style={{ marginTop: 4, padding: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 8, gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([
                { key: 'delivery', label_en: 'Delivery', label_es: 'Entrega', Icon: Truck },
                { key: 'pickup', label_en: 'Pickup', label_es: 'Recogida', Icon: MapPin },
              ] as const).map((opt) => {
                const active = fulfilment === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setFulfilment(opt.key)}
                    style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
                      paddingHorizontal: 12, paddingVertical: 10,
                      borderRadius: 12, borderWidth: 2,
                      borderColor: active ? colors.brand.DEFAULT : colors.border,
                      backgroundColor: active ? '#DCE6FD66' : '#fff',
                    }}
                  >
                    <opt.Icon size={14} color={colors.ink} strokeWidth={1.75} />
                    <View style={{ flexShrink: 1 }}>
                      <Text style={{ fontSize: 10.5, fontWeight: '700', color: 'rgba(15,23,42,0.7)' }}>
                        {active ? (lang === 'en' ? 'Selected' : 'Seleccionado') : (lang === 'en' ? 'Available' : 'Disponible')}
                      </Text>
                      <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.ink }}>
                        {lang === 'en' ? opt.label_en : opt.label_es}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
              <Clock size={13} color={colors.success} strokeWidth={1.75} style={{ marginTop: 2 }} />
              <Text style={{ flex: 1, fontSize: 12, color: 'rgba(15,23,42,0.75)' }}>
                {fulfilment === 'delivery'
                  ? (lang === 'en' ? 'Delivered to your address' : 'Entrega en tu dirección')
                  : (lang === 'en' ? 'Ready at your selected point' : 'Listo en tu punto elegido')}
              </Text>
            </View>
            {/* Removed: a hardcoded "Madrid Centro · 28004", shown to every
                customer whatever their address, in a business that delivers
                across Spain. */}

            {/* Trust strip */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(226,232,240,0.6)' }}>
              {[
                // "Secure pay" implied an online payment this app never takes.
                // The free-delivery tile went on 2026-09-25 with the feature.
                { Icon: RotateCcw, label_en: 'Easy returns', label_es: 'Devoluciones' },
                { Icon: ShieldCheck, label_en: 'Pay on delivery', label_es: 'Pago al recibir' },
              ].map((it, i) => (
                <View key={i} style={{ alignItems: 'center', gap: 4, flex: 1 }}>
                  <it.Icon size={15} color="rgba(15,23,42,0.55)" strokeWidth={1.75} />
                  <Text style={{ fontSize: 9.5, fontWeight: '700', color: 'rgba(15,23,42,0.65)', letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center' }}>
                    {lang === 'en' ? it.label_en : it.label_es}
                  </Text>
                </View>
              ))}
            </View>

            {/* Sold by — single shop card mirroring web's ProductShopCard. */}
            {productShop && (
              <View style={{ paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(226,232,240,0.6)', gap: 8 }}>
                <Text style={{ fontSize: 10.5, fontWeight: '700', color: 'rgba(15,23,42,0.55)', letterSpacing: 1.4, textTransform: 'uppercase' }}>
                  {lang === 'en' ? 'Sold by' : 'Vendido por'}
                </Text>
                <ProductShopCard
                  shop={productShop}
                  lang={lang}
                  // shopForProduct sets `id` to the Store slug when the product
                  // carries its store relation, so this is a real route. Cesto
                  // Shop is the exception: it is a virtual identity with no
                  // Store row, so it stays unlinked rather than 404ing.
                  onPress={
                    productShop.id === CESTO_SHOP.id
                      ? undefined
                      : () => router.push({ pathname: '/store/[slug]', params: { slug: productShop.id } })
                  }
                />
              </View>
            )}
          </View>
        </View>

        {/* You might also like */}
        {relatedProducts.length > 0 && (
          <View style={{ marginTop: 8, paddingBottom: 12 }}>
            <Text style={{ paddingHorizontal: 20, fontSize: 20, fontWeight: '600', color: colors.ink, letterSpacing: -0.5, marginBottom: 12 }}>
              {lang === 'en' ? 'You might also like' : 'Quizás también te guste'}
            </Text>
            <FlatList
              data={relatedProducts}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={{ width: 160 }}>
                  <ProductCard product={item} />
                </View>
              )}
            />
          </View>
        )}

        {/* Customer reviews */}
        <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
          <Text style={{ fontSize: 22, fontWeight: '600', color: colors.ink, letterSpacing: -0.5, marginBottom: 14 }}>
            {lang === 'en' ? 'Customer ratings & reviews' : 'Valoraciones y opiniones'}
          </Text>

          {/* Summary card */}
          <View style={{ padding: 16, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 10.5, fontWeight: '700', color: colors.muted, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              {lang === 'en' ? 'Overall' : 'En conjunto'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <Text style={{ fontSize: 38, fontWeight: '600', color: colors.ink, letterSpacing: -1 }}>
                {ratingMeta.count > 0 ? ratingMeta.rating.toFixed(1) : '—'}
              </Text>
              <Text style={{ fontSize: 14, color: colors.muted }}>/ 5</Text>
            </View>
            <StarRow rating={ratingMeta.count > 0 ? ratingMeta.rating : 0} size={16} />
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>
              {ratingMeta.count > 0
                ? `${ratingMeta.count} ${lang === 'en' ? (ratingMeta.count === 1 ? 'review' : 'reviews') : (ratingMeta.count === 1 ? 'reseña' : 'reseñas')}`
                : (lang === 'en' ? 'No reviews yet' : 'Aún sin reseñas')}
            </Text>

            {/* Distribution bars */}
            <View style={{ marginTop: 14, gap: 6 }}>
              {[5, 4, 3, 2, 1].map((stars) => {
                const value = ratingMeta.dist[stars - 1] ?? 0;
                const max = Math.max(...ratingMeta.dist, 1);
                const pct = ratingMeta.count > 0 ? Math.round((value / max) * 100) : 0;
                return (
                  <View key={stars} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontFamily: 'monospace', fontSize: 10.5, color: 'rgba(15,23,42,0.7)', width: 24 }}>{stars}★</Text>
                    <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surface.sand, overflow: 'hidden' }}>
                      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: colors.amber.deep }} />
                    </View>
                    <Text style={{ fontFamily: 'monospace', fontSize: 10.5, color: colors.muted, width: 24, textAlign: 'right' }}>{value}</Text>
                  </View>
                );
              })}
            </View>

            <Pressable
              onPress={() => openReviewForm(null)}
              style={({ pressed }) => ({
                marginTop: 16, height: 40, borderRadius: 999,
                backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
                justifyContent: 'center', alignItems: 'center',
              })}
            >
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#fff' }}>
                {lang === 'en' ? 'Write a review' : 'Escribir una reseña'}
              </Text>
            </Pressable>
          </View>

          {/* Reviews list / empty state */}
          {reviews.length === 0 ? (
            <View style={{ marginTop: 12, padding: 24, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
              <Text style={{ fontSize: 28, marginBottom: 8 }}>✍️</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 4 }}>
                {lang === 'en' ? 'No reviews yet' : 'Aún no hay reseñas'}
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 17 }}>
                {lang === 'en'
                  ? 'Be the first to share what you think.'
                  : 'Sé el primero en compartir tu opinión.'}
              </Text>
            </View>
          ) : (
            <View style={{
              marginTop: 12,
              backgroundColor: '#fff',
              borderRadius: 14,
              borderWidth: 1,
              borderColor: 'rgba(226,232,240,0.7)',
              overflow: 'hidden',
            }}>
              {reviews.slice(0, 3).map((r, idx) => (
                <View key={r.id}>
                  {idx > 0 && (
                    <View style={{ height: 1, marginHorizontal: 16, backgroundColor: 'rgba(226,232,240,0.7)' }} />
                  )}
                  <ReviewRow
                    review={r}
                    onEdit={() => openReviewForm(r)}
                  />
                </View>
              ))}
              {reviews.length > 3 && (
                <>
                  <View style={{ height: 1, marginHorizontal: 16, backgroundColor: 'rgba(226,232,240,0.7)' }} />
                  <Pressable
                    onPress={() => router.push(`/reviews/${product.id}` as never)}
                    style={({ pressed }) => ({
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                      paddingVertical: 14,
                      backgroundColor: pressed ? colors.surface.linen : '#fff',
                    })}
                  >
                    <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.brand.deepest }}>
                      {lang === 'en'
                        ? `See all ${reviews.length} reviews`
                        : `Ver las ${reviews.length} reseñas`}
                    </Text>
                    <ChevronRight size={15} color={colors.brand.deepest} strokeWidth={2.25} />
                  </Pressable>
                </>
              )}
            </View>
          )}
        </View>

        {/* Products related to this item (second row) */}
        {relatedProducts.length > 0 && (
          <View style={{ marginTop: 24, paddingBottom: 24 }}>
            <Text style={{ paddingHorizontal: 20, fontSize: 20, fontWeight: '600', color: colors.ink, letterSpacing: -0.5, marginBottom: 12 }}>
              {lang === 'en' ? 'Products related to this item' : 'Productos relacionados'}
            </Text>
            <FlatList
              data={[...relatedProducts].reverse()}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={{ width: 160 }}>
                  <ProductCard product={item} />
                </View>
              )}
            />
          </View>
        )}
      </ScrollView>

      {/* ───── Sticky bottom CTA ───── */}
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 10.5, fontWeight: '700', color: colors.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
              {hasDiscount ? (lang === 'en' ? 'Now' : 'Ahora') : (lang === 'en' ? 'Price' : 'Precio')}
            </Text>
            {/* Retail only colours a discounted price. Wholesale always
                colours, because the blue is the signal for which catalogue the
                number came from — true whether or not it is also on offer. */}
            <Text style={{ fontSize: 22, fontWeight: '800', color: isB2b ? priceTone : hasDiscount ? colors.success : colors.ink, letterSpacing: -0.5 }}>
              €{price.toFixed(2)}
            </Text>
          </View>

          {isOutOfStock ? (
            <View style={{ height: 48, borderRadius: 999, backgroundColor: colors.surface.sand, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted }}>{t('product.out_of_stock')}</Text>
            </View>
          ) : inCart ? (
            <Pressable
              onPress={() => removeItem(variant.id)}
              style={({ pressed }) => ({
                height: 48, paddingHorizontal: 20, borderRadius: 999,
                borderWidth: 1, borderColor: colors.danger,
                backgroundColor: pressed ? colors.danger : colors.dangerBg,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              })}
            >
              <Trash2 size={14} color={colors.danger} strokeWidth={2.25} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.danger }}>
                {lang === 'en' ? `Remove · ${cartQty}` : `Quitar · ${cartQty}`}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={handleAdd}
              style={({ pressed }) => ({
                height: 48, paddingHorizontal: 24, borderRadius: 999,
                backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              })}
            >
              <Plus size={15} color="#fff" strokeWidth={2.5} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>{t('product.add')}</Text>
            </Pressable>
          )}
        </View>

        {/* Request a quotation — admin-curated per product, and deliberately
            open to signed-out visitors: it is a sales enquiry, not an order.
            Sits above the cart row because for these lines it IS the action;
            adding to cart is the secondary path. */}
        {product.is_quotation_enabled && (
          <View style={{ paddingHorizontal: 20, paddingBottom: 12, marginTop: -4 }}>
            <Pressable
              onPress={() => setQuoteModalOpen(true)}
              style={({ pressed }) => ({
                height: 44,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.brand.DEFAULT,
                backgroundColor: pressed ? colors.brand.mist : '#fff',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              })}
            >
              <FileText size={15} color={colors.brand.DEFAULT} strokeWidth={2} />
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand.DEFAULT }}>
                {lang === 'en' ? 'Get Quotation' : 'Solicitar cotización'}
              </Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>

      <QuotationRequestModal
        open={quoteModalOpen}
        onClose={() => setQuoteModalOpen(false)}
        product={{ id: product.id, name }}
        initialQuantity={qty}
      />

      {reviewNotice && (
        <AppDialog
          visible
          tone={reviewNotice.tone}
          icon={reviewNotice.icon}
          title={reviewNotice.title}
          message={reviewNotice.message}
          actions={reviewNotice.actions}
          onDismiss={() => setReviewNotice(null)}
        />
      )}

      {/* Review form modal */}
      {reviewModalOpen && (
        <ReviewFormModal
          productId={product.id}
          productName={name}
          existing={editingReview ?? undefined}
          onClose={() => { setReviewModalOpen(false); setEditingReview(null); }}
          onSubmitted={(wasEdit) => {
            toast.success(
              wasEdit
                ? (lang === 'en' ? 'Review updated' : 'Reseña actualizada')
                : (lang === 'en' ? 'Review posted' : 'Reseña publicada'),
              wasEdit
                ? (lang === 'en' ? 'Your changes are saved.' : 'Tus cambios se han guardado.')
                : (lang === 'en' ? 'Thanks for sharing.' : 'Gracias por compartir.'),
            );
            setReviewModalOpen(false);
            setEditingReview(null);
          }}
        />
      )}
    </View>
  );
}

/* ───────── Helpers ───────── */
function SpecRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(226,232,240,0.4)' }}>
      <Text style={{ fontSize: 13, color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink, fontFamily: mono ? 'monospace' : undefined }}>{value}</Text>
    </View>
  );
}

function ReviewFormModal({
  productId,
  productName,
  existing,
  onClose,
  onSubmitted,
}: {
  productId: string;
  productName: string;
  existing?: Review;
  onClose: () => void;
  onSubmitted: (wasEdit: boolean) => void;
}) {
  const { lang } = useLanguageStore();
  const writeReview = useWriteReview();
  const user = useAuthStore((s) => s.user);
  const messages = useValidationMessages();
  const isEdit = !!existing;
  const [submitError, setSubmitError] = useState<string | null>(null);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      rating: z.number().min(1, messages.required).max(5),
      name:   r.name({ min: 2, max: 80 }),
      email:  z.string().trim().refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: messages.email }).optional().or(z.literal('')),
      city:   z.string().trim().max(80, messages.tooLong(80)).optional().or(z.literal('')),
      title:  z.string().trim().max(80, messages.tooLong(80)).optional().or(z.literal('')),
      body:   z.string().trim().min(10, messages.tooShort(10)).max(1000, messages.tooLong(1000)),
    });
  }, [messages]);

  type ReviewFormData = z.infer<typeof schema>;

  const {
    control, handleSubmit, setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReviewFormData>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      rating: existing?.rating ?? 0,
      // Name comes from the account and is not editable here; email and city
      // are gone entirely — the server derives the author from the session.
      name:   user?.name ?? '',
      email:  user?.email ?? '',
      city:   '',
      title:  existing?.title ?? '',
      body:   existing?.body ?? '',
    },
  });

  const rating = useWatch({ control, name: 'rating' }) ?? 0;
  const body = useWatch({ control, name: 'body' }) ?? '';
  const setRating = (v: number) => setValue('rating', v, { shouldValidate: true });

  // The server upserts on (product, user), so create and edit are the same
  // call — no branch on isEdit, and no id to carry around.
  const onSubmit = async (values: ReviewFormData) => {
    setSubmitError(null);
    try {
      await writeReview.mutateAsync({
        productId,
        payload: {
          rating: values.rating,
          title: values.title?.trim() || null,
          body: values.body,
        },
      });
      onSubmitted(isEdit);
    } catch (err) {
      // The API refuses a review for a product this customer has not been
      // delivered, and says so in plain language. Without this catch the
      // rejection escaped as an unhandled promise — a red console error, and
      // nothing at all shown to the person who just pressed the button.
      //
      // The sheet stays open on purpose: the text they wrote is still in it,
      // and for the not-delivered case it may be usable later.
      const message = err instanceof ApiError && err.message.trim()
        ? err.message
        : lang === 'en'
          ? 'Could not post your review. Please try again.'
          : 'No se pudo publicar tu reseña. Inténtalo de nuevo.';
      setSubmitError(message);
    }
  };

  const inputStyle = { height: 44, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', fontSize: 13, color: colors.ink };
  const inputErrorBorder = { borderColor: colors.danger };
  const renderError = (msg?: string) =>
    msg ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <AlertCircle size={11} color={colors.danger} strokeWidth={2} />
        <Text style={{ flex: 1, fontSize: 11.5, color: colors.danger, fontWeight: '500' }}>{msg}</Text>
      </View>
    ) : null;

  // A real Modal, not an absolutely-positioned View. The previous version
  // relied on `position: 'absolute', inset: 0` inside the screen's root, which
  // left it subject to that tree's layout and gave it none of what a sheet
  // needs: no Android back-button dismiss, no keyboard avoidance, and nothing
  // guaranteeing it covered the screen. Matches QuotationRequestModal, which
  // is the pattern every other sheet in the app already follows.
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' }}
      >
        <Pressable onPress={onClose} style={{ flex: 1 }} />
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
            <View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>
                {isEdit
                  ? (lang === 'en' ? 'Edit your review' : 'Editar tu reseña')
                  : (lang === 'en' ? 'Write a review' : 'Escribir una reseña')}
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }} numberOfLines={1}>{productName}</Text>
            </View>

            {/* Rating */}
            <View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(15,23,42,0.65)', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 }}>
                {lang === 'en' ? 'Your rating *' : 'Tu valoración *'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Pressable key={i} onPress={() => setRating(i + 1)} hitSlop={4}>
                    <Star size={26} strokeWidth={1.5} color={i < rating ? colors.amber.deep : colors.border} fill={i < rating ? colors.amber.deep : 'transparent'} />
                  </Pressable>
                ))}
                {rating > 0 && (
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink, marginLeft: 4 }}>{rating} / 5</Text>
                )}
              </View>
            </View>

            {errors.rating && (
              <Text style={{ fontSize: 11.5, color: colors.danger, fontWeight: '500' }}>
                {lang === 'en' ? 'Please pick a rating from 1 to 5 stars.' : 'Elige una valoración de 1 a 5 estrellas.'}
              </Text>
            )}

            {/* Name */}
            <Controller
              control={control}
              name="name"
              render={({ field, fieldState }) => (
                <View>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(15,23,42,0.65)', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>
                    {lang === 'en' ? 'Your name *' : 'Tu nombre *'}
                  </Text>
                  <TextInput
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder={lang === 'en' ? 'e.g. Priya' : 'p. ej. Priya'}
                    placeholderTextColor={colors.muted}
                    style={[inputStyle, fieldState.error && inputErrorBorder]}
                  />
                  {renderError(fieldState.error?.message)}
                </View>
              )}
            />

            {/* City */}
            <Controller
              control={control}
              name="city"
              render={({ field, fieldState }) => (
                <View>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(15,23,42,0.65)', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>
                    {lang === 'en' ? 'City' : 'Ciudad'}
                  </Text>
                  <TextInput
                    value={field.value ?? ''}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder={lang === 'en' ? 'e.g. Madrid' : 'p. ej. Madrid'}
                    placeholderTextColor={colors.muted}
                    style={[inputStyle, fieldState.error && inputErrorBorder]}
                  />
                  {renderError(fieldState.error?.message)}
                </View>
              )}
            />

            {/* Email */}
            <Controller
              control={control}
              name="email"
              render={({ field, fieldState }) => (
                <View>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(15,23,42,0.65)', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>
                    {lang === 'en' ? 'Email (kept private)' : 'Correo (privado)'}
                  </Text>
                  <TextInput
                    value={field.value ?? ''}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.muted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    style={[inputStyle, fieldState.error && inputErrorBorder]}
                  />
                  {renderError(fieldState.error?.message)}
                </View>
              )}
            />

            {/* Title */}
            <Controller
              control={control}
              name="title"
              render={({ field, fieldState }) => (
                <View>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(15,23,42,0.65)', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>
                    {lang === 'en' ? 'Headline' : 'Título'}
                  </Text>
                  <TextInput
                    value={field.value ?? ''}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder={lang === 'en' ? 'Sum it up in a few words' : 'Resúmelo en pocas palabras'}
                    placeholderTextColor={colors.muted}
                    maxLength={80}
                    style={[inputStyle, fieldState.error && inputErrorBorder]}
                  />
                  {renderError(fieldState.error?.message)}
                </View>
              )}
            />

            {/* Body */}
            <Controller
              control={control}
              name="body"
              render={({ field, fieldState }) => (
                <View>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(15,23,42,0.65)', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 6 }}>
                    {lang === 'en' ? 'Your review *' : 'Tu reseña *'}
                  </Text>
                  <TextInput
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder={lang === 'en'
                      ? 'What did you like? What could be better?'
                      : '¿Qué te gustó? ¿Qué podría ser mejor?'}
                    placeholderTextColor={colors.muted}
                    multiline
                    numberOfLines={4}
                    maxLength={1000}
                    style={[inputStyle, { height: 110, paddingTop: 12, textAlignVertical: 'top' }, fieldState.error && inputErrorBorder]}
                  />
                  {renderError(fieldState.error?.message)}
                  <Text style={{ fontSize: 10.5, color: colors.muted, textAlign: 'right', marginTop: 4 }}>{body.length}/1000</Text>
                </View>
              )}
            />

          </ScrollView>

          {/* Sits with the button rather than at the top of the scroll: they
              have just pressed submit, so the top of the form is off screen.
              A banner here also beats a dialog stacked over this sheet, which
              nests one Modal inside another for no gain. */}
          {!!submitError && (
            <View style={{
              flexDirection: 'row', alignItems: 'flex-start', gap: 8,
              marginHorizontal: 20, marginBottom: 4, padding: 12,
              borderRadius: 12, backgroundColor: colors.dangerBg,
              borderWidth: 1, borderColor: 'rgba(220,38,38,0.25)',
            }}>
              <AlertCircle size={15} color={colors.danger} strokeWidth={2} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontSize: 12.5, color: colors.danger, lineHeight: 17 }}>
                {submitError}
              </Text>
            </View>
          )}

          <View style={{
            flexDirection: 'row', gap: 12,
            paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28,
            borderTopWidth: 1, borderTopColor: colors.border,
            backgroundColor: '#fff',
          }}>
            <Pressable
              onPress={onClose}
              style={{
                flex: 1, height: 52, borderRadius: 12,
                borderWidth: 1, borderColor: colors.border,
                justifyContent: 'center', alignItems: 'center',
                backgroundColor: '#fff',
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
                {lang === 'en' ? 'Cancel' : 'Cancelar'}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit(onSubmit)}
              disabled={isSubmitting}
              style={({ pressed }) => ({
                flex: 1.4, height: 52, borderRadius: 12,
                backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
                justifyContent: 'center', alignItems: 'center',
                flexDirection: 'row', gap: 8,
                opacity: isSubmitting ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                {isSubmitting
                  ? (lang === 'en' ? 'Saving…' : 'Guardando…')
                  : isEdit
                    ? (lang === 'en' ? 'Save changes' : 'Guardar cambios')
                    : (lang === 'en' ? 'Post review' : 'Publicar reseña')}
              </Text>
              {!isSubmitting && <ArrowRight size={16} color="#fff" strokeWidth={2.5} />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
