#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    fail(`Unable to run Git: ${result.error.message}`);
  }

  if (!allowFailure && result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    fail(detail || `git ${args.join(" ")} exited with status ${result.status}`);
  }

  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function fail(message) {
  console.error(`GitHub sync check failed: ${message}`);
  process.exit(1);
}

const workTree = runGit(["rev-parse", "--is-inside-work-tree"]).stdout;
if (workTree !== "true") {
  fail("The current directory is not inside a Git working tree.");
}

const branchResult = runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], {
  allowFailure: true,
});
if (branchResult.status !== 0 || !branchResult.stdout) {
  fail("HEAD is detached. Switch to a named branch before publishing work.");
}

const branch = branchResult.stdout;
const originResult = runGit(["remote", "get-url", "origin"], {
  allowFailure: true,
});
if (originResult.status !== 0 || !originResult.stdout) {
  fail("No origin remote is configured.");
}
if (!/(?:^|[@/:])github\.com[/:]/i.test(originResult.stdout)) {
  fail("The origin remote does not point to GitHub.");
}

const status = runGit(["status", "--porcelain=v1"]).stdout;
if (status) {
  fail(`The working tree is not clean:\n${status}`);
}

const localHead = runGit(["rev-parse", "HEAD"]).stdout;
const remoteResult = runGit(
  ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`],
  { allowFailure: true },
);

if (remoteResult.status !== 0 && remoteResult.status !== 2) {
  const detail = remoteResult.stderr || "Git returned no diagnostic output.";
  fail(`Unable to query GitHub for origin/${branch}: ${detail}`);
}

if (!remoteResult.stdout) {
  fail(
    `GitHub has no verifiable origin/${branch} branch. Push it with ` +
      `git push -u origin ${branch}.`,
  );
}

const remoteHead = remoteResult.stdout.split(/\s+/)[0];
if (remoteHead !== localHead) {
  fail(
    `Local ${branch} (${localHead.slice(0, 7)}) does not match GitHub ` +
      `(${remoteHead.slice(0, 7)}). Push or reconcile the branch first.`,
  );
}

console.log(
  `GitHub sync verified: ${branch}@${localHead.slice(0, 7)} matches origin.`,
);
