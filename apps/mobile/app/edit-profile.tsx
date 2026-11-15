import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Modal, Image, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft, User as UserIcon, Mail, Phone, Lock,
  Check, AlertCircle, AlertTriangle, Trash2, Sparkles,
  Camera, Image as ImageIcon,
} from 'lucide-react-native';
import { useUpdateProfile, useUpdateAvatar, useDeleteAccount, customerUploads, resolveImageUrl } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useAuthStore } from '../src/stores/authStore';
import { useToast } from '../src/components/Toast';
import { useValidationMessages } from '../src/lib/validation/messages';
import { rules } from '../src/lib/validation/rules';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function EditProfileScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const forceLogout = useAuthStore((s) => s.forceLogout);
  const hydrate = useAuthStore((s) => s.hydrate);

  const updateProfile = useUpdateProfile();
  const updateAvatar = useUpdateAvatar();
  const deleteAccount = useDeleteAccount();
  const messages = useValidationMessages();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({ name: r.name({ min: 2, max: 100 }) });
  }, [messages]);

  const {
    control, handleSubmit, watch, reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<{ name: string }>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { name: user?.name ?? '' },
  });

  const name = watch('name') ?? '';
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const sheetTranslateY = useRef(new Animated.Value(400)).current;
  const sheetBackdrop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (avatarSheetOpen) {
      Animated.parallel([
        Animated.timing(sheetTranslateY, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(sheetBackdrop,   { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      sheetTranslateY.setValue(400);
      sheetBackdrop.setValue(0);
    }
  }, [avatarSheetOpen, sheetTranslateY, sheetBackdrop]);

  async function uploadFromUri(asset: ImagePicker.ImagePickerAsset) {
    setAvatarError(null);
    setUploadingAvatar(true);
    try {
      // Avatar endpoint caps at 2 MB. Modern phone photos blow past that, so
      // resize to 720px (an avatar never needs more) and re-encode as JPEG.
      // This also normalizes HEIC/HEIF iPhone shots, which the server may not
      // accept as-is.
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 720 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );

      const name = 'avatar.jpg';
      const file = { uri: manipulated.uri, name, type: 'image/jpeg' } as unknown as Blob;

      const result = await customerUploads.uploadAvatar(file, name);
      await updateAvatar.mutateAsync(result.url);
      await hydrate();
      toast.success(
        lang === 'en' ? 'Photo updated' : 'Foto actualizada',
        lang === 'en' ? 'Your profile picture is set.' : 'Tu foto de perfil se ha guardado.',
      );
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function pickFromLibrary() {
    setAvatarSheetOpen(false);
    // The system Photo Picker needs no permission, so there is nothing to ask for.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      await uploadFromUri(result.assets[0]);
    }
  }

  async function takePhoto() {
    setAvatarSheetOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setAvatarError(lang === 'en'
        ? 'Camera access is needed to take a photo.'
        : 'Se necesita acceso a la cámara para tomar una foto.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      await uploadFromUri(result.assets[0]);
    }
  }

  async function removePhoto() {
    setAvatarSheetOpen(false);
    setAvatarError(null);
    setUploadingAvatar(true);
    try {
      await updateAvatar.mutateAsync('');
      await hydrate();
      toast.success(
        lang === 'en' ? 'Photo removed' : 'Foto eliminada',
        lang === 'en' ? 'Your initials will be shown instead.' : 'Se mostrarán tus iniciales.',
      );
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setUploadingAvatar(false);
    }
  }

  useEffect(() => {
    if (user) reset({ name: user.name ?? '' });
  }, [user, reset]);

  if (!isAuthenticated) {
    router.replace('/(auth)/login');
    return null;
  }

  const trimmedName = name.trim();
  const canSave = isDirty && !isSubmitting;

  const onSubmit = async (values: { name: string }) => {
    setSubmitError(null);
    try {
      await updateProfile.mutateAsync({ name: values.name.trim() });
      await hydrate();
      toast.success(
        lang === 'en' ? 'Profile updated' : 'Perfil actualizado',
        lang === 'en' ? 'Your changes are saved.' : 'Tus cambios se han guardado.',
      );
      router.back();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleConfirmDelete = async () => {
    setDeleteError(null);
    if (deleteText !== 'DELETE') {
      setDeleteError(lang === 'en'
        ? 'Type DELETE in capital letters to confirm.'
        : 'Escribe DELETE en mayúsculas para confirmar.');
      return;
    }
    try {
      await deleteAccount.mutateAsync();
      forceLogout();
      router.replace('/(tabs)' as never);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: '#fff' }}>
        <Pressable
          onPress={() => router.back()}
          style={{ width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.ink }}>
          {lang === 'en' ? 'Edit profile' : 'Editar perfil'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 24 : 0}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Aesthetic hero — avatar + name + member chip on a brand gradient */}
          <LinearGradient
            colors={[colors.brand.deepest, colors.brand.DEFAULT, colors.brand.mid]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              marginHorizontal: 16, marginTop: 12, marginBottom: 18,
              borderRadius: 24,
              paddingTop: 26, paddingBottom: 24, paddingHorizontal: 22,
              alignItems: 'center',
              overflow: 'hidden',
            }}
          >
            {/* Decorative blobs */}
            <View style={{ position: 'absolute', top: -60, right: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.10)' }} />
            <View style={{ position: 'absolute', bottom: -40, left: -30, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.07)' }} />
            <View style={{ position: 'absolute', top: 30, left: 24, width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' }} />
            <View style={{ position: 'absolute', bottom: 60, right: 30, width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' }} />

            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: 'rgba(255,255,255,0.18)',
              paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
              marginBottom: 18,
            }}>
              <Sparkles size={10} color="#fff" strokeWidth={2.5} />
              <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 1.5 }}>
                {lang === 'en' ? 'YOUR PROFILE' : 'TU PERFIL'}
              </Text>
            </View>

            {/* Avatar */}
            <View style={{ width: 124, height: 124 }}>
              <View style={{
                width: 124, height: 124, borderRadius: 62,
                backgroundColor: '#fff',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 4, borderColor: 'rgba(255,255,255,0.45)',
                overflow: 'hidden',
              }}>
                {user?.avatar_url ? (
                  <Image
                    source={{ uri: resolveImageUrl(user.avatar_url, 'logo') }}
                    style={{ width: 116, height: 116, borderRadius: 58 }}
                  />
                ) : (
                  <LinearGradient
                    colors={[colors.brand.deepest, colors.brand.DEFAULT]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      width: 116, height: 116, borderRadius: 58,
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 42, fontWeight: '800', color: '#fff', letterSpacing: -1 }}>
                      {initialsOf(trimmedName || user?.name || '?')}
                    </Text>
                  </LinearGradient>
                )}
                {uploadingAvatar && (
                  <View style={{
                    position: 'absolute', inset: 0, borderRadius: 62,
                    backgroundColor: 'rgba(15,23,42,0.55)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
              </View>

              {/* Camera button */}
              <Pressable
                onPress={() => { setAvatarError(null); setAvatarSheetOpen(true); }}
                hitSlop={6}
                disabled={uploadingAvatar}
                style={({ pressed }) => ({
                  position: 'absolute',
                  right: -2, bottom: -2,
                  width: 40, height: 40, borderRadius: 20,
                  backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 3, borderColor: '#fff',
                  opacity: uploadingAvatar ? 0.6 : 1,
                })}
              >
                <Camera size={17} color="#fff" strokeWidth={2.25} />
              </Pressable>
            </View>

            <Text
              numberOfLines={1}
              style={{
                marginTop: 16, fontSize: 22, fontWeight: '800',
                color: '#fff', letterSpacing: -0.5, textAlign: 'center',
              }}
            >
              {trimmedName || (lang === 'en' ? 'Your name' : 'Tu nombre')}
            </Text>
            {user?.email && (
              <Text
                numberOfLines={1}
                style={{
                  marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.82)',
                  textAlign: 'center',
                }}
              >
                {user.email}
              </Text>
            )}
          </LinearGradient>

          <View style={{ paddingHorizontal: 16 }}>

          {/* Personal details */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginLeft: 4 }}>
            <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: colors.brand.DEFAULT }} />
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.charcoal, letterSpacing: 1.6, textTransform: 'uppercase' }}>
              {lang === 'en' ? 'Personal details' : 'Datos personales'}
            </Text>
          </View>

          <View style={{
            backgroundColor: '#fff',
            borderRadius: 20,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: 'rgba(226,232,240,0.7)',
          }}>
            <Controller
              control={control}
              name="name"
              render={({ field, fieldState }) => (
                <EditableRow
                  icon={UserIcon}
                  tone="mint"
                  label={lang === 'en' ? 'Full name' : 'Nombre completo'}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder={lang === 'en' ? 'Your name' : 'Tu nombre'}
                  maxLength={100}
                  dirty={field.value.trim() !== (user?.name ?? '') && field.value.trim().length > 0}
                  error={fieldState.error?.message}
                />
              )}
            />
            <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 76 }} />
            <LockedListRow
              icon={Mail}
              tone="sand"
              label={lang === 'en' ? 'Email' : 'Correo electrónico'}
              value={user?.email ?? '—'}
              lockedLabel={lang === 'en' ? 'Locked' : 'Bloqueado'}
            />
            {user?.phone && (
              <>
                <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 76 }} />
                <LockedListRow
                  icon={Phone}
                  tone="dune"
                  label={lang === 'en' ? 'Phone' : 'Teléfono'}
                  value={user.phone}
                  lockedLabel={lang === 'en' ? 'Locked' : 'Bloqueado'}
                />
              </>
            )}
          </View>

          <View style={{
            marginTop: 10,
            flexDirection: 'row', alignItems: 'flex-start', gap: 8,
            paddingHorizontal: 6,
          }}>
            <Lock size={11} color={colors.muted} strokeWidth={2.25} style={{ marginTop: 3 }} />
            <Text style={{ flex: 1, fontSize: 11.5, color: colors.muted, lineHeight: 16 }}>
              {lang === 'en'
                ? 'Email and phone are tied to your account and can\'t be changed here.'
                : 'El correo y el teléfono están vinculados a tu cuenta y no se pueden cambiar aquí.'}
            </Text>
          </View>

          {avatarError && (
            <View style={{ marginTop: 12, backgroundColor: colors.dangerBg, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderColor: colors.danger + '30' }}>
              <AlertCircle size={16} color={colors.danger} strokeWidth={2} />
              <Text style={{ flex: 1, fontSize: 13, color: colors.danger }}>{avatarError}</Text>
            </View>
          )}

          {submitError && (
            <View style={{ marginTop: 12, backgroundColor: colors.dangerBg, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderWidth: 1, borderColor: colors.danger + '30' }}>
              <AlertCircle size={16} color={colors.danger} strokeWidth={2} />
              <Text style={{ flex: 1, fontSize: 13, color: colors.danger }}>{submitError}</Text>
            </View>
          )}

          {/* Danger zone */}
          <Text style={{ marginTop: 28, fontSize: 10, fontWeight: '700', color: colors.danger, letterSpacing: 1.6, marginBottom: 8, marginLeft: 4 }}>
            {(lang === 'en' ? 'Danger zone' : 'Zona peligrosa').toUpperCase()}
          </Text>
          <View style={{
            backgroundColor: '#fff', borderRadius: 14,
            borderWidth: 1, borderColor: colors.danger + '40',
            padding: 16, gap: 12,
          }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
              {lang === 'en' ? 'Delete account' : 'Eliminar cuenta'}
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.gray, lineHeight: 18 }}>
              {lang === 'en'
                ? 'Deleting is permanent. Past orders are kept for legal records but your personal info is anonymized.'
                : 'La eliminación es permanente. Tus pedidos pasados se conservan por razones legales, pero tus datos personales se anonimizan.'}
            </Text>
            <Pressable
              onPress={() => { setDeleteOpen(true); setDeleteText(''); setDeleteError(null); }}
              style={({ pressed }) => ({
                marginTop: 4, height: 46, borderRadius: 12,
                borderWidth: 1.5, borderColor: colors.danger,
                backgroundColor: pressed ? colors.dangerBg : '#fff',
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              })}
            >
              <Trash2 size={15} color={colors.danger} strokeWidth={2} />
              <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.danger }}>
                {lang === 'en' ? 'Delete my account' : 'Eliminar mi cuenta'}
              </Text>
            </Pressable>
          </View>
          </View>
        </ScrollView>

        {/* Sticky Save footer */}
        <View style={{
          paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28,
          borderTopWidth: 1, borderTopColor: colors.border,
          backgroundColor: '#fff', flexDirection: 'row', gap: 12,
        }}>
          <Pressable
            onPress={() => router.back()}
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
            disabled={!canSave}
            style={({ pressed }) => ({
              flex: 1.4, height: 52, borderRadius: 12,
              backgroundColor: canSave ? (pressed ? colors.brand.mid : colors.brand.DEFAULT) : colors.muted,
              opacity: canSave ? 1 : 0.55,
              justifyContent: 'center', alignItems: 'center',
              flexDirection: 'row', gap: 8,
            })}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Check size={16} color="#fff" strokeWidth={2.5} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                  {lang === 'en' ? 'Save changes' : 'Guardar cambios'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Delete confirmation modal */}
      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteOpen(false)}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
          justifyContent: 'center', alignItems: 'center',
          paddingHorizontal: 28,
        }}>
          <Pressable onPress={() => setDeleteOpen(false)} style={{ position: 'absolute', inset: 0 }} />
          <View style={{
            width: '100%', maxWidth: 380,
            backgroundColor: '#fff', borderRadius: 18,
            paddingHorizontal: 22, paddingTop: 28, paddingBottom: 22,
            alignItems: 'center',
            borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
          }}>
            <View style={{
              width: 56, height: 56, borderRadius: 28,
              backgroundColor: colors.dangerBg,
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <AlertTriangle size={24} color={colors.danger} strokeWidth={2} />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
              {lang === 'en' ? 'Delete your account?' : '¿Eliminar tu cuenta?'}
            </Text>
            <Text style={{ fontSize: 13, color: colors.gray, lineHeight: 19, textAlign: 'center', marginTop: 8 }}>
              {lang === 'en'
                ? 'This cannot be undone. Type DELETE to confirm.'
                : 'Esta acción no se puede deshacer. Escribe DELETE para confirmar.'}
            </Text>

            <View style={{ alignSelf: 'stretch', marginTop: 18 }}>
              <TextInput
                value={deleteText}
                onChangeText={setDeleteText}
                placeholder="DELETE"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                style={{
                  height: 48, paddingHorizontal: 14,
                  borderRadius: 10, borderWidth: 1.5,
                  borderColor: deleteText === 'DELETE' ? colors.danger : colors.border,
                  backgroundColor: '#fff', fontSize: 14, color: colors.ink,
                  textAlign: 'center', letterSpacing: 2, fontWeight: '700',
                }}
              />
              {deleteError && (
                <Text style={{ fontSize: 12, color: colors.danger, marginTop: 8, textAlign: 'center' }}>
                  {deleteError}
                </Text>
              )}
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18, alignSelf: 'stretch' }}>
              <Pressable
                onPress={() => setDeleteOpen(false)}
                style={{
                  flex: 1, height: 50, borderRadius: 12,
                  borderWidth: 1, borderColor: colors.border,
                  justifyContent: 'center', alignItems: 'center',
                  backgroundColor: '#fff',
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                  {lang === 'en' ? 'Cancel' : 'Cancelar'}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmDelete}
                disabled={deleteAccount.isPending || deleteText !== 'DELETE'}
                style={({ pressed }) => ({
                  flex: 1, height: 50, borderRadius: 12,
                  backgroundColor: deleteText === 'DELETE'
                    ? (pressed ? '#B91C1C' : colors.danger)
                    : colors.muted,
                  opacity: deleteAccount.isPending || deleteText !== 'DELETE' ? 0.6 : 1,
                  justifyContent: 'center', alignItems: 'center',
                })}
              >
                {deleteAccount.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
                    {lang === 'en' ? 'Delete' : 'Eliminar'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Avatar action sheet */}
      <Modal
        visible={avatarSheetOpen}
        transparent
        animationType="none"
        onRequestClose={() => setAvatarSheetOpen(false)}
      >
        <Animated.View
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            opacity: sheetBackdrop,
            justifyContent: 'flex-end',
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setAvatarSheetOpen(false)} />
          <Animated.View
            style={{
              backgroundColor: colors.surface.cream,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: 28,
              transform: [{ translateY: sheetTranslateY }],
            }}
          >
            <View style={{ alignItems: 'center', paddingTop: 10 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>

            <View style={{
              paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14,
              borderBottomWidth: 1, borderBottomColor: colors.border,
            }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>
                {lang === 'en' ? 'Profile picture' : 'Foto de perfil'}
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                {lang === 'en' ? 'Choose how you want to update it.' : 'Elige cómo quieres actualizarla.'}
              </Text>
            </View>

            <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
              <AvatarSheetRow
                icon={Camera}
                tone={colors.surface.mint}
                fg={colors.brand.deepest}
                label={lang === 'en' ? 'Take a photo' : 'Tomar una foto'}
                hint={lang === 'en' ? 'Use your camera' : 'Usa tu cámara'}
                onPress={takePhoto}
              />
              <AvatarSheetRow
                icon={ImageIcon}
                tone={colors.brand.mist}
                fg={colors.brand.deepest}
                label={lang === 'en' ? 'Choose from gallery' : 'Elegir de la galería'}
                hint={lang === 'en' ? 'Pick from your library' : 'Selecciona desde tu galería'}
                onPress={pickFromLibrary}
              />
              {user?.avatar_url && (
                <AvatarSheetRow
                  icon={Trash2}
                  tone={colors.dangerBg}
                  fg={colors.danger}
                  label={lang === 'en' ? 'Remove current photo' : 'Eliminar foto actual'}
                  hint={lang === 'en' ? 'Go back to initials' : 'Vuelve a tus iniciales'}
                  onPress={removePhoto}
                  destructive
                />
              )}
            </View>

            <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
              <Pressable
                onPress={() => setAvatarSheetOpen(false)}
                style={({ pressed }) => ({
                  height: 50, borderRadius: 12,
                  borderWidth: 1, borderColor: colors.border,
                  backgroundColor: pressed ? colors.surface.linen : '#fff',
                  alignItems: 'center', justifyContent: 'center',
                  marginTop: 6,
                })}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                  {lang === 'en' ? 'Cancel' : 'Cancelar'}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}

function AvatarSheetRow({
  icon: Icon,
  tone,
  fg,
  label,
  hint,
  onPress,
  destructive,
}: {
  icon: typeof UserIcon;
  tone: string;
  fg: string;
  label: string;
  hint: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 12, paddingHorizontal: 12,
        borderRadius: 14,
        backgroundColor: pressed ? colors.surface.linen : 'transparent',
      })}
    >
      <View style={{
        width: 44, height: 44, borderRadius: 14,
        backgroundColor: tone,
        alignItems: 'center', justifyContent: 'center',
        marginRight: 14,
      }}>
        <Icon size={20} color={fg} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: destructive ? colors.danger : colors.ink, letterSpacing: -0.2 }}>
          {label}
        </Text>
        <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2 }}>{hint}</Text>
      </View>
    </Pressable>
  );
}

