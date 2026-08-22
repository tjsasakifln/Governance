import { looksBinary, toUtf8 } from "./hash.js";
import {
  DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  type DirectiveKind,
  type DirectiveStatus,
} from "./types.js";

export type ClassifiedRecord = {
  kind: DirectiveKind;
  title: string;
  body: string;
  status: DirectiveStatus;
  scope: string | null;
  effective_from: string | null;
  expires_at: string | null;
  supersedes: string[] | null;
  created_by_id: string | null;
  tags: string[];
};

export type FileClassification =
  | { classifiable: true; records: ClassifiedRecord[] }
  | { classifiable: false; reason: string };

const KIND_SET = new Set<string>(DIRECTIVE_KINDS);
const STATUS_SET = new Set<string>(DIRECTIVE_STATUSES);

const KIND_HEADING = new Set<string>(DIRECTIVE_KINDS);

const TITLE_MAX = 200;
const BODY_MAX = 8000;

export function classifyFile(sourcePath: string, bytes: Uint8Array): FileClassification {
  if (bytes.length === 0) {
    return { classifiable: false, reason: "empty_file" };
  }
  if (looksBinary(bytes)) {
    return { classifiable: false, reason: "binary_or_non_text" };
  }
  const text = toUtf8(bytes);
  if (text === null) {
    return { classifiable: false, reason: "not_utf8_text" };
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { classifiable: false, reason: "empty_file" };
  }

  const lowerPath = sourcePath.toLowerCase();
  if (lowerPath.endsWith(".json")) {
    return classifyJson(trimmed);
  }
  if (
    lowerPath.endsWith(".md") ||
    lowerPath.endsWith(".markdown") ||
    lowerPath.endsWith(".txt")
  ) {
    return classifyMarkdown(trimmed, sourcePath);
  }
  return { classifiable: false, reason: "unsupported_extension" };
}

function classifyJson(text: string): FileClassification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { classifiable: false, reason: "invalid_json" };
  }
  if (parsed === null || typeof parsed !== "object") {
    return { classifiable: false, reason: "json_not_object_or_array" };
  }

  if (Array.isArray(parsed)) {
    const records: ClassifiedRecord[] = [];
    for (const item of parsed) {
      const labeled = labeledJsonRecord(item);
      if (labeled) {
        records.push(labeled);
      }
    }
    if (records.length === 0) {
      return { classifiable: false, reason: "json_array_without_labeled_kind" };
    }
    return { classifiable: true, records };
  }

  const object = parsed as Record<string, unknown>;
  const self = labeledJsonRecord(object, text);
  if (self) {
    const nested = labeledChildren(object);
    return { classifiable: true, records: [self, ...nested] };
  }

  const children = labeledChildren(object);
  if (children.length > 0) {
    return { classifiable: true, records: children };
  }

  if (typeof object.schema_version === "string" && object.schema_version.length > 0) {
    return {
      classifiable: true,
      records: [
        jsonAsKind(object, "fact", "structured_authority_projection", text),
      ],
    };
  }

  if (hasProse(object)) {
    return {
      classifiable: true,
      records: [jsonAsKind(object, "hypothesis", "unlabeled_json_prose", text)],
    };
  }

  return { classifiable: false, reason: "json_without_kind_or_schema" };
}

function labeledChildren(object: Record<string, unknown>): ClassifiedRecord[] {
  const records: ClassifiedRecord[] = [];
  for (const key of ["records", "items", "directives", "candidates"]) {
    const value = object[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value) {
      const labeled = labeledJsonRecord(item);
      if (labeled) {
        records.push(labeled);
      }
    }
  }
  return records;
}

function labeledJsonRecord(value: unknown, sourceText?: string): ClassifiedRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const object = value as Record<string, unknown>;
  const kindRaw =
    typeof object.kind === "string"
      ? object.kind
      : typeof object.directive_kind === "string"
        ? object.directive_kind
        : null;
  if (kindRaw === null || !KIND_SET.has(kindRaw)) {
    return null;
  }
  return jsonAsKind(object, kindRaw as DirectiveKind, "explicit_json_kind", sourceText);
}

