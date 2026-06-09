import { access, mkdir, readdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentExecutionResult,
  Decision,
  HandoffRecommendation,
  ModeRecommendation,
  ModeName,
  PlannerPlan,
  RecipeContext,
  ResolvedPolicy,
  RunStatus,
  Task
} from "../core/types.js";
import type { AgentAdapterMetadata, AgentProviderEvent } from "../agents/adapter.js";
import type { LedgerEvent, LedgerProviderRecord, LedgerResult, LedgerRunMetadata } from "./types.js";
import { assessRun } from "./run-assessment.js";
import { isoNow } from "../utils/time.js";
import type { BanquetConflict, BanquetLedgerRecord, BanquetReconciliation, BanquetWorker } from "../banquet/types.js";
import type { ApprovalGate, ValidationCommand, ValidationCommandResult, ValidationResult } from "../validation/types.js";
import type { RepositoryMapRecord } from "../repository-map/types.js";

export class FilesystemLedger {
  constructor(private readonly root = path.join(process.cwd(), ".open-kitchen", "runs")) {}

  getRoot(): string {
    return this.root;
  }

  getRunPath(runId: string): string {
    return path.join(this.root, runId);
  }

  async initializeRun(input: {
    runId: string;
    mode: ModeName;
    prompt: string;
    adapter: AgentAdapterMetadata;
    recipeContext?: RecipeContext;
  }): Promise<string> {
    const runPath = this.getRunPath(input.runId);
    await mkdir(path.join(runPath, "artifacts"), { recursive: true });

    const run: LedgerRunMetadata = {
      runId: input.runId,
      mode: input.mode,
      adapter: input.adapter,
      recipeContext: input.recipeContext,
      status: "needs_input",
      startedAt: isoNow()
    };

    await writeJson(path.join(runPath, "run.json"), run);
    await writeFile(path.join(runPath, "prompt.txt"), input.prompt, "utf8");
    await this.appendEvent(input.runId, {
      timestamp: isoNow(),
      type: "run.started",
      message: `Started ${input.mode} run.`
    });

    return runPath;
  }

