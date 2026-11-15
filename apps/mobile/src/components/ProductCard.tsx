import { View, Text, Pressable, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, Minus, Heart, BadgeCheck, Star, Flame, ImageOff } from 'lucide-react-native';
import type { Product } from '@grocery-app/shared';
import { resolveImageUrl, useTopShops, defaultTopShops, resolveShop, CESTO_SHOP } from '@grocery-app/shared';
import { useCartStore } from '../stores/cartStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useLanguageStore } from '../stores/languageStore';
import { colors } from '../constants/colors';
import { usePriceTone } from '../lib/priceTone';
import { shopForProduct } from '../lib/shopForProduct';

interface ProductCardProps {
  product: Product;
  /**
   * Swaps the card's cart stepper for someone else's quantity state — used by
   * the rashan pack picker, where the stepper writes to the draft rather than
   * the basket. Also stops the card navigating: inside the picker sheet a tap
   * through to the product page would abandon the pack being built.
   *
   * Same contract as web's ProductCard, so the two pickers behave identically.
   */
  picker?: {
    quantity: number;
    onQuantityChange: (next: number) => void;
  };
}

/** Price atom — same split as web: small €, large whole, small cents. */
function Price({ value, color }: { value: number; color: string }) {
  const [whole, cents] = value.toFixed(2).split('.');
  return (
    <Text style={{ color, fontWeight: '800', letterSpacing: -0.3, includeFontPadding: false }}>
      <Text style={{ fontSize: 12 }}>€</Text>
      <Text style={{ fontSize: 20 }}>{whole}</Text>
      <Text style={{ fontSize: 12 }}>.{cents}</Text>
    </Text>
  );
}

