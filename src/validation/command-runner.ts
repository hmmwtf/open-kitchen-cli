import { spawn } from "node:child_process";
import { basename } from "node:path";
import type { ValidationCommand, ValidationCommandResult } from "./types.js";

const PREVIEW_LIMIT = 1000;

export interface ValidationCommandRunnerEvents {
  started?: (command: ValidationCommand) => Promise<void>;
  completed?: (result: ValidationCommandResult) => Promise<void>;
  failed?: (result: ValidationCommandResult) => Promise<void>;
  timedOut?: (result: ValidationCommandResult) => Promise<void>;
}

export class ValidationCommandRunner {
  async run(commands: ValidationCommand[], events: ValidationCommandRunnerEvents = {}): Promise<ValidationCommandResult[]> {
    const results: ValidationCommandResult[] = [];

    for (const command of commands) {
      await events.started?.(command);
      const result = await runOne(command);
      results.push(result);

      if (result.status === "passed") {
        await events.completed?.(result);
        continue;
      }

      if (result.status === "timed_out") {
        await events.timedOut?.(result);
      } else {
        await events.failed?.(result);
      }
      break;
    }

    return results;
  }
}

function runOne(command: ValidationCommand): Promise<ValidationCommandResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const [executable, ...args] = command.argv;
    const child = spawnExecutable(executable, args);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, command.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      stderr += stderr ? `\n${error.message}` : error.message;
    });
    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      const status = timedOut ? "timed_out" : code === 0 ? "passed" : "failed";
      resolve({
        commandId: command.id,
        argv: command.argv,
        status,
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        stdoutPreview: preview(stdout),
        stderrPreview: preview(stderr),
        stdoutArtifactName: `validation-command-${command.id}-stdout.txt`,
        stderrArtifactName: `validation-command-${command.id}-stderr.txt`
      });
    });
  });
}

function spawnExecutable(executable: string, args: string[]) {
  if (process.platform === "win32" && isCommandShim(executable)) {
    return spawn(executable, args, {
      cwd: process.cwd(),
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  return spawn(executable, args, {
    cwd: process.cwd(),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function isCommandShim(executable: string): boolean {
  const name = basename(executable).toLowerCase();
  return name.endsWith(".cmd") || name.endsWith(".bat");
}

function preview(value: string): string {
  return value.length > PREVIEW_LIMIT ? value.slice(0, PREVIEW_LIMIT) : value;
}
