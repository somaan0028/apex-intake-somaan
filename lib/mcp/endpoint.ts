/**
 * Build the absolute MCP endpoint shown in Settings.
 *
 * The page is reached through localhost, a LAN address, or a reverse proxy, and
 * the copied config must work from wherever the person is. The request host is
 * the source of truth. The protocol comes from `x-forwarded-proto` when a proxy
 * supplies it; otherwise a loopback or private address is plain HTTP, while a
 * public hostname defaults to HTTPS.
 */

/** The small part of `Headers` this helper needs, so it is easy to test. */
export interface HeaderReader {
  get(name: string): string | null;
}

/** Production `npm start` and `./start.sh` serve on 8080. */
const FALLBACK_HOST = "localhost:8080";

/** The first value of a possibly comma-separated forwarded header. */
function firstValue(value: string | null | undefined): string {
  return value?.split(",")[0]?.trim() ?? "";
}

/** Hostname without brackets, lowercased. */
function hostnameOf(host: string): string {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return host.toLowerCase();
  }
}

/** Loopback, link-local, and RFC 1918 addresses are reached over plain HTTP. */
function isLocalOrPrivate(host: string): boolean {
  const name = hostnameOf(host).replace(/^\[|\]$/g, "");

  if (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "::1" ||
    name === "0.0.0.0"
  ) {
    return true;
  }

  if (/^127\./.test(name) || /^10\./.test(name) || /^192\.168\./.test(name)) {
    return true;
  }

  if (/^169\.254\./.test(name)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(name)) return true;

  // IPv6 unique local addresses (fc00::/7).
  return /^f[cd][0-9a-f]{2}:/.test(name);
}

export function mcpEndpoint(headers: HeaderReader): string {
  const forwardedHost = firstValue(headers.get("x-forwarded-host"));
  const host = forwardedHost || headers.get("host")?.trim() || FALLBACK_HOST;

  const forwardedProto = firstValue(headers.get("x-forwarded-proto"));
  const protocol =
    forwardedProto || (isLocalOrPrivate(host) ? "http" : "https");

  return `${protocol}://${host}/api/mcp`;
}
