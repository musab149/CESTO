import prisma from './prisma';
import { APP_CONTENT_KEY, DEFAULT_APP_CONTENT, type AppContent } from './appContentDefaults';

/**
 * Reading app content, shared by the public and admin routes.
 *
 * Merged section by section over the defaults rather than returned raw. A row
 * saved before a section existed is missing that key entirely, and a client
 * that expects it would otherwise render undefined — which on a phone means a
 * blank screen, in a build nobody can hotfix. Merging keeps old rows valid
 * forever, at the cost of one shallow spread.
 */
export function mergeAppContent(stored: Partial<AppContent> | null | undefined): AppContent {
  if (!stored) return DEFAULT_APP_CONTENT;
  return {
    onboarding: stored.onboarding ?? DEFAULT_APP_CONTENT.onboarding,
    about: stored.about ?? DEFAULT_APP_CONTENT.about,
    rashan: stored.rashan ?? DEFAULT_APP_CONTENT.rashan,
    ribbon: stored.ribbon ?? DEFAULT_APP_CONTENT.ribbon,
  };
}

export async function readAppContent(): Promise<AppContent> {
  const row = await prisma.appSetting.findUnique({ where: { key: APP_CONTENT_KEY } });
  return mergeAppContent((row?.config ?? null) as Partial<AppContent> | null);
}
