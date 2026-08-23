// The real production context entrypoint, started in-process so the Warmbly
// operator channel is mounted from env exactly as it is in production. Using
// the real server is the point: a bespoke bootstrap would not prove the route
// is mounted where production mounts it.
import { startServer } from "../../services/context/src/server.ts";
const { host, port } = await startServer();
console.log(JSON.stringify({ ok: true, host, port }));
