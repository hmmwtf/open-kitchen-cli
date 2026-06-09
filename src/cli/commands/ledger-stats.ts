import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { FilesystemLedger } from "../../ledger/filesystem-ledger.js";
import type { LedgerEvent, LedgerRunMetadata } from "../../ledger/types.js";

const DEFAULT_STATS_LIMIT = 50;
const OVER_14S_MS = 14000;

interface LedgerStatsOptions {
  ledgerRoot?: string;
  limit?: string;
  json?: boolean;
}

interface RunStatsSample {
  runId: string;
  mode: string;
  adapter: string;
  status: string;
  promptCategory: PromptCategory;
  totalDurationMs?: number;
  providerDurationMs?: number;
  commandCount: number;
  blockedCount: number;
  failedCount: number;
  timedOut: boolean;
  timeoutWithAnswer: boolean;
  timeoutWithoutStructuredAnswer: boolean;
  closeDelayAfterTimeoutMs?: number;
  timeoutOverrunMs?: number;
  killAttempted: boolean;
  killSucceeded?: boolean;
  killFailed: boolean;
  rawOutputLength?: number;
  finalAnswerLength?: number;
  filesIncluded?: number;
  symbolsIncluded?: number;
  repoMapTruncated?: boolean;
  inferredInstant: boolean;
  partial: boolean;
}

type PromptCategory =
  | "architecture"
  | "onboarding"
  | "provider"
  | "repomap"
  | "cli"
  | "important-files"
  | "run-command"
  | "tech-debt"
  | "pitch"
  | "generic";

interface StatsReport {
  ledger: string;
  window: { requestedLimit: number; validRuns: number };
  skippedCount: number;
  partialCount: number;
  summary: StatsSummary;
  byAdapter: GroupStats[];
  byPromptCategory: GroupStats[];
  instantQualityProxies: InstantQualityProxies;
  timeoutKill: TimeoutKillStats;
}

interface StatsSummary {
  runs: number;
  completed: number;
  failed: number;
  timedOut: number;
  completionRate: number;
  timeoutRate: number;
  avgTotalDurationMs?: number;
  avgProviderDurationMs?: number;
  avgCommandCount?: number;
  avgRawOutputLength?: number;
  avgFinalAnswerLength?: number;
  avgFilesIncluded?: number;
  avgSymbolsIncluded?: number;
  runsOver14s: number;
  timeoutWithAnswerCount: number;
  timeoutWithoutStructuredAnswerCount: number;
  avgCloseDelayAfterTimeoutMs?: number;
  timeoutKillAttempted: number;
  timeoutKillSucceeded: number;
  timeoutKillFailed: number;
  maxCloseDelayAfterTimeoutMs?: number;
  avgTimeoutOverrunMs?: number;
}

interface GroupStats {
  key: string;
  runs: number;
  completed: number;
  timedOut: number;
  avgTotalDurationMs?: number;
  avgCommandCount?: number;
  avgRawOutputLength?: number;
  avgFinalAnswerLength?: number;
}

interface InstantQualityProxies {
  inferredInstantRuns: number;
  zeroCommandRate: number;
  repoMapTruncated: number;
  timeoutWithAnswerCount: number;
  timeoutWithoutStructuredAnswerCount: number;
  avgCloseDelayAfterTimeoutMs?: number;
  avgFilesIncluded?: number;
  avgSymbolsIncluded?: number;
}

interface TimeoutKillStats {
  attempted: number;
  succeeded: number;
  failed: number;
  avgCloseDelayAfterTimeoutMs?: number;
  maxCloseDelayAfterTimeoutMs?: number;
  avgTimeoutOverrunMs?: number;
}

export function registerLedgerStatsCommand(program: Command): void {
  program
    .command("stats")
    .description("Show OpenKitchen ledger statistics for recent local runs.")
    .option("--ledger-root <path>", "Override the filesystem ledger root.")
    .option("--limit <n>", `Number of latest valid runs to include. Defaults to ${DEFAULT_STATS_LIMIT}.`)
    .option("--json", "Print parseable JSON.")
    .action(async (options: LedgerStatsOptions) => {
      const report = await buildStatsReport(options);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      printStatsReport(report);
    });
}

