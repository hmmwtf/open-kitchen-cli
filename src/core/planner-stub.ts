import { generateMockTasks } from "../tasks/mock-task-generator.js";
import { createPlanId } from "../utils/ids.js";
import type { ModeDefinition, PlannerPlan, ResolvedPolicy } from "./types.js";

export interface PlannerStubInput {
  mode: ModeDefinition;
  policy: ResolvedPolicy;
  prompt: string;
}

export class PlannerStub {
  createPlan(input: PlannerStubInput): PlannerPlan {
    return {
      id: createPlanId(),
      decisionId: input.policy.decisionId,
      mode: input.mode.name,
      strategy: input.policy.strategy,
      reason: buildPlanReason(input.mode.displayName, input.policy.strategy),
      tasks: generateMockTasks(input.mode, input.policy, input.prompt)
    };
  }
}

function buildPlanReason(displayName: string, strategy: string): string {
  if (strategy === "parallel_tasks") {
    return `${displayName} planner stub created deterministic parallel worker tasks.`;
  }
  return `${displayName} planner stub created a deterministic task list.`;
}
