import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentAdapter, AgentAdapterMetadata, AgentAdapterName } from "./adapter.js";
import { createAgentAdapter, getAgentAdapterMetadata } from "./registry.js";
import { isWindowsCommandShim, resolveNpmShimScriptPath, resolveSpawnRequest } from "./process-runner.js";
import { resolveProviderCommandForAdapter } from "./provider-command.js";
import { ClaudeCodeAgentAdapter, CodexCliAgentAdapter } from "./provider-adapters.js";
import { getMode } from "../modes/registry.js";
import type { AgentExecutionResult, Task } from "../core/types.js";
import { createRunId } from "../utils/ids.js";
import { isoNow } from "../utils/time.js";

export type ProviderCheckStatus = "passed" | "warning" | "failed";
export type ProviderDiagnosticStatus = ProviderCheckStatus | "skipped";
export type ProviderDiagnosticCategory = "installation" | "auth" | "model" | "windows_shim" | "capability" | "smoke";
export type ProviderDiagnosticSeverity = "info" | "warning" | "error";

export interface ProviderDiagnosticCheck {
  id: string;
  category: ProviderDiagnosticCategory;
  status: ProviderDiagnosticStatus;
  severity: ProviderDiagnosticSeverity;
  message: string;
  details?: Record<string, unknown>;
}

export interface ProviderDiagnosticsResult {
  checkId: string;
  adapter: AgentAdapterMetadata;
  status: ProviderCheckStatus;
  startedAt: string;
  completedAt: string;
  summary: string;
  checks: ProviderDiagnosticCheck[];
}

export interface ProviderDiagnosticsRequest {
  adapterName: AgentAdapterName;
  smoke?: boolean;
  timeoutMs?: number;
}

export interface ProviderDiagnosticsOptions {
  env?: NodeJS.ProcessEnv;
  createAdapter?: (name: AgentAdapterName, env: NodeJS.ProcessEnv) => AgentAdapter;
  commandExists?: (command: string) => Promise<boolean>;
}

const DEFAULT_TIMEOUT_MS = 300000;

export class ProviderDiagnosticsService {
  constructor(private readonly options: ProviderDiagnosticsOptions = {}) {}

  async check(request: ProviderDiagnosticsRequest): Promise<ProviderDiagnosticsResult> {
    const startedAt = isoNow();
    const adapter = getAgentAdapterMetadata(request.adapterName);
    const env = this.options.env ?? process.env;
    const checks: ProviderDiagnosticCheck[] = [];

    checks.push(await this.installationCheck(adapter, env));
    checks.push(this.authCheck(adapter, request.smoke ?? false));
    checks.push(this.modelCheck(adapter, env));
    checks.push(await this.windowsShimCheck(adapter, env));
    checks.push(this.capabilityCheck(adapter));
    checks.push(await this.smokeCheck(adapter, request, env));

    const completedAt = isoNow();
    const status = aggregateStatus(checks);
    return {
      checkId: `provider-check-${createRunId()}`,
      adapter,
      status,
      startedAt,
      completedAt,
      checks,
      summary: `${adapter.displayName} provider diagnostics ${status}.`
    };
  }

  private async installationCheck(adapter: AgentAdapterMetadata, env: NodeJS.ProcessEnv): Promise<ProviderDiagnosticCheck> {
    if (adapter.name === "mock") {
      return check("installation", "passed", "info", "Mock adapter is built in.", { command: "mock" });
    }
    if (adapter.name === "ollama") {
      const host = normalizedOllamaHost(env);
      return check("installation", "warning", "warning", `Ollama host configured as ${host}; use --smoke to verify it is reachable.`, {
        host
      });
    }

    const resolution = resolveProviderCommandForAdapter(adapter.name, env);
    const exists = resolution.found || (await this.commandExists(resolution.command));
    return exists
      ? check("installation", "passed", "info", `Provider command "${resolution.command}" is available.`, {
          command: resolution.command,
          resolvedCommand: resolution.resolvedCommand,
          commandSource: resolution.source
        })
      : check("installation", "failed", "error", `Provider command "${resolution.command}" could not be found.`, {
          command: resolution.command,
          resolvedCommand: resolution.resolvedCommand,
          commandSource: resolution.source
        });
  }

