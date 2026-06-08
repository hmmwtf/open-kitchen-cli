import { createAgentAdapter } from "../agents/registry.js";
import { validateAgentCapabilities } from "../agents/capabilities.js";
import type { AgentAdapterMetadata } from "../agents/adapter.js";
import type { AgentProviderEvent } from "../agents/adapter.js";
import { BanquetExecutor } from "../banquet/banquet-executor.js";
import { FilesystemLedger } from "../ledger/filesystem-ledger.js";
import { getMode } from "../modes/registry.js";
import { generateMockTasks } from "../tasks/mock-task-generator.js";
import { createRunId } from "../utils/ids.js";
import { evaluateApprovalGate } from "../validation/approval-gate.js";
import { statusText } from "../validation/summary.js";
import { ValidationEngine } from "../validation/validation-engine.js";
import { DecisionEngine } from "./decision-engine.js";
import { Executor } from "./executor.js";
import { ModeRecommendationEngine } from "./mode-recommendation-engine.js";
import { PlannerStub } from "./planner-stub.js";
import { resolvePolicy } from "./policy-resolver.js";
import type { RunProgressEvent, RunRequest, RunResult } from "./types.js";
import { detectAnchorBugDomain, detectAnchorCliBugSubtype, detectAnchorIntent, generateRepositoryMap } from "../repository-map/repository-map.js";
import type { RepositoryContextPrompt, RepositoryContextSummary, RepositoryMapRecord } from "../repository-map/types.js";

const FAST_REPO_MAP_MAX_CHARS = 2000;
const INSTANT_REPO_MAP_MAX_CHARS = 2000;
const INSTANT_PROVIDER_TIMEOUT_MS = 15000;

