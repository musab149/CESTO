// ─── Distance-based delivery pricing, admin side ───────────
//
// Lives outside the Settings page's react-hook-form on purpose. Everything
// else on that page is a flat scalar field; this is a mode switch, a geocoded
// point and a variable-length ladder, and threading that through RHF's
// useFieldArray would buy validation we do not want anyway — the rungs are
// checked as a set (ascending, one open end), not one input at a time.
//
// So it is plain controlled state owned by the page, handed down here, and
// sent with the rest of the payload on save. The server re-sorts and repairs
// the ladder it receives, so what an admin sees after a save is what pricing
// actually reads.

import { useState } from 'react';
import { MapPin, Plus, Trash2, LoaderCircle, TriangleAlert, Info } from 'lucide-react';
import { TextField } from '@/components/form';
import { adminSettings, type DeliveryBand, type DeliveryPricingMode } from '@grocery-app/shared';

/**
 * A band while it is being edited.
 *
 * Fields are strings, not numbers, because a half-typed "1" in a number input
 * must not be read as a €1 fee and a cleared field must stay cleared rather
 * than snapping to 0. They are parsed once, on save.
 */
export interface BandDraft {
  /** Stable key for React across reorders and deletes. */
  key: string;
  upToKm: string;
  fee: string;
}

export const newBandDraft = (): BandDraft => ({
  key: Math.random().toString(36).slice(2),
  upToKm: '',
  fee: '',
});

/** Server band → editable draft. A null becomes an empty field. */
export const bandToDraft = (b: DeliveryBand): BandDraft => ({
  key: Math.random().toString(36).slice(2),
  upToKm: b.upToKm === null ? '' : String(b.upToKm),
  fee: String(b.fee),
});

/**
 * Draft → server band. An empty distance is the open-ended final rung, which
 * is a real value — hence the drafts keeping '' distinct from '0'.
 *
 * Rows with no fee at all are dropped: they are rows an admin added and did
 * not fill in, and saving them as €0 would quietly ship those orders free.
 */
export const draftsToBands = (drafts: BandDraft[]): DeliveryBand[] =>
  drafts
    .filter((d) => d.fee.trim() !== '')
    .map((d) => ({
      upToKm: d.upToKm.trim() === '' ? null : Number(d.upToKm),
      fee: Number(d.fee),
    }));

interface Props {
  mode: DeliveryPricingMode;
  onModeChange: (m: DeliveryPricingMode) => void;
  originAddress: string;
  onOriginAddressChange: (v: string) => void;
  originLat: number | null;
  originLng: number | null;
  onOriginLocated: (lat: number, lng: number) => void;
  bands: BandDraft[];
  onBandsChange: (b: BandDraft[]) => void;
}

