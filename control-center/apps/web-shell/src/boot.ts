import type { ControlCenterReadAdapter } from "./adapters/contract";
import { createProductionAdapter } from "./adapters/http";
import { mount, type MountableRoot } from "./app";
import { DESTINATION_IDS, PRIMARY_SURFACE } from "./destinations";
import { registeredVisualRoutes, type VisualRoute } from "./visual-matrix";

export const SHELL_VERSION = "0.1.0";
export const SHELL_GLOBAL_KEY = "__CONFENGE_CONTROL_CENTER__";

export const FILE_PROTOCOL_NOTICE_TITLE = "Control Center precisa de um servidor local";
export const FILE_PROTOCOL_DEV = "npm run dev";
export const FILE_PROTOCOL_PREVIEW = "npm run preview";

export interface ShellGlobals {
  version: string;
  destinations: readonly string[];
  visualRoutes: readonly VisualRoute[];
  primarySurface: typeof PRIMARY_SURFACE;
  mount: typeof mount;
}

export interface ShellWindow {
  location: { protocol: string };
  __CONFENGE_CONTROL_CENTER__?: ShellGlobals;
  __CC_TEST_ADAPTER__?: ControlCenterReadAdapter;
}

export function installShellGlobals(win: ShellWindow): ShellGlobals {
  const globals: ShellGlobals = {
    version: SHELL_VERSION,
    destinations: DESTINATION_IDS,
    visualRoutes: registeredVisualRoutes(),
    primarySurface: PRIMARY_SURFACE,
    mount,
  };
  win.__CONFENGE_CONTROL_CENTER__ = globals;
  return globals;
}

export function isFileProtocol(protocol: string): boolean {
  return protocol === "file:";
}

export function fileProtocolHtml(): string {
  return (
    `<main class="file-protocol" role="alert">` +
    `<h1>${FILE_PROTOCOL_NOTICE_TITLE}</h1>` +
    `<p>Abrir este arquivo via <code>file:</code> não carrega o módulo ES. ` +
    `No diretório <code>control-center/apps/web-shell</code> execute:</p>` +
    `<pre>${FILE_PROTOCOL_DEV}\n# ou\n${FILE_PROTOCOL_PREVIEW}</pre>` +
    `</main>`
  );
}

export function applyFileProtocolGuard(
  location: { protocol: string },
  root: { innerHTML: string },
): boolean {
  if (!isFileProtocol(location.protocol)) return false;
  root.innerHTML = fileProtocolHtml();
  return true;
}

export function startBrowser(
  win: ShellWindow | undefined = globalThis.window as unknown as ShellWindow | undefined,
  doc:
    | ({
        getElementById(id: string): MountableRoot | null;
        querySelector?(selector: string): { getAttribute(name: string): string | null } | null;
      } & AdapterDocument)
    | undefined = globalThis.document,
): void {
  if (win == null || doc == null) {
    return;
  }
  installShellGlobals(win);
  const root = doc.getElementById("root");
  if (!root) {
    throw new Error("Control Center shell: missing #root");
  }
  if (applyFileProtocolGuard(win.location, root)) {
    return;
  }
  void resolveBrowserAdapter(win, doc).then((adapter) => {
    mount(root, adapter);
  });
}

export interface AdapterDocument {
  querySelector?(selector: string): { getAttribute(name: string): string | null } | null;
}

export interface AdapterWindow {
  __CC_TEST_ADAPTER__?: ControlCenterReadAdapter;
}

/**
 * Mock is selected only by explicit injection (window.__CC_TEST_ADAPTER__ or
 * meta cc-use-mock=1). Production boot constructs HttpControlCenterAdapter.
 */
export async function resolveBrowserAdapter(
  win: AdapterWindow | undefined,
  doc: AdapterDocument | undefined,
): Promise<ControlCenterReadAdapter> {
  if (win?.__CC_TEST_ADAPTER__) {
    return win.__CC_TEST_ADAPTER__;
  }
  const mockMeta = doc?.querySelector?.('meta[name="cc-use-mock"]')?.getAttribute("content") === "1";
  if (mockMeta) {
    const { createMockAdapter } = await import("./adapters/mock");
    return createMockAdapter();
  }
  return createProductionAdapter();
}
