'use client';

/**
 * <TrainerCreateForm> — TD-only trainer creation (Plan 02-13 Task 3).
 *
 * Mirrors <PlayerCreateForm> with trainer-specific fields. Differences
 * from the player form (UI-SPEC + 02-07 schema):
 *   - No emergency-contact section (TRAINER-01 omits it; trainers are
 *     always adults)
 *   - No statusCode / academyCode / ageCategory dropdowns; trainers carry
 *     `diplomaCode` (LookupSelect, category='trainerDiploma') and
 *     `hasPedagogicalQualification` (shadcn Checkbox)
 *
 * Submit flow (same chain as PlayerCreateForm):
 *   1. admin.user.create → returns users row with id
 *   2. trainer.create with userId = step1.id → INSERTs trainers row
 *   3. router.push(/{locale}/trainers/{userId}) + success toast
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 3
 *            .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-38
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { trainerCreateInput } from '@/server/trpc/schemas/trainer';

const formSchema = z
  .object({
    email: z.string().email({ message: 'errors.field.email' }),
    name: z.string().min(2, { message: 'errors.field.required' }),
    firstName: z.string().min(1, { message: 'errors.field.required' }),
    lastName: z.string().min(1, { message: 'errors.field.required' }),
    dateOfBirth: z.coerce
      .date()
      .max(new Date(), { message: 'errors.field.dateInPast' }),
    gender: z.enum(['male', 'female', 'x']),
    street: z.string().min(1, { message: 'errors.field.required' }),
    streetNumber: z.string().optional(),
    postalCode: z.string().regex(/^[0-9]{4}$/, {
      message: 'errors.field.belgianPostalCode',
    }),
    city: z.string().min(1, { message: 'errors.field.required' }),
    province: z.string().min(1, { message: 'errors.field.required' }),
    country: z.string().length(2, { message: 'errors.field.country' }).default('BE'),
    phone: z.string().optional(),
    contactEmail: z
      .string()
      .email({ message: 'errors.field.email' })
      .optional()
      .or(z.literal('')),
    diplomaCode: z.string().min(1, { message: 'errors.field.required' }),
    hasPedagogicalQualification: z.boolean().default(false),
    profilePhotoFileId: z.string().uuid().optional(),
    preferredLocale: z.enum(['nl', 'en', 'fr']).default('nl'),
  })
  .strict();

type FormValues = z.output<typeof formSchema>;

export interface TrainerCreateFormProps {
  diplomaCodes: readonly string[];
  locale: 'nl' | 'en' | 'fr';
}

export function TrainerCreateForm({
  diplomaCodes,
  locale,
}: TrainerCreateFormProps) {
  const t = useTranslations('trainers');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const resolveError = useZodErrorMessage();
  void trainerCreateInput; // contract anchor — see player-create-form.tsx

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultValues: {
      email: '',
      name: '',
      firstName: '',
      lastName: '',
      gender: 'male',
      street: '',
      streetNumber: '',
      postalCode: '',
      city: '',
      province: '',
      country: 'BE',
      phone: '',
      contactEmail: '',
      diplomaCode: '',
      hasPedagogicalQualification: false,
      preferredLocale: 'nl',
    } as any,
  });

  const [profilePhotoFileId, setProfilePhotoFileId] = useState<string | null>(
    null,
  );

  const createUser = trpc.admin.user.create.useMutation();
  const createTrainer = trpc.trainer.create.useMutation();

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      const user = await createUser.mutateAsync({
        email: values.email,
        name: values.name,
        role: 'trainer',
        preferredLocale: values.preferredLocale,
        dateOfBirth: values.dateOfBirth.toISOString().slice(0, 10),
      });

      await createTrainer.mutateAsync({
        userId: user.id,
        firstName: values.firstName,
        lastName: values.lastName,
        dateOfBirth: values.dateOfBirth,
        gender: values.gender,
        street: values.street,
        streetNumber: values.streetNumber || undefined,
        postalCode: values.postalCode,
        city: values.city,
        province: values.province,
        country: values.country,
        phone: values.phone || undefined,
        email: values.contactEmail || undefined,
        diplomaCode: values.diplomaCode,
        hasPedagogicalQualification: values.hasPedagogicalQualification,
      });

      toast.success(t('edit.toast.saved'));
      router.push(`/${locale}/trainers/${user.id}`);
    } catch {
      toast.error(t('edit.toast.error'));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.identity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
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
                    {resolveError(form.formState.errors.firstName?.message)}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
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
                    {resolveError(form.formState.errors.lastName?.message)}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('fields.email')}{' '}
                    <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="email" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage>
                    {resolveError(form.formState.errors.email?.message)}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('fields.displayName')}{' '}
                    <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage>
                    {resolveError(form.formState.errors.name?.message)}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
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
                        onSelect={(date) => field.onChange(date ?? undefined)}
                        disabled={(date) => date > new Date()}
                        captionLayout="dropdown"
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage>
                    {resolveError(form.formState.errors.dateOfBirth?.message)}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
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

        {/* Qualifications */}
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.qualifications')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
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
                      placeholder={t('fields.diplomaCode.placeholder')}
                    />
                  </FormControl>
                  <FormMessage>
                    {resolveError(form.formState.errors.diplomaCode?.message)}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
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
                    <FormLabel>{t('fields.hasPedagogicalQualification')}</FormLabel>
                    <FormDescription>
                      {t('fields.hasPedagogicalQualification.description')}
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.address')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_1fr]">
              <FormField
                control={form.control}
                name="street"
                render={({ field }) => (
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
                render={({ field }) => (
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
                render={({ field }) => (
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
                render={({ field }) => (
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
              render={({ field }) => (
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
              render={({ field }) => (
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
              name="contactEmail"
              render={({ field }) => (
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

        {/* Photo */}
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.photo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoUpload
              initialFileId={null}
              initialUrl={null}
              initials={
                (form.watch('firstName')?.charAt(0) ?? '?').toUpperCase() +
                (form.watch('lastName')?.charAt(0) ?? '?').toUpperCase()
              }
              onUploaded={(fileId) => {
                setProfilePhotoFileId(fileId);
                form.setValue('profilePhotoFileId', fileId);
              }}
              onDeleted={() => {
                setProfilePhotoFileId(null);
                form.setValue('profilePhotoFileId', undefined);
              }}
            />
            {profilePhotoFileId ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('photo.attached')}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => form.reset()}
            disabled={createUser.isPending || createTrainer.isPending}
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            disabled={createUser.isPending || createTrainer.isPending}
          >
            {t('create.submit')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
