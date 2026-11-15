import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LayoutGrid, MapPin, RotateCcw, SearchX, SlidersHorizontal, Tag, X } from 'lucide-react';
import { useSubcategories } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import BackLink from '@/sales/components/BackLink';
import { Card, PageHeader, SearchInput } from '@/sales/components/ui';
import EmptyState from '@/sales/components/EmptyState';
import { Skeleton } from '@/sales/components/Skeleton';
import { CategoryIcon, CategoryPill, FilterDrawer, type DrawerField } from '@/sales/components/catalogue/Products';
import { HOUSE, nameOf, useCountLine, type BrowseKind } from '@/sales/components/catalogue/data';
import { ScopeHeader, ShopHero } from '@/sales/SalesCatalogueListPage';
import { useSalesT } from '@/sales/lib/i18n';
import { useBizT } from './lib/i18n';
import { useBizBrowseData } from './lib/catalogue';
import { ProductResults } from './components/catalogue';

/**
 * The products behind one of the business Catálogo's cards (2026-10-29): a
 * shop (or Cesto's own), a category, an origin or a brand — or everything
 * (`/business/catalogue/all`). The rep's list (sales/SalesCatalogueListPage):
 * the card's own header, then a search and filters that narrow inside it and
 * never out of it — the card's own filter is fixed and the drawer does not
 * offer it.
 */

type Kind = BrowseKind | 'all';
const KINDS: Kind[] = ['stores', 'categories', 'origins', 'brands', 'all'];

export default function BusinessCatalogueListPage() {
  const { pathname } = useLocation();
  return <CatalogueList key={pathname} />;
}

