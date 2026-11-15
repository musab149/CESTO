import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, User, Phone, MapPin, Hash, Building2, FileText, Home, AlertCircle } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useAddresses,
  useCreateAddress,
  useUpdateAddress,
  type AddressInput,
} from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useValidationMessages } from '../src/lib/validation/messages';
import { rules } from '../src/lib/validation/rules';
import { useDialog } from '../src/components/AppDialog';

interface AddressFormData {
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2: string;
  postcode: string;
  city: string;
  province: string;
  delivery_notes: string;
}

const emptyForm: AddressFormData = {
  contact_name: '',
  contact_phone: '',
  street_line_1: '',
  street_line_2: '',
  postcode: '',
  city: '',
  province: '',
  delivery_notes: '',
};

export default function AddressFormScreen() {
  const router = useRouter();
  const dialog = useDialog();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = id && id !== 'new' ? id : undefined;
  const { lang } = useLanguageStore();
  const messages = useValidationMessages();

  const { data: addresses = [] } = useAddresses();
  const createMutation = useCreateAddress();
  const updateMutation = useUpdateAddress();
  const editing = editingId ? addresses.find((a) => a.id === editingId) : undefined;

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      contact_name:  r.name({ min: 2, max: 100 }),
      contact_phone: r.phoneIntl(),
      street_line_1: r.shortText(200),
      // Empty string passes — these fields are visually optional.
      street_line_2: z.string().trim().max(200, messages.tooLong(200)),
      postcode:      r.postcode(),
      city:          r.name({ min: 2, max: 80 }),
      province:      r.name({ min: 2, max: 80 }),
      delivery_notes: z.string().trim().max(200, messages.tooLong(200)),
    });
  }, [messages]);

  const {
    control, handleSubmit, reset,
    formState: { isSubmitting },
  } = useForm<AddressFormData>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: emptyForm,
  });

  useEffect(() => {
    if (editing) {
      reset({
        contact_name: editing.contact_name,
        contact_phone: editing.contact_phone,
        street_line_1: editing.street_line_1,
        street_line_2: editing.street_line_2 ?? '',
        postcode: editing.postcode,
        city: editing.city,
        province: editing.province,
        delivery_notes: editing.delivery_notes ?? '',
      });
    }
  }, [editing?.id, reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values: AddressFormData) => {
    const payload: AddressInput = {
      contact_name: values.contact_name,
      contact_phone: values.contact_phone,
      street_line_1: values.street_line_1,
      street_line_2: values.street_line_2 || undefined,
      postcode: values.postcode,
      city: values.city,
      province: values.province,
      delivery_notes: values.delivery_notes || undefined,
    };
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, input: payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      router.back();
    } catch (err) {
      dialog.alert(
        lang === 'es' ? 'No se pudo guardar' : 'Could not save',
        err instanceof Error ? err.message : undefined,
        lang === 'es' ? 'Entendido' : 'OK',
      );
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: colors.surface.cream,
            justifyContent: 'center', alignItems: 'center',
          }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {editing
            ? lang === 'es' ? 'Editar dirección' : 'Edit address'
            : lang === 'es' ? 'Nueva dirección' : 'New address'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <View
              style={{
                width: 48, height: 48, borderRadius: 14,
                backgroundColor: colors.brand.mist,
                justifyContent: 'center', alignItems: 'center',
              }}
            >
              <Home size={22} color={colors.brand.deepest} strokeWidth={1.75} />
            </View>
            <Text style={{ flex: 1, fontSize: 13, color: colors.gray, lineHeight: 18 }}>
              {lang === 'es'
                ? 'Te avisaremos antes de cada entrega usando estos datos.'
                : "We'll use these details to confirm each delivery."}
            </Text>
          </View>

          <ControlledField
            control={control}
            name="contact_name"
            label={lang === 'es' ? 'Nombre de contacto' : 'Contact name'}
            icon={User}
            placeholder={lang === 'es' ? 'Tu nombre completo' : 'Your full name'}
            autoCapitalize="words"
          />

          <ControlledField
            control={control}
            name="contact_phone"
            label={lang === 'es' ? 'Teléfono' : 'Phone'}
            icon={Phone}
            placeholder="+34 600 000 000"
            keyboardType="phone-pad"
          />

          <ControlledField
            control={control}
            name="street_line_1"
            label={lang === 'es' ? 'Dirección' : 'Street address'}
            icon={MapPin}
            placeholder={lang === 'es' ? 'Calle y número' : 'Street and number'}
          />

          <ControlledField
            control={control}
            name="street_line_2"
            label={lang === 'es' ? 'Piso / puerta' : 'Apt / suite'}
            icon={Building2}
            placeholder={lang === 'es' ? 'Opcional' : 'Optional'}
          />

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <ControlledField
                control={control}
                name="postcode"
                label={lang === 'es' ? 'Código postal' : 'Postcode'}
                icon={Hash}
                placeholder="28013"
                keyboardType="number-pad"
                maxLength={5}
              />
            </View>
            <View style={{ flex: 1.4 }}>
              <ControlledField
                control={control}
                name="city"
                label={lang === 'es' ? 'Ciudad' : 'City'}
                placeholder="Madrid"
                autoCapitalize="words"
              />
            </View>
          </View>

          <ControlledField
            control={control}
            name="province"
            label={lang === 'es' ? 'Provincia' : 'Province'}
            placeholder="Madrid"
            autoCapitalize="words"
          />

          <ControlledField
            control={control}
            name="delivery_notes"
            label={lang === 'es' ? 'Notas para el repartidor' : 'Delivery notes'}
            icon={FileText}
            placeholder={lang === 'es' ? 'Timbre, planta, referencias...' : 'Buzzer, floor, landmarks...'}
            multiline
          />
        </ScrollView>

        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 24,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.surface.linen,
          }}
        >
          <Pressable
            onPress={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            style={{
              height: 54,
              borderRadius: 12,
              backgroundColor: colors.brand.DEFAULT,
              justifyContent: 'center',
              alignItems: 'center',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
                {editing
                  ? lang === 'es' ? 'Guardar cambios' : 'Save changes'
                  : lang === 'es' ? 'Guardar dirección' : 'Save address'}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ─── Field primitive ─────────────────────────────────── */

interface FieldVisualProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  icon?: any;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad' | 'email-address';
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  error?: string;
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  icon: Icon,
  keyboardType,
  multiline,
  autoCapitalize,
  maxLength,
  error,
}: FieldVisualProps) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink, marginBottom: 8 }}>
        {label}
      </Text>
      <FocusableInput
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        Icon={Icon}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        error={error}
      />
      {error && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <AlertCircle size={12} color={colors.danger} strokeWidth={2} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.danger, fontWeight: '500' }}>{error}</Text>
        </View>
      )}
    </View>
  );
}

