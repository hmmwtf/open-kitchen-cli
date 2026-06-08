import type { ModeName } from "../core/types.js";
import type { ValidationCommand } from "../validation/types.js";

export type RecipeWorkflowStatus = "running" | "completed" | "failed" | "needs_input";

export type RecipeWorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "needs_input"
  | "skipped";

export interface RecipeWorkflowRun {
  workflowRunId: string;
  recipeId: string;
  recipeName: string;
  recipeVersion: string;
  prompt: string;
  status: RecipeWorkflowStatus;
  currentStepId?: string;
  steps: RecipeWorkflowStepRun[];
  requireApprovalStepIds?: string[];
  validationCommands?: ValidationCommand[];
  context: RecipeWorkflowContext;
  contextEntryCount: number;
  contextUpdatedAt?: string;
  state: RecipeWorkflowState;
  stateVersion: "0.2";
  stateUpdatedAt?: string;
  stateFactCount: number;
  stateArtifactCount: number;
  startedAt: string;
  completedAt?: string;
  summary: string;
}

export interface RecipeWorkflowStepRun {
  stepId: string;
  stepTitle: string;
  stepIndex: number;
  totalSteps: number;
  mode: ModeName;
  status: RecipeWorkflowStepStatus;
  runId?: string;
  ledgerPath?: string;
  summary?: string;
  validationStatus?: string;
  validationGateStatus?: string;
}

export interface RecipeWorkflowResult {
  workflow: RecipeWorkflowRun;
  ledgerPath: string;
}

export type WorkflowContextEntryType =
  | "step_result"
  | "agent_output"
  | "validation_summary"
  | "banquet_summary";

export interface RecipeWorkflowContext {
  workflowRunId: string;
  version: "0.1";
  entries: WorkflowContextEntry[];
  updatedAt?: string;
}

export interface WorkflowContextEntry {
  id: string;
  type: WorkflowContextEntryType;
  stepId: string;
  stepTitle: string;
  stepIndex: number;
  mode: ModeName;
  runId: string;
  createdAt: string;
  key: string;
  value: unknown;
  summary: string;
}

export type WorkflowStateFactType =
  | "step_completed"
  | "validation_passed"
  | "validation_failed"
  | "banquet_reconciled";

export type WorkflowStateArtifactType =
  | "agent_output"
  | "validation_report"
  | "banquet_reconciliation";

export interface RecipeWorkflowState {
  version: "0.2";
  steps: WorkflowStateStep[];
  artifacts: WorkflowStateArtifact[];
  facts: WorkflowStateFact[];
  validation: WorkflowStateValidationSummary[];
  banquet: WorkflowStateBanquetSummary[];
  lastCompletedStepId?: string;
}

export interface WorkflowStateStep {
  stepId: string;
  stepTitle: string;
  stepIndex: number;
  mode: ModeName;
  status: "completed";
  runId: string;
  summary: string;
  outputCount: number;
  artifactNames: string[];
}

export interface WorkflowStateArtifact {
  type: WorkflowStateArtifactType;
  stepId: string;
  runId: string;
  name: string;
  taskId?: string;
}

export interface WorkflowStateFact {
  id: string;
  type: WorkflowStateFactType;
  stepId: string;
  runId: string;
  summary: string;
}

export interface WorkflowStateValidationSummary {
  stepId: string;
  runId: string;
  status: string;
  gateStatus: string;
  policy: string;
  summary: string;
  evidenceCount: number;
  checkCount: number;
  commandCount: number;
  artifactName: string;
}

export interface WorkflowStateBanquetSummary {
  stepId: string;
  runId: string;
  status: string;
  summary: string;
  workerCount: number;
  conflictCount: number;
  acceptedTaskIds: string[];
  rejectedTaskIds: string[];
  artifactName: string;
}
