import { Shield } from 'lucide-react-native';
import { useStoreSettings } from '@grocery-app/shared';
import LegalDocumentScreen from '../src/components/LegalDocumentScreen';

export default function TermsScreen() {
  const { data: settings } = useStoreSettings();

  return (
    <LegalDocumentScreen
      icon={Shield}
      titleEs="Términos y Condiciones"
      titleEn="Terms & Conditions"
      body={settings?.termsConditions?.trim()}
    />
  );
}
