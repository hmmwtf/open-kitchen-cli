import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { FilesystemLedger } from "../../ledger/filesystem-ledger.js";
import type { LedgerEvent, LedgerResult } from "../../ledger/types.js";

const DEFAULT_ANSWER_PREVIEW_CHARS = 1200;
const FULL_ANSWER_PREVIEW_CHARS = 4000;
const DEFAULT_LOG_TAIL = 40;

interface LedgerShortcutOptions {
  ledgerRoot?: string;
}

interface LedgerShowOptions extends LedgerShortcutOptions {
  full?: boolean;
  answer?: boolean;
}

interface LedgerLogsOptions extends LedgerShortcutOptions {
  tail?: string;
  all?: boolean;
  raw?: boolean;
  provider?: boolean;
}

interface EventLine {
  raw: string;
  event: LedgerEvent;
}

export function registerLedgerShortcutCommands(program: Command): void {
  program
    .command("last")
    .description("Show the latest OpenKitchen run.")
    .option("--ledger-root <path>", "Override the filesystem ledger root.")
    .action(async (options: LedgerShortcutOptions) => {
      await runLedgerShortcut(() => printLatestRunSummary(options));
    });

  program
    .command("show")
    .description("Show a compact OpenKitchen run summary.")
    .argument("<run-id>", "Run id to show.")
    .option("--ledger-root <path>", "Override the filesystem ledger root.")
    .option("--full", "Print a longer final answer preview.")
    .option("--no-answer", "Omit the final answer preview.")
    .action(async (runId: string, options: LedgerShowOptions) => {
      await runLedgerShortcut(() => printRunSummary(runId, options));
    });

  program
    .command("logs")
    .description("Show a compact OpenKitchen run event timeline.")
    .argument("<run-id>", "Run id to show logs for.")
    .option("--ledger-root <path>", "Override the filesystem ledger root.")
    .option("--tail <n>", `Show the last n timeline events. Defaults to ${DEFAULT_LOG_TAIL}.`)
    .option("--all", "Show all timeline events.")
    .option("--raw", "Print raw JSONL event lines.")
    .option("--provider", "Show only provider events.")
    .action(async (runId: string, options: LedgerLogsOptions) => {
      await runLedgerShortcut(() => printRunLogs(runId, options));
    });
}

async function printLatestRunSummary(options: LedgerShortcutOptions): Promise<void> {
  const ledger = new FilesystemLedger(options.ledgerRoot);
  const runs = await ledger.listRuns();
  if (runs.length === 0) {
    console.log("No runs found.");
    return;
  }

  let skipped = 0;
  for (const run of runs) {
    try {
      await ledger.readResult(run.runId);
      if (skipped > 0) {
        console.log(`Skipped ${skipped} incomplete ${skipped === 1 ? "run" : "runs"}.`);
      }
      await printRunSummary(run.runId, options);
      return;
    } catch {
      skipped += 1;
    }
  }

  if (skipped > 0) {
    console.log(`Skipped ${skipped} incomplete ${skipped === 1 ? "run" : "runs"}.`);
  }
  console.log("No valid runs found.");
}

async function printRunSummary(runId: string, options: LedgerShowOptions): Promise<void> {
  const ledger = new FilesystemLedger(options.ledgerRoot);
  const result = await readResultOrThrow(ledger, runId);
  const runPath = ledger.getRunPath(runId);
  const provider = providerSummary(result);
  const repoMap = await repoMapSummary(result, runPath);
  const outputSize = outputSizeSummary(result);
  const commands = commandSummary(result);

  console.log("Summary");
  console.log(result.summary);
  console.log(`Run: ${result.runId}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Adapter: ${result.adapter.name} (${result.adapter.displayName})`);
  console.log(`Status: ${result.status}`);
  console.log(`Strategy: ${result.policy.strategy}`);
  console.log(`Ledger: ${runPath}`);
  console.log(provider);
  console.log(repoMap);
  console.log(outputSize);
  console.log(commands);

  if (options.answer !== false) {
    const finalAnswer = await findFinalAnswer(result, runPath);
    const maxChars = options.full ? FULL_ANSWER_PREVIEW_CHARS : DEFAULT_ANSWER_PREVIEW_CHARS;
    console.log("Final answer:");
    console.log(finalAnswer ? previewText(finalAnswer, maxChars) : "not available");
  }
}

async function printRunLogs(runId: string, options: LedgerLogsOptions): Promise<void> {
  const ledger = new FilesystemLedger(options.ledgerRoot);
  const runPath = await ensureRunExists(ledger, runId);
  const eventsPath = path.join(runPath, "events.jsonl");
  const eventLines = await readEventLines(eventsPath);
  const filtered = options.provider ? eventLines.filter(({ event }) => event.type.startsWith("provider.")) : eventLines;
  const tail = parseTailOption(options.tail);

  if (options.raw) {
    const rawLines = options.all ? filtered : filtered.slice(-tail);
    for (const line of rawLines) {
      console.log(line.raw);
    }
    return;
  }

  const streamChunks = filtered.filter(({ event }) => event.type === "provider.stream.chunk");
  const timelineEvents = filtered.filter(({ event }) => event.type !== "provider.stream.chunk");
  const visibleEvents = options.all ? timelineEvents : timelineEvents.slice(-tail);

  console.log(`Logs: ${runId}`);
  console.log(`Ledger: ${runPath}`);
  if (streamChunks.length > 0) {
    console.log(renderStreamChunkSummary(streamChunks));
  }
  for (const { event } of visibleEvents) {
    console.log(renderEventLine(event));
  }
}