  async writeAdapterSelected(runId: string, adapter: AgentAdapterMetadata): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "adapter.selected",
      message: `Selected ${adapter.name} adapter.`,
      data: {
        name: adapter.name,
        kind: adapter.kind,
        provider: adapter.provider,
        isMock: adapter.isMock,
        capabilities: adapter.capabilities
      }
    });
  }

  async writeProviderRecord(runId: string, provider: LedgerProviderRecord): Promise<void> {
    await writeJson(path.join(this.getRunPath(runId), "provider.json"), provider);
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "provider.selected",
      message: `Selected provider adapter ${provider.adapterName}.`,
      data: {
        adapterName: provider.adapterName,
        provider: provider.provider,
        model: provider.model,
        surface: provider.surface,
        permissionIntent: provider.permissionIntent
      }
    });
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: provider.capabilityAccepted ? "provider.capability.accepted" : "provider.capability.rejected",
      message: provider.capabilityReason,
      data: {
        adapterName: provider.adapterName,
        permissionIntent: provider.permissionIntent,
        supportsParallelTasks: provider.supportsParallelTasks,
        supportsWorkspaceMutation: provider.supportsWorkspaceMutation
      }
    });
  }

  async writeProviderEvent(runId: string, event: AgentProviderEvent): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: event.type,
      message: event.message,
      data: event.data
    });
  }

  async writeRecipeStepSelected(runId: string, recipeContext: RecipeContext, mode: ModeName): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "recipe.step.selected",
      message: `Selected recipe ${recipeContext.recipeId} step ${recipeContext.stepId}.`,
      data: {
        recipeId: recipeContext.recipeId,
        stepId: recipeContext.stepId,
        mode
      }
    });
  }

  async writePolicy(runId: string, policy: ResolvedPolicy): Promise<void> {
    await writeJson(path.join(this.getRunPath(runId), "policy.json"), policy);
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "policy.resolved",
      message: policy.reason,
      data: { strategy: policy.strategy, policies: policy.policies }
    });
  }

  async writeDecision(runId: string, decision: Decision): Promise<void> {
    await writeJson(path.join(this.getRunPath(runId), "decision.json"), decision);
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "decision.made",
      message: decision.reason,
      data: {
        decisionId: decision.id,
        kind: decision.kind,
        selectedMode: decision.selectedMode,
        selectedStrategy: decision.selectedStrategy
      }
    });

    if (decision.handoffRecommendation) {
      await this.writeHandoffRecommendation(runId, decision.handoffRecommendation);
    }
  }

  async writeModeRecommendation(runId: string, recommendation: ModeRecommendation): Promise<void> {
    await writeJson(path.join(this.getRunPath(runId), "mode-recommendation.json"), recommendation);
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "mode.recommended",
      message: recommendation.reason,
      data: {
        recommendationId: recommendation.id,
        recommendedMode: recommendation.recommendedMode,
        selectedMode: recommendation.selectedMode,
        confidence: recommendation.confidence,
        isOverride: recommendation.isOverride
      }
    });

    if (recommendation.isOverride) {
      await this.appendEvent(runId, {
        timestamp: isoNow(),
        type: "mode.override_recorded",
        message: `Selected mode ${recommendation.selectedMode} overrides recommended mode ${recommendation.recommendedMode}.`,
        data: {
          recommendationId: recommendation.id,
          recommendedMode: recommendation.recommendedMode,
          selectedMode: recommendation.selectedMode
        }
      });
    }
  }

  async writePlan(runId: string, plan: PlannerPlan): Promise<void> {
    await writeJson(path.join(this.getRunPath(runId), "plan.json"), plan);
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "planner.completed",
      message: plan.reason,
      data: {
        planId: plan.id,
        decisionId: plan.decisionId,
        taskIds: plan.tasks.map((task) => task.id)
      }
    });
  }

  async writePlannerSkipped(runId: string, reason: string): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "planner.skipped",
      message: reason
    });
  }

  private async writeHandoffRecommendation(runId: string, handoff: HandoffRecommendation): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "handoff.recommended",
      message: handoff.reason,
      data: {
        handoffId: handoff.id,
        fromMode: handoff.fromMode,
        toMode: handoff.toMode,
        confidence: handoff.confidence,
        autoExecute: handoff.autoExecute
      }
    });
  }

  async writeTasks(runId: string, tasks: Task[]): Promise<void> {
    await writeJson(path.join(this.getRunPath(runId), "tasks.json"), tasks);
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "tasks.generated",
      message: `Generated ${tasks.length} task(s).`,
      data: { taskIds: tasks.map((task) => task.id) }
    });
  }

  async writeRepositoryMap(runId: string, repoMap: RepositoryMapRecord): Promise<void> {
    const runPath = this.getRunPath(runId);
    await writeJson(path.join(runPath, "repo-map.json"), sanitizeRepositoryMapRecord(repoMap));
    await mkdir(path.join(runPath, "artifacts"), { recursive: true });
    await writeFile(path.join(runPath, "artifacts", repoMap.artifactName), repoMap.markdown, "utf8");
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: repoMap.status === "generated" ? "repository_map.generated" : "repository_map.failed",
      message: `Repository context map ${repoMap.status}.`,
      data: {
        status: repoMap.status,
        filesIncluded: repoMap.summary.filesIncluded,
        symbolsIncluded: repoMap.summary.symbolsIncluded,
        truncated: repoMap.budget.truncated,
        artifactName: repoMap.artifactName
      }
    });
  }

  async writeAgentOutputs(runId: string, outputs: AgentExecutionResult[]): Promise<void> {
    const artifactPath = path.join(this.getRunPath(runId), "artifacts");
    await mkdir(artifactPath, { recursive: true });

    for (const output of outputs) {
      await writeFile(path.join(artifactPath, output.artifactName), output.output, "utf8");
      if (output.rawOutput && output.rawOutputArtifactName) {
        await writeFile(path.join(artifactPath, output.rawOutputArtifactName), output.rawOutput, "utf8");
      }
      const partialAnswerArtifactName = output.provider?.partialAnswer?.artifactName;
      const partialAnswer = output.provider?.readability?.finalAnswer;
      if (partialAnswerArtifactName && partialAnswer) {
        await writeFile(path.join(artifactPath, partialAnswerArtifactName), partialAnswer, "utf8");
      }
      await this.appendEvent(runId, {
        timestamp: isoNow(),
        type: output.status === "failed" ? "agent.failed" : "agent.completed",
        message: `${output.agentRole} ${output.status} ${output.taskId}.`,
        data: { taskId: output.taskId, artifactName: output.artifactName, status: output.status }
      });
    }
  }

  async writeBanquetStarted(runId: string, workers: BanquetWorker[]): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "banquet.started",
      message: `Banquet started with ${workers.length} worker(s).`,
      data: { workerIds: workers.map((worker) => worker.id) }
    });
  }

  async writeBanquetWorkerStarted(runId: string, worker: BanquetWorker): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "banquet.worker.started",
      message: `${worker.label} started.`,
      data: { workerId: worker.id, taskIds: worker.assignedTaskIds }
    });
  }

  async writeBanquetWorkerCompleted(runId: string, worker: BanquetWorker): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "banquet.worker.completed",
      message: `${worker.label} completed.`,
      data: { workerId: worker.id, taskIds: worker.assignedTaskIds }
    });
  }

  async writeBanquetWorkerFailed(runId: string, worker: BanquetWorker): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "banquet.worker.failed",
      message: `${worker.label} failed.`,
      data: { workerId: worker.id, taskIds: worker.assignedTaskIds }
    });
  }

  async writeBanquetConflictsDetected(runId: string, conflicts: BanquetConflict[]): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "banquet.conflicts.detected",
      message: `Detected ${conflicts.length} Banquet conflict(s).`,
      data: { conflictIds: conflicts.map((conflict) => conflict.id) }
    });
  }

  async writeBanquetReconciled(runId: string, reconciliation: BanquetReconciliation): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "banquet.reconciled",
      message: reconciliation.summary,
      data: { status: reconciliation.status }
    });
  }

  async writeBanquetRecord(runId: string, banquet: BanquetLedgerRecord): Promise<void> {
    const runPath = this.getRunPath(runId);
    await writeJson(path.join(runPath, "banquet.json"), banquet);
    await mkdir(path.join(runPath, "artifacts"), { recursive: true });
    await writeFile(path.join(runPath, "artifacts", "banquet-reconciliation.md"), renderBanquetArtifact(banquet), "utf8");
  }

  async writeValidationResult(runId: string, validation: ValidationResult): Promise<void> {
    const runPath = this.getRunPath(runId);
    await writeJson(path.join(runPath, "validation.json"), validation);
    await writeJson(path.join(runPath, "validation-evidence.json"), validation.evidence);
    await mkdir(path.join(runPath, "artifacts"), { recursive: true });
    if (validation.commandResults) {
      for (const result of validation.commandResults) {
        if (result.stdoutArtifactName) {
          await writeFile(path.join(runPath, "artifacts", result.stdoutArtifactName), result.stdout, "utf8");
        }
        if (result.stderrArtifactName) {
          await writeFile(path.join(runPath, "artifacts", result.stderrArtifactName), result.stderr, "utf8");
        }
      }
    }
    await writeFile(path.join(runPath, "artifacts", validation.artifactName), renderValidationArtifact(validation), "utf8");
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "validation.started",
      message: `Validation started for ${validation.policy}.`,
      data: { validationId: validation.id, policy: validation.policy, evidenceCount: validation.evidence.length }
    });
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: validation.status === "failed" ? "validation.failed" : validation.status === "skipped" ? "validation.skipped" : "validation.completed",
      message: validation.summary,
      data: {
        validationId: validation.id,
        status: validation.status,
        gateStatus: validation.gateStatus,
        evidenceCount: validation.evidence.length
      }
    });
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: validation.gateStatus === "passed" ? "validation.gate.passed" : "validation.gate.failed",
      message: `Validation gate ${validation.gateStatus}.`,
      data: { validationId: validation.id, gateStatus: validation.gateStatus, evidenceCount: validation.evidence.length }
    });
  }

  async writeValidationCommandStarted(runId: string, command: ValidationCommand): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "validation.command.started",
      message: `Started validation command ${command.argv.join(" ")}.`,
      data: { commandId: command.id, argv: command.argv, timeoutMs: command.timeoutMs }
    });
  }

  async writeValidationCommandCompleted(runId: string, result: ValidationCommandResult): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "validation.command.completed",
      message: `Validation command passed ${result.argv.join(" ")}.`,
      data: validationCommandEventData(result)
    });
  }

  async writeValidationCommandFailed(runId: string, result: ValidationCommandResult): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "validation.command.failed",
      message: `Validation command failed ${result.argv.join(" ")}.`,
      data: validationCommandEventData(result)
    });
  }

  async writeValidationCommandTimedOut(runId: string, result: ValidationCommandResult): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "validation.command.timed_out",
      message: `Validation command timed out ${result.argv.join(" ")}.`,
      data: validationCommandEventData(result)
    });
  }

  async writeApprovalGate(runId: string, approval: ApprovalGate): Promise<void> {
    await writeJson(path.join(this.getRunPath(runId), "approval.json"), approval);
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "approval.required",
      message: approval.reason,
      data: { approvalId: approval.id, status: approval.status, required: approval.required }
    });
    if (approval.status === "approved") {
      await this.appendEvent(runId, {
        timestamp: isoNow(),
        type: "approval.approved",
        message: approval.reason,
        data: { approvalId: approval.id, approvedBy: approval.approvedBy }
      });
    }
    if (approval.status === "pending") {
      await this.appendEvent(runId, {
        timestamp: isoNow(),
        type: "approval.pending",
        message: approval.reason,
        data: { approvalId: approval.id, nextCommand: approval.nextCommand }
      });
    }
  }

  async writeRunResumeRequested(runId: string): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "run.resume_requested",
      message: `Resume requested for ${runId}.`,
      data: { runId }
    });
  }

  async writeApprovalResumeValidated(runId: string, approvalId: string): Promise<void> {
    await this.appendEvent(runId, {
      timestamp: isoNow(),
      type: "approval.resume_validated",
      message: "Pending approval resume request was validated.",
      data: { approvalId }
    });
  }

  async resumeApprovalRun(result: LedgerResult): Promise<void> {
    const runPath = this.getRunPath(result.runId);
    if (!result.approval) {
      throw new Error("Cannot resume approval without an approval record.");
    }

    const assessedResult = withAssessment(result);
    await writeJson(path.join(runPath, "approval.json"), assessedResult.approval);
    await writeJson(path.join(runPath, "result.json"), sanitizeLedgerResult(assessedResult));
    await writeFile(path.join(runPath, "result.md"), renderResultMarkdown(assessedResult), "utf8");

    const run = await this.readRunMetadata(result.runId);
    await writeJson(path.join(runPath, "run.json"), {
      ...run,
      status: assessedResult.status,
      completedAt: isoNow()
    });

    await this.appendEvent(result.runId, {
      timestamp: isoNow(),
      type: "approval.approved",
      message: result.approval.reason,
      data: {
        approvalId: result.approval.id,
        approvedBy: result.approval.approvedBy,
        approvedAt: result.approval.approvedAt,
        resumedFromRunId: result.approval.resumedFromRunId
      }
    });
    await this.appendEvent(result.runId, {
      timestamp: isoNow(),
      type: "run.resumed",
      message: assessedResult.summary,
      data: { status: assessedResult.status }
    });
  }

  async completeRun(input: {
    runId: string;
    mode: ModeName;
    adapter: AgentAdapterMetadata;
    recipeContext?: RecipeContext;
    status: RunStatus;
    decision: Decision;
    modeRecommendation?: ModeRecommendation;
    policy: ResolvedPolicy;
    plan?: PlannerPlan;
    handoffRecommendation?: HandoffRecommendation;
    tasks: Task[];
    outputs: AgentExecutionResult[];
    banquet?: BanquetLedgerRecord;
    validation?: ValidationResult;
    approval?: ApprovalGate;
    repositoryContext?: LedgerResult["repositoryContext"];
    summary: string;
  }): Promise<void> {
    const runPath = this.getRunPath(input.runId);
    const result: LedgerResult = withAssessment({
      runId: input.runId,
      mode: input.mode,
      adapter: input.adapter,
      recipeContext: input.recipeContext,
      status: input.status,
      summary: input.summary,
      decision: input.decision,
      modeRecommendation: input.modeRecommendation,
      policy: input.policy,
      plan: input.plan,
      handoffRecommendation: input.handoffRecommendation,
      tasks: input.tasks,
      outputs: input.outputs,
      banquet: input.banquet,
      validation: input.validation,
      approval: input.approval,
      repositoryContext: input.repositoryContext
    });

    await writeJson(path.join(runPath, "result.json"), sanitizeLedgerResult(result));
    await writeFile(path.join(runPath, "result.md"), renderResultMarkdown(result), "utf8");

    const run = await this.readRunMetadata(input.runId);
    await writeJson(path.join(runPath, "run.json"), {
      ...run,
      adapter: input.adapter,
      recipeContext: input.recipeContext,
      status: input.status,
      completedAt: isoNow()
    });

    await this.appendEvent(input.runId, {
      timestamp: isoNow(),
      type: "run.completed",
      message: input.summary,
      data: { status: input.status }
    });
  }

  async appendEvent(runId: string, event: LedgerEvent): Promise<void> {
    await appendFile(path.join(this.getRunPath(runId), "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  }

  async listRuns(): Promise<LedgerRunMetadata[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      const runs = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => this.readRunMetadataWithClassification(entry.name))
      );

      return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async readResult(runId: string): Promise<LedgerResult> {
    return readJson<LedgerResult>(path.join(this.getRunPath(runId), "result.json"));
  }

  private async readRunMetadata(runId: string): Promise<LedgerRunMetadata> {
    return readJson<LedgerRunMetadata>(path.join(this.getRunPath(runId), "run.json"));
  }

  private async readRunMetadataWithClassification(runId: string): Promise<LedgerRunMetadata> {
    const run = await this.readRunMetadata(runId);
    if (run.completedAt) {
      return run;
    }
    const runPath = this.getRunPath(runId);
    const resultExists = await exists(path.join(runPath, "result.json"));
    const approvalExists = await exists(path.join(runPath, "approval.json"));
    if (!resultExists && !approvalExists) {
      return {
        ...run,
        classification: "partial_or_incomplete"
      };
    }
    return run;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeLedgerResult(result: LedgerResult): LedgerResult {
  return {
    ...result,
    outputs: result.outputs.map(({ rawOutput, ...output }) => output)
  };
}

function sanitizeRepositoryMapRecord(repoMap: RepositoryMapRecord): Omit<RepositoryMapRecord, "markdown"> {
  const { markdown, ...record } = repoMap;
  return record;
}

function withAssessment(result: LedgerResult): LedgerResult {
  return {
    ...result,
    assessment: result.assessment ?? assessRun(result)
  };
}

function renderResultMarkdown(result: LedgerResult): string {
  const lines = [
    `# OpenKitchen Run Result`,
    ``,
    `- Run: ${result.runId}`,
    `- Mode: ${result.mode}`,
    `- Adapter: ${result.adapter.name} (${result.adapter.displayName})`,
    ...(result.recipeContext
      ? [
          `- Recipe: ${result.recipeContext.recipeId} (${result.recipeContext.recipeName})`,
          `- Recipe Step: ${result.recipeContext.stepId} (${result.recipeContext.stepTitle})`
        ]
      : []),
    `- Status: ${result.status}`,
    `- Strategy: ${result.policy.strategy}`,
    `- Decision: ${result.decision.reason}`,
    `- Tasks: ${result.tasks.length}`,
    `- Outputs: ${result.outputs.length}`,
    ``,
    `## Summary`,
    ``,
    result.summary
  ];

  if (result.assessment) {
    lines.push(
      ``,
      `## Operational Assessment`,
      ``,
      `Trust: ${result.assessment.trust}`,
      `Confidence: ${result.assessment.confidence}`,
      ``,
      result.assessment.summary
    );

    if (result.assessment.reasons.length > 0) {
      lines.push(``, `Reasons:`);
      for (const item of result.assessment.reasons) {
        lines.push(`- ${item.severity}: ${item.message}`);
      }
    }

    if (result.assessment.recommendedActions.length > 0) {
      lines.push(``, `Recommended actions:`);
      for (const item of result.assessment.recommendedActions) {
        lines.push(`- ${item.priority}: ${item.action}`);
      }
    }
  }

  if (result.repositoryContext) {
    lines.push(
      ``,
      `## Repository Context`,
      ``,
      `RepoMap: ${result.repositoryContext.repoMapStatus}`,
      ...(result.repositoryContext.filesScanned !== undefined ? [`Files scanned: ${result.repositoryContext.filesScanned}`] : []),
      ...(result.repositoryContext.filesIncluded !== undefined ? [`Files included: ${result.repositoryContext.filesIncluded}`] : []),
      ...(result.repositoryContext.symbolsIncluded !== undefined ? [`Symbols included: ${result.repositoryContext.symbolsIncluded}`] : []),
      ...(result.repositoryContext.truncated !== undefined ? [`Truncated: ${result.repositoryContext.truncated ? "yes" : "no"}`] : []),
      ...(result.repositoryContext.warnings !== undefined ? [`Warnings: ${result.repositoryContext.warnings}`] : []),
      ...(result.repositoryContext.artifactName ? [`Artifact: ${result.repositoryContext.artifactName}`] : [])
    );
  }

  const providerOutputs = result.outputs.filter((output) => output.provider);
  const readabilityOutputs = providerOutputs.filter((output) => output.provider?.readability);
  const qualityFlags = [...new Set(readabilityOutputs.flatMap((output) => output.provider?.readability?.qualityFlags ?? []))];

  if (readabilityOutputs.length > 0) {
    const firstReadable = readabilityOutputs[0];
    const readability = firstReadable?.provider?.readability;
    lines.push(``, `## Final Answer`, ``);
    if (readability?.finalAnswer) {
      lines.push(renderMarkdownPreview(readability.finalAnswer, 4000));
      if (readability.finalAnswer.length > 4000) {
        lines.push(``, `Full answer artifact: ${firstReadable.artifactName}`);
      }
    } else {
      lines.push("No deterministic final answer was extracted.");
    }

    lines.push(``, `## Run Quality`, ``);
    lines.push(qualityFlags.length > 0 ? `Quality flags: ${qualityFlags.join(", ")}` : "Quality flags: none");

    const warnings = readabilityOutputs.flatMap((output) => output.provider?.readability?.warnings ?? []);
    if (warnings.length > 0) {
      lines.push(``, `## Provider Warnings`, ``);
      for (const warning of warnings.slice(0, 10)) {
        lines.push(`- ${warning.source}: ${warning.message}`);
      }
      if (warnings.length > 10) {
        lines.push(`- ${warnings.length - 10} more warning(s) omitted from this summary.`);
      }
    }

    const commands = readabilityOutputs.flatMap((output) => output.provider?.readability?.commands ?? []);
    if (commands.length > 0) {
      const completed = commands.filter((command) => command.status === "completed").length;
      const failed = commands.filter((command) => command.status === "failed").length;
      const blocked = commands.filter((command) => command.status === "blocked").length;
      const unknown = commands.filter((command) => command.status === "unknown").length;
      lines.push(
        ``,
        `## Provider Commands`,
        ``,
        `Commands: ${commands.length} total, ${completed} completed, ${failed} failed, ${blocked} blocked, ${unknown} unknown`
      );
      for (const command of commands.filter((item) => item.status === "failed" || item.status === "blocked").slice(0, 10)) {
        lines.push(`- ${command.status}: ${command.command ?? "unknown command"}${command.exitCode !== undefined ? ` (exit ${command.exitCode})` : ""}`);
        if (command.preview) {
          lines.push(`  ${command.preview}`);
        }
      }
    }

    const outputSize = readability?.outputSize;
    if (outputSize) {
      lines.push(
        ``,
        `## Output Size`,
        ``,
        `Raw output length: ${outputSize.rawLength}`,
        `Extracted text length: ${outputSize.extractedTextLength}`,
        `Final answer length: ${outputSize.finalAnswerLength}`,
        `Large output: ${outputSize.largeOutput ? "yes" : "no"}`
      );
    }
  }

  if (result.plan) {
    lines.push(``, `## Plan`, ``, result.plan.reason, ``, `Tasks: ${result.plan.tasks.length}`);
  }

  if (result.modeRecommendation) {
    lines.push(
      ``,
      `## Mode Recommendation`,
      ``,
      `Recommended mode: ${result.modeRecommendation.recommendedMode}`,
      `Selected mode: ${result.modeRecommendation.selectedMode}`,
      `Confidence: ${result.modeRecommendation.confidence}`,
      `Override: ${result.modeRecommendation.isOverride ? "yes" : "no"}`,
      `Reason: ${result.modeRecommendation.reason}`,
      `Next: ${result.modeRecommendation.nextCommand}`
    );
  }

  if (result.banquet) {
    const completedWorkers = result.banquet.workers.filter((worker) => worker.status === "completed").length;
    const failedWorkers = result.banquet.workers.filter((worker) => worker.status === "failed").length;
    lines.push(
      ``,
      `## Banquet`,
      ``,
      `Workers: ${result.banquet.workers.length}`,
      `Completed workers: ${completedWorkers}`,
      `Failed workers: ${failedWorkers}`,
      `Conflicts: ${result.banquet.conflicts.length}`,
      `Reconciliation: ${result.banquet.reconciliation.status}`
    );
  }

  if (result.validation) {
    lines.push(
      ``,
      `## Validation`,
      ``,
      `Status: ${result.validation.status}`,
      `Gate: ${result.validation.gateStatus}`,
      `Policy: ${result.validation.policy}`,
      `Checks: ${result.validation.checks.length}`,
      `Evidence: ${result.validation.evidence.length}`,
      ...(result.validation.commandResults ? [`Commands: ${result.validation.commandResults.length}`] : []),
      `Evidence summary: ${highestImpactEvidenceSummary(result.validation)}`,
      `Artifact: ${result.validation.artifactName}`,
      `Summary: ${result.validation.summary}`
    );
  }

  if (providerOutputs.length > 0) {
    const firstProvider = providerOutputs[0]?.provider;
    const failedProvider = providerOutputs.find((output) => output.provider?.failureCategory)?.provider;
    const streamStats = firstProvider?.streamStats;
    lines.push(
      ``,
      `## Provider Execution`,
      ``,
      `Adapter: ${firstProvider?.adapterName}`,
      `Provider: ${firstProvider?.provider}`,
      ...(firstProvider?.model ? [`Model: ${firstProvider.model}`] : []),
      `Surface: ${firstProvider?.surface}`,
      ...(firstProvider?.resolvedCommand ? [`Resolved command: ${firstProvider.resolvedCommand}`] : []),
      ...(firstProvider?.timeoutMs ? [`Timeout: ${firstProvider.timeoutMs}ms (${firstProvider.timeoutSource ?? "unknown"})`] : []),
      ...(firstProvider?.timedOut ? [`Timed out: yes`] : []),
      ...(firstProvider?.partialAnswer?.available ? [`Timed out with answer: yes`] : []),
      ...(firstProvider?.closeDelayAfterTimeoutMs !== undefined ? [`Close delay after timeout: ${firstProvider.closeDelayAfterTimeoutMs}ms`] : []),
      ...(firstProvider?.exitCode !== undefined ? [`Exit code: ${firstProvider.exitCode}`] : []),
      `Provider outputs: ${providerOutputs.length}`,
      `Provider failures: ${providerOutputs.filter((output) => output.status === "failed").length}`,
      ...(failedProvider?.failureCategory ? [`Failure category: ${failedProvider.failureCategory}`] : []),
      ...(failedProvider?.failureSummary ? [`Failure summary: ${failedProvider.failureSummary}`] : []),
      ...(streamStats
        ? [
            `Stream chunks: stdout ${streamStats.stdoutChunkCount}, stderr ${streamStats.stderrChunkCount}`,
            `Stream JSON lines: ${streamStats.jsonLineCount}`,
            `Stream parse errors: ${streamStats.parseErrorCount}`,
            `Extracted text length: ${streamStats.extractedTextLength}`
          ]
        : []),
      ...(qualityFlags.length > 0 ? [`Quality flags: ${qualityFlags.join(", ")}`] : []),
      ...providerOutputs.flatMap((output) => {
        const refs = output.provider?.readability?.artifactRefs;
        return [
          ...(refs?.partialAnswerArtifactName ? [`Partial answer artifact: ${refs.partialAnswerArtifactName}`] : []),
          ...(refs?.rawOutputArtifactName ? [`Raw output artifact: ${refs.rawOutputArtifactName}`] : [])
        ];
      })
    );
  }

  if (result.approval) {
    lines.push(
      ``,
      `## Approval`,
      ``,
      `Status: ${result.approval.status}`,
      `Required: ${result.approval.required ? "yes" : "no"}`,
      ...(result.approval.approvedBy ? [`Approved by: ${result.approval.approvedBy}`] : []),
      ...(result.approval.approvedAt ? [`Approved at: ${result.approval.approvedAt}`] : []),
      `Reason: ${result.approval.reason}`,
      ...(result.approval.nextCommand ? [`Next: ${result.approval.nextCommand}`] : [])
    );
  }

  if (result.handoffRecommendation) {
    lines.push(
      ``,
      `## Handoff Recommendation`,
      ``,
      `Target mode: ${result.handoffRecommendation.toMode}`,
      `Reason: ${result.handoffRecommendation.reason}`,
      `Next: ${result.handoffRecommendation.nextCommand}`
    );
  }

  return lines.join("\n");
}

function renderMarkdownPreview(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength).trimEnd()}\n\n[truncated in result.md]`;
}

function renderBanquetArtifact(banquet: BanquetLedgerRecord): string {
  return [
    `# Banquet Reconciliation`,
    ``,
    `Status: ${banquet.reconciliation.status}`,
    `Conflicts: ${banquet.conflicts.length}`,
    `Accepted tasks: ${banquet.reconciliation.acceptedTaskIds.join(", ") || "none"}`,
    `Rejected tasks: ${banquet.reconciliation.rejectedTaskIds.join(", ") || "none"}`,
    ``,
    banquet.reconciliation.summary,
    ``,
    `## Notes`,
    ``,
    ...banquet.reconciliation.notes.map((note) => `- ${note}`)
  ].join("\n");
}

