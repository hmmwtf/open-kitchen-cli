import type { Command } from "commander";
import { RunController } from "../../core/run-controller.js";
import { availableAgentAdapterNames, getAgentAdapterMetadata, isAgentAdapterName } from "../../agents/registry.js";
import { isModeName } from "../../modes/registry.js";
import type { ModeName } from "../../core/types.js";
import type { RunProgressEvent } from "../../core/types.js";
import type { AgentAdapterName } from "../../agents/adapter.js";
import { renderBanquetSummaryLines } from "../../banquet/summary.js";
import { renderModeRecommendationAdvisory } from "../../core/mode-recommendation-summary.js";
import { parseValidationCommands } from "../../validation/command-config.js";
import { renderApprovalSummaryLines, renderValidationSummaryLines } from "../../validation/summary.js";

interface RunCommandOptions {
  mode?: string;
  ledgerRoot?: string;
  tasks?: boolean;
  adapter?: string;
  requireApproval?: boolean;
  approve?: boolean;
  validateCommand?: string[];
  validationTimeoutMs?: string;
  fast?: boolean;
  instant?: boolean;
}

type ShortcutRunCommandOptions = Omit<RunCommandOptions, "mode">;

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run a prompt through an OpenKitchen mode with the selected adapter.")
    .argument("<prompt>", "Prompt to execute.")
    .option("-m, --mode <mode>", "Mode to run.", "chef")
    .option("--adapter <adapter>", "Agent adapter to use. Defaults to OPEN_KITCHEN_DEFAULT_ADAPTER or mock.")
    .option("--ledger-root <path>", "Override the filesystem ledger root.")
    .option("--tasks", "Force task-list execution for modes that support it.")
    .option("--require-approval", "Require an explicit approval gate before completion.")
    .option("--approve", "Approve a required approval gate.")
    .option("--fast", "Prefer lower latency with less exhaustive provider-backed execution.")
    .option("--instant", "Optimize for context-only, low-latency provider-backed answers; sub-10s target, not guaranteed.")
    .option("--validate-command <json-argv>", "Validation command as a JSON argv array. Can be repeated.", collectValues, [])
    .option("--validation-timeout-ms <ms>", "Validation command timeout in milliseconds.")
    .action(async (prompt: string, options: RunCommandOptions) => {
      await runPromptCommand(prompt, options);
    });

  registerModeShortcutCommand(program, "chef", "Run a prompt in Chef mode.");
  registerModeShortcutCommand(program, "prep", "Run a prompt in Prep mode.");
  registerModeShortcutCommand(program, "cook", "Run a prompt in Cook mode.");
  registerModeShortcutCommand(program, "taste", "Run a prompt in Taste mode.");
  registerModeShortcutCommand(program, "banquet", "Run a prompt in Banquet mode.");
}

function registerModeShortcutCommand(program: Command, mode: ModeName, description: string): void {
  program
    .command(mode)
    .description(`${description} Thin wrapper around "run --mode ${mode}".`)
    .argument("<prompt>", "Prompt to execute.")
    .option("--adapter <adapter>", "Agent adapter to use. Defaults to OPEN_KITCHEN_DEFAULT_ADAPTER or mock.")
    .option("--ledger-root <path>", "Override the filesystem ledger root.")
    .option("--tasks", "Force task-list execution for modes that support it.")
    .option("--require-approval", "Require an explicit approval gate before completion.")
    .option("--approve", "Approve a required approval gate.")
    .option("--fast", "Prefer lower latency with less exhaustive provider-backed execution.")
    .option("--instant", "Optimize for context-only, low-latency provider-backed answers; sub-10s target, not guaranteed.")
    .option("--validate-command <json-argv>", "Validation command as a JSON argv array. Can be repeated.", collectValues, [])
    .option("--validation-timeout-ms <ms>", "Validation command timeout in milliseconds.")
    .action(async (prompt: string, options: ShortcutRunCommandOptions) => {
      await runPromptCommand(prompt, { ...options, mode });
    });
}

