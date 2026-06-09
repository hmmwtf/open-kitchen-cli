import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../src/cli/index.js";
import { createCliProgressRenderer } from "../src/cli/commands/run.js";
import { codexCliAdapterMetadata } from "../src/agents/provider-adapters.js";

describe("CLI smoke tests", () => {
  const logs: string[] = [];
  const errors: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const originalDefaultAdapter = process.env.OPEN_KITCHEN_DEFAULT_ADAPTER;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    process.exitCode = originalExitCode;
    delete process.env.OPEN_KITCHEN_DEFAULT_ADAPTER;
    logSpy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
      errors.push(String(message));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = originalExitCode;
    if (originalDefaultAdapter === undefined) {
      delete process.env.OPEN_KITCHEN_DEFAULT_ADAPTER;
    } else {
      process.env.OPEN_KITCHEN_DEFAULT_ADAPTER = originalDefaultAdapter;
    }
  });

  it("prints the five modes", async () => {
    await createProgram().parseAsync(["node", "open-kitchen", "modes"]);

    const output = logs.join("\n");
    expect(output).toContain("chef");
    expect(output).toContain("prep");
    expect(output).toContain("cook");
    expect(output).toContain("taste");
    expect(output).toContain("banquet");
  });

  it("recommends a mode without running", async () => {
    await createProgram().parseAsync(["node", "open-kitchen", "recommend", "fix this bug"]);

    const output = logs.join("\n");
    expect(output).toContain("Recommended mode: cook");
    expect(output).toContain("Confidence: high");
    expect(output).toContain("Reason: Prompt asks for implementation");
    expect(output).toContain("Signals: implementation_request");
    expect(output).toContain("Run: open-kitchen run --mode cook");
  });

  it("lists provider adapters", async () => {
    await createProgram().parseAsync(["node", "open-kitchen", "adapters", "list"]);

    const output = logs.join("\n");
    expect(output).toContain("mock (Mock Agent Adapter)");
    expect(output).toContain("codex-cli (Codex CLI Adapter)");
    expect(output).toContain("claude-code (Claude Code Adapter)");
    expect(output).toContain("ollama (Ollama Adapter)");
    expect(output).toContain("Workspace mutation:");
  });

  it("checks mock provider diagnostics and writes a health ledger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-provider-check-"));
    await createProgram().parseAsync(["node", "open-kitchen", "adapters", "check", "--ledger-root", root, "mock"]);

    const output = logs.join("\n");
    expect(output).toContain("Mock Agent Adapter provider diagnostics passed.");
    expect(output).toContain("Adapter: mock (Mock Agent Adapter)");
    expect(output).toContain("Status: passed");
    expect(output).toContain("Smoke: skipped");
    expect(output).toContain(`Ledger: ${root}`);
  });

  it("rejects unknown provider diagnostics adapters", async () => {
    await expect(createProgram().parseAsync(["node", "open-kitchen", "adapters", "check", "codex"])).rejects.toThrow(
      'Unknown adapter "codex"'
    );
  });

  it("prints selected mode override comparison for recommendations", async () => {
    await createProgram().parseAsync(["node", "open-kitchen", "recommend", "--mode", "chef", "fix this bug"]);

    const output = logs.join("\n");
    expect(output).toContain("Recommended mode: cook");
    expect(output).toContain("Selected mode chef overrides recommended mode cook.");
    expect(output).toContain("Override: open-kitchen run --mode chef");
  });

  it("runs and reads a ledger result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "run",
      "--mode",
      "banquet",
      "--adapter",
      "mock",
      "--ledger-root",
      root,
      "split this work"
    ]);

    const runLine = logs.find((line) => line.startsWith("Run: "));
    expect(runLine).toBeDefined();
    const runId = runLine?.replace("Run: ", "") ?? "";

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "ledger", "show", "--ledger-root", root, runId]);

    const output = logs.join("\n");
    expect(output).toContain("Banquet completed parallel_tasks mock execution");
    expect(output).toContain("Adapter: mock (Mock Agent Adapter)");
    expect(output).toContain("Strategy: parallel_tasks");
    expect(output).toContain("Decision: Banquet selected parallel execution");
    expect(output).toContain("Recommended mode: banquet");
    expect(output).toContain("Plan: Banquet planner stub created deterministic parallel worker tasks.");
    expect(output).toContain("Banquet: completed");
    expect(output).toContain("Workers: 3 completed, 0 failed");
    expect(output).toContain("Conflicts: 0");
    expect(output).toContain("Reconciliation: completed");
    expect(output).toContain("Validation: passed");
    expect(output).toContain("Validation gate: passed");
    expect(output).toContain("Evidence: 4 record(s)");
  });

  it("prints no runs for empty last shortcut", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-last-empty-"));
    await createProgram().parseAsync(["node", "open-kitchen", "last", "--ledger-root", root]);

    expect(logs.join("\n")).toContain("No runs found.");
  });

  it("shows the latest run with last shortcut", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-last-"));
    await createProgram().parseAsync(["node", "open-kitchen", "chef", "--ledger-root", root, "coordinate this work"]);
    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "prep", "--ledger-root", root, "inspect this repo"]);
    const latestRunId = findRunId();
    await writeBrokenRun(root, "99999999T999999Z-broken");

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "last", "--ledger-root", root]);

    const output = logs.join("\n");
    expect(output).toContain("Skipped 1 incomplete run.");
    expect(output).toContain("Summary");
    expect(output).toContain(`Run: ${latestRunId}`);
    expect(output).toContain("Mode: prep");
    expect(output).toContain("RepoMap: generated");
    expect(output).toContain(`Ledger: ${path.join(root, latestRunId)}`);
  });

  it("prints no valid runs when last only finds broken runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-last-broken-"));
    await writeBrokenRun(root, "99999999T999999Z-broken");

    await createProgram().parseAsync(["node", "open-kitchen", "last", "--ledger-root", root]);

    const output = logs.join("\n");
    expect(output).toContain("Skipped 1 incomplete run.");
    expect(output).toContain("No valid runs found.");
  });

  it("shows compact run summaries without dumping result markdown", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-show-"));
    await createProgram().parseAsync(["node", "open-kitchen", "prep", "--ledger-root", root, "inspect this repo"]);
    const runId = findRunId();

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "show", "--ledger-root", root, runId]);

    const output = logs.join("\n");
    expect(output).toContain("Summary");
    expect(output).toContain(`Run: ${runId}`);
    expect(output).toContain("Mode: prep");
    expect(output).toContain("Adapter: mock (Mock Agent Adapter)");
    expect(output).toContain("Status: completed");
    expect(output).toContain("Strategy: direct");
    expect(output).toContain("Provider: not available");
    expect(output).toContain("RepoMap: generated");
    expect(output).toContain("Output size:");
    expect(output).toContain("Commands: 0 total");
    expect(output).toContain("Final answer:");
    expect(output).not.toContain("# OpenKitchen Run Result");
  });

  it("limits show answer preview and supports full or no-answer output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-show-preview-"));
    await createProgram().parseAsync(["node", "open-kitchen", "chef", "--ledger-root", root, "coordinate this work"]);
    const runId = findRunId();
    await replaceFirstOutput(path.join(root, runId, "result.json"), "A".repeat(1500));

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "show", "--ledger-root", root, runId]);
    expect(logs.join("\n")).toContain("[truncated in ok show]");

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "show", "--full", "--ledger-root", root, runId]);
    expect(logs.join("\n")).not.toContain("[truncated in ok show]");

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "show", "--no-answer", "--ledger-root", root, runId]);
    expect(logs.join("\n")).not.toContain("Final answer:");
  });

  it("shows timed-out provider runs with salvaged partial answer metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-show-partial-answer-"));
    await createProgram().parseAsync(["node", "open-kitchen", "prep", "--ledger-root", root, "inspect this repo"]);
    const runId = findRunId();
    await addTimedOutProviderAnswer(path.join(root, runId, "result.json"), "Salvaged answer.");

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "show", "--ledger-root", root, runId]);

    const output = logs.join("\n");
    expect(output).toContain("timedOut yes");
    expect(output).toContain("timedOutWithAnswer yes");
    expect(output).toContain("closeDelayAfterTimeout 10000ms");
    expect(output).toContain("timeoutOverrun 10000ms");
    expect(output).toContain("partialAnswer partial-answer-direct.md");
    expect(output).toContain("Kill: pid 1234");
    expect(output).toContain("taskkill failed exit=1");
    expect(output).toContain("fallback child.kill true");
    expect(output).toContain("Taskkill stderr: ERROR: Access is denied.");
    expect(output).toContain("Salvaged answer.");
  });

  it("prints compact logs, raw logs, provider-only logs, and clear missing-run errors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-logs-"));
    await createProgram().parseAsync(["node", "open-kitchen", "prep", "--ledger-root", root, "inspect this repo"]);
    const runId = findRunId();
    await appendProviderEvents(path.join(root, runId, "events.jsonl"));

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "logs", "--ledger-root", root, "--tail", "2", runId]);
    let output = logs.join("\n");
    expect(output).toContain(`Logs: ${runId}`);
    expect(output).toContain("Provider stream chunks: 2 total");
    expect(output).toContain("provider.invocation.completed");

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "logs", "--raw", "--provider", "--ledger-root", root, runId]);
    output = logs.join("\n");
    expect(output).toContain('"type":"provider.invocation.started"');
    expect(output).not.toContain('"type":"run.started"');

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "show", "--ledger-root", root, "missing-run"]);
    expect(errors.join("\n")).toContain("Run not found: missing-run");
    expect(errors.join("\n")).not.toContain("Error:");
    expect(process.exitCode).toBe(1);

    process.exitCode = originalExitCode;
    errors.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "logs", "--ledger-root", root, "missing-run"]);
    expect(errors.join("\n")).toContain("Run not found: missing-run");
    expect(errors.join("\n")).not.toContain("Error:");
    expect(process.exitCode).toBe(1);
  });

  it("prints run stats with metrics, grouping, skipped runs, and no output dumps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-stats-"));
    await writeStatsRun(root, {
      runId: "20260608T000001Z-old",
      prompt: "OpenKitchen을 Obsidian 사용자에게 설명하는 소개글을 작성해",
      adapter: "mock",
      status: "completed",
      startedAt: "2026-06-08T00:00:01.000Z",
      completedAt: "2026-06-08T00:00:02.000Z",
      rawOutput: "old raw output",
      finalAnswer: "old final answer"
    });
    await writeStatsRun(root, {
      runId: "20260608T000002Z-timeout",
      prompt: "architecture risk와 maintenance risk를 분석해줘",
      adapter: "codex-cli",
      status: "failed",
      startedAt: "2026-06-08T00:00:02.000Z",
      completedAt: "2026-06-08T00:00:17.000Z",
      providerDurationMs: 15000,
      timedOut: true,
      timeoutWithAnswer: true,
      closeDelayAfterTimeoutMs: 14000,
      timeoutOverrunMs: 14000,
      killAttempted: true,
      killSucceeded: false,
      rawOutput: "RAW_BODY_SHOULD_NOT_PRINT",
      finalAnswer: "FINAL_BODY_SHOULD_NOT_PRINT",
      filesIncluded: 2,
      symbolsIncluded: 7,
      repoMapTruncated: true
    });
    await writeStatsRun(root, {
      runId: "20260608T000003Z-instant",
      prompt: "이 프로젝트에서 가장 중요한 파일 5개를 설명해",
      adapter: "codex-cli",
      status: "completed",
      startedAt: "2026-06-08T00:00:03.000Z",
      completedAt: "2026-06-08T00:00:13.000Z",
      providerDurationMs: 9000,
      commandEvents: 1,
      rawOutput: "R".repeat(1200),
      finalAnswer: "A".repeat(600),
      filesIncluded: 1,
      symbolsIncluded: 5,
      repoMapTruncated: true,
      instantAnchors: true
    });
    await writeBrokenRun(root, "99999999T999999Z-broken");

    await createProgram().parseAsync(["node", "open-kitchen", "stats", "--ledger-root", root, "--limit", "2"]);

    const output = logs.join("\n");
    expect(output).toContain("OpenKitchen Run Stats");
    expect(output).toContain("Window: latest 2 valid runs");
    expect(output).toContain("Skipped: 1 incomplete run");
    expect(output).toContain("Runs: 2");
    expect(output).toContain("Completed: 1");
    expect(output).toContain("Timed out: 1");
    expect(output).toContain("Timeout with answer: 1");
    expect(output).toContain("Timeout without structured answer: 0");
    expect(output).toContain("Completion rate: 50.0%");
    expect(output).toContain("Avg total: 12.50s");
    expect(output).toContain("Avg provider: 12.00s");
    expect(output).toContain("Avg commands: 0.5");
    expect(output).toContain("Avg close delay after timeout: 14.00s");
    expect(output).toContain("Timeout kill attempted: 1");
    expect(output).toContain("Timeout kill succeeded: 0");
    expect(output).toContain("Timeout kill failed: 1");
    expect(output).toContain("Max close delay after timeout: 14.00s");
    expect(output).toContain("Avg timeout overrun: 14.00s");
    expect(output).toContain("By Adapter");
    expect(output).toContain("codex-cli | 2 | 1 | 1");
    expect(output).toContain("By Prompt Category");
    expect(output).toContain("important-files | 1 | 1 | 0");
    expect(output).toContain("tech-debt | 1 | 0 | 1");
    expect(output).toContain("Inferred instant runs: 1");
    expect(output).toContain("Zero-command rate: 50.0%");
    expect(output).toContain("RepoMap truncated: 2");
    expect(output).not.toContain("RAW_BODY_SHOULD_NOT_PRINT");
    expect(output).not.toContain("FINAL_BODY_SHOULD_NOT_PRINT");
    expect(output).not.toContain("old raw output");
  });

  it("prints no valid runs for empty stats ledgers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-stats-empty-"));

    await createProgram().parseAsync(["node", "open-kitchen", "stats", "--ledger-root", root]);

    expect(logs.join("\n")).toContain("No valid runs found.");
  });

  it("prints parseable stats JSON and handles partial or invalid runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-stats-json-"));
    await writeStatsRun(root, {
      runId: "20260608T000001Z-partial",
      prompt: "Provider Adapter 구조를 설명해",
      adapter: "codex-cli",
      status: "completed",
      startedAt: "2026-06-08T00:00:01.000Z",
      completedAt: "2026-06-08T00:00:03.000Z",
      partial: true
    });
    await mkdir(path.join(root, "99999999T999999Z-invalid"), { recursive: true });
    await writeFile(path.join(root, "99999999T999999Z-invalid", "run.json"), "{ invalid json", "utf8");

    await createProgram().parseAsync(["node", "open-kitchen", "stats", "--json", "--ledger-root", root]);

    const parsed = JSON.parse(logs.join("\n")) as {
      skippedCount: number;
      partialCount: number;
      summary: { runs: number; completed: number; completionRate: number; timeoutWithAnswerCount: number };
      byAdapter: Array<{ key: string; runs: number }>;
      byPromptCategory: Array<{ key: string; runs: number }>;
      instantQualityProxies: { inferredInstantRuns: number };
      timeoutKill: { attempted: number; succeeded: number; failed: number };
    };
    expect(parsed.skippedCount).toBe(1);
    expect(parsed.partialCount).toBe(1);
    expect(parsed.summary.runs).toBe(1);
    expect(parsed.summary.completed).toBe(1);
    expect(parsed.summary.completionRate).toBe(1);
    expect(parsed.summary.timeoutWithAnswerCount).toBe(0);
    expect(parsed.byAdapter).toContainEqual(expect.objectContaining({ key: "codex-cli", runs: 1 }));
    expect(parsed.byPromptCategory).toContainEqual(expect.objectContaining({ key: "provider", runs: 1 }));
    expect(parsed.instantQualityProxies.inferredInstantRuns).toBe(0);
    expect(parsed.timeoutKill).toEqual(expect.objectContaining({ attempted: 0, succeeded: 0, failed: 0 }));
  });

  it.each([
    ["chef", "chef", "summarize this repo"],
    ["prep", "prep", "inspect this repo"],
    ["cook", "cook", "fix this bug"],
    ["taste", "taste", "review this project"]
  ])("runs %s shortcut with existing run output", async (command, expectedMode, prompt) => {
    const root = await mkdtemp(path.join(os.tmpdir(), `open-kitchen-cli-shortcut-${command}-`));
    await createProgram().parseAsync(["node", "open-kitchen", command, "--ledger-root", root, prompt]);

    const output = logs.join("\n");
    expect(output).toContain("Run: ");
    expect(output).toContain(`Mode: ${expectedMode}`);
    expect(output).toContain("Adapter: mock (Mock Agent Adapter)");
    expect(output).toContain("Strategy: direct");
    expect(output).toContain("Decision:");
    expect(output).toContain(`Ledger: ${root}`);
  });

  it("runs banquet shortcut as parallel task execution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-shortcut-banquet-"));
    await createProgram().parseAsync(["node", "open-kitchen", "banquet", "--ledger-root", root, "split this work"]);

    const output = logs.join("\n");
    expect(output).toContain("Run: ");
    expect(output).toContain("Mode: banquet");
    expect(output).toContain("Adapter: mock (Mock Agent Adapter)");
    expect(output).toContain("Strategy: parallel_tasks");
    expect(output).toContain("Decision: Banquet selected parallel execution");
    expect(output).toContain(`Ledger: ${root}`);
  });

  it("parses --instant on run and prep shortcut while keeping mock output concise", async () => {
    const runRoot = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-instant-run-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "run",
      "--mode",
      "prep",
      "--instant",
      "--adapter",
      "mock",
      "--ledger-root",
      runRoot,
      "inspect this repo"
    ]);

    let output = logs.join("\n");
    expect(output).toContain("Run: ");
    expect(output).toContain("Mode: prep");
    expect(output).toContain("Adapter: mock (Mock Agent Adapter)");
    expect(output).toContain("Strategy: direct");
    expect(output).toContain("Decision:");
    expect(output).toContain(`Ledger: ${runRoot}`);

    logs.length = 0;
    const shortcutRoot = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-instant-shortcut-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "prep",
      "--fast",
      "--instant",
      "--adapter",
      "mock",
      "--ledger-root",
      shortcutRoot,
      "inspect this repo"
    ]);

    output = logs.join("\n");
    expect(output).toContain("Run: ");
    expect(output).toContain("Mode: prep");
    expect(output).toContain("Adapter: mock (Mock Agent Adapter)");
    expect(output).toContain("Strategy: direct");
    expect(output).toContain("Decision:");
    expect(output).toContain(`Ledger: ${shortcutRoot}`);
  });

  it("uses mock as the run default adapter when no adapter or env default is set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-adapter-default-"));
    await createProgram().parseAsync(["node", "open-kitchen", "prep", "--ledger-root", root, "inspect this repo"]);

    const output = logs.join("\n");
    expect(output).toContain("Adapter: mock (Mock Agent Adapter)");
  });

  it("uses OPEN_KITCHEN_DEFAULT_ADAPTER when --adapter is omitted", async () => {
    process.env.OPEN_KITCHEN_DEFAULT_ADAPTER = "mock";
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-adapter-env-"));
    await createProgram().parseAsync(["node", "open-kitchen", "prep", "--ledger-root", root, "inspect this repo"]);

    const output = logs.join("\n");
    expect(output).toContain("Adapter: mock (Mock Agent Adapter)");
  });

  it("lets explicit --adapter override OPEN_KITCHEN_DEFAULT_ADAPTER", async () => {
    process.env.OPEN_KITCHEN_DEFAULT_ADAPTER = "codex-cli";
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-adapter-explicit-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "prep",
      "--adapter",
      "mock",
      "--ledger-root",
      root,
      "inspect this repo"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Adapter: mock (Mock Agent Adapter)");
  });

  it("rejects invalid OPEN_KITCHEN_DEFAULT_ADAPTER values", async () => {
    process.env.OPEN_KITCHEN_DEFAULT_ADAPTER = "codex";
    await expect(createProgram().parseAsync(["node", "open-kitchen", "prep", "inspect this repo"])).rejects.toThrow(
      'Unknown adapter "codex"'
    );
  });

  it("prints failed Banquet summaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-banquet-fail-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "run",
      "--mode",
      "banquet",
      "--adapter",
      "mock",
      "--ledger-root",
      root,
      "split this work mock fail banquet"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Banquet: failed");
    expect(output).toContain("Workers: 2 completed, 1 failed");
    expect(output).toContain("Conflicts: 0");
    expect(output).toContain("Reconciliation: failed");
    expect(output).toContain("Validation: skipped");
    expect(output).toContain("Validation gate: failed");
    expect(output).toContain("Evidence: 3 record(s)");
    expect(output).toContain("Evidence summary: Execution produced failed output, so validation was skipped.");
  });

  it("prints validation summaries for validation-aware runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-validation-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "run",
      "--mode",
      "cook",
      "--ledger-root",
      root,
      "fix this bug"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Validation: passed");
    expect(output).toContain("Validation gate: passed");
    expect(output).toContain("Evidence: 3 record(s)");
  });

  it("runs explicit validation commands from CLI JSON argv", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-validation-command-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "run",
      "--mode",
      "cook",
      "--ledger-root",
      root,
      "--validate-command",
      JSON.stringify([process.execPath, "-e", "console.log('cli validation ok')"]),
      "fix this bug"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Validation: passed");
    expect(output).toContain("Validation commands: 1 executed");
    expect(output).toContain("Validation command 1: passed");
  });

  it("rejects invalid validation command JSON", async () => {
    await expect(
      createProgram().parseAsync([
        "node",
        "open-kitchen",
        "run",
        "--mode",
        "cook",
        "--validate-command",
        "npm.cmd run typecheck",
        "fix this bug"
      ])
    ).rejects.toThrow("Invalid --validate-command JSON");
  });

  it("prints evidence summaries for validation warnings", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-validation-warn-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "run",
      "--mode",
      "cook",
      "--ledger-root",
      root,
      "fix this bug mock validation warn"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Validation: warning");
    expect(output).toContain("Validation gate: passed");
    expect(output).toContain("Evidence: 4 record(s)");
    expect(output).toContain("Evidence summary: Prompt matched mock validation warn trigger.");
  });

  it("prints pending approval summaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-approval-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "run",
      "--mode",
      "chef",
      "--require-approval",
      "--ledger-root",
      root,
      "coordinate this change"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Chef needs input direct mock execution");
    expect(output).toContain("Validation: passed");
    expect(output).toContain("Evidence: 3 record(s)");
    expect(output).toContain("Approval: pending");
    expect(output).toContain("Next: open-kitchen resume");
    expect(output).toContain("--approve");
  });

  it("resumes pending approval runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-resume-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "run",
      "--mode",
      "chef",
      "--require-approval",
      "--ledger-root",
      root,
      "coordinate this change"
    ]);
    const runLine = logs.find((line) => line.startsWith("Run: "));
    const runId = runLine?.replace("Run: ", "") ?? "";

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "resume", "--ledger-root", root, "--approve", runId]);

    let output = logs.join("\n");
    expect(output).toContain("Approval: approved");
    expect(output).toContain("Approved by: cli");
    expect(output).toContain(`Run: ${runId}`);
    expect(output).toContain("Status: completed");

    logs.length = 0;
    await createProgram().parseAsync(["node", "open-kitchen", "ledger", "show", "--ledger-root", root, runId]);

    output = logs.join("\n");
    expect(output).toContain("Status: completed");
    expect(output).toContain("Approval: approved");
    expect(output).toContain("Approved by: cli");
  });

  it("rejects resume without --approve", async () => {
    await expect(createProgram().parseAsync(["node", "open-kitchen", "resume", "run-test"])).rejects.toThrow(
      "Approval resume requires --approve"
    );
  });

  it("rejects approval without requiring approval", async () => {
    await expect(
      createProgram().parseAsync(["node", "open-kitchen", "run", "--approve", "coordinate this change"])
    ).rejects.toThrow("--approve requires --require-approval");
  });

  it("prints mode recommendation advisory while still running the selected mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-recommend-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "run",
      "--mode",
      "chef",
      "--ledger-root",
      root,
      "fix this bug"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Mode: chef");
    expect(output).toContain("Strategy: direct");
    expect(output).toContain("Mode recommendation: cook (high); selected chef will run.");
  });

  it("prints handoff recommendations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-cli-handoff-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "run",
      "--ledger-root",
      root,
      "inspect the current project"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Plan: skipped");
    expect(output).toContain("Handoff: recommend prep");
    expect(output).toContain("Next: open-kitchen run --mode prep");
  });

  it("rejects unknown adapters before running", async () => {
    await expect(
      createProgram().parseAsync(["node", "open-kitchen", "run", "--adapter", "codex", "summarize"])
    ).rejects.toThrow('Unknown adapter "codex"');
  });

  it("renders provider progress without invoking a live provider", () => {
    let currentTime = 1000;
    const progress = createCliProgressRenderer(() => currentTime);

    progress({
      type: "run.started",
      runId: "run-progress",
      mode: "prep",
      adapter: codexCliAdapterMetadata,
      ledgerPath: "C:\\ledger\\run-progress"
    });
    progress({
      type: "provider.started",
      adapterName: "codex-cli",
      timeoutMs: 60000,
      permissionIntent: "read_only"
    });
    currentTime = 17000;
    progress({
      type: "provider.completed",
      adapterName: "codex-cli",
      durationMs: 16000
    });

    const output = logs.join("\n");
    expect(output).toContain("Run: run-progress");
    expect(output).toContain("Mode: prep");
    expect(output).toContain("Adapter: codex-cli (Codex CLI Adapter)");
    expect(output).toContain("Ledger: C:\\ledger\\run-progress");
    expect(output).toContain("[00:00] Provider started: codex-cli read_only, timeout 60000ms");
    expect(output).toContain("[00:16] Provider completed (16000ms)");
  });

  function findRunId(): string {
    const runLine = logs.find((line) => line.startsWith("Run: "));
    expect(runLine).toBeDefined();
    return runLine?.replace("Run: ", "") ?? "";
  }

  async function replaceFirstOutput(resultPath: string, output: string): Promise<void> {
    const result = JSON.parse(await readFile(resultPath, "utf8")) as {
      outputs: Array<{ output: string; rawOutput?: string }>;
    };
    result.outputs[0].output = output;
    result.outputs[0].rawOutput = output;
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(path.join(path.dirname(resultPath), "artifacts", "agent-output-direct.md"), output, "utf8");
  }

  async function addTimedOutProviderAnswer(resultPath: string, answer: string): Promise<void> {
    const result = JSON.parse(await readFile(resultPath, "utf8")) as {
      status: string;
      outputs: Array<Record<string, unknown>>;
    };
    result.status = "failed";
    result.outputs[0] = {
      ...result.outputs[0],
      status: "failed",
      output: "Codex CLI Adapter did not finish before the configured timeout.",
      provider: {
        adapterName: "codex-cli",
        provider: "openai",
        surface: "subprocess",
        durationMs: 25000,
        timeoutMs: 15000,
        timeoutSource: "request",
        timedOut: true,
        closeDelayAfterTimeoutMs: 10000,
        timeoutOverrunMs: 10000,
        timedOutPid: 1234,
        killMethod: "child.kill",
        killSucceeded: true,
        taskkillAttempted: true,
        taskkillExitCode: 1,
        taskkillStderrPreview: "ERROR: Access is denied.",
        fallbackKillAttempted: true,
        fallbackKillSucceeded: true,
        killFailureSummary: "taskkill exited with code 1. Fallback child.kill succeeded.",
        partialAnswer: {
          available: true,
          source: "last_agent_message",
          length: answer.length,
          artifactName: "partial-answer-direct.md",
          reason: "timed_out_with_last_agent_message"
        },
        readability: {
          finalAnswer: answer,
          finalAnswerPreview: answer,
          finalAnswerSource: "last_agent_message",
          warnings: [],
          commands: [],
          qualityFlags: ["timed_out_with_answer"],
          outputSize: {
            rawLength: 100,
            extractedTextLength: answer.length,
            finalAnswerLength: answer.length,
            largeOutput: false,
            largeOutputThreshold: 100000
          },
          artifactRefs: {
            outputArtifactName: "agent-output-direct.md",
            partialAnswerArtifactName: "partial-answer-direct.md"
          }
        }
      }
    };
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(path.join(path.dirname(resultPath), "artifacts", "partial-answer-direct.md"), answer, "utf8");
  }

  async function appendProviderEvents(eventsPath: string): Promise<void> {
    const original = await readFile(eventsPath, "utf8");
    const events = [
      {
        timestamp: "2026-06-08T00:00:00.000Z",
        type: "provider.invocation.started",
        message: "Started provider execution.",
        data: { adapterName: "codex-cli", provider: "openai", timeoutMs: 15000 }
      },
      {
        timestamp: "2026-06-08T00:00:01.000Z",
        type: "provider.stream.chunk",
        message: "Provider stream chunk.",
        data: { adapterName: "codex-cli", provider: "openai", stream: "stdout" }
      },
      {
        timestamp: "2026-06-08T00:00:02.000Z",
        type: "provider.stream.chunk",
        message: "Provider stream chunk.",
        data: { adapterName: "codex-cli", provider: "openai", stream: "stderr" }
      },
      {
        timestamp: "2026-06-08T00:00:03.000Z",
        type: "provider.invocation.completed",
        message: "Provider execution completed.",
        data: { adapterName: "codex-cli", provider: "openai", durationMs: 3000, exitCode: 0 }
      }
    ];
    await writeFile(eventsPath, `${original}${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  }

  async function writeBrokenRun(root: string, runId: string): Promise<void> {
    const runPath = path.join(root, runId);
    await mkdir(runPath, { recursive: true });
    await writeFile(
      path.join(runPath, "run.json"),
      `${JSON.stringify(
        {
          runId,
          mode: "prep",
          status: "completed",
          startedAt: "9999-12-31T23:59:59.999Z"
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  async function writeStatsRun(
    root: string,
    input: {
      runId: string;
      prompt: string;
      adapter: "mock" | "codex-cli";
      status: "completed" | "failed";
      startedAt: string;
      completedAt?: string;
      providerDurationMs?: number;
      timedOut?: boolean;
      timeoutWithAnswer?: boolean;
      closeDelayAfterTimeoutMs?: number;
      timeoutOverrunMs?: number;
      killAttempted?: boolean;
      killSucceeded?: boolean;
      commandEvents?: number;
      rawOutput?: string;
      finalAnswer?: string;
      filesIncluded?: number;
      symbolsIncluded?: number;
      repoMapTruncated?: boolean;
      instantAnchors?: boolean;
      partial?: boolean;
    }
  ): Promise<void> {
    const runPath = path.join(root, input.runId);
    await mkdir(path.join(runPath, "artifacts"), { recursive: true });
    const adapter =
      input.adapter === "mock"
        ? { name: "mock", displayName: "Mock Agent Adapter", kind: "mock", provider: "mock", isMock: true }
        : { name: "codex-cli", displayName: "Codex CLI Adapter", kind: "cli", provider: "openai", isMock: false };
    await writeFile(
      path.join(runPath, "run.json"),
      `${JSON.stringify(
        {
          runId: input.runId,
          mode: "prep",
          adapter,
          status: input.status,
          startedAt: input.startedAt,
          completedAt: input.completedAt
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(path.join(runPath, "prompt.txt"), input.prompt, "utf8");
    if (input.partial) {
      return;
    }
    await writeFile(
      path.join(runPath, "result.json"),
      `${JSON.stringify(
        {
          runId: input.runId,
          mode: "prep",
          adapter,
          status: input.status,
          summary: "Stats fixture",
          outputs: [
            {
              output: input.finalAnswer ?? "",
              rawOutput: input.rawOutput ?? "",
              ...(input.adapter === "codex-cli"
                ? {
                    provider: {
                      adapterName: "codex-cli",
                      provider: "openai",
                      surface: "subprocess",
                      durationMs: input.providerDurationMs ?? 0,
                      timeoutMs: 15000,
                      timeoutSource: "request",
                      timedOut: input.timedOut,
                      closeDelayAfterTimeoutMs: input.closeDelayAfterTimeoutMs,
                      timeoutOverrunMs: input.timeoutOverrunMs,
                      processTreeKillAttempted: input.killAttempted,
                      processTreeKillSucceeded: input.killSucceeded,
                      killSucceeded: input.killSucceeded,
                      taskkillAttempted: input.killAttempted,
                      partialAnswer: input.timeoutWithAnswer
                        ? {
                            available: true,
                            source: "last_agent_message",
                            length: (input.finalAnswer ?? "").length,
                            artifactName: "partial-answer-direct.md",
                            reason: "timed_out_with_last_agent_message"
                          }
                        : undefined,
                      readability: {
                        finalAnswer: input.finalAnswer ?? "",
                        finalAnswerPreview: input.finalAnswer ?? "",
                        finalAnswerSource: input.timeoutWithAnswer ? "last_agent_message" : "raw_text_fallback",
                        warnings: [],
                        commands: [],
                        qualityFlags: input.timeoutWithAnswer ? ["timed_out_with_answer"] : [],
                        outputSize: {
                          rawLength: (input.rawOutput ?? "").length,
                          extractedTextLength: (input.finalAnswer ?? "").length,
                          finalAnswerLength: (input.finalAnswer ?? "").length,
                          largeOutput: false,
                          largeOutputThreshold: 100000
                        }
                      }
                    }
                  }
                : {})
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runPath, "repo-map.json"),
      `${JSON.stringify(
        {
          status: "generated",
          summary: {
            filesIncluded: input.filesIncluded ?? 0,
            symbolsIncluded: input.symbolsIncluded ?? 0
          },
          budget: {
            renderedChars: 1000,
            truncated: input.repoMapTruncated ?? false
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(runPath, "artifacts", "repo-map.md"),
      input.instantAnchors ? "## Context Anchors\n\nImportant Files Evidence:\n" : "# Repository Context Map\n",
      "utf8"
    );
    await writeFile(path.join(runPath, "artifacts", "provider-raw-output-direct.txt"), input.rawOutput ?? "", "utf8");
    await writeFile(path.join(runPath, "artifacts", "agent-output-direct.md"), input.finalAnswer ?? "", "utf8");
    const events = [
      {
        timestamp: input.startedAt,
        type: "run.started",
        message: "Started fixture run."
      },
      ...(input.providerDurationMs !== undefined
        ? [
            {
              timestamp: input.completedAt ?? input.startedAt,
              type: input.timedOut ? "provider.invocation.timed_out" : "provider.invocation.completed",
              message: input.timedOut ? "Provider timed out." : "Provider completed.",
              data: { durationMs: input.providerDurationMs }
            }
          ]
        : []),
      ...Array.from({ length: input.commandEvents ?? 0 }, (_, index) => ({
        timestamp: input.completedAt ?? input.startedAt,
        type: "provider.command.completed",
        message: `Command ${index + 1} completed.`
      }))
    ];
    await writeFile(path.join(runPath, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
  }
});
