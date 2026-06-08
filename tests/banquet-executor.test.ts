import { describe, expect, it } from "vitest";
import { BanquetExecutor } from "../src/banquet/banquet-executor.js";
import type { AgentAdapter, AgentAdapterInput, AgentAdapterMetadata } from "../src/agents/adapter.js";
import type { AgentExecutionResult } from "../src/core/types.js";
import { getMode } from "../src/modes/registry.js";
import { generateMockTasks } from "../src/tasks/mock-task-generator.js";
import type { ResolvedPolicy } from "../src/core/types.js";

describe("BanquetExecutor", () => {
  it("executes worker-owned tasks concurrently and returns worker state", async () => {
    const adapter = new TrackingAdapter();
    const result = await new BanquetExecutor(adapter).execute({
      runId: "run-test",
      mode: getMode("banquet"),
      policy: banquetPolicy(),
      prompt: "split this work",
      tasks: generateMockTasks(getMode("banquet"), banquetPolicy(), "split this work")
    });

    expect(adapter.maxInFlight).toBeGreaterThan(1);
    expect(result.workers.map((worker) => worker.id)).toEqual(["worker-1", "worker-2", "worker-3"]);
    expect(result.workers.every((worker) => worker.assignedTaskIds.length === 1)).toBe(true);
    expect(result.workers.every((worker) => worker.status === "completed")).toBe(true);
    expect(result.taskResults).toHaveLength(3);
    expect(result.status).toBe("completed");
  });

  it("preserves completed outputs when the mock failure trigger fails worker-2", async () => {
    const result = await new BanquetExecutor(new TrackingAdapter()).execute({
      runId: "run-test",
      mode: getMode("banquet"),
      policy: banquetPolicy(),
      prompt: "split this work mock fail banquet",
      tasks: generateMockTasks(getMode("banquet"), banquetPolicy(), "split this work mock fail banquet")
    });

    expect(result.status).toBe("failed");
    expect(result.workers.find((worker) => worker.id === "worker-2")?.status).toBe("failed");
    expect(result.taskResults.filter((taskResult) => taskResult.status === "completed")).toHaveLength(2);
    expect(result.taskResults.find((taskResult) => taskResult.taskId === "task-2")?.status).toBe("failed");
    expect(result.reconciliation.status).toBe("failed");
    expect(result.reconciliation.rejectedTaskIds).toEqual(["task-2"]);
  });
});

class TrackingAdapter implements AgentAdapter {
  readonly metadata: AgentAdapterMetadata = {
    name: "mock",
    displayName: "Tracking Mock Agent Adapter",
    kind: "mock",
    provider: "mock",
    isMock: true,
    supportsParallel: true,
    supportsStreaming: false,
    requiresCredentials: false,
    capabilities: {
      executionSurface: "mock",
      supportsParallelTasks: true,
      supportsStreaming: false,
      supportsWorkspaceMutation: true,
      readOnlyEnforcement: "native",
      credentialSource: "none",
      modelSource: "none",
      maxConcurrency: 32
    }
  };

  inFlight = 0;
  maxInFlight = 0;

  async execute(input: AgentAdapterInput): Promise<AgentExecutionResult> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.inFlight -= 1;

    return {
      taskId: input.task.id,
      agentRole: input.agentRole,
      status: "completed",
      artifactName: `agent-output-${input.task.id}.md`,
      output: input.task.id
    };
  }
}

function banquetPolicy(): ResolvedPolicy {
  return {
    decisionId: "decision-test",
    decisionKind: "parallel_execution",
    strategy: "parallel_tasks",
    policies: ["task_first", "parallel"],
    reason: "test",
    requiresTasks: true,
    agentRoles: ["worker", "reconciliation_agent"]
  };
}
