import type { AgentAdapter } from "../agents/adapter.js";
import type { AgentPermissionIntent, AgentProviderEventSink } from "../agents/adapter.js";
import type { AgentExecutionResult, ModeDefinition, ResolvedPolicy, Task } from "./types.js";
import type { RepositoryContextPrompt } from "../repository-map/types.js";

export interface ExecuteInput {
  runId: string;
  mode: ModeDefinition;
  policy: ResolvedPolicy;
  prompt: string;
  tasks: Task[];
  permissionIntent?: AgentPermissionIntent;
  model?: string;
  timeoutMs?: number;
  fast?: boolean;
  instant?: boolean;
  repositoryContext?: RepositoryContextPrompt;
  onProviderEvent?: AgentProviderEventSink;
}

export class Executor {
  constructor(private readonly agent: AgentAdapter) {}

  async execute(input: ExecuteInput): Promise<AgentExecutionResult[]> {
    if (input.policy.strategy === "direct") {
      const directTask: Task = {
        id: "direct",
        title: `${input.mode.displayName} direct execution`,
        prompt: input.prompt,
        agentRole: input.mode.defaultAgentRole
      };

      return [
        await this.agent.execute({
          runId: input.runId,
          task: directTask,
          agentRole: directTask.agentRole,
          mode: input.mode,
          policy: input.policy,
          permissionIntent: input.permissionIntent,
          model: input.model,
          timeoutMs: input.timeoutMs,
          fast: input.fast,
          instant: input.instant,
          repositoryContext: input.repositoryContext,
          onProviderEvent: input.onProviderEvent
        })
      ];
    }

    const executions = input.tasks.map((task) =>
      this.agent.execute({
        runId: input.runId,
        task,
        agentRole: task.agentRole,
        mode: input.mode,
        policy: input.policy,
        permissionIntent: input.permissionIntent,
        model: input.model,
        timeoutMs: input.timeoutMs,
        fast: input.fast,
        instant: input.instant,
        repositoryContext: input.repositoryContext,
        onProviderEvent: input.onProviderEvent
      })
    );

    return Promise.all(executions);
  }
}
