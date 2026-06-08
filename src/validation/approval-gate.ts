import { createApprovalId } from "../utils/ids.js";
import type { ModeName } from "../core/types.js";
import type { ApprovalGate, ValidationResult } from "./types.js";

export interface ApprovalGateInput {
  runId?: string;
  mode: ModeName;
  prompt: string;
  required: boolean;
  approved: boolean;
  validation?: ValidationResult;
}

export function evaluateApprovalGate(input: ApprovalGateInput): ApprovalGate | undefined {
  if (!input.required) {
    return undefined;
  }

  const validationPassed = input.validation?.gateStatus === "passed";
  if (!validationPassed) {
    return {
      id: createApprovalId(),
      status: "not_required",
      required: true,
      reason: "Approval was not requested because validation did not pass."
    };
  }

  if (input.approved) {
    return {
      id: createApprovalId(),
      status: "approved",
      required: true,
      approvedBy: "cli",
      reason: "Approval gate was satisfied by the CLI --approve flag."
    };
  }

  return {
    id: createApprovalId(),
    status: "pending",
    required: true,
    reason: "Approval is required before this run can be marked completed.",
    nextCommand: input.runId
      ? `open-kitchen resume ${input.runId} --approve`
      : `open-kitchen run --mode ${input.mode} --require-approval --approve "${input.prompt}"`
  };
}
