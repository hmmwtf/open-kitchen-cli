import { spawn, spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";

export interface ProcessRunRequest {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  input?: string;
  onStdout?(chunk: string): void;
  onStderr?(chunk: string): void;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
  signal?: string;
  timedOut: boolean;
  durationMs: number;
  timeoutTriggeredAfterMs?: number;
  closedAfterMs?: number;
  closeDelayAfterTimeoutMs?: number;
  processTreeKillAttempted?: boolean;
  processTreeKillSucceeded?: boolean;
  processKillError?: string;
  timedOutPid?: number;
  killMethod?: ProcessKillMethod;
  killSucceeded?: boolean;
  taskkillAttempted?: boolean;
  taskkillExitCode?: number;
  taskkillSignal?: string;
  taskkillError?: string;
  taskkillStdoutPreview?: string;
  taskkillStderrPreview?: string;
  taskkillStdoutEncoding?: TaskkillPreviewEncoding;
  taskkillStderrEncoding?: TaskkillPreviewEncoding;
  taskkillStdoutHadReplacement?: boolean;
  taskkillStderrHadReplacement?: boolean;
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
}

export type ProcessRunner = (request: ProcessRunRequest) => Promise<ProcessRunResult>;

export interface ResolvedSpawnRequest {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export type ProcessRunnerStdio = ["pipe" | "ignore", "pipe", "pipe"];

export interface ProcessKillResult {
  processTreeKillAttempted: boolean;
  processTreeKillSucceeded: boolean;
  processKillError?: string;
  timedOutPid?: number;
  killMethod?: ProcessKillMethod;
  killSucceeded?: boolean;
  taskkillAttempted?: boolean;
  taskkillExitCode?: number;
  taskkillSignal?: string;
  taskkillError?: string;
  taskkillStdoutPreview?: string;
  taskkillStderrPreview?: string;
  taskkillStdoutEncoding?: TaskkillPreviewEncoding;
  taskkillStderrEncoding?: TaskkillPreviewEncoding;
  taskkillStdoutHadReplacement?: boolean;
  taskkillStderrHadReplacement?: boolean;
  fallbackKillAttempted?: boolean;
  fallbackKillSucceeded?: boolean;
  fallbackKillError?: string;
  killFailureSummary?: string;
}

export type ProcessKillMethod = "taskkill" | "child.kill" | "none";
export type TaskkillPreviewEncoding = "utf8" | "cp949" | "utf8_with_replacement";

type TaskkillRunner = (command: string, args: string[], options: Parameters<typeof spawnSync>[2]) => SpawnSyncReturns<Buffer>;

const KILL_PREVIEW_CHARS = 500;

export const nodeProcessRunner: ProcessRunner = (request) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const spawnRequest = resolveSpawnRequest(request);
    const child = spawn(spawnRequest.command, spawnRequest.args, {
      cwd: request.cwd,
      stdio: stdioForRequest(request),
      shell: false,
      windowsVerbatimArguments: spawnRequest.windowsVerbatimArguments
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutTriggeredAfterMs: number | undefined;
    let stdoutLengthAtTimeout: number | undefined;
    let stderrLengthAtTimeout: number | undefined;
    let killResult: ProcessKillResult | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutTriggeredAfterMs = Date.now() - startedAt;
      stdoutLengthAtTimeout = stdout.length;
      stderrLengthAtTimeout = stderr.length;
      killResult = killTimedOutProcess(child.pid, () => child.kill());
    }, request.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    if (!child.stdout || !child.stderr) {
      clearTimeout(timer);
      reject(new Error("Process runner expected piped stdout and stderr streams."));
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      request.onStdout?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      request.onStderr?.(text);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const closedAfterMs = Date.now() - startedAt;
      const outputDiagnostics = timedOut
        ? timeoutOutputDiagnostics({
            stdoutLengthAtTimeout,
            stderrLengthAtTimeout,
            stdoutLengthAtClose: stdout.length,
            stderrLengthAtClose: stderr.length
          })
        : {};
      resolve({
        stdout,
        stderr,
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        timedOut,
        durationMs: closedAfterMs,
        ...(timedOut
          ? {
              timeoutTriggeredAfterMs,
              closedAfterMs,
              closeDelayAfterTimeoutMs: timeoutTriggeredAfterMs === undefined ? undefined : closedAfterMs - timeoutTriggeredAfterMs,
              timeoutOverrunMs: Math.max(0, closedAfterMs - request.timeoutMs),
              ...outputDiagnostics
            }
          : {}),
        ...(killResult ?? {})
      });
    });

    if (request.input && child.stdin) {
      child.stdin.write(request.input);
      child.stdin.end();
    }
  });

