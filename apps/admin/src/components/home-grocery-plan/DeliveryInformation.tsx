import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Clock, MapPin, Pencil, Repeat } from 'lucide-react';
import { useAdminCreatePlan, useAdminUpdatePlanSettings, type StaffPlanView } from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import PlanScheduleFields, { type ScheduleValue } from './PlanScheduleFields';
import { WINDOW_HOURS, weekdayName } from './planFormat';

/**
 * A Home Grocery household's delivery information, on its customer page
 * (2026-10-23 — there is no household page any more). How often, which day,
 * which part of the day, where: what it told us in its request, which
 * suggests the day and time of each order. Read, changed, or — for a
 * household that had no address when it was approved — added here.
 */
export default function DeliveryInformation({ view, userId }: { view: StaffPlanView; userId: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const update = useAdminUpdatePlanSettings(userId);
  const create = useAdminCreatePlan(userId);
  const plan = view.plan;
  const [draft, setDraft] = useState<ScheduleValue | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const current = (): ScheduleValue => (plan
    ? {
        frequency: plan.frequency,
        preferred_weekday: plan.preferred_weekday,
        preferred_window: plan.preferred_window,
        address_id: plan.address?.id ?? null,
      }
    : {
        frequency: view.profile?.frequency ?? 'biweekly',
        preferred_weekday: null,
        preferred_window: null,
        address_id: view.addresses.find((a) => a.is_default)?.id ?? view.addresses[0]?.id ?? null,
      });
  const open = () => { setErr(null); setDraft(current()); };

  const save = async () => {
    if (!draft) return;
    setErr(null);
    try {
      if (plan) {
        await update.mutateAsync({
          frequency: draft.frequency === 'every_6_weeks' ? undefined : draft.frequency,
          preferred_weekday: draft.preferred_weekday,
          preferred_window: draft.preferred_window,
          ...(draft.address_id && draft.address_id !== plan.address?.id ? { address_id: draft.address_id } : {}),
        });
      } else {
        if (!draft.address_id) return;
        await create.mutateAsync({
          address_id: draft.address_id,
          frequency: draft.frequency === 'every_6_weeks' ? 'biweekly' : draft.frequency,
          preferred_weekday: draft.preferred_weekday,
          preferred_window: draft.preferred_window,
        });
      }
      setDraft(null);
      toast.success(t('hgPlan.done.saved', 'Saved.'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('hgPlan.failed', 'That did not go through.'));
    }
  };

  const saving = update.isPending || create.isPending;
  const a = plan?.address;

  return (
    <div className="rounded-lg border border-border bg-surface-cream/60">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-border/70">
        <span className="text-sm font-semibold font-display text-ink">{t('hgPlan.settings.title', 'Delivery information')}</span>
        {!draft && plan && (
          <button
            type="button"
            onClick={open}
            className="text-[12.5px] font-semibold font-display text-brand hover:underline inline-flex items-center gap-1"
          >
            <Pencil size={13} strokeWidth={2} />
            {t('hgPlan.schedule.edit', 'Edit')}
          </button>
        )}
      </div>

      {draft ? (
        <>
          <div className="p-3.5">
            <PlanScheduleFields value={draft} onChange={setDraft} addresses={view.addresses} userId={userId} />
          </div>
          {err && <p role="alert" className="mx-3.5 mb-3 rounded-lg bg-danger-bg px-3 py-2 text-[12.5px] text-danger font-display">{err}</p>}
          <div className="px-3.5 py-3 border-t border-border/70 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="h-11 sm:h-10 px-4 rounded-xl border border-border bg-card text-sm font-semibold font-display text-gray hover:text-ink transition-colors"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !draft.address_id}
              className="h-11 sm:h-10 px-5 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition-colors disabled:opacity-50"
            >
              {saving ? t('hgPlan.saving', 'Saving…') : t('hgPlan.settings.save', 'Save')}
            </button>
          </div>
        </>
      ) : plan ? (
        <dl className="p-3.5 space-y-3">
          <Row icon={Repeat} label={t('hgPlan.schedule.frequency', 'How often')}>
            {t(`homeGrocery.frequency.${plan.frequency}`, plan.frequency)}
          </Row>
          <Row icon={CalendarDays} label={t('hgPlan.schedule.day', 'Preferred day')}>
            {plan.preferred_weekday ? weekdayName(plan.preferred_weekday, i18n.language) : t('hgPlan.schedule.anyDay', 'Any day')}
          </Row>
          <Row icon={Clock} label={t('hgPlan.schedule.window', 'Time of day')}>
            {plan.preferred_window
              ? <>{t(`hgPlan.window.${plan.preferred_window}`, plan.preferred_window)} <span className="text-muted">· {WINDOW_HOURS[plan.preferred_window]}</span></>
              : t('hgPlan.schedule.anyTime', 'Any time')}
          </Row>
          <Row icon={MapPin} label={t('hgPlan.schedule.address', 'Delivery address')}>
            {a ? (
              <>
                {a.street_line_1}{a.street_line_2 ? `, ${a.street_line_2}` : ''}
                <br />
                <span className="font-mono text-[12.5px]">{a.postcode}</span> {a.city}
              </>
            ) : '—'}
          </Row>
        </dl>
      ) : (
        <div className="p-3.5">
          <p className="text-[12.5px] font-display text-muted">
            {t('customerDetail.planNoneSettings', 'Set up how often, when and where they like it. Each order then gets its own day and time.')}
          </p>
          <button
            type="button"
            onClick={open}
            className="mt-3 w-full min-h-[44px] rounded-xl border border-border bg-card text-ink hover:border-brand hover:text-brand text-sm font-semibold font-display transition-colors"
          >
            {t('customerDetail.setUpPlan', 'Add delivery information')}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Repeat; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-muted mt-0.5 shrink-0" strokeWidth={1.75} />
      <div className="min-w-0">
        <dt className="text-xs text-muted font-display">{label}</dt>
        <dd className="text-sm text-ink break-words">{children}</dd>
      </div>
    </div>
  );
}
