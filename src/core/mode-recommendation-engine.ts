import { listModes } from "../modes/registry.js";
import { createModeRecommendationId } from "../utils/ids.js";
import type {
  ModeName,
  ModeRecommendation,
  ModeRecommendationAlternative,
  ModeRecommendationSignal
} from "./types.js";

export interface ModeRecommendationInput {
  prompt: string;
  selectedMode?: ModeName;
}

interface ModeScore {
  mode: ModeName;
  score: number;
  matchedSignals: string[];
}

const modeSignalRules: Record<ModeName, { signal: string; terms: string[] }[]> = {
  chef: [
    { signal: "orchestration_request", terms: ["coordinate", "orchestrate", "plan"] },
    { signal: "broad_request", terms: ["workflow", "end to end", "overall"] }
  ],
  prep: [
    { signal: "inspection_request", terms: ["inspect", "analyze", "context", "understand", "explore", "read"] },
    { signal: "dependency_mapping_request", terms: ["map dependencies", "dependencies"] }
  ],
  cook: [
    { signal: "implementation_request", terms: ["implement", "fix", "change", "build", "add", "refactor", "debug"] }
  ],
  taste: [
    { signal: "validation_request", terms: ["review", "test", "validate", "verify", "audit", "check"] }
  ],
  banquet: [
    { signal: "parallel_request", terms: ["parallel", "multi-agent", "split", "across agents", "concurrent", "reconcile"] }
  ]
};

export class ModeRecommendationEngine {
  recommend(input: ModeRecommendationInput): ModeRecommendation {
    const normalized = input.prompt.toLowerCase();
    const scores = scoreModes(normalized);
    const recommendedMode = selectRecommendedMode(scores);
    const selectedMode = input.selectedMode ?? recommendedMode;
    const isOverride = recommendedMode !== selectedMode;

    return {
      id: createModeRecommendationId(),
      recommendedMode,
      selectedMode,
      isOverride,
      confidence: confidenceFor(recommendedMode, scores),
      reason: reasonFor(recommendedMode, scores),
      signals: collectSignals(normalized),
      alternatives: buildAlternatives(recommendedMode, scores),
      nextCommand: `open-kitchen run --mode ${recommendedMode} "${input.prompt}"`
    };
  }
}

function scoreModes(prompt: string): ModeScore[] {
  const scores = listModes().map((mode) => {
    const matchedSignals = modeSignalRules[mode.name]
      .filter((rule) => rule.terms.some((term) => prompt.includes(term)))
      .map((rule) => rule.signal);

    return {
      mode: mode.name,
      score: matchedSignals.length,
      matchedSignals
    };
  });

  const hasPrepMatch = scoreFor(scores, "prep").score > 0;
  const nonChefMatches = scores.filter((score) => score.mode !== "chef" && score.score > 0).length;
  const chefScore = scores.find((score) => score.mode === "chef");
  if (chefScore && hasPrepMatch && nonChefMatches >= 2) {
    chefScore.score += nonChefMatches;
    chefScore.matchedSignals.push("mixed_workflow");
  }

  return scores;
}

function selectRecommendedMode(scores: ModeScore[]): ModeName {
  const banquet = scoreFor(scores, "banquet");
  if (banquet.score > 0) {
    return "banquet";
  }

  const chef = scoreFor(scores, "chef");
  if (chef.matchedSignals.includes("mixed_workflow") || chef.score > 0) {
    return "chef";
  }

  const orderedModes: ModeName[] = ["cook", "taste", "prep"];
  const best = orderedModes
    .map((mode) => scoreFor(scores, mode))
    .filter((score) => score.score > 0)
    .sort((left, right) => right.score - left.score)[0];

  return best?.mode ?? "chef";
}

function confidenceFor(recommendedMode: ModeName, scores: ModeScore[]): "low" | "medium" | "high" {
  const selected = scoreFor(scores, recommendedMode);
  if (recommendedMode === "chef" && selected.matchedSignals.includes("mixed_workflow")) {
    return "medium";
  }
  if (selected.score >= 2 || (recommendedMode !== "chef" && selected.score === 1)) {
    return "high";
  }
  if (recommendedMode === "chef" && selected.score > 0) {
    return "medium";
  }
  return "low";
}

function reasonFor(recommendedMode: ModeName, scores: ModeScore[]): string {
  const selected = scoreFor(scores, recommendedMode);
  if (recommendedMode === "banquet") {
    return "Prompt asks for parallel or multi-agent work.";
  }
  if (recommendedMode === "prep") {
    return "Prompt asks for inspection, context gathering, or dependency discovery.";
  }
  if (recommendedMode === "cook") {
    return "Prompt asks for implementation, debugging, or code changes.";
  }
  if (recommendedMode === "taste") {
    return "Prompt asks for validation, review, testing, or audit work.";
  }
  if (selected.matchedSignals.includes("mixed_workflow")) {
    return "Prompt mixes multiple workflow responsibilities, so Chef is the best orchestration mode.";
  }
  if (selected.score > 0) {
    return "Prompt asks for broad orchestration or planning work.";
  }
  return "No focused mode signal matched, so Chef is the safest default mode.";
}

function collectSignals(prompt: string): ModeRecommendationSignal[] {
  return listModes().flatMap((mode) =>
    modeSignalRules[mode.name].map((rule) => ({
      name: rule.signal,
      matched: rule.terms.some((term) => prompt.includes(term)),
      explanation: `${mode.displayName} signal based on: ${rule.terms.join(", ")}.`
    }))
  );
}

function buildAlternatives(recommendedMode: ModeName, scores: ModeScore[]): ModeRecommendationAlternative[] {
  return listModes()
    .filter((mode) => mode.name !== recommendedMode)
    .map((mode) => {
      const score = scoreFor(scores, mode.name);
      return {
        mode: mode.name,
        reasonNotSelected:
          score.score > 0
            ? `${mode.displayName} had matching signal(s), but ${recommendedMode} was a stronger fit.`
            : `${mode.displayName} was not selected because its mode-specific signals did not match.`
      };
    });
}

function scoreFor(scores: ModeScore[], mode: ModeName): ModeScore {
  const score = scores.find((candidate) => candidate.mode === mode);
  if (!score) {
    throw new Error(`Missing mode score for ${mode}.`);
  }
  return score;
}
