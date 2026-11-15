import { useState } from 'react';
import { Package } from 'lucide-react';
import { resolveImageUrl, type ImagePreset } from '@grocery-app/shared';

/**
 * A product's photo, or the parcel when there is none — or when it does not
 * load (2026-10-29). A photo that 404s, or a CDN that stops serving (the Bunny
 * account ran dry on 2026-09-23 and every image went at once), otherwise
 * leaves an empty square where the product should be. Centre it in a flex
 * box: the parcel sits where the photo would have.
 */
export default function Photo({ url, preset, alt = '', className = '', icon = 20 }: {
  url: string | null | undefined;
  preset?: ImagePreset;
  alt?: string;
  className?: string;
  icon?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return <Package size={icon} strokeWidth={1.5} className="text-muted/60" aria-hidden="true" />;
  return (
    <img
      src={resolveImageUrl(url, preset)}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(url)}
      className={`mix-blend-multiply ${className}`}
    />
  );
}
