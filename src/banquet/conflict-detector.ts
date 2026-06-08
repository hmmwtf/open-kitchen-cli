import type { Task } from "../core/types.js";
import type { BanquetConflict, BanquetConflictSeverity } from "./types.js";

export function detectBanquetConflicts(tasks: Task[]): BanquetConflict[] {
  const conflicts: BanquetConflict[] = [];

  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
      const left = tasks[leftIndex];
      const right = tasks[rightIndex];
      const resources = sharedConflictResources(left, right);

      if (resources.length === 0) {
        continue;
      }

      conflicts.push({
        id: `banquet-conflict-${conflicts.length + 1}`,
        taskIds: [left.id, right.id],
        resources,
        severity: conflictSeverity(resources),
        reason: `Tasks ${left.id} and ${right.id} claim overlapping Banquet resources: ${resources.join(", ")}.`
      });
    }
  }

  return conflicts;
}

function sharedConflictResources(left: Task, right: Task): string[] {
  const leftResources = left.ownership?.claimedResources ?? [];
  const rightResources = new Set(right.ownership?.claimedResources ?? []);
  return leftResources
    .filter((resource) => rightResources.has(resource))
    .filter((resource) => resource !== "context")
    .filter((resource) => !isIgnoredAggregateOverlap(resource, left, right));
}

function isIgnoredAggregateOverlap(resource: string, left: Task, right: Task): boolean {
  return (
    resource === "aggregate-output" &&
    (left.ownership?.scope === "reconciliation" || right.ownership?.scope === "reconciliation")
  );
}

function conflictSeverity(resources: string[]): BanquetConflictSeverity {
  if (resources.includes("implementation-area")) {
    return "medium";
  }
  return "low";
}
