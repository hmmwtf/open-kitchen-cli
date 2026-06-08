import type { AgentExecutionResult, ModeDefinition, ResolvedPolicy } from "../core/types.js";
import type { BanquetLedgerRecord } from "../banquet/types.js";
import { createValidationId } from "../utils/ids.js";
import { ValidationCommandRunner, type ValidationCommandRunnerEvents } from "./command-runner.js";
import type {
  ValidationCommand,
  ValidationCommandResult,
  ValidationEvidence,
  ValidationEvidenceImpact,
  ValidationPolicy,
  ValidationResult,
  ValidationStatus
} from "./types.js";

const MAX_VALIDATION_COMMANDS = 10;

export interface ValidationInput {
  mode: ModeDefinition;
  policy: ResolvedPolicy;
  prompt: string;
  outputs: AgentExecutionResult[];
  executionStatus: "completed" | "failed";
  banquet?: BanquetLedgerRecord;
  commands?: ValidationCommand[];
  commandEvents?: ValidationCommandRunnerEvents;
}

export class ValidationEngine {
  async validate(input: ValidationInput): Promise<ValidationResult | undefined> {
    const validationPolicy = selectValidationPolicy(input.policy);
    if (!validationPolicy) {
      return undefined;
    }

    if (input.executionStatus === "failed" || input.outputs.some((output) => output.status === "failed")) {
      return buildValidationResult({
        mode: input.mode.name,
        policy: validationPolicy,
        status: "skipped",
        gateStatus: "failed",
        summary: "Validation was skipped because execution already failed.",
        checkName: "execution_completed",
        checkMessage: "Execution produced a failed output, so validation did not run.",
        validatedTaskIds: [],
        outputs: input.outputs,
        banquet: input.banquet
      });
    }

    if (input.commands && input.commands.length > 0) {
      if (input.commands.length > MAX_VALIDATION_COMMANDS) {
        throw new Error(`Validation commands are limited to ${MAX_VALIDATION_COMMANDS} per run.`);
      }
      for (const command of input.commands) {
        if (command.argv.length === 0 || command.argv.some((item) => item.length === 0) || command.timeoutMs <= 0) {
          throw new Error("Validation commands must include non-empty argv entries and a positive timeout.");
        }
      }
      const commandResults = await new ValidationCommandRunner().run(input.commands, input.commandEvents);
      return buildCommandValidationResult({
        mode: input.mode.name,
        policy: validationPolicy,
        commands: input.commands,
        commandResults,
        validatedTaskIds: input.outputs.map((output) => output.taskId),
        outputs: input.outputs,
        banquet: input.banquet
      });
    }

    const normalizedPrompt = input.prompt.toLowerCase();
    if (normalizedPrompt.includes("mock validation fail")) {
      return buildValidationResult({
        mode: input.mode.name,
        policy: validationPolicy,
        status: "failed",
        gateStatus: "failed",
        summary: "Mock validation failed because the prompt requested a validation failure.",
        checkName: "mock_validation_failure",
        checkMessage: "The prompt contained the deterministic mock validation failure trigger.",
        validatedTaskIds: input.outputs.map((output) => output.taskId),
        outputs: input.outputs,
        promptSignal: "mock validation fail",
        banquet: input.banquet
      });
    }

    if (normalizedPrompt.includes("mock validation warn")) {
      return buildValidationResult({
        mode: input.mode.name,
        policy: validationPolicy,
        status: "warning",
        gateStatus: "passed",
        summary: "Mock validation passed with warnings.",
        checkName: "mock_validation_warning",
        checkMessage: "The prompt contained the deterministic mock validation warning trigger.",
        validatedTaskIds: input.outputs.map((output) => output.taskId),
        outputs: input.outputs,
        promptSignal: "mock validation warn",
        banquet: input.banquet
      });
    }

    return buildValidationResult({
      mode: input.mode.name,
      policy: validationPolicy,
      status: "passed",
      gateStatus: "passed",
      summary: "Mock validation passed.",
      checkName: "mock_validation",
      checkMessage: "Deterministic mock validation completed successfully.",
      validatedTaskIds: input.outputs.map((output) => output.taskId),
      outputs: input.outputs,
      banquet: input.banquet
    });
  }
}