async function buildStatsReport(options: LedgerStatsOptions): Promise<StatsReport> {
  const limit = parseLimit(options.limit);
  const ledger = new FilesystemLedger(options.ledgerRoot);
  const runs = await listRunsSafely(ledger);
  const samples: RunStatsSample[] = [];
  let skippedCount = 0;

  for (const run of runs.valid) {
    if (samples.length >= limit) {
      break;
    }
    if (run.classification === "partial_or_incomplete") {
      skippedCount += 1;
      continue;
    }
    const sample = await readRunStatsSample(ledger.getRunPath(run.runId), run);
    if (!sample) {
      skippedCount += 1;
      continue;
    }
    samples.push(sample);
  }
  skippedCount += runs.skipped;

  const summary = buildSummary(samples);
  const timeoutKill = buildTimeoutKillStats(samples);
  return {
    ledger: ledger.getRoot(),
    window: { requestedLimit: limit, validRuns: samples.length },
    skippedCount,
    partialCount: samples.filter((sample) => sample.partial).length,
    summary,
    byAdapter: groupSamples(samples, (sample) => sample.adapter),
    byPromptCategory: groupSamples(samples, (sample) => sample.promptCategory),
    instantQualityProxies: {
      inferredInstantRuns: samples.filter((sample) => sample.inferredInstant).length,
      zeroCommandRate: rate(samples.filter((sample) => sample.commandCount === 0).length, samples.length),
      repoMapTruncated: samples.filter((sample) => sample.repoMapTruncated).length,
      timeoutWithAnswerCount: samples.filter((sample) => sample.timeoutWithAnswer).length,
      timeoutWithoutStructuredAnswerCount: samples.filter((sample) => sample.timeoutWithoutStructuredAnswer).length,
      avgCloseDelayAfterTimeoutMs: average(samples.map((sample) => sample.closeDelayAfterTimeoutMs)),
      avgFilesIncluded: average(samples.map((sample) => sample.filesIncluded)),
      avgSymbolsIncluded: average(samples.map((sample) => sample.symbolsIncluded))
    },
    timeoutKill
  };
}

async function listRunsSafely(ledger: FilesystemLedger): Promise<{ valid: LedgerRunMetadata[]; skipped: number }> {
  try {
    return { valid: await ledger.listRuns(), skipped: 0 };
  } catch {
    const runIds = await listRunDirectories(ledger.getRoot());
    const valid: LedgerRunMetadata[] = [];
    let skipped = 0;
    for (const runId of runIds) {
      const run = await readOptionalJson<LedgerRunMetadata>(path.join(ledger.getRunPath(runId), "run.json"));
      if (run?.runId && run.startedAt) {
        valid.push(run);
      } else {
        skipped += 1;
      }
    }
    return { valid: valid.sort((a, b) => b.startedAt.localeCompare(a.startedAt)), skipped };
  }
}

