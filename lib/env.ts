/**
 * Startup environment contract.
 *
 * The assistant and the Brightwater submit flow both need a secret that has no
 * safe default. Validating once at boot means a missing key fails the server
 * before it accepts a request, rather than as a confusing error on the first
 * chat message or firm submission.
 *
 * Optional settings (AI_MODEL, DATABASE_PATH, AUTH_COOKIE_SECURE) keep their
 * defaults and are read where they are used.
 */
import { z } from "zod";

const requiredValue = z
  .string({ error: "is required" })
  .trim()
  .min(1, "must not be empty");

const serverEnvSchema = z.object({
  OPENROUTER_API_KEY: requiredValue,
  CANDIDATE_TOKEN: requiredValue,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Read and validate the required server variables.
 *
 * Throws with every missing or empty name listed, so one boot tells the operator
 * everything they need to fix. Called from `instrumentation.ts` on Node startup.
 */
export function assertServerEnv(
  env: NodeJS.ProcessEnv = process.env,
): ServerEnv {
  const parsed = serverEnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues
    .map((issue) => `${issue.path.join(".")} ${issue.message}`)
    .join("; ");

  throw new Error(
    `Invalid environment configuration: ${problems}. Set them in .env (see .env.example).`,
  );
}
