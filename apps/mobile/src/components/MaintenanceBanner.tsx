import { View, Text } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { useStoreSettings } from '@grocery-app/shared';
import { colors } from '../constants/colors';
import { useLanguageStore } from '../stores/languageStore';

/**
 * Surfaces the admin's "Maintenance mode" toggle, the same way web does in
 * CustomerLayout.
 *
 * Deliberately NON-BLOCKING, matching web: the app stays fully usable so
 * support can still walk a customer through a flow while the shop is paused.
 * It is a warning, not a gate.
 *
 * Mobile had nothing here at all, which meant flipping maintenance mode took
 * the website down politely while the app carried on taking orders against a
 * back end that had been paused on purpose.
 *
 * Colour differs from web ON PURPOSE. Web's banner uses the `amber-*` tokens,
 * but those were repurposed to the fresh-green accent (#7FC646) in a rename and
 * the banner was never revisited — so web currently shows a GREEN maintenance
 * warning. This uses the real warning tokens instead. Worth fixing on web too,
 * rather than copying the artefact across for the sake of matching.
 *
 * Placement note: this renders at the top of the root view, above the Stack.
 * On Android — the only platform this app ships to — the status bar is opaque
 * and the root view already starts beneath it, so no inset handling is needed.
 * If iOS is ever added, this needs the top safe-area inset and the screens
 * below need to stop adding their own, or the banner lands in the notch.
 */
export default function MaintenanceBanner() {
  const { data: settings } = useStoreSettings();
  const { lang } = useLanguageStore();

  if (settings?.maintenanceMode !== true) return null;

  return (
    <View
      style={{
        backgroundColor: colors.warningBg,
        borderBottomWidth: 1,
        borderBottomColor: colors.warning,
        paddingHorizontal: 16,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <AlertTriangle size={16} color={colors.warning} strokeWidth={2} />
      <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.ink, lineHeight: 17 }}>
        {lang === 'es'
          ? 'Estamos realizando tareas de mantenimiento. Algunas funciones pueden no estar disponibles.'
          : 'We are performing maintenance right now. Some features may be temporarily unavailable.'}
      </Text>
    </View>
  );
}
