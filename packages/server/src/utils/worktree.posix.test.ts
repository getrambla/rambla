// POSIX-only: git worktree and teardown shell fixtures
/* eslint-disable max-nested-callbacks */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createWorktree as createWorktreePrimitive,
  deriveWorktreeProjectHash,
  deleteRamblaWorktree,
  InvalidGitBranchNameError,
  getScriptConfigs,
  getWorktreeSetupCommands,
  getWorktreeTerminalSpecs,
  getWorktreeTeardownCommands,
  isServiceScript,
  isRamblaOwnedWorktreeCwd,
  listRamblaWorktrees,
  readRamblaConfig,
  resolveWorktreeRuntimeEnv,
  type WorktreeSetupCommandProgressEvent,
  runWorktreeSetupCommands,
  type CreateWorktreeOptions,
  type WorktreeConfig,
} from "./worktree";
import type { RamblaConfig } from "@getrambla/protocol/rambla-config-schema";
import { getRamblaWorktreeMetadataPath, readRamblaWorktreeMetadata } from "./worktree-metadata.js";
import {
  getCheckoutDiff,
  getCheckoutStatus,
  listCheckoutCommits,
  mergeFromBase,
  mergeToBase,
} from "./checkout-git.js";
import { execFileSync } from "child_process";
import { isPlatform } from "../test-utils/platform.js";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  realpathSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
} from "fs";
import { delimiter, dirname, join } from "path";
import { tmpdir } from "os";
import net from "node:net";

function loadConfigForTest(repoRoot: string): RamblaConfig | null {
  const result = readRamblaConfig(repoRoot);
  return result.ok ? result.config : null;
}

interface LegacyCreateWorktreeTestOptions {
  branchName: string;
  cwd: string;
  baseBranch: string;
  worktreeSlug: string;
  runSetup?: boolean;
  ramblaHome?: string;
  worktreesRoot?: string;
}

function createLegacyWorktreeForTest(
  options: CreateWorktreeOptions | LegacyCreateWorktreeTestOptions,
): Promise<WorktreeConfig> {
  if ("source" in options) {
    return createWorktreePrimitive(options);
  }

  return createWorktreePrimitive({
    cwd: options.cwd,
    worktreeSlug: options.worktreeSlug,
    source: {
      kind: "branch-off",
      baseBranch: options.baseBranch,
      branchName: options.branchName,
    },
    runSetup: options.runSetup ?? true,
    ramblaHome: options.ramblaHome,
    worktreesRoot: options.worktreesRoot,
  });
}

