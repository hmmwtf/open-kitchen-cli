import type { AgentAdapterMetadata, AgentPermissionIntent } from "./adapter.js";
import type { ModeDefinition, ResolvedPolicy } from "../core/types.js";

export interface AgentCapabilityDecision {
  adapterName: string;
  permissionIntent: AgentPermissionIntent;
  accepted: boolean;
  reason: string;
}

export function permissionIntentForMode(mode: ModeDefinition): AgentPermissionIntent {
  return mode.allowsMutation ? "workspace_write" : "read_only";
}

export function validateAgentCapabilities(input: {
  adapter: AgentAdapterMetadata;
  mode: ModeDefinition;
  policy: ResolvedPolicy;
}): AgentCapabilityDecision {
  const permissionIntent = permissionIntentForMode(input.mode);
  const capabilities = input.adapter.capabilities;

  if (input.policy.strategy === "parallel_tasks" && !capabilities.supportsParallelTasks) {
    return rejected(
      input.adapter.name,
      permissionIntent,
      `Adapter "${input.adapter.name}" does not support parallel task execution required by ${input.mode.displayName}.`
    );
  }

  if (permissionIntent === "workspace_write" && !capabilities.supportsWorkspaceMutation) {
    return rejected(
      input.adapter.name,
      permissionIntent,
      `Adapter "${input.adapter.name}" does not support workspace mutation required by ${input.mode.displayName}.`
    );
  }

  if (permissionIntent === "read_only" && capabilities.readOnlyEnforcement === "none") {
    return rejected(
      input.adapter.name,
      permissionIntent,
      `Adapter "${input.adapter.name}" cannot enforce read-only execution required by ${input.mode.displayName}.`
    );
  }

  return {
    adapterName: input.adapter.name,
    permissionIntent,
    accepted: true,
    reason: `Adapter "${input.adapter.name}" supports ${input.mode.name} ${input.policy.strategy} execution.`
  };
}

function rejected(
  adapterName: string,
  permissionIntent: AgentPermissionIntent,
  reason: string
): AgentCapabilityDecision {
  return {
    adapterName,
    permissionIntent,
    accepted: false,
    reason
  };
}
