/**
 * Resolve the IP address a request came from.
 *
 * App Router handlers only receive a web `Request`, which does not expose the
 * socket's remote address. Next's own server therefore fills `x-forwarded-for`
 * from `socket.remoteAddress` when nothing upstream has set it, so the header
 * is the portable way to read the client address (in development localhost
 * arrives as `::1` or `127.0.0.1`).
 *
 * The left-most entry is the original client; proxies append to the list. The
 * value is normalised (port, brackets, IPv4-mapped IPv6, zone id) and must parse
 * as a literal IPv4/IPv6 address, so junk is stored as `null` rather than a
 * misleading value.
 *
 * Caveat: with no trusted proxy in front, a caller can forge this header. The
 * value is never taken from the request body, and a spoofed address is no worse
 * than the absent one we used to store.
 */
import { isIP } from "node:net";

/** `::ffff:203.0.113.5` is the same peer as `203.0.113.5`; store it that way. */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

function normalizeCandidate(value: string): string | null {
  let candidate = value.trim();
  if (!candidate) return null;

  // `[2001:db8::1]:443` -> `2001:db8::1`
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketed) candidate = bracketed[1];

  // `203.0.113.5:443` -> `203.0.113.5`. Every unbracketed IPv6 literal has
  // more than one colon, so a single colon can only be an IPv4 port here.
  if ((candidate.match(/:/g) ?? []).length === 1) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  // Drop a scope/zone id (`fe80::1%eth0`) — it is host-local, not routable.
  candidate = candidate.split("%")[0];

  const mapped = IPV4_MAPPED.exec(candidate);
  if (mapped) candidate = mapped[1];

  return isIP(candidate) ? candidate : null;
}

/** First usable address in `x-forwarded-for`, else `x-real-ip`, else `null`. */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    for (const entry of forwarded.split(",")) {
      const ip = normalizeCandidate(entry);
      if (ip) return ip;
    }
  }
  return normalizeCandidate(headers.get("x-real-ip") ?? "");
}
