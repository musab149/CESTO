import { Routes, Route, Navigate } from 'react-router-dom';
import ScrollToTop from '@/components/ScrollToTop';
import NetworkBoundary from '@/components/NetworkBoundary';
import CookieConsent from '@/components/CookieConsent';
import BlockedAccountDialog from '@/components/BlockedAccountDialog';
import CustomerLayout from '@/layouts/CustomerLayout';
import AuthLayout from '@/layouts/AuthLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import CustomerOnlyRoute from '@/components/CustomerOnlyRoute';
import HomePage from '@/pages/HomePage';
import CategoriesPage from '@/pages/CategoriesPage';
import OriginsPage from '@/pages/OriginsPage';
import BrandsPage from '@/pages/BrandsPage';
import B2bDealsPage from '@/pages/B2bDealsPage';
import CategoryProductsPage from '@/pages/CategoryProductsPage';
import ProductDetailPage from '@/pages/ProductDetailPage';
import SearchPage from '@/pages/SearchPage';
import CartPage from '@/pages/CartPage';
import OrdersPage from '@/pages/OrdersPage';
import OrderDetailPage from '@/pages/OrderDetailPage';
import OrderEditPage from '@/pages/OrderEditPage';
import ProfilePage from '@/pages/ProfilePage';
import EditProfilePage from '@/pages/EditProfilePage';
import ChangePasswordPage from '@/pages/ChangePasswordPage';
import AddressesPage from '@/pages/AddressesPage';
import CheckoutPage from '@/pages/CheckoutPage';
import LanguagePage from '@/pages/LanguagePage';
import NotificationsPage from '@/pages/NotificationsPage';
import FaqPage from '@/pages/FaqPage';
import HelpCenterPage from '@/pages/HelpCenterPage';
import HelpArticlePage from '@/pages/HelpArticlePage';
import ContactPage from '@/pages/ContactPage';
import PrivacyPage from '@/pages/PrivacyPage';
import TermsPage from '@/pages/TermsPage';
import DeleteAccountPage from '@/pages/DeleteAccountPage';
import ApplicationStatusPage from '@/pages/ApplicationStatusPage';
import PartnerLayout from '@/partner/PartnerLayout';
import PartnerProtectedRoute from '@/partner/PartnerProtectedRoute';
import PartnerDashboardPage from '@/partner/PartnerDashboardPage';
import PartnerChangePasswordPage from '@/partner/PartnerChangePasswordPage';
import PartnerProductsPage from '@/partner/PartnerProductsPage';
import PartnerProductFormPage from '@/partner/PartnerProductFormPage';
import PartnerProductDuplicatesPage from '@/partner/PartnerProductDuplicatesPage';
import PartnerStorePage from '@/partner/PartnerStorePage';
import PartnerCategoriesPage from '@/partner/PartnerCategoriesPage';
import PartnerBrandsPage from '@/partner/PartnerBrandsPage';
import PartnerOriginsPage from '@/partner/PartnerOriginsPage';
import PartnerOrdersPage from '@/partner/PartnerOrdersPage';
import PartnerOrderDetailPage from '@/partner/PartnerOrderDetailPage';
import PartnerRidersPage from '@/partner/PartnerRidersPage';
import SalesProtectedRoute from '@/sales/SalesProtectedRoute';
import SalesChangePasswordPage from '@/sales/SalesChangePasswordPage';
import SalesLayout from '@/sales/SalesLayout';
import SalesTodayPage from '@/sales/SalesTodayPage';
import SalesClientsPage from '@/sales/SalesClientsPage';
import SalesNewClientPage from '@/sales/SalesNewClientPage';
import SalesClientDetailPage from '@/sales/SalesClientDetailPage';
import SalesNewOrderPage from '@/sales/SalesNewOrderPage';
import SalesOrdersPage from '@/sales/SalesOrdersPage';
import SalesOrderDetailPage from '@/sales/SalesOrderDetailPage';
import SalesEarningsPage from '@/sales/SalesEarningsPage';
import SalesEarningsHistoryPage from '@/sales/SalesEarningsHistoryPage';
import SalesCataloguePage from '@/sales/SalesCataloguePage';
import SalesCatalogueListPage from '@/sales/SalesCatalogueListPage';
import BusinessProtectedRoute from '@/business/BusinessProtectedRoute';
import BusinessLayout from '@/business/BusinessLayout';
import BusinessChangePasswordPage from '@/business/BusinessChangePasswordPage';
import BusinessHomePage from '@/business/BusinessHomePage';
import BusinessCataloguePage from '@/business/BusinessCataloguePage';
import BusinessCatalogueListPage from '@/business/BusinessCatalogueListPage';
import BusinessProductPage from '@/business/BusinessProductPage';
import BusinessCartPage from '@/business/BusinessCartPage';
import BusinessCheckoutPage from '@/business/BusinessCheckoutPage';
import BusinessOrdersPage from '@/business/BusinessOrdersPage';
import BusinessOrderDetailPage from '@/business/BusinessOrderDetailPage';
import BusinessOrderEditPage from '@/business/BusinessOrderEditPage';
import BusinessAccountPage from '@/business/BusinessAccountPage';
import BusinessAddressesPage from '@/business/BusinessAddressesPage';

