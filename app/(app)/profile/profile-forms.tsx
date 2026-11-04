"use client";

/**
 * The profile edit forms.
 *
 * Two separate forms on purpose: changing a name and changing a password are
 * different operations with different evidence requirements, and splitting them
 * means a failed password check cannot silently discard a name edit.
 *
 * What each person may change is decided on the server
 * (`lib/auth/profile-actions.ts`); the fields hidden here are only a courtesy.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changePassword, updateProfile } from "@/lib/auth/profile-actions";
import { USER_ROLES, type UserRole } from "@/lib/db/schema";
import { USER_ROLE_LABELS } from "@/lib/labels";
import { can, canChangeUserRole, type Actor } from "@/lib/rbac";

/** The outcome of one form submission, for inline feedback. */
interface FormState {
  status: "idle" | "ok" | "error";
  message?: string;
}

function FormMessage({ state }: { state: FormState }) {
  if (state.status === "ok" && state.message) {
    return (
      <p
        role="status"
        className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-500"
      >
        <Check className="size-4" />
        {state.message}
      </p>
    );
  }
  if (state.status === "error" && state.message) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    );
  }
  return null;
}

export function ProfileForms({
  viewer,
  adminCount,
}: {
  viewer: { id: number; name: string; email: string; role: UserRole };
  adminCount: number;
}) {
  const router = useRouter();
  const [detailsPending, startDetails] = useTransition();
  const [passwordPending, startPassword] = useTransition();
  const [details, setDetails] = useState<FormState>({ status: "idle" });
  const [password, setPassword] = useState<FormState>({ status: "idle" });
  const [role, setRole] = useState<UserRole>(viewer.role);

  const actor: Actor = { id: viewer.id, role: viewer.role };
  const isAdmin = can(viewer.role, "users.manage");
  // The only self role change the policy ever blocks is demoting the last admin,
  // so probing the ADMIN → USER transition is enough to lock the control.
  const roleLocked = isAdmin && !canChangeUserRole(actor, viewer, "USER", adminCount);

  function handleDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // The Select is a custom listbox, so its value is added by hand.
    formData.set("role", role);
    setDetails({ status: "idle" });

    startDetails(async () => {
      const result = await updateProfile(formData);
      setDetails(
        result.ok
          ? { status: "ok", message: result.message }
          : {
              status: "error",
              message: result.error ?? "Something went wrong. Please try again.",
            },
      );
      if (result.ok) router.refresh();
    });
  }

  function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Captured before awaiting: `currentTarget` is not safe to read afterwards.
    const form = event.currentTarget;
    const formData = new FormData(form);
    setPassword({ status: "idle" });

    startPassword(async () => {
      const result = await changePassword(formData);
      setPassword(
        result.ok
          ? { status: "ok", message: result.message }
          : {
              status: "error",
              message: result.error ?? "Something went wrong. Please try again.",
            },
      );
      if (result.ok) form.reset();
    });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>
            {isAdmin
              ? "As an administrator you can change your name, email and role. Your current password is not needed for these."
              : "You can change your name here. Your email and role are managed by an administrator."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleDetails} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                name="name"
                defaultValue={viewer.name}
                autoComplete="name"
                required
              />
            </div>

            {isAdmin ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="profile-email">Email</Label>
                  <Input
                    id="profile-email"
                    name="email"
                    type="email"
                    defaultValue={viewer.email}
                    autoComplete="email"
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="profile-role">Role</Label>
                  <Select
                    value={role}
                    onValueChange={(value) => setRole(value as UserRole)}
                    disabled={roleLocked}
                  >
                    <SelectTrigger id="profile-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_ROLES.map((option: UserRole) => (
                        <SelectItem key={option} value={option}>
                          {USER_ROLE_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {roleLocked ? (
                    <p className="text-xs text-muted-foreground">
                      You are the only administrator, so you cannot change your
                      own role.
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={detailsPending}>
                {detailsPending ? "Saving…" : "Save details"}
              </Button>
              <FormMessage state={details} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Enter your current password to set a new one. This is what keeps
            someone with access to your open browser from taking over your
            account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePassword} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={passwordPending}>
                {passwordPending ? "Changing…" : "Change password"}
              </Button>
              <FormMessage state={password} />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
