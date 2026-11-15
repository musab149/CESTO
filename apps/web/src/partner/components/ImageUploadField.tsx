import { useRef, useState } from 'react';
import { Upload, X, Link as LinkIcon, Loader2, AlertCircle } from 'lucide-react';
import { partnerUploads, resolveImageUrl } from '@grocery-app/shared';

interface Props {
  value: string | null;
  onChange: (next: string | null) => void;
  label?: string;
  helperText?: string;
  /** Reject files larger than this many MB (default 5). */
  maxSizeMB?: number;
}

/**
 * Partner-scoped image picker. Structural mirror of admin's
 * ImageUploadField ([apps/admin/src/components/home-preview/ImageUploadField.tsx])
 * but hits partnerUploads.uploadImage which routes to /api/partner/uploads/image
 * — that endpoint is gated on requirePartnerRole so a partner can only
 * upload against their own store.
 *
 * Two modes:
 *   1. Paste a URL — stores the URL verbatim.
 *   2. Pick / drop a file — POSTed to /api/partner/uploads/image, response
 *      URL is stored on the form. Never stores base64 blobs, so the store
 *      row stays slim and PATCH bodies don't blow past the API limit.
 */
export default function PartnerImageUploadField({
  value,
  onChange,
  label = 'Image',
  helperText,
  maxSizeMB = 5,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'url' | 'file'>('url');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(`File must be an image (got ${file.type || 'unknown type'}).`);
      return;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      setError(`Image too large — max ${maxSizeMB} MB, this file is ${mb} MB.`);
      return;
    }
    setUploading(true);
    try {
      const res = await partnerUploads.uploadImage(file);
      onChange(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  const previewSrc = value ? resolveImageUrl(value, 'tile') : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-sm font-semibold font-display text-ink">{label}</label>
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-[11px] font-semibold font-display">
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`px-2.5 py-1 flex items-center gap-1 ${
              mode === 'url' ? 'bg-brand text-white' : 'bg-white text-gray hover:bg-surface-linen'
            }`}
          >
            <LinkIcon size={11} strokeWidth={2.25} /> URL
          </button>
          <button
            type="button"
            onClick={() => setMode('file')}
            className={`px-2.5 py-1 flex items-center gap-1 ${
              mode === 'file' ? 'bg-brand text-white' : 'bg-white text-gray hover:bg-surface-linen'
            }`}
          >
            <Upload size={11} strokeWidth={2.25} /> File
          </button>
        </div>
      </div>

      {mode === 'url' ? (
        <input
          type="url"
          value={value && !value.startsWith('data:') ? value : ''}
          onChange={(e) => onChange(e.target.value.trim() ? e.target.value.trim() : null)}
          placeholder="https://..."
          className="w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
        />
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className="flex items-center gap-3 bg-surface-cream border border-dashed border-border rounded-lg p-3"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="h-9 px-3 rounded-lg text-xs font-semibold font-display border-2 border-brand text-brand hover:bg-brand-mist transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 size={13} strokeWidth={2} className="animate-spin" /> Uploading…
              </>
            ) : (
              <>
                <Upload size={13} strokeWidth={2} /> Choose file
              </>
            )}
          </button>
          <span className="text-xs text-muted font-display flex-1 truncate">
            or drag &amp; drop here · max {maxSizeMB} MB
          </span>
        </div>
      )}

      {previewSrc && (
        <div className="mt-2 flex items-center gap-3">
          <div className="w-14 h-14 rounded-lg overflow-hidden border border-border bg-surface-cream shrink-0">
            <img src={previewSrc} alt="" className="w-full h-full object-cover" />
          </div>
          <span className="text-[11px] text-muted font-display flex-1 truncate">
            {value && value.startsWith('data:') ? 'Embedded file (legacy)' : value}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="p-1.5 rounded-lg hover:bg-surface-linen text-muted hover:text-danger transition-colors"
            aria-label="Remove image"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2.5"
        >
          <AlertCircle size={16} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold font-display text-danger leading-tight">
              Upload failed
            </p>
            <p className="mt-0.5 text-[12px] text-danger/85 font-body break-words">
              {error}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="p-1 rounded hover:bg-danger/10 text-danger/70 hover:text-danger transition-colors"
            aria-label="Dismiss error"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}
      {helperText && !error && (
        <p className="mt-2 text-[11px] text-muted font-display">{helperText}</p>
      )}
    </div>
  );
}
