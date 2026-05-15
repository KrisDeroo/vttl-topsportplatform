/**
 * <EventCreateSheet> — RHF form Sheet for `calendar.event.create`.
 *
 * Listens for `calendar:open-create` (dispatched by <CalendarToolbar>'s
 * "Nieuwe afspraak" CTA AND by <CalendarView> on select-range — Plan 06)
 * with `{ start?: string; end?: string }`.
 *
 * Form shape: a SINGLE flat RHF schema rather than a Zod discriminated-union
 * resolver. RHF + zodResolver + z.discriminatedUnion is fragile (the form
 * state is the superset of all branch fields, but the resolver narrows on
 * `type`); we keep RHF lean and defer authoritative validation to the
 * server's Zod schema (returns `errors.calendar.*` i18n keys that the
 * existing `useZodErrorMessage` helper resolves).
 *
 * Submit flow (D-57):
 *   1. Build the typed discriminated-union payload from flat form state.
 *   2. POST `calendar.event.create` with `force: false`.
 *   3a. Success → toast + invalidate + close.
 *   3b. CONFLICT → render <ConflictWarning> inline (above submit button)
 *      with two CTAs: "Toch opslaan" (re-submits with force:true,
 *      server writes the override audit row BEFORE the create succeeds —
 *      T-03-34) and "Tijden aanpassen" (clears the conflict so the user
 *      can edit Start/End).
 *
 * Phase 3 participant picker: the FilterCombobox below renders three
 * separate combos (player / trainer / sparring_partner) per UI-SPEC line
 * 324; the server interprets them per event type. Sparring kind returns
 * empty in Phase 3 (D-50 no-op) — the combo stays for layout consistency.
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Form-field contract
 *            (lines 308-325)
 *            .planning/phases/03-kalender/03-CONTEXT.md D-48 + D-57
 *            src/server/trpc/schemas/calendar.ts eventCreateInput
 */
'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { ConflictWarning } from '@/components/calendar/conflict-warning';
import { FilterCombobox } from '@/components/calendar/filter-combobox';
import { DateTimePicker } from '@/components/common/date-time-picker';
import { RruleEditor } from '@/components/common/rrule-editor';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { RedactedConflict } from '@/lib/calendar/conflicts';
import { trpc } from '@/lib/trpc-client';
import { EVENT_TYPE_CODES, type EventTypeCode } from '@/server/trpc/schemas/calendar';

interface FormShape {
  type: EventTypeCode;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string;
  description: string;
  recurring: boolean;
  rrule: string | undefined;
  playerIds: string[];
  trainerIds: string[];
  sparringPartnerIds: string[];
  // Per-type extension fields (each branch reads only its own subset).
  trainingTypeCode: string;
  organisationCode: string;
  trainerId: string;
  durationMinutes: number;
  city: string;
  country: string;
  ageCategoryCode: string;
  tournamentTypeCode: string;
  place: string;
  evaluatorUserId: string;
  playerUserId: string;
  isInjury: boolean;
  doctor: string;
}

function defaultStart(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(9);
  return d;
}

function defaultEnd(start: Date): Date {
  return new Date(start.getTime() + 60 * 60 * 1000);
}

function defaultFormValues(): FormShape {
  const startsAt = defaultStart();
  return {
    type: 'event_type_training',
    title: '',
    startsAt,
    endsAt: defaultEnd(startsAt),
    allDay: false,
    location: '',
    description: '',
    recurring: false,
    rrule: undefined,
    playerIds: [],
    trainerIds: [],
    sparringPartnerIds: [],
    trainingTypeCode: 'training_type_group',
    organisationCode: 'org_academy',
    trainerId: '',
    durationMinutes: 60,
    city: '',
    country: 'BE',
    ageCategoryCode: '',
    tournamentTypeCode: '',
    place: '',
    evaluatorUserId: '',
    playerUserId: '',
    isInjury: false,
    doctor: '',
  };
}

/**
 * Build the discriminated-union payload for `calendar.event.create` from
 * flat form state. Each branch reads only its own extension fields.
 *
 * Note: server Zod `.strict()` will reject extra keys, so we MUST omit
 * fields from non-matching branches — we don't spread the whole form.
 */
