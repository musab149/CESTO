import { useState } from 'react';
import { ShoppingBasket } from 'lucide-react';
import { resolveImageUrl } from '@grocery-app/shared';

/**
 * A product's small picture in the cart, the cart drawer and checkout — or a
 * placeholder when it has none.
 *
 * These spots used to render the <img> only when there was a URL, so a
 * product without a picture left an empty box in the line, and one whose
 * picture failed to load showed the browser's broken-image icon. Both now
 * show a soft tile with a basket, the same mark the cart uses elsewhere.
 *
 * Fills its parent: the caller's box sets the size and the corners.
 */
export default function ProductThumb({ url, fit = 'cover', iconSize = 22 }: {
  url?: string | null;
  fit?: 'cover' | 'contain';
  iconSize?: number;
}) {
  // Remembered per URL, so a line whose product changes gets a fresh try.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url) {
    return (
      <span aria-hidden="true" className="w-full h-full flex items-center justify-center bg-surface-linen text-muted">
        <ShoppingBasket size={iconSize} strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <img
      src={resolveImageUrl(url, 'thumb')}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedUrl(url)}
      // An empty or zero-byte response "loads" with no pixels.
      onLoad={(e) => { if (e.currentTarget.naturalWidth === 0) setFailedUrl(url); }}
      className={`w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`}
    />
  );
}
