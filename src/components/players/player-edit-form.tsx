'use client';

/**
 * <PlayerEditForm> — mode-aware player edit (Plan 02-13 Task 1).
 *
 * One component, five visual modes (UI-SPEC §RBAC-Sensitive UI Behavior):
 *
 *   - 'td'             — full edit using `player.updateAsTd`
 *   - 'academyManager' — full edit using `player.updateAsTd` (RLS narrows
 *                        the academy_manager scope to their own academy)
 *   - 'self'           — D-37 whitelist via `player.updateSelf`; renders
 *                        identity / sport fields as styled non-interactive
 *                        divs (UI-SPEC line 384)
 *   - 'parent'         — same whitelist as self via `player.updateOnBehalfOf`
 *   - 'readOnly'       — every field as styled non-interactive div, NO
 *                        submit button, header pill `players.detail.readOnly`
 *
 * The Server Component owns the mode decision; the Client form respects
 * it. The server-side tRPC procedure enforces the real RBAC
 * (T-02-13-FORM-MODE-SPOOF — a malicious client can spoof the mode prop
 * via React DevTools but cannot get past the schema-narrowed tRPC handler
 * or the RLS UPDATE policy on `players`).
 *
 * Read-only fields use the styled-div pattern from UI-SPEC line 208 — NOT
 * a real disabled <input>, which some screen readers announce as
 * "unreadable". The `aria-disabled="true"` div is read aloud normally and
 * keyboard-navigation simply skips over it.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-13-ui-pages-and-forms-PLAN.md Task 1
 *            .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §RBAC-Sensitive UI Behavior
 *            .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-37
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
  playerSelfUpdateInput,
  playerUpdateAsTdInput,
} from '@/server/trpc/schemas/player';

export type PlayerEditMode = 'td' | 'academyManager' | 'self' | 'parent' | 'readOnly';

/** Minimal player shape this form needs. The Server Component passes the
 *  Drizzle select row through; we narrow at the boundary. */
export interface PlayerForEdit {
  userId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  school: string | null;
  street: string;
  streetNumber: string | null;
  postalCode: string;
  city: string;
  province: string;
  country: string;
  phone: string | null;
  email: string | null;
  club: string | null;
  statusCode: string;
  academyCode: string;
  ageCategoryCode: string;
  isMinor: boolean;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  profilePhotoFileId: string | null;
}

export interface PlayerEditFormProps {
  player: PlayerForEdit;
  mode: PlayerEditMode;
  /** Pre-fetched active academy codes (used in TD/academyManager mode). */
  academyCodes: readonly string[];
  /** Pre-fetched active status codes (used in TD/academyManager mode). */
  statusCodes: readonly string[];
  /** Locale for the locale-aware date format + redirects. */
  locale: 'nl' | 'en' | 'fr';
  /** Optional photo URL (signed) — resolved server-side by the page. */
  initialPhotoUrl?: string | null;
}

/** Styled non-interactive div replacement for an <input> in read-only
 *  modes (UI-SPEC line 208 — never a real `disabled` attribute). */
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

const TD_SCHEMA = playerUpdateAsTdInput;
const SELF_SCHEMA = playerSelfUpdateInput;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TdFormValues = z.output<typeof TD_SCHEMA>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SelfFormValues = z.output<typeof SELF_SCHEMA>;