function buildCreatePayload(
  v: FormShape,
  force: boolean,
): Record<string, unknown> {
  const participants = [
    ...v.playerIds.map((userId) => ({
      userId,
      roleInEvent: 'participant' as const,
    })),
    ...v.trainerIds.map((userId) => ({
      userId,
      roleInEvent: 'participant' as const,
    })),
    ...v.sparringPartnerIds.map((userId) => ({
      userId,
      roleInEvent: 'participant' as const,
    })),
  ];

  const base = {
    title: v.title,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    allDay: v.allDay,
    location: v.location || undefined,
    description: v.description || undefined,
    rrule: v.recurring && v.rrule ? v.rrule : undefined,
    participants,
    force,
  };

  switch (v.type) {
    case 'event_type_training':
      return {
        type: v.type,
        ...base,
        trainingTypeCode: v.trainingTypeCode,
        organisationCode: v.organisationCode,
        trainerId: v.trainerId,
        durationMinutes: v.durationMinutes,
      };
    case 'event_type_tournament':
      return {
        type: v.type,
        ...base,
        city: v.city,
        country: v.country,
        ageCategoryCode: v.ageCategoryCode,
        tournamentTypeCode: v.tournamentTypeCode,
      };
    case 'event_type_meeting':
      return { type: v.type, ...base };
    case 'event_type_stage':
      return {
        type: v.type,
        ...base,
        place: v.place,
        country: v.country,
      };
    case 'event_type_eval_conversation':
      return {
        type: v.type,
        ...base,
        evaluatorUserId: v.evaluatorUserId,
        playerUserId: v.playerUserId,
      };
    case 'event_type_medical':
      return {
        type: v.type,
        ...base,
        isInjury: v.isInjury,
        doctor: v.doctor || undefined,
      };
    default:
      return { type: v.type, ...base };
  }
}

