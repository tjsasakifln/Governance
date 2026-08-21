import { initialUiState } from "./app-state.ts";
import { createLiveClockService } from "./service.ts";
import { mount } from "./ui/bind.ts";

declare global {
  interface Window {
    __CC_DIRECTIVES_UI__?: { mounted: boolean };
  }
}

function readMeta(name: string): string {
  if (typeof document === "undefined") return "";
  const el = document.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute("content")?.trim() ?? "";
}

function showFileProtocolHelp(root: HTMLElement): void {
  root.innerHTML = `
    <main class="file-protocol" role="alert">
      <h1>Memória estratégica precisa de um servidor local ou do bundle gerado</h1>
      <p>Abrir via <code>file:</code> só funciona depois de <code>npm run build</code> (script clássico, não módulo ES).</p>
      <p>No diretório <code>control-center/apps/directives-ui</code> execute:</p>
      <pre>npm install
npm run build
npm start
# http://127.0.0.1:4177/</pre>
    </main>
  `;
}

function boot(): void {
  const root = document.getElementById("app");
  if (!root) return;

  if (typeof location !== "undefined" && location.protocol === "file:") {
    const script = document.querySelector("script[src$='dist/app.js']");
    if (!script) {
      showFileProtocolHelp(root);
      return;
    }
  }

  const env = {
    CONTROL_CENTER_FOUNDER_ACTOR_ID: readMeta("cc-founder-actor-id"),
    CC_ACTOR_ID: readMeta("cc-actor-id"),
    CC_ACTOR_ROLE: readMeta("cc-actor-role"),
    CC_USE_MOCK_IDENTITY: readMeta("cc-use-mock-identity") || "0",
  };

  const contextUrl = readMeta("cc-context-url");
  const useMock = readMeta("cc-use-mock") === "1" || !contextUrl;
  if (useMock) {
    const service = createLiveClockService(env);
    mount(root, { service, ui: initialUiState(service) });
    window.__CC_DIRECTIVES_UI__ = { mounted: true };
    return;
  }
  void import("./http.ts").then(async ({ createHttpDirectiveService }) => {
    const service = await createHttpDirectiveService(contextUrl, env);
    mount(root, { service, ui: initialUiState(service) });
    window.__CC_DIRECTIVES_UI__ = { mounted: true };
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