export function PlayerEditForm({
  player,
  mode,
  academyCodes,
  statusCodes,
  locale,
  initialPhotoUrl,
}: PlayerEditFormProps) {
  const t = useTranslations('players');
  const tCommon = useTranslations('common');
  const tStatus = useTranslations('lookups.status');
  const tAcademy = useTranslations('lookups.academy');
  const router = useRouter();
  const resolveError = useZodErrorMessage();

  const isFullEdit = mode === 'td' || mode === 'academyManager';
  const isReadOnly = mode === 'readOnly';
  const isSelfOrParent = mode === 'self' || mode === 'parent';

  // ─── Full-edit form (TD / academy_manager) ────────────────────────────
  const tdForm = useForm<TdFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(TD_SCHEMA) as any,
    defaultValues: {
      playerId: player.userId,
      firstName: player.firstName,
      lastName: player.lastName,
      dateOfBirth: new Date(player.dateOfBirth),
      gender: player.gender as 'male' | 'female' | 'x',
      school: player.school ?? undefined,
      street: player.street,
      streetNumber: player.streetNumber ?? undefined,
      postalCode: player.postalCode,
      city: player.city,
      province: player.province,
      country: player.country,
      phone: player.phone ?? undefined,
      email: player.email ?? undefined,
      club: player.club ?? undefined,
      statusCode: player.statusCode,
      academyCode: player.academyCode,
      profilePhotoFileId: player.profilePhotoFileId ?? undefined,
      emergencyContactName: player.emergencyContactName ?? undefined,
      emergencyContactPhone: player.emergencyContactPhone ?? undefined,
      emergencyContactRelation: player.emergencyContactRelation ?? undefined,
    },
  });

  // ─── Self / parent self-update form ─────────────────────────────────
  const selfForm = useForm<SelfFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(SELF_SCHEMA) as any,
    defaultValues: {
      street: player.street,
      streetNumber: player.streetNumber ?? undefined,
      postalCode: player.postalCode,
      city: player.city,
      province: player.province,
      country: player.country,
      phone: player.phone ?? undefined,
      email: player.email ?? undefined,
      profilePhotoFileId: player.profilePhotoFileId ?? undefined,
      emergencyContactName: player.emergencyContactName ?? undefined,
      emergencyContactPhone: player.emergencyContactPhone ?? undefined,
      emergencyContactRelation: player.emergencyContactRelation ?? undefined,
    },
  });

  const updateAsTd = trpc.player.updateAsTd.useMutation();
  const updateSelf = trpc.player.updateSelf.useMutation();
  const updateOnBehalfOf = trpc.player.updateOnBehalfOf.useMutation();

  const [photoFileId, setPhotoFileId] = useState<string | null>(
    player.profilePhotoFileId ?? null,
  );

  // Keep RHF state in sync when the PhotoUpload widget surfaces a new id.
  useEffect(() => {
    if (isFullEdit) {
      tdForm.setValue(
        'profilePhotoFileId',
        photoFileId ?? undefined,
      );
    } else if (isSelfOrParent) {
      selfForm.setValue(
        'profilePhotoFileId',
        photoFileId ?? undefined,
      );
    }
  }, [photoFileId, isFullEdit, isSelfOrParent, tdForm, selfForm]);

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
      if (mode === 'parent') {
        await updateOnBehalfOf.mutateAsync({
          playerId: player.userId,
          ...values,
        });
      } else {
        await updateSelf.mutateAsync(values);
      }
      toast.success(t('edit.toast.saved'));
      router.refresh();
    } catch {
      toast.error(t('edit.toast.error'));
    }
  }

  const initials = useMemo(
    () =>
      `${player.firstName.charAt(0) || '?'}${player.lastName.charAt(0) || '?'}`.toUpperCase(),
    [player.firstName, player.lastName],
  );

  // ─── Read-only branch ───────────────────────────────────────────────
  if (isReadOnly) {
    void locale;
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.identity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <FormLabelStatic>{t('fields.firstName')}</FormLabelStatic>
              <ReadOnlyValue value={player.firstName} />
            </div>
            <div>
              <FormLabelStatic>{t('fields.lastName')}</FormLabelStatic>
              <ReadOnlyValue value={player.lastName} />
            </div>
            <div>
              <FormLabelStatic>{t('fields.dateOfBirth')}</FormLabelStatic>
              <ReadOnlyValue
                value={formatDate(new Date(player.dateOfBirth), locale)}
              />
            </div>
            <div>
              <FormLabelStatic>{t('fields.gender.label')}</FormLabelStatic>
              <ReadOnlyValue value={t(`fields.gender.${player.gender as 'male' | 'female' | 'x'}`)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.sport')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <FormLabelStatic>{t('fields.statusCode')}</FormLabelStatic>
              <ReadOnlyValue value={tStatus(player.statusCode)} />
            </div>
            <div>
              <FormLabelStatic>{t('fields.academyCode')}</FormLabelStatic>
              <ReadOnlyValue value={tAcademy(player.academyCode)} />
            </div>
            {player.club ? (
              <div>
                <FormLabelStatic>{t('fields.club')}</FormLabelStatic>
                <ReadOnlyValue value={player.club} />
              </div>
            ) : null}
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
                value={`${player.street}${player.streetNumber ? ' ' + player.streetNumber : ''}`}
              />
            </div>
            <div>
              <FormLabelStatic>{t('fields.postalCode')}</FormLabelStatic>
              <ReadOnlyValue
                value={`${player.postalCode} ${player.city}`}
              />
            </div>
            <div>
              <FormLabelStatic>{t('fields.province')}</FormLabelStatic>
              <ReadOnlyValue value={player.province} />
            </div>
          </CardContent>
        </Card>

        {/* Photo card kept for visual parity */}
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.photo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoUpload
              initialFileId={player.profilePhotoFileId ?? null}
              initialUrl={initialPhotoUrl ?? null}
              initials={initials}
              onUploaded={() => {
                /* readOnly mode — disabled at widget level */
              }}
              disabled
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Full-edit branch (TD / academyManager) ─────────────────────────
  if (isFullEdit) {
    return (
      <Form {...tdForm}>
        <form
          onSubmit={tdForm.handleSubmit(onSubmitTd)}
          className="space-y-6"
        >
          {/* Identity */}
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
              <FormField
                control={tdForm.control}
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

          {/* Sport */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.sport')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={tdForm.control}
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
                      />
                    </FormControl>
                    <FormMessage>
                      {resolveError(tdForm.formState.errors.statusCode?.message)}
                    </FormMessage>
                  </FormItem>
                )}
              />
              <FormField
                control={tdForm.control}
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
                      />
                    </FormControl>
                    <FormMessage>
                      {resolveError(tdForm.formState.errors.academyCode?.message)}
                    </FormMessage>
                  </FormItem>
                )}
              />
              <FormField
                control={tdForm.control}
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

          {/* Address */}
          <AddressCard form={tdForm} resolveError={resolveError} t={t} />

          {/* Emergency Contact */}
          <EmergencyContactCard form={tdForm} t={t} />

          {/* Photo */}
          <Card>
            <CardHeader>
              <CardTitle>{t('sections.photo')}</CardTitle>
            </CardHeader>
            <CardContent>
              <PhotoUpload
                initialFileId={player.profilePhotoFileId ?? null}
                initialUrl={initialPhotoUrl ?? null}
                initials={initials}
                onUploaded={(fileId) => setPhotoFileId(fileId)}
                onDeleted={() => setPhotoFileId(null)}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button
              type="submit"
              disabled={updateAsTd.isPending}
            >
              {t('edit.submit')}
            </Button>
          </div>
        </form>
      </Form>
    );
  }

  // ─── self / parent branch ───────────────────────────────────────────
  return (
    <Form {...selfForm}>
      <form
        onSubmit={selfForm.handleSubmit(onSubmitSelf)}
        className="space-y-6"
      >
        {/* Identity — read-only (D-37 — self cannot edit name/dob/gender) */}
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.identity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <FormLabelStatic>{t('fields.firstName')}</FormLabelStatic>
              <ReadOnlyValue value={player.firstName} />
            </div>
            <div>
              <FormLabelStatic>{t('fields.lastName')}</FormLabelStatic>
              <ReadOnlyValue value={player.lastName} />
            </div>
            <div>
              <FormLabelStatic>{t('fields.dateOfBirth')}</FormLabelStatic>
              <ReadOnlyValue
                value={formatDate(new Date(player.dateOfBirth), locale)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Sport — read-only (D-37 — self/parent cannot edit status/academy) */}
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.sport')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <FormLabelStatic>{t('fields.statusCode')}</FormLabelStatic>
              <ReadOnlyValue value={tStatus(player.statusCode)} />
            </div>
            <div>
              <FormLabelStatic>{t('fields.academyCode')}</FormLabelStatic>
              <ReadOnlyValue value={tAcademy(player.academyCode)} />
            </div>
          </CardContent>
        </Card>

        {/* Address — editable (D-37 whitelist) */}
        <AddressCard form={selfForm} resolveError={resolveError} t={t} />

        {/* Emergency Contact — editable */}
        <EmergencyContactCard form={selfForm} t={t} />

        {/* Photo — editable */}
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.photo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoUpload
              initialFileId={player.profilePhotoFileId ?? null}
              initialUrl={initialPhotoUrl ?? null}
              initials={initials}
              onUploaded={(fileId) => setPhotoFileId(fileId)}
              onDeleted={() => setPhotoFileId(null)}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            type="submit"
            disabled={updateSelf.isPending || updateOnBehalfOf.isPending}
          >
            {t('edit.submit')}
          </Button>
        </div>
      </form>
    </Form>
  );

  // Suppress unused-warning helpers when chosen branch doesn't use them.
  void tCommon;
}

/** Static label (used outside of an RHF FormField for read-only rows). */
function FormLabelStatic({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-sm font-medium">{children}</div>
  );
}

/** Address card factored out so TD/self share the same layout. */
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

/** Emergency-contact card — same for TD/self/parent. */
function EmergencyContactCard({
  form,
  t,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sections.emergencyContact')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormField
          control={form.control}
          name="emergencyContactName"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          render={({ field }: any) => (
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          render={({ field }: any) => (
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          render={({ field }: any) => (
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
  );
}
