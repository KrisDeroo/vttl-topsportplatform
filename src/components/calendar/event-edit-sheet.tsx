/**
 * <EventEditSheet> — RHF form Sheet for `calendar.event.update`.
 *
 * Listens for `calendar:open-edit` (dispatched by <EventDetailSheet>'s
 * "Afspraak bewerken" button) with `{ eventId: string }`.
 *
 * Shape mirrors <EventCreateSheet> with two differences:
 *   1. Pre-population: `trpc.calendar.event.get` populates the form on open,
 *      using both the base event row and the per-type extension row.
 *   2. Recurrence scope radio (UI3-D12): when the loaded event has an rrule,
 *      a "scope of this edit" radio appears with three options:
 *        - "Deze afspraak" (Phase 3 active)
 *        - "Deze en toekomstige" (DISABLED — "(Fase 4)" suffix)
 *        - "Alle afspraken in de reeks" (DISABLED — "(Fase 4)" suffix)
 *      Phase 3 sends a single hard-replace update — "Deze afspraak" is the
 *      only available scope. Phase 4 will introduce occurrence-level
 *      exception writes for the other two scopes.
 *
 * The submit path is the same as Create: server returns CONFLICT → render
 * <ConflictWarning> inline → "Toch opslaan" re-submits with `force: true`
 * → server writes the override audit row BEFORE the update succeeds (D-57).
 *
 * Reference: .planning/phases/03-kalender/03-UI-SPEC.md §Component Inventory
 *            (line 300 — EventEditSheet)
 *            .planning/phases/03-kalender/03-CONTEXT.md D-12 (UI3-D12)
 *            src/server/trpc/schemas/calendar.ts eventUpdateInput
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
import {
  EVENT_TYPE_CODES,
  type EventTypeCode,
} from '@/server/trpc/schemas/calendar';

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

function defaultFormValues(): FormShape {
  return {
    type: 'event_type_training',
    title: '',
    startsAt: new Date(),
    endsAt: new Date(),
    allDay: false,
    location: '',
    description: '',
    recurring: false,
    rrule: undefined,
    playerIds: [],
    trainerIds: [],
    sparringPartnerIds: [],
    trainingTypeCode: '',
    organisationCode: '',
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

function buildUpdatePayload(
  eventId: string,
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
    eventId,
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
        ...base,
        type: v.type,
        trainingTypeCode: v.trainingTypeCode,
        organisationCode: v.organisationCode,
        trainerId: v.trainerId,
        durationMinutes: v.durationMinutes,
      };
    case 'event_type_tournament':
      return {
        ...base,
        type: v.type,
        city: v.city,
        country: v.country,
        ageCategoryCode: v.ageCategoryCode,
        tournamentTypeCode: v.tournamentTypeCode,
      };
    case 'event_type_meeting':
      return { ...base, type: v.type };
    case 'event_type_stage':
      return {
        ...base,
        type: v.type,
        place: v.place,
        country: v.country,
      };
    case 'event_type_eval_conversation':
      return {
        ...base,
        type: v.type,
        evaluatorUserId: v.evaluatorUserId,
        playerUserId: v.playerUserId,
      };
    case 'event_type_medical':
      return {
        ...base,
        type: v.type,
        isInjury: v.isInjury,
        doctor: v.doctor || undefined,
      };
    default:
      return { ...base, type: v.type };
  }
}

export function EventEditSheet() {
  const t = useTranslations('calendar.event');
  const tRec = useTranslations('calendar.event.recurrence');
  const tFilters = useTranslations('calendar.filters');
  const tCommon = useTranslations('common');
  const tLookup = useTranslations('lookup.eventType');
  const tToast = useTranslations('calendar.event.toast');

  const [eventId, setEventId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ReadonlyArray<RedactedConflict>>(
    [],
  );
  const open = eventId !== null;

  const form = useForm<FormShape>({
    defaultValues: defaultFormValues(),
  });

  const updateMutation = trpc.calendar.event.update.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ eventId: string }>).detail;
      if (detail?.eventId) {
        setEventId(detail.eventId);
        setConflicts([]);
      }
    }
    document.addEventListener('calendar:open-edit', handler);
    return () => document.removeEventListener('calendar:open-edit', handler);
  }, []);

  // Pre-populate the form when the event loads.
  const { data: loaded } = trpc.calendar.event.get.useQuery(
    { eventId: eventId ?? '' },
    { enabled: Boolean(eventId), staleTime: 5_000 },
  );

  useEffect(() => {
    if (!loaded) return;
    const ev = loaded.event;
    const ext = (loaded.extension ?? {}) as Record<string, unknown>;
    const next: FormShape = {
      ...defaultFormValues(),
      type: ev.typeCode as EventTypeCode,
      title: ev.title,
      startsAt: new Date(ev.startsAt),
      endsAt: new Date(ev.endsAt),
      allDay: ev.allDay,
      location: ev.location ?? '',
      description: ev.description ?? '',
      recurring: Boolean(ev.rrule),
      rrule: ev.rrule ?? undefined,
      // Phase 3 splits participants into 3 buckets at submit time only —
      // we lump everyone into playerIds on load for the multi-select; the
      // server-side discriminated union doesn't distinguish bucket at the
      // participants array level.
      playerIds: (loaded.participants ?? []).map((p) => p.userId),
      trainerIds: [],
      sparringPartnerIds: [],
      // Per-type extension fields
      trainingTypeCode: String(ext.trainingTypeCode ?? ''),
      organisationCode: String(ext.organisationCode ?? ''),
      trainerId: String(ext.trainerId ?? ''),
      durationMinutes: Number(ext.durationMinutes ?? 60),
      city: String(ext.city ?? ''),
      country: String(ext.country ?? 'BE'),
      ageCategoryCode: String(ext.ageCategoryCode ?? ''),
      tournamentTypeCode: String(ext.tournamentTypeCode ?? ''),
      place: String(ext.place ?? ''),
      evaluatorUserId: String(ext.evaluatorUserId ?? ''),
      playerUserId: String(ext.playerUserId ?? ''),
      isInjury: Boolean(ext.isInjury ?? false),
      doctor: String(ext.doctor ?? ''),
    };
    form.reset(next);
  }, [loaded, form]);

  const submit = useCallback(
    async (values: FormShape, force: boolean) => {
      if (!eventId) return;
      try {
        const payload = buildUpdatePayload(eventId, values, force);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await updateMutation.mutateAsync(payload as any);
        toast.success(tToast('updated'));
        await utils.calendar.list.invalidate();
        setEventId(null);
        setConflicts([]);
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
    [updateMutation, utils, eventId, tToast],
  );

  const onSubmit = form.handleSubmit((values) => submit(values, false));

  function onSaveAnyway() {
    void submit(form.getValues(), true);
  }
  function onAdjustTime() {
    setConflicts([]);
  }

  const type = form.watch('type');
  const recurring = form.watch('recurring');
  const startsAt = form.watch('startsAt');
  const hasRrule = Boolean(loaded?.event?.rrule);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setEventId(null);
          setConflicts([]);
        }
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t('edit.title')}</SheetTitle>
        </SheetHeader>
        <form onSubmit={onSubmit} className="space-y-4 px-4 pb-4">
          {/* Type — locked for v1 */}
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
              id="ee-allday"
              checked={form.watch('allDay')}
              onCheckedChange={(v) => form.setValue('allDay', Boolean(v))}
            />
            <Label htmlFor="ee-allday">{t('fields.allDay')}</Label>
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

          {/* Participants (single combo bucket for edit — server doesn't
              differentiate; Phase 4 will split per requirement) */}
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
              id="ee-recurring"
              checked={recurring}
              onCheckedChange={(v) => form.setValue('recurring', Boolean(v))}
            />
            <Label htmlFor="ee-recurring">{t('fields.recurring')}</Label>
          </div>
          {recurring && (
            <RruleEditor
              value={form.watch('rrule')}
              onChange={(v) => form.setValue('rrule', v)}
              dtstart={startsAt}
            />
          )}

          {/* UI3-D12 scope radio — only visible when editing an existing
              recurring event. Phase 3 ships only "Deze afspraak"; the other
              two are disabled with "(Fase 4)" suffix from i18n. */}
          {hasRrule && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <Label>{t('sections.recurrence')}</Label>
              <RadioGroup defaultValue="this">
                <label className="flex items-center gap-2">
                  <RadioGroupItem value="this" id="ee-scope-this" />
                  <span>{tRec('scopeThis')}</span>
                </label>
                <label className="flex items-center gap-2 opacity-60">
                  <RadioGroupItem
                    value="future"
                    id="ee-scope-future"
                    disabled
                  />
                  <span>{tRec('scopeFuture')}</span>
                </label>
                <label className="flex items-center gap-2 opacity-60">
                  <RadioGroupItem value="all" id="ee-scope-all" disabled />
                  <span>{tRec('scopeAll')}</span>
                </label>
              </RadioGroup>
            </div>
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
                  id="ee-isInjury"
                  checked={form.watch('isInjury')}
                  onCheckedChange={(v) =>
                    form.setValue('isInjury', Boolean(v))
                  }
                />
                <Label htmlFor="ee-isInjury">isInjury</Label>
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
              pending={updateMutation.isPending}
            />
          )}

          <SheetFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEventId(null)}
              disabled={updateMutation.isPending}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={updateMutation.isPending}>
              {t('edit.submit')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
