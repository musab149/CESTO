import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { generateTempPassword, storefrontLoginUrl } from './credentials';
import { accessOf, ACCESS_SELECT, rotateToTempPassword, type ClientAccess } from './clientCredentials';
import { sendPartnerAccessEmail, resolveEmailLang, mailerDelivers } from './mailer';
import { slugifyStoreName, makeUniqueStoreSlug } from './storeSlug';

/**
 * A partner made by Cesto rather than by an application (2026-10-31, user:
 * "we used to have this option that we were able to connect the store to a
 * user… create a new store or link existing store… when we link a store to a
 * user then that user becomes a partner… and we should have that credentials
 * resend functionality for that too").
 *
 * The application route (routes/admin/leads → approve) still does its own
 * thing: it answers an application, records it, and always issues a new
 * password. This is the same act without one — the office giving somebody a
 * store — and so it differs in the two places that follow from that:
 *
 *   · A PASSWORD THEY CHOSE IS KEPT. Somebody who already shops here keeps
 *     signing in the way they do; nobody hands their account a password they
 *     did not ask for (the same rule as creating a client, lib/createClient).
 *     Only an account with no password of its own, or a new one, gets a
 *     temporary password.
 *   · ANY STORE WITH NO PARTNER may be linked, not only the ones Cesto set up
 *     (the application picker's rule, GET /stores/linkable). The admin is
 *     naming one store on purpose here — often on that store's own page — and a
 *     store whose partner was unlinked by mistake has to be able to get one
 *     back. A store that has ANY role, active or not, must be unlinked first:
 *     two people quietly sharing a storefront is the failure this guards.
 *
 * Becoming a partner is having an active PartnerStoreRole: that is all the
 * partner area checks (middleware/partnerAuth). The PartnerProfile written
 * alongside is the record of who was onboarded, by whom and onto what.
 */

export class PartnerAccessError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface NewStoreInput {
  name: string;
  contact_email?: string | null;
  contact_phone?: string | null;
}

export interface LinkPartnerInput {
  user: { name: string; email: string };
  /** One of the two: a store that exists, or one to create for them. */
  storeId?: string;
  store?: NewStoreInput;
  sendEmail: boolean;
  adminId: string | null;
}

export interface LinkPartnerResult {
  store_id: string;
  store_name: string;
  store_status: string;
  store_created: boolean;
  user_id: string;
  user_created: boolean;
  /** `issued` — a temporary password was set; `kept` — their own one stands. */
  password: 'issued' | 'kept';
  login_email: string;
  temp_password: string | null;
  email_sent: boolean;
  /** Why nothing was mailed, when nothing was. */
  reason: string | null;
}

/** The person by email: the exact lowercase row first, then an older mixed-case one. */
async function findByEmail(email: string) {
  const select = { id: true, name: true, email: true, status: true, preferred_language: true, ...ACCESS_SELECT } as const;
  return (await prisma.user.findUnique({ where: { email }, select }))
    ?? prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select });
}

/** The stores this person actively manages, by name — what the mail lists. */
async function storeNamesOf(userId: string): Promise<string[]> {
  const roles = await prisma.partnerStoreRole.findMany({
    where: { user_id: userId, is_active: true, store: { deleted_at: null } },
    select: { store: { select: { name: true } } },
    orderBy: { created_at: 'asc' },
  });
  return roles.map((r) => r.store.name);
}

/**
 * Mail what was done, or say why not. Never throws: by the time this runs the
 * link (or the rotation) has committed, and a mail that did not go is
 * something to tell the admin, not a reason to report the whole act failed.
 */
