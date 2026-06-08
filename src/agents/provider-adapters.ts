import type { AgentAdapter, AgentAdapterInput, AgentAdapterMetadata } from "./adapter.js";
import type { AgentExecutionResult } from "../core/types.js";
import type { ProcessRunner } from "./process-runner.js";
import { nodeProcessRunner } from "./process-runner.js";
import { resolveProviderCommandForAdapter } from "./provider-command.js";
import {
  classifyProviderFailure,
  createEmptyStreamStats,
  parseProviderOutput,
  parseProviderOutputWithOptions,
  providerMetadataBase,
  resolveProviderTimeout
} from "./provider-reliability.js";
import type { ProviderOutputReadability, ProviderStreamStats, ProviderTimeoutConfig } from "./provider-reliability.js";

const DEFAULT_TIMEOUT_MS = 300000;
const INSTANT_TIMEOUT_MS = 15000;

export const codexCliAdapterMetadata: AgentAdapterMetadata = {
  name: "codex-cli",
  displayName: "Codex CLI Adapter",
  kind: "cli",
  provider: "openai",
  isMock: false,
  supportsParallel: false,
  supportsStreaming: true,
  requiresCredentials: true,
  capabilities: {
    executionSurface: "subprocess",
    supportsParallelTasks: false,
    supportsStreaming: true,
    supportsWorkspaceMutation: true,
    readOnlyEnforcement: "native",
    credentialSource: "cli-auth",
    modelSource: "environment",
    maxConcurrency: 1
  }
};

export const claudeCodeAdapterMetadata: AgentAdapterMetadata = {
  name: "claude-code",
  displayName: "Claude Code Adapter",
  kind: "cli",
  provider: "anthropic",
  isMock: false,
  supportsParallel: false,
  supportsStreaming: true,
  requiresCredentials: true,
  capabilities: {
    executionSurface: "subprocess",
    supportsParallelTasks: false,
    supportsStreaming: true,
    supportsWorkspaceMutation: true,
    readOnlyEnforcement: "native",
    credentialSource: "cli-auth",
    modelSource: "environment",
    maxConcurrency: 1
  }
};

export const ollamaAdapterMetadata: AgentAdapterMetadata = {
  name: "ollama",
  displayName: "Ollama Adapter",
  kind: "http",
  provider: "ollama",
  isMock: false,
  supportsParallel: true,
  supportsStreaming: true,
  requiresCredentials: false,
  capabilities: {
    executionSurface: "http",
    supportsParallelTasks: true,
    supportsStreaming: true,
    supportsWorkspaceMutation: false,
    readOnlyEnforcement: "prompt",
    credentialSource: "local-service",
    modelSource: "environment",
    maxConcurrency: 3
  }
};

export class CodexCliAgentAdapter implements AgentAdapter {
  readonly metadata = codexCliAdapterMetadata;

  constructor(private readonly runner: ProcessRunner = nodeProcessRunner, private readonly env = process.env) {}

  async execute(input: AgentAdapterInput): Promise<AgentExecutionResult> {
    const bin = resolveProviderCommandForAdapter("codex-cli", this.env).resolvedCommand;
    const model = input.model ?? (input.instant ? this.env.OPEN_KITCHEN_CODEX_INSTANT_MODEL : undefined) ?? this.env.OPEN_KITCHEN_CODEX_MODEL;
    return runCliAdapter({
      input,
      metadata: this.metadata,
      command: bin,
      args: [
        "exec",
        "--json",
        ...(input.fast || input.instant ? ["--ephemeral"] : []),
        "--sandbox",
        input.permissionIntent === "workspace_write" ? "workspace-write" : "read-only",
        ...(model ? ["--model", model] : []),
        providerPrompt(input)
      ],
      model,
      env: this.env,
      runner: this.runner
    });
  }
}

export class ClaudeCodeAgentAdapter implements AgentAdapter {
  readonly metadata = claudeCodeAdapterMetadata;

  constructor(private readonly runner: ProcessRunner = nodeProcessRunner, private readonly env = process.env) {}

  async execute(input: AgentAdapterInput): Promise<AgentExecutionResult> {
    const bin = resolveProviderCommandForAdapter("claude-code", this.env).resolvedCommand;
    const model = input.model ?? this.env.OPEN_KITCHEN_CLAUDE_MODEL;
    return runCliAdapter({
      input,
      metadata: this.metadata,
      command: bin,
      args: [
        "-p",
        providerPrompt(input),
        "--output-format",
        "stream-json",
        "--permission-mode",
        input.permissionIntent === "workspace_write" ? "acceptEdits" : "plan",
        ...(model ? ["--model", model] : [])
      ],
      model,
      env: this.env,
      runner: this.runner
    });
  }
}

export type HttpFetch = typeof fetch;

