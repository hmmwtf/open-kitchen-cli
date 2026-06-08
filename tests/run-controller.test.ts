import { access, mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunController } from "../src/core/run-controller.js";

describe("RunController", () => {
  it("runs direct Chef execution and writes a completed ledger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-run-"));
    const result = await new RunController().run({
      mode: "chef",
      prompt: "summarize this repo",
      ledgerRoot: root
    });

    expect(result.status).toBe("completed");
    expect(result.adapter.name).toBe("mock");
    expect(result.decision.kind).toBe("direct_execution");
    expect(result.policy.strategy).toBe("direct");
    expect(result.policy.decisionId).toBe(result.decision.id);
    expect(result.modeRecommendation?.recommendedMode).toBe("chef");
    expect(result.modeRecommendation?.isOverride).toBe(false);
    expect(result.plan).toBeUndefined();
    expect(result.banquet).toBeUndefined();
    expect(result.outputs).toHaveLength(1);

    const runJson = await readFile(path.join(result.ledgerPath, "run.json"), "utf8");
    const providerJson = await readFile(path.join(result.ledgerPath, "provider.json"), "utf8");
    const decisionJson = await readFile(path.join(result.ledgerPath, "decision.json"), "utf8");
    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    expect(runJson).toContain('"status": "completed"');
    expect(runJson).toContain('"name": "mock"');
    expect(providerJson).toContain('"adapterName": "mock"');
    expect(providerJson).toContain('"capabilityAccepted": true');
    expect(decisionJson).toContain("selected direct execution");
    expect(events).toContain("adapter.selected");
    expect(events).toContain("provider.selected");
    expect(events).toContain("provider.capability.accepted");
    expect(events).toContain("mode.recommended");
    expect(events).toContain("planner.skipped");
    await expect(access(path.join(result.ledgerPath, "plan.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates a planner stub plan for forced task execution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-plan-"));
    const result = await new RunController().run({
      mode: "chef",
      prompt: "summarize this repo",
      ledgerRoot: root,
      forceTasks: true
    });

    expect(result.policy.strategy).toBe("task_list");
    expect(result.plan?.tasks).toHaveLength(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].ownership).toBeUndefined();

    const planJson = await readFile(path.join(result.ledgerPath, "plan.json"), "utf8");
    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    expect(planJson).toContain(result.decision.id);
    expect(events).toContain("planner.completed");
  });

  it("records mode recommendation overrides without switching execution mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-recommend-"));
    const result = await new RunController().run({
      mode: "chef",
      prompt: "fix this bug",
      ledgerRoot: root
    });

    expect(result.mode).toBe("chef");
    expect(result.decision.selectedMode).toBe("chef");
    expect(result.policy.strategy).toBe("direct");
    expect(result.modeRecommendation?.recommendedMode).toBe("cook");
    expect(result.modeRecommendation?.selectedMode).toBe("chef");
    expect(result.modeRecommendation?.isOverride).toBe(true);

    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    const recommendationJson = await readFile(path.join(result.ledgerPath, "mode-recommendation.json"), "utf8");
    const resultJson = await readFile(path.join(result.ledgerPath, "result.json"), "utf8");
    const resultMd = await readFile(path.join(result.ledgerPath, "result.md"), "utf8");
    expect(events).toContain("mode.override_recorded");
    expect(recommendationJson).toContain('"recommendedMode": "cook"');
    expect(resultJson).toContain('"modeRecommendation"');
    expect(resultMd).toContain("Mode Recommendation");
  });

  it("accepts explicit mock adapter selection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-adapter-"));
    const result = await new RunController().run({
      mode: "chef",
      prompt: "summarize this repo",
      ledgerRoot: root,
      adapter: "mock"
    });

    expect(result.adapter.displayName).toBe("Mock Agent Adapter");
  });

  it("rejects provider adapters that cannot satisfy Banquet parallel execution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-provider-capability-"));

    await expect(
      new RunController().run({
        mode: "banquet",
        prompt: "split this work across agents",
        ledgerRoot: root,
        adapter: "codex-cli"
      })
    ).rejects.toThrow('Adapter "codex-cli" does not support parallel task execution');

    const runs = await readdir(root);
    expect(runs).toHaveLength(1);
    const providerJson = await readFile(path.join(root, runs[0], "provider.json"), "utf8");
    const events = await readFile(path.join(root, runs[0], "events.jsonl"), "utf8");
    expect(providerJson).toContain('"capabilityAccepted": false');
    expect(events).toContain("provider.capability.rejected");
  });

  it("runs validation for Cook validation-aware policy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-validation-"));
    const result = await new RunController().run({
      mode: "cook",
      prompt: "fix this bug",
      ledgerRoot: root
    });

    expect(result.status).toBe("completed");
    expect(result.validation?.status).toBe("passed");
    expect(result.validation?.gateStatus).toBe("passed");
    expect(result.validation?.policy).toBe("validation_aware");
    expect(result.validation?.evidence.map((item) => item.type)).toEqual([
      "policy_context",
      "mock_rule",
      "execution_output"
    ]);

    const validationJson = await readFile(path.join(result.ledgerPath, "validation.json"), "utf8");
    const validationEvidenceJson = await readFile(path.join(result.ledgerPath, "validation-evidence.json"), "utf8");
    const validationReport = await readFile(path.join(result.ledgerPath, "artifacts", "validation-report.md"), "utf8");
    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    expect(validationJson).toContain('"status": "passed"');
    expect(validationJson).toContain('"evidence"');
    expect(validationEvidenceJson).toContain("policy_context");
    expect(validationReport).toContain("Validation Report");
    expect(validationReport).toContain("## Evidence");
    expect(events).toContain("validation.completed");
    expect(events).toContain("validation.gate.passed");
    expect(events).toContain("evidenceCount");
  });

  it("runs explicit local validation commands and writes command evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-validation-command-"));
    const result = await new RunController().run({
      mode: "cook",
      prompt: "fix this bug mock validation fail",
      ledgerRoot: root,
      validationCommands: [
        {
          id: "1",
          argv: [process.execPath, "-e", "console.log('typecheck ok')"],
          timeoutMs: 10000
        }
      ]
    });

    expect(result.status).toBe("completed");
    expect(result.validation?.status).toBe("passed");
    expect(result.validation?.commandResults?.[0].status).toBe("passed");
    expect(result.validation?.evidence.some((item) => item.type === "validation_command")).toBe(true);

    const validationJson = await readFile(path.join(result.ledgerPath, "validation.json"), "utf8");
    const stdout = await readFile(path.join(result.ledgerPath, "artifacts", "validation-command-1-stdout.txt"), "utf8");
    const stderr = await readFile(path.join(result.ledgerPath, "artifacts", "validation-command-1-stderr.txt"), "utf8");
    const report = await readFile(path.join(result.ledgerPath, "artifacts", "validation-report.md"), "utf8");
    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");

    expect(validationJson).toContain('"validation_command"');
    expect(stdout).toContain("typecheck ok");
    expect(stderr).toBe("");
    expect(report).toContain("## Commands");
    expect(events).toContain("validation.command.started");
    expect(events).toContain("validation.command.completed");
  });

  it("fails the validation gate when an explicit command fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-validation-command-fail-"));
    const result = await new RunController().run({
      mode: "cook",
      prompt: "fix this bug",
      ledgerRoot: root,
      validationCommands: [
        {
          id: "1",
          argv: [process.execPath, "-e", "process.exit(9)"],
          timeoutMs: 10000
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.validation?.status).toBe("failed");
    expect(result.validation?.gateStatus).toBe("failed");
    expect(result.validation?.commandResults?.[0].exitCode).toBe(9);

    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    expect(events).toContain("validation.command.failed");
  });

  it("does not run configured validation commands when no validation policy is selected", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-validation-command-skipped-"));
    const result = await new RunController().run({
      mode: "chef",
      prompt: "summarize this repo",
      ledgerRoot: root,
      validationCommands: [
        {
          id: "1",
          argv: [process.execPath, "-e", "console.log('should not run')"],
          timeoutMs: 10000
        }
      ]
    });

    expect(result.status).toBe("completed");
    expect(result.validation).toBeUndefined();
    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    expect(events).not.toContain("validation.command.started");
  });

  it("fails Taste runs when review-gated validation fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-validation-fail-"));
    const result = await new RunController().run({
      mode: "taste",
      prompt: "review this mock validation fail",
      ledgerRoot: root
    });

    expect(result.status).toBe("failed");
    expect(result.validation?.status).toBe("failed");
    expect(result.validation?.gateStatus).toBe("failed");

    const runJson = await readFile(path.join(result.ledgerPath, "run.json"), "utf8");
    const resultMd = await readFile(path.join(result.ledgerPath, "result.md"), "utf8");
    expect(runJson).toContain('"status": "failed"');
    expect(resultMd).toContain("## Validation");
  });

  it("keeps approval-gated Chef runs pending until approved", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-approval-pending-"));
    const result = await new RunController().run({
      mode: "chef",
      prompt: "coordinate this change",
      ledgerRoot: root,
      requireApproval: true
    });

    expect(result.status).toBe("needs_input");
    expect(result.policy.policies).toContain("approval_gated");
    expect(result.validation?.status).toBe("passed");
    expect(result.approval?.status).toBe("pending");
    expect(result.approval?.nextCommand).toBe(`open-kitchen resume ${result.runId} --approve`);

    const approvalJson = await readFile(path.join(result.ledgerPath, "approval.json"), "utf8");
    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    expect(approvalJson).toContain('"status": "pending"');
    expect(events).toContain("approval.pending");
  });

  it("completes approval-gated Chef runs when approved", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-approval-approved-"));
    const result = await new RunController().run({
      mode: "chef",
      prompt: "coordinate this change",
      ledgerRoot: root,
      requireApproval: true,
      approved: true
    });

    expect(result.status).toBe("completed");
    expect(result.approval?.status).toBe("approved");

    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    expect(events).toContain("approval.approved");
  });

  it("rejects approval without a required approval gate", async () => {
    await expect(
      new RunController().run({
        mode: "chef",
        prompt: "coordinate this change",
        approved: true
      })
    ).rejects.toThrow("--approve requires --require-approval");
  });

  it("rejects approval gates for modes that do not allow approval_gated", async () => {
    await expect(
      new RunController().run({
        mode: "cook",
        prompt: "fix this bug",
        requireApproval: true
      })
    ).rejects.toThrow("Cook does not allow approval_gated policy");
  });

  it("runs Banquet as mock parallel task execution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-banquet-"));
    const result = await new RunController().run({
      mode: "banquet",
      prompt: "split this work across agents",
      ledgerRoot: root
    });

    expect(result.decision.kind).toBe("parallel_execution");
    expect(result.policy.strategy).toBe("parallel_tasks");
    expect(result.plan?.strategy).toBe("parallel_tasks");
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks.every((task) => task.ownership)).toBe(true);
    expect(result.tasks.map((task) => task.ownership?.ownerWorkerId)).toEqual(["worker-1", "worker-2", "worker-3"]);
    expect(result.banquet?.workers.map((worker) => worker.id)).toEqual(["worker-1", "worker-2", "worker-3"]);
    expect(result.banquet?.workers.every((worker) => worker.assignedTaskIds.length === 1)).toBe(true);
    expect(result.banquet?.conflicts).toEqual([]);
    expect(result.banquet?.reconciliation.status).toBe("completed");
    expect(result.validation?.status).toBe("passed");
    expect(result.validation?.policy).toBe("review_gated");
    expect(result.validation?.evidence.some((item) => item.type === "banquet_reconciliation")).toBe(true);
    expect(result.outputs).toHaveLength(3);

    const artifacts = await readdir(path.join(result.ledgerPath, "artifacts"));
    expect(artifacts.filter((artifact) => artifact.startsWith("agent-output-"))).toHaveLength(3);
    expect(artifacts).toContain("banquet-reconciliation.md");
    expect(artifacts).toContain("validation-report.md");
    await expect(access(path.join(result.ledgerPath, "banquet.json"))).resolves.toBeUndefined();
  });

  it("records partial Banquet failure without discarding completed outputs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-banquet-fail-"));
    const result = await new RunController().run({
      mode: "banquet",
      prompt: "split this work mock fail banquet",
      ledgerRoot: root
    });

    expect(result.status).toBe("failed");
    expect(result.outputs).toHaveLength(3);
    expect(result.outputs.filter((output) => output.status === "completed")).toHaveLength(2);
    expect(result.outputs.find((output) => output.taskId === "task-2")?.status).toBe("failed");
    expect(result.banquet?.workers.filter((worker) => worker.status === "failed")).toHaveLength(1);
    expect(result.banquet?.reconciliation.status).toBe("failed");
    expect(result.banquet?.reconciliation.rejectedTaskIds).toEqual(["task-2"]);
    expect(result.validation?.status).toBe("skipped");
    expect(result.validation?.gateStatus).toBe("failed");
    expect(result.validation?.evidence.find((item) => item.type === "execution_output")?.details.failedTaskIds).toEqual([
      "task-2"
    ]);
    expect(result.validation?.evidence.some((item) => item.type === "banquet_reconciliation")).toBe(true);

    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    const resultJson = await readFile(path.join(result.ledgerPath, "result.json"), "utf8");
    expect(events).toContain("banquet.worker.failed");
    expect(events).toContain("banquet.reconciled");
    expect(events).toContain("validation.skipped");
    expect(resultJson).toContain('"status": "failed"');
  });

  it("records handoff recommendations without switching modes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-handoff-"));
    const result = await new RunController().run({
      mode: "chef",
      prompt: "inspect the current project",
      ledgerRoot: root
    });

    expect(result.mode).toBe("chef");
    expect(result.handoffRecommendation?.toMode).toBe("prep");
    expect(result.handoffRecommendation?.autoExecute).toBe(false);

    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");
    const resultJson = await readFile(path.join(result.ledgerPath, "result.json"), "utf8");
    expect(events).toContain("handoff.recommended");
    expect(resultJson).toContain('"toMode": "prep"');
  });

  it("records recipe context without creating another run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-recipe-"));
    const result = await new RunController().run({
      mode: "prep",
      prompt: "inspect this project",
      ledgerRoot: root,
      recipeContext: {
        recipeId: "inspect-build-review",
        recipeName: "Inspect, Build, Review",
        stepId: "prep",
        stepTitle: "Inspect context"
      }
    });

    expect(result.recipeContext?.recipeId).toBe("inspect-build-review");
    expect(result.mode).toBe("prep");

    const runs = await readdir(root);
    const runJson = await readFile(path.join(result.ledgerPath, "run.json"), "utf8");
    const repoMapJson = await readFile(path.join(result.ledgerPath, "repo-map.json"), "utf8");
    const repoMapMd = await readFile(path.join(result.ledgerPath, "artifacts", "repo-map.md"), "utf8");
    const resultJson = await readFile(path.join(result.ledgerPath, "result.json"), "utf8");
    const resultMd = await readFile(path.join(result.ledgerPath, "result.md"), "utf8");
    const events = await readFile(path.join(result.ledgerPath, "events.jsonl"), "utf8");

    expect(runs).toHaveLength(1);
    expect(runJson).toContain('"recipeId": "inspect-build-review"');
    expect(repoMapJson).toContain('"strategy": "typescript_static_mvp"');
    expect(repoMapMd).toContain("Repository Context Map");
    expect(resultJson).toContain('"stepId": "prep"');
    expect(resultJson).toContain('"repositoryContext"');
    expect(resultMd).toContain("Recipe: inspect-build-review");
    expect(resultMd).toContain("## Repository Context");
    expect(events).toContain("recipe.step.selected");
    expect(events).toContain("repository_map.generated");
  });

  it("emits progress when a run starts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-progress-start-"));
    const progressEvents: string[] = [];
    const result = await new RunController().run({
      mode: "chef",
      prompt: "summarize this repo",
      ledgerRoot: root,
      onProgress: (event) => progressEvents.push(event.type)
    });

    expect(result.status).toBe("completed");
    expect(progressEvents).toContain("run.started");
  });

  it("emits repository map progress for Prep runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-progress-repomap-"));
    const progressEvents: string[] = [];
    const result = await new RunController().run({
      mode: "prep",
      prompt: "inspect this project",
      ledgerRoot: root,
      onProgress: (event) => progressEvents.push(event.type)
    });

    expect(result.repositoryContext?.repoMapStatus).toBe("generated");
    expect(progressEvents).toContain("run.started");
    expect(progressEvents).toContain("repository_map.generated");
  });

  it("uses Prep RepoMap budgets for default, fast, and instant runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-repomap-budget-"));
    const defaultRun = await new RunController().run({
      mode: "prep",
      prompt: "inspect this project",
      ledgerRoot: path.join(root, "default")
    });
    const fastRun = await new RunController().run({
      mode: "prep",
      prompt: "inspect this project",
      ledgerRoot: path.join(root, "fast"),
      fast: true
    });
    const instantRun = await new RunController().run({
      mode: "prep",
      prompt: "inspect this project",
      ledgerRoot: path.join(root, "instant"),
      instant: true
    });
    const fastInstantRun = await new RunController().run({
      mode: "prep",
      prompt: "inspect this project",
      ledgerRoot: path.join(root, "fast-instant"),
      fast: true,
      instant: true
    });

    const defaultMap = JSON.parse(await readFile(path.join(defaultRun.ledgerPath, "repo-map.json"), "utf8"));
    const fastMap = JSON.parse(await readFile(path.join(fastRun.ledgerPath, "repo-map.json"), "utf8"));
    const instantMap = JSON.parse(await readFile(path.join(instantRun.ledgerPath, "repo-map.json"), "utf8"));
    const fastInstantMap = JSON.parse(await readFile(path.join(fastInstantRun.ledgerPath, "repo-map.json"), "utf8"));
    const defaultRepoMapMd = await readFile(path.join(defaultRun.ledgerPath, "artifacts", "repo-map.md"), "utf8");
    const instantRepoMapMd = await readFile(path.join(instantRun.ledgerPath, "artifacts", "repo-map.md"), "utf8");

    expect(defaultMap.budget.maxChars).toBe(6000);
    expect(fastMap.budget.maxChars).toBe(2000);
    expect(instantMap.budget.maxChars).toBe(2000);
    expect(fastInstantMap.budget.maxChars).toBe(2000);
    expect(defaultRepoMapMd).not.toContain("## Context Anchors");
    expect(instantRepoMapMd).toContain("## Context Anchors");
    expect(instantRepoMapMd).toContain("README.md");
  });
});
