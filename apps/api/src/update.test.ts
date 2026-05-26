import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyHivewardUpdate, getHivewardUpdateStatus, type CommandResult, type UpdateCommandRunner } from "./update";

describe("Hiveward update status", () => {
  it("reports a Git update when the fetched remote branch is ahead", async () => {
    const fixture = createPackageFixture("0.1.1");
    try {
      const runner = fakeRunner({
        "git rev-parse --show-toplevel": { stdout: fixture, stderr: "" },
        "git remote get-url origin": { stdout: "git+https://github.com/Chaunyzhang/HiveWard.git\n", stderr: "" },
        "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/main\n", stderr: "" },
        "git branch --show-current": { stdout: "main\n", stderr: "" },
        "git fetch --quiet origin main": { stdout: "", stderr: "" },
        "git rev-parse HEAD": { stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", stderr: "" },
        "git rev-parse origin/main": { stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n", stderr: "" },
        "git rev-list --left-right --count HEAD...origin/main": { stdout: "0\t2\n", stderr: "" },
        "git status --porcelain": { stdout: "", stderr: "" }
      });

      const update = await getHivewardUpdateStatus({
        repositoryRoot: fixture,
        runner,
        now: () => new Date("2026-05-26T00:00:00.000Z")
      });

      expect(update).toMatchObject({
        source: "git",
        currentVersion: "0.1.1",
        currentBranch: "main",
        remoteBranch: "main",
        updateAvailable: true,
        canApply: true,
        checkedAt: "2026-05-26T00:00:00.000Z"
      });
      expect(update.repositoryUrl).toBe("https://github.com/Chaunyzhang/HiveWard");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("falls back to npm registry metadata outside a Git checkout", async () => {
    const fixture = createPackageFixture("0.1.1");
    try {
      const update = await getHivewardUpdateStatus({
        repositoryRoot: fixture,
        runner: fakeRunner({}),
        fetcher: async () => new Response(JSON.stringify({ version: "0.1.2" }), { status: 200 }),
        now: () => new Date("2026-05-26T00:00:00.000Z")
      });

      expect(update).toMatchObject({
        source: "npm",
        currentVersion: "0.1.1",
        latestVersion: "0.1.2",
        updateAvailable: true,
        canApply: true,
        applyCommand: "npm install -g @hiveward/cli@latest"
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("does not apply a Git update when the checkout has local changes", async () => {
    const fixture = createPackageFixture("0.1.1");
    try {
      const runner = fakeRunner({
        "git rev-parse --show-toplevel": { stdout: fixture, stderr: "" },
        "git remote get-url origin": { stdout: "https://github.com/Chaunyzhang/HiveWard.git\n", stderr: "" },
        "git symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/main\n", stderr: "" },
        "git branch --show-current": { stdout: "main\n", stderr: "" },
        "git fetch --quiet origin main": { stdout: "", stderr: "" },
        "git rev-parse HEAD": { stdout: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n", stderr: "" },
        "git rev-parse origin/main": { stdout: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n", stderr: "" },
        "git rev-list --left-right --count HEAD...origin/main": { stdout: "0\t1\n", stderr: "" },
        "git status --porcelain": { stdout: " M package.json\n", stderr: "" }
      });

      const result = await applyHivewardUpdate({
        repositoryRoot: fixture,
        runner,
        now: () => new Date("2026-05-26T00:00:00.000Z")
      });

      expect(result.applied).toBe(false);
      expect(result.update.updateAvailable).toBe(true);
      expect(result.update.canApply).toBe(false);
      expect(result.output).toContain("local changes");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

function createPackageFixture(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hiveward-update-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "hiveward", version }), "utf8");
  return dir;
}

function fakeRunner(results: Record<string, CommandResult>): UpdateCommandRunner {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    const result = results[key];
    if (!result) throw new Error(`Unexpected command: ${key}`);
    return result;
  };
}
