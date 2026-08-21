#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { injectedGit, isUsableCommitSha, liveGit } from "./git.js";
import { createControlCenterPersistPort } from "./cc-db.js";
import { importGovernance } from "./import.js";
import { createLogger, redactValue } from "./log.js";
import { DEFAULT_RELATIVE_ROOTS } from "./tree.js";
import type { GitMetadataProvider, ImportResult, PersistPort } from "./types.js";

/** Staging RC evidence. Not a bootstrap candidate-count contract. */
export const STAGING_RC_CANDIDATE_COUNT = 74;

export type CliArgs = {
  help: boolean;
  root: string | null;
  now: string | null;
  commitSha: string | null;
  out: string | null;
  persist: boolean;
  apply: boolean;
  dryRun: boolean;
  allowControlCenterDbWrite: boolean;
  relativeRoots: string[] | null;
};

export function parseArgv(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    root: null,
    now: null,
    commitSha: null,
    out: null,
    persist: false,
    apply: false,
    dryRun: false,
    allowControlCenterDbWrite: false,
    relativeRoots: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--persist") {
      args.persist = true;
      continue;
    }
    if (token === "--apply") {
      args.apply = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--allow-control-center-db-write") {
      args.allowControlCenterDbWrite = true;
      continue;
    }
    const next = argv[i + 1];
    if (token === "--root" && next) {
      args.root = next;
      i += 1;
      continue;
    }
    if (token === "--now" && next) {
      args.now = next;
      i += 1;
      continue;
    }
    if ((token === "--commit-sha" || token === "--commit_sha") && next) {
      args.commitSha = next;
      i += 1;
      continue;
    }
    if (token === "--out" && next) {
      args.out = next;
      i += 1;
      continue;
    }
    if (token === "--roots" && next) {
      args.relativeRoots = next.split(",").map((item) => item.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

export function helpText(): string {
  return `Confenge Control Center Governance bootstrap (dry-run default)

Usage:
  cc-governance-bootstrap --dry-run
  cc-governance-bootstrap --apply --allow-control-center-db-write

  npm run bootstrap -- --dry-run --root <repo-or-fixture> [--now ISO-UTC] [--commit-sha SHA] [--out report.json]
  npm run bootstrap -- --apply --allow-control-center-db-write --root <repo>

Dry-run is the default. It prints candidates and does not write origin Git,
Warmbly, Asaas, or the Control Center database.

--apply is explicit and requires --allow-control-center-db-write plus
CONTROL_CENTER_DATABASE_URL. Apply is idempotent and writes only the Control
Center database. --persist remains refused. Git and providers are never written.
PR Governance #8 / partner-program paths are reported, not absorbed.

Classification is conservative: ambiguous prose is hypothesis; decision requires
an explicit heading or JSON kind. Unclassifiable items are listed, never upgraded.
Missing commit SHA is fail-closed (unclassifiable, freshness ERROR). SHA is never fabricated.

Candidate count is recomputed from the observed tree. Staging RC observed 74
candidates; that number is evidence, not a contract. The JSON report includes
bootstrap.staging_delta explaining any difference.

Env:
  CC_GOVERNANCE_IMPORTER_ROOT         Repository or fixture root
  CC_GOVERNANCE_IMPORTER_NOW          Pin observed_at (UTC RFC3339)
  CC_GOVERNANCE_IMPORTER_COMMIT_SHA   Injected commit SHA for virtual trees
  CC_GOVERNANCE_IMPORTER_ALLOW_APPLY  Equivalent to --allow-control-center-db-write
  CONTROL_CENTER_DATABASE_URL         Postgres URL for opt-in apply
`;
}

export type CliIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  writeFile?: (path: string, body: string) => void;
};

export type CliDeps = {
  createPersist?: (env: NodeJS.Dict<string>) => PersistPort;
};

export type CliOutcome = {
  code: number;
  result?: ImportResult;
};

export async function runCli(
  argv: string[],
  env: NodeJS.Dict<string> = process.env,
  io: CliIo = {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  },
  deps: CliDeps = {},
): Promise<CliOutcome> {
  let args: CliArgs;
  try {
    args = parseArgv(argv);
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return { code: 2 };
  }

  if (args.help) {
    io.stdout(helpText());
    return { code: 0 };
  }

  if (args.persist || env.CC_GOVERNANCE_IMPORTER_ALLOW_PERSIST === "1") {
    io.stderr(
      JSON.stringify({
        event: "persist_refused",
        code: "CC_GOVERNANCE_IMPORTER_PERSIST_DISABLED",
        message: "--persist is refused; use opt-in --apply against the Control Center database only",
      }),
    );
    return { code: 2 };
  }

  const applyRequested = args.apply || env.CC_GOVERNANCE_IMPORTER_APPLY === "1";
  const applyAllowed =
    args.allowControlCenterDbWrite || env.CC_GOVERNANCE_IMPORTER_ALLOW_APPLY === "1";
  if (args.dryRun && applyRequested) {
    io.stderr(
      JSON.stringify({
        event: "apply_refused",
        code: "CC_GOVERNANCE_BOOTSTRAP_CONFLICTING_FLAGS",
        message: "conflicting --dry-run and --apply; apply is explicit and dry-run is the default",
      }),
    );
    return { code: 2 };
  }
  if (applyRequested && !applyAllowed) {
    io.stderr(
      JSON.stringify({
        event: "apply_refused",
        code: "CC_GOVERNANCE_IMPORTER_APPLY_NOT_ALLOWED",
        message:
          "--apply requires --allow-control-center-db-write (Control Center DB only; no Git or provider write)",
      }),
    );
    return { code: 2 };
  }

  const root = resolve(
    args.root ?? env.CC_GOVERNANCE_IMPORTER_ROOT ?? process.cwd(),
  );
  const nowRaw = args.now ?? env.CC_GOVERNANCE_IMPORTER_NOW ?? null;
  let now: Date;
  if (nowRaw) {
    now = new Date(nowRaw);
    if (Number.isNaN(now.getTime())) {
      io.stderr(`invalid --now: ${nowRaw}`);
      return { code: 2 };
    }
  } else {
    now = new Date();
  }

  const commitSha = args.commitSha ?? env.CC_GOVERNANCE_IMPORTER_COMMIT_SHA ?? null;
  let git: GitMetadataProvider;
  if (commitSha !== null) {
    if (!isUsableCommitSha(commitSha)) {
      io.stderr("injected commit SHA is missing or not a usable git object id");
      return { code: 2 };
    }
    git = injectedGit(commitSha);
  } else {
    git = liveGit(root);
  }

  const log = createLogger((line) => io.stderr(line), () => now);

  try {
    const persist = applyRequested
      ? (deps.createPersist ?? createControlCenterPersistPort)(env)
      : undefined;
    const result = await importGovernance({
      root,
      now,
      git,
      dryRun: !applyRequested,
      persistEnabled: applyRequested,
      persist,
      relativeRoots: args.relativeRoots ?? [...DEFAULT_RELATIVE_ROOTS],
      log,
    });
    const payload = {
      ...(redactValue(result) as ImportResult),
      bootstrap: describeBootstrap(result, applyRequested),
    };
    const body = JSON.stringify(payload, null, 2);
    io.stdout(body);
    if (args.out) {
      const outPath = resolve(args.out);
      const forbidden = isForbiddenOutPath(outPath, root);
      if (forbidden) {
        io.stderr(`refusing to write report onto origin authority path: ${forbidden}`);
        return { code: 2, result };
      }
      if (io.writeFile) {
        io.writeFile(outPath, body);
      } else {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, body, "utf8");
      }
    }
    return { code: 0, result };
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return { code: 1 };
  }
}