function buildCommandValidationResult(input: {
  mode: ValidationResult["mode"];
  policy: ValidationPolicy;
  commands: ValidationCommand[];
  commandResults: ValidationCommandResult[];
  validatedTaskIds: string[];
  outputs: AgentExecutionResult[];
  banquet?: BanquetLedgerRecord;
}): ValidationResult {
  const failedCommand = input.commandResults.find((result) => result.status !== "passed");
  const status: ValidationStatus = failedCommand ? "failed" : "passed";
  const evidence = buildCommandEvidence({
    mode: input.mode,
    policy: input.policy,
    status,
    validatedTaskIds: input.validatedTaskIds,
    outputs: input.outputs,
    commandResults: input.commandResults,
    banquet: input.banquet
  });
  const checks = input.commandResults.map((result, index) => ({
    id: `check-${index + 1}`,
    name: "validation_command",
    status: result.status === "passed" ? "passed" as const : "failed" as const,
    severity: result.status === "passed" ? "info" as const : "error" as const,
    message: commandCheckMessage(result),
    evidenceIds: [`evidence-${index + 2}`]
  }));

  return {
    id: createValidationId(),
    mode: input.mode,
    status,
    gateStatus: failedCommand ? "failed" : "passed",
    policy: input.policy,
    summary: failedCommand
      ? commandFailureSummary(failedCommand)
      : `Validation commands passed: ${input.commandResults.length} command(s).`,
    checks,
    evidence,
    validatedTaskIds: input.validatedTaskIds,
    artifactName: "validation-report.md",
    commands: input.commands,
    commandResults: input.commandResults
  };
}

export function hasValidationPolicy(policy: ResolvedPolicy): boolean {
  return selectValidationPolicy(policy) !== undefined;
}

export function selectValidationPolicy(policy: ResolvedPolicy): ValidationPolicy | undefined {
  if (policy.policies.includes("approval_gated")) {
    return "approval_gated";
  }
  if (policy.policies.includes("review_gated")) {
    return "review_gated";
  }
  if (policy.policies.includes("validation_aware")) {
    return "validation_aware";
  }
  return undefined;
}

function buildValidationResult(input: {
  mode: ValidationResult["mode"];
  policy: ValidationPolicy;
  status: ValidationStatus;
  gateStatus: ValidationResult["gateStatus"];
  summary: string;
  checkName: string;
  checkMessage: string;
  validatedTaskIds: string[];
  outputs: AgentExecutionResult[];
  promptSignal?: string;
  banquet?: BanquetLedgerRecord;
}): ValidationResult {
  const evidence = buildEvidence(input);
  return {
    id: createValidationId(),
    mode: input.mode,
    status: input.status,
    gateStatus: input.gateStatus,
    policy: input.policy,
    summary: input.summary,
    validatedTaskIds: input.validatedTaskIds,
    artifactName: "validation-report.md",
    evidence,
    checks: [
      {
        id: "check-1",
        name: input.checkName,
        status: input.status,
        severity: severityForStatus(input.status),
        message: input.checkMessage,
        evidenceIds: evidence.map((item) => item.id)
      }
    ]
  };
}

function buildEvidence(input: {
  mode: ValidationResult["mode"];
  policy: ValidationPolicy;
  status: ValidationStatus;
  validatedTaskIds: string[];
  outputs: AgentExecutionResult[];
  promptSignal?: string;
  banquet?: BanquetLedgerRecord;
}): ValidationEvidence[] {
  const impact = impactForStatus(input.status);
  const failedTaskIds = input.outputs.filter((output) => output.status === "failed").map((output) => output.taskId);
  const evidence: Omit<ValidationEvidence, "id">[] = [
    {
      type: "policy_context",
      impact,
      summary: `Policy ${input.policy} required validation for ${input.mode}.`,
      details: {
        mode: input.mode,
        policy: input.policy
      },
      relatedTaskIds: input.validatedTaskIds
    }
  ];

  if (input.promptSignal) {
    evidence.push({
      type: "prompt_signal",
      impact,
      summary: `Prompt matched ${input.promptSignal} trigger.`,
      details: {
        matchedSignal: input.promptSignal
      },
      relatedTaskIds: input.validatedTaskIds
    });
  }

  if (input.status !== "skipped") {
    evidence.push({
      type: "mock_rule",
      impact,
      summary: mockRuleSummary(input.status),
      details: {
        rule: mockRuleName(input.status),
        deterministic: true
      },
      relatedTaskIds: input.validatedTaskIds
    });
  }

  evidence.push({
    type: "execution_output",
    impact,
    summary:
      input.status === "skipped"
        ? "Execution produced failed output, so validation was skipped."
        : `Validation considered ${input.outputs.length} execution output(s).`,
    details: {
      outputCount: input.outputs.length,
      failedOutputCount: failedTaskIds.length,
      failedTaskIds
    },
    relatedTaskIds: input.status === "skipped" ? failedTaskIds : input.validatedTaskIds
  });

  if (input.banquet) {
    evidence.push({
      type: "banquet_reconciliation",
      impact,
      summary: `Banquet reconciliation was ${input.banquet.reconciliation.status}.`,
      details: {
        reconciliationStatus: input.banquet.reconciliation.status,
        conflictCount: input.banquet.conflicts.length,
        acceptedTaskIds: input.banquet.reconciliation.acceptedTaskIds,
        rejectedTaskIds: input.banquet.reconciliation.rejectedTaskIds
      },
      relatedTaskIds: [
        ...input.banquet.reconciliation.acceptedTaskIds,
        ...input.banquet.reconciliation.rejectedTaskIds
      ]
    });
  }

  return evidence.map((item, index) => ({
    id: `evidence-${index + 1}`,
    ...item
  }));
}

