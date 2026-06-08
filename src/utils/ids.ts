import { randomBytes } from "node:crypto";
import { timestampForId } from "./time.js";

export function createRunId(): string {
  return `${timestampForId()}-${randomBytes(3).toString("hex")}`;
}

export function createWorkflowRunId(): string {
  return `${timestampForId()}-workflow-${randomBytes(3).toString("hex")}`;
}

export function createDecisionId(): string {
  return `decision-${randomBytes(4).toString("hex")}`;
}

export function createModeRecommendationId(): string {
  return `mode-recommendation-${randomBytes(4).toString("hex")}`;
}

export function createPlanId(): string {
  return `plan-${randomBytes(4).toString("hex")}`;
}

export function createHandoffId(): string {
  return `handoff-${randomBytes(4).toString("hex")}`;
}

export function createValidationId(): string {
  return `validation-${randomBytes(4).toString("hex")}`;
}

export function createApprovalId(): string {
  return `approval-${randomBytes(4).toString("hex")}`;
}