function FocusableInput({
  value, onChange, onBlur, placeholder, Icon, keyboardType, multiline, autoCapitalize, maxLength, error,
}: Omit<FieldVisualProps, 'label' | 'icon'> & { Icon?: any }) {
  const [focused, setFocused] = useState(false);
  const borderColor = error
    ? colors.danger
    : focused
      ? colors.brand.DEFAULT
      : colors.border;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: multiline ? 'flex-start' : 'center',
        minHeight: multiline ? 88 : 52,
        borderRadius: 12,
        backgroundColor: colors.surface.cream,
        borderWidth: 1,
        borderColor,
        paddingHorizontal: 14,
        paddingVertical: multiline ? 12 : 0,
      }}
    >
      {Icon && (
        <Icon
          size={18}
          color={error ? colors.danger : (focused ? colors.brand.DEFAULT : colors.muted)}
          strokeWidth={1.75}
          style={{ marginRight: 10, marginTop: multiline ? 2 : 0 }}
        />
      )}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        maxLength={maxLength}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); onBlur?.(); }}
        style={{
          flex: 1,
          fontSize: 15,
          color: colors.ink,
          height: multiline ? undefined : '100%',
          textAlignVertical: multiline ? 'top' : 'center',
          paddingVertical: 0,
        }}
      />
    </View>
  );
}

/* ─── RHF wiring ─────────────────────────────────────── */

interface ControlledFieldProps<T extends FieldValues> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  name: Path<T>;
  label: string;
  icon?: any;
  placeholder?: string;
  keyboardType?: FieldVisualProps['keyboardType'];
  multiline?: boolean;
  autoCapitalize?: FieldVisualProps['autoCapitalize'];
  maxLength?: number;
}

function ControlledField<T extends FieldValues>({
  control, name, ...rest
}: ControlledFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field
          {...rest}
          value={(field.value ?? '') as string}
          onChange={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}
