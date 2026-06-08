import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateRepositoryMap } from "../src/repository-map/repository-map.js";

describe("Repository Context Map", () => {
  it("extracts TypeScript symbols, imports, exports, and respects ignored directories", async () => {
    const root = await fixtureRoot();
    await writeFile(
      path.join(root, "src", "core", "run-controller.ts"),
      [
        'import { FilesystemLedger } from "../ledger/filesystem-ledger.js";',
        "export interface RunRequest { prompt: string }",
        "export type RunStatus = 'completed' | 'failed';",
        "export class RunController {",
        "  async run(request: RunRequest): Promise<void> { return; }",
        "}",
        "export function createRun(): RunController { return new RunController(); }",
        "export const DEFAULT_TIMEOUT_MS = 300000;"
      ].join("\n"),
      "utf8"
    );
    await writeFile(path.join(root, "src", "ledger", "filesystem-ledger.ts"), "export class FilesystemLedger {}\n", "utf8");
    await writeFile(path.join(root, "node_modules", "ignored.ts"), "export function ignored() {}\n", "utf8");

    const repoMap = await generateRepositoryMap({ root, prompt: "inspect RunController", maxChars: 4000 });
    const file = repoMap.files.find((item) => item.path === "src/core/run-controller.ts");

    expect(repoMap.status).toBe("generated");
    expect(repoMap.summary.filesIgnored).toBeGreaterThan(0);
    expect(file?.rankReasons).toEqual(expect.arrayContaining(["prompt_symbol_match:RunController"]));
    expect(file?.imports[0]).toEqual(expect.objectContaining({ source: "../ledger/filesystem-ledger.js", isRelative: true }));
    expect(file?.exports.map((item) => item.name)).toEqual(expect.arrayContaining(["RunRequest", "RunStatus", "RunController", "createRun", "DEFAULT_TIMEOUT_MS"]));
    expect(file?.symbols.map((item) => item.name)).toEqual(expect.arrayContaining(["RunRequest", "RunStatus", "RunController", "run", "createRun", "DEFAULT_TIMEOUT_MS"]));
  });

  it("resolves extensionless relative imports to existing source files for import-degree ranking", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src", "ui", "widget"), { recursive: true });
    await writeFile(
      path.join(root, "src", "core", "consumer.ts"),
      [
        'import { FilesystemLedger } from "../ledger/filesystem-ledger";',
        'import { makeWidget } from "../ui/widget";',
        "export function consume(): FilesystemLedger { return new FilesystemLedger(); }",
        "export function widget() { return makeWidget(); }"
      ].join("\n"),
      "utf8"
    );
    await writeFile(path.join(root, "src", "ledger", "filesystem-ledger.ts"), "export class FilesystemLedger {}\n", "utf8");
    await writeFile(path.join(root, "src", "ui", "widget", "index.ts"), "export function makeWidget() { return true; }\n", "utf8");

    const repoMap = await generateRepositoryMap({ root, prompt: "inspect consumer", maxChars: 4000 });
    const consumer = repoMap.files.find((item) => item.path === "src/core/consumer.ts");
    const ledger = repoMap.files.find((item) => item.path === "src/ledger/filesystem-ledger.ts");
    const widget = repoMap.files.find((item) => item.path === "src/ui/widget/index.ts");

    expect(consumer?.imports.map((item) => item.resolvedPath)).toEqual(
      expect.arrayContaining(["src/ledger/filesystem-ledger.ts", "src/ui/widget/index.ts"])
    );
    expect(ledger?.rankReasons).toContain("import_degree:1");
    expect(widget?.rankReasons).toContain("import_degree:1");
  });

  it("avoids generic prompt symbol matches, fixture exports, and default test-file preference", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(
      path.join(root, "src", "core", "run-controller.ts"),
      [
        "export class RunController {",
        "  async execute(): Promise<void> { return; }",
        "}",
        "export function createRunController(): RunController { return new RunController(); }"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(root, "tests", "repository-map.test.ts"),
      [
        "import { describe, it } from 'vitest';",
        "const file = 'src/core/run-controller.ts';",
        "const fixture = `export function ignoredFixtureExport() { return 'fixture'; }`;",
        "describe('repository map', () => {",
        "  it('uses fixture code', () => { return file + fixture; });",
        "});"
      ].join("\n"),
      "utf8"
    );

    const repoMap = await generateRepositoryMap({
      root,
      prompt: "Analyze this repository and inspect files, source, context, output, and command results.",
      maxChars: 4000
    });
    const testFile = repoMap.files.find((item) => item.path === "tests/repository-map.test.ts");

    expect(repoMap.files[0]?.path).toBe("src/core/run-controller.ts");
    expect(testFile?.rankReasons).toContain("test_file_penalty");
    expect(repoMap.files.flatMap((item) => item.rankReasons)).not.toContain("prompt_symbol_match:file");
    expect(repoMap.files.flatMap((item) => item.exports.map((exported) => exported.name))).not.toContain("ignoredFixtureExport");
    expect(repoMap.files.flatMap((item) => item.symbols.map((symbol) => symbol.name))).not.toContain("ignoredFixtureExport");
  });

  it("removes the test-file penalty when the prompt explicitly references tests", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeFile(path.join(root, "src", "core", "run-controller.ts"), "export class RunController {}\n", "utf8");
    await writeFile(path.join(root, "tests", "repository-map.test.ts"), "export function repositoryMapCoverage() { return true; }\n", "utf8");

    const repoMap = await generateRepositoryMap({ root, prompt: "review tests and coverage for repositoryMapCoverage", maxChars: 4000 });
    const testFile = repoMap.files.find((item) => item.path === "tests/repository-map.test.ts");

    expect(testFile?.rankReasons).not.toContain("test_file_penalty");
    expect(testFile?.rankReasons).toContain("prompt_symbol_match:repositoryMapCoverage");
  });

  it("renders a budgeted markdown map with omitted files", async () => {
    const root = await fixtureRoot();
    for (let index = 0; index < 8; index += 1) {
      await writeFile(path.join(root, "src", `file-${index}.ts`), `export function symbol${index}() { return ${index}; }\n`, "utf8");
    }

    const repoMap = await generateRepositoryMap({ root, prompt: "inspect", maxChars: 450 });

    expect(repoMap.budget.renderedChars).toBeLessThanOrEqual(450);
    expect(repoMap.budget.truncated).toBe(true);
    expect(repoMap.omitted.filesOmitted).toBeGreaterThan(0);
    expect(repoMap.markdown).toContain("# Repository Context Map");
    expect(repoMap.markdown).toContain("## Omitted");
    expect(repoMap.markdown).toMatch(/Files omitted by budget: \d+/);
  });

  it("renders context anchors within the RepoMap budget when requested", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src", "cli"), { recursive: true });
    await writeFile(
      path.join(root, "README.md"),
      [
        "# OpenKitchen",
        "",
        "OpenKitchen is a local-first, CLI-first orchestration ledger for AI coding workflows.",
        "",
        "It records modes, decisions, adapters, validation evidence, approvals, and ledgers.",
        "",
        "## Daily Use",
        "",
        "Use ok prep, ok cook, ok taste, and ok banquet for daily commands.",
        "",
        "## CLI"
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "open-kitchen-fixture",
        version: "0.1.0",
        type: "module",
        bin: { "open-kitchen": "./dist/cli/index.js", ok: "./dist/cli/index.js" },
        scripts: { build: "tsc", test: "vitest", typecheck: "tsc --noEmit" },
        dependencies: { commander: "^12.1.0" },
        devDependencies: { typescript: "^5.8.3", vitest: "^2.1.9" }
      }, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(root, "src", "cli", "index.ts"),
      [
        "import { Command } from 'commander';",
        "export function createProgram(): Command { return new Command(); }",
        "export const cliName = 'open-kitchen';"
      ].join("\n"),
      "utf8"
    );
    await writeFile(path.join(root, "src", "core", "run-controller.ts"), "export class RunController {}\n", "utf8");

    const repoMap = await generateRepositoryMap({
      root,
      prompt: "summarize README and CLI structure",
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 1100
    });

    expect(repoMap.budget.maxChars).toBe(2000);
    expect(repoMap.budget.renderedChars).toBeLessThanOrEqual(2000);
    expect(repoMap.summary.filesIncluded).toBeGreaterThanOrEqual(1);
    expect(repoMap.summary.symbolsIncluded).toBeGreaterThan(0);
    expect(repoMap.markdown).toContain("## Context Anchors");
    expect(repoMap.markdown).toContain("README.md");
    expect(repoMap.markdown).toContain("OpenKitchen is a local-first");
    expect(repoMap.markdown).toContain("package.json");
    expect(repoMap.markdown).toContain("Bin:");
    expect(repoMap.markdown).toContain("Scripts: build, test, typecheck");
    expect(repoMap.markdown).toContain("src/cli/index.ts");
    expect(repoMap.markdown).toContain("## Files");
  });

  it("omits context anchors unless requested", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, "README.md"), "# OpenKitchen\n\nREADME context.\n", "utf8");
    await writeFile(path.join(root, "src", "core", "run-controller.ts"), "export class RunController {}\n", "utf8");

    const repoMap = await generateRepositoryMap({ root, prompt: "summarize README", maxChars: 2000 });

    expect(repoMap.markdown).not.toContain("## Context Anchors");
  });

  it("does not fail when requested context anchor files are missing", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, "src", "core", "run-controller.ts"), "export class RunController {}\n", "utf8");

    const repoMap = await generateRepositoryMap({
      root,
      prompt: "summarize README and CLI structure",
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 1100
    });

    expect(repoMap.status).toBe("generated");
    expect(repoMap.budget.renderedChars).toBeLessThanOrEqual(2000);
  });

  it("selects architecture anchors for architecture prompts", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "docs"), { recursive: true });
    await mkdir(path.join(root, "src", "cli", "commands"), { recursive: true });
    await writeBaseAnchors(root);
    await writeFile(path.join(root, "docs", "ARCHITECTURE.md"), "# Architecture\n\nCore ledger and controller architecture.\n", "utf8");
    await writeFile(path.join(root, "src", "core", "run-controller.ts"), "export class RunController {}\n", "utf8");
    await writeFile(path.join(root, "src", "cli", "commands", "run.ts"), "export function registerRunCommand() {}\n", "utf8");

    const repoMap = await generateRepositoryMap({
      root,
      prompt: "architecture 구조 설명",
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 850
    });

    expect(repoMap.markdown).toContain("docs/ARCHITECTURE.md");
    expect(repoMap.budget.renderedChars).toBeLessThanOrEqual(2000);
    expect(repoMap.summary.filesIncluded).toBeGreaterThanOrEqual(1);
    expect(repoMap.summary.symbolsIncluded).toBeGreaterThan(0);
  });

  it("selects provider anchors for provider prompts", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src", "agents"), { recursive: true });
    await mkdir(path.join(root, "src", "cli", "commands"), { recursive: true });
    await writeBaseAnchors(root);
    await writeFile(path.join(root, "src", "agents", "adapter.ts"), "export interface AgentAdapter {}\n", "utf8");
    await writeFile(path.join(root, "src", "agents", "provider-adapters.ts"), "export function createProviderAdapter() {}\n", "utf8");
    await writeFile(path.join(root, "src", "cli", "commands", "adapters.ts"), "export function registerAdaptersCommand() {}\n", "utf8");

    const repoMap = await generateRepositoryMap({
      root,
      prompt: "provider adapter 설명",
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 850
    });

    expect(repoMap.markdown).toContain("src/agents/adapter.ts");
    expect(repoMap.markdown).toContain("## Context Anchors");
  });

  it("selects repository-map anchors for non-bug RepoMap prompts", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src", "repository-map"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeBaseAnchors(root);
    await writeFile(path.join(root, "src", "repository-map", "repository-map.ts"), "export function generateRepositoryMap() { return true; }\n", "utf8");
    await writeFile(path.join(root, "src", "repository-map", "types.ts"), "export interface RepositoryMapRecord {}\n", "utf8");
    await writeFile(path.join(root, "tests", "repository-map.test.ts"), "export function repositoryMapTest() { return true; }\n", "utf8");
    await writeFile(path.join(root, "scripts", "run-repomap-eval.ps1"), "param([string]$Set)\n", "utf8");

    const repoMap = await generateRepositoryMap({
      root,
      prompt: "Repository Context Map 구현을 설명해",
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 850
    });

    expect(repoMap.markdown).toContain("src/repository-map/repository-map.ts");
    expect(repoMap.markdown).toContain("src/repository-map/types.ts");
  });

  it("selects repository-map implementation and test anchors for RepoMap bug prompts", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src", "repository-map"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await writeBaseAnchors(root);
    await writeFile(path.join(root, "src", "repository-map", "repository-map.ts"), "export function generateRepositoryMap() { return true; }\n", "utf8");
    await writeFile(path.join(root, "src", "repository-map", "types.ts"), "export interface RepositoryMapRecord {}\n", "utf8");
    await writeFile(path.join(root, "tests", "repository-map.test.ts"), "export function repositoryMapTest() { return true; }\n", "utf8");

    const repoMap = await generateRepositoryMap({
      root,
      prompt: "Repository Context Map bug 분석",
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 850
    });

    expect(repoMap.markdown).toContain("tests/repository-map.test.ts");
    expect(repoMap.markdown).toContain("src/repository-map/repository-map.ts");
    expect(repoMap.budget.renderedChars).toBeLessThanOrEqual(2000);
    expect(repoMap.summary.filesIncluded).toBeGreaterThanOrEqual(1);
    expect(repoMap.summary.symbolsIncluded).toBeGreaterThan(0);
  });

  it.each([
    {
      prompt: "provider adapter bug",
      implementationPath: ["src", "agents", "provider-adapters.ts"],
      implementationSource: "export function createProviderAdapter() {}\n",
      testPath: ["tests", "provider-adapters.test.ts"],
      testSource: "export function providerAdapterTest() { return true; }\n",
      expectedTest: "tests/provider-adapters.test.ts"
    },
    {
      prompt: "process runner timeout error",
      implementationPath: ["src", "agents", "process-runner.ts"],
      implementationSource: "export function runProcess() {}\n",
      testPath: ["tests", "process-runner.test.ts"],
      testSource: "export function processRunnerTest() { return true; }\n",
      expectedTest: "tests/process-runner.test.ts"
    },
    {
      prompt: "run controller fail",
      implementationPath: ["src", "core", "run-controller.ts"],
      implementationSource: "export class RunController {}\n",
      testPath: ["tests", "run-controller.test.ts"],
      testSource: "export function runControllerTest() { return true; }\n",
      expectedTest: "tests/run-controller.test.ts"
    },
    {
      prompt: "run command bug",
      implementationPath: ["src", "cli", "commands", "run.ts"],
      implementationSource: "export function registerRunCommand() {}\n",
      testPath: ["tests", "cli-smoke.test.ts"],
      testSource: "export function cliSmokeTest() { return true; }\n",
      expectedTest: "tests/cli-smoke.test.ts"
    }
  ])("selects paired test anchors for $prompt", async ({ prompt, implementationPath, implementationSource, testPath, testSource, expectedTest }) => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, ...implementationPath.slice(0, -1)), { recursive: true });
    await mkdir(path.join(root, ...testPath.slice(0, -1)), { recursive: true });
    await writeBaseAnchors(root);
    await writeFile(path.join(root, ...implementationPath), implementationSource, "utf8");
    await writeFile(path.join(root, ...testPath), testSource, "utf8");

    const repoMap = await generateRepositoryMap({
      root,
      prompt,
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 850
    });

    expect(repoMap.markdown).toContain(expectedTest);
    expect(repoMap.budget.renderedChars).toBeLessThanOrEqual(2000);
    expect(repoMap.summary.filesIncluded).toBeGreaterThanOrEqual(1);
    expect(repoMap.summary.symbolsIncluded).toBeGreaterThan(0);
  });

  it("uses CLI entrypoint anchors for CLI entrypoint bug prompts", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src", "cli", "commands"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeBaseAnchors(root);
    await writeFile(path.join(root, "src", "cli", "index.ts"), "export function createProgram() {}\n", "utf8");
    await writeFile(path.join(root, "src", "cli", "commands", "run.ts"), "export function registerRunCommand() {}\n", "utf8");
    await writeFile(
      path.join(root, "tests", "cli-smoke.test.ts"),
      [
        "import { it } from 'vitest';",
        "it('prints help output', () => true);",
        "it('runs prep shortcut', () => true);",
        "it('parses instant mode', () => true);"
      ].join("\n"),
      "utf8"
    );
    await writeFile(path.join(root, "docs", "CLI.md"), "# CLI\n\nCommand guide.\n", "utf8");

    const repoMap = await generateRepositoryMap({
      root,
      prompt: "CLI entrypoint bug",
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 850
    });

    const entrypointIndex = repoMap.markdown.indexOf("src/cli/index.ts");
    const runCommandIndex = repoMap.markdown.indexOf("src/cli/commands/run.ts");
    const contextAnchors = repoMap.markdown.split("## Files")[0] ?? repoMap.markdown;

    expect(entrypointIndex).toBeGreaterThanOrEqual(0);
    if (runCommandIndex >= 0) {
      expect(entrypointIndex).toBeLessThan(runCommandIndex);
    }
    expect(repoMap.markdown).toContain("tests/cli-smoke.test.ts");
    expect(repoMap.markdown).toContain("Guard:");
    expect(repoMap.markdown).toContain("Risk:");
    expect(repoMap.markdown).toContain("Covers:");
    expect(repoMap.markdown).toContain("Bug instruction:");
    expect(repoMap.markdown).toContain("package.json");
    expect(repoMap.markdown).toContain("Type: module");
    expect(repoMap.markdown).toContain("Bin:");
    expect(contextAnchors).not.toContain("Exports:");
    expect(contextAnchors).not.toContain("Symbols:");
    expect(contextAnchors).not.toContain("Imports:");
    expect(contextAnchors).not.toContain("Scripts:");
    expect(repoMap.markdown).not.toContain("docs/CLI.md");
    expect(repoMap.markdown).not.toContain("README.md");
    expect(repoMap.budget.renderedChars).toBeLessThanOrEqual(2000);
    expect(repoMap.summary.filesIncluded).toBeGreaterThanOrEqual(1);
    expect(repoMap.summary.symbolsIncluded).toBeGreaterThan(0);
  });

  it.each([
    "npm link 후 ok --help 무출력",
    "open-kitchen bin entrypoint 문제"
  ])("detects %s as CLI entrypoint bug anchors", async (prompt) => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src", "cli"), { recursive: true });
    await mkdir(path.join(root, "tests"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeBaseAnchors(root);
    await writeFile(path.join(root, "src", "cli", "index.ts"), "export function createProgram() {}\n", "utf8");
    await writeFile(path.join(root, "tests", "cli-smoke.test.ts"), "export function cliSmokeTest() { return true; }\n", "utf8");
    await writeFile(path.join(root, "docs", "CLI.md"), "# CLI\n\nCommand guide.\n", "utf8");

    const repoMap = await generateRepositoryMap({
      root,
      prompt,
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 850
    });
    const contextAnchors = repoMap.markdown.split("## Files")[0] ?? repoMap.markdown;

    expect(repoMap.markdown).toContain("src/cli/index.ts");
    expect(repoMap.markdown).toContain("tests/cli-smoke.test.ts");
    expect(repoMap.markdown).toContain("package.json");
    expect(repoMap.markdown).toContain("Guard:");
    expect(repoMap.markdown).toContain("Covers:");
    expect(repoMap.markdown).toContain("Type: module");
    expect(repoMap.markdown).toContain("Bin:");
    expect(contextAnchors).not.toContain("Exports:");
    expect(contextAnchors).not.toContain("Scripts:");
    expect(repoMap.markdown).not.toContain("docs/CLI.md");
    expect(repoMap.markdown).not.toContain("README.md");
    expect(repoMap.budget.renderedChars).toBeLessThanOrEqual(2000);
    expect(repoMap.summary.filesIncluded).toBeGreaterThanOrEqual(1);
    expect(repoMap.summary.symbolsIncluded).toBeGreaterThan(0);
  });

  it("selects pitch anchors for pitch prompts", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeBaseAnchors(root);
    await writeFile(path.join(root, "README.ko.md"), "# 오픈키친\n\n한국어 소개 문서입니다.\n", "utf8");
    await writeFile(path.join(root, "docs", "CLI.md"), "# CLI\n\nDaily commands and shortcuts.\n", "utf8");
    await writeFile(path.join(root, "docs", "ARCHITECTURE.md"), "# Architecture\n\nSystem overview.\n", "utf8");

    const repoMap = await generateRepositoryMap({
      root,
      prompt: "discord 공유용 30-second project pitch 소개",
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 850
    });

    expect(repoMap.markdown).toContain("README.md");
    expect(repoMap.markdown).toContain("README.ko.md");
    expect(repoMap.markdown).toContain("docs/CLI.md");
  });

  it("selects CLI anchors for CLI prompts and generic prompts fall back to baseline CLI", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "src", "cli", "commands"), { recursive: true });
    await mkdir(path.join(root, "docs"), { recursive: true });
    await writeBaseAnchors(root);
    await writeFile(path.join(root, "src", "cli", "index.ts"), "export function createProgram() {}\n", "utf8");
    await writeFile(path.join(root, "src", "cli", "commands", "run.ts"), "export function registerRunCommand() {}\n", "utf8");
    await writeFile(path.join(root, "docs", "CLI.md"), "# CLI\n\nCommand guide.\n", "utf8");

    const cliRepoMap = await generateRepositoryMap({
      root,
      prompt: "Find the CLI entrypoint and run command flow",
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 850
    });
    const genericRepoMap = await generateRepositoryMap({
      root,
      prompt: "summarize the project",
      maxChars: 2000,
      contextAnchors: true,
      anchorMaxChars: 850
    });

    expect(cliRepoMap.markdown).toContain("src/cli/index.ts");
    expect(cliRepoMap.markdown).toContain("src/cli/commands/run.ts");
    expect(genericRepoMap.markdown).toContain("src/cli/index.ts");
  });
});

async function fixtureRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `open-kitchen-repo-map-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  await mkdir(path.join(root, "src", "core"), { recursive: true });
  await mkdir(path.join(root, "src", "ledger"), { recursive: true });
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  return root;
}

async function writeBaseAnchors(root: string): Promise<void> {
  await writeFile(path.join(root, "README.md"), "# OpenKitchen\n\nLocal-first AI coding workflow orchestration.\n", "utf8");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "open-kitchen-fixture",
      type: "module",
      bin: { "open-kitchen": "./dist/cli/index.js", ok: "./dist/cli/index.js" },
      scripts: { build: "tsc", test: "vitest", typecheck: "tsc --noEmit" }
    }, null, 2),
    "utf8"
  );
}
