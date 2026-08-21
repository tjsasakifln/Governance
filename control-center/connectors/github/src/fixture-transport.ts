import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emptyResponse } from "./http.js";
import { asArray, asRecord, parseJson, readNumber, readString } from "./json.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "./types.js";

export type FixtureRoute = {
  method?: "GET" | "HEAD";
  path: string;
  queryIncludes?: Record<string, string>;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  bodyFile?: string;
};

export type FixtureManifest = {
  repos?: string[];
  routes: FixtureRoute[];
};

export type RecordingTransport = HttpTransport & {
  requests: HttpRequest[];
};

export function createScriptedTransport(
  handler: (req: HttpRequest, index: number) => HttpResponse | Promise<HttpResponse>,
): RecordingTransport {
  const requests: HttpRequest[] = [];
  const transport: RecordingTransport = async (req) => {
    requests.push({
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
    });
    if (req.method !== "GET" && req.method !== "HEAD") {
      return emptyResponse(405, `Fixture transport rejected non-read method ${req.method}`);
    }
    return handler(req, requests.length - 1);
  };
  transport.requests = requests;
  return transport;
}

export function createManifestTransport(
  manifest: FixtureManifest,
  options: { fixtureDir?: string; defaultHeaders?: Record<string, string> } = {},
): RecordingTransport {
  return createScriptedTransport((req) => {
    const url = new URL(req.url);
    const route = manifest.routes.find((candidate) => matchRoute(candidate, req.method, url));
    if (!route) {
      return emptyResponse(404, `No fixture route for ${req.method} ${url.pathname}${url.search}`);
    }
    let body = "";
    if (route.bodyFile) {
      const base = options.fixtureDir ?? process.cwd();
      body = readFileSync(resolve(base, route.bodyFile), "utf8");
    } else if (route.body !== undefined) {
      body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    }
    return {
      status: route.status,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-limit": "5000",
        ...(options.defaultHeaders ?? {}),
        ...(route.headers ?? {}),
      },
      body,
    };
  });
}

export function loadFixtureDir(dir: string): {
  manifest: FixtureManifest;
  transport: RecordingTransport;
} {
  const manifestPath = join(dir, "manifest.json");
  const parsed = parseJson(readFileSync(manifestPath, "utf8"));
  const manifest = parseManifest(parsed);
  return {
    manifest,
    transport: createManifestTransport(manifest, { fixtureDir: dir }),
  };
}

export function parseManifest(raw: unknown): FixtureManifest {
  const rec = asRecord(raw);
  if (!rec) {
    throw new Error("Fixture manifest must be an object.");
  }
  const routesRaw = asArray(rec.routes);
  const routes: FixtureRoute[] = [];
  for (const item of routesRaw) {
    const routeRec = asRecord(item);
    if (!routeRec) {
      throw new Error("Fixture route must be an object.");
    }
    const path = readString(routeRec, "path");
    const status = readNumber(routeRec, "status");
    if (!path || status === null) {
      throw new Error("Fixture route requires path and status.");
    }
    const methodRaw = readString(routeRec, "method");
    const method = methodRaw === "HEAD" ? "HEAD" : "GET";
    const route: FixtureRoute = { path, status, method };
    const queryIncludes = asRecord(routeRec.queryIncludes);
    if (queryIncludes) {
      const q: Record<string, string> = {};
      for (const [key, value] of Object.entries(queryIncludes)) {
        if (typeof value === "string") {
          q[key] = value;
        }
      }
      route.queryIncludes = q;
    }
    const headers = asRecord(routeRec.headers);
    if (headers) {
      const h: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string") {
          h[key] = value;
        }
      }
      route.headers = h;
    }
    if (typeof routeRec.bodyFile === "string") {
      route.bodyFile = routeRec.bodyFile;
    }
    if (routeRec.body !== undefined) {
      route.body = routeRec.body;
    }
    routes.push(route);
  }
  const repos = Array.isArray(rec.repos)
    ? rec.repos.filter((item): item is string => typeof item === "string")
    : undefined;
  const manifest: FixtureManifest = { routes };
  if (repos) {
    manifest.repos = repos;
  }
  return manifest;
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function matchRoute(route: FixtureRoute, method: string, url: URL): boolean {
  const wantMethod = route.method ?? "GET";
  if (method !== wantMethod) {
    return false;
  }
  if (decodePath(url.pathname) !== decodePath(route.path)) {
    return false;
  }
  if (route.queryIncludes) {
    for (const [key, value] of Object.entries(route.queryIncludes)) {
      if (url.searchParams.get(key) !== value) {
        return false;
      }
    }
  }
  return true;
}