export default function DeliveryPricingEditor({
  mode,
  onModeChange,
  originAddress,
  onOriginAddressChange,
  originLat,
  originLng,
  onOriginLocated,
  bands,
  onBandsChange,
}: Props) {
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [located, setLocated] = useState<string | null>(null);

  const hasOrigin = originLat !== null && originLng !== null;

  const locate = async () => {
    setLocating(true);
    setLocateError(null);
    setLocated(null);
    try {
      const r = await adminSettings.geocode(originAddress);
      onOriginLocated(r.lat, r.lng);
      setLocated(r.formatted);
      // APPROXIMATE means Google matched a town or region rather than the
      // street, so every delivery is measured from the centre of somewhere.
      // Worth saying out loud: the ladder still works, it is just coarser
      // than the admin probably intended.
      if (r.precision === 'APPROXIMATE') {
        setLocateError(
          'Matched only approximately — add a street number for a more exact origin.',
        );
      }
    } catch (err) {
      setLocateError(err instanceof Error ? err.message : 'Could not locate that address.');
    } finally {
      setLocating(false);
    }
  };

  const patchBand = (key: string, patch: Partial<BandDraft>) =>
    onBandsChange(bands.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  return (
    <div className="space-y-6">
      {/* ── Mode ─────────────────────────────────────────── */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-display font-semibold text-ink mb-2">
          How delivery is priced
        </legend>

        {(
          [
            {
              value: 'flat' as const,
              title: 'One flat fee',
              desc: 'Every order pays the same, wherever it goes.',
            },
            {
              value: 'distance' as const,
              title: 'By distance',
              desc: 'The fee comes from a ladder of distance bands, measured from your dispatch address.',
            },
          ]
        ).map((opt) => (
          <label
            key={opt.value}
            className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
              mode === opt.value
                ? 'border-brand bg-brand-mist/40'
                : 'border-border bg-card hover:bg-surface-cream/50'
            }`}
          >
            <input
              type="radio"
              name="deliveryPricingMode"
              className="mt-0.5 accent-brand"
              checked={mode === opt.value}
              onChange={() => onModeChange(opt.value)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-display font-semibold text-ink">{opt.title}</span>
              <span className="block text-xs text-ink/60 font-body mt-0.5">{opt.desc}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {mode === 'distance' && (
        <>
          {/* ── Origin ───────────────────────────────────── */}
          <div className="space-y-3 pt-1">
            <div>
              <h3 className="text-sm font-display font-semibold text-ink">Dispatch address</h3>
              <p className="text-xs text-ink/60 font-body mt-0.5">
                Distances are measured from here in a straight line. Locate it once; it is only
                re-checked when you press the button again.
              </p>
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <TextField
                  label="Address"
                  placeholder="Calle Gran Vía 1, 28013 Madrid"
                  leadingIcon={<MapPin size={16} strokeWidth={1.75} />}
                  value={originAddress}
                  onChange={(e) => onOriginAddressChange(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={locate}
                disabled={locating || originAddress.trim().length < 3}
                className="h-[52px] px-4 rounded-xl bg-ink text-card text-sm font-display font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed hover:bg-ink/90 transition-colors inline-flex items-center gap-2"
              >
                {locating ? (
                  <LoaderCircle size={16} strokeWidth={1.75} className="animate-spin" />
                ) : (
                  <MapPin size={16} strokeWidth={1.75} />
                )}
                Locate
              </button>
            </div>

            {hasOrigin ? (
              <p className="text-xs font-mono text-ink/70 bg-surface-cream rounded-lg px-3 py-2">
                {originLat!.toFixed(5)}, {originLng!.toFixed(5)}
                {located && <span className="font-body text-ink/50"> · {located}</span>}
              </p>
            ) : (
              <p className="inline-flex items-start gap-2 text-xs text-warning font-body">
                <TriangleAlert size={14} strokeWidth={1.75} className="mt-px flex-shrink-0" />
                No origin set yet. Until you locate one, every order is charged the flat fee below.
              </p>
            )}

            {locateError && (
              <p className="inline-flex items-start gap-2 text-xs text-danger font-body">
                <TriangleAlert size={14} strokeWidth={1.75} className="mt-px flex-shrink-0" />
                {locateError}
              </p>
            )}
          </div>

          {/* ── Bands ────────────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-display font-semibold text-ink">Distance bands</h3>
              <p className="text-xs text-ink/60 font-body mt-0.5">
                Leave the distance blank on the last row to make it the catch-all — it then covers
                everything further out, so no order is ever left unpriced.
              </p>
            </div>

            {bands.length > 0 && (
              <div className="overflow-x-auto">
                {/* Two inputs and a delete: fits a phone as it is — the 440px floor only from sm (2026-11-05). */}
                <table className="w-full sm:min-w-[440px] text-sm">
                  <thead>
                    <tr className="text-left text-xs font-display font-semibold text-ink/50">
                      <th className="pb-2 pr-3 font-medium">Up to (km)</th>
                      <th className="pb-2 pr-3 font-medium">Fee (€)</th>
                      <th className="pb-2 w-9" />
                    </tr>
                  </thead>
                  <tbody>
                    {bands.map((b, i) => (
                      <tr key={b.key}>
                        <td className="py-1 pr-3">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={b.upToKm}
                            onChange={(e) => patchBand(b.key, { upToKm: e.target.value })}
                            placeholder={i === bands.length - 1 ? 'and beyond' : '5'}
                            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-ink font-display text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                          />
                        </td>
                        <td className="py-1 pr-3">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={b.fee}
                            onChange={(e) => patchBand(b.key, { fee: e.target.value })}
                            placeholder="3.50"
                            className="w-full h-10 px-3 rounded-lg border border-border bg-card text-ink font-display text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                          />
                        </td>
                        <td className="py-1">
                          <button
                            type="button"
                            onClick={() => onBandsChange(bands.filter((x) => x.key !== b.key))}
                            aria-label="Remove band"
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-ink/40 hover:text-danger hover:bg-danger-bg transition-colors"
                          >
                            <Trash2 size={16} strokeWidth={1.75} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button
              type="button"
              onClick={() => onBandsChange([...bands, newBandDraft()])}
              className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-border bg-card text-sm font-display font-semibold text-ink hover:bg-surface-cream transition-colors"
            >
              <Plus size={16} strokeWidth={1.75} />
              Add band
            </button>

            {bands.length === 0 && (
              <p className="inline-flex items-start gap-2 text-xs text-warning font-body">
                <TriangleAlert size={14} strokeWidth={1.75} className="mt-px flex-shrink-0" />
                No bands yet. Distance pricing cannot be saved without at least one.
              </p>
            )}
          </div>

          <p className="flex items-start gap-2 text-xs text-ink/55 font-body bg-surface-cream rounded-lg px-3 py-2.5">
            <Info size={14} strokeWidth={1.75} className="mt-px flex-shrink-0" />
            <span>
              Distances are straight-line, so they read lower than the road route — usually by
              20–30% in a city. Set the fees against the numbers you see on real orders. The flat
              fee below is still charged whenever a distance cannot be worked out, such as an
              address the map could not find.
            </span>
          </p>
        </>
      )}
    </div>
  );
}