export class OllamaAgentAdapter implements AgentAdapter {
  readonly metadata = ollamaAdapterMetadata;

  constructor(private readonly httpFetch: HttpFetch = fetch, private readonly env = process.env) {}

  async execute(input: AgentAdapterInput): Promise<AgentExecutionResult> {
    const startedAt = Date.now();
    const timeout = resolveProviderTimeout(input.timeoutMs, this.env, input.instant ? INSTANT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
    const model = input.model ?? this.env.OPEN_KITCHEN_OLLAMA_MODEL;
    const streamStats = createEmptyStreamStats();
    if (!model) {
      return failedProviderResult({
        input,
        metadata: this.metadata,
        startedAt,
        reason: "OPEN_KITCHEN_OLLAMA_MODEL is required.",
        model,
        timeout,
        outputText: "",
        streamStats
      });
    }

    const host = (this.env.OPEN_KITCHEN_OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout.timeoutMs);
    let output = "";

    try {
      await emitProviderEvent(input, {
        type: "provider.invocation.started",
        message: `Started ${this.metadata.name} task ${input.task.id}.`,
        data: providerEventBase(input, this.metadata, model)
      });
      const response = await this.httpFetch(`${host}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          prompt: providerPrompt(input),
          stream: true
        })
      });

      if (!response.ok) {
        return failedProviderResult({
          input,
          metadata: this.metadata,
          startedAt,
          reason: `Ollama returned HTTP ${response.status}.`,
          model,
          timeout,
          outputText: output,
          streamStats
        });
      }

      const text = await response.text();
      const parsed = parseProviderOutput(text, streamStats);
      output = parsed.text;
      for (const line of output.split(/\r?\n/).filter((item) => item.trim().length > 0)) {
        await emitProviderEvent(input, {
          type: "provider.stream.chunk",
          message: `Received ${this.metadata.name} stream chunk.`,
          data: { ...providerEventBase(input, this.metadata, model), preview: preview(line) }
        });
      }

      await emitProviderEvent(input, {
        type: "provider.invocation.completed",
        message: `Completed ${this.metadata.name} task ${input.task.id}.`,
        data: { ...providerEventBase(input, this.metadata, model), durationMs: Date.now() - startedAt }
      });

      if (!output.trim()) {
        return failedProviderResult({
          input,
          metadata: this.metadata,
          startedAt,
          reason: "Provider exited successfully but produced no usable text output.",
          model,
          timeout,
          outputText: output,
          streamStats: parsed.stats
        });
      }
      return completedProviderResult({
        input,
        metadata: this.metadata,
        startedAt,
        output,
        rawOutput: text,
        model,
        timeout,
        streamStats: parsed.stats,
        readability: withArtifactRefs(parsed.readability, input.task.id)
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError" ? "Provider invocation timed out." : sanitizeError(error);
      const timedOut = reason.includes("timed out");
      await emitProviderEvent(input, {
        type: timedOut ? "provider.invocation.timed_out" : "provider.invocation.failed",
        message: `${this.metadata.name} task ${input.task.id} failed.`,
        data: { ...providerEventBase(input, this.metadata, model), reason }
      });
      return failedProviderResult({
        input,
        metadata: this.metadata,
        startedAt,
        reason,
        model,
        timeout,
        timedOut,
        outputText: output,
        streamStats
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

async function runCliAdapter(input: {
  input: AgentAdapterInput;
  metadata: AgentAdapterMetadata;
  command: string;
  args: string[];
  model?: string;
  env: NodeJS.ProcessEnv;
  runner: ProcessRunner;
}): Promise<AgentExecutionResult> {
  const startedAt = Date.now();
  const timeout = resolveProviderTimeout(input.input.timeoutMs, input.env, input.input.instant ? INSTANT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const streamStats = createEmptyStreamStats();
  const streamEventPromises: Promise<void>[] = [];
  let stdout = "";
  let stderr = "";

  try {
    await emitProviderEvent(input.input, {
      type: "provider.invocation.started",
      message: `Started ${input.metadata.name} task ${input.input.task.id}.`,
      data: providerEventBase(input.input, input.metadata, input.model)
    });
    const result = await input.runner({
      command: input.command,
      args: input.args,
      cwd: input.input.cwd,
      timeoutMs: timeout.timeoutMs,
      onStdout: (chunk) => {
        stdout += chunk;
        streamStats.stdoutChunkCount += 1;
        streamEventPromises.push(
          emitProviderEvent(input.input, {
            type: "provider.stream.chunk",
            message: `Received ${input.metadata.name} stdout chunk.`,
            data: { ...providerEventBase(input.input, input.metadata, input.model), preview: preview(chunk) }
          })
        );
      },
      onStderr: (chunk) => {
        stderr += chunk;
        streamStats.stderrChunkCount += 1;
        streamEventPromises.push(
          emitProviderEvent(input.input, {
            type: "provider.stream.chunk",
            message: `Received ${input.metadata.name} stderr chunk.`,
            data: { ...providerEventBase(input.input, input.metadata, input.model), stream: "stderr", preview: preview(chunk) }
          })
        );
      }
    });
    await Promise.all(streamEventPromises);

    stdout += result.stdout;
    stderr += result.stderr;
    const rawOutput = [stdout, stderr].filter((item) => item.length > 0).join("\n");
    const parsed = parseProviderOutputWithOptions(stdout, streamStats, { stderr });
    if (result.timedOut) {
      await emitProviderEvent(input.input, {
        type: "provider.invocation.timed_out",
        message: `${input.metadata.name} task ${input.input.task.id} timed out.`,
        data: { ...providerEventBase(input.input, input.metadata, input.model), durationMs: result.durationMs }
      });
      return failedProviderResult({
        input: input.input,
        metadata: input.metadata,
        startedAt,
        reason: "Provider invocation timed out.",
        model: input.model,
        exitCode: result.exitCode,
        timeout,
        timedOut: true,
        resolvedCommand: input.command,
        outputText: parsed.text,
        rawOutput,
        streamStats: parsed.stats,
        readability: withArtifactRefs(parsed.readability, input.input.task.id)
      });
    }
    if (result.exitCode !== 0) {
      const reason = stderr.trim() || `Provider exited with code ${result.exitCode}.`;
      await emitProviderEvent(input.input, {
        type: "provider.invocation.failed",
        message: `${input.metadata.name} task ${input.input.task.id} failed.`,
        data: { ...providerEventBase(input.input, input.metadata, input.model), exitCode: result.exitCode, reason: preview(reason) }
      });
      return failedProviderResult({
        input: input.input,
        metadata: input.metadata,
        startedAt,
        reason: preview(reason),
        model: input.model,
        exitCode: result.exitCode,
        timeout,
        resolvedCommand: input.command,
        outputText: parsed.text,
        rawOutput,
        streamStats: parsed.stats,
        readability: withArtifactRefs(parsed.readability, input.input.task.id)
      });
    }
    if (!parsed.text.trim()) {
      return failedProviderResult({
        input: input.input,
        metadata: input.metadata,
        startedAt,
        reason: "Provider exited successfully but produced no usable text output.",
        model: input.model,
        exitCode: result.exitCode,
        timeout,
        resolvedCommand: input.command,
        outputText: parsed.text,
        rawOutput,
        streamStats: parsed.stats,
        readability: withArtifactRefs(parsed.readability, input.input.task.id)
      });
    }

    await emitProviderEvent(input.input, {
      type: "provider.invocation.completed",
      message: `Completed ${input.metadata.name} task ${input.input.task.id}.`,
      data: { ...providerEventBase(input.input, input.metadata, input.model), durationMs: result.durationMs }
    });
    return completedProviderResult({
      input: input.input,
      metadata: input.metadata,
      startedAt,
      output: parsed.text,
      rawOutput,
      model: input.model,
      exitCode: result.exitCode,
      timeout,
      resolvedCommand: input.command,
      streamStats: parsed.stats,
      readability: withArtifactRefs(parsed.readability, input.input.task.id)
    });
  } catch (error) {
    const reason = sanitizeError(error);
    await emitProviderEvent(input.input, {
      type: "provider.invocation.failed",
      message: `${input.metadata.name} task ${input.input.task.id} failed.`,
      data: { ...providerEventBase(input.input, input.metadata, input.model), reason }
    });
    return failedProviderResult({
      input: input.input,
      metadata: input.metadata,
      startedAt,
      reason,
      model: input.model,
      timeout,
      resolvedCommand: input.command,
      outputText: stdout,
      rawOutput: [stdout, stderr].filter((item) => item.length > 0).join("\n"),
      streamStats
    });
  }
}

function providerPrompt(input: AgentAdapterInput): string {
  const permission =
    input.permissionIntent === "workspace_write"
      ? "Workspace edits are allowed by the selected OpenKitchen mode."
      : "Do not modify files. Return findings or proposed changes only.";
  const fastInstruction = input.fast
    ? "Fast mode: prioritize a concise answer using the provided OpenKitchen context. Avoid broad repository exploration. Run at most one targeted read command only if necessary. Prefer a short final answer."
    : undefined;
  const instantInstruction = input.instant
    ? "Instant mode: answer using only the provided OpenKitchen context. Do not run shell commands. Do not inspect additional files. Do not browse the repository. Prefer a concise final answer in 5 bullets or less. If the provided context is insufficient, say what is missing instead of exploring."
    : undefined;
  return [
    `OpenKitchen mode: ${input.mode?.name ?? "unknown"}`,
    `Agent role: ${input.agentRole}`,
    `Task: ${input.task.title}`,
    permission,
    ...(instantInstruction ? [instantInstruction] : fastInstruction ? [fastInstruction] : []),
    ...(input.repositoryContext
      ? [
          "",
          "Repository Context Map:",
          "This deterministic map is orientation only and may be incomplete.",
          "Use it to identify relevant files, but inspect specific files before making detailed claims.",
          "",
          input.repositoryContext.markdown
        ]
      : []),
    "",
    input.task.prompt
  ].join("\n");
}

function completedProviderResult(input: {
  input: AgentAdapterInput;
  metadata: AgentAdapterMetadata;
  startedAt: number;
  output: string;
  rawOutput?: string;
  model?: string;
  exitCode?: number;
  timeout: ProviderTimeoutConfig;
  resolvedCommand?: string;
  streamStats?: ProviderStreamStats;
  readability?: ProviderOutputReadability;
}): AgentExecutionResult {
  const outputArtifactName = `agent-output-${input.input.task.id}.md`;
  const rawOutputArtifactName = `provider-raw-output-${input.input.task.id}.txt`;
  return {
    taskId: input.input.task.id,
    agentRole: input.input.agentRole,
    status: "completed",
    artifactName: outputArtifactName,
    output: input.output.trim(),
    rawOutput: input.rawOutput,
    rawOutputArtifactName: input.rawOutput ? rawOutputArtifactName : undefined,
    provider: providerMetadataBase({
      adapter: input.metadata,
      model: input.model,
      surface: input.metadata.capabilities.executionSurface,
      startedAt: input.startedAt,
      timeout: input.timeout,
      resolvedCommand: input.resolvedCommand,
      exitCode: input.exitCode,
      streamStats: input.streamStats,
      readability: input.readability
        ? withArtifactRefs(input.readability, input.input.task.id, input.rawOutput ? rawOutputArtifactName : undefined)
        : undefined
    })
  };
}

function failedProviderResult(input: {
  input: AgentAdapterInput;
  metadata: AgentAdapterMetadata;
  startedAt: number;
  reason: string;
  model?: string;
  exitCode?: number;
  timeout: ProviderTimeoutConfig;
  timedOut?: boolean;
  resolvedCommand?: string;
  outputText?: string;
  rawOutput?: string;
  streamStats?: ProviderStreamStats;
  readability?: ProviderOutputReadability;
}): AgentExecutionResult {
  const classification = classifyProviderFailure({
    adapter: input.metadata,
    reason: input.reason,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    parseErrorCount: input.streamStats?.parseErrorCount,
    outputText: input.outputText
  });
  const outputArtifactName = `agent-output-${input.input.task.id}.md`;
  const rawOutputArtifactName = `provider-raw-output-${input.input.task.id}.txt`;
  return {
    taskId: input.input.task.id,
    agentRole: input.input.agentRole,
    status: "failed",
    artifactName: outputArtifactName,
    output: `${classification.failureSummary}\n\nReason: ${input.reason}`,
    rawOutput: input.rawOutput,
    rawOutputArtifactName: input.rawOutput ? rawOutputArtifactName : undefined,
    provider: {
      ...providerMetadataBase({
        adapter: input.metadata,
        model: input.model,
        surface: input.metadata.capabilities.executionSurface,
        startedAt: input.startedAt,
        timeout: input.timeout,
        resolvedCommand: input.resolvedCommand,
        exitCode: input.exitCode,
        timedOut: input.timedOut,
        streamStats: input.streamStats,
        readability: input.readability
          ? withArtifactRefs(input.readability, input.input.task.id, input.rawOutput ? rawOutputArtifactName : undefined)
          : undefined
      }),
      failureReason: input.reason,
      failureCategory: classification.failureCategory,
      failureSummary: classification.failureSummary
    }
  };
}

function withArtifactRefs(
  readability: ProviderOutputReadability,
  taskId: string,
  rawOutputArtifactName = `provider-raw-output-${taskId}.txt`
): ProviderOutputReadability {
  return {
    ...readability,
    artifactRefs: {
      ...readability.artifactRefs,
      outputArtifactName: `agent-output-${taskId}.md`,
      ...(rawOutputArtifactName ? { rawOutputArtifactName } : {})
    }
  };
}

async function emitProviderEvent(input: AgentAdapterInput, event: Parameters<NonNullable<AgentAdapterInput["onProviderEvent"]>>[0]): Promise<void> {
  await input.onProviderEvent?.(event);
}

function providerEventBase(input: AgentAdapterInput, metadata: AgentAdapterMetadata, model?: string): Record<string, unknown> {
  return {
    adapter: metadata.name,
    provider: metadata.provider,
    model,
    taskId: input.task.id,
    agentRole: input.agentRole,
    permissionIntent: input.permissionIntent
  };
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function preview(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 240);
}
