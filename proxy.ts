import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";

/**
 * Route guard.
 *
 * `proxy.ts` is the renamed `middleware.ts` in Next 16. It redirects
 * unauthenticated users away from protected routes, but it is **not** a
 * security boundary — protected pages and Server Actions re-check the session
 * themselves (see `lib/auth/session.ts`).
 *
 * `/` and `/login` are public; everything else requires a (mock) session.
 */
const PUBLIC_PATHS = new Set(["/", "/login"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthenticated = request.cookies.has(SESSION_COOKIE);

  if (!isAuthenticated && !PUBLIC_PATHS.has(pathname)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Signed-in users have no reason to see the login form.
  if (isAuthenticated && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on every path except Next.js internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
