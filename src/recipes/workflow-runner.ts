import type { AgentAdapterName } from "../agents/adapter.js";
import { ApprovalResumeController } from "../core/approval-resume-controller.js";
import { RunController } from "../core/run-controller.js";
import type { RunResult } from "../core/types.js";
import { FilesystemLedger } from "../ledger/filesystem-ledger.js";
import type { LedgerResult } from "../ledger/types.js";
import { getMode } from "../modes/registry.js";
import { createWorkflowRunId } from "../utils/ids.js";
import { isoNow } from "../utils/time.js";
import type { ValidationCommand } from "../validation/types.js";
import { getRecipe } from "./registry.js";
import type { RecipeDefinition } from "./types.js";
import { RecipeWorkflowLedger } from "./workflow-ledger.js";
import {
  createEmptyWorkflowState,
  ensureWorkflowState,
  hasWorkflowStateData,
  renderPromptWithWorkflowState,
  updateWorkflowStateFromRun
} from "./workflow-state.js";
import type { RecipeWorkflowResult, RecipeWorkflowRun, RecipeWorkflowStepRun } from "./workflow-types.js";

export interface RecipeWorkflowRunRequest {
  recipeId: string;
  prompt: string;
  adapter?: AgentAdapterName;
  ledgerRoot?: string;
  workflowLedgerRoot?: string;
  forceTasks?: boolean;
  requireApprovalSteps?: string[];
  validationCommands?: ValidationCommand[];
}

export interface RecipeWorkflowResumeRequest {
  workflowRunId: string;
  ledgerRoot?: string;
  workflowLedgerRoot?: string;
  adapter?: AgentAdapterName;
  forceTasks?: boolean;
  approve: boolean;
  validationCommands?: ValidationCommand[];
}

export class RecipeWorkflowRunner {
  async run(request: RecipeWorkflowRunRequest): Promise<RecipeWorkflowResult> {
    const recipe = getRecipe(request.recipeId);
    const requireApprovalSteps = request.requireApprovalSteps ?? [];
    validateApprovalSteps(recipe, requireApprovalSteps);
    const workflowRunId = createWorkflowRunId();

    const workflow: RecipeWorkflowRun = {
      workflowRunId,
      recipeId: recipe.id,
      recipeName: recipe.name,
      recipeVersion: recipe.version,
      prompt: request.prompt,
      status: "running",
      requireApprovalStepIds: uniqueValues(requireApprovalSteps),
      validationCommands: request.validationCommands,
      steps: recipe.steps.map((step, index) => ({
        stepId: step.id,
        stepTitle: step.title,
        stepIndex: index + 1,
        totalSteps: recipe.steps.length,
        mode: step.mode,
        status: "pending"
      })),
      context: {
        workflowRunId,
        version: "0.1",
        entries: []
      },
      contextEntryCount: 0,
      state: createEmptyWorkflowState(),
      stateVersion: "0.2",
      stateUpdatedAt: isoNow(),
      stateFactCount: 0,
      stateArtifactCount: 0,
      startedAt: isoNow(),
      summary: `Recipe workflow ${recipe.id} is running.`
    };

    const workflowLedger = new RecipeWorkflowLedger(request.workflowLedgerRoot);
    const ledgerPath = await workflowLedger.initializeWorkflow(workflow);
    await this.continueFromIndex({
      workflow,
      startIndex: 0,
      adapter: request.adapter,
      ledgerRoot: request.ledgerRoot,
      forceTasks: request.forceTasks ?? false,
      requireApprovalSteps,
      validationCommands: request.validationCommands,
      workflowLedger
    });

    return { workflow, ledgerPath };
  }