export class RunController {
  async run(request: RunRequest): Promise<RunResult> {
    if (request.approved && !request.requireApproval) {
      throw new Error("--approve requires --require-approval.");
    }

    const mode = getMode(request.mode);
    const runId = createRunId();
    const adapter = createAgentAdapter(request.adapter ?? "mock");
    const ledger = new FilesystemLedger(request.ledgerRoot);
    const ledgerPath = await ledger.initializeRun({
      runId,
      mode: mode.name,
      prompt: request.prompt,
      adapter: adapter.metadata,
      recipeContext: request.recipeContext
    });
    emitProgress(request, {
      type: "run.started",
      runId,
      mode: mode.name,
      adapter: adapter.metadata,
      ledgerPath
    });
    await ledger.writeAdapterSelected(runId, adapter.metadata);
    if (request.recipeContext) {
      await ledger.writeRecipeStepSelected(runId, request.recipeContext, mode.name);
    }

    const modeRecommendation = new ModeRecommendationEngine().recommend({
      prompt: request.prompt,
      selectedMode: mode.name
    });
    await ledger.writeModeRecommendation(runId, modeRecommendation);

    const decision = new DecisionEngine().decide({
      mode,
      prompt: request.prompt,
      forceTasks: request.forceTasks
    });
    await ledger.writeDecision(runId, decision);

    const policy = resolvePolicy({
      mode,
      decision,
      requireApproval: request.requireApproval
    });
    await ledger.writePolicy(runId, policy);

    const capabilityDecision = validateAgentCapabilities({
      adapter: adapter.metadata,
      mode,
      policy
    });
    const providerTimeoutMs = getProviderTimeoutMs(request.instant ?? false);
    const providerModel = providerModelForAdapter(adapter.metadata, request.instant ?? false);
    await ledger.writeProviderRecord(runId, {
      adapterName: adapter.metadata.name,
      provider: adapter.metadata.provider,
      displayName: adapter.metadata.displayName,
      model: providerModel,
      surface: adapter.metadata.capabilities.executionSurface,
      permissionIntent: capabilityDecision.permissionIntent,
      timeoutMs: providerTimeoutMs,
      capabilityAccepted: capabilityDecision.accepted,
      capabilityReason: capabilityDecision.reason,
      supportsStreaming: adapter.metadata.capabilities.supportsStreaming,
      supportsParallelTasks: adapter.metadata.capabilities.supportsParallelTasks,
      supportsWorkspaceMutation: adapter.metadata.capabilities.supportsWorkspaceMutation,
      credentialSource: adapter.metadata.capabilities.credentialSource,
      modelSource: adapter.metadata.capabilities.modelSource
    });
    if (!capabilityDecision.accepted) {
      throw new Error(capabilityDecision.reason);
    }

    const plan = policy.requiresTasks
      ? new PlannerStub().createPlan({
          mode,
          policy,
          prompt: request.prompt
        })
      : undefined;

    if (plan) {
      await ledger.writePlan(runId, plan);
    } else {
      await ledger.writePlannerSkipped(runId, "Planner skipped because the resolved policy does not require tasks.");
    }

    const tasks = plan?.tasks ?? generateMockTasks(mode, policy, request.prompt);
    await ledger.writeTasks(runId, tasks);

    const repositoryMap =
      mode.name === "prep"
        ? await generateRepositoryMap({
            root: process.cwd(),
            prompt: request.prompt,
            maxChars: repoMapMaxChars(request),
            contextAnchors: request.instant ?? false,
            contextAnchorIntent: request.instant ? detectAnchorIntent(request.prompt) : undefined,
            contextAnchorBugDomain: request.instant ? detectAnchorBugDomain(request.prompt) : undefined,
            contextAnchorCliBugSubtype: request.instant ? detectAnchorCliBugSubtype(request.prompt) : undefined,
            anchorMaxChars: request.instant ? 850 : undefined
          })
        : undefined;
    if (repositoryMap) {
      await ledger.writeRepositoryMap(runId, repositoryMap);
      if (repositoryMap.status === "generated") {
        emitProgress(request, {
          type: "repository_map.generated",
          filesIncluded: repositoryMap.summary.filesIncluded,
          symbolsIncluded: repositoryMap.summary.symbolsIncluded,
          truncated: repositoryMap.budget.truncated
        });
      }
    }
    const repositoryContext = repositoryMap ? repositoryContextSummary(repositoryMap) : undefined;
    const repositoryPromptContext: RepositoryContextPrompt | undefined =
      repositoryMap?.status === "generated"
        ? {
            kind: "repo_map",
            markdown: repositoryMap.markdown,
            artifactName: repositoryMap.artifactName
          }
        : undefined;

    const isBanquetParallelRun = mode.name === "banquet" && policy.strategy === "parallel_tasks";
    const providerProgress = createProviderProgressEmitter(request, providerTimeoutMs);
    const banquetExecution = isBanquetParallelRun
      ? await new BanquetExecutor(adapter, {
          started: (workers) => ledger.writeBanquetStarted(runId, workers),
          workerStarted: (worker) => ledger.writeBanquetWorkerStarted(runId, worker),
          workerCompleted: (worker) => ledger.writeBanquetWorkerCompleted(runId, worker),
          workerFailed: (worker) => ledger.writeBanquetWorkerFailed(runId, worker),
          conflictsDetected: (conflicts) => ledger.writeBanquetConflictsDetected(runId, conflicts),
          reconciled: (reconciliation) => ledger.writeBanquetReconciled(runId, reconciliation)
        }).execute({
          runId,
          mode,
          policy,
          prompt: request.prompt,
          tasks,
          permissionIntent: capabilityDecision.permissionIntent,
          model: providerModel,
          timeoutMs: providerTimeoutMs,
          fast: request.fast,
          instant: request.instant,
          onProviderEvent: (event) => {
            providerProgress(event);
            return ledger.writeProviderEvent(runId, event);
          }
        })
      : undefined;
    const outputs =
      banquetExecution?.taskResults ??
      (await new Executor(adapter).execute({
        runId,
        mode,
        policy,
        prompt: request.prompt,
        tasks,
        permissionIntent: capabilityDecision.permissionIntent,
        model: providerModel,
        timeoutMs: providerTimeoutMs,
        fast: request.fast,
        instant: request.instant,
        repositoryContext: repositoryPromptContext,
        onProviderEvent: (event) => {
          providerProgress(event);
          return ledger.writeProviderEvent(runId, event);
        }
      }));
    await ledger.writeAgentOutputs(runId, outputs);

    const banquet = banquetExecution
      ? {
          workers: banquetExecution.workers,
          conflicts: banquetExecution.conflicts,
          reconciliation: banquetExecution.reconciliation
        }
      : undefined;
    if (banquet) {
      await ledger.writeBanquetRecord(runId, banquet);
    }

    const executionStatus: "completed" | "failed" =
      banquetExecution?.status === "failed" || outputs.some((output) => output.status === "failed")
        ? "failed"
        : "completed";
    const validation = await new ValidationEngine().validate({
      mode,
      policy,
      prompt: request.prompt,
      outputs,
      executionStatus,
      banquet,
      commands: request.validationCommands,
      commandEvents: {
        started: (command) => ledger.writeValidationCommandStarted(runId, command),
        completed: (result) => ledger.writeValidationCommandCompleted(runId, result),
        failed: (result) => ledger.writeValidationCommandFailed(runId, result),
        timedOut: (result) => ledger.writeValidationCommandTimedOut(runId, result)
      }
    });
    if (validation) {
      await ledger.writeValidationResult(runId, validation);
    }

    const approval = evaluateApprovalGate({
      runId,
      mode: mode.name,
      prompt: request.prompt,
      required: request.requireApproval ?? false,
      approved: request.approved ?? false,
      validation
    });
    if (approval) {
      await ledger.writeApprovalGate(runId, approval);
    }

    const status = computeRunStatus(executionStatus, validation, approval);
    const summary = `${mode.displayName} ${statusText(status)} ${policy.strategy} ${adapterSummaryName(adapter.metadata)} execution with ${outputs.length} output(s).`;
    const result: RunResult = {
      runId,
      mode: mode.name,
      status,
      ledgerPath,
      adapter: adapter.metadata,
      recipeContext: request.recipeContext,
      modeRecommendation,
      decision,
      policy,
      plan,
      handoffRecommendation: decision.handoffRecommendation,
      tasks,
      outputs,
      banquet,
      validation,
      approval,
      repositoryContext,
      summary
    };

    await ledger.completeRun(result);
    return result;
  }
}

