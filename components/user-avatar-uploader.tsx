"use client";

/**
 * Profile-photo control used on the Profile page and in the Users dialog.
 *
 * It uploads the chosen file through a Server Action, which resizes and stores
 * it; this component only validates the obvious cases first so a huge or wrong
 * file never leaves the browser. An object URL gives instant local feedback
 * while the upload runs.
 */
import { Camera, Loader2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/format";
import {
  AVATAR_ACCEPT,
  AVATAR_ACCEPTED_TYPES,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_MAX_UPLOAD_LABEL,
  avatarUrl,
} from "@/lib/users/avatar";
import { removeAvatar, uploadAvatar } from "@/lib/users/avatar-actions";

export function UserAvatarUploader({
  userId,
  name,
  avatarPath,
  canEdit = true,
  avatarClassName = "size-16",
  fallbackClassName = "text-base",
  variant = "buttons",
}: {
  userId: number;
  name: string;
  avatarPath: string | null;
  /** False renders the photo read-only (no controls). */
  canEdit?: boolean;
  avatarClassName?: string;
  fallbackClassName?: string;
  /**
   * `buttons` shows Add photo / Remove beside the avatar (Users dialog).
   * `avatar` makes the photo itself the upload control and drops the caption,
   * which is the cleaner profile-header treatment.
   */
  variant?: "buttons" | "avatar";
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [currentPath, setCurrentPath] = useState(avatarPath);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Revoke the previous object URL whenever the preview changes or the control
  // unmounts; otherwise every selection leaks one blob for the page's lifetime.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const displayedSrc =
    preview ?? (currentPath ? avatarUrl(userId, currentPath) : undefined);

  function chooseFile() {
    setError(null);
    inputRef.current?.click();
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (!(AVATAR_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      setError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
      setError(`Choose an image smaller than ${AVATAR_MAX_UPLOAD_LABEL}.`);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setError(null);

    const formData = new FormData();
    formData.set("userId", String(userId));
    formData.set("avatar", file);

    startTransition(async () => {
      const result = await uploadAvatar(formData);
      if (result.ok) {
        setCurrentPath(result.avatarPath ?? null);
        setPreview(null);
        router.refresh();
      } else {
        setPreview(null);
        setError(
          result.error ?? "Could not save that photo. Please try again.",
        );
      }
    });
  }

  function handleRemove() {
    setError(null);
    const formData = new FormData();
    formData.set("userId", String(userId));

    startTransition(async () => {
      const result = await removeAvatar(formData);
      if (result.ok) {
        setCurrentPath(null);
        setPreview(null);
        router.refresh();
      } else {
        setError(
          result.error ?? "Could not remove that photo. Please try again.",
        );
      }
    });
  }

  const avatar = (
    <Avatar className={avatarClassName}>
      {displayedSrc ? <AvatarImage src={displayedSrc} alt="" /> : null}
      <AvatarFallback className={fallbackClassName}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <>
      {variant === "avatar" ? (
        <div className="group/avatar relative inline-flex flex-col items-start gap-1.5">
          {canEdit ? (
            <button
              type="button"
              onClick={chooseFile}
              disabled={pending}
              aria-label={
                currentPath ? "Change profile photo" : "Upload profile photo"
              }
              className="relative block cursor-pointer rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait"
            >
              {avatar}
              {/* The photo is the control: a camera appears on hover/focus so
                  the affordance is discoverable without permanent chrome. */}
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover/avatar:opacity-100 group-focus-within/avatar:opacity-100">
                {pending ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Camera className="size-5" />
                )}
              </span>
            </button>
          ) : (
            avatar
          )}

          {canEdit && currentPath ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={pending}
              aria-label="Remove profile photo"
              title="Remove photo"
              className="absolute -top-1 -right-1 z-10 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/avatar:opacity-100 group-focus-within/avatar:opacity-100 hover:text-destructive focus-visible:opacity-100 disabled:cursor-wait"
            >
              <X className="size-3.5" />
            </button>
          ) : null}

          {error ? (
            <p role="alert" className="max-w-40 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          {avatar}

          {canEdit ? (
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={chooseFile}
                >
                  {pending ? <Loader2 className="animate-spin" /> : <Camera />}
                  {currentPath || preview ? "Change photo" : "Add photo"}
                </Button>

                {currentPath || preview ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={handleRemove}
                  >
                    <Trash2 />
                    Remove
                  </Button>
                ) : null}
              </div>

              <p className="text-xs text-muted-foreground">PNG, JPEG or WebP</p>

              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="sr-only"
        aria-label="Choose a profile photo"
        onChange={handleFile}
      />
    </>
  );
}
