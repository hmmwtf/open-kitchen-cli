import type { AgentAdapter, AgentAdapterInput, AgentAdapterMetadata } from "./adapter.js";
import type { AgentExecutionResult } from "../core/types.js";

export const mockAgentAdapterMetadata: AgentAdapterMetadata = {
  name: "mock",
  displayName: "Mock Agent Adapter",
  kind: "mock",
  provider: "mock",
  isMock: true,
  supportsParallel: true,
  supportsStreaming: false,
  requiresCredentials: false,
  capabilities: {
    executionSurface: "mock",
    supportsParallelTasks: true,
    supportsStreaming: false,
    supportsWorkspaceMutation: true,
    readOnlyEnforcement: "native",
    credentialSource: "none",
    modelSource: "none",
    maxConcurrency: 32
  }
};

export class MockAgentAdapter implements AgentAdapter {
  readonly metadata = mockAgentAdapterMetadata;

  async execute(input: AgentAdapterInput): Promise<AgentExecutionResult> {
    return {
      taskId: input.task.id,
      agentRole: input.agentRole,
      status: "completed",
      artifactName: `agent-output-${input.task.id}.md`,
      output: [
        `# Mock Agent Output`,
        ``,
        `Run: ${input.runId}`,
        `Task: ${input.task.id}`,
        `Role: ${input.agentRole}`,
        `Title: ${input.task.title}`,
        ``,
        `Prompt: ${input.task.prompt}`,
        ``,
        `This is deterministic mock execution. No provider was called.`
      ].join("\n")
    };
  }
}