function renderValidationArtifact(validation: ValidationResult): string {
  return [
    `# Validation Report`,
    ``,
    `Status: ${validation.status}`,
    `Gate: ${validation.gateStatus}`,
    `Policy: ${validation.policy}`,
    `Validated tasks: ${validation.validatedTaskIds.join(", ") || "none"}`,
    ``,
    validation.summary,
    ``,
    `## Checks`,
    ``,
    ...validation.checks.map(
      (check) =>
        `- ${check.name}: ${check.status} (${check.severity}) - ${check.message} [evidence: ${check.evidenceIds.join(", ")}]`
    ),
    ``,
    `## Evidence`,
    ``,
    ...validation.evidence.map(
      (evidence) =>
        `- ${evidence.id}: ${evidence.type} (${evidence.impact}) - ${evidence.summary}`
    ),
    ...(validation.commandResults && validation.commandResults.length > 0
      ? [
          ``,
          `## Commands`,
          ``,
          ...validation.commandResults.map(
            (result) =>
              `- ${result.status}: ${result.argv.join(" ")} (${result.durationMs}ms, exit ${result.exitCode ?? "none"})`
          )
        ]
      : [])
  ].join("\n");
}

function highestImpactEvidenceSummary(validation: ValidationResult): string {
  const preferredImpact =
    validation.status === "failed"
      ? "supports_failure"
      : validation.status === "warning"
        ? "supports_warning"
        : validation.status === "skipped"
          ? "supports_skip"
          : "supports_pass";
  return validation.evidence.find((evidence) => evidence.impact === preferredImpact)?.summary ?? "none";
}

function validationCommandEventData(result: ValidationCommandResult): Record<string, unknown> {
  return {
    commandId: result.commandId,
    argv: result.argv,
    status: result.status,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    stdoutArtifactName: result.stdoutArtifactName,
    stderrArtifactName: result.stderrArtifactName
  };
}