async function listRunDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readRunStatsSample(runPath: string, run: LedgerRunMetadata): Promise<RunStatsSample | undefined> {
  if (!run.runId || !run.startedAt) {
    return undefined;
  }

  const result = await readOptionalJson<Record<string, unknown>>(path.join(runPath, "result.json"));
  const provider = await readOptionalJson<Record<string, unknown>>(path.join(runPath, "provider.json"));
  const repoMap = await readOptionalJson<Record<string, unknown>>(path.join(runPath, "repo-map.json"));
  const events = await readEventLines(path.join(runPath, "events.jsonl"));
  const prompt = await readOptionalText(path.join(runPath, "prompt.txt"));
  const repoMapMarkdown = await readOptionalText(path.join(runPath, "artifacts", "repo-map.md"));
  const providerRaw = await readOptionalText(path.join(runPath, "artifacts", "provider-raw-output-direct.txt"));
  const finalAnswer = await readOptionalText(path.join(runPath, "artifacts", "agent-output-direct.md"));
  const outputs = arrayValue(recordValue(result, "outputs"));
  const commandCountFromResult = outputs.flatMap((output) => arrayValue(recordValue(recordValue(output, "provider")?.readability, "commands"))).length;

  const providerCompleted = findLastEvent(events, "provider.invocation.completed");
  const providerTimedOut = findLastEvent(events, "provider.invocation.timed_out");
  const providerFailed = findLastEvent(events, "provider.invocation.failed");
  const commandEvents = events.filter((event) => event.type.startsWith("provider.command.") || event.type.startsWith("provider.tool."));
  const repoSummary = recordValue(repoMap, "summary");
  const repoBudget = recordValue(repoMap, "budget");
  const status = run.status ?? stringValue(result?.status) ?? "unknown";
  const outputSize = outputs.find((output) => recordValue(recordValue(output, "provider")?.readability, "outputSize"));
  const providerReadability = recordValue(recordValue(outputSize, "provider"), "readability");
  const providerMetadata = recordValue(outputSize, "provider");
  const partialAnswer = recordValue(providerMetadata, "partialAnswer");
  const outputSizeRecord = recordValue(providerReadability, "outputSize");
  const finalAnswerSource = stringValue(providerReadability?.finalAnswerSource);
  const finalAnswerLength =
    numberValue(outputSizeRecord?.finalAnswerLength) ?? (await fileSize(path.join(runPath, "artifacts", "agent-output-direct.md"))) ?? finalAnswer?.length;
  const timeoutWithAnswer =
    Boolean(providerTimedOut) &&
    (booleanValue(partialAnswer?.available) === true || (finalAnswerSource === "last_agent_message" && (finalAnswerLength ?? 0) > 0));
  const killAttempted =
    booleanValue(providerMetadata?.taskkillAttempted) === true ||
    booleanValue(providerMetadata?.fallbackKillAttempted) === true ||
    booleanValue(providerMetadata?.processTreeKillAttempted) === true;
  const killSucceeded = booleanValue(providerMetadata?.killSucceeded) ?? booleanValue(providerMetadata?.processTreeKillSucceeded);

  return {
    runId: run.runId,
    mode: run.mode ?? stringValue(result?.mode) ?? "unknown",
    adapter: adapterName(run, result, provider),
    status,
    promptCategory: detectPromptCategory(prompt ?? ""),
    totalDurationMs: durationBetween(run.startedAt, run.completedAt),
    providerDurationMs:
      numberValue(recordValue(providerCompleted, "data")?.durationMs) ??
      numberValue(recordValue(providerTimedOut, "data")?.durationMs) ??
      numberValue(recordValue(providerFailed, "data")?.durationMs),
    commandCount: Math.max(commandEvents.length, commandCountFromResult),
    blockedCount: commandEvents.filter((event) => event.type.includes("blocked")).length,
    failedCount: commandEvents.filter((event) => event.type.includes("failed")).length,
    timedOut: Boolean(providerTimedOut),
    timeoutWithAnswer,
    timeoutWithoutStructuredAnswer: Boolean(providerTimedOut) && !timeoutWithAnswer,
    closeDelayAfterTimeoutMs: numberValue(providerMetadata?.closeDelayAfterTimeoutMs),
    timeoutOverrunMs: numberValue(providerMetadata?.timeoutOverrunMs),
    killAttempted,
    killSucceeded,
    killFailed: Boolean(providerTimedOut) && killAttempted && killSucceeded === false,
    rawOutputLength: (await fileSize(path.join(runPath, "artifacts", "provider-raw-output-direct.txt"))) ?? numberValue(outputSizeRecord?.rawLength) ?? providerRaw?.length,
    finalAnswerLength,
    filesIncluded: numberValue(repoSummary?.filesIncluded),
    symbolsIncluded: numberValue(repoSummary?.symbolsIncluded),
    repoMapTruncated: booleanValue(repoBudget?.truncated) ?? booleanValue(repoSummary?.truncated),
    inferredInstant: inferInstant(repoMapMarkdown, providerRaw, finalAnswer),
    partial: !result || !repoMap || events.length === 0
  };
}

