import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';

// Load .env before importing modules that read process.env at module load
// (e.g. lib/jwt.ts, which now throws if JWT_* secrets are missing).
dotenv.config();

import { errorHandler } from './middleware/error';
import { requireAdmin, requireOwnPassword, confineLawyers } from './middleware/adminAuth';
import { requirePartnerRole } from './middleware/partnerAuth';
import { optionalAuth } from './middleware/auth';
import { b2bPricingGuard } from './lib/pricing';
import { error as errorResponse } from './lib/response';
import { logMvFlags } from './lib/mv-flags';

// Customer-facing
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import addressesRoutes from './routes/addresses';
import categoriesRoutes from './routes/categories';
import productsRoutes from './routes/products';
import reviewsRoutes from './routes/reviews';
import productTypesRoutes from './routes/productTypes';
import storesRoutes from './routes/stores';
import searchRoutes from './routes/search';
import cartRoutes from './routes/cart';
import ordersRoutes from './routes/orders';
import bannersRoutes from './routes/banners';
import homeSectionsRoutes from './routes/homeSections';
import appContentRoutes from './routes/appContent';
import uploadsRoutes from './routes/uploads';
import rashanRoutes from './routes/rashan';
import rashanLeadsRoutes from './routes/rashanLeads';
import homeGroceryPlanRoutes from './routes/homeGroceryPlan';
import leadsRoutes from './routes/leads';
import helpCenterRoutes from './routes/helpCenter';
import supportRoutes from './routes/support';
import notificationsRoutes from './routes/notifications';
import settingsRoutes from './routes/settings';
import brandsRoutes from './routes/brands';
import originsRoutes from './routes/origins';

// Admin
import adminAuthRoutes from './routes/admin/auth';
import adminOrdersRoutes from './routes/admin/orders';
import adminInvoicesRoutes from './routes/admin/invoices';
import adminDocumentsRoutes from './routes/admin/documents';
import adminProductsRoutes from './routes/admin/products';
import adminProductsImportRoutes, { recoverInterruptedImportJobs } from './routes/admin/productsImport';
import adminCategoriesRoutes from './routes/admin/categories';
import adminStoresRoutes from './routes/admin/stores';
import adminBannersRoutes from './routes/admin/banners';
import adminHomeSectionsRoutes from './routes/admin/homeSections';
import adminAppContentRoutes from './routes/admin/appContent';
import adminBusinessHomeRoutes from './routes/admin/businessHome';
import adminPartnersRoutes from './routes/admin/partners';
import adminRidersRoutes from './routes/admin/riders';
import adminStaffRoutes from './routes/admin/staff';
import adminSalesRepsRoutes from './routes/admin/salesReps';
import salesMeRoutes from './routes/sales/me';
import salesClientsRoutes from './routes/sales/clients';
import salesCatalogueRoutes from './routes/sales/catalogue';
import salesOrdersRoutes from './routes/sales/orders';
import salesProductsRoutes from './routes/sales/products';
import salesInvoicesRoutes from './routes/sales/invoices';
import salesEarningsRoutes from './routes/sales/earnings';
import salesNotificationsRoutes from './routes/sales/notifications';
import { requireSalesRep } from './middleware/salesRepAuth';
import businessMeRoutes from './routes/business/me';
import businessCatalogueRoutes from './routes/business/catalogue';
import businessHomeRoutes from './routes/business/home';
import { requireBusiness } from './middleware/businessAuth';
import adminUsersRoutes from './routes/admin/users';
import adminDashboardRoutes from './routes/admin/dashboard';
import adminUploadsRoutes from './routes/admin/uploads';
import adminRashanRoutes from './routes/admin/rashan';
import adminRashanLeadsRoutes from './routes/admin/rashanLeads';
import adminHomeGroceryPlanRoutes from './routes/admin/homeGroceryPlans';
import adminLeadsRoutes from './routes/admin/leads';
import adminHelpCenterRoutes from './routes/admin/helpCenter';
import adminSupportRoutes from './routes/admin/support';
import adminNotificationsRoutes from './routes/admin/notifications';
import adminSettingsRoutes from './routes/admin/settings';
import adminBrandsRoutes from './routes/admin/brands';
import adminOriginsRoutes from './routes/admin/origins';
import adminProductTypesRoutes from './routes/admin/productTypes';
import adminReviewsRoutes from './routes/admin/reviews';
import partnerAuthRoutes from './routes/partner/auth';
import partnerMeRoutes from './routes/partner/me';
import partnerStoreRoutes from './routes/partner/store';
import partnerProductsRoutes from './routes/partner/products';
import partnerProductsImportRoutes, { recoverInterruptedPartnerImportJobs } from './routes/partner/productsImport';
import partnerProductsDuplicatesRoutes from './routes/partner/duplicates';
import partnerProductsImportDuplicatesRoutes from './routes/partner/productsImportDuplicates';
import partnerDashboardRoutes from './routes/partner/dashboard';
import partnerRidersRoutes from './routes/partner/riders';
import partnerNotificationsRoutes from './routes/partner/notifications';
import partnerOrdersRoutes from './routes/partner/orders';
import partnerRashanRoutes from './routes/partner/rashan';
import partnerTaxonomyRoutes from './routes/partner/taxonomy';
import partnerUploadsRoutes from './routes/partner/uploads';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Trust the first reverse proxy hop (Render). Required so req.ip is the real
// client IP and rate limiters don't collapse to a single proxy address.
app.set('trust proxy', 1);

