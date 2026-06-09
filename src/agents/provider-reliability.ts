import type { AgentAdapterMetadata, AgentExecutionSurface } from "./adapter.js";

export type ProviderFailureCategory =
  | "installation_failure"
  | "auth_failure"
  | "model_failure"
  | "timeout"
  | "nonzero_exit"
  | "stream_parse_failure"
  | "empty_output"
  | "unknown_failure";

export type ProviderTimeoutSource = "request" | "environment" | "default";

export interface ProviderStreamStats {
  stdoutChunkCount: number;
  stderrChunkCount: number;
  jsonLineCount: number;
  parseErrorCount: number;
  extractedTextLength: number;
}

export type ProviderFinalAnswerSource = "last_agent_message" | "raw_text_fallback" | "none";

export type ProviderQualityFlag =
  | "completed_with_warnings"
  | "large_output"
  | "provider_stderr"
  | "blocked_command"
  | "command_failure"
  | "missing_final_answer"
  | "raw_text_fallback"
  | "stream_parse_failure"
  | "timed_out_with_answer"
  | "timed_out_without_structured_answer";

export interface ProviderWarning {
  source: "stdout" | "stderr" | "parser";
  message: string;
}

export interface ProviderCommandSummary {
  command?: string;
  status: "completed" | "failed" | "blocked" | "unknown";
  exitCode?: number;
  preview?: string;
}

export interface ProviderOutputSize {
  rawLength: number;
  extractedTextLength: number;
  finalAnswerLength: number;
  largeOutput: boolean;
  largeOutputThreshold: number;
}

export interface ProviderOutputArtifactRefs {
  outputArtifactName?: string;
  rawOutputArtifactName?: string;
  partialAnswerArtifactName?: string;
}

export interface ProviderOutputReadability {
  finalAnswer?: string;
  finalAnswerPreview?: string;
  finalAnswerSource: ProviderFinalAnswerSource;
  warnings: ProviderWarning[];
  commands: ProviderCommandSummary[];
  qualityFlags: ProviderQualityFlag[];
  outputSize: ProviderOutputSize;
  artifactRefs?: ProviderOutputArtifactRefs;
}

export interface ProviderPartialAnswerMetadata {
  available: boolean;
  source?: ProviderFinalAnswerSource;
  length?: number;
  artifactName?: string;
  reason?: "timed_out_with_last_agent_message";
}

export interface ProviderOutputParseResult {
  text: string;
  stats: ProviderStreamStats;
  rawPreview?: string;
  readability: ProviderOutputReadability;
}

export interface ProviderFailureInput {
  adapter: AgentAdapterMetadata;
  reason: string;
  exitCode?: number;
  timedOut?: boolean;
  parseErrorCount?: number;
  outputText?: string;
}

export interface ProviderFailureClassification {
  failureCategory: ProviderFailureCategory;
  failureSummary: string;
}

export interface ProviderTimeoutConfig {
  timeoutMs: number;
  timeoutSource: ProviderTimeoutSource;
}

export function resolveProviderTimeout(value: number | undefined, env: NodeJS.ProcessEnv, defaultMs = 300000): ProviderTimeoutConfig {
  if (value !== undefined) {
    return { timeoutMs: value, timeoutSource: "request" };
  }
  const parsed = Number.parseInt(env.OPEN_KITCHEN_PROVIDER_TIMEOUT_MS ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return { timeoutMs: parsed, timeoutSource: "environment" };
  }
  return { timeoutMs: defaultMs, timeoutSource: "default" };
}

export function createEmptyStreamStats(): ProviderStreamStats {
  return {
    stdoutChunkCount: 0,
    stderrChunkCount: 0,
    jsonLineCount: 0,
    parseErrorCount: 0,
    extractedTextLength: 0
  };
}

export function parseProviderOutput(stdout: string, base: ProviderStreamStats = createEmptyStreamStats()): ProviderOutputParseResult {
  return parseProviderOutputWithOptions(stdout, base);
}

export function parseProviderOutputWithOptions(
  stdout: string,
  base: ProviderStreamStats = createEmptyStreamStats(),
  options: { stderr?: string; largeOutputThreshold?: number } = {}
): ProviderOutputParseResult {
  const stats: ProviderStreamStats = { ...base };
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const parsedLines: unknown[] = [];
  let extractedText = "";

  for (const line of lines) {
    const parsed = parseJsonLine(line);
    if (parsed.ok) {
      stats.jsonLineCount += 1;
      parsedLines.push(parsed.value);
      extractedText += extractText(parsed.value);
    } else {
      stats.parseErrorCount += 1;
    }
  }

  const finalAnswer = extractFinalAnswer(parsedLines);
  const fallback = finalAnswer.text || extractedText || stdout.trim();
  stats.extractedTextLength = fallback.length;
  const readability = buildReadability({
    stdout,
    stderr: options.stderr ?? "",
    stats,
    parsedLines,
    finalAnswerText: finalAnswer.text,
    finalAnswerSource: finalAnswer.source,
    fallbackText: fallback,
    largeOutputThreshold: options.largeOutputThreshold ?? 100000
  });
  return {
    text: fallback,
    stats,
    rawPreview: preview(stdout),
    readability
  };
}

