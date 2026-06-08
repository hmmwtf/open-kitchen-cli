import type { Decision, ModeDefinition, ResolvedPolicy } from "./types.js";

export interface PolicyResolveInput {
  mode: ModeDefinition;
  decision: Decision;
  requireApproval?: boolean;
}

export function resolvePolicy(input: PolicyResolveInput): ResolvedPolicy {
  if (input.requireApproval && !input.mode.allowedPolicies.includes("approval_gated")) {
    throw new Error(`${input.mode.displayName} does not allow approval_gated policy.`);
  }

  if (input.decision.selectedStrategy === "parallel_tasks") {
    return {
      decisionId: input.decision.id,
      decisionKind: input.decision.kind,
      strategy: "parallel_tasks",
      policies: withApproval(input.mode.defaultPolicies, input.requireApproval),
      reason: input.decision.reason,
      requiresTasks: true,
      agentRoles: input.mode.agentRoles
    };
  }

  if (input.decision.selectedStrategy === "task_list") {
    return {
      decisionId: input.decision.id,
      decisionKind: input.decision.kind,
      strategy: "task_list",
      policies: withApproval(uniquePolicies([...input.mode.defaultPolicies, "task_first"]), input.requireApproval),
      reason: input.decision.reason,
      requiresTasks: true,
      agentRoles: [input.mode.defaultAgentRole]
    };
  }

  return {
    decisionId: input.decision.id,
    decisionKind: input.decision.kind,
    strategy: "direct",
    policies: withApproval(input.mode.defaultPolicies, input.requireApproval),
    reason: input.decision.reason,
    requiresTasks: false,
    agentRoles: [input.mode.defaultAgentRole]
  };
}

function uniquePolicies<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function withApproval<T extends string>(policies: T[], requireApproval?: boolean): T[] {
  return requireApproval ? uniquePolicies([...policies, "approval_gated" as T]) : policies;
}