// Security headers. CSP is disabled here because this API only serves JSON
// (no HTML shells to protect); CSP belongs on the Vercel-hosted web/admin
// SPAs. Cross-Origin-Resource-Policy is relaxed so the web/admin origins can
// fetch /uploads/* image URLs cross-origin.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS: in production, CORS_ORIGINS must be an explicit comma-separated
// allowlist. Reflecting arbitrary origins with credentials would let any
// attacker page make authenticated calls on behalf of a logged-in user.
// In non-production we still reflect the request origin so local tunnels
// (ngrok, LAN IPs, expo webviews) keep working without ceremony.
//
// Vercel-preview escape hatch: Vercel mints a unique hostname per deploy
// (e.g. cesto-admin-staging-8xtiztldu-cesto.vercel.app) which isn't in
// the env allowlist — that broke login every time we shipped a preview.
// Rather than churn CORS_ORIGINS on every push, we pattern-match origins
// that belong to OUR Vercel projects and allow them. Attackers can't
// spin up a cesto-* Vercel deploy under our team, so the pattern is
// safe.
const corsOriginsEnv = process.env.CORS_ORIGINS?.trim();
const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = corsOriginsEnv && corsOriginsEnv !== '*'
  ? corsOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
  : null;

const VERCEL_PREVIEW_PATTERNS: RegExp[] = [
  /^https:\/\/cesto-web-staging(?:-[a-z0-9]+)*(?:-cesto)?\.vercel\.app$/i,
  /^https:\/\/cesto-admin-staging(?:-[a-z0-9]+)*(?:-cesto)?\.vercel\.app$/i,
  /^https:\/\/cesto-web(?:-[a-z0-9]+)*(?:-cesto)?\.vercel\.app$/i,
  /^https:\/\/cesto-admin(?:-[a-z0-9]+)*(?:-cesto)?\.vercel\.app$/i,
];

function isAllowedCorsOrigin(origin: string): boolean {
  if (allowedOrigins?.includes(origin)) return true;
  if (VERCEL_PREVIEW_PATTERNS.some((re) => re.test(origin))) return true;
  return false;
}

if (isProd && !allowedOrigins) {
  console.warn(
    '[cors] WARNING: CORS_ORIGINS is unset or "*" in production. Only ' +
    'cesto-* Vercel preview URLs will be accepted; other cross-origin ' +
    'requests will be REJECTED. Set CORS_ORIGINS to your web/admin origins.',
  );
}

app.use(cors({
  origin: (origin, cb) => {
    // No Origin header — same-origin, curl, health checks. Allow.
    if (!origin) return cb(null, true);
    // In non-prod, reflect any origin (dev tunnels, phones on LAN, etc.).
    if (!isProd) return cb(null, true);
    return cb(null, isAllowedCorsOrigin(origin));
  },
  credentials: true,
  // Content-Disposition needs to be readable client-side so the browser's
  // download helper can pick the server-provided filename (date-stamped
  // exports, template names, etc.). Without exposing it the header is set
  // on the response but `res.headers.get('content-disposition')` returns
  // null on any cross-origin fetch.
  exposedHeaders: ['Content-Disposition'],
}));

