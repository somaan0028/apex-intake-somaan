"use client";

/**
 * A user's avatar everywhere in the app.
 *
 * One component keeps the rule consistent: show the stored photo when there is
 * one, and otherwise the person's initials. `avatarPath` is the filename from
 * the `users` row; the private route and its cache-busting `v` are resolved
 * here so no caller has to know how photos are stored.
 */
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { avatarUrl } from "@/lib/users/avatar";

export function UserAvatar({
  userId,
  name,
  avatarPath,
  size = "default",
  className,
  fallbackClassName,
}: {
  userId: number;
  name: string;
  avatarPath: string | null;
  size?: "default" | "sm" | "lg";
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      {avatarPath ? (
        // An empty alt is right here: the name is always rendered beside the
        // photo, so announcing it again would be repetitive.
        <AvatarImage src={avatarUrl(userId, avatarPath)} alt="" />
      ) : null}
      <AvatarFallback className={fallbackClassName}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
