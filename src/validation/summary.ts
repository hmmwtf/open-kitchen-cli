import type { RunStatus } from "../core/types.js";
import type { ApprovalGate, ValidationResult } from "./types.js";

export function renderValidationSummaryLines(validation: ValidationResult): string[] {
  const lines = [
    `Validation: ${validation.status}`,
    `Validation gate: ${validation.gateStatus}`,
    `Evidence: ${validation.evidence.length} record(s)`
  ];

  if (validation.status !== "passed") {
    lines.push(`Evidence summary: ${validationEvidenceSummary(validation)}`);
  }
  if (validation.commandResults) {
    lines.push(`Validation commands: ${validation.commandResults.length} executed`);
    for (const [index, result] of validation.commandResults.entries()) {
      lines.push(`Validation command ${index + 1}: ${result.status} ${result.argv.join(" ")}`);
    }
  }

  return lines;
}

export function renderApprovalSummaryLines(approval: ApprovalGate): string[] {
  const lines = [`Approval: ${approval.status}`];
  if (approval.approvedBy) {
    lines.push(`Approved by: ${approval.approvedBy}`);
  }
  if (approval.approvedAt) {
    lines.push(`Approved at: ${approval.approvedAt}`);
  }
  if (approval.nextCommand) {
    lines.push(`Next: ${approval.nextCommand}`);
  }
  return lines;
}

export function statusText(status: RunStatus): string {
  if (status === "needs_input") {
    return "needs input";
  }
  return status;
}

export function validationEvidenceSummary(validation: ValidationResult): string {
  const promptSignal = validation.evidence.find((evidence) => evidence.type === "prompt_signal");
  if (promptSignal) {
    return promptSignal.summary;
  }

  const validationCommand = validation.evidence.find((evidence) => evidence.type === "validation_command");
  if (validationCommand) {
    return validationCommand.summary;
  }

  const executionOutput = validation.evidence.find((evidence) => evidence.type === "execution_output");
  if (executionOutput) {
    return executionOutput.summary;
  }

  return validation.evidence[0]?.summary ?? "No validation evidence recorded.";
}