// Private Network Access: allow dev tunnels (public origins) to reach localhost
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

// Typical JSON payloads are < 50 KB (image URLs, not base64). Legacy Home
// Sections editor is retired; if a legacy base64 payload ever shows up it
// will be rejected with 413 and can be re-saved through the current flow.
app.use(express.json({ limit: '256kb' }));

// Serve uploaded files (product images etc.) statically. Long cache because
// filenames are content-hashed by the upload route. dotfiles: 'deny' blocks
// stray .env / .htaccess if anything ever lands in the uploads dir.
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), {
  maxAge: '7d',
  immutable: true,
  fallthrough: true,
  dotfiles: 'deny',
}));

// Lightweight request logger (skip in test). Log path only — the query string
// often carries reset tokens, emails, and order IDs that shouldn't sit in
// hosting logs.
if (process.env.NODE_ENV !== 'test') {
  app.use((req, _res, next) => {
    const pathOnly = req.url.split('?')[0];
    console.log(`[${new Date().toISOString()}] ${req.method} ${pathOnly}`);
    next();
  });
}

// ─── Health ─────────────────────────────────────────────

/**
 * Health, and WHICH BUILD is answering.
 *
 * Render exports RENDER_GIT_COMMIT to the running service; anything else — a
 * laptop, a test harness — reports `dev`, which is honest rather than a stale
 * number. The frontends carry the same answer as `<meta name="build-commit">`
 * in their HTML, so one curl per surface says what is deployed.
 *
 * This existed as `{ status, timestamp }` and could not distinguish a service
 * running last week's code from one running this minute's. On 2026-10-11 two
 * pushes produced no visible change and there was no way to ask any surface
 * what it was actually running.
 */
const BUILD_COMMIT = (process.env.RENDER_GIT_COMMIT ?? '').slice(0, 7) || 'dev';

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', commit: BUILD_COMMIT, timestamp: new Date().toISOString() });
});

// ─── Customer + shared routes ───────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/users/addresses', addressesRoutes); // mount before /api/users so it isn't shadowed
app.use('/api/users', profileRoutes);
// b2b_price is wholesale margin and must never reach a non-business viewer.
// optionalAuth populates req.user; b2bPricingGuard resolves entitlement and
// scrubs b2b_price out of every response on these routers unless the caller
// is an approved business. Enforced here rather than per-endpoint so a newly
// added product route is safe by default. See lib/pricing.ts.
const customerCatalogueGuards = [optionalAuth, b2bPricingGuard] as const;

