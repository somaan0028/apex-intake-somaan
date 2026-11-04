import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";

/**
 * Route guard.
 *
 * `proxy.ts` is the renamed `middleware.ts` in Next 16. It redirects requests
 * that carry no session cookie away from protected routes, but it is **not** a
 * security boundary — protected pages and Server Actions re-check the session
 * against the database themselves (see `lib/auth/session.ts`).
 *
 * It deliberately does NOT redirect authenticated-looking requests away from
 * `/login`: proxy can only see whether the cookie *exists*, not whether the
 * session is still valid, so doing so would bounce a stale cookie between
 * `/login` and `/dashboard` forever. The login page handles that case itself
 * using the database-validated session.
 *
 * `/`, `/login` and the public intake API are open; everything else needs a
 * session cookie. Unauthenticated API calls get a JSON 401 rather than an HTML
 * redirect so clients aren't handed a login page.
 */
const PUBLIC_PATHS = new Set(["/", "/login"]);
const PUBLIC_API_PREFIX = "/api/public/";

/**
 * API routes that authenticate themselves rather than relying on the session
 * cookie, so the guard below must let them through unauthenticated.
 *
 * `/api/mcp` checks a bearer access token of its own (see
 * `app/api/mcp/route.ts`): its callers are AI agents, not browsers, so there is
 * no cookie to find and nothing this guard could usefully decide.
 */
const SELF_AUTHENTICATING_API = new Set(["/api/mcp"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  const isPublic =
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith(PUBLIC_API_PREFIX) ||
    SELF_AUTHENTICATING_API.has(pathname);

  if (!hasSession && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on every path except Next.js internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
