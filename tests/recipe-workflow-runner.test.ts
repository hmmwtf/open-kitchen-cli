import { access, mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApprovalResumeController } from "../src/core/approval-resume-controller.js";
import { FilesystemLedger } from "../src/ledger/filesystem-ledger.js";
import { RecipeWorkflowLedger } from "../src/recipes/workflow-ledger.js";
import { RecipeWorkflowRunner } from "../src/recipes/workflow-runner.js";
import { createEmptyWorkflowState, updateWorkflowStateFromRun } from "../src/recipes/workflow-state.js";
import type { RecipeWorkflowRun, RecipeWorkflowStepRun } from "../src/recipes/workflow-types.js";
import type { LedgerResult } from "../src/ledger/types.js";

describe("RecipeWorkflowRunner", () => {
  it("runs inspect-build-review sequentially and records workflow metadata in step ledgers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-workflow-"));
    const ledgerRoot = path.join(root, "runs");
    const workflowLedgerRoot = path.join(root, "recipe-workflows");

    const result = await new RecipeWorkflowRunner().run({
      recipeId: "inspect-build-review",
      prompt: "inspect build and review this project",
      ledgerRoot,
      workflowLedgerRoot
    });

    expect(result.workflow.status).toBe("completed");
    expect(result.workflow.workflowRunId).toContain("workflow");
    expect(result.workflow.steps.map((step) => step.stepId)).toEqual(["prep", "cook", "taste"]);
    expect(result.workflow.steps.map((step) => step.stepIndex)).toEqual([1, 2, 3]);
    expect(result.workflow.steps.every((step) => step.totalSteps === 3)).toBe(true);
    expect(result.workflow.steps.every((step) => step.status === "completed")).toBe(true);
    expect(result.workflow.steps.every((step) => step.runId)).toBe(true);

    const runs = await readdir(ledgerRoot);
    expect(runs).toHaveLength(3);
    const prepResult = JSON.parse(
      await readFile(path.join(ledgerRoot, result.workflow.steps[0].runId!, "result.json"), "utf8")
    ) as { recipeContext: { workflowRunId: string; stepIndex: number; totalSteps: number } };
    expect(prepResult.recipeContext.workflowRunId).toBe(result.workflow.workflowRunId);
    expect(prepResult.recipeContext.stepIndex).toBe(1);
    expect(prepResult.recipeContext.totalSteps).toBe(3);
    expect(result.workflow.context.entries.map((entry) => entry.stepId)).toEqual([
      "prep",
      "prep",
      "cook",
      "cook",
      "cook",
      "taste",
      "taste",
      "taste"
    ]);
    expect(result.workflow.contextEntryCount).toBe(8);
    expect(result.workflow.state.version).toBe("0.2");
    expect(result.workflow.stateVersion).toBe("0.2");
    expect(result.workflow.state.steps.map((step) => step.stepId)).toEqual(["prep", "cook", "taste"]);
    expect(result.workflow.state.lastCompletedStepId).toBe("taste");
    expect(result.workflow.stateArtifactCount).toBe(result.workflow.state.artifacts.length);
    expect(result.workflow.stateFactCount).toBe(result.workflow.state.facts.length);

    await expect(readFile(path.join(result.ledgerPath, "workflow.json"), "utf8")).resolves.toContain(
      result.workflow.workflowRunId
    );
    await expect(readFile(path.join(result.ledgerPath, "steps.json"), "utf8")).resolves.toContain('"stepId": "prep"');
    await expect(readFile(path.join(result.ledgerPath, "context.json"), "utf8")).resolves.toContain('"key": "prep.result"');
    await expect(readFile(path.join(result.ledgerPath, "state.json"), "utf8")).resolves.toContain('"version": "0.2"');
    await expect(readFile(path.join(result.ledgerPath, "result.json"), "utf8")).resolves.toContain('"status": "completed"');
    await expect(readFile(path.join(result.ledgerPath, "result.md"), "utf8")).resolves.toContain(
      "OpenKitchen Recipe Workflow Result"
    );
    await expect(readFile(path.join(result.ledgerPath, "result.md"), "utf8")).resolves.toContain("## Workflow State");
    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    expect(events).toContain("recipe.workflow.started");
    expect(events).toContain("recipe.workflow.context.initialized");
    expect(events).toContain("recipe.workflow.state.initialized");
    expect(events).toContain("recipe.workflow.state.attached");
    expect(events).toContain("recipe.workflow.context.updated");
    expect(events).toContain("recipe.workflow.state.updated");
    expect(events).toContain("recipe.workflow.step.started");
    expect(events).toContain("recipe.workflow.step.completed");
    expect(events).toContain("recipe.workflow.completed");
  });

  it("attaches accumulated workflow state to later step prompts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-workflow-context-"));
    const ledgerRoot = path.join(root, "runs");
    const workflowLedgerRoot = path.join(root, "recipe-workflows");

    const result = await new RecipeWorkflowRunner().run({
      recipeId: "inspect-build-review",
      prompt: "inspect build and review",
      ledgerRoot,
      workflowLedgerRoot
    });

    const prepPrompt = await readFile(path.join(ledgerRoot, result.workflow.steps[0].runId!, "prompt.txt"), "utf8");
    const cookPrompt = await readFile(path.join(ledgerRoot, result.workflow.steps[1].runId!, "prompt.txt"), "utf8");
    const tastePrompt = await readFile(path.join(ledgerRoot, result.workflow.steps[2].runId!, "prompt.txt"), "utf8");

    expect(prepPrompt).not.toContain("OpenKitchen Workflow Context");
    expect(prepPrompt).not.toContain("OpenKitchen Workflow State");
    expect(cookPrompt).not.toContain("OpenKitchen Workflow Context");
    expect(cookPrompt).toContain("OpenKitchen Workflow State");
    expect(cookPrompt).toContain('"stepId":"prep"');
    expect(cookPrompt).toContain('"lastCompletedStepId":"prep"');
    expect(cookPrompt).not.toContain('"output":"# Mock Agent Output');
    expect(cookPrompt).not.toContain('"key": "cook.result"');
    expect(tastePrompt).not.toContain("OpenKitchen Workflow Context");
    expect(tastePrompt).toContain('"stepId":"prep"');
    expect(tastePrompt).toContain('"stepId":"cook"');
    expect(tastePrompt).toContain('"lastCompletedStepId":"cook"');
  });

  it("stops on failed validation and marks later steps skipped", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-workflow-fail-"));
    const result = await new RecipeWorkflowRunner().run({
      recipeId: "inspect-build-review",
      prompt: "review this mock validation fail",
      ledgerRoot: path.join(root, "runs"),
      workflowLedgerRoot: path.join(root, "recipe-workflows")
    });

    expect(result.workflow.status).toBe("failed");
    expect(result.workflow.currentStepId).toBe("cook");
    expect(result.workflow.steps.map((step) => step.status)).toEqual(["completed", "failed", "skipped"]);
    expect(result.workflow.steps[1].validationGateStatus).toBe("failed");
    expect(result.workflow.context.entries.map((entry) => entry.stepId)).toEqual(["prep", "prep"]);
    expect(result.workflow.state.steps.map((step) => step.stepId)).toEqual(["prep"]);
    expect(result.workflow.state.lastCompletedStepId).toBe("prep");
    expect(result.workflow.state.facts.map((fact) => fact.stepId)).toEqual(["prep"]);

    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    expect(events).toContain("recipe.workflow.step.failed");
    expect(events).toContain("recipe.workflow.failed");
  });

  it("passes stored validation commands into validating workflow steps and stops on command failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-workflow-validation-command-"));
    const ledgerRoot = path.join(root, "runs");
    const workflowLedgerRoot = path.join(root, "recipe-workflows");
    const result = await new RecipeWorkflowRunner().run({
      recipeId: "inspect-build-review",
      prompt: "inspect build and review",
      ledgerRoot,
      workflowLedgerRoot,
      validationCommands: [
        {
          id: "1",
          argv: [process.execPath, "-e", "process.exit(3)"],
          timeoutMs: 10000
        }
      ]
    });

    expect(result.workflow.status).toBe("failed");
    expect(result.workflow.currentStepId).toBe("cook");
    expect(result.workflow.validationCommands?.[0].argv[0]).toBe(process.execPath);
    expect(result.workflow.steps.map((step) => step.status)).toEqual(["completed", "failed", "skipped"]);
    expect(result.workflow.state.validation).toEqual([]);

    const cookResult = JSON.parse(
      await readFile(path.join(ledgerRoot, result.workflow.steps[1].runId!, "result.json"), "utf8")
    ) as { validation: { commandResults: Array<{ status: string; exitCode: number }> } };
    expect(cookResult.validation.commandResults[0]).toMatchObject({ status: "failed", exitCode: 3 });
  });

  it("records validation summaries and command counts in workflow state for completed steps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-workflow-state-validation-"));
    const result = await new RecipeWorkflowRunner().run({
      recipeId: "inspect-build-review",
      prompt: "inspect build and review",
      ledgerRoot: path.join(root, "runs"),
      workflowLedgerRoot: path.join(root, "recipe-workflows"),
      validationCommands: [
        {
          id: "1",
          argv: [process.execPath, "-e", "process.exit(0)"],
          timeoutMs: 10000
        }
      ]
    });

    expect(result.workflow.status).toBe("completed");
    expect(result.workflow.state.validation.map((summary) => summary.stepId)).toEqual(["cook", "taste"]);
    expect(result.workflow.state.validation.every((summary) => summary.commandCount === 1)).toBe(true);
    expect(result.workflow.state.artifacts.some((artifact) => artifact.type === "validation_report")).toBe(true);
    expect(result.workflow.state.facts.some((fact) => fact.type === "validation_passed")).toBe(true);
  });

  it("pauses on approval, stores the pending run, and resumes remaining steps without re-running completed work", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-workflow-resume-"));
    const ledgerRoot = path.join(root, "runs");
    const workflowLedgerRoot = path.join(root, "recipe-workflows");
    const runner = new RecipeWorkflowRunner();

    const paused = await runner.run({
      recipeId: "approve-build-review",
      prompt: "coordinate this change",
      ledgerRoot,
      workflowLedgerRoot,
      requireApprovalSteps: ["approve"]
    });

    expect(paused.workflow.status).toBe("needs_input");
    expect(paused.workflow.currentStepId).toBe("approve");
    expect(paused.workflow.steps.map((step) => step.status)).toEqual(["needs_input", "pending", "pending"]);
    expect(paused.workflow.context.entries).toEqual([]);
    expect(paused.workflow.state.version).toBe("0.2");
    expect(paused.workflow.state.steps).toEqual([]);
    expect(paused.workflow.state.facts).toEqual([]);
    const pendingRunId = paused.workflow.steps[0].runId;
    expect(pendingRunId).toBeDefined();

    const resumed = await runner.resume({
      workflowRunId: paused.workflow.workflowRunId,
      ledgerRoot,
      workflowLedgerRoot,
      approve: true
    });

    expect(resumed.workflow.status).toBe("completed");
    expect(resumed.workflow.steps.map((step) => step.status)).toEqual(["completed", "completed", "completed"]);
    expect(resumed.workflow.steps[0].runId).toBe(pendingRunId);
    expect(resumed.workflow.context.entries.filter((entry) => entry.stepId === "approve")).toHaveLength(3);
    expect(resumed.workflow.context.entries.filter((entry) => entry.stepId === "cook")).toHaveLength(3);
    expect(resumed.workflow.context.entries.filter((entry) => entry.stepId === "taste")).toHaveLength(3);
    expect(resumed.workflow.state.steps.map((step) => step.stepId)).toEqual(["approve", "cook", "taste"]);
    expect(resumed.workflow.state.steps[0].runId).toBe(pendingRunId);
    expect(resumed.workflow.state.lastCompletedStepId).toBe("taste");
    const runs = await readdir(ledgerRoot);
    expect(runs).toHaveLength(3);

    const events = await readFile(path.join(resumed.ledgerPath, "events.jsonl"), "utf8");
    expect(events).toContain("recipe.workflow.paused");
    expect(events).toContain("recipe.workflow.resumed");
    expect(events).toContain("recipe.workflow.completed");
  });

  it("top-level approval resume does not continue the paused workflow", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-workflow-top-resume-"));
    const ledgerRoot = path.join(root, "runs");
    const workflowLedgerRoot = path.join(root, "recipe-workflows");
    const paused = await new RecipeWorkflowRunner().run({
      recipeId: "approve-build-review",
      prompt: "coordinate this change",
      ledgerRoot,
      workflowLedgerRoot,
      requireApprovalSteps: ["approve"]
    });

    await new ApprovalResumeController().resume({
      runId: paused.workflow.steps[0].runId!,
      ledgerRoot,
      approve: true
    });

    const stored = await new RecipeWorkflowLedger(workflowLedgerRoot).readWorkflow(paused.workflow.workflowRunId);
    expect(stored.status).toBe("needs_input");
    expect(stored.steps.map((step) => step.status)).toEqual(["needs_input", "pending", "pending"]);
    expect(stored.context.entries).toEqual([]);
    expect(stored.state.steps).toEqual([]);
    expect(stored.state.facts).toEqual([]);
    const runs = await readdir(ledgerRoot);
    expect(runs).toHaveLength(1);
  });

  it("derives Banquet reconciliation summaries in workflow state when a completed step has Banquet data", () => {
    const workflow = workflowFixture();
    const stepRun = workflow.steps[0];
    const result = {
      runId: "run-banquet",
      mode: "banquet",
      status: "completed",
      summary: "Banquet completed parallel_tasks mock execution with 3 output(s).",
      policy: { strategy: "parallel_tasks" },
      tasks: [],
      outputs: [
        {
          taskId: "task-1",
          agentRole: "worker",
          status: "completed",
          artifactName: "agent-output-task-1.md",
          output: "full output should not enter state"
        }
      ],
      banquet: {
        workers: [{ id: "worker-1", role: "worker", label: "Worker 1", status: "completed", assignedTaskIds: ["task-1"] }],
        conflicts: [],
        reconciliation: {
          status: "completed",
          summary: "Banquet reconciliation completed.",
          acceptedTaskIds: ["task-1"],
          rejectedTaskIds: [],
          notes: []
        }
      }
    } as unknown as LedgerResult;

    updateWorkflowStateFromRun(workflow, stepRun, result);

    expect(workflow.state.banquet).toEqual([
      {
        stepId: "banquet",
        runId: "run-banquet",
        status: "completed",
        summary: "Banquet reconciliation completed.",
        workerCount: 1,
        conflictCount: 0,
        acceptedTaskIds: ["task-1"],
        rejectedTaskIds: [],
        artifactName: "banquet-reconciliation.md"
      }
    ]);
    expect(workflow.state.artifacts.map((artifact) => artifact.type)).toContain("banquet_reconciliation");
    expect(workflow.state.facts.map((fact) => fact.type)).toContain("banquet_reconciled");
    expect(JSON.stringify(workflow.state)).not.toContain("full output should not enter state");
  });

  it("keeps workflow ledgers separate from normal run listing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-workflow-ledger-"));
    const ledgerRoot = path.join(root, "runs");
    const workflowLedgerRoot = path.join(root, "recipe-workflows");
    const result = await new RecipeWorkflowRunner().run({
      recipeId: "inspect-build-review",
      prompt: "inspect build and review",
      ledgerRoot,
      workflowLedgerRoot
    });

    const runs = await new FilesystemLedger(ledgerRoot).listRuns();
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.runId)).not.toContain(result.workflow.workflowRunId);
    await expect(access(path.join(workflowLedgerRoot, result.workflow.workflowRunId, "workflow.json"))).resolves.toBeUndefined();
  });

  it("rejects invalid approval steps before creating a workflow ledger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-workflow-invalid-"));
    const workflowLedgerRoot = path.join(root, "recipe-workflows");

    await expect(
      new RecipeWorkflowRunner().run({
        recipeId: "inspect-build-review",
        prompt: "inspect build review",
        ledgerRoot: path.join(root, "runs"),
        workflowLedgerRoot,
        requireApprovalSteps: ["cook"]
      })
    ).rejects.toThrow('Step "cook" uses Cook, which does not allow approval_gated policy');

    await expect(readdir(workflowLedgerRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function workflowFixture(): RecipeWorkflowRun {
  const step: RecipeWorkflowStepRun = {
    stepId: "banquet",
    stepTitle: "Reconcile parallel work",
    stepIndex: 1,
    totalSteps: 1,
    mode: "banquet",
    status: "completed",
    runId: "run-banquet"
  };
  return {
    workflowRunId: "workflow-test",
    recipeId: "test",
    recipeName: "Test",
    recipeVersion: "0.1",
    prompt: "split this work",
    status: "running",
    steps: [step],
    context: { workflowRunId: "workflow-test", version: "0.1", entries: [] },
    contextEntryCount: 0,
    state: createEmptyWorkflowState(),
    stateVersion: "0.2",
    stateFactCount: 0,
    stateArtifactCount: 0,
    startedAt: "2026-01-01T00:00:00.000Z",
    summary: "Test workflow."
  };
}
