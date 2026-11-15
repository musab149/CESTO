import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ChevronDown, ChevronRight, MessageCircle, Mail, Phone, HelpCircle } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useHelpCenter, useStoreSettings } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { SUPPORT_EMAIL_FALLBACK } from '../src/components/LegalDocumentScreen';

/**
 * Help & Support.
 *
 * These answers shipped inside versionCode 4 and most of them were untrue.
 * They described a 2-hour delivery window chosen at checkout (there is no
 * slot picker), "no minimum order amount" (settings set one), cancelling
 * "within 5 minutes" (the rule is while pending or confirmed), and payment by
 * "Visa, Mastercard, Amex" — which reads as paying by card in the app, when
 * every order is paid at the door. The contact card offered a Live Chat whose
 * handler did nothing and a placeholder phone number.
 *
 * So: amounts come from store settings rather than literals that go stale,
 * answers describe what the code actually does, and every contact route
 * listed is one that opens something.
 *
 * The questions themselves now come from the Help Centre, which admin already
 * edits and which `help.tsx` already renders — this screen was the only one
 * still carrying its own copy. The list below stays as the offline fallback:
 * an empty help centre or a dead network must not leave a support screen
 * blank, and these answers are accurate as written.
 */

interface FAQ {
  id: string;
  question_en: string;
  question_es: string;
  answer_en: string;
  answer_es: string;
}

