import readline from "node:readline";
import type { Logger } from "./logging.js";
import type { McpRuntime } from "./server.js";

export async function serveStdio(runtime: McpRuntime, logger: Logger): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  logger.info("mcp.listen", { transport: "stdio" });
  for await (const line of rl) {
    const reply = await runtime.handleRaw(line);
    if (reply !== null) {
      process.stdout.write(`${reply}\n`);
    }
  }
}
