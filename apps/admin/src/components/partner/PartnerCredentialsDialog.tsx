import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useResendPartnerCredentials, type AdminResendCredentialsResult } from '@grocery-app/shared';
import CredentialsDialog from '@/components/CredentialsDialog';
import { useToast } from '@/components/Toast';

/**
 * A partner's login again (2026-10-31, user: "we should have that credentials
 * resend functionality for that too"): the shared credentials dialog, on the
 * partner route — which mails the partner wording, naming their stores — and
 * with what a rotation costs a partner said up front.
 *
 * One component for the three places it opens from (the store's Partner tab,
 * a Vendors row, the person's own page), so the warning is written once.
 */
export default function PartnerCredentialsDialog({ partner, onClose }: {
  partner: { id: string; name: string; email: string | null } | null;
  onClose: () => void;
}) {
  if (!partner) return null;
  // Remounted per person, so one partner's password never shows for the next.
  return <Inner key={partner.id} partner={partner} onClose={onClose} />;
}

function Inner({ partner, onClose }: {
  partner: { id: string; name: string; email: string | null };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const resend = useResendPartnerCredentials();
  const [issued, setIssued] = useState<AdminResendCredentialsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A mail that did not go is not a failure: the password on screen is live.
  const issue = (sendEmail: boolean) => {
    setError(null);
    resend.mutate(
      { userId: partner.id, sendEmail },
      {
        onSuccess: (result) => {
          setIssued(result);
          if (result.email_sent) {
            toast.success(
              t('partners.resend.sent', 'New login sent'),
              t('partners.resend.sentBody', 'Their previous password no longer works.'),
            );
          }
        },
        onError: (e) => setError(e instanceof Error ? e.message : String(e)),
      },
    );
  };

  return (
    <CredentialsDialog
      open
      title={t('partners.resend.title', 'New login for {{name}}?', { name: partner.name })}
      body={t('partners.resend.body', 'This issues a NEW temporary password — the one they have cannot be read back. It stops working the moment you confirm, and they are signed out everywhere, in the middle of whatever they were doing in their store. The email tells them how to reach their store.')}
      issuedTitle={t('partners.resend.issuedTitle', 'New login for {{name}}', { name: partner.name })}
      issuedHint={t('partners.resend.issuedHint', 'Shown once. Their previous password no longer works. They choose their own when they sign in.')}
      email={partner.email ?? ''}
      pending={resend.isPending}
      error={error}
      issued={issued}
      onEmail={() => issue(true)}
      onShow={() => issue(false)}
      onClose={onClose}
    />
  );
}
