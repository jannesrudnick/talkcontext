/**
 * Self-update for a local checkout: `git pull --ff-only`, install if the lockfile
 * changed, rebuild the extension (and this server if it changed). The extension
 * then reloads itself and picks up the new build from disk.
 */
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Repo root: this file runs from <repo>/mcp/dist/update.js. */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface UpdateResult {
  before: string;
  after: string;
  updated: boolean;
  /** The server itself changed - Claude Code needs a restart to load it. */
  serverChanged: boolean;
}

async function run(command: string, args: string[]) {
  try {
    const { stdout } = await exec(command, args, { cwd: REPO, timeout: 5 * 60_000, maxBuffer: 20 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const { stderr, message } = error as { stderr?: string; message: string };
    throw new Error(`${command} ${args.join(" ")} failed: ${(stderr || message).trim().split("\n").slice(-5).join("\n")}`);
  }
}

let running: Promise<UpdateResult> | null = null;

/** One update at a time - a second click waits for the first. */
export function updateCheckout(log: (message: string) => void): Promise<UpdateResult> {
  running ??= doUpdate(log).finally(() => {
    running = null;
  });
  return running;
}

async function doUpdate(log: (message: string) => void): Promise<UpdateResult> {
  const before = await run("git", ["rev-parse", "--short", "HEAD"]);
  log(`Updating ${REPO} (${before}) …`);
  await run("git", ["pull", "--ff-only"]);
  const after = await run("git", ["rev-parse", "--short", "HEAD"]);
  const changed = before === after ? [] : (await run("git", ["diff", "--name-only", before, after])).split("\n");

  if (changed.includes("pnpm-lock.yaml")) await run("pnpm", ["install", "--frozen-lockfile"]);
  // Always build: makes sure the build on disk matches the checkout, even if it was never built.
  await run("pnpm", ["--filter", "talkcontext-extension", "build"]);
  const serverChanged = changed.some((file) => file.startsWith("mcp/"));
  if (serverChanged) await run("pnpm", ["--filter", "talkcontext-mcp", "build"]);

  log(before === after ? `Already up to date (${after}), extension rebuilt.` : `Updated ${before} → ${after}.`);
  return { before, after, updated: before !== after, serverChanged };
}
