import { describe, expect, it } from "vitest";
import { DecisionEngine } from "../src/core/decision-engine.js";
import { resolvePolicy } from "../src/core/policy-resolver.js";
import { getMode } from "../src/modes/registry.js";

describe("DecisionEngine and resolvePolicy", () => {
  it("decides and resolves Chef to direct execution by default", () => {
    const mode = getMode("chef");
    const decision = new DecisionEngine().decide({ mode, prompt: "summarize this repo" });
    const policy = resolvePolicy({ mode, decision });

    expect(decision.kind).toBe("direct_execution");
    expect(decision.reason).toContain("selected direct execution");
    expect(policy.strategy).toBe("direct");
    expect(policy.decisionId).toBe(decision.id);
    expect(policy.requiresTasks).toBe(false);
  });

  it("resolves Prep with read-first policy", () => {
    const mode = getMode("prep");
    const decision = new DecisionEngine().decide({ mode, prompt: "inspect the project" });
    const policy = resolvePolicy({ mode, decision });

    expect(policy.strategy).toBe("direct");
    expect(policy.policies).toContain("read_first");
  });

  it("decides task-list execution when the prompt asks to split work", () => {
    const mode = getMode("cook");
    const decision = new DecisionEngine().decide({ mode, prompt: "split this into a task list" });
    const policy = resolvePolicy({ mode, decision });

    expect(decision.kind).toBe("task_generation");
    expect(decision.reason).toContain("split work into tasks");
    expect(policy.strategy).toBe("task_list");
    expect(policy.requiresTasks).toBe(true);
    expect(policy.policies).toContain("task_first");
  });

  it("decides task-list execution when --tasks is used", () => {
    const mode = getMode("chef");
    const decision = new DecisionEngine().decide({ mode, prompt: "summarize this repo", forceTasks: true });
    const policy = resolvePolicy({ mode, decision });

    expect(decision.kind).toBe("task_generation");
    expect(decision.reason).toContain("--tasks");
    expect(policy.strategy).toBe("task_list");
  });

  it("recommends Prep handoff for Chef inspection prompts without changing mode", () => {
    const mode = getMode("chef");
    const decision = new DecisionEngine().decide({ mode, prompt: "inspect the current project" });

    expect(decision.selectedMode).toBe("chef");
    expect(decision.handoffRecommendation?.toMode).toBe("prep");
    expect(decision.handoffRecommendation?.autoExecute).toBe(false);
  });

  it("recommends Taste handoff for Chef review prompts", () => {
    const mode = getMode("chef");
    const decision = new DecisionEngine().decide({ mode, prompt: "review and test these changes" });

    expect(decision.handoffRecommendation?.toMode).toBe("taste");
  });

  it("recommends Cook handoff for Chef implementation prompts", () => {
    const mode = getMode("chef");
    const decision = new DecisionEngine().decide({ mode, prompt: "implement this feature" });

    expect(decision.handoffRecommendation?.toMode).toBe("cook");
  });

  it("resolves Taste with review-gated policy", () => {
    const mode = getMode("taste");
    const decision = new DecisionEngine().decide({ mode, prompt: "review the changes" });
    const policy = resolvePolicy({ mode, decision });

    expect(policy.strategy).toBe("direct");
    expect(policy.policies).toContain("review_gated");
  });

  it("adds approval_gated policy only when approval is required", () => {
    const mode = getMode("chef");
    const decision = new DecisionEngine().decide({ mode, prompt: "coordinate this change" });
    const policy = resolvePolicy({ mode, decision, requireApproval: true });

    expect(policy.policies).toContain("approval_gated");
  });

  it("rejects approval_gated policy for modes that do not allow it", () => {
    const mode = getMode("cook");
    const decision = new DecisionEngine().decide({ mode, prompt: "fix this bug" });

    expect(() => resolvePolicy({ mode, decision, requireApproval: true })).toThrow(
      "Cook does not allow approval_gated policy"
    );
  });

  it("always decides Banquet as parallel task execution", () => {
    const mode = getMode("banquet");
    const decision = new DecisionEngine().decide({ mode, prompt: "coordinate the work" });
    const policy = resolvePolicy({ mode, decision });

    expect(decision.kind).toBe("parallel_execution");
    expect(decision.reason).toContain("requires task-first parallel execution");
    expect(policy.strategy).toBe("parallel_tasks");
    expect(policy.requiresTasks).toBe(true);
    expect(policy.policies).toContain("parallel");
  });
});