function jsonAsKind(
  object: Record<string, unknown>,
  kind: DirectiveKind,
  tag: string,
  sourceText?: string,
): ClassifiedRecord {
  const title = pickString(object, ["title", "name", "id", "schema_version"]) ?? kind;
  const body =
    pickString(object, ["body", "text", "description", "decision"]) ??
    (typeof sourceText === "string" && sourceText.length > 0
      ? sourceText
      : stableJsonBody(object));
  return {
    kind,
    title: clipTitle(title),
    body: clipBody(body),
    status: mapStatus(object.status) ?? "draft",
    scope: validScope(object.scope),
    effective_from:
      utcOrDate(object.effective_from) ?? utcOrDate(object.effective_at) ?? null,
    expires_at: nullableUtc(object.expires_at),
    supersedes: resourceIdList(object.supersedes),
    created_by_id: actorIdFrom(object.created_by),
    tags: uniqueTags([tag, jsonSchemaTag(object)]),
  };
}

function classifyMarkdown(text: string, sourcePath: string): FileClassification {
  const sections = splitMarkdownSections(text);
  const labeled = sections.filter((section) => section.kind !== null);
  const h1 = sections.find((section) => section.level === 1)?.heading ?? null;
  const status = parseMarkdownStatus(text);
  const date = parseMarkdownDate(text);

  if (labeled.length > 0) {
    return {
      classifiable: true,
      records: labeled.map((section) => {
        const kind = section.kind;
        if (kind === null) {
          throw new Error("labeled section missing kind");
        }
        return {
          kind,
          title: clipTitle(h1 ?? section.heading),
          body: clipBody(section.body.length > 0 ? section.body : text),
          status: status ?? "draft",
          scope: null,
          effective_from: date,
          expires_at: null,
          supersedes: null,
          created_by_id: null,
          tags: uniqueTags(["explicit_markdown_heading", fileTag(sourcePath)]),
        };
      }),
    };
  }

  return {
    classifiable: true,
    records: [
      {
        kind: "hypothesis",
        title: clipTitle(h1 ?? basename(sourcePath)),
        body: clipBody(text),
        status: "draft",
        scope: null,
        effective_from: date,
        expires_at: null,
        supersedes: null,
        created_by_id: null,
        tags: uniqueTags(["ambiguous_prose", fileTag(sourcePath)]),
      },
    ],
  };
}

type MarkdownSection = {
  heading: string;
  level: number;
  body: string;
  kind: DirectiveKind | null;
};

function splitMarkdownSections(text: string): MarkdownSection[] {
  const lines = text.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  const bodyLines: string[] = [];

  const flush = (): void => {
    if (current === null) {
      return;
    }
    current.body = bodyLines.join("\n").trim();
    sections.push(current);
    bodyLines.length = 0;
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      const hashes = match[1];
      const heading = (match[2] ?? "").trim();
      current = {
        heading,
        level: hashes?.length ?? 1,
        body: "",
        kind: headingKind(heading),
      };
      continue;
    }
    if (current === null) {
      current = { heading: "", level: 0, body: "", kind: null };
    }
    bodyLines.push(line);
  }
  flush();
  return sections;
}

function headingKind(heading: string): DirectiveKind | null {
  const normalized = heading.replace(/[:.\s]+$/g, "").trim().toLowerCase();
  return KIND_HEADING.has(normalized) ? (normalized as DirectiveKind) : null;
}

function parseMarkdownStatus(text: string): DirectiveStatus | null {
  const match =
    /\*\*Status:\*\*\s*([^\n*]+)/i.exec(text) ?? /^Status:\s*(.+)$/im.exec(text);
  if (!match) {
    return null;
  }
  return mapStatus(match[1]?.trim() ?? null);
}

function parseMarkdownDate(text: string): string | null {
  const match =
    /\*\*Date:\*\*\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i.exec(text) ??
    /^Date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/im.exec(text);
  const day = match?.[1];
  if (!day) {
    return null;
  }
  return `${day}T00:00:00Z`;
}