app.use('/api/categories', ...customerCatalogueGuards, categoriesRoutes);
// Nested under a product: /api/products/:productId/reviews. Mounted before
// the products router so its own /:id route cannot swallow the path.
app.use('/api/products/:productId/reviews', ...customerCatalogueGuards, reviewsRoutes);
app.use('/api/products', ...customerCatalogueGuards, productsRoutes);
app.use('/api/product-types', productTypesRoutes);
app.use('/api/stores', ...customerCatalogueGuards, storesRoutes);
app.use('/api/search', ...customerCatalogueGuards, searchRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/banners', bannersRoutes);
app.use('/api/home-sections', homeSectionsRoutes);
app.use('/api/app-content', appContentRoutes);
app.use('/api/uploads', uploadsRoutes);
// optionalAuth only: the pack-browsing half of this router is public, and
// the subscription half re-runs requireAuth internally.
app.use('/api/rashan', optionalAuth, rashanRoutes);
// Own mount rather than a sub-path of /api/rashan: that router flips to
// requireAuth halfway down, and this form has to stay public.
app.use('/api/rashan-leads', rashanLeadsRoutes);
// A Home Grocery household's own plan (2026-10-21). Signed-in only; the
// router applies requireAuth itself.
app.use('/api/home-grocery/plan', homeGroceryPlanRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/help-center', helpCenterRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/brands', brandsRoutes);
app.use('/api/origins', originsRoutes);

// ─── Admin routes ───────────────────────────────────────
// Auth lives unguarded; everything else requires a valid admin JWT.

app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin', requireAdmin);
app.use('/api/admin', requireOwnPassword);
app.use('/api/admin', confineLawyers);
app.use('/api/admin/dashboard', adminDashboardRoutes);
// Mounted on /api/admin rather than a sub-path: this router owns both
// /orders/:id/invoice and /invoices/*. It goes BEFORE the orders router so
// that router's ':id' cannot swallow the nested invoice path.
app.use('/api/admin', adminInvoicesRoutes);
app.use('/api/admin/documents', adminDocumentsRoutes);
app.use('/api/admin/orders', adminOrdersRoutes);
// Import sub-router goes first so /products/import doesn't collide with /:id.
app.use('/api/admin/products/import', adminProductsImportRoutes);
app.use('/api/admin/products', adminProductsRoutes);
app.use('/api/admin/categories', adminCategoriesRoutes);
app.use('/api/admin/stores', adminStoresRoutes);
app.use('/api/admin/partners', adminPartnersRoutes);
app.use('/api/admin/banners', adminBannersRoutes);
app.use('/api/admin/home-sections', adminHomeSectionsRoutes);
app.use('/api/admin/app-content', adminAppContentRoutes);
app.use('/api/admin/business-home', adminBusinessHomeRoutes);
app.use('/api/admin/riders', adminRidersRoutes);
app.use('/api/admin/staff', adminStaffRoutes);
app.use('/api/admin/sales-reps', adminSalesRepsRoutes);
app.use('/api/admin/users', adminUsersRoutes);
app.use('/api/admin/uploads', adminUploadsRoutes);
app.use('/api/admin/rashan-leads', adminRashanLeadsRoutes);
app.use('/api/admin/rashan', adminRashanRoutes);
app.use('/api/admin/home-grocery', adminHomeGroceryPlanRoutes);
app.use('/api/admin/leads', adminLeadsRoutes);
app.use('/api/admin/help-center', adminHelpCenterRoutes);
app.use('/api/admin/support', adminSupportRoutes);
app.use('/api/admin/notifications', adminNotificationsRoutes);
app.use('/api/admin/settings', adminSettingsRoutes);
app.use('/api/admin/brands', adminBrandsRoutes);
app.use('/api/admin/origins', adminOriginsRoutes);
app.use('/api/admin/product-types', adminProductTypesRoutes);
app.use('/api/admin/reviews', adminReviewsRoutes);

// ─── Partner routes (MV Slice 2) ────────────────────────
// Entire surface is gated behind MV_PARTNER_LOGIN. With the flag off the
// mount returns 404 so a stale admin bundle sees a legible error, not a
// partial response. Auth endpoints live unguarded (token-issued); everything
// else requires a valid partner JWT via requirePartner.

// Server-side MV_PARTNER_LOGIN gate REMOVED (2026-07-20). Render env-var
// mirror kept failing to bake in on staging redeploys — the entire
// /api/partner/* surface 404'd every request. requirePartnerRole (below,
// on every non-auth partner route) is now the sole gate: it verifies the
// customer JWT AND confirms the user has an active PartnerStoreRole for
// a live store, so a non-partner hitting these endpoints gets 401/403
// legibly instead of a silent flag 404.
// ─── /api/sales/* — the sales rep surface ──────────────
//
// Guarded at the mount, like /api/partner/*. A rep signs in through the
// ordinary customer endpoints and calls these with the token they already
// have; requireSalesRep turns that token into an active rep or refuses.
//
// What a rep may do is defined by what exists under this prefix. There is no
// product deletion, no payout, no settings endpoint here to reach — which is
// the whole reason reps are not given an admin login, where 177 endpoints sit
// behind 11 role guards.
app.use('/api/sales/me',        requireSalesRep(), salesMeRoutes);
app.use('/api/sales/clients',   requireSalesRep(), salesClientsRoutes);
app.use('/api/sales/catalogue', requireSalesRep(), salesCatalogueRoutes);
app.use('/api/sales/orders',    requireSalesRep(), salesOrdersRoutes);
app.use('/api/sales/products',  requireSalesRep(), salesProductsRoutes);
app.use('/api/sales/invoices',  requireSalesRep(), salesInvoicesRoutes);
app.use('/api/sales/earnings',  requireSalesRep(), salesEarningsRoutes);
app.use('/api/sales/notifications', requireSalesRep(), salesNotificationsRoutes);

// ─── Business panel (/business in apps/web) ──────────────
// An approved business buyer's own panel (2026-10-29). Only what the customer
// routes cannot answer lives here — the catalogue as a business sees it and
// the dashboard's summary; their cart, checkout, orders and addresses stay on
// the customer routes, which already price a business at wholesale. The
// catalogue is priced by b2bPricingGuard like every other customer catalogue,
// after requireBusiness has put the account on wholesale.
app.use('/api/business/me',        requireBusiness(), businessMeRoutes);
app.use('/api/business/catalogue', requireBusiness(), b2bPricingGuard, businessCatalogueRoutes);
app.use('/api/business/home',      requireBusiness(), businessHomeRoutes);

app.use('/api/partner/auth', partnerAuthRoutes);
app.use('/api/partner/me',                requirePartnerRole(), partnerMeRoutes);
// Slice 3 · partner dashboard endpoints. All gated by requirePartnerRole()
// so the customer JWT is verified + the user is confirmed to have a live
// partner role for a live store before any handler runs. Each route
// forces store_id from req.partnerRole.store.id server-side — never
// trusts the request body.
// products/import + products/duplicates must mount BEFORE /products so they
// don't collide with /:id in the main products router.
app.use('/api/partner/dashboard',              requirePartnerRole(), partnerDashboardRoutes);
app.use('/api/partner/store',                  requirePartnerRole(), partnerStoreRoutes);
app.use('/api/partner/products/import',        requirePartnerRole(), partnerProductsImportRoutes);
app.use('/api/partner/products/duplicates',    requirePartnerRole(), partnerProductsDuplicatesRoutes);
// Mounted alongside /duplicates, not under it — the two are different queues:
// /duplicates finds duplicates already IN the catalogue, this one holds
// spreadsheet rows that were never created.
app.use('/api/partner/products/import-duplicates', requirePartnerRole(), partnerProductsImportDuplicatesRoutes);
app.use('/api/partner/products',               requirePartnerRole(), partnerProductsRoutes);
app.use('/api/partner/riders',            requirePartnerRole(), partnerRidersRoutes);
app.use('/api/partner/notifications',     requirePartnerRole(), partnerNotificationsRoutes);
app.use('/api/partner/orders',            requirePartnerRole(), partnerOrdersRoutes);
app.use('/api/partner/rashan',            requirePartnerRole(), partnerRashanRoutes);
app.use('/api/partner/taxonomy',          requirePartnerRole(), partnerTaxonomyRoutes);
app.use('/api/partner/uploads',           requirePartnerRole(), partnerUploadsRoutes);

// ─── 404 + error ────────────────────────────────────────

app.use((req: Request, res: Response) => {
  errorResponse(res, `Route not found: ${req.method} ${req.path}`, 404);
});

app.use(errorHandler);

if (require.main === module) {
  // Bind to all interfaces so devices on the LAN (phones running Expo Go,
  // physical iPads, etc.) can hit the dev API by machine LAN IP. In prod
  // Render terminates TLS in front of us and connects to 0.0.0.0 anyway.
  const HOST = process.env.HOST ?? '0.0.0.0';
  const server = app.listen(PORT, HOST, () => {
    console.log(`🚀 API server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} (bound to ${HOST})`);
    // Print multi-vendor flag state so `ps` on Render makes it obvious which
    // slice(s) are enabled without SSHing to check env. See mv-flags.ts.
    logMvFlags();
    // Any ProductImportJob rows still marked queued/running on boot come from
    // a previous process that died mid-import — setImmediate handlers do not
    // survive restarts. Flip them to 'interrupted' so the admin UI stops
    // showing a stuck spinner and the admin can retry.
    recoverInterruptedImportJobs().catch((e) => {
      console.warn('[boot] recoverInterruptedImportJobs threw:', e);
    });
    recoverInterruptedPartnerImportJobs().catch((e) => {
      console.warn('[boot] recoverInterruptedPartnerImportJobs threw:', e);
    });
  });
  // Bound timeouts so a slow / hanging client can't hold a connection open
  // indefinitely (Slowloris). Numbers stay above express-rate-limit windows.
  server.headersTimeout = 30_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 70_000;
}

export default app;
