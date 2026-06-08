import type { Command } from "commander";
import { ApprovalResumeController } from "../../core/approval-resume-controller.js";
import { renderApprovalSummaryLines } from "../../validation/summary.js";

interface ResumeCommandOptions {
  ledgerRoot?: string;
  approve?: boolean;
}

export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .description("Resume a pending OpenKitchen run.")
    .argument("<run-id>", "Run id to resume.")
    .option("--ledger-root <path>", "Override the filesystem ledger root.")
    .option("--approve", "Approve a pending approval gate.")
    .action(async (runId: string, options: ResumeCommandOptions) => {
      const result = await new ApprovalResumeController().resume({
        runId,
        ledgerRoot: options.ledgerRoot,
        approve: options.approve ?? false
      });

      for (const line of renderApprovalSummaryLines(result.approval)) {
        console.log(line);
      }
      console.log(`Run: ${result.runId}`);
      console.log(`Status: ${result.status}`);
      console.log(`Ledger: ${result.ledgerPath}`);
    });
}
