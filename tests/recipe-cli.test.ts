import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../src/cli/index.js";

describe("recipe CLI", () => {
  const logs: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logs.length = 0;
    logSpy = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("lists built-in recipes", async () => {
    await createProgram().parseAsync(["node", "open-kitchen", "recipe", "list"]);

    expect(logs.join("\n")).toContain("inspect-build-review");
  });

  it("shows ordered recipe steps", async () => {
    await createProgram().parseAsync(["node", "open-kitchen", "recipe", "show", "inspect-build-review"]);

    const output = logs.join("\n");
    expect(output).toContain("Inspect, Build, Review");
    expect(output).toContain("1. prep [prep] Inspect context");
    expect(output).toContain("2. cook [cook] Implement change");
    expect(output).toContain("3. taste [taste] Review result");
  });

  it("runs one explicit recipe step", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-recipe-cli-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "recipe",
      "run",
      "inspect-build-review",
      "--step",
      "prep",
      "--ledger-root",
      root,
      "inspect this project"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Recipe: inspect-build-review");
    expect(output).toContain("Step: prep (Inspect context)");
    expect(output).toContain("Mode: prep");
  });

  it("runs validation for review recipe steps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-recipe-cli-validation-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "recipe",
      "run",
      "inspect-build-review",
      "--step",
      "taste",
      "--ledger-root",
      root,
      "review the result"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Step: taste (Review result)");
    expect(output).toContain("Mode: taste");
    expect(output).toContain("Validation: passed");
    expect(output).toContain("Validation gate: passed");
    expect(output).toContain("Evidence: 3 record(s)");
  });

  it("runs explicit validation commands for one recipe step", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-recipe-cli-validation-command-"));
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "recipe",
      "run",
      "inspect-build-review",
      "--step",
      "taste",
      "--ledger-root",
      root,
      "--validate-command",
      JSON.stringify([process.execPath, "-e", "console.log('recipe validation ok')"]),
      "review the result"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Validation: passed");
    expect(output).toContain("Validation commands: 1 executed");
    expect(output).toContain("Validation command 1: passed");
  });

  it("rejects recipe run without an explicit step", async () => {
    await expect(
      createProgram().parseAsync(["node", "open-kitchen", "recipe", "run", "inspect-build-review", "inspect"])
    ).rejects.toThrow("requires --step");
  });

  it("rejects unknown recipe steps before execution", async () => {
    await expect(
      createProgram().parseAsync([
        "node",
        "open-kitchen",
        "recipe",
        "run",
        "inspect-build-review",
        "--step",
        "missing",
        "inspect"
      ])
    ).rejects.toThrow('Unknown step "missing"');
  });

  it("runs and shows a full recipe workflow", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-recipe-workflow-cli-"));
    const ledgerRoot = path.join(root, "runs");
    const workflowLedgerRoot = path.join(root, "recipe-workflows");
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "recipe",
      "workflow",
      "run",
      "inspect-build-review",
      "--ledger-root",
      ledgerRoot,
      "--workflow-ledger-root",
      workflowLedgerRoot,
      "inspect build and review"
    ]);

    const output = logs.join("\n");
    expect(output).toContain("Recipe workflow: completed");
    expect(output).toContain("Recipe: inspect-build-review");
    expect(output).toContain("Steps: 3 completed, 0 failed, 0 pending");
    expect(output).toContain("Context: 8 entries");
    const workflowId = output.match(/Workflow: (.+)/)?.[1];
    expect(workflowId).toBeDefined();

    logs.length = 0;
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "recipe",
      "workflow",
      "show",
      workflowId!,
      "--workflow-ledger-root",
      workflowLedgerRoot
    ]);
    expect(logs.join("\n")).toContain("1. prep [prep] completed");
  });

  it("pauses and resumes an approval-gated workflow", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-recipe-workflow-approval-cli-"));
    const ledgerRoot = path.join(root, "runs");
    const workflowLedgerRoot = path.join(root, "recipe-workflows");
    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "recipe",
      "workflow",
      "run",
      "approve-build-review",
      "--ledger-root",
      ledgerRoot,
      "--workflow-ledger-root",
      workflowLedgerRoot,
      "--require-approval-step",
      "approve",
      "coordinate this change"
    ]);

    const pausedOutput = logs.join("\n");
    expect(pausedOutput).toContain("Recipe workflow: needs_input");
    expect(pausedOutput).toContain("Context: 0 entries");
    expect(pausedOutput).toContain("Current step: approve");
    expect(pausedOutput).toContain("Pending run:");
    expect(pausedOutput).toContain("Next: open-kitchen recipe workflow resume");
    const workflowId = pausedOutput.match(/Workflow: (.+)/)?.[1];
    expect(workflowId).toBeDefined();

    logs.length = 0;
    await expect(
      createProgram().parseAsync([
        "node",
        "open-kitchen",
        "recipe",
        "workflow",
        "resume",
        workflowId!,
        "--ledger-root",
        ledgerRoot,
        "--workflow-ledger-root",
        workflowLedgerRoot
      ])
    ).rejects.toThrow("Recipe workflow resume requires --approve");

    await createProgram().parseAsync([
      "node",
      "open-kitchen",
      "recipe",
      "workflow",
      "resume",
      workflowId!,
      "--ledger-root",
      ledgerRoot,
      "--workflow-ledger-root",
      workflowLedgerRoot,
      "--approve"
    ]);
    expect(logs.join("\n")).toContain("Recipe workflow: completed");
    expect(logs.join("\n")).toContain("Context: 9 entries");

    const workflowJson = await readFile(path.join(workflowLedgerRoot, workflowId!, "workflow.json"), "utf8");
    expect(workflowJson).toContain('"status": "completed"');
  });

  it("rejects invalid workflow approval steps before execution", async () => {
    await expect(
      createProgram().parseAsync([
        "node",
        "open-kitchen",
        "recipe",
        "workflow",
        "run",
        "inspect-build-review",
        "--require-approval-step",
        "cook",
        "inspect build review"
      ])
    ).rejects.toThrow('Step "cook" uses Cook');
  });
});
