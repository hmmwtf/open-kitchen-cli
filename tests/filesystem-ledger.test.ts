import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FilesystemLedger } from "../src/ledger/filesystem-ledger.js";
import { mockAgentAdapterMetadata } from "../src/agents/mock-agent.js";
import type { Decision, ModeRecommendation, PlannerPlan, ResolvedPolicy } from "../src/core/types.js";
import type { BanquetLedgerRecord } from "../src/banquet/types.js";
import type { ApprovalGate, ValidationResult } from "../src/validation/types.js";

describe("FilesystemLedger", () => {
  it("creates the expected run files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-ledger-"));
    const ledger = new FilesystemLedger(root);
    const policy: ResolvedPolicy = {
      decisionId: "decision-test",
      decisionKind: "direct_execution",
      strategy: "direct",
      policies: ["direct"],
      reason: "test",
      requiresTasks: false,
      agentRoles: ["orchestrator"]
    };
    const decision: Decision = {
      id: "decision-test",
      kind: "direct_execution",
      selectedMode: "chef",
      selectedStrategy: "direct",
      reason: "Chef selected direct execution for test.",
      signals: [],
      alternatives: []
    };

    await ledger.initializeRun({ runId: "run-1", mode: "chef", prompt: "hello", adapter: mockAgentAdapterMetadata });
    await ledger.writeAdapterSelected("run-1", mockAgentAdapterMetadata);
    await ledger.writeDecision("run-1", decision);
    await ledger.writePolicy("run-1", policy);
    await ledger.writePlannerSkipped("run-1", "Planner skipped for test.");
    await ledger.writeTasks("run-1", []);
    await ledger.completeRun({
      runId: "run-1",
      mode: "chef",
      adapter: mockAgentAdapterMetadata,
      status: "completed",
      decision,
      policy,
      tasks: [],
      outputs: [],
      summary: "done"
    });

    await expect(readFile(path.join(root, "run-1", "prompt.txt"), "utf8")).resolves.toBe("hello");
    await expect(readFile(path.join(root, "run-1", "decision.json"), "utf8")).resolves.toContain("Chef selected direct execution");
    await expect(readFile(path.join(root, "run-1", "policy.json"), "utf8")).resolves.toContain("decision-test");
    await expect(readFile(path.join(root, "run-1", "result.json"), "utf8")).resolves.toContain('"name": "mock"');
    await expect(readFile(path.join(root, "run-1", "events.jsonl"), "utf8")).resolves.toContain("decision.made");
    await expect(readFile(path.join(root, "run-1", "events.jsonl"), "utf8")).resolves.toContain("adapter.selected");
    await expect(readFile(path.join(root, "run-1", "events.jsonl"), "utf8")).resolves.toContain("planner.skipped");
    await expect(readFile(path.join(root, "run-1", "result.md"), "utf8")).resolves.toContain("Adapter: mock (Mock Agent Adapter)");
    await expect(readFile(path.join(root, "run-1", "result.md"), "utf8")).resolves.toContain("Chef selected direct execution");
  });

  it("writes plans and handoff recommendations when present", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-ledger-plan-"));
    const ledger = new FilesystemLedger(root);
    const decision: Decision = {
      id: "decision-plan",
      kind: "task_generation",
      selectedMode: "chef",
      selectedStrategy: "task_list",
      reason: "Task-list execution was selected for test.",
      signals: [],
      alternatives: [],
      handoffRecommendation: {
        id: "handoff-test",
        fromMode: "chef",
        toMode: "prep",
        reason: "Chef recommends prep for test.",
        confidence: "medium",
        nextCommand: "open-kitchen run --mode prep \"inspect\"",
        autoExecute: false
      }
    };
    const policy: ResolvedPolicy = {
      decisionId: decision.id,
      decisionKind: decision.kind,
      strategy: "task_list",
      policies: ["task_first"],
      reason: decision.reason,
      requiresTasks: true,
      agentRoles: ["orchestrator"]
    };
    const plan: PlannerPlan = {
      id: "plan-test",
      decisionId: decision.id,
      mode: "chef",
      strategy: "task_list",
      reason: "Planner created test tasks.",
      tasks: [
        {
          id: "task-1",
          title: "Test task",
          prompt: "inspect",
          agentRole: "orchestrator"
        }
      ]
    };

    await ledger.initializeRun({ runId: "run-plan", mode: "chef", prompt: "inspect", adapter: mockAgentAdapterMetadata });
    await ledger.writeDecision("run-plan", decision);
    await ledger.writePolicy("run-plan", policy);
    await ledger.writePlan("run-plan", plan);
    await ledger.writeTasks("run-plan", plan.tasks);
    await ledger.completeRun({
      runId: "run-plan",
      mode: "chef",
      adapter: mockAgentAdapterMetadata,
      status: "completed",
      decision,
      policy,
      plan,
      handoffRecommendation: decision.handoffRecommendation,
      tasks: plan.tasks,
      outputs: [],
      summary: "done"
    });

    await expect(readFile(path.join(root, "run-plan", "plan.json"), "utf8")).resolves.toContain("plan-test");
    await expect(readFile(path.join(root, "run-plan", "events.jsonl"), "utf8")).resolves.toContain("planner.completed");
    await expect(readFile(path.join(root, "run-plan", "events.jsonl"), "utf8")).resolves.toContain("handoff.recommended");
    await expect(readFile(path.join(root, "run-plan", "result.md"), "utf8")).resolves.toContain("Handoff Recommendation");
  });

  it("writes mode recommendation records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-ledger-recommend-"));
    const ledger = new FilesystemLedger(root);
    const recommendation: ModeRecommendation = {
      id: "mode-recommendation-test",
      recommendedMode: "cook",
      selectedMode: "chef",
      isOverride: true,
      confidence: "high",
      reason: "Prompt asks for implementation, debugging, or code changes.",
      signals: [
        {
          name: "implementation_request",
          matched: true,
          explanation: "test"
        }
      ],
      alternatives: [],
      nextCommand: 'open-kitchen run --mode cook "fix"'
    };

    await ledger.initializeRun({ runId: "run-recommend", mode: "chef", prompt: "fix", adapter: mockAgentAdapterMetadata });
    await ledger.writeModeRecommendation("run-recommend", recommendation);

    await expect(readFile(path.join(root, "run-recommend", "mode-recommendation.json"), "utf8")).resolves.toContain(
      "mode-recommendation-test"
    );
    await expect(readFile(path.join(root, "run-recommend", "events.jsonl"), "utf8")).resolves.toContain(
      "mode.recommended"
    );
    await expect(readFile(path.join(root, "run-recommend", "events.jsonl"), "utf8")).resolves.toContain(
      "mode.override_recorded"
    );
  });

  it("classifies runs without result or approval records as partial or incomplete", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-ledger-partial-"));
    const ledger = new FilesystemLedger(root);

    await ledger.initializeRun({ runId: "run-partial", mode: "cook", prompt: "fix", adapter: mockAgentAdapterMetadata });

    const runs = await ledger.listRuns();
    expect(runs[0]).toEqual(
      expect.objectContaining({
        runId: "run-partial",
        status: "needs_input",
        classification: "partial_or_incomplete"
      })
    );
  });

  it("writes Banquet ledger records and result summaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-ledger-banquet-"));
    const ledger = new FilesystemLedger(root);
    const decision: Decision = {
      id: "decision-banquet",
      kind: "parallel_execution",
      selectedMode: "banquet",
      selectedStrategy: "parallel_tasks",
      reason: "Banquet selected parallel execution for test.",
      signals: [],
      alternatives: []
    };
    const policy: ResolvedPolicy = {
      decisionId: decision.id,
      decisionKind: decision.kind,
      strategy: "parallel_tasks",
      policies: ["task_first", "parallel"],
      reason: decision.reason,
      requiresTasks: true,
      agentRoles: ["worker", "reconciliation_agent"]
    };
    const banquet: BanquetLedgerRecord = {
      workers: [
        {
          id: "worker-1",
          role: "worker",
          label: "investigation worker",
          status: "completed",
          assignedTaskIds: ["task-1"]
        }
      ],
      conflicts: [],
      reconciliation: {
        status: "completed",
        summary: "done",
        acceptedTaskIds: ["task-1"],
        rejectedTaskIds: [],
        notes: ["No resource conflicts were detected."]
      }
    };

    await ledger.initializeRun({ runId: "run-banquet", mode: "banquet", prompt: "split", adapter: mockAgentAdapterMetadata });
    await ledger.writeDecision("run-banquet", decision);
    await ledger.writePolicy("run-banquet", policy);
    await ledger.writeBanquetRecord("run-banquet", banquet);
    await ledger.completeRun({
      runId: "run-banquet",
      mode: "banquet",
      adapter: mockAgentAdapterMetadata,
      status: "completed",
      decision,
      policy,
      tasks: [],
      outputs: [],
      banquet,
      summary: "done"
    });

    await expect(readFile(path.join(root, "run-banquet", "banquet.json"), "utf8")).resolves.toContain("worker-1");
    await expect(readFile(path.join(root, "run-banquet", "result.json"), "utf8")).resolves.toContain('"banquet"');
    await expect(readFile(path.join(root, "run-banquet", "result.md"), "utf8")).resolves.toContain("## Banquet");
    await expect(readFile(path.join(root, "run-banquet", "artifacts", "banquet-reconciliation.md"), "utf8")).resolves.toContain(
      "Banquet Reconciliation"
    );
  });

  it("writes validation and approval records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-ledger-validation-"));
    const ledger = new FilesystemLedger(root);
    const decision: Decision = {
      id: "decision-validation",
      kind: "direct_execution",
      selectedMode: "chef",
      selectedStrategy: "direct",
      reason: "Chef selected direct execution for test.",
      signals: [],
      alternatives: []
    };
    const policy: ResolvedPolicy = {
      decisionId: decision.id,
      decisionKind: decision.kind,
      strategy: "direct",
      policies: ["direct", "approval_gated"],
      reason: decision.reason,
      requiresTasks: false,
      agentRoles: ["orchestrator"]
    };
    const validation: ValidationResult = {
      id: "validation-test",
      mode: "chef",
      status: "passed",
      gateStatus: "passed",
      policy: "approval_gated",
      summary: "Mock validation passed.",
      checks: [
        {
          id: "check-1",
          name: "mock_validation",
          status: "passed",
          severity: "info",
          message: "ok",
          evidenceIds: ["evidence-1"]
        }
      ],
      evidence: [
        {
          id: "evidence-1",
          type: "policy_context",
          impact: "supports_pass",
          summary: "Policy approval_gated required validation for chef.",
          details: {
            mode: "chef",
            policy: "approval_gated"
          },
          relatedTaskIds: ["direct"]
        }
      ],
      validatedTaskIds: ["direct"],
      artifactName: "validation-report.md"
    };
    const approval: ApprovalGate = {
      id: "approval-test",
      status: "pending",
      required: true,
      reason: "Approval is required.",
      nextCommand: 'open-kitchen run --mode chef --require-approval --approve "test"'
    };

    await ledger.initializeRun({ runId: "run-validation", mode: "chef", prompt: "test", adapter: mockAgentAdapterMetadata });
    await ledger.writeDecision("run-validation", decision);
    await ledger.writePolicy("run-validation", policy);
    await ledger.writeValidationResult("run-validation", validation);
    await ledger.writeApprovalGate("run-validation", approval);
    await ledger.completeRun({
      runId: "run-validation",
      mode: "chef",
      adapter: mockAgentAdapterMetadata,
      status: "needs_input",
      decision,
      policy,
      tasks: [],
      outputs: [],
      validation,
      approval,
      summary: "needs input"
    });

    await expect(readFile(path.join(root, "run-validation", "validation.json"), "utf8")).resolves.toContain(
      "validation-test"
    );
    await expect(readFile(path.join(root, "run-validation", "validation-evidence.json"), "utf8")).resolves.toContain(
      "evidence-1"
    );
    await expect(readFile(path.join(root, "run-validation", "approval.json"), "utf8")).resolves.toContain(
      "approval-test"
    );
    await expect(readFile(path.join(root, "run-validation", "artifacts", "validation-report.md"), "utf8")).resolves.toContain(
      "Validation Report"
    );
    await expect(readFile(path.join(root, "run-validation", "artifacts", "validation-report.md"), "utf8")).resolves.toContain(
      "## Evidence"
    );
    await expect(readFile(path.join(root, "run-validation", "result.json"), "utf8")).resolves.toContain('"validation"');
    await expect(readFile(path.join(root, "run-validation", "result.json"), "utf8")).resolves.toContain('"approval"');
    await expect(readFile(path.join(root, "run-validation", "result.md"), "utf8")).resolves.toContain("## Validation");
    await expect(readFile(path.join(root, "run-validation", "result.md"), "utf8")).resolves.toContain("Evidence: 1");
    await expect(readFile(path.join(root, "run-validation", "result.md"), "utf8")).resolves.toContain("## Approval");
    await expect(readFile(path.join(root, "run-validation", "events.jsonl"), "utf8")).resolves.toContain(
      "validation.completed"
    );
    await expect(readFile(path.join(root, "run-validation", "events.jsonl"), "utf8")).resolves.toContain(
      "validation.gate.passed"
    );
    await expect(readFile(path.join(root, "run-validation", "events.jsonl"), "utf8")).resolves.toContain(
      "evidenceCount"
    );
    await expect(readFile(path.join(root, "run-validation", "events.jsonl"), "utf8")).resolves.toContain(
      "approval.pending"
    );
  });

  it("renders provider failure summaries and stream stats in result markdown", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-ledger-provider-"));
    const ledger = new FilesystemLedger(root);
    const decision: Decision = {
      id: "decision-provider",
      kind: "direct_execution",
      selectedMode: "cook",
      selectedStrategy: "direct",
      reason: "Cook selected direct execution for test.",
      signals: [],
      alternatives: []
    };
    const policy: ResolvedPolicy = {
      decisionId: decision.id,
      decisionKind: decision.kind,
      strategy: "direct",
      policies: ["direct", "validation_aware"],
      reason: decision.reason,
      requiresTasks: false,
      agentRoles: ["implementation_agent"]
    };

    await ledger.initializeRun({ runId: "run-provider", mode: "cook", prompt: "fix", adapter: mockAgentAdapterMetadata });
    await ledger.writeDecision("run-provider", decision);
    await ledger.writePolicy("run-provider", policy);
    await ledger.completeRun({
      runId: "run-provider",
      mode: "cook",
      adapter: mockAgentAdapterMetadata,
      status: "failed",
      decision,
      policy,
      tasks: [],
      outputs: [
        {
          taskId: "task-1",
          agentRole: "implementation_agent",
          status: "failed",
          artifactName: "agent-output-task-1.md",
          output: "Auth failed",
          provider: {
            adapterName: "codex-cli",
            provider: "openai",
            surface: "subprocess",
            durationMs: 12,
            exitCode: 1,
            resolvedCommand: "C:\\tools\\codex.cmd",
            timeoutMs: 300000,
            timeoutSource: "default",
            failureReason: "login required",
            failureCategory: "auth_failure",
            failureSummary: "Codex CLI authentication appears invalid or missing.",
            streamStats: {
              stdoutChunkCount: 1,
              stderrChunkCount: 1,
              jsonLineCount: 0,
              parseErrorCount: 1,
              extractedTextLength: 0
            }
          }
        }
      ],
      summary: "failed"
    });

    const markdown = await readFile(path.join(root, "run-provider", "result.md"), "utf8");
    expect(markdown).toContain("Failure category: auth_failure");
    expect(markdown).toContain("Failure summary: Codex CLI authentication appears invalid or missing.");
    expect(markdown).toContain("Resolved command: C:\\tools\\codex.cmd");
    expect(markdown).toContain("Stream parse errors: 1");
  });

  it("writes salvaged partial answer artifacts for timed out provider outputs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-ledger-partial-answer-"));
    const ledger = new FilesystemLedger(root);
    await ledger.initializeRun({ runId: "run-partial-answer", mode: "prep", prompt: "inspect", adapter: mockAgentAdapterMetadata });

    await ledger.writeAgentOutputs("run-partial-answer", [
      {
        taskId: "direct",
        agentRole: "context_scout",
        status: "failed",
        artifactName: "agent-output-direct.md",
        output: "Codex CLI Adapter did not finish before the configured timeout.",
        provider: {
          adapterName: "codex-cli",
          provider: "openai",
          surface: "subprocess",
          durationMs: 25000,
          timedOut: true,
          timeoutMs: 15000,
          timeoutSource: "request",
          partialAnswer: {
            available: true,
            source: "last_agent_message",
            length: "Useful partial answer.".length,
            artifactName: "partial-answer-direct.md",
            reason: "timed_out_with_last_agent_message"
          },
          readability: {
            finalAnswer: "Useful partial answer.",
            finalAnswerPreview: "Useful partial answer.",
            finalAnswerSource: "last_agent_message",
            warnings: [],
            commands: [],
            qualityFlags: ["timed_out_with_answer"],
            outputSize: {
              rawLength: 100,
              extractedTextLength: 22,
              finalAnswerLength: 22,
              largeOutput: false,
              largeOutputThreshold: 100000
            },
            artifactRefs: {
              outputArtifactName: "agent-output-direct.md",
              partialAnswerArtifactName: "partial-answer-direct.md"
            }
          }
        }
      }
    ]);

    const failureArtifact = await readFile(path.join(root, "run-partial-answer", "artifacts", "agent-output-direct.md"), "utf8");
    const partialArtifact = await readFile(path.join(root, "run-partial-answer", "artifacts", "partial-answer-direct.md"), "utf8");

    expect(failureArtifact).toContain("did not finish before the configured timeout");
    expect(partialArtifact).toBe("Useful partial answer.");
  });

  it("renders parser-first provider readability while keeping raw output out of result json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-ledger-readable-"));
    const ledger = new FilesystemLedger(root);
    const decision: Decision = {
      id: "decision-readable",
      kind: "direct_execution",
      selectedMode: "prep",
      selectedStrategy: "direct",
      reason: "Prep selected direct execution for test.",
      signals: [],
      alternatives: []
    };
    const policy: ResolvedPolicy = {
      decisionId: decision.id,
      decisionKind: decision.kind,
      strategy: "direct",
      policies: ["direct", "read_first"],
      reason: decision.reason,
      requiresTasks: false,
      agentRoles: ["context_scout"]
    };
    const rawOutput = "raw codex stream with command output that should stay in artifacts only";

    await ledger.initializeRun({ runId: "run-readable", mode: "prep", prompt: "inspect", adapter: mockAgentAdapterMetadata });
    await ledger.writeDecision("run-readable", decision);
    await ledger.writePolicy("run-readable", policy);
    await ledger.writeAgentOutputs("run-readable", [
      {
        taskId: "task-1",
        agentRole: "context_scout",
        status: "completed",
        artifactName: "agent-output-task-1.md",
        output: "Readable final answer.",
        rawOutput,
        rawOutputArtifactName: "provider-raw-output-task-1.txt",
        provider: {
          adapterName: "codex-cli",
          provider: "openai",
          surface: "subprocess",
          durationMs: 12,
          exitCode: 0,
          resolvedCommand: "C:\\tools\\codex.cmd",
          timeoutMs: 300000,
          timeoutSource: "default",
          streamStats: {
            stdoutChunkCount: 1,
            stderrChunkCount: 1,
            jsonLineCount: 2,
            parseErrorCount: 0,
            extractedTextLength: 22
          },
          readability: {
            finalAnswer: "Readable final answer.",
            finalAnswerPreview: "Readable final answer.",
            finalAnswerSource: "last_agent_message",
            warnings: [{ source: "stderr", message: "Warning: optional skill did not load." }],
            commands: [{ command: "rg foo", status: "failed", exitCode: 1, preview: "rg is not recognized" }],
            qualityFlags: ["completed_with_warnings", "provider_stderr", "command_failure"],
            outputSize: {
              rawLength: rawOutput.length,
              extractedTextLength: 22,
              finalAnswerLength: 22,
              largeOutput: false,
              largeOutputThreshold: 100000
            },
            artifactRefs: {
              outputArtifactName: "agent-output-task-1.md",
              rawOutputArtifactName: "provider-raw-output-task-1.txt"
            }
          }
        }
      }
    ]);
    await ledger.completeRun({
      runId: "run-readable",
      mode: "prep",
      adapter: mockAgentAdapterMetadata,
      status: "completed",
      decision,
      policy,
      tasks: [],
      outputs: [
        {
          taskId: "task-1",
          agentRole: "context_scout",
          status: "completed",
          artifactName: "agent-output-task-1.md",
          output: "Readable final answer.",
          rawOutput,
          rawOutputArtifactName: "provider-raw-output-task-1.txt",
          provider: {
            adapterName: "codex-cli",
            provider: "openai",
            surface: "subprocess",
            durationMs: 12,
            exitCode: 0,
            readability: {
              finalAnswer: "Readable final answer.",
              finalAnswerPreview: "Readable final answer.",
              finalAnswerSource: "last_agent_message",
              warnings: [{ source: "stderr", message: "Warning: optional skill did not load." }],
              commands: [{ command: "rg foo", status: "failed", exitCode: 1, preview: "rg is not recognized" }],
              qualityFlags: ["completed_with_warnings", "provider_stderr", "command_failure"],
              outputSize: {
                rawLength: rawOutput.length,
                extractedTextLength: 22,
                finalAnswerLength: 22,
                largeOutput: false,
                largeOutputThreshold: 100000
              },
              artifactRefs: {
                outputArtifactName: "agent-output-task-1.md",
                rawOutputArtifactName: "provider-raw-output-task-1.txt"
              }
            }
          }
        }
      ],
      summary: "done"
    });

    const markdown = await readFile(path.join(root, "run-readable", "result.md"), "utf8");
    const resultJson = await readFile(path.join(root, "run-readable", "result.json"), "utf8");
    const rawArtifact = await readFile(path.join(root, "run-readable", "artifacts", "provider-raw-output-task-1.txt"), "utf8");

    expect(markdown.indexOf("## Operational Assessment")).toBeLessThan(markdown.indexOf("## Final Answer"));
    expect(markdown).toContain("Trust: usable_with_caution");
    expect(markdown).toContain("Confidence: medium");
    expect(markdown).toContain("Recommended actions:");
    expect(markdown).toContain("## Final Answer");
    expect(markdown).toContain("Readable final answer.");
    expect(markdown).toContain("## Provider Warnings");
    expect(markdown).toContain("command_failure");
    expect(markdown).toContain("Raw output artifact: provider-raw-output-task-1.txt");
    expect(resultJson).toContain('"assessment"');
    expect(resultJson).toContain('"trust": "usable_with_caution"');
    expect(resultJson).not.toContain(rawOutput);
    expect(rawArtifact).toBe(rawOutput);
  });
});
