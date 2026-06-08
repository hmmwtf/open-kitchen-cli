import type { AgentExecutionResult, Task } from "../core/types.js";
import type { BanquetConflict, BanquetReconciliation } from "./types.js";

export function reconcileBanquetOutputs(input: {
  tasks: Task[];
  taskResults: AgentExecutionResult[];
  conflicts: BanquetConflict[];
}): BanquetReconciliation {
  const failedTaskIds = input.taskResults.filter((result) => result.status === "failed").map((result) => result.taskId);
  const conflictTaskIds = [...new Set(input.conflicts.flatMap((conflict) => conflict.taskIds))];

  if (failedTaskIds.length > 0) {
    const acceptedTaskIds = input.taskResults
      .filter((result) => result.status === "completed")
      .map((result) => result.taskId);

    return {
      status: "failed",
      summary: `Banquet reconciliation failed because ${failedTaskIds.length} task(s) failed.`,
      acceptedTaskIds,
      rejectedTaskIds: failedTaskIds,
      notes: [
        "Completed worker outputs were preserved.",
        `Rejected failed task(s): ${failedTaskIds.join(", ")}.`
      ]
    };
  }

  if (input.conflicts.length > 0) {
    return {
      status: "completed_with_conflicts",
      summary: `Banquet reconciliation completed with ${input.conflicts.length} conflict(s).`,
      acceptedTaskIds: input.tasks.map((task) => task.id).filter((taskId) => !conflictTaskIds.includes(taskId)),
      rejectedTaskIds: conflictTaskIds,
      notes: input.conflicts.map((conflict) => conflict.reason)
    };
  }

  return {
    status: "completed",
    summary: "Banquet reconciliation completed with no conflicts.",
    acceptedTaskIds: input.taskResults.filter((result) => result.status === "completed").map((result) => result.taskId),
    rejectedTaskIds: [],
    notes: ["No resource conflicts were detected."]
  };
}
