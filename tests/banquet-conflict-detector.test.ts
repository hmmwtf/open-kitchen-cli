import { describe, expect, it } from "vitest";
import { detectBanquetConflicts } from "../src/banquet/conflict-detector.js";
import type { Task } from "../src/core/types.js";
import { generateMockTasks } from "../src/tasks/mock-task-generator.js";
import { getMode } from "../src/modes/registry.js";
import type { ResolvedPolicy } from "../src/core/types.js";

describe("Banquet conflict detector", () => {
  it("does not report conflicts for the default Banquet plan", () => {
    const tasks = generateMockTasks(getMode("banquet"), banquetPolicy(), "split this work");

    expect(detectBanquetConflicts(tasks)).toEqual([]);
  });

  it("reports overlapping implementation resources", () => {
    const tasks: Task[] = [
      ownedExecutionTask("task-a", "worker-1"),
      ownedExecutionTask("task-b", "worker-2")
    ];

    const conflicts = detectBanquetConflicts(tasks);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      taskIds: ["task-a", "task-b"],
      resources: ["implementation-area"],
      severity: "medium"
    });
  });
});

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

function ownedExecutionTask(id: string, ownerWorkerId: string): Task {
  return {
    id,
    title: id,
    prompt: "test",
    agentRole: "worker",
    ownership: {
      ownerWorkerId,
      claimedResources: ["implementation-area"],
      scope: "execution"
    }
  };
}
