export * from './client';
export * from './connection';
export * from './storage';
export * from './storageAdapters';
export * from './hooks';
export * from './adminHooks';
export * from './partnerHooks';
export * from './salesHooks';
export * from './businessHooks';

// Re-export individual services for advanced consumers / non-React code paths
export { authService } from './services/auth';
export { catalogService } from './services/catalog';
export { cartService } from './services/cart';
export { ordersService } from './services/orders';
export type {
  CheckoutPayload, ReorderResult, OrderQuote, QuoteTax, OrderListItem, PagedOrders,
  CustomerOrderEditOperation, OrderEditShortfall,
} from './services/orders';
export { accountService, addressesService } from './services/account';
export type { AddressInput } from './services/account';
export {
  adminAuth, adminDashboard, adminOrders, adminProducts,
  adminCategories, adminBanners, adminRiders, adminUsers,
  // Exported as a value, not just through the useAdminSettings hook: the
  // Settings page calls adminSettings.geocode() directly. Locating an
  // address is a one-off action whose result is held in local state until
  // saved, so it has no cache entry for a React Query hook to own.
  adminSettings,
  adminInvoices, adminInvoicingSettings, adminDocuments,
} from './services/admin';
// `StoreZone` dropped with the zone system; BULK_EDIT_MAX_PRODUCTS is unrelated.
export { BULK_EDIT_MAX_PRODUCTS, adminStaff } from './services/admin';
export { adminSalesReps } from './services/admin';
export type {
  AdminSalesRepRow, AdminSalesRepProfile, AdminRepProduct, AdminRepProductSearchParams, AdminRepProductShop,
  AdminGrantSalesRepPayload, AdminSalesRepGrantResult,
} from './services/admin';
export type {
  LinkableStore, LinkableStoresResponse, UnlinkPartnerResult,
  AdminAccountAccess, AdminStorePartner, AdminStorePartnerSummary, AdminLinkPartnerPayload, AdminLinkPartnerResult,
} from './services/stores';
export { salesMe, salesClients, salesCatalogue, salesOrders, salesProducts, salesInvoices } from './services/sales';
export { businessMe, businessCatalogue } from './services/business';
export type {
  BusinessMe, BusinessProfileInfo, BusinessSize, BusinessProduct, BusinessProductDetail, BusinessProductsParams,
  BusinessCategory, BusinessBrand, BusinessOrigin, BusinessStore, BusinessStoresResponse,
} from './services/business';
export type {
  SalesMeResponse, SalesClient, SalesClientHomeGrocery, SalesClientListItem, SalesAddress, SalesAddressInput,
  SalesClientCredentials,
  SalesNewClientPayload, SalesNewClientResponse, SalesCategory,
  SalesOrderListItem, SalesNewOrderPayload, SalesStockShortfall,
  SalesClientLookup, SalesProduct, SalesProductVariant, SalesProductsListParams,
  SalesSubcategory, SalesBrand, SalesOrigin, SalesStore, SalesQuickProductPayload,
  SalesOrderDetail,
  SalesClientRelation, SalesClientOwner, SalesClientsPage, SalesClientFind,
} from './services/sales';
export { homeSectionsService, adminHomeSections } from './services/homeSections';
export type { OriginCount, BrandCount } from './services/homeSections';
export { leadsService, adminLeads } from './services/leads';
export { helpCenterService, adminHelpCenter } from './services/helpCenter';
export type { AdminHelpCategoryPayload, AdminHelpArticlePayload } from './services/helpCenter';
export { supportService, adminSupport } from './services/support';
export type {
  SupportTicket, SupportTicketStatus,
  SubmitTicketPayload, ListTicketsParams, ListTicketsResponse, PatchTicketPayload,
} from './services/support';
export { notificationsService, adminNotifications, partnerNotifications, salesNotifications } from './services/notifications';
export type {
  AppNotification, NotificationType, NotificationAudience,
  NotificationListParams, NotificationListResponse,
  BroadcastPayload, BroadcastResult,
} from './services/notifications';
export type {
  B2bLead, B2bLeadShop, B2bLeadType, B2bLeadStatus, B2bLeadIntent,
  SubmitLeadPayload, ListLeadsParams, ListLeadsResponse, PatchLeadPayload,
  // MV Slice 1 — partner approval workflow types.
  B2bLeadApprovalStatus,
  ApprovePartnerPayload, RequestPartnerInfoPayload, RejectPartnerPayload,
  ApproveBusinessPayload, ApproveBusinessResult,
  LeadStatusView, ResubmitLeadPayload,
} from './services/leads';
export type {
  AdminUser, AdminRole, AdminUserRow, AdminUserDetail,
  BulkImportResult, BulkImportRowResult, DashboardRange, DashboardStats,
  DashboardSourceStats,
  AdminProductDuplicateEntry, AdminProductDuplicateGroup, AdminProductDuplicatesResponse,
  AdminProductsListParams,
  AdminProductPatch, AdminVariantPatch,
  AdminBulkUpdateItem, AdminBulkUpdateResult,
  AdminBulkActionPayload, AdminBulkActionResult,
  AdminOrderSource, AdminCustomerType, AdminUserSegment, AdminStaff,
  DuplicateMatchReason, ResolveDuplicatesResult, MergeDuplicatesResult,
  DuplicateVariantSnapshot,
  StoreSettings, PublicStoreSettings,
  Invoice, InvoiceLine, HiddenInvoiceLine, InvoiceTotals, InvoiceParty, InvoiceEnvelope,
  InvoiceBlocker, InvoiceBlockerCode, InvoiceStatus, InvoiceKind,
  ArchiveKind, ArchiveFilters, ArchiveRow, ArchivePerson, ArchiveClient, ArchivedInvoice, ArchivedBill, ArchivePdfFile,
  AdminResendCredentialsResult,
  InvoicingSettings,
  DeliveryBand, DeliveryPricingMode, GeocodeResult,
  ImportJob, ImportJobStatus, ImportJobEnqueueResult,
  ImportDuplicateStatus, ImportDuplicateVariantPayload, ImportDuplicatePayload,
  ProductImportDuplicate, ProductImportDuplicatesResponse,
} from './services/admin';
export { adminUploads, customerUploads } from './services/uploads';
export { storesService } from './services/stores';
export {
  partnerAuth, partnerStore, partnerProducts, partnerRiders, partnerOrders,
  partnerTaxonomy, partnerUploads, partnerDashboard,
} from './services/partner';
export type {
  PartnerUser, PartnerStore, PartnerMeResponse,
  PartnerStorePayload, PartnerProductsListParams,
  PartnerOrdersListParams, PartnerOrderStatusTarget,
  // PartnerZonePayload / PartnerSlotPayload dropped with the zone system.
  PartnerRiderPayload,
  PartnerCategory, PartnerSubcategory, PartnerProductType, PartnerCategorySubmissionPayload,
  PartnerBrand, PartnerOrigin, PartnerUploadResult,
  // Duplicates
  PartnerDuplicateMatchReason, PartnerDuplicateVariantSnapshot,
  PartnerProductDuplicateEntry, PartnerProductDuplicateGroup,
  PartnerProductDuplicatesResponse,
  PartnerResolveDuplicatesResult, PartnerMergeDuplicatesResult,
  // Bulk import
  PartnerImportJobStatus, PartnerBulkImportRowResult, PartnerBulkImportResult,
  PartnerImportJobEnqueueResult, PartnerImportJob,
  // Import duplicates (staged spreadsheet rows)
  PartnerImportDuplicateStatus, PartnerImportDuplicateVariantPayload,
  PartnerImportDuplicatePayload, PartnerProductImportDuplicate,
  PartnerProductImportDuplicatesResponse,
  // Dashboard
  PartnerDashboardRange, PartnerDashboardStats, PartnerRecentOrder,
} from './services/partner';
export type { AuthTokens } from './services/auth';
export { brandsService, originsService, adminBrands, adminOrigins } from './services/brandsOrigins';
export type {
  Brand, Origin, BrandWritePayload, OriginWritePayload,
} from './services/brandsOrigins';
export { productTypesService, adminProductTypes } from './services/productTypes';
export type {
  ProductType, CreateProductTypePayload, UpdateProductTypePayload,
  AdminProductTypesListParams,
} from './services/productTypes';
export type {
  StoresListParams, StoreProductsParams,
  StoreSubcategoryCount, StoreProductTypeCount,
  AdminStoresListParams, StoreWritePayload,
} from './services/stores';
export { rashanService, adminRashan } from './services/rashan';
export {
  homeGroceryPlanService, adminHomeGroceryPlans, PLAN_FREQUENCIES, DELIVERY_WINDOWS,
} from './services/homeGroceryPlan';
export type {
  PlanFrequency, DeliveryWindow, PlanStatus, PlanItem, PlanAddress, PlanRider, PlanUpcoming,
  PlanDeliveryRow, HomeGroceryPlan, HomeGroceryPlanView, PlanSettingsPayload, CreatePlanPayload,
  PlanHistoryFilter, PlanDeliveriesPage, StaffPlanView, StaffPlanLine, PlanSummary, UpcomingPlanDelivery,
  PlanSlot, PlaceHomeGroceryOrderPayload, PlacedHomeGroceryOrder,
} from './services/homeGroceryPlan';
export { partnerRashan } from './services/partnerRashan';
export type {
  PartnerPackPayload, PartnerPackRow,
  PartnerSubscriptionRow, PartnerDeliveryRow,
  PartnerSubscriptionsParams, PartnerDeliveriesParams,
} from './services/partnerRashan';
export type {
  RashanPackStore,
  AdminPackOwner,
  AdminPackRow,
  AdminPaged,
  RashanFrequency,
  RashanSubStatus,
  SubDeliveryStatus,
  RashanPackItem,
  RashanPack,
  RashanSubscription,
  SubscriptionDelivery,
  DeliveryRiderSummary,
  SubscriptionDeliveryOrderSummary,
  CreateSubscriptionPayload,
  UpdateSubscriptionPayload,
  AdminPackPayload,
  AdminUpdateSubPayload,
  AdminSubscriptionRow,
  AdminSubscriptionDetail,
  AdminSubscriptionDetailItem,
  AdminDeliveryRow,
  AdminSubSummary,
} from './services/rashan';
export {
  rashanLeadsService, adminRashanLeads, leadFrequencyToSubscription,
} from './services/rashanLeads';
export type {
  RashanLead, RashanLeadFrequency, RashanLeadStatus, RashanLeadContactPref,
  SubmitRashanLeadPayload, ListRashanLeadsParams, ListRashanLeadsResponse,
  PatchRashanLeadPayload,
  RashanLeadApprovalStatus, RashanLeadAccount, HomeGroceryAddressInput,
  ApproveRashanLeadPayload, ApproveRashanLeadResult, RejectRashanLeadResult,
  MyHomeGrocery, MyHomeGroceryRequest,
} from './services/rashanLeads';
export type { UploadFolder, UploadResult } from './services/uploads';
export { resolveImageUrl, imageSrcSet, configureImageCdn } from './imageUrl';
export type { ImagePreset } from './imageUrl';
export { reviewsService, adminReviews } from './services/reviews';
export type {
  ProductReview, ReviewSummary, ProductReviewsResponse, ReviewEligibility,
  WriteReviewPayload, AdminProductReview, AdminReviewsParams,
  ReportReviewPayload, ReviewReportReason, AdminReviewReport,
} from './services/reviews';
