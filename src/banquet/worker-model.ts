import type { AgentRole, Task, TaskOwnership } from "../core/types.js";
import type { BanquetWorker } from "./types.js";

export function createBanquetWorkers(): BanquetWorker[] {
  return [
    {
      id: "worker-1",
      role: "worker",
      label: "investigation worker",
      status: "pending",
      assignedTaskIds: []
    },
    {
      id: "worker-2",
      role: "worker",
      label: "execution worker",
      status: "pending",
      assignedTaskIds: []
    },
    {
      id: "worker-3",
      role: "reconciliation_agent",
      label: "reconciliation worker",
      status: "pending",
      assignedTaskIds: []
    }
  ];
}

export function attachBanquetOwnership(tasks: Task[]): Task[] {
  return tasks.map((task, index) => ({
    ...task,
    ownership: task.ownership ?? createOwnershipForTask(task.agentRole, index)
  }));
}

export function createBanquetWorkersWithAssignments(tasks: Task[]): BanquetWorker[] {
  const workers = createBanquetWorkers();
  for (const task of tasks) {
    const worker = workers.find((candidate) => candidate.id === task.ownership?.ownerWorkerId);
    if (worker) {
      worker.assignedTaskIds.push(task.id);
    }
  }
  return workers;
}

function createOwnershipForTask(agentRole: AgentRole, index: number): TaskOwnership {
  if (agentRole === "reconciliation_agent" || index === 2) {
    return {
      ownerWorkerId: "worker-3",
      claimedResources: ["aggregate-output"],
      scope: "reconciliation"
    };
  }

  if (index === 0) {
    return {
      ownerWorkerId: "worker-1",
      claimedResources: ["context"],
      scope: "investigation"
    };
  }

  return {
    ownerWorkerId: "worker-2",
    claimedResources: ["implementation-area"],
    scope: "execution"
  };
}