export function stdioForRequest(request: Pick<ProcessRunRequest, "input">): ProcessRunnerStdio {
  return [request.input ? "pipe" : "ignore", "pipe", "pipe"];
}

export function killTimedOutProcess(
  pid: number | undefined,
  fallbackKill: () => boolean,
  platform: NodeJS.Platform = process.platform,
  runTaskkill: TaskkillRunner = spawnSync
): ProcessKillResult {
  if (platform === "win32" && pid !== undefined) {
    const result = runTaskkill("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "pipe",
      shell: false,
      windowsHide: true
    });
    const taskkillSucceeded = !result.error && result.status === 0;
    const taskkillError = result.error?.message;
    const stdoutPreview = decodeTaskkillPreview(result.stdout, platform);
    const stderrPreview = decodeTaskkillPreview(result.stderr, platform);
    const taskkillStdoutPreview = stdoutPreview.preview;
    const taskkillStderrPreview = stderrPreview.preview;
    let fallbackKillAttempted = false;
    let fallbackKillSucceeded: boolean | undefined;
    let fallbackKillError: string | undefined;
    if (!taskkillSucceeded) {
      fallbackKillAttempted = true;
      try {
        fallbackKillSucceeded = fallbackKill();
      } catch (error) {
        fallbackKillSucceeded = false;
        fallbackKillError = error instanceof Error ? error.message : String(error);
      }
    }
    const killSucceeded = taskkillSucceeded || fallbackKillSucceeded === true;
    const processKillError = taskkillError ?? fallbackKillError ?? taskkillStderrPreview;
    const killFailureSummary = killSummary({
      taskkillSucceeded,
      taskkillExitCode: result.status ?? undefined,
      taskkillError,
      taskkillStderrPreview,
      fallbackKillAttempted,
      fallbackKillSucceeded,
      fallbackKillError
    });
    return {
      processTreeKillAttempted: true,
      processTreeKillSucceeded: taskkillSucceeded,
      processKillError,
      timedOutPid: pid,
      killMethod: taskkillSucceeded ? "taskkill" : fallbackKillAttempted ? "child.kill" : "taskkill",
      killSucceeded,
      taskkillAttempted: true,
      taskkillExitCode: result.status ?? undefined,
      taskkillSignal: result.signal ?? undefined,
      taskkillError,
      taskkillStdoutPreview,
      taskkillStderrPreview,
      taskkillStdoutEncoding: stdoutPreview.encoding,
      taskkillStderrEncoding: stderrPreview.encoding,
      taskkillStdoutHadReplacement: stdoutPreview.hadReplacement,
      taskkillStderrHadReplacement: stderrPreview.hadReplacement,
      fallbackKillAttempted,
      fallbackKillSucceeded,
      fallbackKillError,
      killFailureSummary
    };
  }

  try {
    const killed = fallbackKill();
    return {
      processTreeKillAttempted: false,
      processTreeKillSucceeded: killed,
      timedOutPid: pid,
      killMethod: "child.kill",
      killSucceeded: killed,
      fallbackKillAttempted: true,
      fallbackKillSucceeded: killed,
      killFailureSummary: killed ? undefined : "child.kill returned false."
    };
  } catch (error) {
    const fallbackKillError = error instanceof Error ? error.message : String(error);
    return {
      processTreeKillAttempted: false,
      processTreeKillSucceeded: false,
      processKillError: fallbackKillError,
      timedOutPid: pid,
      killMethod: "child.kill",
      killSucceeded: false,
      fallbackKillAttempted: true,
      fallbackKillSucceeded: false,
      fallbackKillError,
      killFailureSummary: `child.kill failed: ${fallbackKillError}`
    };
  }
}

