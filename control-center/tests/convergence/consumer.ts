/**
 * Fresh consumer of the contracts package (not the package's own tests).
 */
import { validateFile } from "@confenge/control-center-contracts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../contracts/fixtures/valid/directive.json",
);
const result = validateFile("Directive", fixture);
if (!result.ok) {
  throw new Error(`consumer expected valid, got ${JSON.stringify(result.errors)}`);
}
process.stdout.write(JSON.stringify({ ok: result.ok, type: result.type }) + "\n");
