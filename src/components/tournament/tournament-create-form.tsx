'use client';

/**
 * <TournamentCreateForm> — TD-only tournament create/edit (TOURN-01/02).
 *
 * Submits via `trpc.tournament.create.useMutation()` which atomically
 * inserts the underlying calendar_events (typeCode='event_type_tournament')
 * + tournaments extension row. TD-only at the API layer (`tdProcedure`);
 * this form is not rendered for non-TD callers (callers gate the render).
 *
 * Reference: 04-UI-SPEC.md §Component Inventory (TournamentCreateForm row),
 *            04-CONTEXT.md D-79.
 */
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/trpc-client';

interface FormShape {
  naam: string;
  startsAt: string;
  endsAt: string;
  city: string;
  country: string;
  ageCategoryCode: string;
  tournamentTypeCode: string;
  description: string;
}

export interface TournamentCreateFormProps {
  ageCategoryCodes: readonly string[];
  tournamentTypeCodes: readonly string[];
  locale: string;
}

export function TournamentCreateForm({
  ageCategoryCodes,
  tournamentTypeCodes,
  locale,
}: TournamentCreateFormProps) {
  const t = useTranslations('tournament.create');
  const tCommon = useTranslations('common');
  const tLookupType = useTranslations('lookup.tournamentType');
  const tLookupAge = useTranslations('lookups.ageCategory');
  const router = useRouter();
  const utils = trpc.useUtils();

  const form = useForm<FormShape>({
    defaultValues: {
      naam: '',
      startsAt: '',
      endsAt: '',
      city: '',
      country: 'BE',
      ageCategoryCode: ageCategoryCodes[0] ?? '',
      tournamentTypeCode: tournamentTypeCodes[0] ?? '',
      description: '',
    },
  });

  const mutation = trpc.tournament.create.useMutation({
    onSuccess: (res) => {
      toast.success(t('successToast'));
      void utils.tournament.list.invalidate();
      if (res?.eventId) {
        router.push(`/${locale}/tournaments/${res.eventId}`);
      } else {
        router.push(`/${locale}/tournaments`);
      }
    },
    onError: () => {
      toast.error(t('errorToast'));
    },
  });

  function onSubmit(data: FormShape) {
    if (!data.startsAt || !data.endsAt) return;
    mutation.mutate({
      naam: data.naam,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      city: data.city,
      country: data.country.toUpperCase(),
      ageCategoryCode: data.ageCategoryCode,
      tournamentTypeCode: data.tournamentTypeCode,
      description: data.description.trim() === '' ? null : data.description,
    });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="t-naam">{t('name')}*</Label>
            <Input id="t-naam" {...form.register('naam', { required: true })} maxLength={200} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="t-starts">{t('startsAt')}*</Label>
              <Input id="t-starts" type="datetime-local" {...form.register('startsAt', { required: true })} />
            </div>
            <div>
              <Label htmlFor="t-ends">{t('endsAt')}*</Label>
              <Input id="t-ends" type="datetime-local" {...form.register('endsAt', { required: true })} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="t-city">{t('city')}*</Label>
              <Input id="t-city" {...form.register('city', { required: true })} maxLength={120} />
            </div>
            <div>
              <Label htmlFor="t-country">{t('country')}*</Label>
              <Input id="t-country" {...form.register('country', { required: true })} maxLength={2} className="uppercase" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label>{t('ageCategory')}*</Label>
              <Select
                value={form.watch('ageCategoryCode')}
                onValueChange={(v) => form.setValue('ageCategoryCode', v, { shouldDirty: true })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ageCategoryCodes.map((code) => (
                    <SelectItem key={code} value={code}>
                      {tLookupAge(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('tournamentType')}*</Label>
              <Select
                value={form.watch('tournamentTypeCode')}
                onValueChange={(v) => form.setValue('tournamentTypeCode', v, { shouldDirty: true })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tournamentTypeCodes.map((code) => (
                    <SelectItem key={code} value={code}>
                      {tLookupType(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="t-desc">{t('description')}</Label>
            <Textarea id="t-desc" {...form.register('description')} rows={3} maxLength={2000} />
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {tCommon('loading')}
            </>
          ) : (
            t('submit')
          )}
        </Button>
      </div>
    </form>
  );
}
