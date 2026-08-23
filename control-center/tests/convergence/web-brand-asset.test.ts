import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { server, SECURITY_HEADERS } from "../../apps/web-shell/scripts/serve-prod.mjs";
import { BRAND_LOGO_FILE, BRAND_LOGO_HEIGHT, BRAND_LOGO_WIDTH } from "../../apps/web-shell/src/brand";

const app = join(dirname(fileURLToPath(import.meta.url)), "../../apps/web-shell");
const sourceAsset = join(app, "public", BRAND_LOGO_FILE);
const distAsset = join(app, "dist", BRAND_LOGO_FILE);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The CONFENGE mark only reaches an operator if three separate things hold:
 * the Vite build copies `public/` into `dist/`, serve-prod finds the file
 * instead of falling through to its index.html catch-all, and it labels the
 * bytes `image/png` rather than `application/octet-stream`. None of that is
 * observable from the rendered markup, so this drives the real production
 * server over real HTTP against a real build.
 */
test("production web serves the CONFENGE mark as image/png, byte-identical", async () => {
  if (!existsSync(distAsset)) {
    const built = spawnSync("npm", ["run", "build"], { cwd: app, encoding: "utf8" });
    assert.equal(built.status, 0, `web-shell build failed:\n${built.stdout}\n${built.stderr}`);
  }
  assert.equal(existsSync(distAsset), true, "the build did not copy the brand asset into dist/");

  assert.match(SECURITY_HEADERS["Content-Security-Policy"], /img-src 'self' data:/);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/${BRAND_LOGO_FILE}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");

    const served = Buffer.from(await response.arrayBuffer());
    assert.equal(served.subarray(0, 8).equals(PNG_SIGNATURE), true, "served bytes are not a PNG");
    assert.equal(served.readUInt32BE(16), BRAND_LOGO_WIDTH);
    assert.equal(served.readUInt32BE(20), BRAND_LOGO_HEIGHT);
    assert.equal(
      served.equals(readFileSync(sourceAsset)),
      true,
      "served mark differs from the official asset",
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve(undefined))),
    );
  }
});
