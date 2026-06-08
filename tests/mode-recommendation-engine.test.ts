import { describe, expect, it } from "vitest";
import { ModeRecommendationEngine } from "../src/core/mode-recommendation-engine.js";

describe("ModeRecommendationEngine", () => {
  const engine = new ModeRecommendationEngine();

  it("recommends Cook for implementation prompts", () => {
    const recommendation = engine.recommend({ prompt: "fix this bug and add tests" });

    expect(recommendation.recommendedMode).toBe("cook");
    expect(recommendation.confidence).toBe("high");
    expect(recommendation.signals.find((signal) => signal.name === "implementation_request")?.matched).toBe(true);
  });

  it("recommends Prep for inspection prompts", () => {
    const recommendation = engine.recommend({ prompt: "inspect this project and map dependencies" });

    expect(recommendation.recommendedMode).toBe("prep");
    expect(recommendation.confidence).toBe("high");
  });

  it("recommends Taste for validation prompts", () => {
    const recommendation = engine.recommend({ prompt: "review and validate the result" });

    expect(recommendation.recommendedMode).toBe("taste");
    expect(recommendation.confidence).toBe("high");
  });

  it("recommends Banquet for parallel prompts", () => {
    const recommendation = engine.recommend({ prompt: "split this across agents and reconcile outputs" });

    expect(recommendation.recommendedMode).toBe("banquet");
    expect(recommendation.confidence).toBe("high");
  });

  it("recommends Chef for mixed workflow prompts", () => {
    const recommendation = engine.recommend({ prompt: "inspect the code, implement a fix, and review it" });

    expect(recommendation.recommendedMode).toBe("chef");
    expect(recommendation.confidence).toBe("medium");
  });

  it("records override status when the selected mode differs", () => {
    const recommendation = engine.recommend({ prompt: "fix this bug", selectedMode: "chef" });

    expect(recommendation.recommendedMode).toBe("cook");
    expect(recommendation.selectedMode).toBe("chef");
    expect(recommendation.isOverride).toBe(true);
    expect(recommendation.alternatives.map((alternative) => alternative.mode)).toContain("chef");
  });
});
