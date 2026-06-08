import type { AgentAdapter } from "../agents/adapter.js";
import type { AgentPermissionIntent, AgentProviderEventSink } from "../agents/adapter.js";
import type { AgentExecutionResult, ModeDefinition, ResolvedPolicy, Task } from "../core/types.js";
import { detectBanquetConflicts } from "./conflict-detector.js";
import { reconcileBanquetOutputs } from "./reconciler.js";
import type { BanquetExecutionResult, BanquetWorker } from "./types.js";
import { attachBanquetOwnership, createBanquetWorkersWithAssignments } from "./worker-model.js";

export interface BanquetExecuteInput {
  runId: string;
  mode: ModeDefinition;
  policy: ResolvedPolicy;
  prompt: string;
  tasks: Task[];
  permissionIntent?: AgentPermissionIntent;
  model?: string;
  timeoutMs?: number;
  fast?: boolean;
  instant?: boolean;
  onProviderEvent?: AgentProviderEventSink;
}

export interface BanquetExecutionEvents {
  started?(workers: BanquetWorker[]): Promise<void>;
  workerStarted?(worker: BanquetWorker): Promise<void>;
  workerCompleted?(worker: BanquetWorker): Promise<void>;
  workerFailed?(worker: BanquetWorker): Promise<void>;
  conflictsDetected?(conflicts: BanquetExecutionResult["conflicts"]): Promise<void>;
  reconciled?(reconciliation: BanquetExecutionResult["reconciliation"]): Promise<void>;
}

export class BanquetExecutor {
  constructor(private readonly agent: AgentAdapter, private readonly events: BanquetExecutionEvents = {}) {}

  async execute(input: BanquetExecuteInput): Promise<BanquetExecutionResult> {
    const tasks = attachBanquetOwnership(input.tasks);
    const workers = createBanquetWorkersWithAssignments(tasks);
    await this.events.started?.(workers);

    for (const worker of workers) {
      worker.status = worker.assignedTaskIds.length === 0 ? "skipped" : "running";
      if (worker.status === "running") {
        await this.events.workerStarted?.(worker);
      }
    }

    const taskResultsByWorker = await Promise.all(
      workers.map((worker) => this.executeWorker(input, worker, tasks))
    );
    const taskResults = taskResultsByWorker.flat();
    const conflicts = detectBanquetConflicts(tasks);
    await this.events.conflictsDetected?.(conflicts);

    const reconciliation = reconcileBanquetOutputs({ tasks, taskResults, conflicts });
    await this.events.reconciled?.(reconciliation);

    return {
      workers,
      taskResults,
      conflicts,
      reconciliation,
      status: reconciliation.status === "failed" ? "failed" : "completed"
    };
  }

  private async executeWorker(
    input: BanquetExecuteInput,
    worker: BanquetWorker,
    tasks: Task[]
  ): Promise<AgentExecutionResult[]> {
    const workerTasks = tasks.filter((task) => worker.assignedTaskIds.includes(task.id));
    if (workerTasks.length === 0) {
      return [];
    }

    if (shouldFailWorker(input.prompt, worker.id)) {
      const failedResults = workerTasks.map((task) => createFailedResult(input.runId, task));
      worker.status = "failed";
      await this.events.workerFailed?.(worker);
      return failedResults;
    }

    const results = await Promise.all(
      workerTasks.map((task) =>
        this.agent.execute({
          runId: input.runId,
          task,
          agentRole: task.agentRole,
          mode: input.mode,
          policy: input.policy,
          permissionIntent: input.permissionIntent,
          model: input.model,
          timeoutMs: input.timeoutMs,
          fast: input.fast,
          instant: input.instant,
          onProviderEvent: input.onProviderEvent
        })
      )
    );

    worker.status = results.some((result) => result.status === "failed") ? "failed" : "completed";
    if (worker.status === "failed") {
      await this.events.workerFailed?.(worker);
    } else {
      await this.events.workerCompleted?.(worker);
    }
    return results;
  }
}

function shouldFailWorker(prompt: string, workerId: string): boolean {
  return workerId === "worker-2" && prompt.toLowerCase().includes("mock fail banquet");
}

function createFailedResult(runId: string, task: Task): AgentExecutionResult {
  return {
    taskId: task.id,
    agentRole: task.agentRole,
    status: "failed",
    artifactName: `agent-output-${task.id}.md`,
    output: [
      `# Mock Banquet Worker Failure`,
      ``,
      `Run: ${runId}`,
      `Task: ${task.id}`,
      `Role: ${task.agentRole}`,
      `Title: ${task.title}`,
      ``,
      `This deterministic mock failure was triggered by the prompt.`
    ].join("\n")
  };
}
