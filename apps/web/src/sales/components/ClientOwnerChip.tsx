import type { SalesClientOwner, SalesClientRelation } from '@grocery-app/shared';
import { useSalesT } from '../lib/i18n';
import { CLIENT_OWNER_TONE, ownerKeyOf } from '../lib/clientOwner';

/** Whose a client is, as a tag: "Tu cliente", "De otro comercial", "De la oficina", "Cliente de la tienda". Never who. */
export default function ClientOwnerChip({ relation, owner, className = '' }: {
  relation?: SalesClientRelation;
  owner?: SalesClientOwner | null;
  className?: string;
}) {
  const t = useSalesT();
  const key = ownerKeyOf(relation, owner);
  const tone = CLIENT_OWNER_TONE[key];
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 pl-2 pr-2.5 rounded-full text-[12px] font-semibold font-display whitespace-nowrap ${tone.bg} ${tone.text} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} aria-hidden="true" />
      {t(`sales.clients.owner.${key}`)}
    </span>
  );
}
