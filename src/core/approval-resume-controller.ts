import { FilesystemLedger } from "../ledger/filesystem-ledger.js";
import { isoNow } from "../utils/time.js";
import type { ApprovalGate } from "../validation/types.js";
import type { RunStatus } from "./types.js";

export interface ApprovalResumeRequest {
  runId: string;
  ledgerRoot?: string;
  approve: boolean;
}

export interface ApprovalResumeResult {
  runId: string;
  status: RunStatus;
  ledgerPath: string;
  approval: ApprovalGate;
  summary: string;
}

export class ApprovalResumeController {
  async resume(request: ApprovalResumeRequest): Promise<ApprovalResumeResult> {
    if (!request.approve) {
      throw new Error("Approval resume requires --approve.");
    }

    const ledger = new FilesystemLedger(request.ledgerRoot);
    const result = await ledger.readResult(request.runId);
    assertResumable(result);
    await ledger.writeRunResumeRequested(request.runId);
    await ledger.writeApprovalResumeValidated(request.runId, result.approval.id);

    const approval: ApprovalGate = {
      ...result.approval,
      status: "approved",
      approvedBy: "cli",
      approvedAt: isoNow(),
      resumedFromRunId: request.runId,
      reason: "Approval gate was resumed and satisfied by the CLI --approve flag.",
      nextCommand: undefined
    };
    const summary = `${displayName(result.mode)} completed ${result.policy.strategy} mock execution with ${result.outputs.length} output(s).`;

    await ledger.resumeApprovalRun({
      ...result,
      status: "completed",
      summary,
      approval
    });

    return {
      runId: request.runId,
      status: "completed",
      ledgerPath: ledger.getRunPath(request.runId),
      approval,
      summary
    };
  }
}

function assertResumable(result: {
  status: RunStatus;
  approval?: ApprovalGate;
  validation?: { gateStatus: string };
}): asserts result is {
  status: "needs_input";
  approval: ApprovalGate;
  validation: { gateStatus: "passed" };
} {
  if (result.status === "failed") {
    throw new Error("Failed runs cannot be resumed.");
  }
  if (result.status === "completed") {
    throw new Error("Run is not pending approval.");
  }
  if (!result.approval?.required) {
    throw new Error("Run is not pending approval.");
  }
  if (result.approval.status !== "pending") {
    throw new Error("Approval is not pending.");
  }
  if (result.validation?.gateStatus !== "passed") {
    throw new Error("Pending approval cannot be resumed because validation did not pass.");
  }
}

function displayName(mode: string): string {
  return `${mode.slice(0, 1).toUpperCase()}${mode.slice(1)}`;
}
