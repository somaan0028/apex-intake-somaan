/**
 * Password hashing helpers.
 *
 * Uses Node's built-in scrypt KDF — no native dependencies required, unlike
 * bcrypt/argon2 — with a random per-password salt.
 *
 * The salt is NOT a secret and is NOT stored in the environment: a global salt
 * would make identical passwords hash identically and could be amortized by an
 * attacker. Instead each credential carries its own random salt, encoded together
 * with the algorithm + work factor in a single self-describing string (the same
 * idea as bcrypt/argon2):
 *
 *     scrypt$N=16384,r=8,p=1$<saltBase64>$<hashBase64>
 *
 * Because the parameters travel with the hash, the work factor can be raised
 * later without invalidating existing passwords.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const ALGORITHM = "scrypt";
/** scrypt work factors; recorded in each encoded hash. */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
/** Derived key length in bytes. */
const KEY_LENGTH = 64;
/** Per-password salt length in bytes. */
const SALT_LENGTH = 16;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

function formatParams(params: ScryptParams): string {
  return `N=${params.N},r=${params.r},p=${params.p}`;
}

function parseParams(encoded: string): ScryptParams | null {
  const values = new Map(
    encoded
      .split(",")
      .map((pair) => pair.split("=") as [string, string]),
  );
  const N = Number(values.get("N"));
  const r = Number(values.get("r"));
  const p = Number(values.get("p"));

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return null;
  }
  // Guard against malformed/absurd cost parameters.
  if (N <= 1 || r <= 0 || p <= 0) return null;
  return { N, r, p };
}

/** Hash a plaintext password into a single self-describing encoded string. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);

  return [
    ALGORITHM,
    formatParams(SCRYPT_PARAMS),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/** Constant-time verification of a plaintext password against an encoded hash. */
export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split("$");
  if (parts.length !== 4) return false;

  const [algorithm, params, saltBase64, hashBase64] = parts;
  if (algorithm !== ALGORITHM) return false;

  const parsed = parseParams(params);
  if (!parsed) return false;

  const salt = Buffer.from(saltBase64, "base64");
  const expected = Buffer.from(hashBase64, "base64");
  if (expected.length === 0) return false;

  const derived = scryptSync(password, salt, expected.length, parsed);
  return timingSafeEqual(derived, expected);
}
