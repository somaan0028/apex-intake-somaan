/**
 * RBAC barrel.
 *
 * Import from `@/lib/rbac` for both the capability grants (`can`,
 * `ROLE_PERMISSIONS`) and the resource-aware policies (`canEditLead`, …). The
 * module is client-safe; server-side enforcement lives in `lib/auth/authorize.ts`.
 */
export * from "./permissions";
export * from "./policy";
