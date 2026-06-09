import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AnchorBugDomain,
  AnchorIntent,
  RepositoryMapExport,
  RepositoryMapFile,
  RepositoryMapImport,
  RepositoryMapRecord,
  RepositoryMapSymbol,
  RepositoryMapWarning
} from "./types.js";
import { isoNow } from "../utils/time.js";

const execFileAsync = promisify(execFile);
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
const EXTENSIONLESS_IMPORT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"] as const;
const EXTENSIONLESS_IMPORT_INDEX_CANDIDATES = ["index.ts", "index.tsx", "index.js"] as const;
const DEFAULT_MAX_CHARS = 6000;
const MIN_RANKED_MAP_CHARS_WITH_ANCHORS = 700;
const MAX_FILE_BYTES = 250000;
const MAX_SYMBOLS_PER_FILE = 12;
const MAX_METHODS_PER_CLASS = 8;
const IMPORTANT_PATH_PARTS = ["src/core", "src/cli", "src/agents", "src/ledger"];
const PROMPT_STOPWORDS = new Set([
  "file",
  "files",
  "repository",
  "repo",
  "analyze",
  "analysis",
  "inspect",
  "project",
  "code",
  "source",
  "context",
  "run",
  "result",
  "output",
  "command",
  "task",
  "mode",
  "src",
  "app"
]);
const TEST_INTENT_TOKENS = new Set(["test", "tests", "testing", "validation", "validate", "coverage", "review", "spec"]);
const IMPORTANT_FILES_EVIDENCE = [
  {
    path: "src/core/run-controller.ts",
    summary: "orchestrates run lifecycle, mode decision, provider execution, RepoMap, and ledger writes."
  },
  {
    path: "src/agents/provider-adapters.ts",
    summary: "provider-backed adapter implementations, prompt construction, and provider output handling."
  },
  {
    path: "src/repository-map/repository-map.ts",
    summary: "repository context map generation and prompt-aware anchors for Prep instant."
  },
  {
    path: "src/ledger/filesystem-ledger.ts",
    summary: "local run ledger persistence, result artifacts, events, and readable run records."
  },
  {
    path: "src/cli/index.ts",
    summary: "CLI executable entrypoint, Commander program factory, and top-level command registration."
  }
] as const;
const TECH_DEBT_EVIDENCE = [
  {
    area: "Run orchestration",
    pair: "src/core/run-controller.ts + tests/run-controller.test.ts",
    lens: "lifecycle, branching, context, ledger effects."
  },
  {
    area: "Provider execution",
    pair: "src/agents/provider-adapters.ts + tests/provider-adapters.test.ts",
    lens: "flags, timeout, streams, prompt contracts."
  },
  {
    area: "Process runner",
    pair: "src/agents/process-runner.ts + tests/process-runner.test.ts",
    lens: "stdio, timeout, stdout/stderr decoding, cleanup."
  },
  {
    area: "Repository map",
    pair: "src/repository-map/repository-map.ts + tests/repository-map.test.ts",
    lens: "budget, anchors."
  },
  {
    area: "CLI surface",
    pair: "src/cli/index.ts / src/cli/commands/run.ts + tests/cli-smoke.test.ts",
    lens: "aliases, option parity, npm link entrypoint."
  },
  {
    area: "Ledger persistence",
    pair: "src/ledger/filesystem-ledger.ts + tests/run-controller.test.ts",
    lens: "artifact growth, result persistence, schema drift, backward compatibility."
  }
] as const;
const RUN_COMMAND_EVIDENCE = [
  {
    path: "src/cli/commands/run.ts",
    summary: "run options, mode shortcuts, adapter defaults, fast/instant flags, validation, approval, and progress output."
  },
  {
    path: "src/cli/index.ts",
    summary: "CLI executable entrypoint, Commander program factory, and top-level command registration."
  },
  {
    path: "src/core/run-controller.ts",
    summary: "run id, ledger path, mode decision, RepoMap generation, adapter execution, and run summary."
  },
  {
    path: "src/agents/provider-adapters.ts",
    summary: "mock and provider-backed execution, prompt construction, output parsing, and provider metadata."
  },
  {
    path: "src/ledger/filesystem-ledger.ts",
    summary: "local run/result/provider/repo-map/events/artifact persistence for inspection."
  }
] as const;

export interface GenerateRepositoryMapInput {
  root: string;
  prompt: string;
  maxChars?: number;
  contextAnchors?: boolean;
  contextAnchorIntent?: AnchorIntent;
  contextAnchorBugDomain?: AnchorBugDomain;
  contextAnchorCliBugSubtype?: AnchorCliBugSubtype;
  anchorMaxChars?: number;
}

interface DiscoveredFile {
  path: string;
  ignored: boolean;
  reason?: string;
}

export type AnchorCliBugSubtype = "entrypoint" | "command";

