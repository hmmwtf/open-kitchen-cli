import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApprovalResumeController } from "../src/core/approval-resume-controller.js";
import { RunController } from "../src/core/run-controller.js";

describe("ApprovalResumeController", () => {
  it("resumes a pending approval run without creating another run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-resume-"));
    const pending = await new RunController().run({
      mode: "chef",
      prompt: "coordinate this change",
      ledgerRoot: root,
      requireApproval: true
    });
    const outputArtifact = await readFile(path.join(pending.ledgerPath, "artifacts", "agent-output-direct.md"), "utf8");
    const validationJson = await readFile(path.join(pending.ledgerPath, "validation.json"), "utf8");

    const resumed = await new ApprovalResumeController().resume({
      runId: pending.runId,
      ledgerRoot: root,
      approve: true
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.approval.status).toBe("approved");
    expect(resumed.approval.approvedBy).toBe("cli");
    expect(resumed.approval.approvedAt).toBeDefined();
    expect(resumed.approval.resumedFromRunId).toBe(pending.runId);

    const runs = await readdir(root);
    const approvalJson = await readFile(path.join(pending.ledgerPath, "approval.json"), "utf8");
    const resultJson = await readFile(path.join(pending.ledgerPath, "result.json"), "utf8");
    const resultMd = await readFile(path.join(pending.ledgerPath, "result.md"), "utf8");
    const runJson = await readFile(path.join(pending.ledgerPath, "run.json"), "utf8");
    const events = await readFile(path.join(pending.ledgerPath, "events.jsonl"), "utf8");

    expect(runs).toHaveLength(1);
    expect(approvalJson).toContain('"status": "approved"');
    expect(approvalJson).toContain('"approvedBy": "cli"');
    expect(resultJson).toContain('"status": "completed"');
    expect(resultJson).toContain('"validation"');
    expect(resultJson).toContain('"evidence"');
    expect(resultMd).toContain("Approved by: cli");
    expect(runJson).toContain('"status": "completed"');
    expect(events).toContain("run.resume_requested");
    expect(events).toContain("approval.resume_validated");
    expect(events).toContain("approval.approved");
    expect(events).toContain("run.resumed");
    await expect(readFile(path.join(pending.ledgerPath, "artifacts", "agent-output-direct.md"), "utf8")).resolves.toBe(
      outputArtifact
    );
    await expect(readFile(path.join(pending.ledgerPath, "validation.json"), "utf8")).resolves.toBe(validationJson);
  });

  it("preserves recipe context when resuming a pending recipe step", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-resume-recipe-"));
    const pending = await new RunController().run({
      mode: "chef",
      prompt: "coordinate this recipe step",
      ledgerRoot: root,
      requireApproval: true,
      recipeContext: {
        recipeId: "inspect-build-review",
        recipeName: "Inspect, Build, Review",
        stepId: "cook",
        stepTitle: "Implement change"
      }
    });

    await new ApprovalResumeController().resume({
      runId: pending.runId,
      ledgerRoot: root,
      approve: true
    });

    const resultJson = await readFile(path.join(pending.ledgerPath, "result.json"), "utf8");
    expect(resultJson).toContain('"recipeId": "inspect-build-review"');
    expect(resultJson).toContain('"stepId": "cook"');
  });

  it("rejects resume without explicit approval", async () => {
    await expect(
      new ApprovalResumeController().resume({
        runId: "missing",
        approve: false
      })
    ).rejects.toThrow("Approval resume requires --approve");
  });

  it("rejects completed runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-resume-completed-"));
    const completed = await new RunController().run({
      mode: "chef",
      prompt: "summarize this repo",
      ledgerRoot: root
    });

    await expect(
      new ApprovalResumeController().resume({
        runId: completed.runId,
        ledgerRoot: root,
        approve: true
      })
    ).rejects.toThrow("Run is not pending approval");
  });

  it("rejects failed runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-resume-failed-"));
    const failed = await new RunController().run({
      mode: "chef",
      prompt: "coordinate this change mock validation fail",
      ledgerRoot: root,
      requireApproval: true
    });

    await expect(
      new ApprovalResumeController().resume({
        runId: failed.runId,
        ledgerRoot: root,
        approve: true
      })
    ).rejects.toThrow("Failed runs cannot be resumed");
  });
});
