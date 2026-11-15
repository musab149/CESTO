import { View, Text, Pressable, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, Minus } from 'lucide-react-native';
import type { Product } from '@grocery-app/shared';
import { resolveImageUrl } from '@grocery-app/shared';
import { useCartStore } from '../stores/cartStore';
import { useLanguageStore } from '../stores/languageStore';
import { colors } from '../constants/colors';
import { usePriceTone } from '../lib/priceTone';

/**
 * The card web's categories page uses at its mobile breakpoint
 * (CategoriesPage.MobileProductCard), not the shared ProductCard.
 *
 * Web deliberately runs two cards: the rich one — heart, sold-by, rating,
 * badges — everywhere else, and this stripped one on the category grid, where
 * you are scanning a long filtered list and the only questions are what it
 * costs, what it is called, and can I add it. Price leads, name follows,
 * everything else is gone.
 *
 * Scoped to the category screen for the same reason. Home, search and the
 * store grid keep the full card.
 */

/** Matches the shared card's price treatment — same weights and sizes. */
function CategoryPrice({ value }: { value: number }) {
  const [whole, cents] = value.toFixed(2).split('.');
  const tone = usePriceTone();
  return (
    <Text style={{ color: tone, fontWeight: '800' }}>
      <Text style={{ fontSize: 12 }}>€</Text>
      <Text style={{ fontSize: 20 }}>{whole}</Text>
      <Text style={{ fontSize: 12 }}>.{cents}</Text>
    </Text>
  );
}

export default function CategoryProductCard({ product }: { product: Product }) {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const name = lang === 'en' ? product.name_en : product.name_es;

  const primary = product.images?.find((i) => i.is_primary) ?? product.images?.[0];
  const imageUrl = primary ? resolveImageUrl(primary.url, 'card') : null;
  const defaultVariant = product.variants?.find((v) => v.is_default) ?? product.variants?.[0];
  const price = defaultVariant?.price;
  const compareAt = defaultVariant?.compare_at_price;
  const hasDiscount = compareAt != null && price != null && Number(compareAt) > Number(price);

  const quantity = useCartStore((s) => s.getQuantity(defaultVariant?.id ?? ''));
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);

  const stock = defaultVariant?.stock_quantity ?? 0;
  const allOutOfStock = product.variants?.every((v) => v.stock_quantity === 0) ?? !defaultVariant;
  const canAdd = !allOutOfStock && defaultVariant != null;

  const handleAdd = () => {
    if (!defaultVariant) return;
    addItem({
      productId: product.id,
      variantId: defaultVariant.id,
      name_es: product.name_es,
      name_en: product.name_en,
      variantName_es: defaultVariant.name_es,
      variantName_en: defaultVariant.name_en,
      price: defaultVariant.price,
      compare_at_price: defaultVariant.compare_at_price,
      image: primary?.url ?? '',
      maxStock: defaultVariant.stock_quantity,
    });
  };

  return (
    <Pressable
      onPress={() => router.push(`/product/${product.id}`)}
      style={{
        backgroundColor: '#fff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      <View style={{ aspectRatio: 1, backgroundColor: colors.surface.cream, alignItems: 'center', justifyContent: 'center' }}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <Text style={{ fontSize: 28 }}>🛒</Text>
        )}

        {/* Out of stock is still orderable as a draft, so the card is dimmed
            rather than disabled — web does the same with a white scrim. */}
        {allOutOfStock && (
          <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,0.55)' }} />
        )}

        {/* Floating add → stepper, bottom-right. 36px rather than the shared
            card's 32px: on this grid it is only ever hit with a thumb. */}
        {canAdd && (
          <View style={{ position: 'absolute', bottom: 6, right: 6 }}>
            {quantity === 0 ? (
              <Pressable
                onPress={handleAdd}
                hitSlop={6}
                style={({ pressed }) => ({
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: colors.brand.DEFAULT,
                  alignItems: 'center', justifyContent: 'center',
                  transform: [{ scale: pressed ? 0.95 : 1 }],
                })}
                accessibilityLabel={lang === 'en' ? 'Add to cart' : 'Añadir al carrito'}
              >
                <Plus size={18} color="#fff" strokeWidth={2.75} />
              </Pressable>
            ) : (
              <View
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  height: 36, borderRadius: 18,
                  backgroundColor: colors.brand.DEFAULT, overflow: 'hidden',
                }}
              >
                <Pressable
                  onPress={() => updateQuantity(defaultVariant!.id, quantity - 1)}
                  style={{ width: 32, height: '100%', alignItems: 'center', justifyContent: 'center' }}
                  accessibilityLabel={lang === 'en' ? 'Decrease quantity' : 'Reducir cantidad'}
                >
                  <Minus size={14} color="#fff" strokeWidth={2.75} />
                </Pressable>
                <Text style={{ minWidth: 18, textAlign: 'center', fontSize: 12.5, fontWeight: '700', color: '#fff' }}>
                  {quantity}
                </Text>
                <Pressable
                  onPress={() => quantity < stock && updateQuantity(defaultVariant!.id, quantity + 1)}
                  disabled={quantity >= stock}
                  style={{ width: 32, height: '100%', alignItems: 'center', justifyContent: 'center', opacity: quantity >= stock ? 0.4 : 1 }}
                  accessibilityLabel={lang === 'en' ? 'Increase quantity' : 'Aumentar cantidad'}
                >
                  <Plus size={14} color="#fff" strokeWidth={2.75} />
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>

      {/* Price leads, name follows — web's order on this card, and the reverse
          of the shared one. */}
      <View style={{ padding: 10 }}>
        {price != null && (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <CategoryPrice value={Number(price)} />
            {hasDiscount && (
              <Text style={{ fontSize: 11.5, color: colors.muted, textDecorationLine: 'line-through' }}>
                €{Number(compareAt).toFixed(2)}
              </Text>
            )}
          </View>
        )}
        <Text
          numberOfLines={2}
          style={{ marginTop: 4, fontSize: 12.5, fontWeight: '600', color: colors.ink, lineHeight: 17 }}
        >
          {name}
        </Text>
      </View>
    </Pressable>
  );
}
