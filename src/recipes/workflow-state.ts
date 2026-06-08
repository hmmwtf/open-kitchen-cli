import type { RunResult } from "../core/types.js";
import type { LedgerResult } from "../ledger/types.js";
import { isoNow } from "../utils/time.js";
import type { RecipeWorkflowRun, RecipeWorkflowState, RecipeWorkflowStepRun } from "./workflow-types.js";

export function createEmptyWorkflowState(): RecipeWorkflowState {
  return {
    version: "0.2",
    steps: [],
    artifacts: [],
    facts: [],
    validation: [],
    banquet: []
  };
}

export function ensureWorkflowState(workflow: RecipeWorkflowRun): void {
  workflow.state ??= createEmptyWorkflowState();
  workflow.stateVersion = "0.2";
  workflow.stateFactCount = workflow.state.facts.length;
  workflow.stateArtifactCount = workflow.state.artifacts.length;
}

export function hasWorkflowStateData(state: RecipeWorkflowState): boolean {
  return (
    state.steps.length > 0 ||
    state.artifacts.length > 0 ||
    state.facts.length > 0 ||
    state.validation.length > 0 ||
    state.banquet.length > 0 ||
    Boolean(state.lastCompletedStepId)
  );
}

export function updateWorkflowStateFromRun(
  workflow: RecipeWorkflowRun,
  stepRun: RecipeWorkflowStepRun,
  result: RunResult | LedgerResult
): void {
  ensureWorkflowState(workflow);
  if (result.status !== "completed" || stepRun.status !== "completed") {
    return;
  }

  const runId = result.runId;
  removeStateForStep(workflow.state, stepRun.stepId);

  const artifactNames = result.outputs.map((output) => output.artifactName);
  workflow.state.steps.push({
    stepId: stepRun.stepId,
    stepTitle: stepRun.stepTitle,
    stepIndex: stepRun.stepIndex,
    mode: stepRun.mode,
    status: "completed",
    runId,
    summary: result.summary,
    outputCount: result.outputs.length,
    artifactNames
  });

  workflow.state.artifacts.push(
    ...result.outputs.map((output) => ({
      type: "agent_output" as const,
      stepId: stepRun.stepId,
      runId,
      taskId: output.taskId,
      name: output.artifactName
    }))
  );

  workflow.state.facts.push({
    id: `${stepRun.stepId}.step_completed`,
    type: "step_completed",
    stepId: stepRun.stepId,
    runId,
    summary: `${stepRun.stepTitle} completed with ${result.outputs.length} output(s).`
  });

  if (result.validation) {
    workflow.state.validation.push({
      stepId: stepRun.stepId,
      runId,
      status: result.validation.status,
      gateStatus: result.validation.gateStatus,
      policy: result.validation.policy,
      summary: result.validation.summary,
      evidenceCount: result.validation.evidence.length,
      checkCount: result.validation.checks.length,
      commandCount: result.validation.commandResults?.length ?? 0,
      artifactName: result.validation.artifactName
    });
    workflow.state.artifacts.push({
      type: "validation_report",
      stepId: stepRun.stepId,
      runId,
      name: result.validation.artifactName
    });
    workflow.state.facts.push({
      id: `${stepRun.stepId}.${result.validation.gateStatus === "failed" ? "validation_failed" : "validation_passed"}`,
      type: result.validation.gateStatus === "failed" ? "validation_failed" : "validation_passed",
      stepId: stepRun.stepId,
      runId,
      summary: result.validation.summary
    });
  }

  if (result.banquet) {
    workflow.state.banquet.push({
      stepId: stepRun.stepId,
      runId,
      status: result.banquet.reconciliation.status,
      summary: result.banquet.reconciliation.summary,
      workerCount: result.banquet.workers.length,
      conflictCount: result.banquet.conflicts.length,
      acceptedTaskIds: result.banquet.reconciliation.acceptedTaskIds,
      rejectedTaskIds: result.banquet.reconciliation.rejectedTaskIds,
      artifactName: "banquet-reconciliation.md"
    });
    workflow.state.artifacts.push({
      type: "banquet_reconciliation",
      stepId: stepRun.stepId,
      runId,
      name: "banquet-reconciliation.md"
    });
    workflow.state.facts.push({
      id: `${stepRun.stepId}.banquet_reconciled`,
      type: "banquet_reconciled",
      stepId: stepRun.stepId,
      runId,
      summary: result.banquet.reconciliation.summary
    });
  }

  workflow.state.steps.sort((a, b) => a.stepIndex - b.stepIndex);
  workflow.state.lastCompletedStepId = stepRun.stepId;
  workflow.stateUpdatedAt = isoNow();
  workflow.stateFactCount = workflow.state.facts.length;
  workflow.stateArtifactCount = workflow.state.artifacts.length;
}

export function renderPromptWithWorkflowState(prompt: string, state: RecipeWorkflowState): string {
  if (!hasWorkflowStateData(state)) {
    return prompt;
  }

  return [
    prompt,
    "",
    "--- OpenKitchen Workflow State ---",
    renderWorkflowStateJson(state),
    "--- End OpenKitchen Workflow State ---"
  ].join("\n");
}

export function renderWorkflowStateJson(state: RecipeWorkflowState): string {
  const snapshot: RecipeWorkflowState = {
    version: "0.2",
    steps: state.steps,
    artifacts: state.artifacts,
    facts: state.facts,
    validation: state.validation,
    banquet: state.banquet,
    ...(state.lastCompletedStepId ? { lastCompletedStepId: state.lastCompletedStepId } : {})
  };
  return JSON.stringify(snapshot);
}

function removeStateForStep(state: RecipeWorkflowState, stepId: string): void {
  state.steps = state.steps.filter((step) => step.stepId !== stepId);
  state.artifacts = state.artifacts.filter((artifact) => artifact.stepId !== stepId);
  state.facts = state.facts.filter((fact) => fact.stepId !== stepId);
  state.validation = state.validation.filter((validation) => validation.stepId !== stepId);
  state.banquet = state.banquet.filter((banquet) => banquet.stepId !== stepId);
}
