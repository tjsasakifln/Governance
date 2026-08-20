import { isCompanyScope } from "./ids.js";
import {
  buildCompanyEngineeringReadModel,
  readByScope,
} from "./transform.js";
import type {
  AttentionCandidate,
  CompanyEngineeringReadModel,
  RepoExecutiveView,
  TransformOptions,
} from "./types.js";

/**
 * In-process store. Query operations a later Postgres consumer must match:
 * - ingest(collectorSnapshot)
 * - getCompany()
 * - getRepo(scope)
 * - listAttention(scope?)
 */
export class InMemoryEngineeringStore {
  private model: CompanyEngineeringReadModel | null = null;

  ingest(
    input: unknown,
    options?: TransformOptions,
  ): CompanyEngineeringReadModel {
    this.model = buildCompanyEngineeringReadModel(input, options);
    return this.model;
  }

  getCompany(): CompanyEngineeringReadModel | null {
    return this.model;
  }

  getRepo(scope: string): RepoExecutiveView | null {
    if (!this.model) {
      return null;
    }
    const read = readByScope(this.model, scope);
    return read.kind === "repo" ? read.value : null;
  }

  listAttention(scope?: string): AttentionCandidate[] {
    if (!this.model) {
      return [];
    }
    if (!scope || isCompanyScope(scope)) {
      return this.model.attention;
    }
    const repo = this.getRepo(scope);
    return repo?.attention ?? [];
  }
}

export function ingestCollectorSnapshot(
  input: unknown,
  options?: TransformOptions,
): CompanyEngineeringReadModel {
  return buildCompanyEngineeringReadModel(input, options);
}
