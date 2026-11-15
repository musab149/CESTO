import { TextField, Textarea } from '@/components/form';

/** Edits a Spanish/English pair side by side, so neither is forgotten. */
export default function BilingualRow({
  label, es, en, onEs, onEn, long = false, max,
}: {
  label: string;
  es: string;
  en: string;
  onEs: (v: string) => void;
  onEn: (v: string) => void;
  long?: boolean;
  max?: number;
}) {
  const Field = long ? Textarea : TextField;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label={`${label} (ES)`}
        value={es}
        maxLength={max}
        onChange={(e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => onEs(e.target.value)}
        {...(long ? { rows: 3 } : {})}
      />
      <Field
        label={`${label} (EN)`}
        value={en}
        maxLength={max}
        onChange={(e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => onEn(e.target.value)}
        {...(long ? { rows: 3 } : {})}
      />
    </div>
  );
}
