import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Globe } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

const LANGUAGES: { code: 'en' | 'es'; native: string; english: string; flag: string }[] = [
  { code: 'es', native: 'Español', english: 'Spanish', flag: '🇪🇸' },
  { code: 'en', native: 'English', english: 'English', flag: '🇬🇧' },
];

export default function LanguagePage() {
  const navigate = useNavigate();
  const { lang, setLang, t } = useLanguageStore();

  return (
    <div className="max-w-[680px] mx-auto px-6 lg:px-10 py-8">
      <button
        onClick={() => navigate('/profile')}
        className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-brand transition-colors mb-6"
      >
        <ArrowLeft size={16} />
        {t('common.back') || 'Back'}
      </button>

      <div className="flex items-center gap-3 mb-2">
        <Globe size={28} className="text-brand" strokeWidth={1.75} />
        <h1 className="text-3xl font-extrabold text-ink font-display">{t('profile.language')}</h1>
      </div>
      <p className="text-sm text-gray font-body mb-8">
        Choose the language used across the app. Changes apply instantly.
      </p>

      <div className="flex flex-col gap-3">
        {LANGUAGES.map((l) => {
          const selected = lang === l.code;
          return (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              className={`flex items-center gap-4 p-5 rounded-lg border-2 text-left transition-all ${
                selected
                  ? 'border-brand bg-brand-mist/30'
                  : 'border-border bg-surface-white hover:border-brand-soft'
              }`}
            >
              <span className="text-3xl">{l.flag}</span>
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-ink font-display">{l.native}</p>
                <p className="text-xs text-muted font-body">{l.english}</p>
              </div>
              {selected && (
                <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center">
                  <Check size={16} strokeWidth={2.5} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
