import type { Command } from "commander";
import { renderBanquetSummaryLines } from "../../banquet/summary.js";
import { renderModeRecommendationLines } from "../../core/mode-recommendation-summary.js";
import { FilesystemLedger } from "../../ledger/filesystem-ledger.js";
import { renderApprovalSummaryLines, renderValidationSummaryLines } from "../../validation/summary.js";

interface LedgerCommandOptions {
  ledgerRoot?: string;
}

export function registerLedgerCommand(program: Command): void {
  const ledger = program.command("ledger").description("Inspect local OpenKitchen ledger runs.");

  ledger
    .command("list")
    .description("List recent runs.")
    .option("--ledger-root <path>", "Override the filesystem ledger root.")
    .action(async (options: LedgerCommandOptions) => {
      const runs = await new FilesystemLedger(options.ledgerRoot).listRuns();
      if (runs.length === 0) {
        console.log("No runs found.");
        return;
      }

      for (const run of runs) {
        console.log(`${run.runId} ${run.mode} ${run.status}${run.classification ? ` ${run.classification}` : ""} ${run.startedAt}`);
      }
    });

  ledger
    .command("show")
    .description("Show a run result.")
    .argument("<run-id>", "Run id to show.")
    .option("--ledger-root <path>", "Override the filesystem ledger root.")
    .action(async (runId: string, options: LedgerCommandOptions) => {
      const ledgerStore = new FilesystemLedger(options.ledgerRoot);
      const result = await ledgerStore.readResult(runId);
      console.log(result.summary);
      console.log(`Run: ${result.runId}`);
      console.log(`Mode: ${result.mode}`);
      console.log(`Adapter: ${result.adapter.name} (${result.adapter.displayName})`);
      console.log(`Status: ${result.status}`);
      console.log(`Strategy: ${result.policy.strategy}`);
      console.log(`Decision: ${result.decision.reason}`);
      if (result.modeRecommendation) {
        for (const line of renderModeRecommendationLines(result.modeRecommendation)) {
          console.log(line);
        }
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
      console.log(`Ledger: ${ledgerStore.getRunPath(runId)}`);
    });
}