  async resume(request: RecipeWorkflowResumeRequest): Promise<RecipeWorkflowResult> {
    if (!request.approve) {
      throw new Error("Recipe workflow resume requires --approve.");
    }

    const workflowLedger = new RecipeWorkflowLedger(request.workflowLedgerRoot);
    const workflow = await workflowLedger.readWorkflow(request.workflowRunId);
    ensureWorkflowState(workflow);
    if (workflow.status === "completed") {
      throw new Error("Completed recipe workflows cannot be resumed.");
    }
    if (workflow.status === "failed") {
      throw new Error("Failed recipe workflows cannot be resumed.");
    }
    if (workflow.status !== "needs_input") {
      throw new Error("Recipe workflow is not pending input.");
    }
    if (!workflow.currentStepId) {
      throw new Error("Recipe workflow has no pending step.");
    }

    const pendingIndex = workflow.steps.findIndex((step) => step.stepId === workflow.currentStepId);
    const pendingStep = workflow.steps[pendingIndex];
    if (!pendingStep?.runId) {
      throw new Error("Recipe workflow pending step has no run id.");
    }

    await workflowLedger.appendEvent(workflow.workflowRunId, {
      timestamp: isoNow(),
      type: "recipe.workflow.resumed",
      message: `Resumed recipe workflow ${workflow.workflowRunId}.`,
      data: { stepId: pendingStep.stepId, runId: pendingStep.runId }
    });

    const approved = await new ApprovalResumeController().resume({
      runId: pendingStep.runId,
      ledgerRoot: request.ledgerRoot,
      approve: true
    });
    const approvedRun = await new FilesystemLedger(request.ledgerRoot).readResult(pendingStep.runId);

    Object.assign(pendingStep, {
      status: "completed",
      ledgerPath: approved.ledgerPath,
      summary: approved.summary
    } satisfies Partial<RecipeWorkflowStepRun>);
    workflow.status = "running";
    workflow.currentStepId = undefined;
    workflow.summary = `Recipe workflow ${workflow.recipeId} resumed.`;
    appendRunContextEntries(workflow, pendingStep, approvedRun);
    updateWorkflowStateFromRun(workflow, pendingStep, approvedRun);
    await workflowLedger.writeWorkflow(workflow);
    await workflowLedger.appendEvent(workflow.workflowRunId, {
      timestamp: isoNow(),
      type: "recipe.workflow.context.updated",
      message: `Updated workflow context from step ${pendingStep.stepId}.`,
      data: { stepId: pendingStep.stepId, entryCount: workflow.context.entries.length }
    });
    await workflowLedger.appendEvent(workflow.workflowRunId, {
      timestamp: isoNow(),
      type: "recipe.workflow.state.updated",
      message: `Updated workflow state from step ${pendingStep.stepId}.`,
      data: {
        stepId: pendingStep.stepId,
        factCount: workflow.stateFactCount,
        artifactCount: workflow.stateArtifactCount,
        lastCompletedStepId: workflow.state.lastCompletedStepId
      }
    });
    await workflowLedger.appendEvent(workflow.workflowRunId, {
      timestamp: isoNow(),
      type: "recipe.workflow.step.completed",
      message: `Completed recipe workflow step ${pendingStep.stepId}.`,
      data: { stepId: pendingStep.stepId, runId: pendingStep.runId, status: "completed" }
    });

    await this.continueFromIndex({
      workflow,
      startIndex: pendingIndex + 1,
      adapter: request.adapter,
      ledgerRoot: request.ledgerRoot,
      forceTasks: request.forceTasks ?? false,
      requireApprovalSteps: workflow.requireApprovalStepIds ?? [],
      validationCommands: request.validationCommands ?? workflow.validationCommands,
      workflowLedger
    });

    return {
      workflow,
      ledgerPath: workflowLedger.getWorkflowPath(workflow.workflowRunId)
    };
  }

  async show(workflowRunId: string, workflowLedgerRoot?: string): Promise<RecipeWorkflowResult> {
    const workflowLedger = new RecipeWorkflowLedger(workflowLedgerRoot);
    const workflow = await workflowLedger.readWorkflow(workflowRunId);
    ensureWorkflowState(workflow);
    return {
      workflow,
      ledgerPath: workflowLedger.getWorkflowPath(workflowRunId)
    };
  }

