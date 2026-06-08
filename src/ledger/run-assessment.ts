import type { AgentExecutionResult } from "../core/types.js";
import type { LedgerResult } from "./types.js";

export type RunTrustLabel = "trusted" | "usable_with_caution" | "limited" | "not_usable";
export type RunConfidenceLabel = "high" | "medium" | "low";
export type AssessmentSeverity = "critical" | "warning" | "info";

export interface AssessmentReason {
  severity: AssessmentSeverity;
  code: string;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface RecommendedAction {
  priority: "high" | "medium" | "low";
  action: string;
  reason: string;
}

export interface RunAssessment {
  trust: RunTrustLabel;
  confidence: RunConfidenceLabel;
  summary: string;
  reasons: AssessmentReason[];
  recommendedActions: RecommendedAction[];
}

interface AssessmentSignals {
  hasProviderFailure: boolean;
  hasFinalAnswer: boolean;
  hasStructuredFinalAnswer: boolean;
  hasMissingFinalAnswer: boolean;
  hasRawTextFallback: boolean;
  hasStreamParseIssue: boolean;
  hasProviderStderr: boolean;
  hasLargeOutput: boolean;
  failedCommands: number;
  blockedCommands: number;
  skillLoadFailures: number;
}

export function assessRun(result: LedgerResult): RunAssessment {
  const signals = collectSignals(result);
  const reasons = buildReasons(result, signals);
  const trust = selectTrust(result, signals);
  const confidence = selectConfidence(result, signals, reasons);
  return {
    trust,
    confidence,
    summary: assessmentSummary(trust, confidence, signals),
    reasons,
    recommendedActions: recommendedActions(reasons)
  };
}

function collectSignals(result: LedgerResult): AssessmentSignals {
  const readabilityOutputs = result.outputs.filter((output) => output.provider?.readability);
  const qualityFlags = new Set(readabilityOutputs.flatMap((output) => output.provider?.readability?.qualityFlags ?? []));
  const commands = readabilityOutputs.flatMap((output) => output.provider?.readability?.commands ?? []);
  const warnings = readabilityOutputs.flatMap((output) => output.provider?.readability?.warnings ?? []);
  const hasStructuredFinalAnswer = readabilityOutputs.some((output) => output.provider?.readability?.finalAnswerSource === "last_agent_message");
  const hasFinalAnswer = readabilityOutputs.some((output) => Boolean(output.provider?.readability?.finalAnswer?.trim()));

  return {
    hasProviderFailure: result.outputs.some((output) => Boolean(output.provider?.failureCategory) || output.status === "failed"),
    hasFinalAnswer,
    hasStructuredFinalAnswer,
    hasMissingFinalAnswer: qualityFlags.has("missing_final_answer") || (readabilityOutputs.length > 0 && !hasFinalAnswer),
    hasRawTextFallback: qualityFlags.has("raw_text_fallback"),
    hasStreamParseIssue: qualityFlags.has("stream_parse_failure"),
    hasProviderStderr: qualityFlags.has("provider_stderr"),
    hasLargeOutput: qualityFlags.has("large_output"),
    failedCommands: commands.filter((command) => command.status === "failed").length,
    blockedCommands: commands.filter((command) => command.status === "blocked").length,
    skillLoadFailures: warnings.filter((warning) => warning.message.toLowerCase().includes("failed to load skill")).length
  };
}

function buildReasons(result: LedgerResult, signals: AssessmentSignals): AssessmentReason[] {
  const reasons: AssessmentReason[] = [];

  if (result.status === "failed") {
    reasons.push(reason("critical", "run_failed", "The run status is failed.", { status: result.status }));
  }
  if (result.status === "needs_input") {
    reasons.push(reason("warning", "approval_or_input_needed", "The run needs user input before it can be treated as complete.", { status: result.status }));
  }
  if (signals.hasProviderFailure) {
    const failures = result.outputs.filter((output) => output.provider?.failureCategory || output.status === "failed");
    reasons.push(reason("critical", "provider_failed", `${failures.length} provider output(s) failed.`, { failures: failures.map(providerFailureEvidence) }));
  }
  if (result.validation?.gateStatus === "failed") {
    reasons.push(reason("critical", "validation_failed", "The validation gate failed.", { validationStatus: result.validation.status }));
  }
  if (result.approval?.status === "pending") {
    reasons.push(reason("warning", "approval_pending", "Approval is pending for this run.", { approvalId: result.approval.id }));
  }
  if (signals.hasStructuredFinalAnswer) {
    reasons.push(reason("info", "structured_final_answer_extracted", "A structured final answer was extracted from the provider stream."));
  } else if (signals.hasFinalAnswer && signals.hasRawTextFallback) {
    reasons.push(reason("warning", "raw_text_fallback_used", "The final answer came from raw provider text fallback."));
  } else if (signals.hasMissingFinalAnswer) {
    reasons.push(reason("critical", "missing_final_answer", "No usable final answer was extracted from the provider output."));
  }
  if (signals.hasStreamParseIssue) {
    reasons.push(reason("warning", "stream_parse_issues", "Provider stream parse issues were detected."));
  }
  if (signals.blockedCommands > 0) {
    reasons.push(reason("warning", "blocked_commands", `${signals.blockedCommands} provider command(s) were blocked by policy.`, { count: signals.blockedCommands }));
  }
  if (signals.failedCommands > 0) {
    reasons.push(reason("warning", "failed_commands", `${signals.failedCommands} provider command(s) failed during execution.`, { count: signals.failedCommands }));
  }
  if (signals.hasProviderStderr) {
    reasons.push(reason("warning", "provider_stderr_present", "The provider emitted stderr output."));
  }
  if (signals.skillLoadFailures > 0) {
    reasons.push(reason("info", "local_skill_load_failures", `${signals.skillLoadFailures} local skill file(s) failed to load.`, { count: signals.skillLoadFailures }));
  }
  if (signals.hasLargeOutput) {
    reasons.push(reason("info", "large_provider_output", "Raw provider output was large, but summarized ledger fields are available."));
  }
  if (result.validation?.gateStatus === "passed") {
    reasons.push(reason("info", "validation_passed", "The validation gate passed.", { validationStatus: result.validation.status }));
  }
  if (result.repositoryContext) {
    if (result.repositoryContext.repoMapStatus === "generated") {
      reasons.push(
        reason("info", "repo_map_generated", "A repository context map was generated for this run.", {
          filesIncluded: result.repositoryContext.filesIncluded,
          symbolsIncluded: result.repositoryContext.symbolsIncluded,
          truncated: result.repositoryContext.truncated
        })
      );
    }
    if (result.repositoryContext.repoMapStatus === "failed") {
      reasons.push(reason("warning", "repo_map_failed", "Repository context map generation failed; provider ran without repo map orientation."));
    }
    if (result.repositoryContext.truncated) {
      reasons.push(reason("info", "repo_map_budget_truncated", "Repository context map was truncated to fit the prompt budget."));
    }
    if ((result.repositoryContext.symbolsIncluded ?? 1) === 0) {
      reasons.push(reason("warning", "repo_map_no_symbols", "Repository context map did not include extracted symbols."));
    }
  }

  return dedupeReasons(reasons);
}

function selectTrust(result: LedgerResult, signals: AssessmentSignals): RunTrustLabel {
  if (
    result.status === "failed" ||
    signals.hasProviderFailure ||
    result.validation?.gateStatus === "failed" ||
    signals.hasMissingFinalAnswer
  ) {
    return "not_usable";
  }
  if (signals.hasRawTextFallback || signals.hasStreamParseIssue || signals.failedCommands > 3 || signals.blockedCommands > 10) {
    return "limited";
  }
  if (
    result.status === "needs_input" ||
    result.approval?.status === "pending" ||
    signals.hasProviderStderr ||
    signals.failedCommands > 0 ||
    signals.blockedCommands > 0 ||
    signals.hasLargeOutput
  ) {
    return "usable_with_caution";
  }
  return "trusted";
}

function selectConfidence(result: LedgerResult, signals: AssessmentSignals, reasons: AssessmentReason[]): RunConfidenceLabel {
  if (
    result.status === "failed" ||
    signals.hasProviderFailure ||
    signals.hasMissingFinalAnswer ||
    signals.hasRawTextFallback ||
    signals.hasStreamParseIssue ||
    result.validation?.gateStatus === "failed"
  ) {
    return "low";
  }
  if (signals.hasStructuredFinalAnswer && !reasons.some((item) => item.severity === "critical") && reasons.every((item) => item.severity === "info")) {
    return "high";
  }
  return "medium";
}

function assessmentSummary(trust: RunTrustLabel, confidence: RunConfidenceLabel, signals: AssessmentSignals): string {
  if (trust === "trusted") {
    return "This run completed cleanly and produced a structured final answer.";
  }
  if (trust === "not_usable") {
    return "This run should not be relied on without resolving critical execution or validation issues.";
  }
  if (trust === "limited") {
    return "This run produced a result, but execution evidence indicates the result may be incomplete or scope-limited.";
  }
  if (confidence === "medium" && signals.hasStructuredFinalAnswer) {
    return "This run completed and produced a structured final answer, but non-fatal operational issues were observed.";
  }
  return "This run is usable with caution because non-fatal operational issues were observed.";
}

function recommendedActions(reasons: AssessmentReason[]): RecommendedAction[] {
  const actions = reasons.flatMap((item) => actionForReason(item));
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.priority}:${action.action}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function actionForReason(reasonItem: AssessmentReason): RecommendedAction[] {
  switch (reasonItem.code) {
    case "run_failed":
      return [action("high", "Do not rely on this run result until the failure is resolved.", reasonItem.message)];
    case "provider_failed":
      return [action("high", "Fix the provider failure and rerun before using the result.", reasonItem.message)];
    case "validation_failed":
      return [action("high", "Treat the run as not usable until validation failure is resolved.", reasonItem.message)];
    case "missing_final_answer":
      return [action("high", "Inspect raw artifacts or rerun; result.md does not contain a usable final answer.", reasonItem.message)];
    case "approval_pending":
    case "approval_or_input_needed":
      return [action("high", "Complete or resume the pending approval/input step before relying on the run.", reasonItem.message)];
    case "raw_text_fallback_used":
      return [action("medium", "Verify the final answer manually because structured extraction did not succeed.", reasonItem.message)];
    case "stream_parse_issues":
      return [action("medium", "Review parser warnings or raw artifacts if the final answer appears incomplete.", reasonItem.message)];
    case "blocked_commands":
      return [action("medium", "Review whether blocked commands limited the run's coverage.", reasonItem.message)];
    case "failed_commands":
      return [action("medium", "Check failed command summaries before relying on repository-level conclusions.", reasonItem.message)];
    case "local_skill_load_failures":
      return [action("low", "Fix or remove invalid local skill files if those skills are expected to participate.", reasonItem.message)];
    case "large_provider_output":
      return [action("low", "Use result.md as the primary review surface; open raw artifacts only if the final answer appears incomplete.", reasonItem.message)];
    case "repo_map_failed":
      return [action("low", "Provider ran without repository orientation; review exploration commands if the answer seems shallow.", reasonItem.message)];
    case "repo_map_budget_truncated":
      return [action("low", "Open repo-map.md if you need to inspect omitted repository context.", reasonItem.message)];
    case "repo_map_no_symbols":
      return [action("medium", "Repository map did not extract useful symbols; provider result may rely on manual exploration.", reasonItem.message)];
    default:
      return [];
  }
}

function providerFailureEvidence(output: AgentExecutionResult): Record<string, unknown> {
  return {
    taskId: output.taskId,
    status: output.status,
    failureCategory: output.provider?.failureCategory,
    failureSummary: output.provider?.failureSummary
  };
}

function reason(severity: AssessmentSeverity, code: string, message: string, evidence?: Record<string, unknown>): AssessmentReason {
  return { severity, code, message, evidence };
}

function action(priority: RecommendedAction["priority"], actionText: string, actionReason: string): RecommendedAction {
  return {
    priority,
    action: actionText,
    reason: actionReason
  };
}

function dedupeReasons(reasons: AssessmentReason[]): AssessmentReason[] {
  const seen = new Set<string>();
  return reasons.filter((item) => {
    if (seen.has(item.code)) {
      return false;
    }
    seen.add(item.code);
    return true;
  });
}