function getProviderTimeoutMs(instant: boolean): number {
  const parsed = Number.parseInt(process.env.OPEN_KITCHEN_PROVIDER_TIMEOUT_MS ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return instant ? INSTANT_PROVIDER_TIMEOUT_MS : 300000;
}

function emitProgress(request: RunRequest, event: RunProgressEvent): void {
  request.onProgress?.(event);
}

function createProviderProgressEmitter(request: RunRequest, timeoutMs: number) {
  let chunkCount = 0;

  return (event: AgentProviderEvent) => {
    const adapterName = stringData(event.data, "adapter") ?? request.adapter ?? "mock";
    if (event.type === "provider.invocation.started") {
      emitProgress(request, {
        type: "provider.started",
        adapterName,
        timeoutMs,
        permissionIntent: stringData(event.data, "permissionIntent") ?? "unknown"
      });
      return;
    }

    if (event.type === "provider.stream.chunk") {
      chunkCount += 1;
      if (chunkCount === 1 || chunkCount % 10 === 0) {
        emitProgress(request, {
          type: "provider.activity",
          adapterName,
          stream: stringData(event.data, "stream"),
          chunkCount
        });
      }
      return;
    }

    if (event.type === "provider.invocation.completed") {
      emitProgress(request, {
        type: "provider.completed",
        adapterName,
        durationMs: numberData(event.data, "durationMs")
      });
      return;
    }

    if (event.type === "provider.invocation.timed_out") {
      emitProgress(request, {
        type: "provider.timed_out",
        adapterName,
        durationMs: numberData(event.data, "durationMs")
      });
      return;
    }

    if (event.type === "provider.invocation.failed") {
      emitProgress(request, {
        type: "provider.failed",
        adapterName,
        reason: stringData(event.data, "reason")
      });
    }
  };
}

function stringData(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" ? value : undefined;
}

function numberData(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = data?.[key];
  return typeof value === "number" ? value : undefined;
}

function providerModelForAdapter(adapter: AgentAdapterMetadata, instant: boolean): string | undefined {
  if (adapter.name === "codex-cli") {
    return (instant ? process.env.OPEN_KITCHEN_CODEX_INSTANT_MODEL : undefined) ?? process.env.OPEN_KITCHEN_CODEX_MODEL;
  }
  if (adapter.name === "claude-code") {
    return process.env.OPEN_KITCHEN_CLAUDE_MODEL;
  }
  if (adapter.name === "ollama") {
    return process.env.OPEN_KITCHEN_OLLAMA_MODEL;
  }
  return undefined;
}

function repoMapMaxChars(request: RunRequest): number | undefined {
  if (request.instant) {
    return INSTANT_REPO_MAP_MAX_CHARS;
  }
  if (request.fast) {
    return FAST_REPO_MAP_MAX_CHARS;
  }
  return undefined;
}

function adapterSummaryName(adapter: AgentAdapterMetadata): string {
  return adapter.isMock ? "mock" : adapter.name;
}

function repositoryContextSummary(repoMap: RepositoryMapRecord): RepositoryContextSummary {
  return {
    repoMapStatus: repoMap.status,
    artifactName: repoMap.artifactName,
    filesScanned: repoMap.summary.filesScanned,
    filesIncluded: repoMap.summary.filesIncluded,
    symbolsIncluded: repoMap.summary.symbolsIncluded,
    truncated: repoMap.budget.truncated,
    warnings: repoMap.warnings.length
  };
}

function computeRunStatus(
  executionStatus: "completed" | "failed",
  validation: RunResult["validation"],
  approval: RunResult["approval"]
): RunResult["status"] {
  if (executionStatus === "failed") {
    return "failed";
  }
  if (validation?.gateStatus === "failed") {
    return "failed";
  }
  if (approval?.status === "pending") {
    return "needs_input";
  }
  return "completed";
}
