import type { ModeDefinition } from "../core/types.js";

export const modeDefinitions: ModeDefinition[] = [
  {
    name: "chef",
    displayName: "Chef",
    description: "Default orchestration mode for direct execution, routing, and lightweight coordination.",
    defaultPolicies: ["direct", "planner_optional", "handoff_enabled"],
    allowedPolicies: ["direct", "planner_optional", "task_first", "approval_gated", "handoff_enabled"],
    agentRoles: ["orchestrator", "implementation_agent", "validation_agent"],
    defaultAgentRole: "orchestrator",
    planner: "optional",
    allowsMutation: true,
    allowsMultipleAgents: false,
    handoffTargets: ["prep", "cook", "taste", "banquet"]
  },
  {
    name: "prep",
    displayName: "Prep",
    description: "Context and readiness mode for inspection before execution.",
    defaultPolicies: ["read_first", "evidence_first", "handoff_enabled"],
    allowedPolicies: ["read_first", "evidence_first", "planner_optional", "handoff_enabled"],
    agentRoles: ["context_scout", "dependency_mapper"],
    defaultAgentRole: "context_scout",
    planner: "optional",
    allowsMutation: false,
    allowsMultipleAgents: false,
    handoffTargets: ["chef", "cook", "taste", "banquet"]
  },
  {
    name: "cook",
    displayName: "Cook",
    description: "Focused implementation mode for known coding work.",
    defaultPolicies: ["direct", "validation_aware", "handoff_enabled"],
    allowedPolicies: ["direct", "task_first", "validation_aware", "handoff_enabled"],
    agentRoles: ["implementation_agent", "debugger"],
    defaultAgentRole: "implementation_agent",
    planner: "optional",
    allowsMutation: true,
    allowsMultipleAgents: false,
    handoffTargets: ["chef", "taste", "banquet"]
  },
  {
    name: "taste",
    displayName: "Taste",
    description: "Validation and review mode for evidence-backed quality checks.",
    defaultPolicies: ["evidence_first", "review_gated", "handoff_enabled"],
    allowedPolicies: ["evidence_first", "review_gated", "task_first", "handoff_enabled"],
    agentRoles: ["reviewer", "test_runner"],
    defaultAgentRole: "reviewer",
    planner: "optional",
    allowsMutation: false,
    allowsMultipleAgents: false,
    handoffTargets: ["chef", "cook", "banquet"]
  },
  {
    name: "banquet",
    displayName: "Banquet",
    description: "Multi-agent parallel execution mode with reconciliation.",
    defaultPolicies: ["task_first", "parallel", "evidence_first", "review_gated", "handoff_enabled"],
    allowedPolicies: ["task_first", "parallel", "evidence_first", "review_gated", "handoff_enabled"],
    agentRoles: ["coordinator", "worker", "reconciliation_agent", "validation_agent"],
    defaultAgentRole: "coordinator",
    planner: "required",
    allowsMutation: true,
    allowsMultipleAgents: true,
    handoffTargets: ["chef", "cook", "taste"]
  }
];
