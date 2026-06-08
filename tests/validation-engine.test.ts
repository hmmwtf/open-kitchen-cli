import { describe, expect, it } from "vitest";
import { getMode } from "../src/modes/registry.js";
import { ValidationEngine } from "../src/validation/validation-engine.js";
import type { AgentExecutionResult, ResolvedPolicy } from "../src/core/types.js";

describe("ValidationEngine", () => {
  it("returns passed validation for validation-aware policies", async () => {
    const result = await new ValidationEngine().validate({
      mode: getMode("cook"),
      policy: policy(["validation_aware"]),
      prompt: "fix this bug",
      outputs: [output("task-1", "completed")],
      executionStatus: "completed"
    });

    expect(result?.status).toBe("passed");
    expect(result?.gateStatus).toBe("passed");
    expect(result?.policy).toBe("validation_aware");
    expect(result?.validatedTaskIds).toEqual(["task-1"]);
    expect(result?.evidence.map((item) => item.type)).toEqual(["policy_context", "mock_rule", "execution_output"]);
    expect(result?.checks[0].evidenceIds).toEqual(result?.evidence.map((item) => item.id));
  });

  it("returns warning validation for the deterministic warning trigger", async () => {
    const result = await new ValidationEngine().validate({
      mode: getMode("cook"),
      policy: policy(["validation_aware"]),
      prompt: "fix this bug mock validation warn",
      outputs: [output("task-1", "completed")],
      executionStatus: "completed"
    });

    expect(result?.status).toBe("warning");
    expect(result?.gateStatus).toBe("passed");
    expect(result?.evidence.some((item) => item.type === "prompt_signal")).toBe(true);
    expect(result?.evidence.find((item) => item.type === "prompt_signal")?.impact).toBe("supports_warning");
  });

  it("returns failed validation for the deterministic failure trigger", async () => {
    const result = await new ValidationEngine().validate({
      mode: getMode("taste"),
      policy: policy(["review_gated"]),
      prompt: "review this mock validation fail",
      outputs: [output("task-1", "completed")],
      executionStatus: "completed"
    });

    expect(result?.status).toBe("failed");
    expect(result?.gateStatus).toBe("failed");
    expect(result?.policy).toBe("review_gated");
    expect(result?.evidence.find((item) => item.type === "prompt_signal")?.summary).toContain(
      "mock validation fail"
    );
    expect(result?.evidence.find((item) => item.type === "mock_rule")?.impact).toBe("supports_failure");
  });

  it("skips validation after failed execution", async () => {
    const result = await new ValidationEngine().validate({
      mode: getMode("banquet"),
      policy: policy(["review_gated"]),
      prompt: "split this work",
      outputs: [output("task-1", "failed")],
      executionStatus: "failed"
    });

    expect(result?.status).toBe("skipped");
    expect(result?.gateStatus).toBe("failed");
    expect(result?.validatedTaskIds).toEqual([]);
    expect(result?.evidence.map((item) => item.type)).toEqual(["policy_context", "execution_output"]);
    expect(result?.evidence.find((item) => item.type === "execution_output")?.details.failedTaskIds).toEqual(["task-1"]);
  });

  it("records Banquet reconciliation evidence when provided", async () => {
    const result = await new ValidationEngine().validate({
      mode: getMode("banquet"),
      policy: policy(["review_gated"]),
      prompt: "split this work",
      outputs: [output("task-1", "completed"), output("task-2", "completed")],
      executionStatus: "completed",
      banquet: {
        workers: [],
        conflicts: [
          {
            id: "conflict-1",
            taskIds: ["task-1", "task-2"],
            resources: ["implementation-area"],
            severity: "medium",
            reason: "test"
          }
        ],
        reconciliation: {
          status: "completed_with_conflicts",
          summary: "done",
          acceptedTaskIds: ["task-1"],
          rejectedTaskIds: ["task-2"],
          notes: []
        }
      }
    });

    const banquetEvidence = result?.evidence.find((item) => item.type === "banquet_reconciliation");
    expect(banquetEvidence?.summary).toContain("completed_with_conflicts");
    expect(banquetEvidence?.details.conflictCount).toBe(1);
    expect(banquetEvidence?.details.acceptedTaskIds).toEqual(["task-1"]);
    expect(banquetEvidence?.details.rejectedTaskIds).toEqual(["task-2"]);
  });

  it("returns undefined without a validation policy", async () => {
    const result = await new ValidationEngine().validate({
      mode: getMode("chef"),
      policy: policy(["direct"]),
      prompt: "summarize",
      outputs: [output("direct", "completed")],
      executionStatus: "completed"
    });

    expect(result).toBeUndefined();
  });

  it("runs explicit validation commands instead of mock prompt triggers", async () => {
    const result = await new ValidationEngine().validate({
      mode: getMode("cook"),
      policy: policy(["validation_aware"]),
      prompt: "fix this bug mock validation fail",
      outputs: [output("task-1", "completed")],
      executionStatus: "completed",
      commands: [
        {
          id: "1",
          argv: [process.execPath, "-e", "console.log('ok')"],
          timeoutMs: 10000
        }
      ]
    });

    expect(result?.status).toBe("passed");
    expect(result?.gateStatus).toBe("passed");
    expect(result?.commandResults?.[0].status).toBe("passed");
    expect(result?.evidence.map((item) => item.type)).toEqual([
      "policy_context",
      "validation_command",
      "execution_output"
    ]);
  });

  it("fails validation when an explicit command exits non-zero", async () => {
    const result = await new ValidationEngine().validate({
      mode: getMode("cook"),
      policy: policy(["validation_aware"]),
      prompt: "fix this bug",
      outputs: [output("task-1", "completed")],
      executionStatus: "completed",
      commands: [
        {
          id: "1",
          argv: [process.execPath, "-e", "process.exit(7)"],
          timeoutMs: 10000
        }
      ]
    });

    expect(result?.status).toBe("failed");
    expect(result?.gateStatus).toBe("failed");
    expect(result?.commandResults?.[0].exitCode).toBe(7);
    expect(result?.evidence.find((item) => item.type === "validation_command")?.impact).toBe("supports_failure");
  });

  it("fails validation when an explicit command times out", async () => {
    const result = await new ValidationEngine().validate({
      mode: getMode("cook"),
      policy: policy(["validation_aware"]),
      prompt: "fix this bug",
      outputs: [output("task-1", "completed")],
      executionStatus: "completed",
      commands: [
        {
          id: "1",
          argv: [process.execPath, "-e", "setTimeout(() => {}, 1000)"],
          timeoutMs: 10
        }
      ]
    });

    expect(result?.status).toBe("failed");
    expect(result?.gateStatus).toBe("failed");
    expect(result?.commandResults?.[0].status).toBe("timed_out");
  });

  it("fails validation when an explicit command cannot spawn", async () => {
    const result = await new ValidationEngine().validate({
      mode: getMode("cook"),
      policy: policy(["validation_aware"]),
      prompt: "fix this bug",
      outputs: [output("task-1", "completed")],
      executionStatus: "completed",
      commands: [
        {
          id: "1",
          argv: ["definitely-missing-open-kitchen-command"],
          timeoutMs: 10000
        }
      ]
    });

    expect(result?.status).toBe("failed");
    expect(result?.gateStatus).toBe("failed");
    expect(result?.commandResults?.[0].status).toBe("failed");
    expect(result?.commandResults?.[0].stderr).toContain("definitely-missing-open-kitchen-command");
  });
});

function policy(policies: ResolvedPolicy["policies"]): ResolvedPolicy {
  return {
    decisionId: "decision-test",
    decisionKind: "direct_execution",
    strategy: "direct",
    policies,
    reason: "test",
    requiresTasks: false,
    agentRoles: ["orchestrator"]
  };
}

function output(taskId: string, status: AgentExecutionResult["status"]): AgentExecutionResult {
  return {
    taskId,
    status,
    agentRole: "orchestrator",
    artifactName: `agent-output-${taskId}.md`,
    output: "test"
  };
}
