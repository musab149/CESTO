/**
 * Cesto brand mark — a stylised "C" with a fresh-green accent arc.
 *
 * Renders the icon in two modes:
 *   • Default — uses brand blue + accent green (matches the rebrand)
 *   • `monochrome` — uses currentColor for both strokes (for dark/white
 *     surfaces like the sidebar on a coloured background)
 */
export default function CestoLogo({
  size = 24,
  className = '',
  monochrome = false,
}: {
  size?: number;
  className?: string;
  monochrome?: boolean;
}) {
  const main = monochrome ? 'currentColor' : '#054EE8';
  const accent = monochrome ? 'currentColor' : '#7FC646';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      width={size}
      height={size}
      className={className}
      aria-label="Cesto"
      role="img"
    >
      <path
        d="M18.5 7.5A8 8 0 1 0 18.5 16.5"
        stroke={main}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      <path
        d="M9 16.2A7 7 0 0 0 14.5 18"
        stroke={accent}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
