import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { generateTempPassword, storefrontLoginUrl } from './credentials';
import { sendClientWelcomeEmail, resolveEmailLang, mailerDelivers } from './mailer';

/**
 * A client's shop login, issued by somebody else: staff (admin users route)
 * or the rep who serves them (sales clients route). One implementation, so
 * the rotation, the sign-out and the email cannot drift between the two.
 */

/**
 * How a client gets into the shop today.
 *
 *   none      — no password and no Google/Apple sign-in: nothing to log in with.
 *   temporary — a password somebody issued them, not yet replaced. Single use
 *               by construction: the login answers `must_change_password`.
 *   own       — a password they chose, or Google/Apple. Nobody else knows it.
 *
 * A rep may issue credentials for the first two only (sales clients route):
 * replacing one the client chose would lock them out and hand the rep their
 * account. Staff may in all three — the office is where a client who forgot
 * theirs is sent.
 */
export type ClientAccess = 'none' | 'temporary' | 'own';

export function accessOf(u: {
  password_hash: string | null;
  password_is_temp: boolean;
  google_id: string | null;
  apple_id: string | null;
}): ClientAccess {
  if (u.password_hash) return u.password_is_temp ? 'temporary' : 'own';
  return u.google_id || u.apple_id ? 'own' : 'none';
}

export const ACCESS_SELECT = { password_hash: true, password_is_temp: true, google_id: true, apple_id: true } as const;

export interface IssuedCredentials {
  tempPassword: string;
  emailSent: boolean;
  /** Why nothing was mailed, when nothing was. */
  reason: string | null;
}

/**
 * A new temporary password in place of whatever the account had, and every
 * session ended. The rotation itself, shared by a client's login and a
 * partner's (lib/partnerAccess) — one place for "the old password is dead and
 * nobody is still signed in with it".
 */
export async function rotateToTempPassword(userId: string): Promise<string> {
  const tempPassword = generateTempPassword(12);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { password_hash: passwordHash, password_is_temp: true },
    });
    // A live refresh token would otherwise outlive the rotation.
    await tx.userRefreshToken.deleteMany({ where: { user_id: userId } });
  });
  return tempPassword;
}

/**
 * Give the client a new temporary password, and mail it or not.
 *
 * ROTATE FIRST, then send. If the mail then fails, the old password is
 * already dead, which is the safe direction to fail in: nobody is left
 * holding a credential we believe we replaced.
 *
 * IT ALSO SIGNS THEM OUT, right now, on every device — that is what deleting
 * the refresh tokens does, and it is why callers warn before this runs rather
 * than tell afterwards. A customer mid-basket loses the session they were
 * shopping in.
 *
 * A failed email is not an error: the rotation is the part that committed,
 * and the caller has to hand the password over another way.
 */
export async function issueClientCredentials(
  user: {
    id: string;
    email: string;
    name: string;
    sales_manager_name: string | null;
    preferred_language: string | null;
    business_profile: { company: string } | null;
  },
  sendEmail: boolean,
): Promise<IssuedCredentials> {
  const tempPassword = await rotateToTempPassword(user.id);

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[client-credentials] email=${user.email} tempPassword=${tempPassword}`);
  }

  // Both ways of not delivering collapse into one answer, because the next
  // move is the same for both: find another way to hand it over. `reason`
  // says which it was.
  let emailSent = false;
  let reason: string | null = null;
  if (!sendEmail) {
    reason = 'Not sent — the password was issued to be handed over directly.';
  } else if (!mailerDelivers) {
    reason = 'No email provider is configured in this environment.';
  } else {
    try {
      await sendClientWelcomeEmail({
        to: user.email,
        name: user.name,
        companyName: user.business_profile?.company ?? null,
        salesManagerName: user.sales_manager_name,
        loginUrl: storefrontLoginUrl(),
        loginEmail: user.email,
        tempPassword,
        lang: resolveEmailLang(user.preferred_language),
      });
      emailSent = true;
    } catch (mailErr) {
      console.error('[client-credentials] email failed after password rotation', mailErr);
      reason = mailErr instanceof Error ? mailErr.message : String(mailErr);
    }
  }

  return { tempPassword, emailSent, reason };
}
