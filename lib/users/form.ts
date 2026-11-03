/**
 * The data the user dialog submits.
 *
 * The dialog's fields are plain inputs except two values that aren't text
 * inputs — the role (a controlled Select) and, when editing, the target's id —
 * so they're added here rather than read from the DOM. Keeping this in one place
 * means the client and the Server Action agree on exactly what is sent; a gap
 * here is the kind of thing that silently turns into "Unknown user" on the
 * server.
 */
import type { UserRole } from "@/lib/db/schema";

/** Adds the values the form carries outside its inputs to `formData`. */
export function withUserFormFields(
  formData: FormData,
  fields: { role: UserRole; userId?: number },
): FormData {
  formData.set("role", fields.role);
  // Only present when editing; create has no id to send.
  if (fields.userId !== undefined) formData.set("id", String(fields.userId));
  return formData;
}
