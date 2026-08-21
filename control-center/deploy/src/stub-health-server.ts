import { configFromEnv, startStubServer } from "./stub-server.ts";

const server = startStubServer(configFromEnv(process.env));

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