  private authCheck(adapter: AgentAdapterMetadata, smoke: boolean): ProviderDiagnosticCheck {
    if (!adapter.requiresCredentials) {
      return check("auth", "skipped", "info", `${adapter.displayName} does not require credentials.`);
    }
    if (smoke) {
      return check("auth", "skipped", "info", "Auth will be verified by the smoke test.");
    }
    return check("auth", "warning", "warning", "CLI auth cannot be verified without a smoke test; run with --smoke to verify credentials.");
  }

  private modelCheck(adapter: AgentAdapterMetadata, env: NodeJS.ProcessEnv): ProviderDiagnosticCheck {
    if (adapter.name === "mock") {
      return check("model", "skipped", "info", "Mock adapter does not use a model.");
    }
    const model = providerModel(adapter.name, env);
    if (adapter.name === "ollama" && !model) {
      return check("model", "failed", "error", "OPEN_KITCHEN_OLLAMA_MODEL is required.", { envVar: "OPEN_KITCHEN_OLLAMA_MODEL" });
    }
    if (!model) {
      return check("model", "warning", "warning", `${adapter.displayName} model env var is not set; provider default may be used.`, {
        envVar: modelEnvVar(adapter.name)
      });
    }
    return check("model", "passed", "info", `${modelEnvVar(adapter.name)} is set.`, {
      envVar: modelEnvVar(adapter.name),
      model
    });
  }

  private async windowsShimCheck(adapter: AgentAdapterMetadata, env: NodeJS.ProcessEnv): Promise<ProviderDiagnosticCheck> {
    if (adapter.kind !== "cli") {
      return check("windows_shim", "skipped", "info", `${adapter.displayName} does not use a Windows command shim.`);
    }
    if (process.platform !== "win32") {
      return check("windows_shim", "skipped", "info", "Windows shim diagnostics only apply on Windows.");
    }

    const resolution = resolveProviderCommandForAdapter(adapter.name, env);
    const command = resolution.resolvedCommand;
    if (!isWindowsCommandShim(command)) {
      return check("windows_shim", "passed", "info", `Command "${command}" is not a .cmd/.bat shim.`, {
        command: resolution.command,
        resolvedCommand: command,
        commandSource: resolution.source
      });
    }

    const content = await readTextIfExists(command);
    const scriptPath = content ? resolveNpmShimScriptPath(command, content) : undefined;
    const resolved = resolveSpawnRequest({ command, args: ["--version"], timeoutMs: DEFAULT_TIMEOUT_MS });
    if (scriptPath) {
      return check("windows_shim", "passed", "info", "Windows npm command shim resolves to a Node script.", {
        command,
        rawCommand: resolution.command,
        scriptPath,
        resolvedCommand: resolved.command,
        resolvedArgs: resolved.args
      });
    }
    return check("windows_shim", "warning", "warning", "Windows command shim will use cmd.exe fallback.", {
      command,
      rawCommand: resolution.command,
      resolvedCommand: resolved.command,
      resolvedArgs: resolved.args,
      windowsVerbatimArguments: resolved.windowsVerbatimArguments
    });
  }

  private capabilityCheck(adapter: AgentAdapterMetadata): ProviderDiagnosticCheck {
    return check("capability", "passed", "info", `${adapter.displayName} capabilities loaded.`, {
      supportsStreaming: adapter.capabilities.supportsStreaming,
      supportsParallelTasks: adapter.capabilities.supportsParallelTasks,
      supportsWorkspaceMutation: adapter.capabilities.supportsWorkspaceMutation,
      readOnlyEnforcement: adapter.capabilities.readOnlyEnforcement,
      maxConcurrency: adapter.capabilities.maxConcurrency
    });
  }

