import { useNavigate } from 'react-router-dom';
import { businessPathFor } from '@grocery-app/shared';

/**
 * Where a link the team wrote in Admin → Business home goes: a web address in
 * a new tab, a panel path as it is, and a shop path (/products/…, /stores/…)
 * to the panel's own page for it — a business does not shop the storefront.
 */
export function useOpenLink() {
  const navigate = useNavigate();
  return (link: string) => {
    const to = link.trim();
    if (!to) return;
    if (/^https?:\/\//.test(to)) {
      window.open(to, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(to.startsWith('/business') ? to : businessPathFor(to.split(/[?#]/)[0]));
  };
}
