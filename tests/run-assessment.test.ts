import { describe, expect, it } from "vitest";
import { assessRun } from "../src/ledger/run-assessment.js";
import type { LedgerResult } from "../src/ledger/types.js";
import { mockAgentAdapterMetadata } from "../src/agents/mock-agent.js";

describe("Run assessment", () => {
  it("marks a clean completed structured run as trusted with high confidence", () => {
    const assessment = assessRun(resultWithOutput(readableOutput({ qualityFlags: [] })));

    expect(assessment.trust).toBe("trusted");
    expect(assessment.confidence).toBe("high");
    expect(assessment.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "structured_final_answer_extracted" })])
    );
    expect(assessment).not.toHaveProperty("reliabilityScore");
  });

  it("marks provider stderr as usable with caution", () => {
    const assessment = assessRun(
      resultWithOutput(
        readableOutput({
          qualityFlags: ["completed_with_warnings", "provider_stderr"],
          warnings: [{ source: "stderr", message: "Warning: optional detail" }]
        })
      )
    );

    expect(assessment.trust).toBe("usable_with_caution");
    expect(assessment.confidence).toBe("medium");
    expect(assessment.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "provider_stderr_present" })]));
  });

  it("marks significant blocked and failed commands as limited", () => {
    const commands = [
      ...Array.from({ length: 4 }, (_, index) => ({ command: `test-${index}`, status: "failed" as const, exitCode: 1 })),
      ...Array.from({ length: 11 }, (_, index) => ({ command: `read-${index}`, status: "blocked" as const, exitCode: -1 }))
    ];
    const assessment = assessRun(
      resultWithOutput(
        readableOutput({
          qualityFlags: ["completed_with_warnings", "blocked_command", "command_failure"],
          commands
        })
      )
    );

    expect(assessment.trust).toBe("limited");
    expect(assessment.confidence).toBe("medium");
    expect(assessment.recommendedActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: expect.stringContaining("blocked commands") }),
        expect.objectContaining({ action: expect.stringContaining("failed command") })
      ])
    );
  });

  it("marks missing final answer as not usable with low confidence", () => {
    const output = readableOutput({
      finalAnswer: undefined,
      finalAnswerSource: "none",
      qualityFlags: ["missing_final_answer"]
    });
    const assessment = assessRun(resultWithOutput(output));

    expect(assessment.trust).toBe("not_usable");
    expect(assessment.confidence).toBe("low");
    expect(assessment.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing_final_answer" })]));
  });

  it("marks raw text fallback as limited with low confidence", () => {
    const assessment = assessRun(
      resultWithOutput(
        readableOutput({
          finalAnswerSource: "raw_text_fallback",
          qualityFlags: ["raw_text_fallback"]
        })
      )
    );

    expect(assessment.trust).toBe("limited");
    expect(assessment.confidence).toBe("low");
    expect(assessment.recommendedActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: expect.stringContaining("structured extraction") })])
    );
  });

  it("marks provider failure as not usable", () => {
    const assessment = assessRun({
      ...baseResult(),
      status: "failed",
      outputs: [
        {
          taskId: "task-1",
          agentRole: "context_scout",
          status: "failed",
          artifactName: "agent-output-task-1.md",
          output: "failed",
          provider: {
            adapterName: "codex-cli",
            provider: "openai",
            surface: "subprocess",
            durationMs: 10,
            failureCategory: "auth_failure",
            failureSummary: "Auth failed."
          }
        }
      ]
    });

    expect(assessment.trust).toBe("not_usable");
    expect(assessment.confidence).toBe("low");
    expect(assessment.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "provider_failed" })]));
  });

  it("groups repeated local skill load warnings", () => {
    const assessment = assessRun(
      resultWithOutput(
        readableOutput({
          qualityFlags: ["completed_with_warnings", "provider_stderr"],
          warnings: [
            { source: "stderr", message: "failed to load skill a: missing YAML frontmatter" },
            { source: "stderr", message: "failed to load skill b: missing YAML frontmatter" },
            { source: "stderr", message: "failed to load skill c: missing YAML frontmatter" }
          ]
        })
      )
    );

    expect(assessment.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "local_skill_load_failures", message: "3 local skill file(s) failed to load." })])
    );
  });

  it("records repository map evidence without lowering trust", () => {
    const assessment = assessRun({
      ...resultWithOutput(readableOutput({ qualityFlags: [] })),
      repositoryContext: {
        repoMapStatus: "generated",
        artifactName: "repo-map.md",
        filesScanned: 8,
        filesIncluded: 4,
        symbolsIncluded: 12,
        truncated: true,
        warnings: 0
      }
    });

    expect(assessment.trust).toBe("trusted");
    expect(assessment.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "repo_map_generated" }),
        expect.objectContaining({ code: "repo_map_budget_truncated" })
      ])
    );
  });
});

function resultWithOutput(output: LedgerResult["outputs"][number]): LedgerResult {
  return {
    ...baseResult(),
    outputs: [output]
  };
}

function baseResult(): LedgerResult {
  return {
    runId: "run-1",
    mode: "prep",
    status: "completed",
    summary: "done",
    adapter: mockAgentAdapterMetadata,
    decision: {
      id: "decision-1",
      kind: "direct_execution",
      selectedMode: "prep",
      selectedStrategy: "direct",
      reason: "test",
      signals: [],
      alternatives: []
    },
    policy: {
      decisionId: "decision-1",
      decisionKind: "direct_execution",
      strategy: "direct",
      policies: ["direct"],
      reason: "test",
      requiresTasks: false,
      agentRoles: ["context_scout"]
    },
    tasks: [],
    outputs: []
  };
}

function readableOutput(input: {
  finalAnswer?: string;
  finalAnswerSource?: "last_agent_message" | "raw_text_fallback" | "none";
  qualityFlags: Array<
    | "completed_with_warnings"
    | "large_output"
    | "provider_stderr"
    | "blocked_command"
    | "command_failure"
    | "missing_final_answer"
    | "raw_text_fallback"
    | "stream_parse_failure"
  >;
  warnings?: Array<{ source: "stdout" | "stderr" | "parser"; message: string }>;
  commands?: Array<{ command: string; status: "completed" | "failed" | "blocked" | "unknown"; exitCode?: number }>;
}): LedgerResult["outputs"][number] {
  const finalAnswer = input.finalAnswer ?? "Final answer.";
  return {
    taskId: "task-1",
    agentRole: "context_scout",
    status: "completed",
    artifactName: "agent-output-task-1.md",
    output: finalAnswer,
    provider: {
      adapterName: "codex-cli",
      provider: "openai",
      surface: "subprocess",
      durationMs: 10,
      exitCode: 0,
      readability: {
        finalAnswer,
        finalAnswerPreview: finalAnswer,
        finalAnswerSource: input.finalAnswerSource ?? "last_agent_message",
        warnings: input.warnings ?? [],
        commands: input.commands ?? [],
        qualityFlags: input.qualityFlags,
        outputSize: {
          rawLength: 100,
          extractedTextLength: finalAnswer.length,
          finalAnswerLength: finalAnswer.length,
          largeOutput: input.qualityFlags.includes("large_output"),
          largeOutputThreshold: 100000
        }
      }
    }
  };
}