export async function generateRepositoryMap(input: GenerateRepositoryMapInput): Promise<RepositoryMapRecord> {
  const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
  try {
    const discovered = await discoverFiles(input.root);
    const supported = discovered.filter((file) => !file.ignored);
    const warnings: RepositoryMapWarning[] = [];
    const parsedFiles: RepositoryMapFile[] = [];

    for (const file of supported) {
      const fullPath = path.join(input.root, file.path);
      try {
        const fileStat = await stat(fullPath);
        if (fileStat.size > MAX_FILE_BYTES) {
          warnings.push({ code: "file_too_large", message: "File skipped because it exceeds the RepoMap size limit.", path: file.path });
          continue;
        }
        const source = await readFile(fullPath, "utf8");
        parsedFiles.push(extractFileMap({ root: input.root, relativePath: file.path, source }));
      } catch (error) {
        warnings.push({ code: "file_parse_failed", message: error instanceof Error ? error.message : String(error), path: file.path });
      }
    }

    const ranked = rankFiles(parsedFiles, input.prompt);
    const anchors = input.contextAnchors
      ? await collectContextAnchors({
          root: input.root,
          intent: input.contextAnchorIntent ?? detectAnchorIntent(input.prompt),
          bugDomain: input.contextAnchorBugDomain ?? detectAnchorBugDomain(input.prompt),
          cliBugSubtype: input.contextAnchorCliBugSubtype ?? detectAnchorCliBugSubtype(input.prompt),
          maxChars: input.anchorMaxChars ?? 850
        })
      : "";
    const rendered = renderRepositoryMap({
      files: ranked,
      maxChars,
      anchors,
      warnings,
      filesDiscovered: discovered.length,
      filesIgnored: discovered.filter((file) => file.ignored).length
    });

    return {
      id: `repo-map-${Date.now().toString(36)}`,
      status: "generated",
      generatedAt: isoNow(),
      root: input.root,
      mode: "prep",
      strategy: "typescript_static_mvp",
      summary: {
        filesDiscovered: discovered.length,
        filesScanned: supported.length,
        filesIncluded: rendered.files.length,
        filesIgnored: discovered.filter((file) => file.ignored).length,
        symbolsExtracted: parsedFiles.reduce((sum, file) => sum + file.symbols.length, 0),
        symbolsIncluded: rendered.files.reduce((sum, file) => sum + file.symbols.length, 0),
        importsExtracted: parsedFiles.reduce((sum, file) => sum + file.imports.length, 0),
        exportsExtracted: parsedFiles.reduce((sum, file) => sum + file.exports.length, 0)
      },
      budget: {
        maxChars,
        renderedChars: rendered.markdown.length,
        truncated: rendered.truncated
      },
      files: rendered.files,
      omitted: {
        filesOmitted: Math.max(0, ranked.length - rendered.files.length),
        symbolsOmitted: Math.max(0, parsedFiles.reduce((sum, file) => sum + file.symbols.length, 0) - rendered.files.reduce((sum, file) => sum + file.symbols.length, 0)),
        reason: rendered.truncated ? "budget" : "ignored"
      },
      warnings,
      artifactName: "repo-map.md",
      markdown: rendered.markdown
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedRepositoryMap(input.root, maxChars, message);
  }
}

export function detectAnchorIntent(prompt: string): AnchorIntent {
  const normalized = normalizePromptForIntent(prompt);
  const has = (keywords: string[]) => keywords.some((keyword) => normalized.includes(normalizePromptForIntent(keyword)));
  const hasBugIntent = has(["bug", "fix", "error", "fail", "timeout", "problem", "문제", "오류", "분석"]);
  const bugDomain = detectAnchorBugDomain(prompt);
  if ((hasBugIntent && bugDomain !== "generic") || hasCliEntrypointSignal(prompt)) {
    return "bug";
  }
  const repomap = has(["repomap", "repo map", "repository context", "context map", "repository context map"]);
  if (repomap) {
    return "repomap";
  }
  if (has(["provider", "adapter", "codex", "claude", "ollama"])) {
    return "provider";
  }
  if (
    has([
      "technical debt",
      "tech debt",
      "architecture risk",
      "maintenance risk",
      "future complexity",
      "code health",
      "risk area",
      "\uae30\uc220 \ubd80\ucc44",
      "\ubd80\ucc44",
      "\ub9ac\uc2a4\ud06c",
      "\uc720\uc9c0\ubcf4\uc218",
      "\ubcf5\uc7a1\ub3c4"
    ])
  ) {
    return "tech-debt";
  }
  if (has(["architecture", "구조", "설계", "전체", "overview"])) {
    return "architecture";
  }
  if (has(["important files", "main files", "core files", "critical files", "핵심 파일", "중요한 파일", "주요 파일", "핵심 코드"])) {
    return "important-files";
  }
  if (has(["bug", "fix", "error", "fail", "timeout", "문제", "오류", "분석"])) {
    return "bug";
  }
  if (
    has([
      "run command",
      "open-kitchen run",
      "ok prep",
      "mode shortcut",
      "shortcut command",
      "run flow",
      "execution flow",
      "실행 흐름",
      "동작 방식",
      "어떻게 동작",
      "런 커맨드"
    ])
  ) {
    return "run-command";
  }
  if (has(["pitch", "소개", "한 줄", "30-second", "30 second", "discord", "공유"])) {
    return "pitch";
  }
  if (has(["cli", "command", "명령어", "entrypoint", "진입점", "run command"])) {
    return "cli";
  }
  return "generic";
}

export function detectAnchorBugDomain(prompt: string): AnchorBugDomain {
  const normalized = normalizePromptForIntent(prompt);
  const has = (keywords: string[]) => keywords.some((keyword) => normalized.includes(normalizePromptForIntent(keyword)));
  if (hasCliEntrypointSignal(prompt)) {
    return "cli";
  }
  if (has(["repomap", "repo map", "repository context", "context map", "repository context map"])) {
    return "repomap";
  }
  if (has(["provider", "adapter", "codex", "claude", "ollama"])) {
    return "provider";
  }
  if (has(["process runner", "process-runner", "process", "runner", "stdin", "stdout", "stderr", "spawn"])) {
    return "process-runner";
  }
  if (has(["run controller", "run-controller", "controller", "runcontroller"])) {
    return "run-controller";
  }
  if (has(["cli", "command", "명령어", "entrypoint", "진입점", "run command"])) {
    return "cli";
  }
  return "generic";
}

export function detectAnchorCliBugSubtype(prompt: string): AnchorCliBugSubtype {
  if (hasCliEntrypointSignal(prompt)) {
    return "entrypoint";
  }
  return "command";
}

function hasCliEntrypointSignal(prompt: string): boolean {
  const normalized = normalizePromptForIntent(prompt);
  return [
    "entrypoint",
    "진입점",
    "bin",
    "shim",
    "npm link",
    "ok --help",
    "open-kitchen --help",
    "no output",
    "무출력",
    "main guard",
    "process.argv",
    "import.meta.url"
  ].some((keyword) => normalized.includes(normalizePromptForIntent(keyword)));
}

function normalizePromptForIntent(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function failedRepositoryMap(root: string, maxChars: number, message: string): RepositoryMapRecord {
  const markdown = ["# Repository Context Map", "", "Status: failed", `Reason: ${message}`].join("\n");
  return {
    id: `repo-map-${Date.now().toString(36)}`,
    status: "failed",
    generatedAt: isoNow(),
    root,
    mode: "prep",
    strategy: "typescript_static_mvp",
    summary: {
      filesDiscovered: 0,
      filesScanned: 0,
      filesIncluded: 0,
      filesIgnored: 0,
      symbolsExtracted: 0,
      symbolsIncluded: 0,
      importsExtracted: 0,
      exportsExtracted: 0
    },
    budget: { maxChars, renderedChars: markdown.length, truncated: false },
    files: [],
    omitted: { filesOmitted: 0, symbolsOmitted: 0, reason: "parse_error" },
    warnings: [{ code: "repo_map_failed", message }],
    artifactName: "repo-map.md",
    markdown
  };
}

async function discoverFiles(root: string): Promise<DiscoveredFile[]> {
  const gitFiles = await discoverGitFiles(root);
  if (gitFiles.length > 0) {
    return gitFiles.map((file) => discoverFile(file));
  }
  const walked = await walkFiles(root);
  return walked.map((file) => discoverFile(file));
}

async function discoverGitFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, timeout: 5000 });
    return stdout.split(/\r?\n/).map(normalizePath).filter(Boolean);
  } catch {
    return [];
  }
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const relativePath = normalizePath(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      if (isIgnoredPath(relativePath)) {
        files.push(`${relativePath}/`);
        continue;
      }
      files.push(...(await walkFiles(root, fullPath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

function discoverFile(filePath: string): DiscoveredFile {
  if (isIgnoredPath(filePath) || filePath.endsWith(".d.ts") || isMinified(filePath) || !SUPPORTED_EXTENSIONS.has(path.extname(filePath))) {
    return { path: filePath, ignored: true, reason: "ignored" };
  }
  return { path: filePath, ignored: false };
}

function isIgnoredPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const parts = normalized.split("/");
  return parts.some((part) => [".git", ".open-kitchen", "node_modules", "dist", "build", "coverage", ".next", ".turbo", "out"].includes(part));
}

function isMinified(filePath: string): boolean {
  return filePath.endsWith(".min.js") || filePath.endsWith(".min.jsx");
}

function extractFileMap(input: { root: string; relativePath: string; source: string }): RepositoryMapFile {
  const maskedSource = maskNonCode(input.source);
  const lines = maskedSource.split(/\r?\n/);
  const imports = extractImports(input.root, input.relativePath, input.source);
  const exports = extractExports(maskedSource);
  const symbols = extractSymbols(lines);
  return {
    path: input.relativePath,
    rank: 0,
    rankReasons: [],
    imports,
    exports,
    symbols
  };
}

function extractImports(root: string, relativePath: string, source: string): RepositoryMapImport[] {
  const imports: RepositoryMapImport[] = [];
  const importRegex = /^\s*import\s+(?:type\s+)?(?:(.*?)\s+from\s+)?["']([^"']+)["']/gm;
  for (const match of source.matchAll(importRegex)) {
    const names = importNames(match[1] ?? "");
    const importSource = match[2] ?? "";
    imports.push({
      source: importSource,
      resolvedPath: importSource.startsWith(".") ? resolveRelativeImport(root, relativePath, importSource) : undefined,
      names,
      isRelative: importSource.startsWith(".")
    });
  }
  return imports;
}

function importNames(value: string): string[] {
  return value
    .replace(/[{}\n\r]/g, " ")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item && !["as", "*"].includes(item));
}

function extractExports(source: string): RepositoryMapExport[] {
  const exports: RepositoryMapExport[] = [];
  for (const match of source.matchAll(/^\s*export\s+default\s+(?:class|function)?\s*([A-Za-z_$][\w$]*)?/gm)) {
    exports.push({ name: match[1] || "default", kind: "default" });
  }
  for (const match of source.matchAll(/^\s*export\s+(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    exports.push({ name: match[1] ?? "", kind: "named" });
  }
  for (const match of source.matchAll(/^\s*export\s+\{([^}]+)\}(?:\s+from\s+["']([^"']+)["'])?/gm)) {
    const names = (match[1] ?? "").split(",").map((item) => item.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    for (const name of names) {
      exports.push({ name, kind: match[2] ? "reexport" : "named", source: match[2] });
    }
  }
  return exports.filter((item) => item.name);
}

function extractSymbols(lines: string[]): RepositoryMapSymbol[] {
  const symbols: RepositoryMapSymbol[] = [];
  let methodsForCurrentClass = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const topLevel = line.trimStart() === line;
    const exported = /\bexport\b/.test(trimmed);
    const symbol =
      matchSymbol(trimmed, index + 1, exported, topLevel, "function", /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/) ??
      matchSymbol(trimmed, index + 1, exported, topLevel, "class", /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/) ??
      matchSymbol(trimmed, index + 1, exported, topLevel, "interface", /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/) ??
      matchSymbol(trimmed, index + 1, exported, topLevel, "type", /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/) ??
      matchSymbol(trimmed, index + 1, exported, topLevel, "enum", /^(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/) ??
      matchSymbol(trimmed, index + 1, exported, topLevel, "const", /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);

    if (symbol) {
      symbols.push(symbol);
      methodsForCurrentClass = symbol.kind === "class" ? 0 : methodsForCurrentClass;
      continue;
    }

    const method = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*[:{]/.exec(trimmed);
    if (method && methodsForCurrentClass < MAX_METHODS_PER_CLASS && !["if", "for", "while", "switch", "catch", "function"].includes(method[1] ?? "")) {
      methodsForCurrentClass += 1;
      symbols.push({
        name: method[1] ?? "",
        kind: "method",
        line: index + 1,
        exported: false,
        topLevel: false,
        signature: truncateSignature(trimmed)
      });
    }
  }
  return symbols.slice(0, MAX_SYMBOLS_PER_FILE);
}

function matchSymbol(
  value: string,
  line: number,
  exported: boolean,
  topLevel: boolean,
  kind: RepositoryMapSymbol["kind"],
  pattern: RegExp
): RepositoryMapSymbol | undefined {
  const match = pattern.exec(value);
  if (!match) {
    return undefined;
  }
  return {
    name: match[1] ?? "",
    kind,
    line,
    exported,
    topLevel,
    signature: truncateSignature(value)
  };
}

function rankFiles(files: RepositoryMapFile[], prompt: string): RepositoryMapFile[] {
  const promptLower = prompt.toLowerCase();
  const promptTokens = promptTokenSet(prompt);
  const hasTestIntent = [...promptTokens].some((token) => TEST_INTENT_TOKENS.has(token));
  const importDegree = new Map<string, number>();
  for (const file of files) {
    for (const item of file.imports) {
      if (item.resolvedPath) {
        importDegree.set(item.resolvedPath, (importDegree.get(item.resolvedPath) ?? 0) + 1);
      }
    }
  }

  return files
    .map((file) => {
      const reasons: string[] = [];
      let rank = 0;
      const fileLower = file.path.toLowerCase();
      if (promptLower.includes(fileLower) || file.path.split("/").some((part) => promptLower.includes(part.toLowerCase()) && part.includes("."))) {
        rank += 40;
        reasons.push("prompt_path_match");
      }
      const symbolMatch = file.symbols.find((symbol) => isPromptBoostEligibleSymbol(symbol) && promptTokens.has(normalizeToken(symbol.name)));
      if (symbolMatch) {
        rank += 35;
        reasons.push(`prompt_symbol_match:${symbolMatch.name}`);
      }
      if (isTestFile(file.path) && !hasTestIntent) {
        rank -= 25;
        reasons.push("test_file_penalty");
      }
      if (/\b(index|main|cli|server|app)\b/i.test(path.basename(file.path))) {
        rank += 20;
        reasons.push("entrypoint_like");
      }
      if (IMPORTANT_PATH_PARTS.some((part) => file.path.startsWith(part))) {
        rank += 10;
        reasons.push("core_path");
      }
      const degree = importDegree.get(file.path) ?? 0;
      if (degree > 0) {
        rank += Math.min(30, degree * 5);
        reasons.push(`import_degree:${degree}`);
      }
      const exported = file.symbols.filter((symbol) => symbol.exported).length;
      if (exported > 0) {
        rank += Math.min(20, exported * 4);
        reasons.push(`exported_symbols:${exported}`);
      }
      return { ...file, rank, rankReasons: reasons.length > 0 ? reasons : ["included"] };
    })
    .sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path));
}

function promptTokenSet(prompt: string): Set<string> {
  return new Set(
    prompt
      .split(/[^A-Za-z0-9_$]+/)
      .map(normalizeToken)
      .filter((token) => token.length > 0 && !PROMPT_STOPWORDS.has(token))
  );
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_$]/g, "");
}

function isPromptBoostEligibleSymbol(symbol: RepositoryMapSymbol): boolean {
  return symbol.exported || (symbol.topLevel === true && ["function", "class", "interface", "type", "enum"].includes(symbol.kind));
}

function isTestFile(filePath: string): boolean {
  const normalized = normalizePath(filePath).toLowerCase();
  return (
    normalized.startsWith("tests/") ||
    normalized.startsWith("test/") ||
    normalized.includes("/__tests__/") ||
    /\.test\.[^.]+$/.test(normalized) ||
    /\.spec\.[^.]+$/.test(normalized)
  );
}

function maskNonCode(source: string): string {
  let output = "";
  let state: "code" | "single" | "double" | "template" | "line_comment" | "block_comment" = "code";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (state === "code") {
      if (char === "/" && next === "/") {
        state = "line_comment";
        output += "  ";
        index += 1;
        continue;
      }
      if (char === "/" && next === "*") {
        state = "block_comment";
        output += "  ";
        index += 1;
        continue;
      }
      if (char === "'") {
        state = "single";
        output += " ";
        continue;
      }
      if (char === "\"") {
        state = "double";
        output += " ";
        continue;
      }
      if (char === "`") {
        state = "template";
        output += " ";
        continue;
      }
      output += char;
      continue;
    }
    if (state === "line_comment") {
      if (char === "\n") {
        state = "code";
        output += "\n";
      } else {
        output += " ";
      }
      continue;
    }
    if (state === "block_comment") {
      if (char === "*" && next === "/") {
        state = "code";
        output += "  ";
        index += 1;
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if ((state === "single" && char === "'") || (state === "double" && char === "\"") || (state === "template" && char === "`")) {
      state = "code";
      output += " ";
      continue;
    }
    if (char === "\\" && (state === "single" || state === "double" || state === "template")) {
      output += " ";
      if (next) {
        output += next === "\n" ? "\n" : " ";
        index += 1;
      }
      continue;
    }
    output += char === "\n" ? "\n" : " ";
  }
  return output;
}

function renderRepositoryMap(input: {
  files: RepositoryMapFile[];
  maxChars: number;
  anchors: string;
  warnings: RepositoryMapWarning[];
  filesDiscovered: number;
  filesIgnored: number;
}): { markdown: string; files: RepositoryMapFile[]; truncated: boolean } {
  const included: RepositoryMapFile[] = [];
  const header = [
    "# Repository Context Map",
    "",
    "Status: generated",
    "Strategy: typescript_static_mvp",
    `Files discovered: ${input.filesDiscovered}`,
    `Files ignored: ${input.filesIgnored}`,
    "",
    ...(input.anchors ? ["## Context Anchors", "", fitAnchors(input.anchors, input.maxChars), ""] : []),
    "## Files",
    ""
  ];
  let markdown = header.join("\n");
  for (const file of input.files) {
    const block = renderFileBlock(file);
    const next = `${markdown}${block}`;
    const nextFooter = renderOmittedFooter(Math.max(0, input.files.length - included.length - 1));
    if (next.length + nextFooter.length > input.maxChars) {
      break;
    }
    markdown = next;
    included.push(file);
  }
  const truncated = included.length < input.files.length;
  const footer = renderOmittedFooter(Math.max(0, input.files.length - included.length));
  const finalMarkdown = preserveFooterWithinBudget(markdown, footer, input.maxChars);
  return {
    markdown: finalMarkdown,
    files: included,
    truncated
  };
}

function renderOmittedFooter(filesOmitted: number): string {
  return ["", "## Omitted", "", `Files omitted by budget: ${filesOmitted}`, ""].join("\n");
}

function preserveFooterWithinBudget(body: string, footer: string, maxChars: number): string {
  const combined = `${body}${footer}`;
  if (combined.length <= maxChars) {
    return combined;
  }
  const bodyBudget = Math.max(0, maxChars - footer.length);
  if (bodyBudget === 0) {
    return footer.slice(0, maxChars);
  }
  return `${body.slice(0, bodyBudget).trimEnd()}${footer}`;
}

function renderFileBlock(file: RepositoryMapFile): string {
  return [
    `${file.path}`,
    `Rank: ${file.rank}`,
    `Reasons: ${file.rankReasons.join(", ")}`,
    file.imports.length > 0 ? `Imports: ${file.imports.slice(0, 8).map((item) => item.resolvedPath ?? item.source).join(", ")}` : "Imports: none",
    file.exports.length > 0 ? `Exports: ${file.exports.slice(0, 8).map((item) => item.name).join(", ")}` : "Exports: none",
    "Symbols:",
    ...(file.symbols.length > 0
      ? file.symbols.map((symbol) => `- ${symbol.kind} ${symbol.name} (line ${symbol.line})${symbol.signature ? `: ${symbol.signature}` : ""}`)
      : ["- none"]),
    ""
  ].join("\n");
}

async function collectContextAnchors(input: { root: string; intent: AnchorIntent; bugDomain: AnchorBugDomain; cliBugSubtype: AnchorCliBugSubtype; maxChars: number }): Promise<string> {
  const blocks: string[] = [];
  const maxChars = input.maxChars;
  if (input.intent === "important-files") {
    const evidence = renderImportantFilesEvidenceAnchor(input.root);
    if (evidence) {
      blocks.push(truncateBlock(evidence, Math.min(850, maxChars)));
    }
  } else if (input.intent === "tech-debt") {
    const evidence = renderTechDebtEvidenceAnchor(input.root);
    if (evidence) {
      blocks.push(truncateBlock(evidence, Math.min(850, maxChars)));
    }
  } else if (input.intent === "run-command") {
    const evidence = renderRunCommandEvidenceAnchor(input.root);
    if (evidence) {
      blocks.push(truncateBlock(evidence, Math.min(850, maxChars)));
    }
  } else if (input.intent === "bug") {
    for (const candidate of bugAnchorCandidates(input.bugDomain, input.cliBugSubtype)) {
      if (remainingAnchorBudget(blocks, maxChars) <= 80) {
        break;
      }
      const source = await readOptionalText(path.join(input.root, candidate));
      if (!source) {
        continue;
      }
      const budget = Math.min(bugAnchorCapForIndex(blocks.length), remainingAnchorBudget(blocks, maxChars));
      if (budget > 80) {
        blocks.push(truncateBlock(renderBugPathAnchor(input.root, candidate, source, input.bugDomain, input.cliBugSubtype), budget));
      }
    }
  } else {
    const readme = await readOptionalText(path.join(input.root, "README.md"));
    if (readme) {
      blocks.push(truncateBlock(renderReadmeAnchor(readme), Math.min(readmeAnchorCap(input.intent), maxChars)));
    }

    const packageJson = await readOptionalText(path.join(input.root, "package.json"));
    const packageBudget = Math.max(0, Math.min(packageAnchorCap(input.intent), maxChars - blocks.join("\n\n").length));
    if (packageJson && packageBudget > 0) {
      blocks.push(truncateBlock(renderPackageAnchor(packageJson), packageBudget));
    }
  }

  for (const candidate of anchorCandidates(input.intent)) {
    if (remainingAnchorBudget(blocks, maxChars) <= 80) {
      break;
    }
    if (blocks.some((block) => block.startsWith(candidate))) {
      continue;
    }
    const source = await readOptionalText(path.join(input.root, candidate));
    if (!source) {
      continue;
    }
    const budget = Math.min(anchorCapForPath(candidate, input.intent), remainingAnchorBudget(blocks, maxChars));
    if (budget > 80) {
      blocks.push(truncateBlock(renderPathAnchor(input.root, candidate, source), budget));
    }
  }

  if (input.intent === "bug") {
    await appendShortBaselineAnchors(input.root, blocks, maxChars, input.bugDomain, input.cliBugSubtype);
  }

  return truncateBlock(blocks.filter(Boolean).join("\n\n"), maxChars);
}

function remainingAnchorBudget(blocks: string[], maxChars: number): number {
  const used = blocks.filter(Boolean).join("\n\n").length;
  return Math.max(0, maxChars - used - (blocks.length > 0 ? 2 : 0));
}

function anchorCandidates(intent: AnchorIntent): string[] {
  const generic = ["src/cli/index.ts"];
  const candidates: Record<AnchorIntent, string[]> = {
    generic,
    architecture: ["docs/ARCHITECTURE.md", "src/core/run-controller.ts", "src/core/decision-engine.ts", "src/core/policy-resolver.ts", "src/cli/commands/run.ts"],
    provider: ["src/agents/adapter.ts", "src/agents/provider-adapters.ts", "src/cli/commands/adapters.ts"],
    repomap: ["src/repository-map/repository-map.ts", "src/repository-map/types.ts", "tests/repository-map.test.ts", "scripts/run-repomap-eval.ps1"],
    bug: [],
    "important-files": [],
    "tech-debt": [],
    "run-command": [],
    pitch: ["README.ko.md", "docs/CLI.md", "docs/ARCHITECTURE.md", "src/cli/index.ts"],
    cli: ["src/cli/index.ts", "src/cli/commands/run.ts", "docs/CLI.md"]
  };
  return candidates[intent];
}

function renderImportantFilesEvidenceAnchor(root: string): string {
  const existing = IMPORTANT_FILES_EVIDENCE.filter((item) => existsSync(path.join(root, item.path)));
  if (existing.length === 0) {
    return "";
  }
  return [
    "Important Files Evidence:",
    "Use these files as the supported candidates for important-files answers.",
    ...existing.map((item) => `- ${item.path}: ${item.summary}`)
  ].join("\n");
}

function renderTechDebtEvidenceAnchor(root: string): string {
  const existing = TECH_DEBT_EVIDENCE.filter((item) => evidencePairExists(root, item.pair));
  if (existing.length === 0) {
    return "";
  }
  return [
    "Technical Debt Evidence:",
    "Use pairs as evidence; no confirmed debt without support.",
    ...existing.map((item) => `- ${item.area}: ${item.pair}. Lens: ${item.lens}`)
  ].join("\n");
}

function renderRunCommandEvidenceAnchor(root: string): string {
  const existing = RUN_COMMAND_EVIDENCE.filter((item) => existsSync(path.join(root, item.path)));
  if (existing.length === 0) {
    return "";
  }
  return [
    "Run Command Evidence:",
    "Use these files as evidence for run/shortcut execution flow. Do not invent execution steps; mark conditional behavior as conditional.",
    ...existing.map((item) => `- ${item.path}: ${item.summary}`)
  ].join("\n");
}

function evidencePairExists(root: string, pair: string): boolean {
  return pair
    .split(/\s+\+\s+|\s+\/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .some((item) => existsSync(path.join(root, item)));
}

function bugAnchorCandidates(domain: AnchorBugDomain, cliBugSubtype: AnchorCliBugSubtype): string[] {
  const candidates: Record<AnchorBugDomain, string[]> = {
    repomap: ["tests/repository-map.test.ts", "src/repository-map/repository-map.ts", "src/repository-map/types.ts"],
    provider: ["tests/provider-adapters.test.ts", "src/agents/provider-adapters.ts", "src/agents/adapter.ts"],
    "process-runner": ["tests/process-runner.test.ts", "src/agents/process-runner.ts", "src/agents/provider-command.ts"],
    "run-controller": ["tests/run-controller.test.ts", "src/core/run-controller.ts", "src/core/types.ts"],
    cli:
      cliBugSubtype === "entrypoint"
        ? ["src/cli/index.ts", "package.json", "tests/cli-smoke.test.ts"]
        : ["src/cli/commands/run.ts", "tests/cli-smoke.test.ts", "src/cli/index.ts"],
    generic: ["tests/run-controller.test.ts", "src/core/run-controller.ts", "src/agents/process-runner.ts"]
  };
  return candidates[domain];
}

async function appendShortBaselineAnchors(
  root: string,
  blocks: string[],
  maxChars: number,
  bugDomain: AnchorBugDomain,
  cliBugSubtype: AnchorCliBugSubtype
): Promise<void> {
  const packageJson = await readOptionalText(path.join(root, "package.json"));
  const packageBudget = Math.min(120, remainingAnchorBudget(blocks, maxChars));
  if (packageJson && packageBudget > 80 && !hasAnchorBlock(blocks, "package.json")) {
    blocks.push(truncateBlock(renderPackageAnchor(packageJson), packageBudget));
  }
  if (bugDomain === "cli" && cliBugSubtype === "entrypoint") {
    return;
  }
  const readme = await readOptionalText(path.join(root, "README.md"));
  const readmeBudget = Math.min(160, remainingAnchorBudget(blocks, maxChars));
  if (readme && readmeBudget > 80 && !hasAnchorBlock(blocks, "README.md")) {
    blocks.push(truncateBlock(renderReadmeAnchor(readme), readmeBudget));
  }
}

function hasAnchorBlock(blocks: string[], anchorPath: string): boolean {
  return blocks.some((block) => block.startsWith(anchorPath));
}

function bugAnchorCapForIndex(index: number): number {
  if (index === 0 || index === 1) {
    return 260;
  }
  return 160;
}

function readmeAnchorCap(intent: AnchorIntent): number {
  return intent === "pitch" ? 260 : 420;
}

function packageAnchorCap(intent: AnchorIntent): number {
  return intent === "pitch" ? 160 : 230;
}

function anchorCapForPath(filePath: string, intent: AnchorIntent): number {
  if (filePath === "src/cli/index.ts") {
    return 180;
  }
  if (filePath.endsWith(".md")) {
    return intent === "pitch" ? 150 : 220;
  }
  if (filePath.endsWith(".json")) {
    return 230;
  }
  return 190;
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function renderReadmeAnchor(source: string): string {
  const lines = source.split(/\r?\n/);
  const title = lines.find((line) => /^#\s+/.test(line.trim()))?.trim();
  const paragraphs = source
    .split(/\r?\n\s*\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith("#") && item.length <= 600)
    .slice(0, 1);
  const headings = lines
    .map((line) => line.trim())
    .filter((line) => /^#{1,3}\s+/.test(line))
    .slice(0, 5);

  return [
    "README.md",
    ...(title ? [`Title: ${title.replace(/^#\s+/, "")}`] : []),
    ...(paragraphs.length > 0 ? ["Excerpt:", ...paragraphs.map((item) => `- ${collapseWhitespace(item)}`)] : []),
    ...(headings.length > 0 ? [`Headings: ${headings.map((item) => item.replace(/^#+\s+/, "")).join(", ")}`] : [])
  ].join("\n");
}

function renderPackageAnchor(source: string): string {
  try {
    const pkg = JSON.parse(source) as Record<string, unknown>;
    return [
      "package.json",
      ...(typeof pkg.name === "string" ? [`Name: ${pkg.name}`] : []),
      ...(typeof pkg.version === "string" ? [`Version: ${pkg.version}`] : []),
      ...(typeof pkg.type === "string" ? [`Type: ${pkg.type}`] : []),
      objectSummary("Bin", pkg.bin),
      objectKeysSummary("Scripts", pkg.scripts),
      objectKeysSummary("Dependencies", pkg.dependencies, 5),
      objectKeysSummary("Dev dependencies", pkg.devDependencies, 5)
    ].filter(Boolean).join("\n");
  } catch {
    return "package.json\nSummary: package manifest could not be parsed.";
  }
}

function renderPackageBinAnchor(source: string): string {
  try {
    const pkg = JSON.parse(source) as Record<string, unknown>;
    return [
      "package.json",
      ...(typeof pkg.type === "string" ? [`Type: ${pkg.type}`] : []),
      binMappingSummary(pkg.bin)
    ].filter(Boolean).join("\n");
  } catch {
    return "package.json\nSummary: package manifest could not be parsed.";
  }
}

function renderBugPathAnchor(
  root: string,
  relativePath: string,
  source: string,
  bugDomain: AnchorBugDomain,
  cliBugSubtype: AnchorCliBugSubtype
): string {
  if (bugDomain === "cli" && cliBugSubtype === "entrypoint" && relativePath === "src/cli/index.ts") {
    return renderCliEntrypointBugAnchor();
  }
  if (bugDomain === "cli" && cliBugSubtype === "entrypoint" && relativePath === "package.json") {
    return renderPackageBinAnchor(source);
  }
  if (bugDomain === "cli" && relativePath === "tests/cli-smoke.test.ts") {
    return renderCliSmokeTestAnchor(source);
  }
  return renderPathAnchor(root, relativePath, source);
}

function renderCliEntrypointBugAnchor(): string {
  return [
    "src/cli/index.ts",
    "Purpose: CLI ESM entrypoint and Commander program factory.",
    "Guard: realpath(fileURLToPath(import.meta.url)) === realpath(process.argv[1]).",
    "Runs: createProgram().parseAsync(process.argv) only when guard matches.",
    "Risk: npm link, Windows shim, symlink, or dist/source path mismatch can make guard false and print nothing."
  ].join("\n");
}

function renderCliSmokeTestAnchor(_source: string): string {
  return [
    "tests/cli-smoke.test.ts",
    "Covers: help output, bin aliases, npm-linked executable behavior, mode shortcuts.",
    "Bug instruction: Give 2-3 likely hypotheses only. Do not claim a confirmed root cause unless evidence is present."
  ].join("\n");
}

function renderPathAnchor(root: string, relativePath: string, source: string): string {
  if (relativePath === "README.md") {
    return renderReadmeAnchor(source);
  }
  if (relativePath === "package.json") {
    return renderPackageAnchor(source);
  }
  if (relativePath.endsWith(".md")) {
    return renderMarkdownAnchor(relativePath, source);
  }
  return renderCodeLikeAnchor(root, relativePath, source);
}

function renderMarkdownAnchor(relativePath: string, source: string): string {
  const lines = source.split(/\r?\n/);
  const title = lines.find((line) => /^#\s+/.test(line.trim()))?.trim();
  const headings = lines
    .map((line) => line.trim())
    .filter((line) => /^#{1,3}\s+/.test(line))
    .slice(0, 6)
    .map((line) => line.replace(/^#+\s+/, ""));
  const excerpt = source
    .split(/\r?\n\s*\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#") && item.length <= 500);
  return [
    relativePath,
    ...(title ? [`Title: ${title.replace(/^#\s+/, "")}`] : []),
    ...(headings.length > 0 ? [`Headings: ${headings.join(", ")}`] : []),
    ...(excerpt ? [`Excerpt: ${collapseWhitespace(excerpt)}`] : [])
  ].join("\n");
}

function renderCodeLikeAnchor(root: string, relativePath: string, source: string): string {
  if (SUPPORTED_EXTENSIONS.has(path.extname(relativePath))) {
    return renderCliAnchor(root, relativePath, source);
  }
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#") || /^#\s*\./.test(line))
    .slice(0, 4);
  return [relativePath, lines.length > 0 ? `Lines: ${lines.map(collapseWhitespace).join(" | ")}` : "Summary: non-TypeScript support file"].join("\n");
}

function renderCliAnchor(root: string, relativePath: string, source: string): string {
  const file = extractFileMap({ root, relativePath, source });
  const importKinds = file.imports.map((item) => item.resolvedPath?.split("/").slice(0, 2).join("/") ?? item.source).slice(0, 4);
  return [
    relativePath,
    file.exports.length > 0 ? `Exports: ${file.exports.slice(0, 4).map((item) => item.name).join(", ")}` : "Exports: none",
    file.symbols.length > 0 ? `Symbols: ${file.symbols.slice(0, 5).map((symbol) => symbol.name).join(", ")}` : "Symbols: none",
    importKinds.length > 0 ? `Imports: ${importKinds.join(", ")}` : "Imports: none"
  ].join("\n");
}

function objectSummary(label: string, value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  return `${label}: ${JSON.stringify(value)}`;
}

function binMappingSummary(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, target]) => typeof target === "string")
    .map(([name, target]) => `${name} -> ${target}`);
  return entries.length > 0 ? `Bin: ${entries.join("; ")}` : "";
}

function objectKeysSummary(label: string, value: unknown, limit = 12): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const keys = Object.keys(value as Record<string, unknown>).slice(0, limit);
  return keys.length > 0 ? `${label}: ${keys.join(", ")}` : "";
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

function truncateBlock(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, Math.max(0, maxChars - 16)).trimEnd() + "\n[truncated]";
}

function fitAnchors(value: string, maxChars: number): string {
  return truncateBlock(value, Math.max(0, maxChars - MIN_RANKED_MAP_CHARS_WITH_ANCHORS));
}

function resolveRelativeImport(root: string, fromPath: string, source: string): string | undefined {
  const fromDir = path.dirname(fromPath);
  const base = normalizePath(path.normalize(path.join(fromDir, source)));
  const extension = path.extname(base);
  if (SUPPORTED_EXTENSIONS.has(extension)) {
    return base;
  }
  if (extension) {
    return undefined;
  }
  const candidates = [
    ...EXTENSIONLESS_IMPORT_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONLESS_IMPORT_INDEX_CANDIDATES.map((fileName) => `${base}/${fileName}`)
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(root, candidate))) {
      return normalizePath(candidate);
    }
  }
  return `${base}.ts`;
}

function truncateSignature(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 120);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