async function mail(
  user: { email: string; name: string; preferred_language: string | null },
  kind: 'linked' | 'credentials',
  storeNames: string[],
  tempPassword: string | null,
  sendEmail: boolean,
): Promise<{ email_sent: boolean; reason: string | null }> {
  if (!sendEmail) return { email_sent: false, reason: 'Not sent — you chose to hand it over yourself.' };
  if (!mailerDelivers) return { email_sent: false, reason: 'No email provider is configured in this environment.' };
  try {
    await sendPartnerAccessEmail({
      to: user.email,
      name: user.name,
      kind,
      storeNames,
      loginUrl: storefrontLoginUrl(),
      loginEmail: user.email,
      tempPassword,
      lang: resolveEmailLang(user.preferred_language),
    });
    return { email_sent: true, reason: null };
  } catch (err) {
    console.error(`[partner-access] ${kind} email failed after commit`, err);
    return { email_sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Make somebody the partner of a store: an existing store, or a new one made
 * for them. They become its owner; the mail (if asked for) says so and carries
 * a temporary password when one was issued.
 */
export async function linkPartner(input: LinkPartnerInput): Promise<LinkPartnerResult> {
  if (!!input.storeId === !!input.store) {
    throw new PartnerAccessError(422, 'Choose a store: an existing one, or a new one to create.');
  }
  const email = input.user.email.trim().toLowerCase();
  const name = input.user.name.trim();

  const existing = await findByEmail(email);
  if (existing?.status === 'blocked') {
    throw new PartnerAccessError(422, 'That account is blocked. Unblock it before giving it a store.');
  }
  if (!existing && !name) throw new PartnerAccessError(422, 'A new account needs a name.');

  // A password they chose stands; anybody else gets a temporary one.
  const access: ClientAccess | null = existing ? accessOf(existing) : null;
  const issue = access !== 'own';
  const tempPassword = issue ? generateTempPassword(12) : null;
  const passwordHash = tempPassword ? await bcrypt.hash(tempPassword, 12) : null;

  // Worked out before the transaction: it reads the whole table, and two
  // stores with one name would still differ by the suffix it adds.
  const slug = input.store ? await makeUniqueStoreSlug(slugifyStoreName(input.store.name)) : null;

  const done = await prisma.$transaction(async (tx) => {
    // 1. The store — checked HERE, inside the transaction, not trusted from
    //    the screen: two admins giving the same store to two people would
    //    otherwise both pass, and the role below would not collide (the users
    //    differ).
    let store: { id: string; name: string; status: string };
    let storeCreated = false;
    if (input.storeId) {
      // Locked, so a second link of the same store waits for this one and
      // then sees its partner. A plain read is not enough: under read
      // committed both would count zero partners and both would commit.
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${input.storeId}::uuid FOR UPDATE`;
      const s = await tx.store.findUnique({
        where: { id: input.storeId },
        select: {
          id: true, name: true, status: true, deleted_at: true, deletion_scheduled_at: true,
          _count: { select: { partner_roles: true } },
        },
      });
      if (!s) throw new PartnerAccessError(404, 'That store no longer exists.');
      if (s.deleted_at) throw new PartnerAccessError(409, 'That store is deleted. Restore it first.');
      if (s.deletion_scheduled_at) throw new PartnerAccessError(409, 'That store is scheduled for deletion. Cancel the deletion before giving it a partner.');
      if (s._count.partner_roles > 0) throw new PartnerAccessError(409, 'That store already has a partner. Unlink them first, or choose another store.');
      store = { id: s.id, name: s.name, status: s.status };
    } else {
      const s = await tx.store.create({
        data: {
          slug: slug!,
          name: input.store!.name.trim(),
          contact_email: input.store!.contact_email || null,
          contact_phone: input.store!.contact_phone || null,
          // Made for this partner, so not unclaimed inventory: it stays out of
          // the application picker even if they are unlinked later.
          created_via: 'partner_approval',
          // Hidden until somebody publishes it from its page, as an approved
          // application's store starts.
          status: 'draft',
          is_active: true,
        },
        select: { id: true, name: true, status: true },
      });
      store = s;
      storeCreated = true;
    }

    // 2. The person.
    let userId: string;
    let userCreated = false;
    if (existing) {
      userId = existing.id;
      if (passwordHash) {
        await tx.user.update({ where: { id: userId }, data: { password_hash: passwordHash, password_is_temp: true } });
        // A session opened with the password being replaced must not outlive it.
        await tx.userRefreshToken.deleteMany({ where: { user_id: userId } });
      }
    } else {
      const u = await tx.user.create({
        data: { name, email, password_hash: passwordHash, password_is_temp: true },
        select: { id: true },
      });
      userId = u.id;
      userCreated = true;
    }

    // 3. The role — what makes them a partner.
    await tx.partnerStoreRole.create({
      data: { user_id: userId, store_id: store.id, role: 'owner', is_active: true },
    });

    // 4. The record. One per person: somebody already a partner keeps the one
    //    they have (it names the store they came with), a first-timer gets one
    //    naming this store.
    await tx.partnerProfile.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        company: store.name,
        contact_phone: input.store?.contact_phone || null,
        linked_store_id: store.id,
        linked_existing: !storeCreated,
        approved_by_admin_id: input.adminId,
      },
      update: {},
    });

    return { store, storeCreated, userId, userCreated };
  });

  if (tempPassword && process.env.NODE_ENV !== 'production') {
    console.log(`[partner-access] linked email=${email} tempPassword=${tempPassword}`);
  }
  // The address on file, which is the login: an older account may hold it in
  // mixed case (sign-in tolerates that), and it is what they will type.
  const loginEmail = existing?.email ?? email;
  const person = { email: loginEmail, name: existing?.name || name, preferred_language: existing?.preferred_language ?? null };
  const sent = await mail(person, 'linked', [done.store.name], tempPassword, input.sendEmail);

  return {
    store_id: done.store.id,
    store_name: done.store.name,
    store_status: done.store.status,
    store_created: done.storeCreated,
    user_id: done.userId,
    user_created: done.userCreated,
    password: tempPassword ? 'issued' : 'kept',
    login_email: loginEmail,
    temp_password: tempPassword,
    ...sent,
  };
}

/**
 * A partner's login again: a new temporary password, every session ended, and
 * the partner mail (which names their stores) rather than the shop's client
 * one. The same shape as the client and rep routes answer, so the admin's one
 * credentials dialog renders all three.
 */
export async function issuePartnerCredentials(userId: string, sendEmail: boolean) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, status: true, preferred_language: true },
  });
  if (!user) throw new PartnerAccessError(404, 'Account not found.');
  if (!user.email) throw new PartnerAccessError(422, 'This account has no email address — its email is its login.');
  if (user.status === 'blocked') throw new PartnerAccessError(422, 'This account is blocked. Unblock it first.');
  const stores = await storeNamesOf(user.id);
  if (stores.length === 0) throw new PartnerAccessError(422, 'This account does not manage a store.');

  const tempPassword = await rotateToTempPassword(user.id);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[partner-access] credentials email=${user.email} tempPassword=${tempPassword}`);
  }
  const sent = await mail({ ...user, email: user.email }, 'credentials', stores, tempPassword, sendEmail);
  return {
    rotated: true as const,
    login_email: user.email,
    temp_password: tempPassword,
    ...sent,
    message: sent.email_sent ? 'New credentials sent.' : 'New credentials issued.',
  };
}
