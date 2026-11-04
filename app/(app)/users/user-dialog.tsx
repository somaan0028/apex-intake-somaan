"use client";

/**
 * Create/edit dialog for a user.
 *
 * Opened by the "Add user" button or by clicking a row; the same form serves
 * both modes and delete appears only when editing.
 *
 * The controls reflect the RBAC rules (you can't delete yourself; the last admin
 * can't be deleted or demoted), but every one of those rules is re-checked in
 * the Server Actions — this UI is a convenience, not the boundary.
 */
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { USER_ROLES, type UserRole } from "@/lib/db/schema";
import { USER_ROLE_LABELS } from "@/lib/labels";
import { canChangeUserRole, canDeleteUser, type Actor } from "@/lib/rbac";
import { createUser, deleteUser, updateUser } from "@/lib/users/actions";
import { withUserFormFields } from "@/lib/users/form";
import type { UserRow } from "@/lib/users/queries";

/** Which dialog to show: none, create, or edit a specific user. */
export type UserDialogState =
  { mode: "create" } | { mode: "edit"; user: UserRow };

const ROLE_OPTIONS = USER_ROLES.map((role: UserRole) => ({
  label: USER_ROLE_LABELS[role],
  value: role,
}));

export function UserDialog({
  state,
  onClose,
  viewer,
  adminCount,
}: {
  state: UserDialogState | null;
  onClose: () => void;
  /** The signed-in admin, used to decide which controls to disable. */
  viewer: Actor;
  /** Number of admins, so the last one can't be deleted or demoted. */
  adminCount: number;
}) {
  // Unmounting when closed keeps the form state fresh for the next open.
  if (!state) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <UserForm
          key={state.mode === "edit" ? `edit-${state.user.id}` : "create"}
          user={state.mode === "edit" ? state.user : null}
          viewer={viewer}
          adminCount={adminCount}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function UserForm({
  user,
  viewer,
  adminCount,
  onClose,
}: {
  user: UserRow | null;
  viewer: Actor;
  adminCount: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [role, setRole] = useState<UserRole>(user?.role ?? "USER");

  // The only role change the policy ever blocks is demoting the last admin, so
  // probing the ADMIN -> USER transition is enough to lock the control.
  const roleLocked =
    user !== null && !canChangeUserRole(viewer, user, "USER", adminCount);
  const deletable = user !== null && canDeleteUser(viewer, user, adminCount);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = withUserFormFields(new FormData(event.currentTarget), {
      role,
      userId: user?.id,
    });
    setError(null);

    startTransition(async () => {
      const result = user
        ? await updateUser(formData)
        : await createUser(formData);
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  function handleDelete() {
    if (!user) return;
    const formData = new FormData();
    formData.set("id", String(user.id));
    setError(null);

    startTransition(async () => {
      const result = await deleteUser(formData);
      setConfirmingDelete(false);
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{user ? "Edit user" : "Add user"}</DialogTitle>
        <DialogDescription>
          {user
            ? `Update ${user.name}'s details, or delete the account.`
            : "Create an intake agent or another admin."}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="user-name">Name</Label>
          <Input
            id="user-name"
            name="name"
            defaultValue={user?.name ?? ""}
            autoComplete="off"
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="user-email">Email</Label>
          <Input
            id="user-email"
            name="email"
            type="email"
            defaultValue={user?.email ?? ""}
            autoComplete="off"
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="user-password">Password</Label>
          <Input
            id="user-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={
              user ? "Leave blank to keep current" : "At least 8 characters"
            }
            required={!user}
          />
          {user ? (
            <p className="text-xs text-muted-foreground">
              Leave blank to keep the current password.
            </p>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="user-role">Role</Label>
          <Select
            items={ROLE_OPTIONS}
            value={role}
            onValueChange={(value) => {
              if (value) setRole(value);
            }}
            disabled={roleLocked}
          >
            <SelectTrigger id="user-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {roleLocked ? (
            <p className="text-xs text-muted-foreground">
              This is the only admin — make another admin before changing the
              role.
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          {user ? (
            <Button
              type="button"
              variant="destructive"
              className="sm:mr-auto"
              disabled={!deletable || pending}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 />
              Delete
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : user ? "Save changes" : "Create user"}
          </Button>
        </DialogFooter>
      </form>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent forceBackdrop>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
            <AlertDialogDescription>
              {user?.name} will lose access immediately. This can&apos;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={pending}
            >
              {pending ? "Deleting…" : "Delete user"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
