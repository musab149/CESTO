import type { CSSProperties } from 'react';

/*
 * A logo's plate, and a shop's banner when it has no cover (2026-10-28, user,
 * of the dark shop: "what about this product images background and what
 * about the white background color in brands cards").
 *
 * The office picks a background for each logo — white, nearly always. In the
 * light that plate is as chosen. In the dark a white plate glared off the
 * navy, so a PALE plate (`is-pale`) softens to the photo frame's grey and its
 * logo is multiplied into it, the logo's own white going grey with it
 * (app.css). A plate in a real colour keeps it in both themes.
 */

/** Near white (a hex colour above 0.8 relative luminance). Anything else — a colour, a var() — is not. */
export function isPale(color: string | null | undefined): boolean {
  if (!color) return true;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return false;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4) > 0.8;
}

/** The class and style for a logo's plate: its colour, or `fallback` without one. */
export function logoPlate(bg: string | null | undefined, fallback = '#FFFFFF'): { className: string; style: CSSProperties } {
  const color = bg || fallback;
  return {
    className: isPale(color) ? 'logo-plate is-pale' : 'logo-plate',
    style: { '--plate': color } as CSSProperties,
  };
}

/**
 * A shop's banner with no cover: its logo's colour washing into the page's.
 * A pale logo colour takes the theme's own start instead, so in the dark the
 * band is navy rather than a white glare.
 */
export function bannerWash(logoBg: string | null | undefined, end = 'var(--color-banner-end)', paleStart = 'var(--color-banner-start)'): string {
  const start = isPale(logoBg) ? paleStart : (logoBg as string);
  return `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
}

/**
 * The class for a tile the office painted — a promo tile, an ad, the stores
 * hero (2026-10-29). Its words are chosen against its background: light on a
 * dark one, which reads in both themes as it is. Dark words on a pale one
 * would be the light ink in the dark, so the tile is washed toward navy
 * (app.css `tile-wash`) — or, over a picture, which stays as it was shot,
 * keeps the light palette (`keep-light`).
 */
export function paintedTile(textTheme: string | null | undefined, hasImage: boolean): string {
  if (textTheme === 'light') return '';
  return hasImage ? 'keep-light' : 'tile-wash';
}