  private async continueFromIndex(input: {
    workflow: RecipeWorkflowRun;
    startIndex: number;
    adapter?: AgentAdapterName;
    ledgerRoot?: string;
    forceTasks: boolean;
    requireApprovalSteps: string[];
    validationCommands?: ValidationCommand[];
    workflowLedger: RecipeWorkflowLedger;
  }): Promise<void> {
    const recipe = getRecipe(input.workflow.recipeId);
    const requireApprovalStepIds = new Set(input.requireApprovalSteps);
    ensureWorkflowState(input.workflow);

    for (let index = input.startIndex; index < input.workflow.steps.length; index += 1) {
      const stepRun = input.workflow.steps[index];
      const stepDefinition = recipe.steps[index];
      stepRun.status = "running";
      input.workflow.status = "running";
      input.workflow.currentStepId = stepRun.stepId;
      input.workflow.summary = `Running recipe workflow step ${stepRun.stepId}.`;
      await input.workflowLedger.writeWorkflow(input.workflow);
      await input.workflowLedger.appendEvent(input.workflow.workflowRunId, {
        timestamp: isoNow(),
        type: "recipe.workflow.step.started",
        message: `Started recipe workflow step ${stepRun.stepId}.`,
        data: { stepId: stepRun.stepId, mode: stepRun.mode, stepIndex: stepRun.stepIndex }
      });
      const prompt = renderPromptWithWorkflowState(input.workflow.prompt, input.workflow.state);
      if (hasWorkflowStateData(input.workflow.state)) {
        await input.workflowLedger.appendEvent(input.workflow.workflowRunId, {
          timestamp: isoNow(),
          type: "recipe.workflow.state.attached",
          message: `Attached workflow state to step ${stepRun.stepId}.`,
          data: {
            stepId: stepRun.stepId,
            factCount: input.workflow.stateFactCount,
            artifactCount: input.workflow.stateArtifactCount,
            lastCompletedStepId: input.workflow.state.lastCompletedStepId
          }
        });
      }

      const result = await new RunController().run({
        mode: stepRun.mode,
        prompt,
        adapter: input.adapter,
        ledgerRoot: input.ledgerRoot,
        forceTasks: input.forceTasks,
        requireApproval: requireApprovalStepIds.has(stepRun.stepId),
        validationCommands: input.validationCommands,
        recipeContext: {
          recipeId: recipe.id,
          recipeName: recipe.name,
          stepId: stepDefinition.id,
          stepTitle: stepDefinition.title,
          workflowRunId: input.workflow.workflowRunId,
          stepIndex: index + 1,
          totalSteps: input.workflow.steps.length
        }
      });

      stepRun.runId = result.runId;
      stepRun.ledgerPath = result.ledgerPath;
      stepRun.summary = result.summary;
      stepRun.validationStatus = result.validation?.status;
      stepRun.validationGateStatus = result.validation?.gateStatus;

      if (result.status === "completed") {
        stepRun.status = "completed";
        appendRunContextEntries(input.workflow, stepRun, result);
        updateWorkflowStateFromRun(input.workflow, stepRun, result);
        await input.workflowLedger.writeWorkflow(input.workflow);
        await input.workflowLedger.appendEvent(input.workflow.workflowRunId, {
          timestamp: isoNow(),
          type: "recipe.workflow.context.updated",
          message: `Updated workflow context from step ${stepRun.stepId}.`,
          data: { stepId: stepRun.stepId, entryCount: input.workflow.context.entries.length }
        });
        await input.workflowLedger.appendEvent(input.workflow.workflowRunId, {
          timestamp: isoNow(),
          type: "recipe.workflow.state.updated",
          message: `Updated workflow state from step ${stepRun.stepId}.`,
          data: {
            stepId: stepRun.stepId,
            factCount: input.workflow.stateFactCount,
            artifactCount: input.workflow.stateArtifactCount,
            lastCompletedStepId: input.workflow.state.lastCompletedStepId
          }
        });
        await input.workflowLedger.appendEvent(input.workflow.workflowRunId, {
          timestamp: isoNow(),
          type: "recipe.workflow.step.completed",
          message: `Completed recipe workflow step ${stepRun.stepId}.`,
          data: { stepId: stepRun.stepId, runId: result.runId, status: result.status }
        });
        continue;
      }

      if (result.status === "needs_input") {
        stepRun.status = "needs_input";
        input.workflow.status = "needs_input";
        input.workflow.currentStepId = stepRun.stepId;
        input.workflow.summary = `Recipe workflow ${input.workflow.recipeId} is waiting for input on step ${stepRun.stepId}.`;
        await input.workflowLedger.writeWorkflow(input.workflow);
        await input.workflowLedger.appendEvent(input.workflow.workflowRunId, {
          timestamp: isoNow(),
          type: "recipe.workflow.paused",
          message: `Paused recipe workflow at step ${stepRun.stepId}.`,
          data: { stepId: stepRun.stepId, runId: result.runId }
        });
        return;
      }

      stepRun.status = "failed";
      input.workflow.status = "failed";
      input.workflow.currentStepId = stepRun.stepId;
      input.workflow.completedAt = isoNow();
      input.workflow.summary = `Recipe workflow ${input.workflow.recipeId} failed at step ${stepRun.stepId}.`;
      markRemainingSkipped(input.workflow.steps, index + 1);
      await input.workflowLedger.writeWorkflow(input.workflow);
      await input.workflowLedger.appendEvent(input.workflow.workflowRunId, {
        timestamp: isoNow(),
        type: "recipe.workflow.step.failed",
        message: `Failed recipe workflow step ${stepRun.stepId}.`,
        data: { stepId: stepRun.stepId, runId: result.runId, status: result.status }
      });
      await input.workflowLedger.appendEvent(input.workflow.workflowRunId, {
        timestamp: isoNow(),
        type: "recipe.workflow.failed",
        message: input.workflow.summary,
        data: { currentStepId: input.workflow.currentStepId }
      });
      return;
    }

    input.workflow.status = "completed";
    input.workflow.currentStepId = undefined;
    input.workflow.completedAt = isoNow();
    input.workflow.summary = `Recipe workflow ${input.workflow.recipeId} completed ${input.workflow.steps.length} step(s).`;
    await input.workflowLedger.writeWorkflow(input.workflow);
    await input.workflowLedger.appendEvent(input.workflow.workflowRunId, {
      timestamp: isoNow(),
      type: "recipe.workflow.completed",
      message: input.workflow.summary,
      data: { stepCount: input.workflow.steps.length }
    });
  }
}

