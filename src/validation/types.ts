import type { ExecutionPolicy, ModeName } from "../core/types.js";

export type ValidationStatus = "passed" | "warning" | "failed" | "skipped";

export type ValidationGateStatus = "passed" | "failed" | "pending" | "skipped";

export type ValidationSeverity = "info" | "warning" | "error";

export type ValidationPolicy = Extract<ExecutionPolicy, "validation_aware" | "review_gated" | "approval_gated">;

export type ValidationEvidenceType =
  | "policy_context"
  | "mock_rule"
  | "prompt_signal"
  | "execution_output"
  | "banquet_reconciliation"
  | "validation_command";

export type ValidationEvidenceImpact = "supports_pass" | "supports_warning" | "supports_failure" | "supports_skip";

export interface ValidationEvidence {
  id: string;
  type: ValidationEvidenceType;
  impact: ValidationEvidenceImpact;
  summary: string;
  details: Record<string, string | number | boolean | string[] | undefined>;
  relatedTaskIds: string[];
}

export interface ValidationCheck {
  id: string;
  name: string;
  status: ValidationStatus;
  severity: ValidationSeverity;
  message: string;
  evidenceIds: string[];
}

export interface ValidationResult {
  id: string;
  mode: ModeName;
  status: ValidationStatus;
  gateStatus: ValidationGateStatus;
  policy: ValidationPolicy;
  summary: string;
  checks: ValidationCheck[];
  evidence: ValidationEvidence[];
  validatedTaskIds: string[];
  artifactName: string;
  commands?: ValidationCommand[];
  commandResults?: ValidationCommandResult[];
}

export interface ValidationCommand {
  id: string;
  argv: string[];
  timeoutMs: number;
}

export type ValidationCommandStatus = "passed" | "failed" | "timed_out";

export interface ValidationCommandResult {
  commandId: string;
  argv: string[];
  status: ValidationCommandStatus;
  exitCode?: number;
  signal?: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutPreview: string;
  stderrPreview: string;
  stdoutArtifactName?: string;
  stderrArtifactName?: string;
}

export type ApprovalStatus = "not_required" | "pending" | "approved";

export interface ApprovalGate {
  id: string;
  status: ApprovalStatus;
  required: boolean;
  approvedBy?: "cli";
  approvedAt?: string;
  resumedFromRunId?: string;
  reason: string;
  nextCommand?: string;
}
