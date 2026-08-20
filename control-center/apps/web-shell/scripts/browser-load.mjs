/**
 * Evaluate the shipped browser entry in a browser-like environment.
 * window is defined; the entry must not throw; globals/root mount install.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const bootUrl = pathToFileURL(join(appRoot, "src/boot.ts")).href;

const mainSrc = readFileSync(join(appRoot, "src/main.ts"), "utf8");
if (/\brequire\s*\(/.test(mainSrc) || /module\.exports/.test(mainSrc)) {
  throw new Error("browser entry uses unguarded Node require/module");
}

const { startBrowser, installShellGlobals, applyFileProtocolGuard } = await import(bootUrl);

const fileRoot = { innerHTML: "" };
const fileWin = { location: { protocol: "file:" } };
startBrowser(fileWin, { getElementById: (id) => (id === "root" ? fileRoot : null) });
if (!fileRoot.innerHTML.includes("npm run dev") || !fileRoot.innerHTML.includes("npm run preview")) {
  throw new Error("file: guard did not install serve instructions");
}

const httpWin = { location: { protocol: "http:" } };
const globals = installShellGlobals(httpWin);
if (!httpWin.__CONFENGE_CONTROL_CENTER__) {
  throw new Error("expected globals on window");
}
if (globals.destinations.length !== 8) {
  throw new Error("expected eight destinations");
}

const skipped = applyFileProtocolGuard({ protocol: "https:" }, { innerHTML: "" });
if (skipped !== false) {
  throw new Error("https should not trip the file: guard");
}

console.log("browser-load ok");
console.log(`globals.version=${globals.version}`);
console.log(`globals.destinations=${globals.destinations.join(",")}`);
console.log(`globals.primarySurface=${globals.primarySurface}`);
console.log("file-protocol-guard=installed");
console.log("require-unguarded=false");