export function classifyProviderFailure(input: ProviderFailureInput): ProviderFailureClassification {
  const reason = input.reason.toLowerCase();
  const output = (input.outputText ?? "").trim();

  if (input.timedOut) {
    return {
      failureCategory: "timeout",
      failureSummary: `${input.adapter.displayName} did not finish before the configured timeout.`
    };
  }
  if (reason.includes("enoent") || reason.includes("not found") || reason.includes("could not be found")) {
    return {
      failureCategory: "installation_failure",
      failureSummary: `${input.adapter.displayName} could not be executed. Check the provider installation and resolved command path.`
    };
  }
  if (matchesAny(reason, ["auth", "login", "unauthorized", "forbidden", "invalid api key", "expired session", "permission denied"])) {
    return {
      failureCategory: "auth_failure",
      failureSummary: `${input.adapter.displayName} authentication appears invalid or missing. Verify the provider CLI session or credentials.`
    };
  }
  if (matchesAny(reason, ["model", "unknown model", "model not found", "unsupported model", "unavailable model"])) {
    return {
      failureCategory: "model_failure",
      failureSummary: `${input.adapter.displayName} rejected the configured model. Check the provider model setting.`
    };
  }
  if (input.parseErrorCount && input.parseErrorCount > 0 && !output) {
    return {
      failureCategory: "stream_parse_failure",
      failureSummary: `${input.adapter.displayName} produced stream output that OpenKitchen could not parse into usable text.`
    };
  }
  if (!output && input.exitCode === 0) {
    return {
      failureCategory: "empty_output",
      failureSummary: `${input.adapter.displayName} exited successfully but produced no usable text output.`
    };
  }
  if (input.exitCode !== undefined && input.exitCode !== 0) {
    return {
      failureCategory: "nonzero_exit",
      failureSummary: `${input.adapter.displayName} exited with code ${input.exitCode}.`
    };
  }
  return {
    failureCategory: "unknown_failure",
    failureSummary: `${input.adapter.displayName} failed for an unknown provider reason.`
  };
}

