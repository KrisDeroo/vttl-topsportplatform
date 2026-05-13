'use client';

/**
 * <TrainerEditForm> — mode-aware trainer edit (Plan 02-13 Task 3).
 *
 * Three visual modes (UI-SPEC §RBAC-Sensitive UI Behavior — trainer rows):
 *   - 'td'        — full edit via `trainer.updateAsTd`
 *   - 'self'      — D-38 whitelist via `trainer.updateSelf`; identity +
 *                   qualifications rendered as styled non-interactive divs
 *   - 'readOnly'  — every field as non-interactive div, NO submit button,
 *                   header pill `trainers.detail.readOnly`
 *
 * The D-38 schema (`trainerSelfUpdateInput`) deliberately omits
 * `diplomaCode` and `hasPedagogicalQualification` — the form structurally
 * cannot submit them through the self-update path. The server's
 * `.strict()` Zod schema would reject them anyway; this UI mirrors the
 * server contract so the field never appears editable to the trainer.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 3
 *            .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-38
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { LookupSelect } from '@/components/lookup/lookup-select';
import { PhotoUpload } from '@/components/file/photo-upload';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useZodErrorMessage } from '@/lib/forms/zod-i18n';
import { formatDate } from '@/lib/i18n-format';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc-client';
import {
  trainerSelfUpdateInput,
  trainerUpdateAsTdInput,
} from '@/server/trpc/schemas/trainer';

export type TrainerEditMode = 'td' | 'self' | 'readOnly';

export interface TrainerForEdit {
  userId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  street: string;
  streetNumber: string | null;
  postalCode: string;
  city: string;
  province: string;
  country: string;
  phone: string | null;
  email: string | null;
  diplomaCode: string;
  hasPedagogicalQualification: boolean;
  profilePhotoFileId: string | null;
}

export interface TrainerEditFormProps {
  trainer: TrainerForEdit;
  mode: TrainerEditMode;
  diplomaCodes: readonly string[];
  locale: 'nl' | 'en' | 'fr';
  initialPhotoUrl?: string | null;
}

function ReadOnlyValue({ value }: { value: string }) {
  return (
    <div
      className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
      aria-disabled="true"
    >
      {value || '—'}
    </div>
  );
}

function FormLabelStatic({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-sm font-medium">{children}</div>;
}

type TdFormValues = z.output<typeof trainerUpdateAsTdInput>;
type SelfFormValues = z.output<typeof trainerSelfUpdateInput>;

export function TrainerEditForm({
  trainer,
  mode,
  diplomaCodes,
  locale,
  initialPhotoUrl,
}: TrainerEditFormProps) {
  const t = useTranslations('trainers');
  const tDiploma = useTranslations('lookups.trainerDiploma');
  const router = useRouter();
  const resolveError = useZodErrorMessage();

  const isReadOnly = mode === 'readOnly';
  const isSelf = mode === 'self';
  const isTd = mode === 'td';

  const tdForm = useForm<TdFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(trainerUpdateAsTdInput) as any,
    defaultValues: {
      trainerId: trainer.userId,
      firstName: trainer.firstName,
      lastName: trainer.lastName,
      dateOfBirth: new Date(trainer.dateOfBirth),
      gender: trainer.gender as 'male' | 'female' | 'x',
      street: trainer.street,
      streetNumber: trainer.streetNumber ?? undefined,
      postalCode: trainer.postalCode,
      city: trainer.city,
      province: trainer.province,
      country: trainer.country,
      phone: trainer.phone ?? undefined,
      email: trainer.email ?? undefined,
      diplomaCode: trainer.diplomaCode,
      hasPedagogicalQualification: trainer.hasPedagogicalQualification,
      profilePhotoFileId: trainer.profilePhotoFileId ?? undefined,
    },
  });

  const selfForm = useForm<SelfFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(trainerSelfUpdateInput) as any,
    defaultValues: {
      street: trainer.street,
      streetNumber: trainer.streetNumber ?? undefined,
      postalCode: trainer.postalCode,
      city: trainer.city,
      province: trainer.province,
      country: trainer.country,
      phone: trainer.phone ?? undefined,
      email: trainer.email ?? undefined,
      profilePhotoFileId: trainer.profilePhotoFileId ?? undefined,
    },
  });

  const updateAsTd = trpc.trainer.updateAsTd.useMutation();
  const updateSelf = trpc.trainer.updateSelf.useMutation();

  const [photoFileId, setPhotoFileId] = useState<string | null>(
    trainer.profilePhotoFileId ?? null,
  );

  useEffect(() => {
    if (isTd) {
      tdForm.setValue('profilePhotoFileId', photoFileId ?? undefined);
    } else if (isSelf) {
      selfForm.setValue('profilePhotoFileId', photoFileId ?? undefined);
    }
  }, [photoFileId, isTd, isSelf, tdForm, selfForm]);

  async function onSubmitTd(values: TdFormValues): Promise<void> {
    try {
      await updateAsTd.mutateAsync(values);
      toast.success(t('edit.toast.saved'));
      router.refresh();
    } catch {
      toast.error(t('edit.toast.error'));
    }
  }

  async function onSubmitSelf(values: SelfFormValues): Promise<void> {
    try {
      await updateSelf.mutateAsync(values);
      toast.success(t('edit.toast.saved'));
      router.refresh();
    } catch {
      toast.error(t('edit.toast.error'));
    }
  }

  const initials = useMemo(
    () =>
      `${trainer.firstName.charAt(0) || '?'}${trainer.lastName.charAt(0) || '?'}`.toUpperCase(),
    [trainer.firstName, trainer.lastName],
  );

  // ─── Read-only branch ───────────────────────────────────────────────
  if (isReadOnly) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.identity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <FormLabelStatic>{t('fields.firstName')}</FormLabelStatic>
              <ReadOnlyValue value={trainer.firstName} />
            </div>
            <div>
              <FormLabelStatic>{t('fields.lastName')}</FormLabelStatic>
              <ReadOnlyValue value={trainer.lastName} />
            </div>
            <div>
              <FormLabelStatic>{t('fields.dateOfBirth')}</FormLabelStatic>
              <ReadOnlyValue
                value={formatDate(new Date(trainer.dateOfBirth), locale)}
              />
            </div>
            <div>
              <FormLabelStatic>{t('fields.gender.label')}</FormLabelStatic>
              <ReadOnlyValue
                value={t(`fields.gender.${trainer.gender as 'male' | 'female' | 'x'}`)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.qualifications')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <FormLabelStatic>{t('fields.diplomaCode')}</FormLabelStatic>
              <ReadOnlyValue value={tDiploma(trainer.diplomaCode)} />
            </div>
            <div>
              <FormLabelStatic>
                {t('fields.hasPedagogicalQualification')}
              </FormLabelStatic>
              <ReadOnlyValue
                value={
                  trainer.hasPedagogicalQualification
                    ? t('fields.hasPedagogicalQualification.yes')
                    : t('fields.hasPedagogicalQualification.no')
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.address')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <FormLabelStatic>{t('fields.street')}</FormLabelStatic>
              <ReadOnlyValue
                value={`${trainer.street}${trainer.streetNumber ? ' ' + trainer.streetNumber : ''}`}
              />
            </div>
            <div>
              <FormLabelStatic>{t('fields.postalCode')}</FormLabelStatic>
              <ReadOnlyValue value={`${trainer.postalCode} ${trainer.city}`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.photo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoUpload
              initialFileId={trainer.profilePhotoFileId ?? null}
              initialUrl={initialPhotoUrl ?? null}
              initials={initials}
              onUploaded={() => {
                /* readOnly mode */
              }}
              disabled
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── TD branch ──────────────────────────────────────────────────────
  if (isTd) {
    return (
      <Form {...tdForm}>
        <form
          onSubmit={tdForm.handleSubmit(onSubmitTd)}
          className="space-y-6"
        >
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.identity')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={tdForm.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('fields.firstName')}{' '}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage>
                      {resolveError(tdForm.formState.errors.firstName?.message)}
                    </FormMessage>
                  </FormItem>
                )}
              />
              <FormField
                control={tdForm.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('fields.lastName')}{' '}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage>
                      {resolveError(tdForm.formState.errors.lastName?.message)}
                    </FormMessage>
                  </FormItem>
                )}
              />
              <FormField
                control={tdForm.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>
                      {t('fields.dateOfBirth')}{' '}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            type="button"
                            variant="outline"
                            className={cn(
                              'w-[240px] justify-start text-left font-normal',
                              !field.value && 'text-muted-foreground',
                            )}
                          >
                            <CalendarIcon className="mr-2 size-4" />
                            {field.value
                              ? formatDate(new Date(field.value), locale)
                              : t('fields.dateOfBirth.placeholder')}
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
                          disabled={(date) => date > new Date()}
                          captionLayout="dropdown"
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage>
                      {resolveError(tdForm.formState.errors.dateOfBirth?.message)}
                    </FormMessage>
                  </FormItem>
                )}
              />
              <FormField
                control={tdForm.control}
                name="gender"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel>
                      {t('fields.gender.label')}{' '}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="flex gap-4"
                      >
                        <label className="flex items-center gap-2">
                          <RadioGroupItem value="male" />
                          <span>{t('fields.gender.male')}</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <RadioGroupItem value="female" />
                          <span>{t('fields.gender.female')}</span>
                        </label>
                        <label className="flex items-center gap-2">
                          <RadioGroupItem value="x" />
                          <span>{t('fields.gender.x')}</span>
                        </label>
                      </RadioGroup>
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('sections.qualifications')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={tdForm.control}
                name="diplomaCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('fields.diplomaCode')}{' '}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <LookupSelect
                        category="trainerDiploma"
                        codes={diplomaCodes}
                        value={field.value}
                        onValueChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage>
                      {resolveError(tdForm.formState.errors.diplomaCode?.message)}
                    </FormMessage>
                  </FormItem>
                )}
              />
              <FormField
                control={tdForm.control}
                name="hasPedagogicalQualification"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                      />
                    </FormControl>
                    <div className="leading-none">
                      <FormLabel>
                        {t('fields.hasPedagogicalQualification')}
                      </FormLabel>
                      <FormDescription>
                        {t('fields.hasPedagogicalQualification.description')}
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <AddressCard form={tdForm} resolveError={resolveError} t={t} />

          <Card>
            <CardHeader>
              <CardTitle>{t('sections.photo')}</CardTitle>
            </CardHeader>
            <CardContent>
              <PhotoUpload
                initialFileId={trainer.profilePhotoFileId ?? null}
                initialUrl={initialPhotoUrl ?? null}
                initials={initials}
                onUploaded={(fileId) => setPhotoFileId(fileId)}
                onDeleted={() => setPhotoFileId(null)}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={updateAsTd.isPending}>
              {t('edit.submit')}
            </Button>
          </div>
        </form>
      </Form>
    );
  }

  // ─── self branch ────────────────────────────────────────────────────
  return (
    <Form {...selfForm}>
      <form
        onSubmit={selfForm.handleSubmit(onSubmitSelf)}
        className="space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.identity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <FormLabelStatic>{t('fields.firstName')}</FormLabelStatic>
              <ReadOnlyValue value={trainer.firstName} />
            </div>
            <div>
              <FormLabelStatic>{t('fields.lastName')}</FormLabelStatic>
              <ReadOnlyValue value={trainer.lastName} />
            </div>
            <div>
              <FormLabelStatic>{t('fields.dateOfBirth')}</FormLabelStatic>
              <ReadOnlyValue
                value={formatDate(new Date(trainer.dateOfBirth), locale)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.qualifications')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <FormLabelStatic>{t('fields.diplomaCode')}</FormLabelStatic>
              <ReadOnlyValue value={tDiploma(trainer.diplomaCode)} />
            </div>
            <div>
              <FormLabelStatic>
                {t('fields.hasPedagogicalQualification')}
              </FormLabelStatic>
              <ReadOnlyValue
                value={
                  trainer.hasPedagogicalQualification
                    ? t('fields.hasPedagogicalQualification.yes')
                    : t('fields.hasPedagogicalQualification.no')
                }
              />
            </div>
          </CardContent>
        </Card>

        <AddressCard form={selfForm} resolveError={resolveError} t={t} />

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.photo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoUpload
              initialFileId={trainer.profilePhotoFileId ?? null}
              initialUrl={initialPhotoUrl ?? null}
              initials={initials}
              onUploaded={(fileId) => setPhotoFileId(fileId)}
              onDeleted={() => setPhotoFileId(null)}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={updateSelf.isPending}>
            {t('edit.submit')}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function AddressCard({
  form,
  resolveError,
  t,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  resolveError: (k: string | undefined) => string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sections.address')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_1fr]">
          <FormField
            control={form.control}
            name="street"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            render={({ field }: any) => (
              <FormItem>
                <FormLabel>
                  {t('fields.street')}{' '}
                  <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage>
                  {resolveError(form.formState.errors.street?.message)}
                </FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="streetNumber"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            render={({ field }: any) => (
              <FormItem>
                <FormLabel>{t('fields.streetNumber')}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_2fr]">
          <FormField
            control={form.control}
            name="postalCode"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            render={({ field }: any) => (
              <FormItem>
                <FormLabel>
                  {t('fields.postalCode')}{' '}
                  <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    inputMode="numeric"
                  />
                </FormControl>
                <FormMessage>
                  {resolveError(form.formState.errors.postalCode?.message)}
                </FormMessage>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="city"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            render={({ field }: any) => (
              <FormItem>
                <FormLabel>
                  {t('fields.city')}{' '}
                  <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage>
                  {resolveError(form.formState.errors.city?.message)}
                </FormMessage>
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="province"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>
                {t('fields.province')}{' '}
                <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage>
                {resolveError(form.formState.errors.province?.message)}
              </FormMessage>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>{t('fields.phone')}</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} type="tel" />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          render={({ field }: any) => (
            <FormItem>
              <FormLabel>{t('fields.contactEmail')}</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} type="email" />
              </FormControl>
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}