function CatalogueList() {
  const t = useBizT();
  const salesT = useSalesT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const kind: Kind = params.kind && (KINDS as string[]).includes(params.kind) ? params.kind as Kind : 'all';
  const id = params.id ?? '';
  const data = useBizBrowseData();
  const countLine = useCountLine();
  const label = (o: { label_es: string; label_en?: string | null }) => (lang === 'en' && o.label_en) || o.label_es;

  const houseList = kind === 'stores' && id === HOUSE;
  const shop = kind === 'stores' && !houseList ? data.shopCards.find((s) => s.id === id) : undefined;
  const category = kind === 'categories' ? data.categories.find((c) => c.id === id) : undefined;
  const origin = kind === 'origins' ? data.origins.find((o) => o.id === id) : undefined;
  const brand = kind === 'brands' ? data.brands.find((b) => b.id === id) : undefined;

  const listLoading = kind === 'all' ? false : data.queries[kind].isLoading;
  const found = kind === 'all' || (houseList ? data.house : !!(shop || category || origin || brand));
  const gone = !listLoading && !found;

  const title = kind === 'all' ? t('biz.cat.allTitle')
    : houseList ? t('biz.house')
      : shop?.name ?? (category ? nameOf(category, lang) : origin ? label(origin) : brand?.name) ?? '';

  const fixed = kind === 'stores' ? { storeId: id }
    : kind === 'categories' ? { categoryId: id }
      : kind === 'origins' ? { originId: id }
        : kind === 'brands' ? { brandId: id } : {};

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
  // A link may ask for an order (the home's "new in your catalogue": ?sort=newest).
  const [searchParams] = useSearchParams();
  const [sort, setSort] = useState(() => {
    const asked = searchParams.get('sort') ?? '';
    return ['name_asc', 'name_desc', 'newest'].includes(asked) ? asked : 'name_asc';
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  const theCategory = kind === 'categories' ? id : categoryId;
  const { data: subcategoriesData } = useSubcategories(theCategory || undefined);
  const subcategories = theCategory ? (subcategoriesData ?? []) : [];

  const drawerCount = [kind !== 'categories' && categoryId, subcategoryId, brandId, originId, stock].filter(Boolean).length + (sort !== 'name_asc' ? 1 : 0);
  const resetDrawer = () => {
    if (kind !== 'categories') setCategoryId('');
    setSubcategoryId(''); setBrandId(''); setOriginId(''); setStock(''); setSort('name_asc');
  };
  const resetAll = () => { resetDrawer(); setCategoryId(''); setTyped(''); setQ(''); };
  const narrowed = !!(q || categoryId || drawerCount);

  const sortLabels: Record<string, string> = {
    name_asc: t('biz.cat.sort.nameAsc'),
    name_desc: t('biz.cat.sort.nameDesc'),
    newest: t('biz.cat.sort.newest'),
  };

  const chips: { key: string; label: string; onClear: () => void }[] = [];
  if (subcategoryId && kind !== 'categories') {
    const s = subcategories.find((x) => x.id === subcategoryId);
    chips.push({ key: 'sub', label: s ? nameOf(s, lang) : t('biz.cat.filter.subcategory'), onClear: () => setSubcategoryId('') });
  }
  if (brandId) chips.push({ key: 'brand', label: data.brands.find((b) => b.id === brandId)?.name ?? t('biz.cat.filter.brand'), onClear: () => setBrandId('') });
  if (originId) {
    const o = data.origins.find((x) => x.id === originId);
    chips.push({ key: 'origin', label: o ? label(o) : t('biz.cat.filter.origin'), onClear: () => setOriginId('') });
  }
  if (stock) chips.push({ key: 'stock', label: t('biz.cat.inStock'), onClear: () => setStock('') });
  if (sort !== 'name_asc') chips.push({ key: 'sort', label: sortLabels[sort] ?? sort, onClear: () => setSort('name_asc') });

  const pills: 'categories' | 'subcategories' | null = kind === 'categories'
    ? (subcategories.length > 0 ? 'subcategories' : null)
    : kind === 'stores' || kind === 'all' ? (data.categories.length > 0 ? 'categories' : null) : null;

  const fields: DrawerField[] = [
    ...(kind !== 'categories' ? [{
      key: 'category', label: t('biz.cat.filter.category'), value: categoryId, searchable: true,
      onChange: (v: string) => { setCategoryId(v); setSubcategoryId(''); },
      options: [{ value: '', label: t('biz.cat.filter.allCategories') }, ...data.categories.map((c) => ({ value: c.id, label: nameOf(c, lang) }))],
    }] : []),
    {
      key: 'sub', label: t('biz.cat.filter.subcategory'), value: subcategoryId, searchable: true,
      onChange: setSubcategoryId, disabled: !theCategory,
      placeholder: theCategory ? t('biz.cat.filter.allSubcategories') : t('biz.cat.filter.pickCategoryFirst'),
      options: [{ value: '', label: t('biz.cat.filter.allSubcategories') }, ...subcategories.map((s) => ({ value: s.id, label: nameOf(s, lang) }))],
    },
    ...(kind !== 'brands' ? [{
      key: 'brand', label: t('biz.cat.filter.brand'), value: brandId, searchable: true, onChange: setBrandId,
      options: [{ value: '', label: t('biz.cat.filter.allBrands') }, ...data.brands.map((b) => ({ value: b.id, label: b.name }))],
    }] : []),
    ...(kind !== 'origins' ? [{
      key: 'origin', label: t('biz.cat.filter.origin'), value: originId, searchable: true, onChange: setOriginId,
      options: [{ value: '', label: t('biz.cat.filter.allOrigins') }, ...data.origins.map((o) => ({ value: o.id, label: label(o) }))],
    }] : []),
    {
      key: 'stock', label: t('biz.cat.filter.stock'), value: stock, onChange: setStock,
      options: [{ value: '', label: t('biz.cat.filter.allStock') }, { value: 'in', label: t('biz.cat.inStock') }],
    },
    {
      key: 'sort', label: t('biz.cat.filter.sort'), value: sort, onChange: setSort,
      options: Object.entries(sortLabels).map(([value, l]) => ({ value, label: l })),
    },
  ];

  const back = () => {
    if ((location.state as { fromCatalogue?: boolean } | null)?.fromCatalogue) { navigate(-1); return; }
    navigate(kind === 'all' ? '/business/catalogue' : `/business/catalogue?by=${kind}`);
  };

  const count = houseList ? data.houseCount : shop?.products ?? category?.products ?? origin?.products ?? brand?.products;
  const showShop = kind !== 'stores' && data.manyShops;

  return (
    <div>
      <BackLink label={t('biz.cat.title')} title={title || undefined} onClick={back} />

      {listLoading ? (
        <Card className="mb-3 lg:mb-4 p-4 sm:p-5 flex items-center gap-4">
          <Skeleton className="w-16 h-16 rounded-2xl shrink-0" />
          <div className="flex-1"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-4 w-1/3 mt-2" /></div>
        </Card>
      ) : gone ? null : kind === 'all' ? (
        <PageHeader title={title} subtitle={t('biz.cat.subtitle')} />
      ) : shop || houseList ? (
        <ShopHero
          id={houseList ? HOUSE : id}
          house={houseList}
          name={title}
          cover={shop?.cover_url}
          logo={shop?.logo_url}
          logoBg={shop?.logo_bg}
          tagline={houseList ? t('biz.cat.houseBody') : (lang === 'en' && shop?.tagline_en) || shop?.tagline_es}
          hours={shop?.shop_hours}
          countText={countLine(count)}
        />
      ) : (
        <ScopeHeader
          title={title}
          kindLabel={t(`biz.cat.kindOne.${kind}`)}
          countText={countLine(count)}
          thumb={category ? { image: category.icon_url, cover: true, icon: LayoutGrid }
            : origin ? { image: origin.image_url || null, cover: true, icon: MapPin }
              : { image: brand?.logo_url, bg: brand?.logo_bg, icon: Tag }}
        />
      )}

      {gone ? (
        <Card>
          <EmptyState
            icon={<SearchX size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('biz.cat.goneTitle')}
            description={t('biz.cat.goneBody')}
            action={{ label: t('biz.cat.goneCta'), onClick: () => navigate(`/business/catalogue?by=${kind}`) }}
          />
        </Card>
      ) : (
        <>
          <div className="sticky top-14 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 pt-1 pb-3 bg-surface-linen">
            <Card as="div" className="p-3">
              <div className="flex items-center gap-2">
                <SearchInput
                  value={typed}
                  onChange={(v) => { setTyped(v); if (!v) setQ(''); }}
                  placeholder={title && kind !== 'all' ? t('biz.cat.searchIn', { name: title }) : t('biz.cat.search')}
                  className="flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => setFiltersOpen(true)}
                  aria-label={t('biz.cat.filter.title')}
                  className={`h-11 lg:h-10 px-3.5 shrink-0 rounded-xl border inline-flex items-center gap-1.5 text-sm font-semibold font-display transition-colors ${
                    drawerCount ? 'border-brand/40 text-brand bg-brand-whisper' : 'border-border bg-card text-ink hover:border-brand/40'
                  }`}
                >
                  <SlidersHorizontal size={17} strokeWidth={1.75} />
                  <span className="hidden sm:inline">{t('biz.cat.filter.title')}</span>
                  {drawerCount > 0 && (
                    <span className="min-w-[18px] h-[18px] inline-flex items-center justify-center px-1 rounded-full bg-brand text-white text-[10px] font-bold tabular-nums">{drawerCount}</span>
                  )}
                </button>
              </div>

              {pills && (
                <div className="mt-3 pt-3 border-t border-border -mx-3 px-3 overflow-x-auto hide-scrollbar">
                  {pills === 'categories' ? (
                    <div role="group" aria-label={t('biz.cat.filter.category')} className="flex items-center gap-1.5 min-w-max">
                      <CategoryPill active={!categoryId} onClick={() => { setCategoryId(''); setSubcategoryId(''); }} icon={<LayoutGrid size={14} strokeWidth={1.75} />}>
                        {t('biz.cat.all')}
                      </CategoryPill>
                      {data.categories.map((c) => (
                        <CategoryPill key={c.id} active={categoryId === c.id} onClick={() => { setCategoryId(c.id); setSubcategoryId(''); }} icon={<CategoryIcon url={c.icon_url} />}>
                          {nameOf(c, lang)}
                        </CategoryPill>
                      ))}
                    </div>
                  ) : (
                    <div role="group" aria-label={t('biz.cat.filter.subcategory')} className="flex items-center gap-1.5 min-w-max">
                      <CategoryPill active={!subcategoryId} onClick={() => setSubcategoryId('')} icon={<LayoutGrid size={14} strokeWidth={1.75} />}>
                        {t('biz.cat.all')}
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
              <button type="button" onClick={resetDrawer} className="h-8 px-2 inline-flex items-center gap-1 text-[12.5px] font-semibold font-display text-gray hover:text-danger">
                <RotateCcw size={13} strokeWidth={2} />
                {t('biz.cat.filter.clearAll')}
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
                stock: stock === 'in' ? 'in' : undefined,
                sort: sort as 'newest' | 'name_asc' | 'name_desc',
                // Last, so nothing above can loosen the card's own filter.
                ...fixed,
              }}
              narrowed={narrowed}
              onReset={resetAll}
              showShop={showShop}
              none={{ title: t('biz.cat.scopeNoneTitle'), body: t('biz.cat.scopeNoneBody'), action: { label: t('biz.cat.goneCta'), onClick: back } }}
            />
          )}
        </>
      )}

      {filtersOpen && (
        <FilterDrawer t={salesT} onClose={() => setFiltersOpen(false)} onReset={resetDrawer} resetDisabled={drawerCount === 0} fields={fields} />
      )}
    </div>
  );
}