function mapStatus(value: unknown): DirectiveStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  const raw = value.trim().toLowerCase();
  if (STATUS_SET.has(raw)) {
    return raw as DirectiveStatus;
  }
  if (raw.startsWith("accepted") || raw === "approved" || raw === "active") {
    return "active";
  }
  if (raw === "proposed" || raw === "draft" || raw.startsWith("draft")) {
    return "draft";
  }
  if (raw.startsWith("superseded")) {
    return "superseded";
  }
  if (raw === "revoked" || raw === "withdrawn" || raw === "deprecated") {
    return "revoked";
  }
  if (raw.startsWith("expired")) {
    return "expired";
  }
  return null;
}

function validScope(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const scope = value.trim();
  if (
    /^(company|commercial|finance|clients|infrastructure|inbound|repo:[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?|client:(?!(?:anonimo|anonymous|client|cliente|default|desconhecido|na|n-a|nao-identificado|nao-informado|no-name|none|null|placeholder|sem-identidade|sem-nome|tbd|undefined|unidentified|unknown)(?:,|$))[a-z0-9]+(?:-[a-z0-9]+)*|(?!company:|commercial:|finance:|clients:|infrastructure:|inbound:|repo:|client:)[a-z][a-z0-9-]*:[A-Za-z0-9._:~-]+)$/.test(
      scope,
    )
  ) {
    return scope;
  }
  return null;
}

function utcOrDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/.test(trimmed)) {
    return trimmed;
  }
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00Z`;
  }
  return null;
}

function nullableUtc(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return utcOrDate(value);
}

function resourceIdList(value: unknown): string[] | null {
  if (value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const ids = value.filter(
    (item): item is string =>
      typeof item === "string" && /^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$/.test(item),
  );
  return ids.length > 0 ? ids : null;
}

function actorIdFrom(value: unknown): string | null {
  if (typeof value === "string" && /^[A-Za-z0-9._:@-]+$/.test(value) && value.length <= 128) {
    return value;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    if (typeof id === "string" && /^[A-Za-z0-9._:@-]+$/.test(id) && id.length <= 128) {
      return id;
    }
  }
  return null;
}

function pickString(object: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function hasProse(object: Record<string, unknown>): boolean {
  return (
    pickString(object, ["title", "body", "text", "description", "summary", "notes"]) !==
    null
  );
}

/**
 * JSON.stringify(obj, Object.keys(obj).sort(), 2) is unsafe: an array replacer
 * is applied at every nesting level, so nested objects that do not share the
 * root keys are stripped (empty consumers, offers without amount_cents).
 * Prefer original source UTF-8 when available; otherwise deep-sort keys.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      sorted[key] = sortKeysDeep(input[key]);
    }
    return sorted;
  }
  return value;
}

function stableJsonBody(object: Record<string, unknown>): string {
  try {
    return JSON.stringify(sortKeysDeep(object), null, 2);
  } catch {
    return JSON.stringify(object);
  }
}

function jsonSchemaTag(object: Record<string, unknown>): string | null {
  const version = object.schema_version;
  if (typeof version === "string" && /^[a-z0-9][a-z0-9._-]*$/i.test(version)) {
    return `schema-${version.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40)}`;
  }
  return null;
}

function uniqueTags(values: Array<string | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (value === null) {
      continue;
    }
    const tag = value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    if (tag.length === 0 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function fileTag(sourcePath: string): string {
  return sourcePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "file";
}

function basename(sourcePath: string): string {
  return sourcePath.split("/").pop() ?? sourcePath;
}

function clipTitle(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length === 0) {
    return "untitled";
  }
  if (compact.length <= TITLE_MAX) {
    return compact;
  }
  return `${compact.slice(0, TITLE_MAX - 1)}…`;
}

function clipBody(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "(empty projection; git source remains canonical)";
  }
  if (trimmed.length <= BODY_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, BODY_MAX - 48)}\n…[truncated; git source remains canonical]`;
}