async function runPromptCommand(prompt: string, options: RunCommandOptions): Promise<void> {
  const mode = parseMode(options.mode ?? "chef");
  const adapter = parseAdapter(options.adapter ?? process.env.OPEN_KITCHEN_DEFAULT_ADAPTER ?? "mock");
  const adapterMetadata = getAgentAdapterMetadata(adapter);
  const progress = adapterMetadata.isMock ? undefined : createCliProgressRenderer();
  const validationCommands = parseValidationCommands({
    values: options.validateCommand,
    timeoutMs: options.validationTimeoutMs
  });
  const result = await new RunController().run({
    mode,
    prompt,
    adapter,
    ledgerRoot: options.ledgerRoot,
    forceTasks: options.tasks ?? false,
    requireApproval: options.requireApproval ?? false,
    approved: options.approve ?? false,
    fast: options.fast ?? false,
    instant: options.instant ?? false,
    validationCommands,
    onProgress: progress
  });

  console.log(result.summary);
  console.log(`Run: ${result.runId}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Adapter: ${result.adapter.name} (${result.adapter.displayName})`);
  console.log(`Strategy: ${result.policy.strategy}`);
  console.log(`Decision: ${result.decision.reason}`);
  const modeRecommendationAdvisory = result.modeRecommendation
    ? renderModeRecommendationAdvisory(result.modeRecommendation)
    : undefined;
  if (modeRecommendationAdvisory) {
    console.log(modeRecommendationAdvisory);
  }
  console.log(result.plan ? `Plan: ${result.plan.reason} (${result.plan.tasks.length} task(s))` : "Plan: skipped");
  if (result.handoffRecommendation) {
    console.log(`Handoff: recommend ${result.handoffRecommendation.toMode} because ${result.handoffRecommendation.reason}`);
    console.log(`Next: ${result.handoffRecommendation.nextCommand}`);
  }
  if (result.banquet) {
    for (const line of renderBanquetSummaryLines(result.status, result.banquet)) {
      console.log(line);
    }
  }
  if (result.validation) {
    for (const line of renderValidationSummaryLines(result.validation)) {
      console.log(line);
    }
  }
  if (result.approval) {
    for (const line of renderApprovalSummaryLines(result.approval)) {
      console.log(line);
    }
  }
  console.log(`Ledger: ${result.ledgerPath}`);
}

export function createCliProgressRenderer(now: () => number = () => Date.now()): (event: RunProgressEvent) => void {
  const startedAt = now();

  return (event) => {
    if (event.type === "run.started") {
      console.log(`Run: ${event.runId}`);
      console.log(`Mode: ${event.mode}`);
      console.log(`Adapter: ${event.adapter.name} (${event.adapter.displayName})`);
      console.log(`Ledger: ${event.ledgerPath}`);
      return;
    }

    if (event.type === "repository_map.generated") {
      console.log(
        `${elapsedLabel(startedAt, now())} RepoMap generated: ${event.filesIncluded} files, ${event.symbolsIncluded} symbols${
          event.truncated ? ", truncated" : ""
        }`
      );
      return;
    }

    if (event.type === "provider.started") {
      console.log(
        `${elapsedLabel(startedAt, now())} Provider started: ${event.adapterName} ${event.permissionIntent}, timeout ${event.timeoutMs}ms`
      );
      return;
    }

    if (event.type === "provider.activity") {
      const stream = event.stream ? ` ${event.stream}` : "";
      console.log(`${elapsedLabel(startedAt, now())} Provider activity:${stream} chunk ${event.chunkCount}`);
      return;
    }

    if (event.type === "provider.completed") {
      console.log(`${elapsedLabel(startedAt, now())} Provider completed${durationSuffix(event.durationMs)}`);
      return;
    }

    if (event.type === "provider.timed_out") {
      console.log(`${elapsedLabel(startedAt, now())} Provider timed out${durationSuffix(event.durationMs)}`);
      return;
    }

    if (event.type === "provider.failed") {
      console.log(`${elapsedLabel(startedAt, now())} Provider failed${event.reason ? `: ${event.reason}` : ""}`);
    }
  };
}

function elapsedLabel(startedAt: number, current: number): string {
  const totalSeconds = Math.max(0, Math.floor((current - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `[${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}]`;
}

function durationSuffix(durationMs: number | undefined): string {
  return durationMs === undefined ? "" : ` (${durationMs}ms)`;
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseMode(value: string): ModeName {
  if (!isModeName(value)) {
    throw new Error(`Unknown mode "${value}". Run "open-kitchen modes" to list modes.`);
  }
  return value;
}

function parseAdapter(value: string): AgentAdapterName {
  if (!isAgentAdapterName(value)) {
    throw new Error(`Unknown adapter "${value}". Available adapters: ${availableAgentAdapterNames()}.`);
  }
  return value;
}
