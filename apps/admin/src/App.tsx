import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import AdminLayout from '@/layouts/AdminLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import NetworkBoundary from '@/components/NetworkBoundary';
import { useAdminTheme, useApplyAdminTheme } from '@/lib/adminTheme';
import LoginPage from '@/pages/LoginPage';
import NotFoundPage from '@/pages/NotFoundPage';
import ServerErrorPage from '@/pages/ServerErrorPage';
import OfflinePage from '@/pages/OfflinePage';
import DashboardPage from '@/pages/DashboardPage';
import OrdersPage from '@/pages/OrdersPage';
import OrderDetailPage from '@/pages/OrderDetailPage';
import SalesRepDetailPage from '@/pages/SalesRepDetailPage';
import SalesRepProductsPage from '@/pages/SalesRepProductsPage';
import ProductsPage from '@/pages/ProductsPage';
import ProductDuplicatesPage from '@/pages/ProductDuplicatesPage';
import BulkEditProductsPage from '@/pages/BulkEditProductsPage';
import ProductFormPage from '@/pages/ProductFormPage';
import CategoriesPage from '@/pages/CategoriesPage';
import StoresPage from '@/pages/StoresPage';
import StoreFormPage from '@/pages/StoreFormPage';
import UsersPage from '@/pages/UsersPage';
import CustomerDetailPage from '@/pages/CustomerDetailPage';
import ClientCreatePage from '@/pages/ClientCreatePage';
import CustomerOrdersPage from '@/pages/CustomerOrdersPage';
import OrderCreatePage from '@/pages/OrderCreatePage';
import InvoiceDetailPage from '@/pages/InvoiceDetailPage';
import DocumentsPage from '@/pages/DocumentsPage';
import ChangePasswordPage from '@/pages/ChangePasswordPage';
import DocumentDetailPage from '@/pages/DocumentDetailPage';
import InvoicingSettingsPage from '@/pages/InvoicingSettingsPage';
import BannersPage from '@/pages/BannersPage';
import BannerFormPage from '@/pages/BannerFormPage';
import HomeSectionsPage from '@/pages/HomeSectionsPage';
import AppContentPage from '@/pages/AppContentPage';
import BusinessHomePage from '@/pages/BusinessHomePage';
import BrandsPage from '@/pages/BrandsPage';
import OriginsPage from '@/pages/OriginsPage';
import HelpCenterPage from '@/pages/HelpCenterPage';
import HelpCategoryFormPage from '@/pages/HelpCategoryFormPage';
import HelpArticleFormPage from '@/pages/HelpArticleFormPage';
import SupportInboxPage from '@/pages/SupportInboxPage';
import ReviewsPage from '@/pages/ReviewsPage';
import SettingsPage from '@/pages/SettingsPage';
import SubscriptionsPage from '@/pages/SubscriptionsPage';
import SubscriptionDetailPage from '@/pages/SubscriptionDetailPage';
import RashanPacksPage from '@/pages/RashanPacksPage';
import RashanDeliveriesPage from '@/pages/RashanDeliveriesPage';
import RashanLeadsPage from '@/pages/RashanLeadsPage';
import LeadsPage from '@/pages/LeadsPage';
import BroadcastPage from '@/pages/BroadcastPage';

// Partner dashboard was moved to apps/web/src/partner/ (unified-identity
// rework — partner is a customer with a store, so they live in the
// customer web with a partner-scoped route tree). Cesto admin no longer
// hosts any /partner routes.

/** An old link to a household page: the customer it was about. */
function ToCustomer() {
  const { userId } = useParams<{ userId: string }>();
  return <Navigate to={`/customers/${userId}`} replace />;
}