async function readResultOrThrow(ledger: FilesystemLedger, runId: string): Promise<LedgerResult> {
  try {
    return await ledger.readResult(runId);
  } catch (error) {
    throw runNotFoundError(runId, error);
  }
}

async function ensureRunExists(ledger: FilesystemLedger, runId: string): Promise<string> {
  try {
    await ledger.readResult(runId);
    return ledger.getRunPath(runId);
  } catch (error) {
    throw runNotFoundError(runId, error);
  }
}

function runNotFoundError(runId: string, cause: unknown): Error {
  const error = new LedgerShortcutUserError(`Run not found: ${runId}`);
  error.cause = cause;
  return error;
}

async function runLedgerShortcut(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof LedgerShortcutUserError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

class LedgerShortcutUserError extends Error {
  override cause?: unknown;
}

function providerSummary(result: LedgerResult): string {
  const providerOutput = result.outputs.find((output) => output.provider)?.provider;
  if (!providerOutput) {
    return "Provider: not available";
  }
  const timedOutWithAnswer = Boolean(
    providerOutput.partialAnswer?.available ||
      (providerOutput.timedOut &&
        providerOutput.readability?.finalAnswerSource === "last_agent_message" &&
        providerOutput.readability.finalAnswer?.trim())
  );

  const parts = [
    `${providerOutput.adapterName}/${providerOutput.provider}`,
    `duration ${formatOptionalNumber(providerOutput.durationMs, "ms")}`,
    `timeout ${formatOptionalNumber(providerOutput.timeoutMs, "ms")}`,
    `exit ${providerOutput.exitCode ?? "not available"}`,
    `timedOut ${providerOutput.timedOut ? "yes" : "no"}`,
    `timedOutWithAnswer ${timedOutWithAnswer ? "yes" : "no"}`,
    `closeDelayAfterTimeout ${formatOptionalNumber(providerOutput.closeDelayAfterTimeoutMs, "ms")}`,
    `timeoutOverrun ${formatOptionalNumber(providerOutput.timeoutOverrunMs, "ms")}`
  ];
  if (providerOutput.partialAnswer?.artifactName) {
    parts.push(`partialAnswer ${providerOutput.partialAnswer.artifactName}`);
  }
  const lines = [`Provider: ${parts.join(", ")}`];
  const killDiagnostics = providerKillDiagnostics(providerOutput);
  if (killDiagnostics) {
    lines.push(killDiagnostics);
  }
  if (providerOutput.taskkillStderrPreview) {
    lines.push(`Taskkill stderr: ${previewText(providerOutput.taskkillStderrPreview, 240)}`);
  }
  return lines.join("\n");
}

function providerKillDiagnostics(providerOutput: NonNullable<LedgerResult["outputs"][number]["provider"]>): string | undefined {
  const hasKillDiagnostics =
    providerOutput.timedOutPid !== undefined ||
    providerOutput.killMethod !== undefined ||
    providerOutput.taskkillAttempted !== undefined ||
    providerOutput.fallbackKillAttempted !== undefined ||
    providerOutput.killSucceeded !== undefined ||
    providerOutput.processTreeKillAttempted !== undefined;
  if (!hasKillDiagnostics) {
    return undefined;
  }

  const taskkill = providerOutput.taskkillAttempted
    ? `taskkill ${providerOutput.taskkillExitCode === 0 ? "succeeded" : "failed"}${providerOutput.taskkillExitCode !== undefined ? ` exit=${providerOutput.taskkillExitCode}` : ""}`
    : "taskkill not attempted";
  const fallback = providerOutput.fallbackKillAttempted
    ? `fallback child.kill ${providerOutput.fallbackKillSucceeded ? "true" : "false"}`
    : "fallback child.kill not attempted";
  const summary = providerOutput.killFailureSummary ? `, summary ${providerOutput.killFailureSummary}` : "";
  return [
    `Kill: pid ${providerOutput.timedOutPid ?? "not available"}`,
    `method ${providerOutput.killMethod ?? "not available"}`,
    `succeeded ${providerOutput.killSucceeded ? "yes" : "no"}`,
    taskkill,
    fallback
  ].join(", ") + summary;
}

async function repoMapSummary(result: LedgerResult, runPath: string): Promise<string> {
  const summary = result.repositoryContext;
  if (summary) {
    return [
      `RepoMap: ${summary.repoMapStatus}`,
      `files ${summary.filesIncluded ?? "not available"}`,
      `symbols ${summary.symbolsIncluded ?? "not available"}`,
      `truncated ${summary.truncated ? "yes" : "no"}`,
      `artifact ${summary.artifactName ?? "not available"}`
    ].join(", ");
  }

  const repoMap = await readOptionalJson<Record<string, unknown>>(path.join(runPath, "repo-map.json"));
  if (!repoMap) {
    return "RepoMap: not available";
  }

  const mapSummary = recordValue<Record<string, unknown>>(repoMap, "summary");
  const budget = recordValue<Record<string, unknown>>(repoMap, "budget");
  return [
    `RepoMap: ${stringValue(repoMap.status) ?? "not available"}`,
    `files ${numberValue(mapSummary?.filesIncluded) ?? "not available"}`,
    `symbols ${numberValue(mapSummary?.symbolsIncluded) ?? "not available"}`,
    `truncated ${booleanValue(budget?.truncated) ? "yes" : "no"}`,
    `artifact ${stringValue(repoMap.artifactName) ?? "not available"}`
  ].join(", ");
}

function outputSizeSummary(result: LedgerResult): string {
  const outputSize = result.outputs.find((output) => output.provider?.readability)?.provider?.readability?.outputSize;
  if (outputSize) {
    return `Output size: raw ${outputSize.rawLength}, final ${outputSize.finalAnswerLength}`;
  }

  const rawLength = result.outputs.reduce((total, output) => total + (output.rawOutput?.length ?? output.output.length), 0);
  const finalLength = result.outputs.reduce((total, output) => total + output.output.length, 0);
  return `Output size: raw ${rawLength}, final ${finalLength}`;
}

function commandSummary(result: LedgerResult): string {
  const commands = result.outputs.flatMap((output) => output.provider?.readability?.commands ?? []);
  const completed = commands.filter((command) => command.status === "completed").length;
  const failed = commands.filter((command) => command.status === "failed").length;
  const blocked = commands.filter((command) => command.status === "blocked").length;
  const unknown = commands.filter((command) => command.status === "unknown").length;
  return `Commands: ${commands.length} total, ${completed} completed, ${failed} failed, ${blocked} blocked, ${unknown} unknown`;
}

async function findFinalAnswer(result: LedgerResult, runPath: string): Promise<string | undefined> {
  const readableAnswer = result.outputs.find((output) => output.provider?.readability?.finalAnswer)?.provider?.readability?.finalAnswer;
  if (readableAnswer?.trim()) {
    return readableAnswer;
  }

  const artifactAnswer = await readOptionalText(path.join(runPath, "artifacts", "agent-output-direct.md"));
  if (artifactAnswer?.trim()) {
    return artifactAnswer;
  }

  return result.outputs.find((output) => output.output.trim())?.output;
}

async function readEventLines(eventsPath: string): Promise<EventLine[]> {
  const text = await readOptionalText(eventsPath);
  if (!text) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [{ raw: line, event: JSON.parse(line) as LedgerEvent }];
      } catch {
        return [];
      }
    });
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

