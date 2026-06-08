import type { AgentExecutionResult, AgentRole, RunStatus } from "../core/types.js";

export type BanquetWorkerStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface BanquetWorker {
  id: string;
  role: AgentRole;
  label: string;
  status: BanquetWorkerStatus;
  assignedTaskIds: string[];
}

export type BanquetConflictSeverity = "low" | "medium" | "high";

export interface BanquetConflict {
  id: string;
  taskIds: string[];
  resources: string[];
  severity: BanquetConflictSeverity;
  reason: string;
}

export interface BanquetReconciliation {
  status: "completed" | "completed_with_conflicts" | "failed";
  summary: string;
  acceptedTaskIds: string[];
  rejectedTaskIds: string[];
  notes: string[];
}

export interface BanquetExecutionResult {
  workers: BanquetWorker[];
  taskResults: AgentExecutionResult[];
  conflicts: BanquetConflict[];
  reconciliation: BanquetReconciliation;
  status: RunStatus;
}

export interface BanquetLedgerRecord {
  workers: BanquetWorker[];
  conflicts: BanquetConflict[];
  reconciliation: BanquetReconciliation;
}