type Tone = 'mint' | 'sand' | 'dune' | 'mist';
const toneBg: Record<Tone, string> = {
  mint: colors.surface.mint,
  sand: colors.surface.sand,
  dune: colors.surface.dune,
  mist: colors.brand.mist,
};
const toneFg: Record<Tone, string> = {
  mint: colors.brand.deepest,
  sand: colors.charcoal,
  dune: colors.charcoal,
  mist: colors.brand.deepest,
};

function EditableRow({
  icon: Icon,
  tone,
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  maxLength,
  dirty,
  error,
}: {
  icon: typeof UserIcon;
  tone: Tone;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  maxLength?: number;
  dirty?: boolean;
  error?: string;
}) {
  const [focused, setFocused] = useState(false);
  const accent = focused || dirty;
  return (
    <View style={{
      flexDirection: 'column',
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: focused ? colors.brand.whisper : '#fff',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{
          width: 44, height: 44, borderRadius: 14,
          backgroundColor: error ? colors.dangerBg : (accent ? colors.brand.mist : toneBg[tone]),
          alignItems: 'center', justifyContent: 'center',
          marginRight: 14,
        }}>
          <Icon size={20} color={error ? colors.danger : (accent ? colors.brand.deepest : toneFg[tone])} strokeWidth={1.75} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{
              fontSize: 10.5, fontWeight: '700',
              color: error ? colors.danger : (accent ? colors.brand.DEFAULT : colors.muted),
              letterSpacing: 1.2, textTransform: 'uppercase',
            }}>
              {label}
            </Text>
            {dirty && !error && (
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand.DEFAULT }} />
            )}
          </View>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            maxLength={maxLength}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); onBlur?.(); }}
            style={{
              fontSize: 15.5, fontWeight: '700', color: colors.ink,
              paddingVertical: 0, marginTop: 2,
            }}
          />
        </View>
      </View>
      {error && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, marginLeft: 58 }}>
          <AlertCircle size={12} color={colors.danger} strokeWidth={2} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.danger, fontWeight: '500' }}>{error}</Text>
        </View>
      )}
    </View>
  );
}

function LockedListRow({
  icon: Icon,
  tone,
  label,
  value,
  lockedLabel,
}: {
  icon: typeof UserIcon;
  tone: Tone;
  label: string;
  value: string;
  lockedLabel: string;
}) {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: '#fff',
    }}>
      <View style={{
        width: 44, height: 44, borderRadius: 14,
        backgroundColor: toneBg[tone],
        alignItems: 'center', justifyContent: 'center',
        marginRight: 14,
        opacity: 0.85,
      }}>
        <Icon size={20} color={toneFg[tone]} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{
          fontSize: 10.5, fontWeight: '700',
          color: colors.muted, letterSpacing: 1.2, textTransform: 'uppercase',
        }}>
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: '600', color: colors.gray, marginTop: 2 }}
        >
          {value}
        </Text>
      </View>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
        backgroundColor: colors.surface.linen,
        borderWidth: 1, borderColor: colors.border,
        marginLeft: 10,
      }}>
        <Lock size={9} color={colors.muted} strokeWidth={2.5} />
        <Text style={{ fontSize: 9.5, fontWeight: '800', color: colors.muted, letterSpacing: 0.8, textTransform: 'uppercase' }}>
          {lockedLabel}
        </Text>
      </View>
    </View>
  );
}
