import { FileText } from 'lucide-react-native';
import { useStoreSettings } from '@grocery-app/shared';
import LegalDocumentScreen from '../src/components/LegalDocumentScreen';

export default function PrivacyScreen() {
  const { data: settings } = useStoreSettings();

  return (
    <LegalDocumentScreen
      icon={FileText}
      titleEs="Política de Privacidad"
      titleEn="Privacy Policy"
      body={settings?.privacyPolicy?.trim()}
    />
  );
}
