import type { BanquetLedgerRecord } from "./types.js";
import type { RunStatus } from "../core/types.js";

export function renderBanquetSummaryLines(status: RunStatus, banquet: BanquetLedgerRecord): string[] {
  const completedWorkers = banquet.workers.filter((worker) => worker.status === "completed").length;
  const failedWorkers = banquet.workers.filter((worker) => worker.status === "failed").length;
  return [
    `Banquet: ${status}`,
    `Workers: ${completedWorkers} completed, ${failedWorkers} failed`,
    `Conflicts: ${banquet.conflicts.length}`,
    `Reconciliation: ${banquet.reconciliation.status}`
  ];
}
