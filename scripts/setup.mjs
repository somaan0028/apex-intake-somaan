#!/usr/bin/env node
/**
 * One-command setup for a clean clone.
 *
 * `npm run setup` has to work before `node_modules` exists, so this entry point
 * is plain Node with no imports from the project: it installs the dependencies,
 * hands off to `scripts/setup.ts` for the `.env` and database work, then builds
 * the app. Rerunning it is safe; the install is skipped when the dependencies
 * are already present (force it with `npm run setup -- --install`).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forceInstall = process.argv.slice(2).includes("--install");
const npmCli = process.env.npm_execpath;

function fail(message) {
  console.error(`[setup] ${message}`);
  process.exit(1);
}

/** Run a command and stop the setup if it fails. */
function run(command, args, label) {
  console.log(`[setup] ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) fail(`${label.replace(/…$/, "")} failed: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/**
 * Run an npm command through the npm that started this script. That keeps the
 * step portable on Windows (no `.cmd` shim or shell needed) and uses the same
 * npm version the person invoked.
 */
function runNpm(args, label) {
  if (npmCli) {
    run(process.execPath, [npmCli, ...args], label);
    return;
  }
  run(
    process.platform === "win32" ? "npm.cmd" : "npm",
    args,
    label,
  );
}

/**
 * Same as `runNpm`, but reports failure instead of stopping the setup. The
 * dependency install uses it so a failed compile can be retried another way.
 */
function tryRunNpm(args, label) {
  const command = npmCli
    ? process.execPath
    : process.platform === "win32"
      ? "npm.cmd"
      : "npm";
  const commandArgs = npmCli ? [npmCli, ...args] : args;

  console.log(`[setup] ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(
      `[setup] ${label.replace(/…$/, "")} could not start: ${result.error.message}`,
    );
    return false;
  }
  return result.status === 0;
}

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  fail(
    `Node.js 20 or newer is required (found ${process.versions.node}). Install it, then try again.`,
  );
}

const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const dependenciesReady = existsSync(tsxCli);

if (forceInstall || !dependenciesReady) {
  const hasLock = existsSync(path.join(root, "package-lock.json"));
  const installArgs = [hasLock ? "ci" : "install"];
  const installLabel = hasLock
    ? "Installing dependencies (npm ci)…"
    : "Installing dependencies (npm install)…";

  if (!tryRunNpm(installArgs, installLabel)) {
    // `better-sqlite3` ships prebuilt binaries, but npm still runs
    // `node-gyp rebuild` for it because the package has a binding.gyp. That
    // compile needs a C++ toolchain node-gyp cannot always find (Visual Studio
    // 2026 on Windows, for instance), and nothing in this project actually
    // needs building, so retry with the lifecycle scripts turned off instead
    // of sending the person off to install Build Tools.
    console.warn(
      "[setup] The dependency install failed, most likely while compiling better-sqlite3. Retrying without lifecycle scripts…",
    );
    const fallbackLabel = hasLock
      ? "Installing dependencies (npm ci --ignore-scripts)…"
      : "Installing dependencies (npm install --ignore-scripts)…";
    if (!tryRunNpm([...installArgs, "--ignore-scripts"], fallbackLabel)) {
      fail("Installing dependencies failed twice; see the npm output above.");
    }
    console.warn(
      "[setup] Installed without lifecycle scripts. Every native dependency here ships a prebuilt binary; if one still fails at runtime, install the Visual Studio \"Desktop development with C++\" workload (including a Windows SDK) and run `npm run setup -- --install`.",
    );
  }
} else {
  console.log(
    "[setup] Dependencies already installed. Run `npm run setup -- --install` to reinstall them.",
  );
}

if (!existsSync(tsxCli)) {
  fail("Dependencies are installed but tsx is missing; run `npm run setup -- --install`.");
}

run(
  process.execPath,
  [tsxCli, path.join(root, "scripts", "setup.ts")],
  "Writing .env and preparing the database…",
);

runNpm(["run", "build"], "Building the app…");

console.log(
  "[setup] Done. Start the app with `npm start` (http://localhost:8080).",
);
