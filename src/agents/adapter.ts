import type { AgentExecutionResult, AgentRole, ModeDefinition, ResolvedPolicy, Task } from "../core/types.js";
import type { RepositoryContextPrompt } from "../repository-map/types.js";

export type AgentAdapterName = "mock" | "codex-cli" | "claude-code" | "ollama";
export type AgentAdapterKind = "mock" | "cli" | "http";
export type AgentProviderName = "mock" | "openai" | "anthropic" | "ollama";
export type AgentExecutionSurface = "mock" | "subprocess" | "http";
export type AgentPermissionIntent = "read_only" | "workspace_write";
export type AgentReadOnlyEnforcement = "native" | "prompt" | "none";
export type AgentCredentialSource = "none" | "cli-auth" | "environment" | "local-service";
export type AgentModelSource = "none" | "environment" | "provider-default";

export interface AgentAdapterCapabilities {
  executionSurface: AgentExecutionSurface;
  supportsParallelTasks: boolean;
  supportsStreaming: boolean;
  supportsWorkspaceMutation: boolean;
  readOnlyEnforcement: AgentReadOnlyEnforcement;
  credentialSource: AgentCredentialSource;
  modelSource: AgentModelSource;
  maxConcurrency: number;
}

export interface AgentAdapterMetadata {
  name: AgentAdapterName;
  displayName: string;
  kind: AgentAdapterKind;
  provider: AgentProviderName;
  isMock: boolean;
  supportsParallel: boolean;
  supportsStreaming: boolean;
  requiresCredentials: boolean;
  capabilities: AgentAdapterCapabilities;
}

export interface AgentAdapter {
  readonly metadata: AgentAdapterMetadata;
  execute(input: AgentAdapterInput): Promise<AgentExecutionResult>;
}

export interface AgentAdapterInput {
  runId: string;
  task: Task;
  agentRole: AgentRole;
  mode?: ModeDefinition;
  policy?: ResolvedPolicy;
  permissionIntent?: AgentPermissionIntent;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  fast?: boolean;
  instant?: boolean;
  repositoryContext?: RepositoryContextPrompt;
  onProviderEvent?: AgentProviderEventSink;
}

export type AgentProviderEventType =
  | "provider.invocation.started"
  | "provider.stream.chunk"
  | "provider.invocation.completed"
  | "provider.invocation.failed"
  | "provider.invocation.timed_out";

export interface AgentProviderEvent {
  type: AgentProviderEventType;
  message: string;
  data?: Record<string, unknown>;
}

export type AgentProviderEventSink = (event: AgentProviderEvent) => Promise<void> | void;
