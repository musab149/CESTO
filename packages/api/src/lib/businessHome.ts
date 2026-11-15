import prisma from './prisma';
import { madridToday } from './repEarnings';
import { BUSINESS_HOME_KEY, DEFAULT_BUSINESS_HOME, type BusinessHomeContent } from './businessHomeDefaults';

/**
 * Reading the business home's content, shared by the admin and business
 * routes. Merged section by section over the defaults, as App content is: a
 * row saved before a section existed is missing that key, and the panel would
 * otherwise draw undefined.
 */
export function mergeBusinessHome(stored: Partial<BusinessHomeContent> | null | undefined): BusinessHomeContent {
  if (!stored) return DEFAULT_BUSINESS_HOME;
  return {
    intro: stored.intro ?? DEFAULT_BUSINESS_HOME.intro,
    promotions: stored.promotions ?? DEFAULT_BUSINESS_HOME.promotions,
    logistics: stored.logistics ?? DEFAULT_BUSINESS_HOME.logistics,
    banners: stored.banners ?? DEFAULT_BUSINESS_HOME.banners,
    announcements: stored.announcements ?? DEFAULT_BUSINESS_HOME.announcements,
  };
}

export async function readBusinessHome(): Promise<BusinessHomeContent> {
  const row = await prisma.appSetting.findUnique({ where: { key: BUSINESS_HOME_KEY } });
  return mergeBusinessHome((row?.config ?? null) as Partial<BusinessHomeContent> | null);
}

/**
 * What a business is sent: the same shape, with only what is live in it —
 * switched-off promotions and announcements left out, and an announcement
 * about a day gone by (in Spain) dropped the day after, so nobody has to come
 * back and clear it. The dated ones come soonest first, then the undated in
 * the order the team put them. Banners and promotions that are off are left
 * out; logistics keeps its `is_active`, and the panel leaves it out when off.
 */
export function publishedBusinessHome(content: BusinessHomeContent, today: string = madridToday()): BusinessHomeContent {
  const live = content.announcements.filter((a) => a.is_active && (!a.date || a.date >= today));
  const dated = live.filter((a) => a.date).sort((a, b) => a.date!.localeCompare(b.date!));
  return {
    ...content,
    promotions: content.promotions.filter((p) => p.is_active),
    // Only the banner's own fields: a row saved before banners were images only still holds words.
    banners: content.banners
      .filter((b) => b.is_active && !!b.image_url)
      .map(({ id, is_active, link, image_url, image_mobile_url }) => ({ id, is_active, link, image_url, image_mobile_url })),
    announcements: [...dated, ...live.filter((a) => !a.date)],
  };
}
