/**
 * Name of the session cookie.
 *
 * Kept in its own module (with no `next/headers` import) so that both
 * `proxy.ts` and the server-side session helpers can share it.
 */
export const SESSION_COOKIE = "apex_session";