export function providerMetadataBase(input: {
  adapter: AgentAdapterMetadata;
  model?: string;
  surface: AgentExecutionSurface;
  startedAt: number;
  timeout: ProviderTimeoutConfig;
  resolvedCommand?: string;
  exitCode?: number;
  timedOut?: boolean;
  timeoutTriggeredAfterMs?: number;
  closedAfterMs?: number;
  closeDelayAfterTimeoutMs?: number;
  processTreeKillAttempted?: boolean;
  processTreeKillSucceeded?: boolean;
  processKillError?: string;
  timedOutPid?: number;
  killMethod?: "taskkill" | "child.kill" | "none";
  killSucceeded?: boolean;
  taskkillAttempted?: boolean;
  taskkillExitCode?: number;
  taskkillSignal?: string;
  taskkillError?: string;
  taskkillStdoutPreview?: string;
  taskkillStderrPreview?: string;
  fallbackKillAttempted?: boolean;
  fallbackKillSucceeded?: boolean;
  fallbackKillError?: string;
  stdoutLengthAtTimeout?: number;
  stderrLengthAtTimeout?: number;
  stdoutLengthAtClose?: number;
  stderrLengthAtClose?: number;
  outputGrewAfterTimeout?: boolean;
  timeoutOverrunMs?: number;
  killFailureSummary?: string;
  partialAnswer?: ProviderPartialAnswerMetadata;
  streamStats?: ProviderStreamStats;
  readability?: ProviderOutputReadability;
}): {
  adapterName: string;
  provider: string;
  model?: string;
  surface: AgentExecutionSurface;
  durationMs: number;
  exitCode?: number;
  resolvedCommand?: string;
  timeoutMs: number;
  timeoutSource: ProviderTimeoutSource;
  timedOut?: boolean;
  timeoutTriggeredAfterMs?: number;
  closedAfterMs?: number;
  closeDelayAfterTimeoutMs?: number;
  processTreeKillAttempted?: boolean;
  processTreeKillSucceeded?: boolean;
  processKillError?: string;
  timedOutPid?: number;
  killMethod?: "taskkill" | "child.kill" | "none";
  killSucceeded?: boolean;
  taskkillAttempted?: boolean;
  taskkillExitCode?: number;
  taskkillSignal?: string;
  taskkillError?: string;
  taskkillStdoutPreview?: string;
  taskkillStderrPreview?: string;
  fallbackKillAttempted?: boolean;
  fallbackKillSucceeded?: boolean;
  fallbackKillError?: string;
  stdoutLengthAtTimeout?: number;
  stderrLengthAtTimeout?: number;
  stdoutLengthAtClose?: number;
  stderrLengthAtClose?: number;
  outputGrewAfterTimeout?: boolean;
  timeoutOverrunMs?: number;
  killFailureSummary?: string;
  partialAnswer?: ProviderPartialAnswerMetadata;
  streamStats?: ProviderStreamStats;
  readability?: ProviderOutputReadability;
} {
  return {
    adapterName: input.adapter.name,
    provider: input.adapter.provider,
    model: input.model,
    surface: input.surface,
    durationMs: Date.now() - input.startedAt,
    exitCode: input.exitCode,
    resolvedCommand: input.resolvedCommand,
    timeoutMs: input.timeout.timeoutMs,
    timeoutSource: input.timeout.timeoutSource,
    timedOut: input.timedOut,
    timeoutTriggeredAfterMs: input.timeoutTriggeredAfterMs,
    closedAfterMs: input.closedAfterMs,
    closeDelayAfterTimeoutMs: input.closeDelayAfterTimeoutMs,
    processTreeKillAttempted: input.processTreeKillAttempted,
    processTreeKillSucceeded: input.processTreeKillSucceeded,
    processKillError: input.processKillError,
    timedOutPid: input.timedOutPid,
    killMethod: input.killMethod,
    killSucceeded: input.killSucceeded,
    taskkillAttempted: input.taskkillAttempted,
    taskkillExitCode: input.taskkillExitCode,
    taskkillSignal: input.taskkillSignal,
    taskkillError: input.taskkillError,
    taskkillStdoutPreview: input.taskkillStdoutPreview,
    taskkillStderrPreview: input.taskkillStderrPreview,
    fallbackKillAttempted: input.fallbackKillAttempted,
    fallbackKillSucceeded: input.fallbackKillSucceeded,
    fallbackKillError: input.fallbackKillError,
    stdoutLengthAtTimeout: input.stdoutLengthAtTimeout,
    stderrLengthAtTimeout: input.stderrLengthAtTimeout,
    stdoutLengthAtClose: input.stdoutLengthAtClose,
    stderrLengthAtClose: input.stderrLengthAtClose,
    outputGrewAfterTimeout: input.outputGrewAfterTimeout,
    timeoutOverrunMs: input.timeoutOverrunMs,
    killFailureSummary: input.killFailureSummary,
    partialAnswer: input.partialAnswer,
    streamStats: input.streamStats,
    readability: input.readability
  };
}

function parseJsonLine(line: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false };
  }
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(extractText).join("");
  }
  const record = value as Record<string, unknown>;
  for (const key of ["text", "response", "result", "content"]) {
    if (typeof record[key] === "string") {
      return record[key];
    }
  }
  return Object.values(record).map(extractText).join("");
}

function extractFinalAnswer(values: unknown[]): { text: string; source: ProviderFinalAnswerSource } {
  const agentMessages = values.flatMap((value) => collectAgentMessages(value));
  const lastAgentMessage = agentMessages.at(-1)?.trim();
  if (lastAgentMessage) {
    return { text: lastAgentMessage, source: "last_agent_message" };
  }
  return { text: "", source: "none" };
}

function collectAgentMessages(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectAgentMessages);
  }

  const record = value as Record<string, unknown>;
  const item = objectValue(record.item);
  const message = objectValue(record.message);
  const candidates = [record, item, message].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  const direct = candidates
    .filter((candidate) => isAgentMessage(candidate))
    .map((candidate) => extractText(candidate).trim())
    .filter(Boolean);

  return [...direct, ...Object.values(record).flatMap(collectAgentMessages)];
}

function isAgentMessage(record: Record<string, unknown>): boolean {
  const type = stringValue(record.type).toLowerCase();
  const role = stringValue(record.role).toLowerCase();
  return type === "agent_message" || role === "assistant";
}

