import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDiskSpace } from "../src/disk-guard.ts";
import { FailClosedError } from "../src/fail-closed.ts";
import { tempDir } from "./helpers.ts";

test("disk guard fails closed on injected low free space and succeeds when space is present", () => {
  const dir = tempDir("cc-disk-");
  assert.throws(
    () =>
      assertDiskSpace({
        path: dir,
        minBytes: 1_073_741_824,
        statFn: () => ({ bavail: 0, bsize: 4096 }),
      }),
    (err: unknown) => {
      assert.ok(err instanceof FailClosedError);
      assert.match(err.message, /insufficient disk/);
      return true;
    },
  );
  assert.throws(
    () =>
      assertDiskSpace({
        path: joinMissing(),
        minBytes: 1,
      }),
    FailClosedError,
  );
  const ok = assertDiskSpace({
    path: dir,
    minBytes: 1,
    statFn: () => ({ bavail: 1024, bsize: 4096 }),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.freeBytes, 1024 * 4096);
  assert.equal(ok.path, dir);
});

function joinMissing(): string {
  return `${tempDir("cc-disk-missing-")}-does-not-exist`;
}
