import { Search, X } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { useLanguageStore } from '@/stores/languageStore';

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: string;
  onValueChange: (v: string) => void;
  /** Wrapper class — pass sizing/flex here, not on the input. */
  className?: string;
}

/**
 * The customer site's search input: 44px, rounded-xl, hairline border that
 * turns brand green with a brand-mist ring on focus.
 *
 * Its own component rather than `TextField` because the two are different
 * controls: TextField is a 52px labelled form field with hint and error slots,
 * this is a compact inline filter with a leading magnifier and a clear button.
 * Sharing one would mean a pile of props that switch between two designs.
 *
 * Escape clears, which is what a search box is expected to do and what the
 * stores index already did inline.
 */
const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onValueChange, className = '', placeholder, ...inputProps },
  ref,
) {
  const { lang } = useLanguageStore();
  const clearLabel = lang === 'en' ? 'Clear search' : 'Borrar búsqueda';

  return (
    <div className={`relative ${className}`}>
      <Search
        size={16}
        strokeWidth={2}
        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        aria-hidden
      />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onValueChange(''); }}
        placeholder={placeholder}
        aria-label={inputProps['aria-label'] ?? placeholder}
        className="w-full h-11 pl-10 pr-10 rounded-xl border border-border bg-card text-[13.5px] font-ui text-ink placeholder:text-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-mist transition-colors"
        {...inputProps}
      />
      {value && (
        <button
          type="button"
          onClick={() => onValueChange('')}
          aria-label={clearLabel}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-surface-sand transition-colors"
        >
          <X size={15} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
});

export default SearchField;
