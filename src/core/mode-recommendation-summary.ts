import type { ModeRecommendation, ModeName } from "./types.js";

export function renderModeRecommendationLines(recommendation: ModeRecommendation): string[] {
  const matchedSignals = recommendation.signals.filter((signal) => signal.matched).map((signal) => signal.name);
  return [
    `Recommended mode: ${recommendation.recommendedMode}`,
    `Confidence: ${recommendation.confidence}`,
    `Reason: ${recommendation.reason}`,
    `Signals: ${matchedSignals.length > 0 ? matchedSignals.join(", ") : "none"}`,
    `Run: ${recommendation.nextCommand}`,
    `Override: ${overrideCommand(recommendation.selectedMode, recommendation.nextCommand)}`
  ];
}

export function renderModeRecommendationAdvisory(recommendation: ModeRecommendation): string | undefined {
  if (!recommendation.isOverride) {
    return undefined;
  }
  return `Mode recommendation: ${recommendation.recommendedMode} (${recommendation.confidence}); selected ${recommendation.selectedMode} will run.`;
}

function overrideCommand(selectedMode: ModeName, nextCommand: string): string {
  return nextCommand.replace(`--mode ${nextModeFromCommand(nextCommand)}`, `--mode ${selectedMode}`);
}

function nextModeFromCommand(nextCommand: string): string {
  const match = nextCommand.match(/--mode ([a-z]+)/);
  return match?.[1] ?? "chef";
}