function buildSummary(samples: RunStatsSample[]): StatsSummary {
  const completed = samples.filter((sample) => sample.status === "completed").length;
  const timedOut = samples.filter(isTimedOut).length;
  return {
    runs: samples.length,
    completed,
    failed: samples.filter((sample) => sample.status === "failed").length,
    timedOut,
    completionRate: rate(completed, samples.length),
    timeoutRate: rate(timedOut, samples.length),
    avgTotalDurationMs: average(samples.map((sample) => sample.totalDurationMs)),
    avgProviderDurationMs: average(samples.map((sample) => sample.providerDurationMs)),
    avgCommandCount: average(samples.map((sample) => sample.commandCount)),
    avgRawOutputLength: average(samples.map((sample) => sample.rawOutputLength)),
    avgFinalAnswerLength: average(samples.map((sample) => sample.finalAnswerLength)),
    avgFilesIncluded: average(samples.map((sample) => sample.filesIncluded)),
    avgSymbolsIncluded: average(samples.map((sample) => sample.symbolsIncluded)),
    runsOver14s: samples.filter((sample) => (sample.totalDurationMs ?? 0) > OVER_14S_MS).length,
    timeoutWithAnswerCount: samples.filter((sample) => sample.timeoutWithAnswer).length,
    timeoutWithoutStructuredAnswerCount: samples.filter((sample) => sample.timeoutWithoutStructuredAnswer).length,
    avgCloseDelayAfterTimeoutMs: average(samples.map((sample) => sample.closeDelayAfterTimeoutMs)),
    timeoutKillAttempted: samples.filter((sample) => sample.killAttempted).length,
    timeoutKillSucceeded: samples.filter((sample) => sample.killAttempted && sample.killSucceeded === true).length,
    timeoutKillFailed: samples.filter((sample) => sample.killFailed).length,
    maxCloseDelayAfterTimeoutMs: maximum(samples.map((sample) => sample.closeDelayAfterTimeoutMs)),
    avgTimeoutOverrunMs: average(samples.map((sample) => sample.timeoutOverrunMs))
  };
}

function buildTimeoutKillStats(samples: RunStatsSample[]): TimeoutKillStats {
  return {
    attempted: samples.filter((sample) => sample.killAttempted).length,
    succeeded: samples.filter((sample) => sample.killAttempted && sample.killSucceeded === true).length,
    failed: samples.filter((sample) => sample.killFailed).length,
    avgCloseDelayAfterTimeoutMs: average(samples.map((sample) => sample.closeDelayAfterTimeoutMs)),
    maxCloseDelayAfterTimeoutMs: maximum(samples.map((sample) => sample.closeDelayAfterTimeoutMs)),
    avgTimeoutOverrunMs: average(samples.map((sample) => sample.timeoutOverrunMs))
  };
}

function groupSamples(samples: RunStatsSample[], keyFor: (sample: RunStatsSample) => string): GroupStats[] {
  const groups = new Map<string, RunStatsSample[]>();
  for (const sample of samples) {
    const key = keyFor(sample) || "unknown";
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const completed = group.filter((sample) => sample.status === "completed").length;
      return {
        key,
        runs: group.length,
        completed,
        timedOut: group.filter(isTimedOut).length,
        avgTotalDurationMs: average(group.map((sample) => sample.totalDurationMs)),
        avgCommandCount: average(group.map((sample) => sample.commandCount)),
        avgRawOutputLength: average(group.map((sample) => sample.rawOutputLength)),
        avgFinalAnswerLength: average(group.map((sample) => sample.finalAnswerLength))
      };
    })
    .sort((a, b) => b.runs - a.runs || a.key.localeCompare(b.key));
}