  private async smokeCheck(
    adapter: AgentAdapterMetadata,
    request: ProviderDiagnosticsRequest,
    env: NodeJS.ProcessEnv
  ): Promise<ProviderDiagnosticCheck> {
    if (!request.smoke) {
      return check("smoke", "skipped", "info", "Smoke test skipped; pass --smoke to execute the provider.");
    }

    const smokeEnv = envWithResolvedCommand(adapter.name, env);
    const provider = this.options.createAdapter?.(adapter.name, smokeEnv) ?? createAdapterWithEnv(adapter.name, smokeEnv);
    try {
      const result = await provider.execute({
        runId: "provider-health-check",
        task: smokeTask(),
        agentRole: "context_scout",
        mode: getMode("prep"),
        permissionIntent: "read_only",
        timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS
      });
      if (result.status === "completed") {
        return check("smoke", "passed", "info", "Provider smoke test completed.", smokeDetails(result));
      }
      return check("smoke", "failed", "error", "Provider smoke test failed.", smokeDetails(result));
    } catch (error) {
      return check("smoke", "failed", "error", `Provider smoke test threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async commandExists(command: string): Promise<boolean> {
    if (this.options.commandExists) {
      return this.options.commandExists(command);
    }
    return false;
  }
}

export class ProviderDiagnosticsLedger {
  constructor(private readonly root = path.join(process.cwd(), ".open-kitchen", "provider-checks")) {}

  getCheckPath(checkId: string): string {
    return path.join(this.root, checkId);
  }

  async write(result: ProviderDiagnosticsResult): Promise<string> {
    const checkPath = this.getCheckPath(result.checkId);
    await mkdir(path.join(checkPath, "artifacts"), { recursive: true });
    await appendFile(
      path.join(checkPath, "events.jsonl"),
      `${JSON.stringify({ timestamp: result.startedAt, type: "provider_check.started", message: `Started provider check ${result.adapter.name}.` })}\n`,
      "utf8"
    );
    for (const item of result.checks) {
      if (item.category === "smoke" && item.status !== "skipped") {
        await appendFile(
          path.join(checkPath, "events.jsonl"),
          `${JSON.stringify({
            timestamp: result.startedAt,
            type: "provider_check.smoke.started",
            message: `Started provider smoke test for ${result.adapter.name}.`,
            data: { status: item.status }
          })}\n`,
          "utf8"
        );
      }
      await appendFile(
        path.join(checkPath, "events.jsonl"),
        `${JSON.stringify({
          timestamp: result.completedAt,
          type: eventTypeForCheck(item),
          message: item.message,
          data: { category: item.category, status: item.status, severity: item.severity }
        })}\n`,
        "utf8"
      );
    }
    await writeFile(path.join(checkPath, "check.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(path.join(checkPath, "result.md"), renderProviderDiagnosticsMarkdown(result), "utf8");
    await appendFile(
      path.join(checkPath, "events.jsonl"),
      `${JSON.stringify({
        timestamp: result.completedAt,
        type: result.status === "failed" ? "provider_check.failed" : "provider_check.completed",
        message: result.summary,
        data: { status: result.status }
      })}\n`,
      "utf8"
    );
    return checkPath;
  }
}

export function renderProviderDiagnosticsLines(result: ProviderDiagnosticsResult, ledgerPath: string): string[] {
  return [
    result.summary,
    `Check: ${result.checkId}`,
    `Adapter: ${result.adapter.name} (${result.adapter.displayName})`,
    `Provider: ${result.adapter.provider}`,
    `Status: ${result.status}`,
    ...result.checks.map((item) => `${labelForCategory(item.category)}: ${item.status} - ${item.message}`),
    `Ledger: ${ledgerPath}`
  ];
}

export function renderProviderDiagnosticsMarkdown(result: ProviderDiagnosticsResult): string {
  return [
    "# OpenKitchen Provider Diagnostics",
    "",
    `- Check: ${result.checkId}`,
    `- Adapter: ${result.adapter.name} (${result.adapter.displayName})`,
    `- Provider: ${result.adapter.provider}`,
    `- Status: ${result.status}`,
    `- Started: ${result.startedAt}`,
    `- Completed: ${result.completedAt}`,
    "",
    "## Summary",
    "",
    result.summary,
    "",
    "## Checks",
    "",
    ...result.checks.map((item) => `- ${item.category}: ${item.status} (${item.severity}) - ${item.message}`)
  ].join("\n");
}

function check(
  category: ProviderDiagnosticCategory,
  status: ProviderDiagnosticStatus,
  severity: ProviderDiagnosticSeverity,
  message: string,
  details?: Record<string, unknown>
): ProviderDiagnosticCheck {
  return {
    id: `check-${category}`,
    category,
    status,
    severity,
    message,
    details
  };
}

function aggregateStatus(checks: ProviderDiagnosticCheck[]): ProviderCheckStatus {
  if (checks.some((item) => item.status === "failed")) {
    return "failed";
  }
  if (checks.some((item) => item.status === "warning")) {
    return "warning";
  }
  return "passed";
}

function providerModel(name: AgentAdapterName, env: NodeJS.ProcessEnv): string | undefined {
  if (name === "codex-cli") {
    return env.OPEN_KITCHEN_CODEX_MODEL;
  }
  if (name === "claude-code") {
    return env.OPEN_KITCHEN_CLAUDE_MODEL;
  }
  if (name === "ollama") {
    return env.OPEN_KITCHEN_OLLAMA_MODEL;
  }
  return undefined;
}

function modelEnvVar(name: AgentAdapterName): string {
  if (name === "codex-cli") {
    return "OPEN_KITCHEN_CODEX_MODEL";
  }
  if (name === "claude-code") {
    return "OPEN_KITCHEN_CLAUDE_MODEL";
  }
  if (name === "ollama") {
    return "OPEN_KITCHEN_OLLAMA_MODEL";
  }
  return "none";
}

function normalizedOllamaHost(env: NodeJS.ProcessEnv): string {
  return (env.OPEN_KITCHEN_OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function smokeTask(): Task {
  return {
    id: "provider-smoke",
    title: "Provider smoke test",
    prompt: "Respond with a short OpenKitchen provider health check confirmation. Do not modify files.",
    agentRole: "context_scout"
  };
}

function smokeDetails(result: AgentExecutionResult): Record<string, unknown> {
  return {
    taskId: result.taskId,
    status: result.status,
    provider: result.provider
      ? {
          adapterName: result.provider.adapterName,
          provider: result.provider.provider,
          model: result.provider.model,
          surface: result.provider.surface,
          durationMs: result.provider.durationMs,
          exitCode: result.provider.exitCode,
          failureCategory: result.provider.failureCategory,
          failureSummary: result.provider.failureSummary,
          timeoutMs: result.provider.timeoutMs,
          timeoutSource: result.provider.timeoutSource,
          timedOut: result.provider.timedOut,
          streamStats: result.provider.streamStats
        }
      : undefined,
    outputPreview: result.output.replace(/\s+/g, " ").slice(0, 240)
  };
}

function eventTypeForCheck(check: ProviderDiagnosticCheck): string {
  if (check.category === "smoke") {
    if (check.status === "skipped") {
      return "provider_check.smoke.skipped";
    }
    return check.status === "passed" ? "provider_check.smoke.completed" : "provider_check.smoke.failed";
  }
  return "provider_check.diagnostic.completed";
}

function labelForCategory(category: ProviderDiagnosticCategory): string {
  return category
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function envWithResolvedCommand(name: AgentAdapterName, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolution = resolveProviderCommandForAdapter(name, env);
  if (name === "codex-cli") {
    return { ...env, OPEN_KITCHEN_CODEX_BIN: resolution.resolvedCommand };
  }
  if (name === "claude-code") {
    return { ...env, OPEN_KITCHEN_CLAUDE_BIN: resolution.resolvedCommand };
  }
  return env;
}

function createAdapterWithEnv(name: AgentAdapterName, env: NodeJS.ProcessEnv): AgentAdapter {
  if (name === "codex-cli") {
    return new CodexCliAgentAdapter(undefined, env);
  }
  if (name === "claude-code") {
    return new ClaudeCodeAgentAdapter(undefined, env);
  }
  return createAgentAdapter(name);
}