export default function App() {
  // Light, dark or the device's, on <html> for every screen (lib/adminTheme).
  useApplyAdminTheme(useAdminTheme().resolved);
  return (
    <>
    <NetworkBoundary />
    <Routes>
      {/* Public — error + auth pages reachable without login. */}
      <Route path="/login"   element={<LoginPage />} />
      <Route path="/500"     element={<ServerErrorPage />} />
      <Route path="/offline" element={<OfflinePage />} />

      {/* Protected admin routes */}
      <Route element={<ProtectedRoute />}>
        {/* Full-screen takeover — deliberately outside AdminLayout so the
            sidebar can't be used to leave a grid with unsaved edits. */}
        <Route path="/products/bulk-edit" element={<BulkEditProductsPage />} />
        {/* Outside the panel's chrome, like sign-in: when it is forced there is nowhere else to go. */}
        <Route path="/account/password" element={<ChangePasswordPage />} />
        <Route element={<AdminLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          {/* The same page against the other order book — see OrdersPage. */}
          {/* Folded into /orders as tabs. Redirects rather than deletions:
              these URLs are in people's history and in links already sent. */}
          <Route path="/rashan-orders" element={<Navigate to="/orders?book=rashan" replace />} />

          {/* ── B2B ─────────────────────────────────────────
              Wholesale is run as its own book: its own leads, its own
              accounts, its own orders. Each route is an existing page
              pointed at the B2B side of the same table — see the `source`
              and `customerType` props. Deliberately NOT filtered by
              `source`: a rep-built order for a business customer belongs
              here AND under Rashan, because they answer different
              questions. */}
          {/* Now a tab on /users, beside the accounts these become. */}
          <Route path="/b2b/leads" element={<Navigate to="/users?tab=b2b" replace />} />
          <Route path="/b2b/quotations" element={<Navigate to="/leads" replace />} />
          <Route path="/b2b/customers" element={<Navigate to="/users?tab=b2b" replace />} />
          <Route path="/b2b/orders" element={<Navigate to="/orders?book=b2b" replace />} />
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
          <Route path="/sales-reps/:userId" element={<SalesRepDetailPage />} />
          <Route path="/sales-reps/:userId/products" element={<SalesRepProductsPage />} />
          <Route path="/invoices/:invoiceId" element={<InvoiceDetailPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:source/:id" element={<DocumentDetailPage />} />
          <Route path="/settings/invoicing" element={<InvoicingSettingsPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/duplicates" element={<ProductDuplicatesPage />} />
          <Route path="/products/new" element={<ProductFormPage />} />
          <Route path="/products/:productId/edit" element={<ProductFormPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/stores" element={<StoresPage />} />
          <Route path="/stores/new" element={<StoreFormPage />} />
          <Route path="/stores/:storeId/edit" element={<StoreFormPage />} />
          <Route path="/users" element={<UsersPage />} />
          {/* Folded into /users as tabs; the URLs stay alive. */}
          <Route path="/customers" element={<Navigate to="/users" replace />} />
          {/* Ahead of :userId — otherwise the param route swallows "new". */}
          <Route path="/customers/new" element={<ClientCreatePage />} />
          <Route path="/customers/:userId" element={<CustomerDetailPage />} />
          {/* Ahead of :userId/orders/new is unnecessary — "new" is a
              different segment — but it reads with its siblings here. */}
          <Route path="/customers/:userId/orders" element={<CustomerOrdersPage />} />
          {/* The household page of 2026-10-21 → 23: its delivery information is on the customer page now. */}
          <Route path="/customers/:userId/home-grocery" element={<ToCustomer />} />
          {/* Under the customer on purpose: the rep is already looking at
              them, so there is no client to pick. */}
          <Route path="/customers/:userId/orders/new" element={<OrderCreatePage />} />
          {/* The SAME page. Editing an order the way you built it is only
              true if it is the screen you built it on. */}
          <Route path="/orders/:orderId/edit" element={<OrderCreatePage />} />
          <Route path="/riders" element={<Navigate to="/users?tab=riders" replace />} />
          <Route path="/banners" element={<BannersPage />} />
          <Route path="/banners/new" element={<BannerFormPage />} />
          <Route path="/banners/:bannerId/edit" element={<BannerFormPage />} />
          <Route path="/home-sections" element={<HomeSectionsPage />} />
          <Route path="/app-content" element={<AppContentPage />} />
          <Route path="/business-home" element={<BusinessHomePage />} />
          <Route path="/brands" element={<BrandsPage />} />
          <Route path="/origins" element={<OriginsPage />} />
          <Route path="/help-center" element={<HelpCenterPage />} />
          <Route path="/help-center/categories/new" element={<HelpCategoryFormPage />} />
          <Route path="/help-center/categories/:categoryId/edit" element={<HelpCategoryFormPage />} />
          <Route path="/help-center/articles/new" element={<HelpArticleFormPage />} />
          <Route path="/help-center/articles/:articleId/edit" element={<HelpArticleFormPage />} />
          <Route path="/subscriptions" element={<SubscriptionsPage />} />
          <Route path="/subscriptions/:subscriptionId" element={<SubscriptionDetailPage />} />
          <Route path="/rashan-packs" element={<RashanPacksPage />} />
          <Route path="/rashan-deliveries" element={<RashanDeliveriesPage />} />
          <Route path="/rashan-leads" element={<RashanLeadsPage />} />
          <Route path="/leads" element={<LeadsPage types={['contact', 'quotation']} />} />
          <Route path="/support" element={<SupportInboxPage />} />
          <Route path="/reviews" element={<ReviewsPage />} />
          <Route path="/broadcast" element={<BroadcastPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      {/* 404 catch-all — keep last */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </>
  );
}