describe.skipIf(isPlatform("win32"))("worktree POSIX-only", () => {
  describe("createWorktree", () => {
    let tempDir: string;
    let repoDir: string;
    let ramblaHome: string;

    beforeEach(() => {
      // Use realpathSync to resolve symlinks (e.g., /var -> /private/var on macOS)
      tempDir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-test-")));
      repoDir = join(tempDir, "test-repo");
      ramblaHome = join(tempDir, "rambla-home");

      // Create a git repo with an initial commit
      mkdirSync(repoDir, { recursive: true });
      execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
      writeFileSync(join(repoDir, "file.txt"), "hello\n");
      execFileSync("git", ["add", "."], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
        cwd: repoDir,
      });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("creates a worktree for the current branch (main)", async () => {
      const projectHash = await deriveWorktreeProjectHash(repoDir);
      const result = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "hello-world",
        ramblaHome,
      });

      expect(result.worktreePath).toBe(join(ramblaHome, "worktrees", projectHash, "hello-world"));
      expect(existsSync(result.worktreePath)).toBe(true);
      expect(existsSync(join(result.worktreePath, "file.txt"))).toBe(true);
      const metadataPath = getRamblaWorktreeMetadataPath(result.worktreePath);
      expect(existsSync(metadataPath)).toBe(true);
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      expect(metadata).toMatchObject({
        version: 1,
        baseRefName: "main",
        changeRequestLookupTarget: { headRef: "hello-world", localBranchName: "hello-world" },
      });
    });

    it("creates and owns worktrees under a configured root", async () => {
      const worktreesRoot = join(tempDir, "custom-worktrees");
      const projectHash = await deriveWorktreeProjectHash(repoDir);
      const result = await createLegacyWorktreeForTest({
        branchName: "custom-root",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "custom-root",
        ramblaHome,
        worktreesRoot,
      });

      expect(result.worktreePath).toBe(join(worktreesRoot, projectHash, "custom-root"));
      await expect(
        isRamblaOwnedWorktreeCwd(result.worktreePath, { ramblaHome, worktreesRoot }),
      ).resolves.toMatchObject({ allowed: true, worktreeRoot: join(worktreesRoot, projectHash) });
      await expect(
        isRamblaOwnedWorktreeCwd(result.worktreePath, { ramblaHome }),
      ).resolves.toMatchObject({ allowed: false });

      const worktrees = await listRamblaWorktrees({ cwd: repoDir, ramblaHome, worktreesRoot });
      expect(worktrees.map((entry) => entry.path)).toContain(result.worktreePath);

      await deleteRamblaWorktree({
        cwd: repoDir,
        worktreePath: result.worktreePath,
        ramblaHome,
        worktreesBaseRoot: worktreesRoot,
      });
      expect(existsSync(result.worktreePath)).toBe(false);
    });

    it.skip("detects rambla-owned worktrees across realpath differences (macOS /var vs /private/var)", async () => {
      // Intentionally create repo using the non-realpath tmpdir() variant (often /var/... on macOS).
      const varTempDir = mkdtempSync(join(tmpdir(), "worktree-realpath-test-"));
      const privateTempDir = realpathSync(varTempDir);
      const varRepoDir = join(varTempDir, "test-repo");
      const varRamblaHome = join(varTempDir, "rambla-home");
      mkdirSync(varRepoDir, { recursive: true });
      execFileSync("git", ["init", "-b", "main"], { cwd: varRepoDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: varRepoDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: varRepoDir });
      writeFileSync(join(varRepoDir, "file.txt"), "hello\n");
      execFileSync("git", ["add", "."], { cwd: varRepoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
        cwd: varRepoDir,
      });

      await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: varRepoDir,
        baseBranch: "main",
        worktreeSlug: "realpath-test",
        ramblaHome: varRamblaHome,
      });

      const projectHash = await deriveWorktreeProjectHash(varRepoDir);
      const privateWorktreePath = join(
        privateTempDir,
        "rambla-home",
        "worktrees",
        projectHash,
        "realpath-test",
      );
      expect(existsSync(privateWorktreePath)).toBe(true);

      const ownership = await isRamblaOwnedWorktreeCwd(privateWorktreePath, {
        ramblaHome: varRamblaHome,
      });
      expect(ownership.allowed).toBe(true);

      rmSync(varTempDir, { recursive: true, force: true });
    });

    it("reports repoRoot as the repository root for rambla-owned worktrees", async () => {
      const result = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "repo-root-check",
        ramblaHome,
      });

      const ownership = await isRamblaOwnedWorktreeCwd(result.worktreePath, { ramblaHome });
      expect(ownership.allowed).toBe(true);
      expect(ownership.repoRoot).toBe(repoDir);
    });

    it("treats non-git directories as non-worktrees without throwing", async () => {
      const nonGitDir = join(tempDir, "not-a-repo");
      mkdirSync(nonGitDir, { recursive: true });

      const ownership = await isRamblaOwnedWorktreeCwd(nonGitDir, { ramblaHome });

      expect(ownership.allowed).toBe(false);
      expect(ownership.worktreePath).toBe(realpathSync(nonGitDir));
    });

    it("creates a worktree with a new branch", async () => {
      const projectHash = await deriveWorktreeProjectHash(repoDir);
      const result = await createLegacyWorktreeForTest({
        cwd: repoDir,
        worktreeSlug: "my-feature",
        source: { kind: "branch-off", baseBranch: "main", branchName: "feature/x" },
        runSetup: true,
        ramblaHome,
      });

      expect(result.worktreePath).toBe(join(ramblaHome, "worktrees", projectHash, "my-feature"));
      expect(existsSync(result.worktreePath)).toBe(true);

      const currentBranch = execFileSync("git", ["branch", "--show-current"], {
        cwd: result.worktreePath,
      })
        .toString()
        .trim();
      expect(currentBranch).toBe("feature/x");
      execFileSync("git", ["merge-base", "--is-ancestor", "main", "HEAD"], {
        cwd: result.worktreePath,
      });

      const metadataPath = getRamblaWorktreeMetadataPath(result.worktreePath);
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      expect(metadata).toMatchObject({
        version: 1,
        baseRefName: "main",
        changeRequestLookupTarget: { headRef: "feature/x", localBranchName: "feature/x" },
      });
    });

    it("checks out an existing local branch that is not checked out elsewhere", async () => {
      execFileSync("git", ["branch", "dev"], { cwd: repoDir });

      const result = await createLegacyWorktreeForTest({
        cwd: repoDir,
        worktreeSlug: "dev-worktree",
        source: { kind: "checkout-branch", branchName: "dev" },
        runSetup: true,
        ramblaHome,
      });

      expect(existsSync(result.worktreePath)).toBe(true);
      const currentBranch = execFileSync("git", ["branch", "--show-current"], {
        cwd: result.worktreePath,
      })
        .toString()
        .trim();
      expect(currentBranch).toBe("dev");

      const metadataPath = getRamblaWorktreeMetadataPath(result.worktreePath);
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      expect(metadata).toMatchObject({
        version: 1,
        baseRefName: "dev",
        changeRequestLookupTarget: { headRef: "dev", localBranchName: "dev" },
      });
    });

    it("checks out an existing local branch whose name contains uppercase letters and dots", async () => {
      execFileSync("git", ["branch", "release/1.1.15"], { cwd: repoDir });

      const result = await createLegacyWorktreeForTest({
        cwd: repoDir,
        worktreeSlug: "release-worktree",
        source: { kind: "checkout-branch", branchName: "release/1.1.15" },
        runSetup: true,
        ramblaHome,
      });

      expect(existsSync(result.worktreePath)).toBe(true);
      const currentBranch = execFileSync("git", ["branch", "--show-current"], {
        cwd: result.worktreePath,
      })
        .toString()
        .trim();
      expect(currentBranch).toBe("release/1.1.15");
    });

    it("creates a suffixed branch when checking out a branch already checked out in the main repo", async () => {
      const result = await createLegacyWorktreeForTest({
        cwd: repoDir,
        worktreeSlug: "dev-worktree",
        source: { kind: "checkout-branch", branchName: "main" },
        runSetup: true,
        ramblaHome,
      });

      expect(result.branchName).toBe("main-1");
      expect(existsSync(result.worktreePath)).toBe(true);
      expect(readRamblaWorktreeMetadata(result.worktreePath)?.changeRequestLookupTarget).toEqual({
        headRef: "main-1",
        localBranchName: "main-1",
      });
    });

    it("fetches a GitHub PR branch, checks it out, writes metadata, and runs setup", async () => {
      const remoteDir = join(tempDir, "remote.git");
      const remoteCloneDir = join(tempDir, "remote-clone");
      execFileSync("git", ["clone", "--bare", repoDir, remoteDir]);
      execFileSync("git", ["remote", "add", "origin", remoteDir], { cwd: repoDir });

      execFileSync("git", ["clone", remoteDir, remoteCloneDir]);
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: remoteCloneDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: remoteCloneDir });
      execFileSync("git", ["checkout", "-b", "contributor/feature"], { cwd: remoteCloneDir });
      writeFileSync(join(remoteCloneDir, "file.txt"), "from-pr\n");
      writeFileSync(
        join(remoteCloneDir, "rambla.json"),
        JSON.stringify({ worktree: { setup: ['echo "setup ran" > setup.log'] } }),
      );
      execFileSync("git", ["add", "."], { cwd: remoteCloneDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "pr branch"], {
        cwd: remoteCloneDir,
      });
      const prHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: remoteCloneDir })
        .toString()
        .trim();
      execFileSync("git", ["push", "origin", "contributor/feature"], { cwd: remoteCloneDir });
      execFileSync("git", [`--git-dir=${remoteDir}`, "update-ref", "refs/pull/42/head", prHead]);

      const result = await createLegacyWorktreeForTest({
        cwd: repoDir,
        worktreeSlug: "pr-42",
        source: {
          kind: "checkout-github-pr",
          githubPrNumber: 42,
          headRef: "user/feature",
          baseRefName: "main",
        },
        runSetup: true,
        ramblaHome,
      });

      expect(readFileSync(join(result.worktreePath, "file.txt"), "utf8")).toBe("from-pr\n");
      expect(readFileSync(join(result.worktreePath, "setup.log"), "utf8")).toBe("setup ran\n");
      const currentBranch = execFileSync("git", ["branch", "--show-current"], {
        cwd: result.worktreePath,
      })
        .toString()
        .trim();
      expect(currentBranch).toBe("user/feature");

      const metadataPath = getRamblaWorktreeMetadataPath(result.worktreePath);
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      expect(metadata).toMatchObject({ baseRefName: "main" });
    });

    it("fetches a GitHub PR branch when the head ref contains uppercase letters and dots", async () => {
      const remoteDir = join(tempDir, "remote.git");
      const remoteCloneDir = join(tempDir, "remote-clone");
      execFileSync("git", ["clone", "--bare", repoDir, remoteDir]);
      execFileSync("git", ["remote", "add", "origin", remoteDir], { cwd: repoDir });

      execFileSync("git", ["clone", remoteDir, remoteCloneDir]);
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: remoteCloneDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: remoteCloneDir });
      execFileSync("git", ["checkout", "-b", "Feature.X"], { cwd: remoteCloneDir });
      writeFileSync(join(remoteCloneDir, "file.txt"), "from-uppercase-pr\n");
      execFileSync("git", ["add", "file.txt"], { cwd: remoteCloneDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "uppercase pr branch"], {
        cwd: remoteCloneDir,
      });
      const prHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: remoteCloneDir })
        .toString()
        .trim();
      execFileSync("git", ["push", "origin", "Feature.X"], { cwd: remoteCloneDir });
      execFileSync("git", [`--git-dir=${remoteDir}`, "update-ref", "refs/pull/43/head", prHead]);

      const result = await createLegacyWorktreeForTest({
        cwd: repoDir,
        worktreeSlug: "pr-43",
        source: {
          kind: "checkout-github-pr",
          githubPrNumber: 43,
          headRef: "Feature.X",
          baseRefName: "main",
        },
        runSetup: true,
        ramblaHome,
      });

      expect(readFileSync(join(result.worktreePath, "file.txt"), "utf8")).toBe(
        "from-uppercase-pr\n",
      );
      const currentBranch = execFileSync("git", ["branch", "--show-current"], {
        cwd: result.worktreePath,
      })
        .toString()
        .trim();
      expect(currentBranch).toBe("Feature.X");
    });

    it("uses the selected local or origin ref when both exist", async () => {
      const remoteDir = join(tempDir, "remote.git");
      const remoteCloneDir = join(tempDir, "remote-clone");
      execFileSync("git", ["init", "--bare", remoteDir]);
      execFileSync("git", ["remote", "add", "origin", remoteDir], { cwd: repoDir });
      execFileSync("git", ["push", "-u", "origin", "main"], { cwd: repoDir });

      execFileSync("git", ["clone", remoteDir, remoteCloneDir]);
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: remoteCloneDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: remoteCloneDir });
      execFileSync("git", ["checkout", "-B", "main", "origin/main"], { cwd: remoteCloneDir });
      writeFileSync(join(remoteCloneDir, "file.txt"), "from-origin\n");
      execFileSync("git", ["add", "file.txt"], { cwd: remoteCloneDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "advance origin main"], {
        cwd: remoteCloneDir,
      });
      execFileSync("git", ["push", "origin", "main"], { cwd: remoteCloneDir });

      writeFileSync(join(repoDir, "file.txt"), "from-local\n");
      execFileSync("git", ["add", "file.txt"], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "advance local main"], {
        cwd: repoDir,
      });

      execFileSync("git", ["fetch", "origin"], { cwd: repoDir });

      const localResult = await createLegacyWorktreeForTest({
        branchName: "prefer-local-feature",
        cwd: repoDir,
        baseBranch: "refs/heads/main",
        worktreeSlug: "prefer-local-feature",
        runSetup: false,
        ramblaHome,
      });
      const originResult = await createLegacyWorktreeForTest({
        branchName: "prefer-origin-feature",
        cwd: repoDir,
        baseBranch: "refs/remotes/origin/main",
        worktreeSlug: "prefer-origin-feature",
        runSetup: false,
        ramblaHome,
      });

      expect(readFileSync(join(localResult.worktreePath, "file.txt"), "utf8")).toBe("from-local\n");
      const localStatus = await getCheckoutStatus(localResult.worktreePath, { ramblaHome });
      expect(localStatus.isGit).toBe(true);
      if (!localStatus.isGit) {
        return;
      }
      expect(localStatus.aheadBehind).toEqual({ ahead: 0, behind: 0 });
      await expect(
        getCheckoutDiff(
          localResult.worktreePath,
          { mode: "base", baseRef: "main" },
          { ramblaHome },
        ),
      ).resolves.toMatchObject({ diff: "" });
      expect(readFileSync(join(originResult.worktreePath, "file.txt"), "utf8")).toBe(
        "from-origin\n",
      );
      expect(
        JSON.parse(readFileSync(getRamblaWorktreeMetadataPath(originResult.worktreePath), "utf8")),
      ).toMatchObject({ baseRefName: "main" });
    });

    it("records the branch name when the base is on a remote other than origin", async () => {
      const forkDir = join(tempDir, "fork.git");
      const forkCloneDir = join(tempDir, "fork-clone");
      execFileSync("git", ["init", "--bare", forkDir]);
      execFileSync("git", ["remote", "add", "upstream", forkDir], { cwd: repoDir });
      execFileSync("git", ["push", "-u", "upstream", "main"], { cwd: repoDir });

      execFileSync("git", ["clone", "--branch", "main", forkDir, forkCloneDir]);
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: forkCloneDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: forkCloneDir });
      writeFileSync(join(forkCloneDir, "file.txt"), "from-upstream\n");
      execFileSync("git", ["add", "file.txt"], { cwd: forkCloneDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "advance upstream main"], {
        cwd: forkCloneDir,
      });
      execFileSync("git", ["push", "origin", "main"], { cwd: forkCloneDir });
      execFileSync("git", ["fetch", "upstream"], { cwd: repoDir });
      const localMainHead = execFileSync("git", ["rev-parse", "refs/heads/main"], {
        cwd: repoDir,
      })
        .toString()
        .trim();

      const result = await createLegacyWorktreeForTest({
        branchName: "fork-base-feature",
        cwd: repoDir,
        baseBranch: "refs/remotes/upstream/main",
        worktreeSlug: "fork-base-feature",
        runSetup: false,
        ramblaHome,
      });

      expect(readFileSync(join(result.worktreePath, "file.txt"), "utf8")).toBe("from-upstream\n");
      // The display name and the exact ref are both recorded. Only the ref can resolve back
      // to the commit the worktree was cut from: "main" resolves local-first, which here is
      // a different commit than the fork's upstream.
      expect(
        JSON.parse(readFileSync(getRamblaWorktreeMetadataPath(result.worktreePath), "utf8")),
      ).toMatchObject({ baseRefName: "main", baseRef: "refs/remotes/upstream/main" });

      // An untouched child must report no work of its own. Comparing against the wrong base
      // shows the upstream-only commit as if the workspace had written it.
      const status = await getCheckoutStatus(result.worktreePath, { ramblaHome });
      expect(status.isGit).toBe(true);
      if (!status.isGit) {
        return;
      }
      // The wire keeps the display name; the exact ref above is what the comparison used,
      // which is why an untouched child reports no work of its own.
      expect(status.baseRef).toBe("main");
      expect(status.aheadBehind).toEqual({ ahead: 0, behind: 0 });
      await expect(
        getCheckoutDiff(
          result.worktreePath,
          { mode: "base", baseRef: "refs/remotes/origin/main" },
          { ramblaHome },
        ),
      ).rejects.toThrow(
        "Base ref mismatch: stored refs/remotes/upstream/main, requested refs/remotes/origin/main",
      );
      expect(
        await getCheckoutDiff(
          result.worktreePath,
          { mode: "base", baseRef: "main" },
          { ramblaHome },
        ),
      ).toMatchObject({ diff: "" });
      const history = await listCheckoutCommits({
        cwd: result.worktreePath,
        context: { ramblaHome },
      });
      expect(history.commits.every((commit) => commit.isOnBase)).toBe(true);
      await expect(
        mergeToBase(result.worktreePath, { baseRef: "main" }, { ramblaHome }),
      ).rejects.toThrow(
        "No local merge target is recorded for base ref refs/remotes/upstream/main",
      );
      expect(
        execFileSync("git", ["rev-parse", "refs/heads/main"], { cwd: repoDir }).toString().trim(),
      ).toBe(localMainHead);

      writeFileSync(join(forkCloneDir, "later.txt"), "later\n");
      execFileSync("git", ["add", "later.txt"], { cwd: forkCloneDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "advance again"], {
        cwd: forkCloneDir,
      });
      execFileSync("git", ["push", "origin", "main"], { cwd: forkCloneDir });
      execFileSync("git", ["fetch", "upstream"], { cwd: result.worktreePath });
      await mergeFromBase(result.worktreePath, { baseRef: "main" }, { ramblaHome });
      expect(readFileSync(join(result.worktreePath, "later.txt"), "utf8")).toBe("later\n");

      execFileSync("git", ["update-ref", "-d", "refs/remotes/upstream/main"], {
        cwd: result.worktreePath,
      });
      await expect(
        getCheckoutDiff(result.worktreePath, { mode: "base", baseRef: "main" }, { ramblaHome }),
      ).rejects.toThrow("Base ref not found: refs/remotes/upstream/main");
      await expect(
        mergeFromBase(result.worktreePath, { baseRef: "main" }, { ramblaHome }),
      ).rejects.toThrow("Base ref not found: refs/remotes/upstream/main");
      await expect(
        listCheckoutCommits({ cwd: result.worktreePath, context: { ramblaHome } }),
      ).rejects.toThrow("Base ref not found: refs/remotes/upstream/main");
    });

    it("records Git-valid characters in a remote base branch", async () => {
      const upstreamDir = join(tempDir, "upstream.git");
      execFileSync("git", ["init", "--bare", upstreamDir]);
      execFileSync("git", ["remote", "add", "upstream", upstreamDir], { cwd: repoDir });
      execFileSync("git", ["push", "upstream", "refs/heads/main:refs/heads/release+hotfix"], {
        cwd: repoDir,
      });
      execFileSync("git", ["fetch", "upstream"], { cwd: repoDir });

      const result = await createLegacyWorktreeForTest({
        branchName: "release-hotfix-feature",
        cwd: repoDir,
        baseBranch: "refs/remotes/upstream/release+hotfix",
        worktreeSlug: "release-hotfix-feature",
        runSetup: false,
        ramblaHome,
      });

      expect(
        JSON.parse(readFileSync(getRamblaWorktreeMetadataPath(result.worktreePath), "utf8")),
      ).toMatchObject({
        baseRefName: "release+hotfix",
        baseRef: "refs/remotes/upstream/release+hotfix",
      });
    });

    it("uses a local branch when origin/{branch} does not exist", async () => {
      writeFileSync(join(repoDir, "file.txt"), "from-local-only\n");
      execFileSync("git", ["add", "file.txt"], { cwd: repoDir });
      execFileSync(
        "git",
        ["-c", "commit.gpgsign=false", "commit", "-m", "advance local main only"],
        {
          cwd: repoDir,
        },
      );

      const result = await createLegacyWorktreeForTest({
        branchName: "prefer-local-fallback-feature",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "prefer-local-fallback-feature",
        runSetup: false,
        ramblaHome,
      });

      expect(readFileSync(join(result.worktreePath, "file.txt"), "utf8")).toBe("from-local-only\n");
    });

    it("throws when neither origin/{branch} nor local {branch} exists", async () => {
      await expect(
        createLegacyWorktreeForTest({
          branchName: "missing-base-feature",
          cwd: repoDir,
          baseBranch: "does-not-exist",
          worktreeSlug: "missing-base-feature",
          runSetup: false,
          ramblaHome,
        }),
      ).rejects.toThrow("Base branch not found: does-not-exist");
    });

    it("fails with a Git-invalid branch name", async () => {
      await expect(
        createLegacyWorktreeForTest({
          branchName: "bad..name",
          cwd: repoDir,
          baseBranch: "main",
          worktreeSlug: "test",
        }),
      ).rejects.toThrow("Git rejected ref name 'bad..name'");
    });

    it("throws a typed error when checking out an invalid existing branch name", async () => {
      let caughtError: unknown;
      try {
        await createLegacyWorktreeForTest({
          cwd: repoDir,
          worktreeSlug: "invalid-existing-branch",
          source: { kind: "checkout-branch", branchName: "bad..name" },
          runSetup: true,
          ramblaHome,
        });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(InvalidGitBranchNameError);
      expect((caughtError as InvalidGitBranchNameError).branchName).toBe("bad..name");
    });

    it("throws a typed error when checking out a ref that is valid but not a branch name", async () => {
      let caughtError: unknown;
      try {
        await createLegacyWorktreeForTest({
          cwd: repoDir,
          worktreeSlug: "invalid-option-like-branch",
          source: { kind: "checkout-branch", branchName: "-bad" },
          runSetup: true,
          ramblaHome,
        });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(InvalidGitBranchNameError);
      expect((caughtError as InvalidGitBranchNameError).branchName).toBe("-bad");
    });

    it("handles branch name collision by adding suffix", async () => {
      const projectHash = await deriveWorktreeProjectHash(repoDir);
      // Create a branch named "hello" first
      execFileSync("git", ["branch", "hello"], { cwd: repoDir });

      const result = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "hello",
        ramblaHome,
      });

      // Should create branch "hello-1" since "hello" exists
      expect(result.worktreePath).toBe(join(ramblaHome, "worktrees", projectHash, "hello"));
      expect(existsSync(result.worktreePath)).toBe(true);

      const branches = execFileSync("git", ["branch"], { cwd: repoDir }).toString();
      expect(branches).toContain("hello-1");
    });

    it("handles multiple collisions", async () => {
      // Create branches "hello" and "hello-1"
      execFileSync("git", ["branch", "hello"], { cwd: repoDir });
      execFileSync("git", ["branch", "hello-1"], { cwd: repoDir });

      const result = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "hello",
        ramblaHome,
      });

      expect(existsSync(result.worktreePath)).toBe(true);

      const branches = execFileSync("git", ["branch"], { cwd: repoDir }).toString();
      expect(branches).toContain("hello-2");
    });

    it("runs setup commands from rambla.json", async () => {
      // Create rambla.json with setup commands
      const ramblaConfig = {
        worktree: {
          setup: [
            'echo "source=$RAMBLA_SOURCE_CHECKOUT_PATH" > setup.log',
            'echo "root_alias=$RAMBLA_ROOT_PATH" >> setup.log',
            'echo "worktree=$RAMBLA_WORKTREE_PATH" >> setup.log',
            'echo "branch=$RAMBLA_BRANCH_NAME" >> setup.log',
            'echo "port=$RAMBLA_WORKTREE_PORT" >> setup.log',
          ],
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "add rambla.json"], {
        cwd: repoDir,
      });

      const result = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "setup-test",
        ramblaHome,
      });

      expect(existsSync(result.worktreePath)).toBe(true);

      // Verify setup ran and env vars were available
      const setupLog = readFileSync(join(result.worktreePath, "setup.log"), "utf8");
      expect(setupLog).toContain(`source=${repoDir}`);
      expect(setupLog).toContain(`root_alias=${repoDir}`);
      expect(setupLog).toContain(`worktree=${result.worktreePath}`);
      expect(setupLog).toContain("branch=setup-test");
      const portLine = setupLog.split("\n").find((line) => line.startsWith("port="));
      expect(portLine).toBeDefined();
      const portValue = Number(portLine?.slice("port=".length));
      expect(Number.isInteger(portValue)).toBe(true);
      expect(portValue).toBeGreaterThan(0);
    });

    it("runs string setup scripts from rambla.json as a single shell command", async () => {
      const ramblaConfig = {
        worktree: {
          setup: 'greeting="hello from string setup"\necho "$greeting" > setup.log',
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "add string setup"], {
        cwd: repoDir,
      });

      const result = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "string-setup-test",
        ramblaHome,
      });

      expect(getWorktreeSetupCommands(result.worktreePath)).toEqual([
        'greeting="hello from string setup"\necho "$greeting" > setup.log',
      ]);
      expect(readFileSync(join(result.worktreePath, "setup.log"), "utf8").trim()).toBe(
        "hello from string setup",
      );
    });

    it("runs setup commands with the daemon PATH instead of login profile PATH", async () => {
      const home = join(tempDir, "host-home");
      const binDir = join(tempDir, "daemon-bin");
      mkdirSync(home);
      mkdirSync(binDir);

      const shimPath = join(binDir, "rambla-shim");
      writeFileSync(shimPath, "#!/bin/sh\nprintf 'shim:%s\\n' \"$1\"\n");
      chmodSync(shimPath, 0o755);
      writeFileSync(join(home, ".bash_profile"), "export PATH=/usr/bin:/bin\n");
      const bashEnvPath = join(home, "bash-env");
      writeFileSync(bashEnvPath, "export PATH=/usr/bin:/bin\n");
      writeFileSync(
        join(repoDir, "rambla.json"),
        JSON.stringify({
          worktree: {
            setup: "command -v rambla-shim >/dev/null && rambla-shim ok > setup-path.log",
          },
        }),
      );

      const originalHome = process.env.HOME;
      const originalPath = process.env.PATH;
      const originalBashEnv = process.env.BASH_ENV;
      process.env.HOME = home;
      process.env.PATH = `${binDir}${delimiter}${originalPath ?? "/usr/bin:/bin"}`;
      process.env.BASH_ENV = bashEnvPath;

      try {
        await runWorktreeSetupCommands({
          worktreePath: repoDir,
          branchName: "main",
          cleanupOnFailure: false,
          runtimeEnv: {
            RAMBLA_SOURCE_CHECKOUT_PATH: repoDir,
            RAMBLA_ROOT_PATH: repoDir,
            RAMBLA_WORKTREE_PATH: repoDir,
            RAMBLA_BRANCH_NAME: "main",
            RAMBLA_WORKTREE_PORT: "12345",
          },
        });
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
        if (originalPath === undefined) {
          delete process.env.PATH;
        } else {
          process.env.PATH = originalPath;
        }
        if (originalBashEnv === undefined) {
          delete process.env.BASH_ENV;
        } else {
          process.env.BASH_ENV = originalBashEnv;
        }
      }

      expect(readFileSync(join(repoDir, "setup-path.log"), "utf8").trim()).toBe("shim:ok");
    });

    it("treats blank lifecycle strings as empty", () => {
      writeFileSync(
        join(repoDir, "rambla.json"),
        JSON.stringify({
          worktree: {
            setup: " \n\t ",
            teardown: " \n ",
          },
        }),
      );

      expect(getWorktreeSetupCommands(repoDir)).toEqual([]);
      expect(getWorktreeTeardownCommands(repoDir)).toEqual([]);
    });

    it("filters non-string and blank entries from lifecycle arrays", () => {
      writeFileSync(
        join(repoDir, "rambla.json"),
        JSON.stringify({
          worktree: {
            setup: [
              'echo "first" > setup-array.log',
              null,
              "   ",
              'echo "second" >> setup-array.log',
            ],
            teardown: [
              'echo "first" > "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown-array.log"',
              null,
              "",
              'echo "second" >> "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown-array.log"',
            ],
          },
        }),
      );

      expect(getWorktreeSetupCommands(repoDir)).toEqual([
        'echo "first" > setup-array.log',
        'echo "second" >> setup-array.log',
      ]);
      expect(getWorktreeTeardownCommands(repoDir)).toEqual([
        'echo "first" > "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown-array.log"',
        'echo "second" >> "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown-array.log"',
      ]);
    });

    it("does not run setup commands when runSetup=false", async () => {
      const ramblaConfig = {
        worktree: {
          setup: ['echo "setup ran" > setup.log'],
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "add rambla.json"], {
        cwd: repoDir,
      });

      const result = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "no-setup-test",
        runSetup: false,
        ramblaHome,
      });

      expect(existsSync(result.worktreePath)).toBe(true);
      expect(existsSync(join(result.worktreePath, "setup.log"))).toBe(false);
    });

    it("streams setup command progress events while commands are executing", async () => {
      const ramblaConfig = {
        worktree: {
          setup: ['echo "first line"; echo "second line" 1>&2'],
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "add streaming setup"], {
        cwd: repoDir,
      });

      const progressEvents: WorktreeSetupCommandProgressEvent[] = [];
      const results = await runWorktreeSetupCommands({
        worktreePath: repoDir,
        branchName: "main",
        cleanupOnFailure: false,
        onEvent: (event) => {
          progressEvents.push(event);
        },
      });

      expect(results).toHaveLength(1);
      expect(progressEvents.some((event) => event.type === "command_started")).toBe(true);
      expect(progressEvents.some((event) => event.type === "output")).toBe(true);
      expect(progressEvents.some((event) => event.type === "command_completed")).toBe(true);
    });

    it("reuses persisted worktree runtime port across resolutions", async () => {
      const result = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "runtime-env-port-reuse",
        runSetup: false,
        ramblaHome,
      });

      const first = await resolveWorktreeRuntimeEnv({
        worktreePath: result.worktreePath,
        branchName: result.branchName,
      });
      const second = await resolveWorktreeRuntimeEnv({
        worktreePath: result.worktreePath,
        branchName: result.branchName,
      });

      expect(second.RAMBLA_WORKTREE_PORT).toBe(first.RAMBLA_WORKTREE_PORT);
    });

    it("fails runtime env resolution when persisted port is in use", async () => {
      const result = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "runtime-env-port-conflict",
        runSetup: false,
        ramblaHome,
      });

      const env = await resolveWorktreeRuntimeEnv({
        worktreePath: result.worktreePath,
        branchName: result.branchName,
      });
      const port = Number(env.RAMBLA_WORKTREE_PORT);

      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, () => resolve());
      });

      await expect(
        resolveWorktreeRuntimeEnv({
          worktreePath: result.worktreePath,
          branchName: result.branchName,
        }),
      ).rejects.toThrow(`Persisted worktree port ${port} is already in use`);

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });

    it("cleans up worktree if setup command fails", async () => {
      // Create rambla.json with failing setup command
      const ramblaConfig = {
        worktree: {
          setup: ["exit 1"],
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "add rambla.json"], {
        cwd: repoDir,
      });

      const expectedWorktreePath = join(ramblaHome, "worktrees", "test-repo", "fail-test");

      await expect(
        createLegacyWorktreeForTest({
          branchName: "main",
          cwd: repoDir,
          baseBranch: "main",
          worktreeSlug: "fail-test",
          ramblaHome,
        }),
      ).rejects.toThrow("Worktree setup command failed");

      // Verify worktree was cleaned up
      expect(existsSync(expectedWorktreePath)).toBe(false);
    });

    it("reads worktree terminal specs from rambla.json with optional name", async () => {
      const ramblaConfig = {
        worktree: {
          terminals: [
            { name: "Dev Server", command: "npm run dev" },
            { command: "cd packages/app && npm run dev" },
          ],
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));

      expect(getWorktreeTerminalSpecs(repoDir)).toEqual([
        { name: "Dev Server", command: "npm run dev" },
        { command: "cd packages/app && npm run dev" },
      ]);
    });

    it("filters invalid worktree terminal specs", async () => {
      const ramblaConfig = {
        worktree: {
          terminals: [
            null,
            {},
            { name: "   ", command: "   " },
            { name: " Watch ", command: "npm run watch", cwd: "packages/app" },
            { name: 123, command: "npm run test" },
          ],
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));

      expect(getWorktreeTerminalSpecs(repoDir)).toEqual([
        { name: "Watch", command: "npm run watch" },
        { command: "npm run test" },
      ]);
    });

    it("parses omitted script type as a plain script", async () => {
      writeFileSync(
        join(repoDir, "rambla.json"),
        JSON.stringify({
          scripts: {
            typecheck: {
              command: " npm run typecheck ",
            },
          },
        }),
      );

      const scriptConfigs = getScriptConfigs(loadConfigForTest(repoDir));
      const typecheck = scriptConfigs.get("typecheck");

      expect(typecheck).toEqual({
        command: "npm run typecheck",
      });
      expect(typecheck).toBeDefined();
      expect(isServiceScript(typecheck!)).toBe(false);
    });

    it("parses service scripts and preserves optional port", async () => {
      writeFileSync(
        join(repoDir, "rambla.json"),
        JSON.stringify({
          scripts: {
            server: {
              type: "service",
              command: "npm run dev",
              port: 4321,
            },
          },
        }),
      );

      const scriptConfigs = getScriptConfigs(loadConfigForTest(repoDir));
      const server = scriptConfigs.get("server");

      expect(server).toEqual({
        type: "service",
        command: "npm run dev",
        port: 4321,
      });
      expect(server).toBeDefined();
      expect(isServiceScript(server!)).toBe(true);
    });

    it("ignores invalid script entries gracefully", async () => {
      writeFileSync(
        join(repoDir, "rambla.json"),
        JSON.stringify({
          scripts: {
            valid: {
              command: "npm run valid",
            },
            invalidType: {
              type: "worker",
              command: "npm run worker",
            },
            missingCommand: {
              type: "service",
            },
            blankCommand: {
              command: "   ",
            },
            nonObject: "npm run nope",
            invalidPort: {
              type: "service",
              command: "npm run dev",
              port: "3000",
            },
          },
        }),
      );

      expect(getScriptConfigs(loadConfigForTest(repoDir))).toEqual(
        new Map([
          ["valid", { command: "npm run valid" }],
          ["invalidType", { command: "npm run worker" }],
          ["invalidPort", { type: "service", command: "npm run dev" }],
        ]),
      );
    });

    it("seeds an uncommitted rambla.json from the main repo into a new worktree", async () => {
      writeFileSync(
        join(repoDir, "rambla.json"),
        JSON.stringify({ scripts: { dev: { command: "echo hi" } } }),
      );

      const result = await createLegacyWorktreeForTest({
        cwd: repoDir,
        worktreeSlug: "seed-uncommitted",
        source: { kind: "branch-off", baseBranch: "main", branchName: "feature/seed" },
        runSetup: false,
        ramblaHome,
      });

      const worktreeConfigPath = join(result.worktreePath, "rambla.json");
      expect(existsSync(worktreeConfigPath)).toBe(true);
      expect(JSON.parse(readFileSync(worktreeConfigPath, "utf8"))).toEqual({
        scripts: { dev: { command: "echo hi" } },
      });
    });

    it("keeps a new worktree clean when its upstream ref has a newer rambla.json", async () => {
      const remoteDir = join(tempDir, "remote.git");
      const updaterDir = join(tempDir, "updater");
      writeFileSync(
        join(repoDir, "rambla.json"),
        JSON.stringify({ worktree: { setup: "echo old" } }),
      );
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "add rambla.json"], {
        cwd: repoDir,
      });
      execFileSync("git", ["clone", "--bare", repoDir, remoteDir]);
      execFileSync("git", ["remote", "add", "origin", remoteDir], { cwd: repoDir });
      execFileSync("git", ["clone", remoteDir, updaterDir]);
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: updaterDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: updaterDir });
      writeFileSync(
        join(updaterDir, "rambla.json"),
        JSON.stringify({ worktree: { setup: "echo new" } }),
      );
      execFileSync("git", ["add", "rambla.json"], { cwd: updaterDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "update rambla.json"], {
        cwd: updaterDir,
      });
      execFileSync("git", ["push", "origin", "main"], { cwd: updaterDir });
      execFileSync("git", ["fetch", "origin"], { cwd: repoDir });

      const result = await createLegacyWorktreeForTest({
        cwd: repoDir,
        worktreeSlug: "upstream-config",
        source: {
          kind: "branch-off",
          baseBranch: "origin/main",
          branchName: "feature/upstream-config",
        },
        runSetup: false,
        ramblaHome,
      });

      const worktreeConfigPath = join(result.worktreePath, "rambla.json");
      expect(JSON.parse(readFileSync(worktreeConfigPath, "utf8"))).toEqual({
        worktree: { setup: "echo new" },
      });
      expect(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: result.worktreePath,
          encoding: "utf8",
        }),
      ).toBe("");
    });

    it("preserves a dangling rambla.json symlink from the selected ref", async () => {
      const externalConfigPath = join(tempDir, "outside-rambla.json");
      execFileSync("git", ["checkout", "-b", "symlink-config"], { cwd: repoDir });
      symlinkSync(externalConfigPath, join(repoDir, "rambla.json"));
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync(
        "git",
        ["-c", "commit.gpgsign=false", "commit", "-m", "add rambla.json symlink"],
        { cwd: repoDir },
      );
      execFileSync("git", ["checkout", "main"], { cwd: repoDir });
      writeFileSync(
        join(repoDir, "rambla.json"),
        JSON.stringify({ worktree: { setup: "echo source" } }),
      );

      const result = await createLegacyWorktreeForTest({
        cwd: repoDir,
        worktreeSlug: "symlink-config",
        source: {
          kind: "branch-off",
          baseBranch: "symlink-config",
          branchName: "feature/symlink-config",
        },
        runSetup: false,
        ramblaHome,
      });

      const worktreeConfigPath = join(result.worktreePath, "rambla.json");
      expect(lstatSync(worktreeConfigPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(worktreeConfigPath)).toBe(externalConfigPath);
      expect(existsSync(externalConfigPath)).toBe(false);
      expect(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: result.worktreePath,
          encoding: "utf8",
        }),
      ).toBe("");
    });

    it("creates a worktree without error when no rambla.json exists in the main repo", async () => {
      const result = await createLegacyWorktreeForTest({
        cwd: repoDir,
        worktreeSlug: "no-config",
        source: { kind: "branch-off", baseBranch: "main", branchName: "feature/no-config" },
        runSetup: false,
        ramblaHome,
      });

      expect(existsSync(join(result.worktreePath, "rambla.json"))).toBe(false);
    });
  });

  describe("rambla worktree manager", () => {
    let tempDir: string;
    let repoDir: string;
    let ramblaHome: string;

    beforeEach(() => {
      tempDir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-manager-test-")));
      repoDir = join(tempDir, "test-repo");
      ramblaHome = join(tempDir, "rambla-home");

      mkdirSync(repoDir, { recursive: true });
      execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
      execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
      writeFileSync(join(repoDir, "file.txt"), "hello\n");
      execFileSync("git", ["add", "."], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
        cwd: repoDir,
      });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("isolates worktree roots for repositories that share the same directory name", async () => {
      const repoA = join(tempDir, "team-a", "test-repo");
      const repoB = join(tempDir, "team-b", "test-repo");

      for (const repo of [repoA, repoB]) {
        mkdirSync(repo, { recursive: true });
        execFileSync("git", ["init", "-b", "main"], { cwd: repo });
        execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repo });
        execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
        writeFileSync(join(repo, "file.txt"), "hello\n");
        execFileSync("git", ["add", "."], { cwd: repo });
        execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
          cwd: repo,
        });
      }

      const fromRepoA = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoA,
        baseBranch: "main",
        worktreeSlug: "alpha",
        ramblaHome,
      });
      const fromRepoB = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoB,
        baseBranch: "main",
        worktreeSlug: "alpha",
        ramblaHome,
      });

      expect(dirname(fromRepoA.worktreePath)).not.toBe(dirname(fromRepoB.worktreePath));
      expect(fromRepoA.worktreePath.endsWith("alpha-1")).toBe(false);
      expect(fromRepoB.worktreePath.endsWith("alpha-1")).toBe(false);

      const repoAWorktrees = await listRamblaWorktrees({ cwd: repoA, ramblaHome });
      const repoBWorktrees = await listRamblaWorktrees({ cwd: repoB, ramblaHome });

      expect(repoAWorktrees.map((entry) => entry.path)).toEqual([fromRepoA.worktreePath]);
      expect(repoBWorktrees.map((entry) => entry.path)).toEqual([fromRepoB.worktreePath]);
    });

    it("lists and deletes rambla worktrees under ~/.rambla/worktrees/{hash}", async () => {
      const first = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "alpha",
        ramblaHome,
      });
      const second = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "beta",
        ramblaHome,
      });

      const worktrees = await listRamblaWorktrees({ cwd: repoDir, ramblaHome });
      const paths = worktrees.map((worktree) => worktree.path).sort();
      expect(paths).toEqual([first.worktreePath, second.worktreePath].sort());

      await deleteRamblaWorktree({ cwd: repoDir, worktreePath: first.worktreePath, ramblaHome });
      expect(existsSync(first.worktreePath)).toBe(false);

      const remaining = await listRamblaWorktrees({ cwd: repoDir, ramblaHome });
      expect(remaining.map((worktree) => worktree.path)).toEqual([second.worktreePath]);
    });

    it("deletes a rambla worktree even when given a subdirectory path", async () => {
      const created = await createLegacyWorktreeForTest({
        branchName: "main",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "alpha",
        ramblaHome,
      });

      const nestedDir = join(created.worktreePath, "nested", "dir");
      mkdirSync(nestedDir, { recursive: true });

      await deleteRamblaWorktree({ cwd: repoDir, worktreePath: nestedDir, ramblaHome });
      expect(existsSync(created.worktreePath)).toBe(false);

      const remaining = await listRamblaWorktrees({ cwd: repoDir, ramblaHome });
      expect(remaining.some((worktree) => worktree.path === created.worktreePath)).toBe(false);
    });

    it("runs teardown commands from rambla.json before deleting a worktree", async () => {
      const ramblaConfig = {
        worktree: {
          teardown: [
            'echo "source=$RAMBLA_SOURCE_CHECKOUT_PATH" > "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown.log"',
            'echo "root_alias=$RAMBLA_ROOT_PATH" >> "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown.log"',
            'echo "worktree=$RAMBLA_WORKTREE_PATH" >> "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown.log"',
            'echo "branch=$RAMBLA_BRANCH_NAME" >> "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown.log"',
            'echo "port=$RAMBLA_WORKTREE_PORT" >> "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown.log"',
          ],
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "add teardown commands"], {
        cwd: repoDir,
      });

      const created = await createLegacyWorktreeForTest({
        branchName: "teardown-branch",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "teardown-test",
        ramblaHome,
      });
      const runtimeEnv = await resolveWorktreeRuntimeEnv({
        worktreePath: created.worktreePath,
        branchName: created.branchName,
      });

      await deleteRamblaWorktree({ cwd: repoDir, worktreePath: created.worktreePath, ramblaHome });
      expect(existsSync(created.worktreePath)).toBe(false);

      const teardownLog = readFileSync(join(repoDir, "teardown.log"), "utf8");
      expect(teardownLog).toContain(`source=${repoDir}`);
      expect(teardownLog).toContain(`root_alias=${repoDir}`);
      expect(teardownLog).toContain(`worktree=${created.worktreePath}`);
      expect(teardownLog).toContain("branch=teardown-branch");
      expect(teardownLog).toContain(`port=${runtimeEnv.RAMBLA_WORKTREE_PORT}`);
    });

    it("runs string teardown scripts from rambla.json as a single shell command", async () => {
      const ramblaConfig = {
        worktree: {
          teardown:
            'cleanup_message="teardown string"\necho "$cleanup_message" > "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown.log"',
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "add string teardown"], {
        cwd: repoDir,
      });

      const created = await createLegacyWorktreeForTest({
        branchName: "teardown-string-branch",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "teardown-string-test",
        ramblaHome,
      });

      await deleteRamblaWorktree({ cwd: repoDir, worktreePath: created.worktreePath, ramblaHome });

      expect(getWorktreeTeardownCommands(repoDir)).toEqual([
        'cleanup_message="teardown string"\necho "$cleanup_message" > "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown.log"',
      ]);
      expect(readFileSync(join(repoDir, "teardown.log"), "utf8").trim()).toBe("teardown string");
    });

    it("omits RAMBLA_WORKTREE_PORT from teardown env when runtime metadata is missing", async () => {
      const ramblaConfig = {
        worktree: {
          teardown: [
            'echo "port=${RAMBLA_WORKTREE_PORT-unset}" > "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown-port.log"',
          ],
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync(
        "git",
        ["-c", "commit.gpgsign=false", "commit", "-m", "add teardown port logging"],
        { cwd: repoDir },
      );

      const created = await createLegacyWorktreeForTest({
        branchName: "teardown-port-missing-branch",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "teardown-port-missing-test",
        ramblaHome,
      });

      await deleteRamblaWorktree({ cwd: repoDir, worktreePath: created.worktreePath, ramblaHome });

      expect(readFileSync(join(repoDir, "teardown-port.log"), "utf8").trim()).toBe("port=unset");
      expect(existsSync(created.worktreePath)).toBe(false);
    });

    it("does not remove worktree when a teardown command fails", async () => {
      const ramblaConfig = {
        worktree: {
          teardown: [
            'echo "started" > "$RAMBLA_SOURCE_CHECKOUT_PATH/teardown-start.log"',
            "echo boom 1>&2; exit 9",
          ],
        },
      };
      writeFileSync(join(repoDir, "rambla.json"), JSON.stringify(ramblaConfig));
      execFileSync("git", ["add", "rambla.json"], { cwd: repoDir });
      execFileSync(
        "git",
        ["-c", "commit.gpgsign=false", "commit", "-m", "add failing teardown commands"],
        { cwd: repoDir },
      );

      const created = await createLegacyWorktreeForTest({
        branchName: "teardown-failure-branch",
        cwd: repoDir,
        baseBranch: "main",
        worktreeSlug: "teardown-failure-test",
        ramblaHome,
      });

      await expect(
        deleteRamblaWorktree({ cwd: repoDir, worktreePath: created.worktreePath, ramblaHome }),
      ).rejects.toThrow("Worktree teardown command failed");

      expect(existsSync(created.worktreePath)).toBe(true);
      expect(existsSync(join(repoDir, "teardown-start.log"))).toBe(true);
    });
  });
});
