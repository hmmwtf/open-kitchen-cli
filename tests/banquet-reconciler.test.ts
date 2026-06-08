import { describe, expect, it } from "vitest";
import { reconcileBanquetOutputs } from "../src/banquet/reconciler.js";
import type { AgentExecutionResult, Task } from "../src/core/types.js";
import type { BanquetConflict } from "../src/banquet/types.js";

describe("Banquet reconciler", () => {
  it("completes when there are no conflicts or failed task results", () => {
    const reconciliation = reconcileBanquetOutputs({
      tasks: [task("task-1")],
      taskResults: [result("task-1", "completed")],
      conflicts: []
    });

    expect(reconciliation.status).toBe("completed");
    expect(reconciliation.acceptedTaskIds).toEqual(["task-1"]);
    expect(reconciliation.rejectedTaskIds).toEqual([]);
  });

  it("completes with conflicts when completed task results overlap", () => {
    const reconciliation = reconcileBanquetOutputs({
      tasks: [task("task-1"), task("task-2")],
      taskResults: [result("task-1", "completed"), result("task-2", "completed")],
      conflicts: [conflict(["task-1", "task-2"])]
    });

    expect(reconciliation.status).toBe("completed_with_conflicts");
    expect(reconciliation.rejectedTaskIds).toEqual(["task-1", "task-2"]);
  });

  it("fails when any task result failed", () => {
    const reconciliation = reconcileBanquetOutputs({
      tasks: [task("task-1"), task("task-2")],
      taskResults: [result("task-1", "completed"), result("task-2", "failed")],
      conflicts: []
    });

    expect(reconciliation.status).toBe("failed");
    expect(reconciliation.acceptedTaskIds).toEqual(["task-1"]);
    expect(reconciliation.rejectedTaskIds).toEqual(["task-2"]);
  });
});

function task(id: string): Task {
  return {
    id,
    title: id,
    prompt: "test",
    agentRole: "worker"
  };
}

function result(taskId: string, status: "completed" | "failed"): AgentExecutionResult {
  return {
    taskId,
    agentRole: "worker",
    status,
    artifactName: `${taskId}.md`,
    output: taskId
  };
}

function conflict(taskIds: string[]): BanquetConflict {
  return {
    id: "banquet-conflict-1",
    taskIds,
    resources: ["implementation-area"],
    severity: "medium",
    reason: "test conflict"
  };
}