function validateApprovalSteps(recipe: RecipeDefinition, stepIds: string[]): void {
  const seen = new Set<string>();
  for (const stepId of stepIds) {
    if (seen.has(stepId)) {
      continue;
    }
    seen.add(stepId);
    const step = recipe.steps.find((candidate) => candidate.id === stepId);
    if (!step) {
      throw new Error(`Unknown step "${stepId}" for recipe "${recipe.id}".`);
    }
    const mode = getMode(step.mode);
    if (!mode.allowedPolicies.includes("approval_gated")) {
      throw new Error(`Step "${stepId}" uses ${mode.displayName}, which does not allow approval_gated policy.`);
    }
  }
}

function markRemainingSkipped(steps: RecipeWorkflowStepRun[], startIndex: number): void {
  for (const step of steps.slice(startIndex)) {
    if (step.status === "pending") {
      step.status = "skipped";
    }
  }
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function appendRunContextEntries(
  workflow: RecipeWorkflowRun,
  stepRun: RecipeWorkflowStepRun,
  result: RunResult | LedgerResult
): void {
  const createdAt = isoNow();
  const base = {
    stepId: stepRun.stepId,
    stepTitle: stepRun.stepTitle,
    stepIndex: stepRun.stepIndex,
    mode: stepRun.mode,
    runId: result.runId,
    createdAt
  };

  workflow.context.entries.push({
    ...base,
    id: nextContextEntryId(workflow),
    type: "step_result",
    key: `${stepRun.stepId}.result`,
    value: {
      status: result.status,
      summary: result.summary,
      strategy: result.policy.strategy,
      taskCount: result.tasks.length,
      outputCount: result.outputs.length
    },
    summary: result.summary
  });

  for (const output of result.outputs) {
    workflow.context.entries.push({
      ...base,
      id: nextContextEntryId(workflow),
      type: "agent_output",
      key: `${stepRun.stepId}.output.${output.taskId}`,
      value: {
        taskId: output.taskId,
        agentRole: output.agentRole,
        status: output.status,
        artifactName: output.artifactName,
        output: output.output
      },
      summary: `${output.agentRole} ${output.status} ${output.taskId}.`
    });
  }

  if (result.validation) {
    workflow.context.entries.push({
      ...base,
      id: nextContextEntryId(workflow),
      type: "validation_summary",
      key: `${stepRun.stepId}.validation`,
      value: {
        status: result.validation.status,
        gateStatus: result.validation.gateStatus,
        policy: result.validation.policy,
        summary: result.validation.summary,
        evidenceCount: result.validation.evidence.length,
        checkCount: result.validation.checks.length
      },
      summary: result.validation.summary
    });
  }

  if (result.banquet) {
    workflow.context.entries.push({
      ...base,
      id: nextContextEntryId(workflow),
      type: "banquet_summary",
      key: `${stepRun.stepId}.banquet`,
      value: {
        workerCount: result.banquet.workers.length,
        conflictCount: result.banquet.conflicts.length,
        reconciliationStatus: result.banquet.reconciliation.status,
        acceptedTaskIds: result.banquet.reconciliation.acceptedTaskIds,
        rejectedTaskIds: result.banquet.reconciliation.rejectedTaskIds,
        summary: result.banquet.reconciliation.summary
      },
      summary: result.banquet.reconciliation.summary
    });
  }

  workflow.context.updatedAt = createdAt;
  workflow.contextUpdatedAt = createdAt;
  workflow.contextEntryCount = workflow.context.entries.length;
}

function nextContextEntryId(workflow: RecipeWorkflowRun): string {
  return `context-${workflow.context.entries.length + 1}`;
}