// Client-side VITE_MV_PARTNER_LOGIN gate REMOVED (2026-07-20). Vercel
// env-var mirror kept failing to bake in on staging redeploys — the
// customer web tree-shook the /partner/* route tree and every
// "Manage store" click landed on the customer 404. PartnerProtectedRoute
// (checks the user has partner_roles) is now the sole gate. Non-partners
// hitting /partner/* redirect to /login; partners get the dashboard.
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import ForgotPasswordPage from '@/pages/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import HomeGroceryPage from '@/pages/HomeGroceryPage';
import RashanSubscriptionPage from '@/pages/RashanSubscriptionPage';
import HomeGroceryProfilePage from '@/pages/HomeGroceryProfilePage';
import FavoritesPage from '@/pages/FavoritesPage';
import ComingSoonPage from '@/pages/ComingSoonPage';
import StoresIndexPage from '@/pages/StoresIndexPage';
import StoreDetailPage from '@/pages/StoreDetailPage';
import NotFoundPage from '@/pages/NotFoundPage';
import ServerErrorPage from '@/pages/ServerErrorPage';
import ForbiddenPage from '@/pages/ForbiddenPage';
import OfflinePage from '@/pages/OfflinePage';
import { Leaf } from 'lucide-react';

export default function App() {
  return (
    <>
      <ScrollToTop />
      <NetworkBoundary />
      <Routes>
      {/* Auth routes (public) */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      {/* Customer routes */}
      {/* CustomerOnlyRoute wraps the WHOLE storefront, not individual pages:
          a rep belongs on /sales, and the list of ways into the shop is every
          route below plus the 404 catch-all. It keeps a short allowlist for
          the legal and error pages, which are reachable from /sales. */}
      <Route element={<CustomerOnlyRoute />}>
      <Route element={<CustomerLayout />}>
        {/* Public pages */}
        <Route path="/" element={<HomePage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/categories/:categoryId" element={<CategoryProductsPage />} />
        <Route path="/origins" element={<OriginsPage />} />
        <Route path="/brands" element={<BrandsPage />} />
        <Route path="/products/:productId" element={<ProductDetailPage />} />
        <Route path="/search" element={<SearchPage />} />

        {/* Home Grocery (once "rashan") — an application, like /b2b-deals.
            The pack builder and its checkout are retired; their URLs are in
            links people already have, so they land on the form rather than
            a 404. */}
        <Route path="/rashan" element={<HomeGroceryPage />} />
        <Route path="/rashan/pack/:packType" element={<Navigate to="/rashan" replace />} />
        <Route path="/rashan/checkout" element={<Navigate to="/rashan" replace />} />

        {/* Stores directory + storefronts (was previously a Coming-Soon stub). */}
        <Route path="/stores" element={<StoresIndexPage />} />
        <Route path="/stores/:slug" element={<StoreDetailPage />} />
        {/* Redirect the old singular /store URL so bookmarked links land somewhere useful. */}
        <Route path="/store" element={<Navigate to="/stores" replace />} />
        <Route path="/b2b-deals"     element={<B2bDealsPage mode="business" />} />
        <Route path="/partner-deals" element={<B2bDealsPage mode="partner_store" />} />
        <Route
          path="/bio"
          element={
            <ComingSoonPage
              icon={Leaf}
              title={{ es: 'Producto Bio', en: 'Bio Product' }}
              subtitle={{
                es: 'Una selección de productos ecológicos y bio, certificados y cuidadosamente elegidos. En camino.',
                en: 'A curated selection of certified organic and bio products. Coming your way.',
              }}
              accent="leaf"
            />
          }
        />

        {/* Public info pages */}
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/help" element={<HelpCenterPage />} />
        <Route path="/help/:slug" element={<HelpArticlePage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        {/* Public on purpose: this is the account-deletion URL declared to Google
            Play, which must work for someone without the app or a session. */}
        <Route path="/delete-account" element={<DeleteAccountPage />} />
        {/* MV Slice 1 — public magic-link resubmit page for partner applications. */}
        <Route path="/apply/status/:token" element={<ApplicationStatusPage />} />

        {/* Protected (auth required) */}
        <Route element={<ProtectedRoute />}>
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
          {/* A Home Grocery order, changed on the staff/rep order screen. */}
          <Route path="/orders/:orderId/edit" element={<OrderEditPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/edit" element={<EditProfilePage />} />
          <Route path="/profile/change-password" element={<ChangePasswordPage />} />
          <Route path="/profile/language" element={<LanguagePage />} />
          <Route path="/profile/notifications" element={<NotificationsPage />} />
          {/* A Home Grocery household: its orders and its delivery information. */}
          <Route path="/profile/home-grocery" element={<HomeGroceryProfilePage />} />
          <Route path="/addresses" element={<AddressesPage />} />
          {/* Legacy self-serve subscriptions — kept while any exist. */}
          <Route path="/rashan/subscription" element={<RashanSubscriptionPage />} />
          {/* The household page of 2026-10-21 → 23, in links and notifications people have. */}
          <Route path="/rashan/plan" element={<Navigate to="/profile/home-grocery" replace />} />
        </Route>

        {/* Direct error pages — reachable by URL for support links + previews. */}
        <Route path="/500"     element={<ServerErrorPage />} />
        <Route path="/403"     element={<ForbiddenPage />} />
        <Route path="/offline" element={<OfflinePage />} />

        {/* 404 — catch-all inside CustomerLayout so the page keeps the header/footer */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      </Route>{/* /CustomerOnlyRoute — children keep their indent, so the
                   gate above does not reflow seventy routes. */}

      {/* ─── Partner dashboard (MV Slice 2/3) — guarded by
          PartnerProtectedRoute (redirects non-partners to /login).
          Lives inside apps/web so a partner is just a customer with a
          store attached (same JWT, same origin). PartnerLayout has its
          own chrome (dark sidebar + top bar), OUTSIDE CustomerLayout. */}
      <Route element={<PartnerProtectedRoute />}>
        <Route path="/partner/change-password" element={<PartnerChangePasswordPage />} />
        <Route element={<PartnerLayout />}>
          <Route path="/partner/dashboard" element={<PartnerDashboardPage />} />
          <Route path="/partner/products"                 element={<PartnerProductsPage />} />
          {/* Duplicates route must sit BEFORE /:productId/edit so
              "duplicates" isn't matched as a product id. */}
          <Route path="/partner/products/duplicates"      element={<PartnerProductDuplicatesPage />} />
          <Route path="/partner/products/new"             element={<PartnerProductFormPage />} />
          <Route path="/partner/products/:productId/edit" element={<PartnerProductFormPage />} />
          {/* Full storefront editor — partner completes name/logo/hours/etc.
              here after admin approval. Admin only captures minimal fields
              at approval time. */}
          <Route path="/partner/store"                    element={<PartnerStorePage />} />
          {/* Read-only browse of the Cesto-wide taxonomy — partners pick
              FROM this on the product form. Writes stay on admin. */}
          <Route path="/partner/categories"               element={<PartnerCategoriesPage />} />
          <Route path="/partner/brands"                   element={<PartnerBrandsPage />} />
          <Route path="/partner/origins"                  element={<PartnerOriginsPage />} />
          {/* Orders / Riders — full CRUD, partner-scoped via
              /api/partner/* (server forces store_id from JWT). */}
          <Route path="/partner/orders"                   element={<PartnerOrdersPage />} />
          <Route path="/partner/orders/:orderId"          element={<PartnerOrderDetailPage />} />
          <Route path="/partner/riders"                   element={<PartnerRidersPage />} />
          {/* The partner Rashan section (packs, subscribers, deliveries) is
              gone: rashan became Home Grocery, which Cesto runs. Old links
              land on the dashboard rather than a 404. The tables and the
              /api/partner/rashan endpoints are untouched. */}
          <Route path="/partner/rashan/*" element={<Navigate to="/partner/dashboard" replace />} />
        </Route>
      </Route>

      {/* Bare /partner → /partner/dashboard so a mistyped URL doesn't 404. */}
      <Route path="/partner" element={<Navigate to="/partner/dashboard" replace />} />

      {/* ─── Sales reps — guarded by SalesProtectedRoute, which reads
          `is_sales_rep` off the User that /api/users/me already returns.
          Here for the same reason /partner/* is: a rep is a customer with a
          role, same JWT and same origin, so there is no second app to sign
          into and the rep tablet app will talk to the same /api/sales/*.

          The guard decides what RENDERS. What a rep may DO is decided by
          /api/sales/* not exposing anything else — there is no status
          change, no delete and no settings endpoint under that prefix.
          SalesLayout has its own chrome (tablet top bar + bottom tabs),
          OUTSIDE CustomerLayout. */}
      <Route element={<SalesProtectedRoute />}>
        {/* Outside SalesLayout, like /partner/change-password is outside
            PartnerLayout: until the temp password is rotated there is nothing
            the sidebar could usefully link to. */}
        <Route path="/sales/change-password" element={<SalesChangePasswordPage />} />
        <Route element={<SalesLayout />}>
          <Route path="/sales" element={<SalesTodayPage />} />
          <Route path="/sales/clients" element={<SalesClientsPage />} />
          {/* `new` before any future /:clientId so it isn't read as an id. */}
          <Route path="/sales/clients/new" element={<SalesNewClientPage />} />
          <Route path="/sales/clients/:clientId" element={<SalesClientDetailPage />} />
          <Route path="/sales/orders" element={<SalesOrdersPage />} />
          <Route path="/sales/orders/new" element={<SalesNewOrderPage />} />
          {/* The SAME page as creating. Editing an order the way you built it
              is only true if it is the screen you built it on. */}
          <Route path="/sales/orders/:orderId/edit" element={<SalesNewOrderPage />} />
          {/* After `new`, so "new" is never read as an order id. */}
          <Route path="/sales/orders/:orderId" element={<SalesOrderDetailPage />} />
          <Route path="/sales/catalogue" element={<SalesCataloguePage />} />
          <Route path="/sales/catalogue/all" element={<SalesCatalogueListPage />} />
          <Route path="/sales/catalogue/:kind/:id" element={<SalesCatalogueListPage />} />
          <Route path="/sales/earnings" element={<SalesEarningsPage />} />
          <Route path="/sales/earnings/history" element={<SalesEarningsHistoryPage />} />
          {/* A period statement, before earnings came from each order (2026-10-28):
              an old bell item still lands on the earnings. */}
          <Route path="/sales/earnings/:id" element={<Navigate to="/sales/earnings" replace />} />
        </Route>
      </Route>

      {/* ─── Business buyers — guarded by BusinessProtectedRoute, which reads
          `is_business` off the User (2026-10-29). An approved business shops
          here and nowhere else in the shop (routeAccess customerRouteAccess
          sends them in); what they may do is the customer API, which prices
          them at wholesale, plus /api/business for the catalogue and the
          dashboard. Its own chrome, outside CustomerLayout, as /sales has. */}
      <Route element={<BusinessProtectedRoute />}>
        {/* Outside the layout: until a temporary password is rotated there is
            nothing the sidebar could usefully link to. */}
        <Route path="/business/change-password" element={<BusinessChangePasswordPage />} />
        <Route element={<BusinessLayout />}>
          <Route path="/business" element={<BusinessHomePage />} />
          <Route path="/business/catalogue" element={<BusinessCataloguePage />} />
          <Route path="/business/catalogue/all" element={<BusinessCatalogueListPage />} />
          <Route path="/business/catalogue/:kind/:id" element={<BusinessCatalogueListPage />} />
          <Route path="/business/products/:productId" element={<BusinessProductPage />} />
          <Route path="/business/cart" element={<BusinessCartPage />} />
          <Route path="/business/checkout" element={<BusinessCheckoutPage />} />
          <Route path="/business/orders" element={<BusinessOrdersPage />} />
          <Route path="/business/orders/:orderId" element={<BusinessOrderDetailPage />} />
          <Route path="/business/orders/:orderId/edit" element={<BusinessOrderEditPage />} />
          <Route path="/business/account" element={<BusinessAccountPage />} />
          <Route path="/business/account/addresses" element={<BusinessAddressesPage />} />
          <Route path="/business/*" element={<Navigate to="/business" replace />} />
        </Route>
      </Route>
    </Routes>

      {/* Outside <Routes> so the banner is present on every surface —
          storefront, auth and partner alike. Consent is a site-wide
          obligation, not a customer-pages one. */}
      <CookieConsent />
      {/* Renders only when the API has refused for a blocked account. */}
      <BlockedAccountDialog />
    </>
  );
}
