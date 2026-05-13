'use client';

/**
 * PhotoUpload — self-built drag-drop photo upload widget (D-41, PLAYER-05).
 *
 * State machine (UI-SPEC §Photo Upload Widget):
 *   idle → dragging | uploading
 *   uploading → scanPending | error
 *   scanPending → clean | infected | scanTimeout
 *   clean | infected → idle (on Replace / Delete)
 *
 * No third-party drag-drop library (D-41 — no external dropzone dep).
 * HTML5 drag/drop on a <button> wrapping a hidden <input type="file"> —
 * keyboard accessible via Enter/Space (button native focus + activation).
 *
 * Server is authoritative on size + type (D-23 — client checks are UX
 * hints; the server runs magic-byte validation, Zod size cap, and the
 * malware scan).
 *
 * WARNING-06 fix: file payload is base64-encoded via a single
 * FileReader.readAsDataURL pass (which also doubles as the preview
 * data-URL). The previous char-loop encoding pattern was O(n²) on the
 * UI thread and froze typical 2 MB uploads for ~200 ms.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md
 *              §Photo Upload Widget (visual states, interactions, a11y)
 *            .planning/phases/02-identiteit-bestanden/02-12-ui-shared-components-PLAN.md Task 2
 */
import { Loader2, ImagePlus, ShieldAlert, X, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { trpc } from '@/lib/trpc-client';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** 2 MB raw cap per VALID-01 (server-authoritative; client hint only). */
const MAX_BYTES = 2 * 1024 * 1024;
/** Whitelist mirrored from VALID-03 (server is authoritative). */
const ACCEPT_MIME = ['image/jpeg', 'image/png'] as const;
/** Polling cadence — matches UI-SPEC §Photo Upload Widget step 6. */
const POLL_MS = 2_000;
/** Polling cap — after this, transition to scanTimeout (T-02-12-INDEFINITE-POLL). */
const POLL_TIMEOUT_MS = 30_000;

type UiState =
  | 'idle'
  | 'dragging'
  | 'uploading'
  | 'scanPending'
  | 'clean'
  | 'infected'
  | 'scanTimeout';

export interface PhotoUploadProps {
  /** Currently-saved file id (passed in by the parent form when editing). */
  initialFileId?: string | null;
  /** Currently-saved signed URL preview (parent fetches via trpc.file.getSignedUrl). */
  initialUrl?: string | null;
  /** Initials for the AvatarFallback (e.g., "JD"). */
  initials: string;
  /** Called when a scan completes successfully and a new fileId is ready to persist. */
  onUploaded(fileId: string): void;
  /** Called when the parent should clear `profile_photo_file_id`. */
  onDeleted?(): void;
  disabled?: boolean;
}

export function PhotoUpload({
  initialFileId,
  initialUrl,
  initials,
  onUploaded,
  onDeleted,
  disabled = false,
}: PhotoUploadProps) {
  // Two namespaces: widget-scoped copy (files.photo.*) and the global
  // tRPC error catalog (errors.file.*). Keeping the two separate avoids
  // a brittle string-slice that depends on key-path layout.
  const t = useTranslations('files.photo');
  const tErr = useTranslations('errors.file');

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initialUrl ?? null,
  );
  const [uiState, setUiState] = useState<UiState>('idle');
  const [activeFileId, setActiveFileId] = useState<string | null>(
    initialFileId ?? null,
  );
  const [pollStartedAt, setPollStartedAt] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const uploadMutation = trpc.file.upload.useMutation();

  // Poll scan status for the active file. Query is enabled only when we
  // have an active id and we are in scanPending state — terminal states
  // (clean / infected / scanTimeout) disable the query, which stops the
  // refetch loop (T-02-12-INDEFINITE-POLL mitigation).
  const scanQuery = trpc.file.getScanStatus.useQuery(
    { fileId: activeFileId ?? '' },
    {
      enabled: Boolean(activeFileId) && uiState === 'scanPending',
      refetchInterval: POLL_MS,
    },
  );

  // Drive the state machine when the polled status arrives.
  useEffect(() => {
    if (!activeFileId || uiState !== 'scanPending') return;
    const data = scanQuery.data;
    if (!data) return;
    if (data.scanStatus === 'clean') {
      setUiState('clean');
      toast.success(t('toast.uploaded'));
      onUploaded(activeFileId);
    } else if (data.scanStatus === 'infected') {
      setUiState('infected');
    }
  }, [scanQuery.data, activeFileId, uiState, t, onUploaded]);

  // Poll timeout enforcement — schedule the transition to scanTimeout
  // exactly once per scanPending entry.
  useEffect(() => {
    if (uiState !== 'scanPending' || pollStartedAt == null) return;
    const elapsed = Date.now() - pollStartedAt;
    if (elapsed >= POLL_TIMEOUT_MS) {
      setUiState('scanTimeout');
      return;
    }
    const remaining = POLL_TIMEOUT_MS - elapsed;
    const timer = setTimeout(() => setUiState('scanTimeout'), remaining);
    return () => clearTimeout(timer);
  }, [uiState, pollStartedAt]);

  function isAcceptedMime(mime: string): boolean {
    return (ACCEPT_MIME as readonly string[]).includes(mime);
  }

  async function handleFile(file: File): Promise<void> {
    if (disabled) return;
    // Client-side UX hints (server-authoritative).
    if (file.size > MAX_BYTES) {
      toast.error(t('errors.tooLarge'));
      return;
    }
    if (!isAcceptedMime(file.type)) {
      toast.error(t('errors.wrongType'));
      return;
    }

    // WARNING-06 fix: ONE FileReader pass produces both the preview
    // data-URL AND the upload base64 — avoids the O(n²) char-loop
    // encoding that froze the main thread for ~200 ms on 2 MB files.
    // readAsDataURL returns "data:<mime>;base64,<payload>"; we slice off
    // the prefix to get the raw base64 the server expects.
    setUiState('uploading');
    let dataUrl: string;
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(reader.error ?? new Error('FileReader failed'));
        reader.readAsDataURL(file);
      });
    } catch {
      setUiState('idle');
      toast.error(tErr('uploadFailed'));
      return;
    }
    setPreviewUrl(dataUrl);

    // "data:image/png;base64,...." → strip the prefix to the bare payload.
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) {
      setUiState('idle');
      toast.error(tErr('uploadFailed'));
      return;
    }
    const contentBase64 = dataUrl.slice(commaIdx + 1);

    try {
      const res = await uploadMutation.mutateAsync({
        bucket: 'profiles',
        claimedMimeType: file.type,
        originalFilename: file.name,
        contentBase64,
      });
      setActiveFileId(res.fileId);
      setUiState('scanPending');
      setPollStartedAt(Date.now());
    } catch (err: unknown) {
      setUiState('idle');
      // Server sends `errors.file.<code>` as the TRPCError message. Map
      // it through the global errors.file.* catalog; anything that
      // doesn't match the expected shape falls back to a generic toast.
      const raw = err instanceof Error ? err.message : '';
      if (raw.startsWith('errors.file.')) {
        const code = raw.slice('errors.file.'.length);
        try {
          toast.error(tErr(code));
        } catch {
          toast.error(tErr('uploadFailed'));
        }
      } else {
        toast.error(tErr('uploadFailed'));
      }
    }
  }

  function onPick(): void {
    if (disabled) return;
    inputRef.current?.click();
  }

  function onDrop(e: React.DragEvent<HTMLButtonElement>): void {
    e.preventDefault();
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    if (files.length > 1) {
      toast.error(t('errors.multiFile'));
    }
    void handleFile(files[0]!);
    setUiState((s) => (s === 'dragging' ? 'idle' : s));
  }

  function onDragOver(e: React.DragEvent<HTMLButtonElement>): void {
    e.preventDefault();
    if (!disabled) setUiState('dragging');
  }

  function onDragLeave(): void {
    setUiState((s) => (s === 'dragging' ? 'idle' : s));
  }

  function onConfirmDelete(): void {
    setDeleteOpen(false);
    setPreviewUrl(null);
    setActiveFileId(null);
    setUiState('idle');
    setPollStartedAt(null);
    onDeleted?.();
  }

  // ─── Render ────────────────────────────────────────────────────────────
  const isShowingPhoto =
    previewUrl != null && (uiState === 'clean' || uiState === 'scanPending');

  return (
    <div className="flex flex-col items-start gap-2">
      {isShowingPhoto ? (
        <div className="relative">
          <Avatar
            className={cn(
              'size-24',
              uiState === 'scanPending' && 'grayscale opacity-70',
            )}
          >
            <AvatarImage src={previewUrl ?? undefined} alt="" />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          {uiState === 'scanPending' && (
            <Badge
              variant="secondary"
              className="absolute -bottom-2 -right-2"
            >
              <Loader2 className="size-3 animate-spin mr-1" />
              {t('scanPending')}
            </Badge>
          )}
          {uiState === 'clean' && !disabled && (
            <div className="absolute -top-2 -right-2 flex gap-1">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-11 w-11" // 44×44 hit target (UI-SPEC accessibility)
                onClick={onPick}
                aria-label={t('actions.replace')}
                title={t('actions.replace')}
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="destructive"
                className="h-11 w-11"
                onClick={() => setDeleteOpen(true)}
                aria-label={t('actions.delete')}
                title={t('actions.delete')}
              >
                <X className="size-4" />
              </Button>
            </div>
          )}
        </div>
      ) : uiState === 'infected' ? (
        <div className="flex flex-col gap-2 rounded-md border-2 border-destructive p-4 text-destructive">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4" />
            <span>{t('scanInfected')}</span>
          </div>
          <Button type="button" onClick={onPick} variant="outline">
            {t('actions.replace')}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          disabled={disabled}
          className={cn(
            'flex h-40 w-40 flex-col items-center justify-center rounded-md border-2 border-dashed border-input bg-muted',
            uiState === 'dragging' && 'border-primary bg-primary/5',
            disabled && 'opacity-60 cursor-not-allowed',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-describedby="photo-upload-help"
        >
          {uiState === 'uploading' ? (
            <>
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <span className="mt-2 text-sm text-muted-foreground">
                {t('uploading')}
              </span>
            </>
          ) : uiState === 'scanTimeout' ? (
            <>
              <RefreshCw className="size-8 text-muted-foreground" />
              <span className="mt-2 text-sm text-muted-foreground">
                {t('scanTimeout')}
              </span>
            </>
          ) : (
            <>
              <ImagePlus className="size-8 text-muted-foreground" />
              <span className="mt-2 text-sm text-muted-foreground text-center">
                {uiState === 'dragging'
                  ? t('dropzone.dragging')
                  : t('dropzone.idle')}
              </span>
            </>
          )}
          <span id="photo-upload-help" className="sr-only">
            {t('dropzone.idle')}
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_MIME.join(',')}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      {/* Screen-reader-only status region — UI-SPEC §Accessibility:
          announces scan progress + completion without forcing focus. */}
      <div role="status" aria-live="polite" className="sr-only">
        {uiState === 'scanPending'
          ? t('scanPending')
          : uiState === 'clean'
            ? t('toast.uploaded')
            : null}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm.body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('deleteConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete}>
              {t('deleteConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
