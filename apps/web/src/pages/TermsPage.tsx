import { Shield } from 'lucide-react';
import { useStoreSettings } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import LegalDocumentPage from '@/components/LegalDocumentPage';

export default function TermsPage() {
  const { t } = useLanguageStore();
  const { data: settings, isLoading } = useStoreSettings();

  return (
    <LegalDocumentPage
      icon={Shield}
      title={t('profile.terms')}
      body={settings?.termsConditions?.trim()}
      isLoading={isLoading}
    />
  );
}