export function EventCreateSheet() {
  const t = useTranslations('calendar.event');
  const tFilters = useTranslations('calendar.filters');
  const tCommon = useTranslations('common');
  const tLookup = useTranslations('lookup.eventType');
  const tToast = useTranslations('calendar.event.toast');

  const [open, setOpen] = useState(false);
  const [conflicts, setConflicts] = useState<ReadonlyArray<RedactedConflict>>(
    [],
  );

  const form = useForm<FormShape>({
    defaultValues: defaultFormValues(),
  });

  const createMutation = trpc.calendar.event.create.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ start?: string; end?: string }>)
        .detail;
      const next = defaultFormValues();
      if (detail?.start) next.startsAt = new Date(detail.start);
      if (detail?.end) next.endsAt = new Date(detail.end);
      else next.endsAt = defaultEnd(next.startsAt);
      form.reset(next);
      setConflicts([]);
      setOpen(true);
    }
    document.addEventListener('calendar:open-create', handler);
    return () => document.removeEventListener('calendar:open-create', handler);
  }, [form]);

  const submit = useCallback(
    async (values: FormShape, force: boolean) => {
      try {
        const payload = buildCreatePayload(values, force);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await createMutation.mutateAsync(payload as any);
        toast.success(tToast('created'));
        await utils.calendar.list.invalidate();
        setOpen(false);
        setConflicts([]);
        form.reset(defaultFormValues());
      } catch (err: unknown) {
        const e = err as {
          data?: { code?: string };
          cause?: { conflicts?: RedactedConflict[] };
        };
        if (
          e.data?.code === 'CONFLICT' &&
          Array.isArray(e.cause?.conflicts) &&
          e.cause.conflicts.length > 0
        ) {
          setConflicts(e.cause.conflicts);
          return;
        }
        toast.error(tToast('error'));
      }
    },
    [createMutation, utils, form, tToast],
  );

  const onSubmit = form.handleSubmit((values) => submit(values, false));

  function onSaveAnyway() {
    void submit(form.getValues(), true);
  }

  function onAdjustTime() {
    // Clear the conflict; user edits Start/End and re-submits.
    setConflicts([]);
  }

  const type = form.watch('type');
  const recurring = form.watch('recurring');
  const startsAt = form.watch('startsAt');

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setConflicts([]);
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t('create.title')}</SheetTitle>
        </SheetHeader>
        <form onSubmit={onSubmit} className="space-y-4 px-4 pb-4">
          {/* Type — locked at create per UI-SPEC line 317 (changing type
              post-create is out of scope; user deletes + recreates) */}
          <div className="space-y-1">
            <Label>{t('fields.type')}</Label>
            <Select
              value={type}
              onValueChange={(v) => form.setValue('type', v as EventTypeCode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPE_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {tLookup(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Title */}
          <div className="space-y-1">
            <Label>
              {t('fields.title')}{' '}
              <span className="text-destructive">*</span>
            </Label>
            <Input {...form.register('title', { required: true })} />
          </div>

          {/* Start / End */}
          <div className="space-y-1">
            <Label>
              {t('fields.start')} <span className="text-destructive">*</span>
            </Label>
            <DateTimePicker
              value={form.watch('startsAt')}
              onChange={(d) => form.setValue('startsAt', d)}
              ariaLabel={t('fields.start')}
            />
          </div>
          <div className="space-y-1">
            <Label>
              {t('fields.end')} <span className="text-destructive">*</span>
            </Label>
            <DateTimePicker
              value={form.watch('endsAt')}
              onChange={(d) => form.setValue('endsAt', d)}
              ariaLabel={t('fields.end')}
            />
          </div>

          {/* All-day */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="ec-allday"
              checked={form.watch('allDay')}
              onCheckedChange={(v) => form.setValue('allDay', Boolean(v))}
            />
            <Label htmlFor="ec-allday">{t('fields.allDay')}</Label>
          </div>

          {/* Location */}
          <div className="space-y-1">
            <Label>{t('fields.location')}</Label>
            <Input {...form.register('location')} />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label>{t('fields.description')}</Label>
            <Textarea {...form.register('description')} />
          </div>

          {/* Participants (3 combos — server interprets per type) */}
          <div className="space-y-2">
            <Label>{t('fields.participants')}</Label>
            <div className="flex flex-wrap gap-2">
              <FilterCombobox
                kind="player"
                selectedIds={form.watch('playerIds')}
                onChange={(ids) => form.setValue('playerIds', ids)}
                label={tFilters('byPlayer')}
              />
              <FilterCombobox
                kind="trainer"
                selectedIds={form.watch('trainerIds')}
                onChange={(ids) => form.setValue('trainerIds', ids)}
                label={tFilters('byTrainer')}
              />
              <FilterCombobox
                kind="sparring_partner"
                selectedIds={form.watch('sparringPartnerIds')}
                onChange={(ids) => form.setValue('sparringPartnerIds', ids)}
                label={tFilters('bySparring')}
              />
            </div>
          </div>

          {/* Recurring + RruleEditor */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="ec-recurring"
              checked={recurring}
              onCheckedChange={(v) => form.setValue('recurring', Boolean(v))}
            />
            <Label htmlFor="ec-recurring">{t('fields.recurring')}</Label>
          </div>
          {recurring && (
            <RruleEditor
              value={form.watch('rrule')}
              onChange={(v) => form.setValue('rrule', v)}
              dtstart={startsAt}
            />
          )}

          {/* Per-type extension fields */}
          {type === 'event_type_training' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>trainingTypeCode</Label>
                <Input {...form.register('trainingTypeCode')} />
              </div>
              <div className="space-y-1">
                <Label>organisationCode</Label>
                <Input {...form.register('organisationCode')} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>trainerId (uuid)</Label>
                <Input {...form.register('trainerId')} />
              </div>
              <div className="space-y-1">
                <Label>durationMinutes</Label>
                <Input
                  type="number"
                  min={1}
                  {...form.register('durationMinutes', { valueAsNumber: true })}
                />
              </div>
            </div>
          )}
          {type === 'event_type_tournament' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>city</Label>
                <Input {...form.register('city')} />
              </div>
              <div className="space-y-1">
                <Label>country (ISO-2)</Label>
                <Input {...form.register('country')} maxLength={2} />
              </div>
              <div className="space-y-1">
                <Label>ageCategoryCode</Label>
                <Input {...form.register('ageCategoryCode')} />
              </div>
              <div className="space-y-1">
                <Label>tournamentTypeCode</Label>
                <Input {...form.register('tournamentTypeCode')} />
              </div>
            </div>
          )}
          {type === 'event_type_stage' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>place</Label>
                <Input {...form.register('place')} />
              </div>
              <div className="space-y-1">
                <Label>country (ISO-2)</Label>
                <Input {...form.register('country')} maxLength={2} />
              </div>
            </div>
          )}
          {type === 'event_type_eval_conversation' && (
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <Label>evaluatorUserId (uuid)</Label>
                <Input {...form.register('evaluatorUserId')} />
              </div>
              <div className="space-y-1">
                <Label>playerUserId (uuid)</Label>
                <Input {...form.register('playerUserId')} />
              </div>
            </div>
          )}
          {type === 'event_type_medical' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ec-isInjury"
                  checked={form.watch('isInjury')}
                  onCheckedChange={(v) =>
                    form.setValue('isInjury', Boolean(v))
                  }
                />
                <Label htmlFor="ec-isInjury">isInjury</Label>
              </div>
              <div className="space-y-1">
                <Label>doctor</Label>
                <Input {...form.register('doctor')} />
              </div>
            </div>
          )}

          {/* Conflict surface (D-57b body) */}
          {conflicts.length > 0 && (
            <ConflictWarning
              conflicts={conflicts}
              onSaveAnyway={onSaveAnyway}
              onAdjustTime={onAdjustTime}
              pending={createMutation.isPending}
            />
          )}

          <SheetFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createMutation.isPending}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {t('create.submit')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
