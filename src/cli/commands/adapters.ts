import type { Command } from "commander";
import type { AgentAdapterName } from "../../agents/adapter.js";
import { availableAgentAdapterNames, isAgentAdapterName, listAgentAdapters } from "../../agents/registry.js";
import {
  ProviderDiagnosticsLedger,
  ProviderDiagnosticsService,
  renderProviderDiagnosticsLines
} from "../../agents/diagnostics.js";

interface AdapterCheckOptions {
  ledgerRoot?: string;
  smoke?: boolean;
  timeoutMs?: string;
}

export function registerAdaptersCommand(program: Command): void {
  const adapters = program.command("adapters").description("Inspect and diagnose provider adapters.");

  adapters
    .command("list")
    .description("List available provider adapters and capabilities.")
    .action(() => {
      for (const adapter of listAgentAdapters()) {
        console.log(`${adapter.name} (${adapter.displayName})`);
        console.log(`  Provider: ${adapter.provider}`);
        console.log(`  Kind: ${adapter.kind}`);
        console.log(`  Surface: ${adapter.capabilities.executionSurface}`);
        console.log(`  Mock: ${adapter.isMock ? "yes" : "no"}`);
        console.log(`  Requires credentials: ${adapter.requiresCredentials ? "yes" : "no"}`);
        console.log(`  Streaming: ${adapter.capabilities.supportsStreaming ? "yes" : "no"}`);
        console.log(`  Parallel tasks: ${adapter.capabilities.supportsParallelTasks ? "yes" : "no"}`);
        console.log(`  Workspace mutation: ${adapter.capabilities.supportsWorkspaceMutation ? "yes" : "no"}`);
        console.log(`  Credential source: ${adapter.capabilities.credentialSource}`);
        console.log(`  Model source: ${adapter.capabilities.modelSource}`);
        console.log(`  Max concurrency: ${adapter.capabilities.maxConcurrency}`);
      }
    });

  adapters
    .command("check")
    .description("Run provider adapter health diagnostics.")
    .argument("<adapter>", "Adapter to check.")
    .option("--ledger-root <path>", "Override the provider health ledger root.")
    .option("--smoke", "Run an explicit provider smoke test.")
    .option("--timeout-ms <ms>", "Timeout for provider probes and smoke tests.")
    .action(async (adapterValue: string, options: AdapterCheckOptions) => {
      const adapterName = parseAdapter(adapterValue);
      const timeoutMs = parseTimeoutMs(options.timeoutMs);
      const result = await new ProviderDiagnosticsService().check({
        adapterName,
        smoke: options.smoke ?? false,
        timeoutMs
      });
      const ledgerPath = await new ProviderDiagnosticsLedger(options.ledgerRoot).write(result);
      for (const line of renderProviderDiagnosticsLines(result, ledgerPath)) {
        console.log(line);
      }
      if (result.status === "failed") {
        process.exitCode = 1;
      }
    });
}

function parseAdapter(value: string): AgentAdapterName {
  if (!isAgentAdapterName(value)) {
    throw new Error(`Unknown adapter "${value}". Available adapters: ${availableAgentAdapterNames()}.`);
  }
  return value;
}

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  return parsed;
}