export function timeoutOutputDiagnostics(input: {
  stdoutLengthAtTimeout?: number;
  stderrLengthAtTimeout?: number;
  stdoutLengthAtClose: number;
  stderrLengthAtClose: number;
}): Pick<ProcessRunResult, "stdoutLengthAtTimeout" | "stderrLengthAtTimeout" | "stdoutLengthAtClose" | "stderrLengthAtClose" | "outputGrewAfterTimeout"> {
  const stdoutLengthAtTimeout = input.stdoutLengthAtTimeout ?? input.stdoutLengthAtClose;
  const stderrLengthAtTimeout = input.stderrLengthAtTimeout ?? input.stderrLengthAtClose;
  return {
    stdoutLengthAtTimeout,
    stderrLengthAtTimeout,
    stdoutLengthAtClose: input.stdoutLengthAtClose,
    stderrLengthAtClose: input.stderrLengthAtClose,
    outputGrewAfterTimeout: input.stdoutLengthAtClose > stdoutLengthAtTimeout || input.stderrLengthAtClose > stderrLengthAtTimeout
  };
}

export function decodeTaskkillPreview(
  value: Buffer | string | null | undefined,
  platform: NodeJS.Platform = process.platform
): { preview?: string; encoding?: TaskkillPreviewEncoding; hadReplacement?: boolean } {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value === "string") {
    return previewWithEncoding(value, replacementCount(value) > 0 ? "utf8_with_replacement" : "utf8");
  }

  const utf8 = value.toString("utf8");
  const utf8ReplacementCount = replacementCount(utf8);
  if (platform === "win32" && utf8ReplacementCount > 0) {
    const cp949 = iconv.decode(value, "cp949");
    if (replacementCount(cp949) < utf8ReplacementCount || (replacementCount(cp949) === 0 && cp949.trim().length > 0)) {
      return previewWithEncoding(cp949, "cp949");
    }
  }

  return previewWithEncoding(utf8, utf8ReplacementCount > 0 ? "utf8_with_replacement" : "utf8");
}

function previewWithEncoding(text: string, encoding: TaskkillPreviewEncoding): { preview?: string; encoding?: TaskkillPreviewEncoding; hadReplacement?: boolean } {
  const normalized = text.replace(/\s+/g, " ").trim();
  return {
    preview: normalized ? normalized.slice(0, KILL_PREVIEW_CHARS) : undefined,
    encoding,
    hadReplacement: replacementCount(text) > 0
  };
}

function replacementCount(value: string): number {
  return [...value].filter((char) => char === "\uFFFD").length;
}

function killSummary(input: {
  taskkillSucceeded: boolean;
  taskkillExitCode?: number;
  taskkillError?: string;
  taskkillStderrPreview?: string;
  fallbackKillAttempted: boolean;
  fallbackKillSucceeded?: boolean;
  fallbackKillError?: string;
}): string | undefined {
  if (input.taskkillSucceeded) {
    return undefined;
  }
  const taskkillReason =
    input.taskkillError ??
    input.taskkillStderrPreview ??
    (input.taskkillExitCode === undefined ? "taskkill did not report an exit code." : `taskkill exited with code ${input.taskkillExitCode}.`);
  if (!input.fallbackKillAttempted) {
    return taskkillReason;
  }
  if (input.fallbackKillSucceeded) {
    return `${taskkillReason} Fallback child.kill succeeded.`;
  }
  return `${taskkillReason} Fallback child.kill failed${input.fallbackKillError ? `: ${input.fallbackKillError}` : "."}`;
}

export function resolveSpawnRequest(request: ProcessRunRequest): ResolvedSpawnRequest {
  if (!isWindowsCommandShim(request.command)) {
    return {
      command: request.command,
      args: request.args
    };
  }

  const npmShimScriptPath = resolveNpmShimScriptPathFromFile(request.command);
  if (npmShimScriptPath) {
    return {
      command: process.execPath,
      args: [npmShimScriptPath, ...request.args]
    };
  }

  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", commandLineForCmd(request.command, request.args)],
    windowsVerbatimArguments: true
  };
}

export function isWindowsCommandShim(command: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const name = path.win32.basename(command).toLowerCase();
  return name.endsWith(".cmd") || name.endsWith(".bat");
}

export function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function commandLineForCmd(command: string, args: string[]): string {
  return [command, ...args].map(quoteForCmd).join(" ");
}

export function resolveNpmShimScriptPath(command: string, content: string): string | undefined {
  const matches = [...content.matchAll(/"%dp0%\\([^"]+)"/gi)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  const scriptPath = matches.find((value) => value.toLowerCase().includes("node_modules\\"));
  if (!scriptPath) {
    return undefined;
  }

  return path.win32.join(path.win32.dirname(command), scriptPath);
}

function resolveNpmShimScriptPathFromFile(command: string): string | undefined {
  try {
    return resolveNpmShimScriptPath(command, readFileSync(command, "utf8"));
  } catch {
    return undefined;
  }
}