function previewText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n[truncated in ok show]`;
}

function parseTailOption(value: string | undefined): number {
  if (!value) {
    return DEFAULT_LOG_TAIL;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new LedgerShortcutUserError(`Invalid --tail value "${value}".`);
  }
  return parsed;
}

function renderStreamChunkSummary(lines: EventLine[]): string {
  const stdout = lines.filter(({ event }) => streamName(event) !== "stderr").length;
  const stderr = lines.filter(({ event }) => streamName(event) === "stderr").length;
  return `Provider stream chunks: ${lines.length} total, ${stdout} stdout, ${stderr} stderr`;
}

function renderEventLine(event: LedgerEvent): string {
  const suffix = renderEventData(event);
  return `${event.timestamp} ${event.type}: ${event.message}${suffix ? ` (${suffix})` : ""}`;
}

function renderEventData(event: LedgerEvent): string | undefined {
  if (!event.data || typeof event.data !== "object") {
    return undefined;
  }
  const data = event.data as Record<string, unknown>;
  const details = [
    stringValue(data.adapterName),
    stringValue(data.provider),
    formatKeyNumber(data.durationMs, "durationMs"),
    formatKeyNumber(data.timeoutMs, "timeoutMs"),
    data.exitCode !== undefined ? `exitCode=${String(data.exitCode)}` : undefined
  ].filter((item): item is string => Boolean(item));
  return details.length > 0 ? details.join(", ") : undefined;
}

function streamName(event: LedgerEvent): string | undefined {
  if (!event.data || typeof event.data !== "object") {
    return undefined;
  }
  return stringValue((event.data as Record<string, unknown>).stream);
}

function formatKeyNumber(value: unknown, key: string): string | undefined {
  const number = numberValue(value);
  return number === undefined ? undefined : `${key}=${number}`;
}

function formatOptionalNumber(value: number | undefined, suffix: string): string {
  return value === undefined ? "not available" : `${value}${suffix}`;
}

function recordValue<T extends Record<string, unknown>>(value: unknown, key: string): T | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === "object" ? (child as T) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
