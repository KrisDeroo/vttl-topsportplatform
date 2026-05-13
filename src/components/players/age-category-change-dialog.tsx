'use client';

/**
 * <AgeCategoryChangeDialog> — TD-only age-category change (Plan 02-13 Task 2).
 *
 * Wraps shadcn `Dialog`. Mounted from `<PlayerListTable>` and `<PlayerHeader>`
 * action menus; calls `trpc.player.setAgeCategory` which runs a
 * SERIALIZABLE transaction (D-32, Pitfall 6) that closes the current
 * `age_category_history` row and inserts a new "current" row.
 *
 * Form fields (per `playerSetAgeCategoryInput` in 02-07):
 *   - ageCategoryCode — LookupSelect (category='ageCategory')
 *   - categoryYear    — Input type=number
 *   - effectiveFrom   — Calendar inside Popover (date-fns formatted)
 *
 * On confirm:
 *   1. mutateAsync the new category snapshot
 *   2. toast.success(t('toast.changed'))
 *   3. onOpenChange(false) — dialog closes
 *   4. router.refresh() — re-fetch the list / detail page with new data
 *
 * Audit + history bookkeeping happens server-side; the UI only confirms
 * the operation succeeded and refreshes the surrounding view.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 2
 *            .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Destructive confirmation copy
 *            .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-32
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { LookupSelect } from '@/components/lookup/lookup-select';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useZodErrorMessage } from '@/lib/forms/zod-i18n';
import { formatDate } from '@/lib/i18n-format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/routing';
import { trpc } from '@/lib/trpc-client';
import { playerSetAgeCategoryInput } from '@/server/trpc/schemas/player';

export interface AgeCategoryChangeDialogProps {
  playerId: string;
  currentCode: string;
  ageCategoryCodes: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FormValues = z.output<typeof playerSetAgeCategoryInput>;

export function AgeCategoryChangeDialog({
  playerId,
  currentCode,
  ageCategoryCodes,
  open,
  onOpenChange,
}: AgeCategoryChangeDialogProps) {
  const t = useTranslations('players.ageCategoryChange');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale() as Locale;
  const resolveError = useZodErrorMessage();

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(playerSetAgeCategoryInput) as any,
    defaultValues: {
      playerId,
      ageCategoryCode: currentCode,
      categoryYear: new Date().getUTCFullYear(),
      effectiveFrom: new Date(),
    },
  });

  const mutation = trpc.player.setAgeCategory.useMutation();

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      await mutation.mutateAsync(values);
      toast.success(t('toast.changed'));
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error(t('toast.error'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            id="age-category-change-form"
          >
            <FormField
              control={form.control}
              name="ageCategoryCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.ageCategoryCode')}</FormLabel>
                  <FormControl>
                    <LookupSelect
                      category="ageCategory"
                      codes={ageCategoryCodes}
                      value={field.value}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage>
                    {resolveError(
                      form.formState.errors.ageCategoryCode?.message,
                    )}
                  </FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="categoryYear"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.categoryYear')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1900}
                      max={2100}
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === '' ? undefined : Number(e.target.value),
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage>
                    {resolveError(
                      form.formState.errors.categoryYear?.message,
                    )}
                  </FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="effectiveFrom"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>{t('fields.effectiveFrom')}</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            'w-full justify-start text-left font-normal',
                            !field.value && 'text-muted-foreground',
                          )}
                        >
                          <CalendarIcon className="mr-2 size-4" />
                          {field.value
                            ? formatDate(new Date(field.value), locale)
                            : t('fields.effectiveFrom.placeholder')}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={
                          field.value ? new Date(field.value) : undefined
                        }
                        onSelect={(date) =>
                          field.onChange(date ?? undefined)
                        }
                        captionLayout="dropdown"
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage>
                    {resolveError(
                      form.formState.errors.effectiveFrom?.message,
                    )}
                  </FormMessage>
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            form="age-category-change-form"
            disabled={mutation.isPending}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