function printStatsReport(report: StatsReport): void {
  if (report.summary.runs === 0) {
    console.log("No valid runs found.");
    if (report.skippedCount > 0) {
      console.log(`Skipped ${report.skippedCount} incomplete ${report.skippedCount === 1 ? "run" : "runs"}.`);
    }
    return;
  }

  console.log("OpenKitchen Run Stats");
  console.log(`Ledger: ${report.ledger}`);
  console.log(`Window: latest ${report.window.validRuns} valid runs (limit ${report.window.requestedLimit})`);
  console.log(`Skipped: ${report.skippedCount} incomplete ${report.skippedCount === 1 ? "run" : "runs"}`);
  if (report.partialCount > 0) {
    console.log(`Partial metrics: ${report.partialCount} ${report.partialCount === 1 ? "run" : "runs"} missing optional artifacts`);
  }
  console.log("");
  console.log("Summary");
  console.log(`Runs: ${report.summary.runs}`);
  console.log(`Completed: ${report.summary.completed}`);
  console.log(`Failed: ${report.summary.failed}`);
  console.log(`Timed out: ${report.summary.timedOut}`);
  console.log(`Timeout with answer: ${report.summary.timeoutWithAnswerCount}`);
  console.log(`Timeout without structured answer: ${report.summary.timeoutWithoutStructuredAnswerCount}`);
  console.log(`Completion rate: ${formatPercent(report.summary.completionRate)}`);
  console.log(`Timeout rate: ${formatPercent(report.summary.timeoutRate)}`);
  console.log(`Avg total: ${formatMs(report.summary.avgTotalDurationMs)}`);
  console.log(`Avg provider: ${formatMs(report.summary.avgProviderDurationMs)}`);
  console.log(`Avg commands: ${formatNumber(report.summary.avgCommandCount)}`);
  console.log(`Avg raw output: ${formatChars(report.summary.avgRawOutputLength)}`);
  console.log(`Avg final answer: ${formatChars(report.summary.avgFinalAnswerLength)}`);
  console.log(`Runs over 14s: ${report.summary.runsOver14s}`);
  console.log(`Avg close delay after timeout: ${formatMs(report.summary.avgCloseDelayAfterTimeoutMs)}`);
  console.log(`Timeout kill attempted: ${report.timeoutKill.attempted}`);
  console.log(`Timeout kill succeeded: ${report.timeoutKill.succeeded}`);
  console.log(`Timeout kill failed: ${report.timeoutKill.failed}`);
  console.log(`Max close delay after timeout: ${formatMs(report.timeoutKill.maxCloseDelayAfterTimeoutMs)}`);
  console.log(`Avg timeout overrun: ${formatMs(report.timeoutKill.avgTimeoutOverrunMs)}`);
  console.log("");
  console.log("By Adapter");
  console.log("Adapter | Runs | Completed | Timeout | Avg Total | Avg Cmds");
  for (const row of report.byAdapter) {
    console.log(`${row.key} | ${row.runs} | ${row.completed} | ${row.timedOut} | ${formatMs(row.avgTotalDurationMs)} | ${formatNumber(row.avgCommandCount)}`);
  }
  console.log("");
  console.log("By Prompt Category");
  console.log("Category | Runs | Completed | Timeout | Avg Total | Avg Raw | Avg Final");
  for (const row of report.byPromptCategory) {
    console.log(`${row.key} | ${row.runs} | ${row.completed} | ${row.timedOut} | ${formatMs(row.avgTotalDurationMs)} | ${formatChars(row.avgRawOutputLength)} | ${formatChars(row.avgFinalAnswerLength)}`);
  }
  console.log("");
  console.log("Instant Quality Proxies");
  console.log(`Inferred instant runs: ${report.instantQualityProxies.inferredInstantRuns}`);
  console.log(`Zero-command rate: ${formatPercent(report.instantQualityProxies.zeroCommandRate)}`);
  console.log(`RepoMap truncated: ${report.instantQualityProxies.repoMapTruncated}`);
  console.log(`Timeout with answer: ${report.instantQualityProxies.timeoutWithAnswerCount}`);
  console.log(`Timeout without structured answer: ${report.instantQualityProxies.timeoutWithoutStructuredAnswerCount}`);
  console.log(`Avg close delay after timeout: ${formatMs(report.instantQualityProxies.avgCloseDelayAfterTimeoutMs)}`);
  console.log(
    `Avg files/symbols: ${formatNumber(report.instantQualityProxies.avgFilesIncluded)} / ${formatNumber(report.instantQualityProxies.avgSymbolsIncluded)}`
  );
}

