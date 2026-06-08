import type { ModeName } from "../core/types.js";

export type RepositoryMapStatus = "generated" | "skipped" | "failed";
export type RepositoryMapStrategy = "typescript_static_mvp";
export type AnchorIntent = "generic" | "architecture" | "provider" | "repomap" | "bug" | "important-files" | "tech-debt" | "pitch" | "cli";
export type AnchorBugDomain = "repomap" | "provider" | "process-runner" | "run-controller" | "cli" | "generic";

export interface RepositoryContextSummary {
  repoMapStatus: RepositoryMapStatus;
  artifactName?: "repo-map.md";
  filesScanned?: number;
  filesIncluded?: number;
  symbolsIncluded?: number;
  truncated?: boolean;
  warnings?: number;
}

export interface RepositoryMapRecord {
  id: string;
  status: RepositoryMapStatus;
  generatedAt: string;
  root: string;
  mode: Extract<ModeName, "prep">;
  strategy: RepositoryMapStrategy;
  summary: RepositoryMapSummary;
  budget: RepositoryMapBudget;
  files: RepositoryMapFile[];
  omitted: RepositoryMapOmission;
  warnings: RepositoryMapWarning[];
  artifactName: "repo-map.md";
  markdown: string;
}

export interface RepositoryMapSummary {
  filesDiscovered: number;
  filesScanned: number;
  filesIncluded: number;
  filesIgnored: number;
  symbolsExtracted: number;
  symbolsIncluded: number;
  importsExtracted: number;
  exportsExtracted: number;
}

export interface RepositoryMapBudget {
  maxChars: number;
  renderedChars: number;
  truncated: boolean;
}

export interface RepositoryMapFile {
  path: string;
  rank: number;
  rankReasons: string[];
  imports: RepositoryMapImport[];
  exports: RepositoryMapExport[];
  symbols: RepositoryMapSymbol[];
}

export interface RepositoryMapSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "const" | "method";
  line: number;
  exported: boolean;
  topLevel?: boolean;
  signature?: string;
}

export interface RepositoryMapImport {
  source: string;
  resolvedPath?: string;
  names: string[];
  isRelative: boolean;
}

export interface RepositoryMapExport {
  name: string;
  kind: "named" | "default" | "reexport";
  source?: string;
}

export interface RepositoryMapOmission {
  filesOmitted: number;
  symbolsOmitted: number;
  reason: "budget" | "unsupported_file_type" | "parse_error" | "ignored";
}

export interface RepositoryMapWarning {
  code: string;
  message: string;
  path?: string;
}

export interface RepositoryContextPrompt {
  kind: "repo_map";
  markdown: string;
  artifactName: "repo-map.md";
}
