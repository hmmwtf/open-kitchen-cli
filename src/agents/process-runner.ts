import { spawn, spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

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
}

type TaskkillRunner = (command: string, args: string[], options: Parameters<typeof spawnSync>[2]) => SpawnSyncReturns<Buffer>;

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
    let killResult: ProcessKillResult | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutTriggeredAfterMs = Date.now() - startedAt;
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
      resolve({
        stdout,
        stderr,
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        timedOut,
        durationMs: closedAfterMs,
        ...(timedOut ? { timeoutTriggeredAfterMs, closedAfterMs, closeDelayAfterTimeoutMs: timeoutTriggeredAfterMs === undefined ? undefined : closedAfterMs - timeoutTriggeredAfterMs } : {}),
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
      stdio: "ignore",
      shell: false,
      windowsHide: true
    });
    let fallbackError: string | undefined;
    if (result.error || result.status !== 0) {
      try {
        fallbackKill();
      } catch (error) {
        fallbackError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      processTreeKillAttempted: true,
      processTreeKillSucceeded: !result.error && result.status === 0,
      processKillError: result.error?.message ?? fallbackError
    };
  }

  try {
    const killed = fallbackKill();
    return {
      processTreeKillAttempted: false,
      processTreeKillSucceeded: killed
    };
  } catch (error) {
    return {
      processTreeKillAttempted: false,
      processTreeKillSucceeded: false,
      processKillError: error instanceof Error ? error.message : String(error)
    };
  }
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
