#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createAgentLedger } from "./ledger.js";
import { frozenClock } from "./clock.js";
import { serializeCanonical } from "./serialize.js";
import { FIXTURE_DAY, seedSyntheticDay } from "./fixtures.js";

/**
 * Local CLI for founder queries against the in-process fixture ledger.
 * Not a production server. Persistence remains the in-memory adapter.
 */
function main(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      date: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(usage());
    return;
  }

  const command = positionals[0];
  const clock = frozenClock(new Date("2026-08-20T16:00:00.000Z"));
  const ledger = createAgentLedger({ now: clock });
  seedSyntheticDay(ledger);

  if (command === "timeline") {
    const query = values.from && values.to
      ? { from: values.from, to: values.to }
      : { date: values.date ?? FIXTURE_DAY };
    const items = ledger.timeline(query);
    process.stdout.write(`${serializeCanonical(items)}\n`);
    return;
  }

  if (command === "last") {
    const query = values.from && values.to
      ? { from: values.from, to: values.to }
      : values.date
        ? { date: values.date }
        : { date: FIXTURE_DAY };
    const item = ledger.lastActivity(query);
    process.stdout.write(`${serializeCanonical(item)}\n`);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

function usage(): string {
  return `agent-activity — Confenge Control Center execution ledger (local)

Commands:
  timeline [--date YYYY-MM-DD] [--from ISO --to ISO]
  last     [--date YYYY-MM-DD] [--from ISO --to ISO]

"Hoje" is an explicit UTC date/window. Default fixture day: ${FIXTURE_DAY}.
Internal timestamps are UTC. Presentation MAY use America/Sao_Paulo.

This CLI seeds the in-process synthetic day. It does not open Postgres,
call MCP, or mutate Warmbly/Asaas/GitHub.
`;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "cli failed";
  process.stderr.write(`${JSON.stringify({ event: "cli_error", message })}\n`);
  process.exitCode = 1;
}
