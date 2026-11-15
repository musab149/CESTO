/**
 * Draws a numeric badge on top of the admin favicon so the browser tab
 * shows pending-order count even when the admin is on another tab.
 *
 * Spec §2 P362: "new orders trigger browser favicon badge + optional
 * configurable sound ping" on the Orders List page. We hoist it to the
 * layout so the badge tracks unread admin notifications across pages.
 */

const FAVICON_SELECTOR = 'link[rel="icon"]';
const SIZE = 64;

let baseFaviconHref: string | null = null;

function ensureBaseHref(): string | null {
  if (baseFaviconHref) return baseFaviconHref;
  const link = document.querySelector<HTMLLinkElement>(FAVICON_SELECTOR);
  if (!link) return null;
  baseFaviconHref = link.href;
  return baseFaviconHref;
}

async function loadBase(): Promise<HTMLImageElement | null> {
  const href = ensureBaseHref();
  if (!href) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = href;
  });
}

function applyFavicon(dataUrl: string) {
  const link = document.querySelector<HTMLLinkElement>(FAVICON_SELECTOR);
  if (!link) return;
  link.href = dataUrl;
}

export async function setFaviconBadge(count: number): Promise<void> {
  const img = await loadBase();
  if (!img) return;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.drawImage(img, 0, 0, SIZE, SIZE);

  if (count > 0) {
    const label = count > 99 ? '99+' : String(count);
    const radius = SIZE * 0.32;
    const cx = SIZE - radius - 2;
    const cy = radius + 2;

    ctx.fillStyle = '#DC2626';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${label.length > 2 ? 18 : 24}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 1);
  }

  applyFavicon(canvas.toDataURL('image/png'));
}

export function resetFaviconBadge(): void {
  const href = ensureBaseHref();
  if (href) applyFavicon(href);
}

/**
 * Plays a short notification "ping" using the WebAudio API so we don't have
 * to ship an audio file. Two-note chime — quiet, professional, ~180ms.
 */
export function playOrderPing(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.12, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration);
    };

    playTone(880, 0,    0.14);
    playTone(1320, 0.10, 0.18);

    window.setTimeout(() => ctx.close().catch(() => {}), 400);
  } catch {
    // Audio failure is non-fatal; the favicon badge still updates.
  }
}
