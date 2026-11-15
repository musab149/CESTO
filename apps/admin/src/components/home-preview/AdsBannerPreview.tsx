import { ArrowRight, Megaphone, Tag } from 'lucide-react';
import type { AdsBannerConfig, AdsBannerSection } from '@grocery-app/shared';

interface Props {
  config: AdsBannerConfig;
  lang: 'en' | 'es';
}

function pick(section: AdsBannerSection, field: 'eyebrow' | 'title' | 'description' | 'cta', lang: 'en' | 'es') {
  return (section as unknown as Record<string, string>)[`${field}_${lang}`] ?? '';
}

function HeroBlock({ hero, lang }: { hero: AdsBannerSection; lang: 'en' | 'es' }) {
  const hasImage = !!hero.image_url;
  const textCls = hero.text_theme === 'light' ? 'text-white' : 'text-ink';
  const mutedCls = hero.text_theme === 'light' ? 'text-white/80' : 'text-gray';
  const eyebrowBg = hero.text_theme === 'light' ? 'bg-white/15' : 'bg-white/80';
  const eyebrowColor = hero.text_theme === 'light' ? '#FFFFFF' : '#022B91';
  const ctaBg = hero.text_theme === 'light' ? '#FFFFFF' : '#054EE8';
  const ctaText = hero.text_theme === 'light' ? '#022B91' : '#FFFFFF';
  const textShadow = hasImage && hero.text_theme === 'light'
    ? { textShadow: '0 1px 12px rgba(0,0,0,0.55)' }
    : undefined;
  return (
    <div
      className="relative overflow-hidden rounded-lg text-left p-7 md:p-9 flex items-center gap-6 min-h-[180px] md:col-span-2"
      style={{ background: hero.background }}
    >
      {hero.image_url && (
        <img src={hero.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      <div className={`relative flex-1 ${textCls}`}>
        <span
          className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] backdrop-blur px-3 py-1 rounded-full ${eyebrowBg}`}
          style={{ color: eyebrowColor }}
        >
          <Megaphone size={11} strokeWidth={2.5} />
          {pick(hero, 'eyebrow', lang)}
        </span>
        <h3 className="font-display text-[24px] md:text-[30px] mt-3 leading-tight tracking-tight" style={{ fontWeight: 500, ...textShadow }}>
          {pick(hero, 'title', lang)}
        </h3>
        {pick(hero, 'description', lang) && (
          <p className={`text-[13.5px] font-body mt-2 max-w-md leading-relaxed ${mutedCls}`} style={textShadow}>
            {pick(hero, 'description', lang)}
          </p>
        )}
        <span
          className="inline-flex w-fit items-center gap-2 mt-4 h-11 px-6 rounded-full text-[13px] font-bold font-ui"
          style={{ background: ctaBg, color: ctaText }}
        >
          {pick(hero, 'cta', lang)}
          <ArrowRight size={14} strokeWidth={2.5} />
        </span>
      </div>
    </div>
  );
}

function SideBlock({ side, lang }: { side: AdsBannerSection; lang: 'en' | 'es' }) {
  const hasImage = !!side.image_url;
  const textCls = side.text_theme === 'light' ? 'text-white' : 'text-ink';
  const mutedCls = side.text_theme === 'light' ? 'text-white/75' : 'text-ink/70';
  const eyebrowColor = '#E11D48';
  const ctaColor = '#5FA133';
  const textShadow = hasImage && side.text_theme === 'light'
    ? { textShadow: '0 1px 10px rgba(0,0,0,0.55)' }
    : undefined;
  return (
    <div
      className="relative overflow-hidden rounded-lg text-left p-6 flex flex-col justify-between min-h-[180px]"
      style={{ background: side.background }}
    >
      {side.image_url && (
        <img src={side.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      <div className={`relative ${textCls}`}>
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] bg-white/80 px-2.5 py-1 rounded-full"
          style={{ color: eyebrowColor }}
        >
          <Tag size={10} strokeWidth={2.5} />
          {pick(side, 'eyebrow', lang)}
        </span>
        <h4 className="font-display text-[20px] mt-3 leading-tight tracking-tight" style={{ fontWeight: 600, ...textShadow }}>
          {pick(side, 'title', lang)}
        </h4>
        {pick(side, 'description', lang) && (
          <p className={`text-[12.5px] mt-1 line-clamp-2 ${mutedCls}`} style={textShadow}>
            {pick(side, 'description', lang)}
          </p>
        )}
      </div>
      <span
        className="relative text-[12px] font-bold inline-flex items-center gap-1 mt-3"
        style={{ color: ctaColor, ...textShadow }}
      >
        {pick(side, 'cta', lang)}
        <ArrowRight size={12} strokeWidth={2.5} />
      </span>
    </div>
  );
}

export default function AdsBannerPreview({ config, lang }: Props) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <HeroBlock hero={config.hero} lang={lang} />
      <SideBlock side={config.side} lang={lang} />
    </section>
  );
}
