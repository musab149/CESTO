import {
  View, Text, Modal, Pressable, ScrollView, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, User, Building2, Mail, Phone, Hash, MessageSquare } from 'lucide-react-native';
import { useSubmitLead } from '@grocery-app/shared';
import { colors } from '../constants/colors';
import { useLanguageStore } from '../stores/languageStore';
import { useToast } from './Toast';
import { useValidationMessages } from '../lib/validation/messages';
import { rules } from '../lib/validation/rules';

/**
 * "Get quotation" — the mobile twin of apps/web/src/components/
 * QuotationRequestModal.tsx.
 *
 * Same lead payload, same validation rules, same no-auth rule: a quotation is
 * a sales enquiry, so a visitor gets the identical flow whether or not they
 * are signed in. Products opt in per-row via `is_quotation_enabled`, which is
 * admin-curated — bulk and wholesale lines that are priced case by case rather
 * than off the shelf.
 *
 * Web composes its own modal chrome because the codebase has no shared Modal
 * primitive; mobile does the same for the same reason.
 */

interface QuotationFormState {
  name: string;
  company: string;
  email: string;
  phone: string;
  quantity: string;
  note: string;
}

const EMPTY_FORM: QuotationFormState = {
  name: '', company: '', email: '', phone: '', quantity: '1', note: '',
};

interface Props {
  open: boolean;
  onClose: () => void;
  product: { id: string; name: string };
  initialQuantity: number;
}

export default function QuotationRequestModal({ open, onClose, product, initialQuantity }: Props) {
  const { lang } = useLanguageStore();
  const toast = useToast();
  const submitLead = useSubmitLead();
  const messages = useValidationMessages();
  const t = (en: string, es: string) => (lang === 'en' ? en : es);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      name:    r.name({ min: 2, max: 100 }),
      company: r.name({ min: 2, max: 120 }),
      email:   r.email(),
      phone:   r.phoneIntl(),
      // Kept as a string because RN's numeric keypad still hands back text —
      // coerced at the boundary rather than fighting the input's type.
      quantity: z.coerce.number().int().min(1, messages.required).max(100000),
      note:    r.optionalLongText(2000),
    });
  }, [messages]);

  const {
    control, handleSubmit, reset,
    formState: { errors, isSubmitting },
  } = useForm<QuotationFormState>({
    resolver: zodResolver(schema) as never,
    mode: 'onBlur',
    defaultValues: EMPTY_FORM,
  });

  // Re-seed on every open so a dismissed half-filled form doesn't reappear,
  // and so the quantity follows whatever the stepper was left on.
  useEffect(() => {
    if (!open) return;
    reset({ ...EMPTY_FORM, quantity: String(initialQuantity || 1) });
  }, [open, initialQuantity, reset]);

  const onSubmit = async (values: QuotationFormState) => {
    try {
      await submitLead.mutateAsync({
        type: 'quotation',
        source: 'product_detail_page',
        name: values.name,
        company: values.company,
        email: values.email,
        phone: values.phone,
        message: values.note.trim() ? values.note.trim() : null,
        quote_product_id: product.id,
        quote_product_name: product.name,
        quote_quantity: Number(values.quantity),
        language: lang,
      });
      toast.success(
        t('Request sent — thanks!', 'Solicitud enviada, ¡gracias!'),
        t("We'll get back to you with a quote within one business day.",
          'Te enviaremos una cotización en un día laborable.'),
      );
      onClose();
    } catch (err) {
      toast.error(
        t("We couldn't send your request", 'No pudimos enviar tu solicitud'),
        err instanceof Error ? err.message : t('Please try again.', 'Por favor, inténtalo de nuevo.'),
      );
    }
  };

  const field = (
    name: keyof QuotationFormState,
    Icon: typeof User,
    label: string,
    opts: { placeholder?: string; keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad'; multiline?: boolean; required?: boolean } = {},
  ) => (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Icon size={13} color={colors.muted} strokeWidth={2} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>
          {label}
          {opts.required !== false && <Text style={{ color: colors.brand.DEFAULT }}> *</Text>}
        </Text>
      </View>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            value={String(value ?? '')}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder={opts.placeholder}
            placeholderTextColor={colors.muted}
            keyboardType={opts.keyboardType ?? 'default'}
            autoCapitalize={opts.keyboardType === 'email-address' ? 'none' : 'sentences'}
            multiline={opts.multiline}
            textAlignVertical={opts.multiline ? 'top' : 'center'}
            style={{
              backgroundColor: colors.surface.linen,
              borderWidth: 1,
              borderColor: errors[name] ? colors.danger : colors.border,
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: opts.multiline ? 12 : 0,
              height: opts.multiline ? 88 : 46,
              fontSize: 14,
              color: colors.ink,
            }}
          />
        )}
      />
      {errors[name] && (
        <Text style={{ fontSize: 11.5, color: colors.danger, marginTop: 4, fontWeight: '600' }}>
          {errors[name]?.message as string}
        </Text>
      )}
    </View>
  );

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' }}
      >
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%' }}>
          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
            borderBottomWidth: 1, borderBottomColor: colors.border,
          }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: '800', color: colors.ink }}>
                {t('Get quotation', 'Solicitar cotización')}
              </Text>
              <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }} numberOfLines={2}>
                {product.name}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel={t('Close', 'Cerrar')}
              style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface.sand, alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={16} color={colors.ink} strokeWidth={2.5} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {field('name', User, t('Your name', 'Tu nombre'), { placeholder: t('Jane Doe', 'María García') })}
            {field('company', Building2, t('Company', 'Empresa'), { placeholder: t('Your business', 'Tu negocio') })}
            {field('email', Mail, t('Email', 'Correo'), { placeholder: 'you@company.com', keyboardType: 'email-address' })}
            {field('phone', Phone, t('Phone', 'Teléfono'), { placeholder: '+34 600 000 000', keyboardType: 'phone-pad' })}
            {field('quantity', Hash, t('Quantity', 'Cantidad'), { placeholder: '1', keyboardType: 'number-pad' })}
            {field('note', MessageSquare, t('Notes', 'Notas'), {
              placeholder: t('Anything else we should know?', '¿Algo más que debamos saber?'),
              multiline: true,
              required: false,
            })}
          </ScrollView>

          {/* Submit */}
          <View style={{ padding: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Pressable
              onPress={handleSubmit(onSubmit)}
              disabled={isSubmitting}
              style={({ pressed }) => ({
                height: 52,
                borderRadius: 999,
                backgroundColor: colors.brand.DEFAULT,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isSubmitting ? 0.6 : pressed ? 0.85 : 1,
              })}
            >
              {isSubmitting
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontSize: 15, fontWeight: '800', color: '#fff' }}>
                    {t('Send request', 'Enviar solicitud')}
                  </Text>}
            </Pressable>
            <Text style={{ fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 10 }}>
              {t('We reply with a quote within one business day.',
                 'Respondemos con una cotización en un día laborable.')}
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
