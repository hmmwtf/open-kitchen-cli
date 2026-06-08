import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import type { AgentAdapterName } from "./adapter.js";

export interface ProviderCommandResolution {
  command: string;
  resolvedCommand: string;
  found: boolean;
  source: "environment" | "default";
}

export function providerCommandForAdapter(name: AgentAdapterName, env: NodeJS.ProcessEnv = process.env): string {
  if (name === "codex-cli") {
    return env.OPEN_KITCHEN_CODEX_BIN ?? "codex";
  }
  if (name === "claude-code") {
    return env.OPEN_KITCHEN_CLAUDE_BIN ?? "claude";
  }
  return name;
}

export function resolveProviderCommandForAdapter(
  name: AgentAdapterName,
  env: NodeJS.ProcessEnv = process.env
): ProviderCommandResolution {
  const command = providerCommandForAdapter(name, env);
  const source = providerCommandSource(name, env);
  const resolved = resolveExecutablePath(command, env);
  return {
    command,
    resolvedCommand: resolved ?? command,
    found: Boolean(resolved),
    source
  };
}

export function resolveExecutablePath(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (hasPathSeparator(command) || path.isAbsolute(command)) {
    return isExecutableFile(command) ? command : undefined;
  }

  const pathValue = pathEnv(env);
  if (!pathValue) {
    return undefined;
  }

  for (const directory of pathValue.split(path.delimiter).filter((item) => item.length > 0)) {
    for (const candidate of executableCandidates(path.join(directory, command), env)) {
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function providerCommandSource(name: AgentAdapterName, env: NodeJS.ProcessEnv): "environment" | "default" {
  if (name === "codex-cli" && env.OPEN_KITCHEN_CODEX_BIN) {
    return "environment";
  }
  if (name === "claude-code" && env.OPEN_KITCHEN_CLAUDE_BIN) {
    return "environment";
  }
  return "default";
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return process.platform === "win32" && existsSync(filePath);
  }
}

function executableCandidates(basePath: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32" || path.extname(basePath)) {
    return [basePath];
  }

  const pathext = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((item) => item.toLowerCase())
    .filter((item) => item.length > 0);
  const preferred = [".cmd", ".exe", ".bat", ".com", ...pathext].filter((item, index, values) => values.indexOf(item) === index);
  return [...preferred.map((extension) => `${basePath}${extension}`), basePath];
}

function pathEnv(env: NodeJS.ProcessEnv): string | undefined {
  if (env.PATH) {
    return env.PATH;
  }
  const key = Object.keys(env).find((item) => item.toLowerCase() === "path");
  return key ? env[key] : undefined;
}
