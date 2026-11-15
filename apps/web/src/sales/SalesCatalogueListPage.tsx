import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { LayoutGrid, MapPin, PackageCheck, RotateCcw, SearchX, SlidersHorizontal, Tag, X } from 'lucide-react';
import { resolveImageUrl, useSalesSubcategories } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from './lib/i18n';
import { sellingLine } from './lib/shops';
import BackLink from './components/BackLink';
import { Card, PageHeader, SearchInput } from './components/ui';
import EmptyState from './components/EmptyState';
import { Skeleton } from './components/Skeleton';
import {
  CategoryIcon, CategoryPill, FilterDrawer, ProductResults, type DrawerField, type Lang,
} from './components/catalogue/Products';
import { HoursLine, ShopBanner, ShopMark } from './components/catalogue/Browse';
import {
  ASSIGNED_ID, HOUSE, HOUSE_TINT, nameOf, tintOf, useBrowseData, useCountLine, useImage, type BrowseKind, type ShopCard,
} from './components/catalogue/data';

/**
 * The products behind one of the Catálogo's cards (2026-10-28): a shop, a
 * category, an origin or a brand — or Cesto's own, the products assigned to
 * the rep by hand, or everything (`/sales/catalogue/all`).
 *
 * The card's own header on top — a shop's banner, logo and hours; the
 * picture and name of the rest — then the list's search and filters, which
 * narrow inside it and never out of it: the card's own filter is fixed and
 * the drawer does not offer it. The grid, the sheet and starting an order are
 * the catalogue's (components/catalogue/Products).
 */

type Kind = BrowseKind | 'all';
const KINDS: Kind[] = ['stores', 'categories', 'origins', 'brands', 'all'];

export default function SalesCatalogueListPage() {
  // A new card is a new list: its search and filters start empty.
  const { pathname } = useLocation();
  return <CatalogueList key={pathname} />;
}

