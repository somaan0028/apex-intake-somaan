"use server";

/**
 * Server Actions behind the Settings page's token card.
 *
 * Both actions re-derive the user from the session rather than trusting an id
 * from the form, and both are scoped to that user, so one account can neither
 * mint a token for somebody else nor revoke one.
 */
import { revalidatePath } from "next/cache";
import { createApiToken, revokeApiToken } from "./api-token";
import { requireUser } from "./session";

/** Longest token name we accept, matching the input's `maxLength`. */
const MAX_NAME_LENGTH = 60;

/** State handed to the create form through `useActionState`. */
export interface CreateTokenState {
  error?: string;
  /** The raw token. Present only in the response to a successful create. */
  token?: string;
}

/** Create a token for the signed-in user and hand back the value to show once. */
export async function createToken(
  _previous: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Give the token a name, so you can tell it apart later." };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { error: `Names are limited to ${MAX_NAME_LENGTH} characters.` };
  }

  const { token } = createApiToken(user.id, name);
  revalidatePath("/settings");

  return { token };
}

/** Revoke one of the signed-in user's own tokens. */
export async function revokeToken(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(formData.get("id"));

  if (Number.isInteger(id) && id > 0) {
    revokeApiToken(user.id, id);
    revalidatePath("/settings");
  }
}