function buildReadability(input: {
  stdout: string;
  stderr: string;
  stats: ProviderStreamStats;
  parsedLines: unknown[];
  finalAnswerText: string;
  finalAnswerSource: ProviderFinalAnswerSource;
  fallbackText: string;
  largeOutputThreshold: number;
}): ProviderOutputReadability {
  const finalAnswer = input.finalAnswerText || input.fallbackText;
  const finalAnswerSource: ProviderFinalAnswerSource = input.finalAnswerText ? input.finalAnswerSource : finalAnswer ? "raw_text_fallback" : "none";
  const warnings = extractWarnings(input.stdout, input.stderr, input.stats);
  const commands = input.parsedLines.flatMap(collectCommands);
  const qualityFlags = new Set<ProviderQualityFlag>();
  const rawLength = input.stdout.length + input.stderr.length;
  const outputSize: ProviderOutputSize = {
    rawLength,
    extractedTextLength: input.stats.extractedTextLength,
    finalAnswerLength: finalAnswer.length,
    largeOutput: rawLength > input.largeOutputThreshold || input.stats.extractedTextLength > input.largeOutputThreshold,
    largeOutputThreshold: input.largeOutputThreshold
  };

  if (warnings.length > 0) {
    qualityFlags.add("completed_with_warnings");
  }
  if (input.stderr.trim()) {
    qualityFlags.add("provider_stderr");
  }
  if (commands.some((command) => command.status === "blocked")) {
    qualityFlags.add("blocked_command");
    qualityFlags.add("completed_with_warnings");
  }
  if (commands.some((command) => command.status === "failed")) {
    qualityFlags.add("command_failure");
    qualityFlags.add("completed_with_warnings");
  }
  if (!finalAnswer.trim()) {
    qualityFlags.add("missing_final_answer");
  }
  if (finalAnswerSource === "raw_text_fallback") {
    qualityFlags.add("raw_text_fallback");
  }
  if (input.stats.parseErrorCount > 0 && input.stats.jsonLineCount > 0) {
    qualityFlags.add("stream_parse_failure");
    qualityFlags.add("completed_with_warnings");
  }
  if (outputSize.largeOutput) {
    qualityFlags.add("large_output");
    qualityFlags.add("completed_with_warnings");
  }

  return {
    finalAnswer: finalAnswer.trim() || undefined,
    finalAnswerPreview: preview(finalAnswer),
    finalAnswerSource,
    warnings,
    commands,
    qualityFlags: [...qualityFlags],
    outputSize
  };
}

function extractWarnings(stdout: string, stderr: string, stats: ProviderStreamStats): ProviderWarning[] {
  const warnings: ProviderWarning[] = [];
  for (const line of stderr.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    warnings.push({ source: "stderr", message: preview(line) });
  }
  for (const line of stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    if (looksLikeWarning(line)) {
      warnings.push({ source: "stdout", message: preview(line) });
    }
  }
  if (stats.parseErrorCount > 0 && stats.jsonLineCount > 0) {
    warnings.push({ source: "parser", message: `Provider stream contained ${stats.parseErrorCount} unparsable line(s).` });
  }
  return dedupeWarnings(warnings).slice(0, 20);
}

function looksLikeWarning(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes("warning") || lower.includes("warn:") || lower.includes("blocked") || lower.includes("permission denied");
}

function collectCommands(value: unknown): ProviderCommandSummary[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectCommands);
  }

  const record = value as Record<string, unknown>;
  const item = objectValue(record.item);
  const candidates = [record, item].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  const commands = candidates.filter(isCommandRecord).map(commandSummary);
  return [...commands, ...Object.values(record).flatMap(collectCommands)];
}

function isCommandRecord(record: Record<string, unknown>): boolean {
  const type = stringValue(record.type).toLowerCase();
  return type.includes("command") || record.command !== undefined || record.cmd !== undefined || record.argv !== undefined;
}

function commandSummary(record: Record<string, unknown>): ProviderCommandSummary {
  const exitCode = numberValue(record.exit_code) ?? numberValue(record.exitCode) ?? numberValue(record.code);
  const statusText = stringValue(record.status).toLowerCase();
  const text = extractText(record);
  const combined = `${statusText} ${text}`.toLowerCase();
  const status: ProviderCommandSummary["status"] =
    combined.includes("blocked") || combined.includes("denied") || combined.includes("rejected")
      ? "blocked"
      : exitCode !== undefined && exitCode !== 0
        ? "failed"
        : statusText.includes("fail") || statusText.includes("error")
          ? "failed"
          : statusText.includes("complete") || exitCode === 0
            ? "completed"
            : "unknown";
  return {
    command: commandText(record),
    status,
    exitCode,
    preview: preview(text)
  };
}

function commandText(record: Record<string, unknown>): string | undefined {
  const command = stringValue(record.command) || stringValue(record.cmd);
  if (command) {
    return command;
  }
  const argv = record.argv ?? record.args;
  if (Array.isArray(argv)) {
    return argv.map(String).join(" ");
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function dedupeWarnings(warnings: ProviderWarning[]): ProviderWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.source}:${warning.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function preview(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 240);
}