export default function ProductCard({ product, picker }: ProductCardProps) {
  const router = useRouter();
  const { lang } = useLanguageStore();
  // Blue when the wholesale catalogue is active, green otherwise — the server
  // already swapped in b2b_price, so this is the only visible difference.
  const priceTone = usePriceTone();

  const name = lang === 'es' ? product.name_es : product.name_en;
  const defaultVariant = product.variants?.find((v) => v.is_default) ?? product.variants?.[0];
  const primaryImage = product.images?.find((i) => i.is_primary) ?? product.images?.[0];
  const allOutOfStock = product.variants?.every((v) => v.stock_quantity === 0) ?? !defaultVariant;
  const hasDiscount = defaultVariant?.compare_at_price != null;

  const { data: shopsData } = useTopShops();
  const shops = (shopsData ?? defaultTopShops).shops;
  const shop = shopForProduct(product, resolveShop(product.shop_id, shops));

  // Picker tiles do one job: add. 44px is the comfortable touch minimum and
  // reads as the card's primary control rather than a corner affordance.
  const bigAction = !!picker;
  const actionSize = bigAction ? 44 : 32;

  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  // Subscribe to the computed quantity, NOT the getter function. A function
  // selector returns the same reference across renders, so the component
  // wouldn't re-render when items change. Calling the getter inside the
  // selector returns a number that does change.
  const cartQuantity = useCartStore((s) => defaultVariant ? s.getQuantity(defaultVariant.id) : 0);
  const quantity = picker ? picker.quantity : cartQuantity;
  const stock = defaultVariant?.stock_quantity ?? 0;

  const isFavorite = useFavoritesStore((s) => s.productIds.includes(product.id));
  const toggleFavorite = useFavoritesStore((s) => s.toggle);

  const openProduct = () => {
    if (picker) return;
    router.push(`/product/${product.id}`);
  };
  const handleAdd = () => {
    if (!defaultVariant || allOutOfStock) return;
    if (picker) { picker.onQuantityChange(1); return; }
    addItem({
      productId: product.id,
      variantId: defaultVariant.id,
      name_es: product.name_es,
      name_en: product.name_en,
      variantName_es: defaultVariant.name_es,
      variantName_en: defaultVariant.name_en,
      price: defaultVariant.price,
      compare_at_price: defaultVariant.compare_at_price,
      image: primaryImage?.url ?? '',
      maxStock: defaultVariant.stock_quantity,
    });
  };

  // Single top-left chip — Sold wins over Top Seller. Mirrors web's priority.
  // Verified is rendered next to the rating so the row reads as a trust signal.
  const topChip = allOutOfStock
    ? { label: lang === 'en' ? 'Sold' : 'Agotado', icon: null as null | React.ReactNode, bg: colors.danger, fg: '#fff' }
    : product.is_top_seller
      ? { label: lang === 'en' ? 'Top' : 'Top', icon: <Flame size={10} color="#fff" strokeWidth={2.5} />, bg: colors.warning, fg: '#fff' }
      : null;

  // The card itself is a plain View. Only the image + content block is wrapped
  // in a navigate Pressable. The floating Add and the Heart are siblings,
  // absolutely positioned over the image — that way their taps cannot bubble
  // to the navigate Pressable on RN (which doesn't expose stopPropagation).
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(226,232,240,0.7)',
        padding: 10,
        backgroundColor: colors.surface.white,
        position: 'relative',
      }}
    >
      <Pressable onPress={openProduct}>
        {/* Image — square, contained, cream background, holds the top chip. */}
        <View
          style={{
            aspectRatio: 1,
            borderRadius: 12,
            overflow: 'hidden',
            backgroundColor: colors.surface.cream,
            position: 'relative',
          }}
        >
          {topChip && (
            <View
              style={{
                position: 'absolute', top: 6, left: 6, zIndex: 10,
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: 6, paddingVertical: 2,
                borderRadius: 6,
                backgroundColor: topChip.bg,
                shadowColor: '#0F172A', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 2,
              }}
            >
              {topChip.icon}
              <Text style={{ fontSize: 10, fontWeight: '700', color: topChip.fg, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                {topChip.label}
              </Text>
            </View>
          )}

          {primaryImage ? (
            <Image
              source={{ uri: resolveImageUrl(primaryImage.url, 'card') }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surface.sand,
                gap: 8,
              }}
            >
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: '#FFFFFF',
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ImageOff size={22} color={colors.muted} strokeWidth={1.75} />
              </View>
              <Text
                style={{
                  fontSize: 10.5,
                  fontWeight: '600',
                  color: colors.muted,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                }}
              >
                {lang === 'en' ? 'No image' : 'Sin imagen'}
              </Text>
            </View>
          )}

          {allOutOfStock && (
            <View
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.55)' }}
            />
          )}
        </View>

        {/* Price */}
        <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
          <Price value={defaultVariant?.price ?? 0} color={priceTone} />
          {hasDiscount && defaultVariant?.compare_at_price != null && (
            <Text style={{ fontSize: 11.5, color: colors.muted, textDecorationLine: 'line-through' }}>
              €{defaultVariant.compare_at_price.toFixed(2)}
            </Text>
          )}
        </View>

        {/* Name */}
        <Text
          numberOfLines={2}
          style={{ marginTop: 4, fontSize: 13, fontWeight: '600', color: colors.ink, lineHeight: 17 }}
        >
          {name}
        </Text>

        {/* Sold by — always shown. With 8 stores in the catalogue this is
            the only thing distinguishing two shops' listings of the same
            product, so it is never conditional.

            The store name is now the highest-frequency route into a
            storefront: it appears on every card in the app. Cesto Shop is a
            virtual identity with no Store row, so it stays plain text rather
            than linking to a 404. */}
        <Text
          numberOfLines={1}
          onPress={
            shop.id === CESTO_SHOP.id
              ? undefined
              : (e) => {
                  // The whole card is Pressable and opens the product; without
                  // this the tap would do both.
                  e.stopPropagation();
                  router.push({ pathname: '/store/[slug]', params: { slug: shop.id } });
                }
          }
          suppressHighlighting
          style={{ marginTop: 2, fontSize: 11, color: colors.muted, lineHeight: 14 }}
        >
          {lang === 'en' ? 'Sold by ' : 'Vendido por '}
          <Text
            style={{
              color: shop.id === CESTO_SHOP.id ? 'rgba(15,23,42,0.8)' : colors.brand.DEFAULT,
              fontWeight: '600',
            }}
          >
            {shop.name}
          </Text>
        </Text>

        {/* Rating + Verified. Normally always rendered so every card keeps the
            same slot. In picker mode the review row goes: reviews help you
            choose while browsing, and by the time someone is picking a line
            item for a recurring pack that choice is made — it was only pushing
            the taller control against a taller card. Verified stays, because
            it is a trust mark rather than a review, but the row then renders
            only when there is a badge to put in it. */}
        {(!picker || product.is_verified) && (
        <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {!picker && (product.rating != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Star size={11} color={colors.warning} fill={colors.warning} strokeWidth={2} />
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] }}>
                {product.rating.toFixed(1)}
              </Text>
              {product.rating_count != null && product.rating_count > 0 && (
                <Text style={{ fontSize: 11.5, color: colors.muted, fontVariant: ['tabular-nums'] }}>
                  ({product.rating_count})
                </Text>
              )}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Star size={11} color={colors.border} strokeWidth={2} />
              <Text style={{ fontSize: 11.5, color: colors.muted, fontStyle: 'italic' }}>
                  {lang === 'en' ? 'No reviews yet' : 'Sin reseñas'}
              </Text>
            </View>
          ))}
          {product.is_verified && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <BadgeCheck size={12} color={colors.brand.DEFAULT} strokeWidth={2} />
              <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.brand.deepest }}>
                {lang === 'en' ? 'Verified' : 'Verificado'}
              </Text>
            </View>
          )}
        </View>
        )}
      </Pressable>

      {/* Heart — absolutely positioned over the image, OUTSIDE the navigate
          Pressable so its tap never bubbles to navigation. Offsets equal
          card padding (10) + image inset (6). */}
      <Pressable
        onPress={() => toggleFavorite(product.id)}
        hitSlop={6}
        style={{
          position: 'absolute', top: 16, right: 16, zIndex: 30,
          width: 28, height: 28, borderRadius: 14,
          backgroundColor: '#fff',
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.4)',
          shadowColor: '#0F172A', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Heart
          size={13}
          strokeWidth={1.75}
          color={isFavorite ? colors.danger : 'rgba(15,23,42,0.55)'}
          fill={isFavorite ? colors.danger : 'transparent'}
        />
      </Pressable>

      {/* Add / Stepper — anchored to the image's bottom-right via an overlay
          that hugs the image's square (aspectRatio: 1, inset = card padding).
          Sibling of the navigate Pressable, so its taps don't bubble. */}
      <ImageBottomRightAnchor>
        {!allOutOfStock && (
          quantity === 0 ? (
            <Pressable
              onPress={handleAdd}
              hitSlop={4}
              style={({ pressed }) => ({
                width: actionSize, height: actionSize, borderRadius: actionSize / 2,
                backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: colors.brand.DEFAULT, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
              })}
            >
              <Plus size={bigAction ? 22 : 16} color="#fff" strokeWidth={2.75} />
            </Pressable>
          ) : (
            <View
              style={{
                flexDirection: 'row', alignItems: 'center',
                height: actionSize, borderRadius: actionSize / 2,
                backgroundColor: colors.brand.DEFAULT, overflow: 'hidden',
                shadowColor: colors.brand.DEFAULT, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
              }}
            >
              <Pressable
                onPress={() => { if (!defaultVariant) return; if (picker) picker.onQuantityChange(quantity - 1); else updateQuantity(defaultVariant.id, quantity - 1); }}
                hitSlop={4}
                style={({ pressed }) => ({
                  width: bigAction ? 38 : 28, height: '100%', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: pressed ? colors.brand.mid : 'transparent',
                })}
              >
                <Minus size={bigAction ? 17 : 13} color="#fff" strokeWidth={2.75} />
              </Pressable>
              <Text style={{ paddingHorizontal: bigAction ? 6 : 4, fontSize: bigAction ? 15 : 12, fontWeight: '700', color: '#fff', minWidth: bigAction ? 24 : 18, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
                {quantity}
              </Text>
              <Pressable
                onPress={() => { if (!defaultVariant || quantity >= stock) return; if (picker) picker.onQuantityChange(quantity + 1); else updateQuantity(defaultVariant.id, quantity + 1); }}
                disabled={quantity >= stock}
                hitSlop={4}
                style={({ pressed }) => ({
                  width: 28, height: '100%', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: pressed && quantity < stock ? colors.brand.mid : 'transparent',
                  opacity: quantity >= stock ? 0.4 : 1,
                })}
              >
                <Plus size={13} color="#fff" strokeWidth={2.75} />
              </Pressable>
            </View>
          )
        )}
      </ImageBottomRightAnchor>
    </View>
  );
}

/** Positions children at the bottom-right of the image area. The image is a
 *  square inset 10px (card padding) from each edge of the card, so its
 *  bottom-right corner is at right:10, and its top is at top:10. We use a
 *  square aspectRatio:1 layer that hugs the same square, and anchor children
 *  to its bottom-right with right:6, bottom:6 to land 6px inside the image. */
function ImageBottomRightAnchor({ children }: { children: React.ReactNode }) {
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 10, left: 10, right: 10,
        aspectRatio: 1,
        zIndex: 20,
      }}
    >
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', right: 6, bottom: 6 }}
      >
        {children}
      </View>
    </View>
  );
}