function CatalogueList() {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang) as Lang;
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const kind: Kind = params.kind && (KINDS as string[]).includes(params.kind) ? params.kind as Kind : 'all';
  const id = params.id ?? '';
  const data = useBrowseData();
  const countLine = useCountLine();
  const label = (o: { label_es: string; label_en?: string | null }) => (lang === 'en' && o.label_en) || o.label_es;

  // ─── What this list is ───────────────────────────────────
  const assignedList = kind === 'stores' && id === ASSIGNED_ID;
  const houseList = kind === 'stores' && id === HOUSE;
  const shop: ShopCard | undefined = kind === 'stores' && !assignedList && !houseList ? data.shopCards.find((s) => s.id === id) : undefined;
  const category = kind === 'categories' ? data.allCategories.find((c) => c.id === id) : undefined;
  const origin = kind === 'origins' ? data.origins.find((o) => o.id === id) : undefined;
  const brand = kind === 'brands' ? data.brands.find((b) => b.id === id) : undefined;

  const listLoading = kind === 'stores'
    ? !data.shopsKnown || (!assignedList && !houseList && data.queries.stores.isLoading && !shop)
    : kind === 'all' ? false : data.queries[kind].isLoading;
  const found = kind === 'all' || assignedList ? data.shopOk
    : houseList ? data.house
      : !!(shop || category || origin || brand);
  const gone = !listLoading && data.shopsKnown && !found;

  const title = kind === 'all' ? t('sales.catalogue.allTitle')
    : assignedList ? t('sales.catalogue.assignedTitle')
      : houseList ? (data.sellable.find((s) => s.id === HOUSE)?.name ?? 'Cesto Shop')
        : shop?.name ?? (category ? nameOf(category, lang) : origin ? label(origin) : brand?.name) ?? '';

  // The card's own filter: fixed, and not in the drawer.
  const fixed = assignedList ? { assigned: 'true' as const }
    : kind === 'stores' ? { storeId: id }
      : kind === 'categories' ? { categoryId: id }
        : kind === 'origins' ? { originId: id }
          : kind === 'brands' ? { brandId: id } : {};

  // ─── What narrows it ─────────────────────────────────────
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const tid = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(tid);
  }, [typed]);
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [originId, setOriginId] = useState('');
  const [stock, setStock] = useState('');
  const [sort, setSort] = useState('name_asc');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const theCategory = kind === 'categories' ? id : categoryId;
  const { data: subcategoriesAll } = useSalesSubcategories();
  const subcategories = useMemo(
    () => (theCategory ? (subcategoriesAll ?? []).filter((s) => s.category_id === theCategory) : []),
    [subcategoriesAll, theCategory],
  );

  const drawerCount = [kind !== 'categories' && categoryId, subcategoryId, brandId, originId, stock].filter(Boolean).length + (sort !== 'name_asc' ? 1 : 0);
  const resetDrawer = () => {
    if (kind !== 'categories') setCategoryId('');
    setSubcategoryId(''); setBrandId(''); setOriginId(''); setStock(''); setSort('name_asc');
  };
  const resetAll = () => { resetDrawer(); setCategoryId(''); setTyped(''); setQ(''); };
  const narrowed = !!(q || categoryId || drawerCount);

  const stockLabels: Record<string, string> = {
    in: t('sales.port.products.inStock'),
    low: t('sales.port.products.stockStatus.lowStock'),
    out: t('sales.port.products.outOfStock'),
  };
  const sortLabels: Record<string, string> = {
    name_asc: t('sales.port.products.sort.nameAsc'),
    name_desc: t('sales.port.products.sort.nameDesc'),
    newest: t('sales.port.products.sort.newest'),
    oldest: t('sales.port.products.sort.oldest'),
  };

  // The chips: what the drawer narrowed to, each undone with a tap.
  const chips: { key: string; label: string; onClear: () => void }[] = [];
  if (subcategoryId && kind !== 'categories') {
    const s = subcategories.find((x) => x.id === subcategoryId);
    chips.push({ key: 'sub', label: s ? nameOf(s, lang) : t('sales.port.products.chips.subcategory'), onClear: () => setSubcategoryId('') });
  }
  if (brandId) chips.push({ key: 'brand', label: data.brands.find((b) => b.id === brandId)?.name ?? t('sales.port.products.chips.brand'), onClear: () => setBrandId('') });
  if (originId) {
    const o = data.origins.find((x) => x.id === originId);
    chips.push({ key: 'origin', label: o ? label(o) : t('sales.port.products.chips.origin'), onClear: () => setOriginId('') });
  }
  if (stock) chips.push({ key: 'stock', label: stockLabels[stock] ?? stock, onClear: () => setStock('') });
  if (sort !== 'name_asc') chips.push({ key: 'sort', label: sortLabels[sort] ?? sort, onClear: () => setSort('name_asc') });

  // The pills under the search: a shop's categories, a category's subcategories.
  const pills: 'categories' | 'subcategories' | null = kind === 'categories'
    ? (subcategories.length > 0 ? 'subcategories' : null)
    : kind === 'stores' || kind === 'all' ? (data.categories.length > 0 ? 'categories' : null) : null;

  const fields: DrawerField[] = [
    ...(kind !== 'categories' ? [{
      key: 'category', label: t('sales.port.products.chips.category'), value: categoryId, searchable: true,
      onChange: (v: string) => { setCategoryId(v); setSubcategoryId(''); },
      options: [{ value: '', label: t('sales.port.products.allCategories') }, ...data.categories.map((c) => ({ value: c.id, label: nameOf(c, lang) }))],
    }] : []),
    {
      key: 'sub', label: t('sales.port.products.chips.subcategory'), value: subcategoryId, searchable: true,
      onChange: setSubcategoryId, disabled: !theCategory,
      placeholder: theCategory ? t('sales.port.products.allSubcategories') : t('sales.port.products.filters.pickCategoryFirst'),
      options: [{ value: '', label: t('sales.port.products.allSubcategories') }, ...subcategories.map((s) => ({ value: s.id, label: nameOf(s, lang) }))],
    },
    ...(kind !== 'brands' ? [{
      key: 'brand', label: t('sales.port.products.chips.brand'), value: brandId, searchable: true, onChange: setBrandId,
      options: [{ value: '', label: t('sales.port.products.allBrands') }, ...data.brands.map((b) => ({ value: b.id, label: b.name }))],
    }] : []),
    ...(kind !== 'origins' ? [{
      key: 'origin', label: t('sales.port.products.chips.origin'), value: originId, searchable: true, onChange: setOriginId,
      options: [{ value: '', label: t('sales.port.products.allOrigins') }, ...data.origins.map((o) => ({ value: o.id, label: label(o) }))],
    }] : []),
    {
      key: 'stock', label: t('sales.port.products.chips.stock'), value: stock, onChange: setStock,
      options: [{ value: '', label: t('sales.port.products.allStock') }, ...(['in', 'low', 'out'] as const).map((k) => ({ value: k, label: stockLabels[k] }))],
    },
    {
      key: 'sort', label: t('sales.port.products.chips.sort'), value: sort, onChange: setSort,
      options: Object.entries(sortLabels).map(([value, l]) => ({ value, label: l })),
    },
  ];

  // Back to the browse page: through history when it brought us here, so its
  // tab and its place come back; else to the tab this kind of card lives on.
  const back = () => {
    if ((location.state as { fromCatalogue?: boolean } | null)?.fromCatalogue) { navigate(-1); return; }
    navigate(kind === 'all' ? '/sales/catalogue' : `/sales/catalogue?by=${kind}`);
  };

  const count = assignedList ? data.assigned
    : houseList ? data.houseCount
      : shop?.products ?? category?.shop_products ?? origin?.products ?? brand?.products;
  // Cards name their shop while more than one can be on screen.
  const showShop = assignedList || (kind !== 'stores' && data.manyShops);

  return (
    <div>
      <BackLink label={t('sales.catalogue.title')} title={title || undefined} onClick={back} />

      {/* ── Its header ── */}
      {listLoading ? (
        <Card className="mb-3 lg:mb-4 p-4 sm:p-5 flex items-center gap-4">
          <Skeleton className="w-16 h-16 rounded-2xl shrink-0" />
          <div className="flex-1"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-1/3 mt-2" /></div>
        </Card>
      ) : gone ? null : kind === 'all' ? (
        <PageHeader title={title} subtitle={sellingLine(t, lang, data.sellable, data.assigned) ?? undefined} />
      ) : shop || houseList ? (
        <ShopHero
          id={houseList ? HOUSE : id}
          house={houseList}
          name={title}
          cover={shop?.cover_url}
          logo={shop?.logo_url}
          logoBg={shop?.logo_bg}
          tagline={houseList ? t('sales.catalogue.houseBody') : (lang === 'en' && shop?.tagline_en) || shop?.tagline_es}
          hours={shop?.shop_hours}
          countText={countLine(count)}
        />
      ) : (
        <ScopeHeader
          title={title}
          kindLabel={assignedList ? t('sales.catalogue.assignedBody') : t(`sales.catalogue.kindOne.${kind}`)}
          countText={countLine(count)}
          thumb={assignedList ? { icon: PackageCheck }
            : category ? { image: category.icon_url, cover: true, icon: LayoutGrid }
              : origin ? { image: origin.image_url || null, cover: true, icon: MapPin }
                : { image: brand?.logo_url, bg: brand?.logo_bg, icon: Tag }}
        />
      )}

      {gone ? (
        <Card>
          <EmptyState
            icon={<SearchX size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('sales.catalogue.goneTitle')}
            description={t('sales.catalogue.goneBody')}
            action={{ label: t('sales.catalogue.goneCta'), onClick: () => navigate(`/sales/catalogue${kind === 'all' ? '' : `?by=${kind}`}`) }}
          />
        </Card>
      ) : (
        <>
          {/* The search and filters, in reach while the grid scrolls. */}
          <div className="sticky top-14 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 pt-1 pb-3 bg-surface-linen">
            <Card as="div" className="p-3">
              <div className="flex items-center gap-2">
                <SearchInput
                  value={typed}
                  onChange={(v) => { setTyped(v); if (!v) setQ(''); }}
                  placeholder={title && kind !== 'all' ? t('sales.catalogue.searchIn', { name: title }) : t('sales.catalogue.search')}
                  className="flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => setFiltersOpen(true)}
                  aria-label={t('sales.port.products.filters.title')}
                  className={`h-11 lg:h-10 px-3.5 shrink-0 rounded-xl border inline-flex items-center gap-1.5 text-sm font-semibold font-display transition-colors ${
                    drawerCount ? 'border-brand/40 text-brand bg-brand-whisper' : 'border-border bg-card text-ink hover:border-brand/40'
                  }`}
                >
                  <SlidersHorizontal size={17} strokeWidth={1.75} />
                  <span className="hidden sm:inline">{t('sales.port.products.filters.title')}</span>
                  {drawerCount > 0 && (
                    <span className="min-w-[18px] h-[18px] inline-flex items-center justify-center px-1 rounded-full bg-brand text-white text-[10px] font-bold tabular-nums">
                      {drawerCount}
                    </span>
                  )}
                </button>
              </div>

              {pills && (
                <div className="mt-3 pt-3 border-t border-border -mx-3 px-3 overflow-x-auto hide-scrollbar">
                  {pills === 'categories' ? (
                    <div role="group" aria-label={t('sales.catalogue.categories')} className="flex items-center gap-1.5 min-w-max">
                      <CategoryPill active={!categoryId} onClick={() => { setCategoryId(''); setSubcategoryId(''); }} icon={<LayoutGrid size={14} strokeWidth={1.75} />}>
                        {t('sales.catalogue.all')}
                      </CategoryPill>
                      {data.categories.map((c) => (
                        <CategoryPill key={c.id} active={categoryId === c.id} onClick={() => { setCategoryId(c.id); setSubcategoryId(''); }} icon={<CategoryIcon url={c.icon_url} />}>
                          {nameOf(c, lang)}
                        </CategoryPill>
                      ))}
                    </div>
                  ) : (
                    <div role="group" aria-label={t('sales.catalogue.subcategories')} className="flex items-center gap-1.5 min-w-max">
                      <CategoryPill active={!subcategoryId} onClick={() => setSubcategoryId('')} icon={<LayoutGrid size={14} strokeWidth={1.75} />}>
                        {t('sales.catalogue.all')}
                      </CategoryPill>
                      {subcategories.map((s) => (
                        <CategoryPill key={s.id} active={subcategoryId === s.id} onClick={() => setSubcategoryId(s.id)} icon={<LayoutGrid size={14} strokeWidth={1.75} />}>
                          {nameOf(s, lang)}
                        </CategoryPill>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          {chips.length > 0 && (
            <div className="-mt-1 mb-3 flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.onClear}
                  className="inline-flex items-center gap-1 h-8 pl-3 pr-2 rounded-full bg-brand-whisper text-brand ring-1 ring-inset ring-brand/20 text-[12.5px] font-display font-semibold hover:bg-brand-mist transition-colors max-w-full"
                >
                  <span className="truncate">{c.label}</span>
                  <X size={13} strokeWidth={2.5} className="shrink-0" />
                </button>
              ))}
              <button
                type="button"
                onClick={resetDrawer}
                className="h-8 px-2 inline-flex items-center gap-1 text-[12.5px] font-semibold font-display text-gray hover:text-danger"
              >
                <RotateCcw size={13} strokeWidth={2} />
                {t('sales.port.products.filters.clearAll')}
              </button>
            </div>
          )}

          {!listLoading && (
            <ProductResults
              params={{
                q: q || undefined,
                categoryId: categoryId || undefined,
                subcategoryId: subcategoryId || undefined,
                brandId: brandId || undefined,
                originId: originId || undefined,
                stock: (stock === 'in' || stock === 'out' || stock === 'low') ? stock : undefined,
                sort: sort as 'newest' | 'oldest' | 'name_asc' | 'name_desc',
                // Last, so nothing above can loosen the card's own filter.
                ...fixed,
              }}
              narrowed={narrowed}
              onReset={resetAll}
              showShop={showShop}
              none={{ title: t('sales.catalogue.scopeNoneTitle'), body: t('sales.catalogue.scopeNoneBody'), action: { label: t('sales.catalogue.goneCta'), onClick: back } }}
            />
          )}
        </>
      )}

      {filtersOpen && (
        <FilterDrawer
          t={t}
          onClose={() => setFiltersOpen(false)}
          onReset={resetDrawer}
          resetDisabled={drawerCount === 0}
          fields={fields}
        />
      )}
    </div>
  );
}

/**
 * A shop's own header, in its card's look (components/catalogue/Browse): its
 * banner or its awning, then its mark level with its name, line, hours, count.
 */
export function ShopHero({ id, house, name, cover, logo, logoBg, tagline, hours, countText }: {
  id: string; house: boolean; name: string; cover?: string | null; logo?: string | null; logoBg?: string | null; tagline?: string | null;
  hours?: Parameters<typeof HoursLine>[0]['hours']; countText: string | null;
}) {
  const tint = house ? HOUSE_TINT : tintOf(id);
  return (
    <Card className="mb-3 lg:mb-4 overflow-hidden">
      <ShopBanner cover={cover} tint={tint} className="aspect-[5/2] md:aspect-auto md:h-[200px] xl:h-[240px]" bareClassName="h-[104px] md:h-[128px]" />
      {/* The mark level with the name, as on the cards (user, 2026-10-28). */}
      <div className="px-4 sm:px-5 py-4 flex items-center gap-3.5 sm:gap-4">
        <ShopMark name={name} logo={logo} logoBg={logoBg} tint={tint} house={house} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] lg:text-[26px] font-bold font-display text-ink leading-tight tracking-[-0.02em] break-words">{name}</h1>
          {tagline && <p className="mt-0.5 text-[13.5px] text-gray leading-snug">{tagline}</p>}
          {(hours || countText) && (
            <p className="mt-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap text-[13px] font-medium font-display text-gray">
              <HoursLine hours={hours} />
              {countText && <span className="tabular-nums">{countText}</span>}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/** A category's, an origin's or a brand's header: its picture, its name, what it is and how many. */
export function ScopeHeader({ title, kindLabel, countText, thumb }: {
  title: string; kindLabel: string; countText: string | null;
  thumb: { image?: string | null; cover?: boolean; bg?: string | null; icon: React.ElementType };
}) {
  const Icon = thumb.icon;
  const [image, imageFailed] = useImage(thumb.image);
  return (
    <Card className="mb-3 lg:mb-4 p-4 sm:p-5 flex items-center gap-4">
      <span
        className={`w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-2xl overflow-hidden shrink-0 flex items-center justify-center ${
          image ? 'sales-photo ring-1 ring-inset ring-border' : 'bg-brand-whisper text-brand'
        }`}
        style={image && !thumb.cover ? { backgroundColor: thumb.bg || '#FFFFFF' } : undefined}
      >
        {image
          ? <img src={resolveImageUrl(image, 'tile')} alt="" className={`w-full h-full ${thumb.cover ? 'object-cover' : 'object-contain p-2'}`} draggable={false} onError={imageFailed} />
          : <Icon size={28} strokeWidth={1.75} />}
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] lg:text-[26px] font-bold font-display text-ink leading-tight tracking-[-0.02em] break-words">{title}</h1>
        <p className="mt-1 text-[13px] font-medium font-display text-gray leading-snug">
          {kindLabel}
          {countText && <span className="tabular-nums">{'  ·  '}{countText}</span>}
        </p>
      </div>
    </Card>
  );
}
