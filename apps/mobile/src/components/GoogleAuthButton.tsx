import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { colors } from '../constants/colors';
import { useAuthStore } from '../stores/authStore';

// Ensures the OAuth popup resolves cleanly on iOS/Android.
WebBrowser.maybeCompleteAuthSession();

interface Props {
  onSuccess: () => void;
  onError: (message: string) => void;
}

// Custom-styled Google button for mobile. Uses Expo's Google provider with the
// implicit flow to obtain an access_token, which the API resolves to a profile
// via Google's userinfo endpoint (same shape the web button hands the server).
export default function GoogleAuthButton({ onSuccess, onError }: Props) {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  // Without at least a web client ID, useAuthRequest can't form a valid request.
  // Render a disabled stub so the screen still lays out cleanly.
  if (!webClientId) return <DisabledGoogleButton reason="EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID not set" />;

  return (
    <LiveGoogleButton
      webClientId={webClientId}
      iosClientId={iosClientId}
      androidClientId={androidClientId}
      onSuccess={onSuccess}
      onError={onError}
    />
  );
}

interface LiveProps extends Props {
  webClientId: string;
  iosClientId?: string;
  androidClientId?: string;
}

function LiveGoogleButton({ webClientId, iosClientId, androidClientId, onSuccess, onError }: LiveProps) {
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const [loading, setLoading] = useState(false);

  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: webClientId,
    iosClientId,
    androidClientId,
    scopes: ['openid', 'email', 'profile'],
  });

  useEffect(() => {
    if (response?.type !== 'success') {
      if (response?.type === 'error') onError('Google sign-in failed. Please try again.');
      return;
    }
    const accessToken = response.authentication?.accessToken;
    if (!accessToken) {
      onError('Google did not return an access token.');
      return;
    }
    void (async () => {
      setLoading(true);
      const res = await loginWithGoogle(accessToken);
      setLoading(false);
      if (!res.ok) {
        onError(res.error ?? 'Google sign-in failed.');
        return;
      }
      onSuccess();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  return (
    <TouchableOpacity
      style={[styles.button, (!request || loading) && styles.buttonDisabled]}
      onPress={() => { void promptAsync(); }}
      disabled={!request || loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <>
          <GoogleGlyph />
          <Text style={styles.buttonText}>Continue with Google</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function DisabledGoogleButton({ reason }: { reason: string }) {
  return (
    <View>
      <TouchableOpacity
        style={[styles.button, styles.buttonDisabled]}
        activeOpacity={1}
        disabled
        accessibilityHint={reason}
      >
        <GoogleGlyph />
        <Text style={[styles.buttonText, { color: colors.muted }]}>Continue with Google</Text>
      </TouchableOpacity>
    </View>
  );
}

function GoogleGlyph() {
  return (
    <Svg viewBox="0 0 24 24" width={18} height={18}>
      <Path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <Path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <Path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <Path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.surface.cream,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { fontSize: 14, fontWeight: '600', color: colors.ink },
});
