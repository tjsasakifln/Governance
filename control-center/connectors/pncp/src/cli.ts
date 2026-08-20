import { evaluatePncpFreshness } from "./evaluate.js";
import { loadThresholdsFromEnv } from "./config.js";
import type { AdapterConfig, MetricsSourceKind } from "./types.js";

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const kind = (argValue(argv, "--kind") ??
    process.env.PNCP_METRICS_KIND ??
    "health_artifact") as MetricsSourceKind;
  const config: AdapterConfig = {
    kind,
    artifactPath:
      argValue(argv, "--path") ?? process.env.PNCP_METRICS_ARTIFACT_PATH,
    httpUrl: argValue(argv, "--url") ?? process.env.PNCP_METRICS_HTTP_URL,
  };
  const evaluation = await evaluatePncpFreshness(config, loadThresholdsFromEnv());
  process.stdout.write(
    `${JSON.stringify(
      {
        serviceHealth: evaluation.serviceHealth,
        sourceObservation: evaluation.sourceObservation,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "unknown_error";
  process.stderr.write(`${JSON.stringify({ level: "error", event: "cli_failed", message })}\n`);
  process.exitCode = 1;
});