function parseLimit(value: string | undefined): number {
  if (!value) {
    return DEFAULT_STATS_LIMIT;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value "${value}".`);
  }
  return parsed;
}

function adapterName(run: LedgerRunMetadata, result: Record<string, unknown> | undefined, provider: Record<string, unknown> | undefined): string {
  return stringValue(run.adapter?.name) ?? stringValue(recordValue(result, "adapter")?.name) ?? stringValue(provider?.adapterName) ?? "unknown";
}

function detectPromptCategory(prompt: string): PromptCategory {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  const has = (keywords: string[]) => keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
  if (has(["important files", "main files", "core files", "critical files", "key files", "중요한 파일", "핵심 파일", "주요 파일", "핵심 코드"])) {
    return "important-files";
  }
  if (has(["technical debt", "tech debt", "architecture risk", "maintenance risk", "future complexity", "code health", "risk area", "기술 부채", "부채", "리스크", "유지보수", "복잡도"])) {
    return "tech-debt";
  }
  if (has(["new developer", "new teammate", "onboarding", "새로 합류", "신규 개발자", "10줄"])) {
    return "onboarding";
  }
  if (has(["pitch", "소개글", "소개", "first paragraph", "readme 첫 문단", "github readme", "obsidian", "discord", "30-second", "30 second"])) {
    return "pitch";
  }
  if (has(["run command", "run 명령", "run command가"])) {
    return "run-command";
  }
  if (has(["repomap", "repo map", "repository context", "context map", "repository context map"])) {
    return "repomap";
  }
  if (has(["provider", "adapter", "codex", "claude", "ollama"])) {
    return "provider";
  }
  if (has(["cli", "command", "명령어", "entrypoint", "진입점"])) {
    return "cli";
  }
  if (has(["architecture", "structure", "overview", "아키텍처", "구조", "설계", "전체"])) {
    return "architecture";
  }
  return "generic";
}

function inferInstant(repoMapMarkdown: string | undefined, providerRaw: string | undefined, finalAnswer: string | undefined): boolean {
  const haystack = [repoMapMarkdown, providerRaw, finalAnswer].filter(Boolean).join("\n");
  return (
    haystack.includes("## Context Anchors") ||
    haystack.includes("Important Files Evidence") ||
    haystack.includes("Technical Debt Evidence") ||
    haystack.includes("Instant mode:") ||
    haystack.includes("Instant output contract")
  );
}

async function readEventLines(eventsPath: string): Promise<LedgerEvent[]> {
  const text = await readOptionalText(eventsPath);
  if (!text) {
    return [];
  }
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as LedgerEvent];
      } catch {
        return [];
      }
    });
}

async function fileSize(filePath: string): Promise<number | undefined> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return undefined;
  }
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  const text = await readOptionalText(filePath);
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function isTimedOut(sample: RunStatsSample): boolean {
  return sample.timedOut || sample.status === "timed_out" || sample.status === "timeout";
}

function findLastEvent(events: LedgerEvent[], type: string): LedgerEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) {
      return events[index];
    }
  }
  return undefined;
}

function durationBetween(startedAt: string | undefined, completedAt: string | undefined): number | undefined {
  if (!startedAt || !completedAt) {
    return undefined;
  }
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) {
    return undefined;
  }
  return Math.max(0, completed - started);
}

function average(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) {
    return undefined;
  }
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function maximum(values: Array<number | undefined>): number | undefined {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numbers.length === 0 ? undefined : Math.max(...numbers);
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function formatMs(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  return `${(value / 1000).toFixed(2)}s`;
}

function formatChars(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`;
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) {
    return "n/a";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function recordValue(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === "object" ? (child as Record<string, unknown>) : undefined;
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
