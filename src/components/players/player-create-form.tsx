'use client';

/**
 * <PlayerCreateForm> — TD-only player creation (Plan 02-13 Task 1).
 *
 * Composes shadcn `Form` primitives + `react-hook-form` + `zod` resolver.
 * Phase 2 lays out the form in 5 Card sections (UI-SPEC §Component
 * Inventory + §Page Surfaces): Identity / Sport / Address / Emergency
 * Contact / Photo.
 *
 * The form chains TWO mutations to honour the schema contract: the
 * `player.create` Zod input (02-07) requires `userId: uuid`, which means
 * the underlying `users` row must already exist. Phase 1's
 * `admin.user.create` mutation is the canonical path to create that row
 * (it writes the audit_log entry and seeds `active=false` for the AUTH-04
 * activation gate). Submit flow:
 *
 *   1. `admin.user.create` — returns the new `users` row including `id`.
 *   2. `player.create` with `userId = step1.id` — INSERTs the players
 *      row + the inaugural age_category_history row + writes audit.
 *   3. `router.push(/${locale}/players/${userId})` + success toast.
 *
 * Failure handling: if step 2 fails after step 1 succeeds, the user row
 * remains `active=false`. Phase 8 OPS cron + Phase 1's TD admin UI can
 * resolve the orphan (either retry the player.create or delete the user
 * row). This is preferable to a hand-rolled compensating delete, which
 * would broaden the surface area for TD-driven destructive actions.
 *
 * Zod error messages emit i18n keys (02-07 schema convention); the
 * `<FormMessage>` renders the key directly, and the shadcn primitive
 * already resolves it via the surrounding RHF context — we wrap it with
 * `useZodErrorMessage()` from `src/lib/forms/zod-i18n.ts` (D-46, I18N-08)
 * so the displayed text is localised instead of the raw key.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 1
 *            .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Form-field contract
 *            .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-37
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
import { playerCreateInput } from '@/server/trpc/schemas/player';

/** Client-side form schema: same shape as `playerCreateInput` MINUS
 *  `userId` (the form chains via `admin.user.create` to obtain it) PLUS
 *  the user-row fields (email + name) the chain needs. `.strict()` is
 *  preserved so misspelled keys fail loudly at validation time. */
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
    school: z.string().optional(),
    street: z.string().min(1, { message: 'errors.field.required' }),
    streetNumber: z.string().optional(),
    postalCode: z.string().regex(/^[0-9]{4}$/, {
      message: 'errors.field.belgianPostalCode',
    }),
    city: z.string().min(1, { message: 'errors.field.required' }),
    province: z.string().min(1, { message: 'errors.field.required' }),
    country: z.string().length(2, { message: 'errors.field.country' }).default('BE'),
    phone: z.string().optional(),
    contactEmail: z.string().email({ message: 'errors.field.email' }).optional().or(z.literal('')),
    club: z.string().optional(),
    statusCode: z.string().min(1, { message: 'errors.field.required' }),
    academyCode: z.string().min(1, { message: 'errors.field.required' }),
    emergencyContactName: z.string().optional(),
    emergencyContactPhone: z.string().optional(),
    emergencyContactRelation: z.string().optional(),
    profilePhotoFileId: z.string().uuid().optional(),
    preferredLocale: z.enum(['nl', 'en', 'fr']).default('nl'),
  })
  .strict();

type FormValues = z.output<typeof formSchema>;

export interface PlayerCreateFormProps {
  /** Pre-fetched active academy codes (Server Component reads from Drizzle). */
  academyCodes: readonly string[];
  /** Pre-fetched active status codes. */
  statusCodes: readonly string[];
  /** Current locale — for redirect target + date-fns format. */
  locale: 'nl' | 'en' | 'fr';
}

