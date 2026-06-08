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
});