function buildCommandEvidence(input: {
  mode: ValidationResult["mode"];
  policy: ValidationPolicy;
  status: ValidationStatus;
  validatedTaskIds: string[];
  outputs: AgentExecutionResult[];
  commandResults: ValidationCommandResult[];
  banquet?: BanquetLedgerRecord;
}): ValidationEvidence[] {
  const impact = impactForStatus(input.status);
  const evidence: Omit<ValidationEvidence, "id">[] = [
    {
      type: "policy_context",
      impact,
      summary: `Policy ${input.policy} required validation for ${input.mode}.`,
      details: {
        mode: input.mode,
        policy: input.policy
      },
      relatedTaskIds: input.validatedTaskIds
    },
    ...input.commandResults.map((result) => ({
      type: "validation_command" as const,
      impact,
      summary: commandEvidenceSummary(result),
      details: {
        argv: result.argv,
        status: result.status,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        stdoutPreview: result.stdoutPreview,
        stderrPreview: result.stderrPreview,
        stdoutArtifactName: result.stdoutArtifactName,
        stderrArtifactName: result.stderrArtifactName
      },
      relatedTaskIds: input.validatedTaskIds
    })),
    {
      type: "execution_output",
      impact,
      summary: `Validation considered ${input.outputs.length} execution output(s).`,
      details: {
        outputCount: input.outputs.length,
        failedOutputCount: 0,
        failedTaskIds: []
      },
      relatedTaskIds: input.validatedTaskIds
    }
  ];

  if (input.banquet) {
    evidence.push({
      type: "banquet_reconciliation",
      impact,
      summary: `Banquet reconciliation was ${input.banquet.reconciliation.status}.`,
      details: {
        reconciliationStatus: input.banquet.reconciliation.status,
        conflictCount: input.banquet.conflicts.length,
        acceptedTaskIds: input.banquet.reconciliation.acceptedTaskIds,
        rejectedTaskIds: input.banquet.reconciliation.rejectedTaskIds
      },
      relatedTaskIds: [
        ...input.banquet.reconciliation.acceptedTaskIds,
        ...input.banquet.reconciliation.rejectedTaskIds
      ]
    });
  }

  return evidence.map((item, index) => ({
    id: `evidence-${index + 1}`,
    ...item
  }));
}

function impactForStatus(status: ValidationStatus): ValidationEvidenceImpact {
  if (status === "warning") {
    return "supports_warning";
  }
  if (status === "failed") {
    return "supports_failure";
  }
  if (status === "skipped") {
    return "supports_skip";
  }
  return "supports_pass";
}

function mockRuleName(status: ValidationStatus): string {
  if (status === "warning") {
    return "mock_validation_warning";
  }
  if (status === "failed") {
    return "mock_validation_failure";
  }
  return "mock_validation_pass";
}

function mockRuleSummary(status: ValidationStatus): string {
  if (status === "warning") {
    return "Deterministic mock validation warning rule matched.";
  }
  if (status === "failed") {
    return "Deterministic mock validation failure rule matched.";
  }
  return "Deterministic mock validation pass rule matched.";
}

function severityForStatus(status: ValidationStatus): "info" | "warning" | "error" {
  if (status === "warning") {
    return "warning";
  }
  if (status === "failed" || status === "skipped") {
    return "error";
  }
  return "info";
}

function commandLine(argv: string[]): string {
  return argv.join(" ");
}

function commandCheckMessage(result: ValidationCommandResult): string {
  if (result.status === "passed") {
    return `Validation command passed: ${commandLine(result.argv)}.`;
  }
  if (result.status === "timed_out") {
    return `Validation command timed out: ${commandLine(result.argv)}.`;
  }
  return `Validation command failed: ${commandLine(result.argv)} exited with code ${result.exitCode ?? "unknown"}.`;
}

function commandEvidenceSummary(result: ValidationCommandResult): string {
  if (result.status === "passed") {
    return `Command passed: ${commandLine(result.argv)}.`;
  }
  if (result.status === "timed_out") {
    return `Command timed out: ${commandLine(result.argv)}.`;
  }
  return `Command failed: ${commandLine(result.argv)}.`;
}

function commandFailureSummary(result: ValidationCommandResult): string {
  if (result.status === "timed_out") {
    return `Validation command timed out: ${commandLine(result.argv)}.`;
  }
  return `Validation command failed: ${commandLine(result.argv)} exited with code ${result.exitCode ?? "unknown"}.`;
}