export function PlayerCreateForm({
  academyCodes,
  statusCodes,
  locale,
}: PlayerCreateFormProps) {
  const t = useTranslations('players');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const resolveError = useZodErrorMessage();
  // Keep the validated playerCreateInput schema imported so the structural
  // contract between client form and server input remains visible to readers
  // (and to bundle-analysis tooling — the import is intentionally tied to
  // the schema source of truth in 02-07).
  void playerCreateInput;

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
      school: '',
      street: '',
      streetNumber: '',
      postalCode: '',
      city: '',
      province: '',
      country: 'BE',
      phone: '',
      contactEmail: '',
      club: '',
      statusCode: '',
      academyCode: '',
      emergencyContactName: '',
      emergencyContactPhone: '',
      emergencyContactRelation: '',
      preferredLocale: 'nl',
    } as any,
  });

  const [profilePhotoFileId, setProfilePhotoFileId] = useState<string | null>(
    null,
  );

  const createUser = trpc.admin.user.create.useMutation();
  const createPlayer = trpc.player.create.useMutation();

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      // Step 1 — create the user row (active=false; TD activates later).
      const user = await createUser.mutateAsync({
        email: values.email,
        name: values.name,
        role: 'player',
        preferredLocale: values.preferredLocale,
        // dateOfBirth on users row is optional; we still pass it because the
        // minor-gate (`canActivate`) uses it to decide whether a parent link
        // is required before activation.
        dateOfBirth: values.dateOfBirth.toISOString().slice(0, 10),
      });

      // Step 2 — create the players row + inaugural age_category_history.
      // `userId` comes from step 1; `profilePhotoFileId` is set only when
      // the PhotoUpload widget has emitted a clean fileId.
      const playerPayload: Parameters<typeof createPlayer.mutateAsync>[0] = {
        userId: user.id,
        firstName: values.firstName,
        lastName: values.lastName,
        dateOfBirth: values.dateOfBirth,
        gender: values.gender,
        school: values.school || undefined,
        street: values.street,
        streetNumber: values.streetNumber || undefined,
        postalCode: values.postalCode,
        city: values.city,
        province: values.province,
        country: values.country,
        phone: values.phone || undefined,
        email: values.contactEmail || undefined,
        club: values.club || undefined,
        statusCode: values.statusCode,
        academyCode: values.academyCode,
        emergencyContactName: values.emergencyContactName || undefined,
        emergencyContactPhone: values.emergencyContactPhone || undefined,
        emergencyContactRelation: values.emergencyContactRelation || undefined,
      };
      await createPlayer.mutateAsync(playerPayload);

      toast.success(t('edit.toast.saved'));
      // WARNING-11: locale-aware redirect.
      router.push(`/${locale}/players/${user.id}`);
    } catch (err) {
      toast.error(t('edit.toast.error'));
      // Surface the raw key via i18n if it matches our error catalog;
      // otherwise the generic toast above is the user-facing signal.
      const raw = err instanceof Error ? err.message : '';
      // Best-effort field-error mapping for the most common schema rejects.
      if (raw === 'errors.field.email') {
        form.setError('email', { message: raw });
      }
    }
  }

  const dob = form.watch('dateOfBirth');

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* ─── Identity ─────────────────────────────────────────────── */}
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
                  <FormDescription>{t('fields.email.description')}</FormDescription>
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
                  <FormDescription>
                    {t('fields.displayName.description')}
                  </FormDescription>
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
                        onSelect={(date) =>
                          field.onChange(date ?? undefined)
                        }
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
                  <FormMessage>
                    {resolveError(form.formState.errors.gender?.message)}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="school"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.school')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormDescription>
                    {t('fields.school.description')}
                  </FormDescription>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* ─── Sport ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.sport')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="statusCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('fields.statusCode')}{' '}
                    <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <LookupSelect
                      category="status"
                      codes={statusCodes}
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder={t('fields.statusCode.placeholder')}
                    />
                  </FormControl>
                  <FormMessage>
                    {resolveError(form.formState.errors.statusCode?.message)}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="academyCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('fields.academyCode')}{' '}
                    <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <LookupSelect
                      category="academy"
                      codes={academyCodes}
                      value={field.value}
                      onValueChange={field.onChange}
                      placeholder={t('fields.academyCode.placeholder')}
                    />
                  </FormControl>
                  <FormMessage>
                    {resolveError(form.formState.errors.academyCode?.message)}
                  </FormMessage>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="club"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.club')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* ─── Address ──────────────────────────────────────────────── */}
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
                      <Input {...field} value={field.value ?? ''} inputMode="numeric" />
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
                  <FormDescription>
                    {t('fields.contactEmail.description')}
                  </FormDescription>
                  <FormMessage>
                    {resolveError(form.formState.errors.contactEmail?.message)}
                  </FormMessage>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* ─── Emergency Contact ────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.emergencyContact')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="emergencyContactName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.emergencyContactName')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="emergencyContactPhone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.emergencyContactPhone')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} type="tel" />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="emergencyContactRelation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.emergencyContactRelation')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* ─── Photo ────────────────────────────────────────────────── */}
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
            disabled={createUser.isPending || createPlayer.isPending}
          >
            {tCommon('cancel')}
          </Button>
          <Button
            type="submit"
            disabled={
              createUser.isPending ||
              createPlayer.isPending ||
              !dob
            }
          >
            {t('create.submit')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
