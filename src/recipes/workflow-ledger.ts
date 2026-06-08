import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LedgerEvent } from "../ledger/types.js";
import { isoNow } from "../utils/time.js";
import { createEmptyWorkflowState, ensureWorkflowState } from "./workflow-state.js";
import type { RecipeWorkflowRun } from "./workflow-types.js";

export class RecipeWorkflowLedger {
  constructor(private readonly root = path.join(process.cwd(), ".open-kitchen", "recipe-workflows")) {}

  getRoot(): string {
    return this.root;
  }

  getWorkflowPath(workflowRunId: string): string {
    return path.join(this.root, workflowRunId);
  }

  async initializeWorkflow(workflow: RecipeWorkflowRun): Promise<string> {
    const workflowPath = this.getWorkflowPath(workflow.workflowRunId);
    await mkdir(workflowPath, { recursive: true });
    ensureWorkflowState(workflow);
    await this.writeWorkflow(workflow);
    await this.appendEvent(workflow.workflowRunId, {
      timestamp: isoNow(),
      type: "recipe.workflow.started",
      message: `Started recipe workflow ${workflow.recipeId}.`,
      data: {
        workflowRunId: workflow.workflowRunId,
        recipeId: workflow.recipeId,
        stepCount: workflow.steps.length
      }
    });
    await this.appendEvent(workflow.workflowRunId, {
      timestamp: isoNow(),
      type: "recipe.workflow.context.initialized",
      message: `Initialized workflow context for ${workflow.workflowRunId}.`,
      data: { entryCount: workflow.context.entries.length }
    });
    await this.appendEvent(workflow.workflowRunId, {
      timestamp: isoNow(),
      type: "recipe.workflow.state.initialized",
      message: `Initialized workflow state for ${workflow.workflowRunId}.`,
      data: { version: workflow.state.version, factCount: workflow.stateFactCount, artifactCount: workflow.stateArtifactCount }
    });
    return workflowPath;
  }

  async writeWorkflow(workflow: RecipeWorkflowRun): Promise<void> {
    const workflowPath = this.getWorkflowPath(workflow.workflowRunId);
    ensureWorkflowState(workflow);
    await mkdir(workflowPath, { recursive: true });
    await writeJson(path.join(workflowPath, "workflow.json"), workflow);
    await writeJson(path.join(workflowPath, "steps.json"), workflow.steps);
    await writeJson(path.join(workflowPath, "context.json"), workflow.context);
    await writeJson(path.join(workflowPath, "state.json"), workflow.state);
    await writeJson(path.join(workflowPath, "result.json"), workflow);
    await writeFile(path.join(workflowPath, "result.md"), renderWorkflowMarkdown(workflow), "utf8");
  }

  async readWorkflow(workflowRunId: string): Promise<RecipeWorkflowRun> {
    const workflow = await readJson<RecipeWorkflowRun>(path.join(this.getWorkflowPath(workflowRunId), "workflow.json"));
    workflow.state ??= createEmptyWorkflowState();
    ensureWorkflowState(workflow);
    return workflow;
  }

  async appendEvent(workflowRunId: string, event: LedgerEvent): Promise<void> {
    const workflowPath = this.getWorkflowPath(workflowRunId);
    await mkdir(workflowPath, { recursive: true });
    await appendFile(path.join(workflowPath, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function renderWorkflowMarkdown(workflow: RecipeWorkflowRun): string {
  return [
    "# OpenKitchen Recipe Workflow Result",
    "",
    `- Workflow: ${workflow.workflowRunId}`,
    `- Recipe: ${workflow.recipeId} (${workflow.recipeName})`,
    `- Version: ${workflow.recipeVersion}`,
    `- Status: ${workflow.status}`,
    `- Context entries: ${workflow.contextEntryCount}`,
    `- State version: ${workflow.state.version}`,
    `- State facts: ${workflow.stateFactCount}`,
    `- State artifacts: ${workflow.stateArtifactCount}`,
    ...(workflow.state.lastCompletedStepId ? [`- Last completed step: ${workflow.state.lastCompletedStepId}`] : []),
    ...(workflow.currentStepId ? [`- Current step: ${workflow.currentStepId}`] : []),
    `- Started: ${workflow.startedAt}`,
    ...(workflow.completedAt ? [`- Completed: ${workflow.completedAt}`] : []),
    "",
    "## Steps",
    "",
    ...workflow.steps.map((step) =>
      [
        `- ${step.stepIndex}/${step.totalSteps} ${step.stepId} [${step.mode}] ${step.status}`,
        ...(step.runId ? [`  Run: ${step.runId}`] : []),
        ...(step.validationGateStatus ? [`  Validation gate: ${step.validationGateStatus}`] : []),
        ...(step.summary ? [`  Summary: ${step.summary}`] : [])
      ].join("\n")
    ),
    "",
    "## Context",
    "",
    `Entries: ${workflow.context.entries.length}`,
    ...(workflow.context.updatedAt ? [`Updated: ${workflow.context.updatedAt}`] : []),
    ...workflow.context.entries.map((entry) => `- ${entry.key}: ${entry.summary}`),
    "",
    "## Workflow State",
    "",
    `Version: ${workflow.state.version}`,
    `Steps: ${workflow.state.steps.length}`,
    `Facts: ${workflow.stateFactCount}`,
    `Artifacts: ${workflow.stateArtifactCount}`,
    ...(workflow.state.lastCompletedStepId ? [`Last completed step: ${workflow.state.lastCompletedStepId}`] : []),
    "",
    "## Summary",
    "",
    workflow.summary
  ].join("\n");
}
