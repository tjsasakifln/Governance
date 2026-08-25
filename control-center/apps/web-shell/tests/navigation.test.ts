import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { DESTINATION_IDS } from "../src/destinations";
import {
  MOBILE_MORE_TASKS,
  MOBILE_PRIMARY_TASKS,
  MOBILE_TASKS,
  currentMobileTaskKey,
  renderDesktopNavigation,
  renderMobileTaskNavigation,
} from "../src/ui/navigation";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

test("mobile exposes exactly four primary destinations plus an explicit task panel", () => {
  assert.equal(MOBILE_PRIMARY_TASKS.length, 4);
  assert.equal(MOBILE_MORE_TASKS.length, 9);
  assert.deepEqual(
    MOBILE_PRIMARY_TASKS.map((task) => task.key),
    ["today", "review", "exceptions", "clients"],
  );
  assert.equal(new Set(MOBILE_TASKS.map((task) => task.key)).size, MOBILE_TASKS.length);
  assert.equal(new Set(MOBILE_TASKS.map((task) => task.path)).size, MOBILE_TASKS.length);

  const html = renderMobileTaskNavigation({ destination: "hoje", surface: null }, "ready");
  const primaryMarkup = html.split('<details class="task-nav-more"')[0] ?? "";
  assert.equal([...primaryMarkup.matchAll(/data-task-nav=/g)].length, 4);
  assert.match(html, /<details class="task-nav-more">/);
  assert.match(html, /<summary aria-label="Abrir mais tarefas"/);
  assert.match(html, />Mais tarefas</);
  assert.doesNotMatch(html, /hamburger|☰/i);
});

test("every registered destination remains reachable without swipe or hover", () => {
  const represented = new Set(MOBILE_TASKS.map((task) => task.destination));
  assert.deepEqual([...represented].sort(), [...DESTINATION_IDS].sort());

  const html = renderMobileTaskNavigation({ destination: "hoje" }, "ready");
  for (const task of MOBILE_TASKS) {
    assert.match(html, new RegExp(`data-task-nav="${task.key}"`));
    assert.match(html, new RegExp(`href="${task.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
});

test("the six named high-frequency or high-risk tasks have direct deep links", () => {
  const byKey = new Map(MOBILE_TASKS.map((task) => [task.key, task]));
  assert.equal(byKey.get("review")?.path, "#/warmbly/revisao");
  assert.equal(byKey.get("inbound")?.path, "#/crescimento");
  assert.equal(byKey.get("exceptions")?.path, "#/comercial/excecoes");
  assert.equal(byKey.get("outbound")?.path, "#/warmbly/operacao");
  assert.equal(byKey.get("clients")?.path, "#/clientes");
  assert.equal(byKey.get("infra")?.path, "#/infra");
});

test("deep routes map to one conceptual current task", () => {
  assert.equal(currentMobileTaskKey({ destination: "warmbly", surface: "revisao" }), "review");
  assert.equal(currentMobileTaskKey({ destination: "warmbly", surface: "cohorts" }), "cohorts");
  assert.equal(currentMobileTaskKey({ destination: "warmbly", surface: null }), "outbound");
  assert.equal(currentMobileTaskKey({ destination: "comercial", surface: "excecoes" }), "exceptions");
  assert.equal(currentMobileTaskKey({ destination: "comercial", surface: "pipeline" }), "commercial");
  assert.equal(currentMobileTaskKey({ destination: "clientes" }), "clients");
});

test("the current task is unique and secondary routes open the panel that contains it", () => {
  const primary = renderMobileTaskNavigation(
    { destination: "warmbly", surface: "revisao" },
    "ready",
  );
  assert.equal([...primary.matchAll(/aria-current="page"/g)].length, 1);
  assert.match(primary, /data-task-nav="review" aria-current="page"/);
  assert.doesNotMatch(primary, /<details class="task-nav-more" open>/);

  const secondary = renderMobileTaskNavigation({ destination: "financeiro" }, "ready");
  assert.equal([...secondary.matchAll(/aria-current="page"/g)].length, 1);
  assert.match(secondary, /<details class="task-nav-more" open>/);
  assert.match(secondary, /data-contains-current="true"/);
  assert.match(secondary, /data-task-nav="finance" aria-current="page"/);
});

test("mock view state survives every task link without weakening deep URLs", () => {
  const html = renderMobileTaskNavigation({ destination: "hoje" }, "error");
  assert.equal([...html.matchAll(/data-task-nav=/g)].length, MOBILE_TASKS.length);
  assert.equal([...html.matchAll(/\?view=error/g)].length, MOBILE_TASKS.length);
  assert.match(html, /href="#\/warmbly\/revisao\?view=error"/);
});

test("desktop keeps the complete registry and one current area", () => {
  const html = renderDesktopNavigation({ destination: "infra" }, "ready");
  assert.equal([...html.matchAll(/data-nav=/g)].length, DESTINATION_IDS.length);
  assert.equal([...html.matchAll(/aria-current="page"/g)].length, 1);
  assert.match(html, /data-nav="infra"[\s\S]*aria-current="page"/);
});

test("mobile task targets, contextual tabs and long labels wrap instead of scrolling sideways", () => {
  const css = readFileSync(join(rootDir, "src/styles.css"), "utf8");
  assert.doesNotMatch(css, /\.nav\s*\{[^}]*overflow-x:\s*auto/s);
  assert.doesNotMatch(css, /\.subnav\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.task-nav\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s);
  assert.match(css, /\.task-nav\s*>\s*a,[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.task-nav-label,[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.subnav a\s*\{[^}]*white-space:\s*normal/s);
  assert.match(css, /\.task-nav-more-panel\s*\{[^}]*overflow-y:\s*auto/s);
});

test("safe-area padding and vertical task panel avoid the system gesture edge", () => {
  const css = readFileSync(join(rootDir, "src/styles.css"), "utf8");
  assert.match(css, /\.task-nav\s*\{[^}]*env\(safe-area-inset-bottom\)/s);
  assert.match(css, /\.task-nav-more-panel\s*\{[^}]*bottom:\s*calc\(100%/s);
  assert.match(css, /max-height:\s*min\(65dvh,/);
  assert.doesNotMatch(css, /\.task-nav-more-panel\s*\{[^}]*overflow-x/s);
});