export function describeBootstrap(
  result: ImportResult,
  applyRequested: boolean,
): {
  command: "cc-governance-bootstrap";
  write_target: "control-center-db" | "none";
  git_write: false;
  provider_write: false;
  observed_candidate_count: number;
  staging_reference: {
    candidate_count: number;
    contract: false;
    note: string;
  };
  staging_delta: {
    candidate_count_delta: number;
    explanation: string;
    observed_commit_shas: string[];
  };
} {
  const observed = result.stats.candidate_count;
  const delta = observed - STAGING_RC_CANDIDATE_COUNT;
  const shas = [...new Set(result.candidates.map((candidate) => candidate.commit_sha))].sort();
  const explanation =
    observed === STAGING_RC_CANDIDATE_COUNT
      ? `Recomputed ${observed} candidates over ${result.repo_root} (files_scanned=${result.files_scanned}). Matches staging RC 74. 74 is staging evidence, not a contract.`
      : `Recomputed ${observed} candidates over ${result.repo_root} (files_scanned=${result.files_scanned}, by_kind=${JSON.stringify(result.stats.by_kind)}, unclassifiable=${result.stats.unclassifiable_count}). Staging RC observed 74. Delta ${delta >= 0 ? "+" : ""}${delta}. Count is derived from the current tree and conservative classifier; 74 is not a contract.`;
  return {
    command: "cc-governance-bootstrap",
    write_target: applyRequested ? "control-center-db" : "none",
    git_write: false,
    provider_write: false,
    observed_candidate_count: observed,
    staging_reference: {
      candidate_count: STAGING_RC_CANDIDATE_COUNT,
      contract: false,
      note: "Staging RC evidence from CONFENGE-CC-MCP-CLIENT-COMPATIBILITY-01. Do not treat 74 as the candidate-count contract.",
    },
    staging_delta: {
      candidate_count_delta: delta,
      explanation,
      observed_commit_shas: shas,
    },
  };
}

function isForbiddenOutPath(outPath: string, root: string): string | null {
  const resolved = resolve(outPath);
  for (const name of ["decisions", "commercial"]) {
    const prefix = resolve(root, name);
    if (resolved === prefix || resolved.startsWith(`${prefix}/`)) {
      return name;
    }
  }
  return null;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  runCli(process.argv.slice(2)).then((outcome) => {
    process.exitCode = outcome.code;
  });
}
