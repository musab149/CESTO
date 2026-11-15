import { FileText } from 'lucide-react';
import { useStoreSettings } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import LegalDocumentPage from '@/components/LegalDocumentPage';

export default function PrivacyPage() {
  const { t } = useLanguageStore();
  const { data: settings, isLoading } = useStoreSettings();

  return (
    <LegalDocumentPage
      icon={FileText}
      title={t('profile.privacy')}
      body={settings?.privacyPolicy?.trim()}
      isLoading={isLoading}
    />
  );
}