export default function FaqScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const { data: settings } = useStoreSettings();
  const { data: helpCategories } = useHelpCenter();
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);
  const es = lang === 'es';

  const email = settings?.contactEmail?.trim() || SUPPORT_EMAIL_FALLBACK;
  const phone = settings?.contactPhone?.trim() || '';
  const phoneDigits = phone.replace(/[^0-9]/g, '');
  const money = (n: number) =>
    new Intl.NumberFormat(es ? 'es-ES' : 'en-IE', { style: 'currency', currency: 'EUR' }).format(n);

  const minOrder = settings?.minOrderValue ?? 0;
  const fee = settings?.deliveryFee ?? 0;
  const byDistance = settings?.deliveryPricingMode === 'distance';

  // Free delivery was removed on 2026-09-25 — every order carries a
  // delivery cost, so there is no threshold to mention here.
  const costEs = [
    byDistance
      ? 'El coste depende de la distancia y se calcula al elegir tu dirección.'
      : `Se añaden ${money(fee)} a cada pedido.`,
    ' Siempre lo ves en el resumen antes de confirmar.',
  ].join('');
  const costEn = [
    byDistance
      ? 'The cost depends on distance and is worked out once you pick your address.'
      : `${money(fee)} is added to every order.`,
    ' You always see it in the summary before you confirm.',
  ].join('');

  const faqs: FAQ[] = [
    {
      id: 'order',
      question_es: '¿Cómo hago un pedido?',
      question_en: 'How do I place an order?',
      answer_es: 'Añade productos al carrito, elige tu dirección de entrega y cómo quieres pagar, y confirma. Ves el total, con el envío incluido, antes de confirmar.',
      answer_en: 'Add products to your cart, choose your delivery address and how you want to pay, then confirm. You see the total, delivery included, before you confirm.',
    },
    {
      id: 'time',
      question_es: '¿Cuánto tarda la entrega?',
      question_en: 'How long does delivery take?',
      answer_es: 'Repartimos dentro de nuestras zonas de servicio en España. Los tiempos que ves en la app son estimaciones, no garantías. Indica tu código postal y te diremos si llegamos hasta ti.',
      answer_en: 'We deliver within our published service areas in Spain. The times shown in the app are estimates, not guarantees. Enter your postcode and we will tell you whether we reach you.',
    },
    {
      id: 'cost',
      question_es: '¿Cuánto cuesta el envío?',
      question_en: 'How much is delivery?',
      answer_es: costEs,
      answer_en: costEn,
    },
    {
      id: 'minimum',
      question_es: '¿Hay un importe mínimo?',
      question_en: 'Is there a minimum order?',
      answer_es: minOrder > 0 ? `Sí: el pedido mínimo es de ${money(minOrder)}.` : 'No hay importe mínimo de pedido.',
      answer_en: minOrder > 0 ? `Yes: the minimum order is ${money(minOrder)}.` : 'There is no minimum order amount.',
    },
    {
      id: 'pay',
      question_es: '¿Cómo puedo pagar?',
      question_en: 'How can I pay?',
      answer_es: 'Al recibir el pedido: en efectivo o con tarjeta (el repartidor lleva datáfono). No se introduce ningún dato bancario en la app.',
      answer_en: 'When your order arrives: cash or card (the rider carries a card reader). No bank details are ever entered in the app.',
    },
    {
      id: 'track',
      question_es: '¿Cómo sigo mi pedido?',
      question_en: 'How do I follow my order?',
      answer_es: 'En «Mis pedidos» ves el estado: pendiente, confirmado, en preparación, en camino y entregado. Te avisamos con notificaciones en cada cambio, y cuando el repartidor tiene tu pedido verás su nombre y su teléfono.',
      answer_en: 'Under "My orders" you see the status: pending, confirmed, preparing, on the way and delivered. We notify you at each change, and once a rider has your order you will see their name and phone number.',
    },
    {
      id: 'cancel',
      question_es: '¿Puedo cancelar un pedido?',
      question_en: 'Can I cancel an order?',
      answer_es: 'Puedes cancelarlo desde la app mientras esté pendiente o confirmado. Una vez en preparación, escríbenos y haremos lo posible por ayudarte.',
      answer_en: 'You can cancel it in the app while it is pending or confirmed. Once it is being prepared, contact us and we will do what we can.',
    },
    {
      id: 'wrong',
      question_es: 'Mi pedido ha llegado mal, ¿qué hago?',
      question_en: 'Something arrived damaged or wrong. What now?',
      answer_es: 'Revísalo al recibirlo: puedes rechazar cualquier producto dañado, caducado o que no hayas pedido, y no lo pagas. Si te das cuenta después, escríbenos dentro de las 48 horas siguientes.',
      answer_en: 'Check it on arrival: you can refuse anything damaged, out of date or that you did not order, and you will not pay for it. If you notice later, contact us within 48 hours.',
    },
    {
      id: 'account',
      question_es: '¿Cómo elimino mi cuenta?',
      question_en: 'How do I delete my account?',
      answer_es: 'Desde Perfil → Editar perfil → «Eliminar mi cuenta». Si tienes un pedido en curso, podrás eliminarla cuando se haya entregado o cancelado.',
      answer_en: 'Profile → Edit profile → "Delete my account". If you have an order in progress, you can delete it once that order has been delivered or cancelled.',
    },
  ];

  const contactOptions = [
    ...(phoneDigits ? [{
      icon: MessageCircle,
      title: 'WhatsApp',
      description: phone,
      onPress: () => Linking.openURL(`https://wa.me/${phoneDigits}`),
    }] : []),
    {
      icon: Mail,
      title: es ? 'Correo electrónico' : 'Email',
      description: email,
      onPress: () => Linking.openURL(`mailto:${email}`),
    },
    ...(phoneDigits ? [{
      icon: Phone,
      title: es ? 'Teléfono' : 'Phone',
      description: phone,
      onPress: () => Linking.openURL(`tel:${phoneDigits}`),
    }] : []),
  ];

  const toggleFaq = (id: string) => setExpandedFaq(expandedFaq === id ? null : id);

  // Flattened so the screen stays a single scannable list. Summaries carry no
  // body, so a row opens the article rather than expanding in place.
  const helpArticles = useMemo(
    () => (helpCategories ?? []).flatMap((c) => (c.articles ?? []).map((a) => ({
      id: a.id,
      slug: a.slug,
      title: es ? a.title_es : a.title_en,
      category: es ? c.title_es : c.title_en,
    }))),
    [helpCategories, es],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {es ? 'Ayuda y soporte' : 'Help & Support'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Contact section */}
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 12 }}>
          {es ? 'Contáctanos' : 'Contact Us'}
        </Text>

        <View style={{
          backgroundColor: colors.surface.cream, borderRadius: 12, overflow: 'hidden', marginBottom: 24,
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
        }}>
          {contactOptions.map((option, index) => {
            const Icon = option.icon;
            return (
              <Pressable
                key={option.title}
                onPress={option.onPress}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16,
                  borderBottomWidth: index < contactOptions.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                  backgroundColor: pressed ? colors.surface.linen : 'transparent',
                })}
              >
                <View style={{
                  width: 40, height: 40, borderRadius: 10,
                  backgroundColor: colors.brand.mist,
                  justifyContent: 'center', alignItems: 'center', marginRight: 14,
                }}>
                  <Icon size={20} color={colors.brand.DEFAULT} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>
                    {option.title}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    {option.description}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.muted} strokeWidth={1.75} />
              </Pressable>
            );
          })}
        </View>

        {/* FAQ section */}
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 12 }}>
          {es ? 'Preguntas frecuentes' : 'Frequently Asked Questions'}
        </Text>

        <View style={{
          backgroundColor: colors.surface.cream, borderRadius: 12, overflow: 'hidden',
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
        }}>
          {helpArticles.length > 0 ? helpArticles.map((article, index) => (
            <Pressable
              key={article.id}
              onPress={() => router.push(`/help/${article.slug}`)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16,
                borderBottomWidth: index < helpArticles.length - 1 ? 1 : 0,
                borderBottomColor: colors.border,
                backgroundColor: pressed ? colors.surface.linen : 'transparent',
              })}
            >
              <View style={{
                width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface.linen,
                justifyContent: 'center', alignItems: 'center', marginRight: 12,
              }}>
                <HelpCircle size={15} color={colors.muted} strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink, lineHeight: 20 }}>
                  {article.title}
                </Text>
                <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2 }}>
                  {article.category}
                </Text>
              </View>
              <ChevronRight size={18} color={colors.muted} strokeWidth={1.75} />
            </Pressable>
          )) : faqs.map((faq, index) => {
            const isExpanded = expandedFaq === faq.id;
            return (
              <View key={faq.id}>
                <Pressable
                  onPress={() => toggleFaq(faq.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16,
                    borderBottomWidth: index < faqs.length - 1 && !isExpanded ? 1 : 0,
                    borderBottomColor: colors.border,
                    backgroundColor: pressed ? colors.surface.linen : 'transparent',
                  })}
                >
                  <View style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: isExpanded ? colors.brand.mist : colors.surface.linen,
                    justifyContent: 'center', alignItems: 'center', marginRight: 12,
                  }}>
                    <HelpCircle size={15} color={isExpanded ? colors.brand.DEFAULT : colors.muted} strokeWidth={1.75} />
                  </View>
                  <Text style={{
                    flex: 1, fontSize: 14,
                    fontWeight: isExpanded ? '700' : '600',
                    color: isExpanded ? colors.brand.DEFAULT : colors.ink,
                    lineHeight: 20,
                  }}>
                    {es ? faq.question_es : faq.question_en}
                  </Text>
                  <ChevronDown
                    size={18}
                    color={isExpanded ? colors.brand.DEFAULT : colors.muted}
                    strokeWidth={1.75}
                    style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }}
                  />
                </Pressable>
                {isExpanded && (
                  <View style={{
                    paddingHorizontal: 16, paddingBottom: 16, paddingLeft: 56,
                    borderBottomWidth: index < faqs.length - 1 ? 1 : 0,
                    borderBottomColor: colors.border,
                  }}>
                    <Text style={{ fontSize: 13, color: colors.gray, lineHeight: 20 }}>
                      {es ? faq.answer_es : faq.answer_en}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
