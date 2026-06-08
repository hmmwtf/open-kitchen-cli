import type { ModeDefinition } from "../core/types.js";
import type { ResolvedPolicy, Task } from "../core/types.js";
import { attachBanquetOwnership } from "../banquet/worker-model.js";

export function generateMockTasks(mode: ModeDefinition, policy: ResolvedPolicy, prompt: string): Task[] {
  if (policy.strategy === "direct") {
    return [];
  }

  if (mode.name === "banquet" && policy.strategy === "parallel_tasks") {
    return attachBanquetOwnership([
      {
        id: "task-1",
        title: "Parallel worker investigation",
        prompt,
        agentRole: "worker"
      },
      {
        id: "task-2",
        title: "Parallel worker execution",
        prompt,
        agentRole: "worker"
      },
      {
        id: "task-3",
        title: "Parallel reconciliation pass",
        prompt,
        agentRole: "reconciliation_agent"
      }
    ]);
  }

  return [
    {
      id: "task-1",
      title: `${mode.displayName} mock task`,
      prompt,
      agentRole: mode.defaultAgentRole
    }
  ];
}
