import type { ValidationCommand } from "./types.js";

const DEFAULT_VALIDATION_TIMEOUT_MS = 120000;
const MAX_VALIDATION_COMMANDS = 10;

export interface ValidationCommandConfigInput {
  values?: string[];
  timeoutMs?: string | number;
}

export function parseValidationCommands(input: ValidationCommandConfigInput): ValidationCommand[] | undefined {
  const values = input.values ?? [];
  if (values.length === 0) {
    return undefined;
  }
  if (values.length > MAX_VALIDATION_COMMANDS) {
    throw new Error(`Validation commands are limited to ${MAX_VALIDATION_COMMANDS} per run.`);
  }

  const timeoutMs = parseValidationTimeout(input.timeoutMs);
  return values.map((value, index) => ({
    id: `${index + 1}`,
    argv: parseValidationCommandArgv(value),
    timeoutMs
  }));
}

function parseValidationCommandArgv(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid --validate-command JSON: ${value}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string")) {
    throw new Error("--validate-command must be a non-empty JSON string array.");
  }

  if (parsed.some((item) => item.length === 0)) {
    throw new Error("--validate-command entries must be non-empty strings.");
  }

  return parsed;
}

function parseValidationTimeout(value: string | number | undefined): number {
  if (value === undefined) {
    return DEFAULT_VALIDATION_TIMEOUT_MS;
  }

  const timeoutMs = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--validation-timeout-ms must be a positive integer.");
  }

  return timeoutMs;
}
