import type { Command } from "commander";
import { ModeRecommendationEngine } from "../../core/mode-recommendation-engine.js";
import { renderModeRecommendationLines } from "../../core/mode-recommendation-summary.js";
import type { ModeName } from "../../core/types.js";
import { isModeName } from "../../modes/registry.js";

interface RecommendCommandOptions {
  mode?: string;
}

export function registerRecommendCommand(program: Command): void {
  program
    .command("recommend")
    .description("Recommend the best OpenKitchen mode for a prompt without executing it.")
    .argument("<prompt>", "Prompt to evaluate.")
    .option("-m, --mode <mode>", "Compare the recommendation with an intended selected mode.")
    .action((prompt: string, options: RecommendCommandOptions) => {
      const selectedMode = options.mode ? parseMode(options.mode) : undefined;
      const recommendation = new ModeRecommendationEngine().recommend({
        prompt,
        selectedMode
      });

      for (const line of renderModeRecommendationLines(recommendation)) {
        console.log(line);
      }
      if (recommendation.isOverride) {
        console.log(
          `Selected mode ${recommendation.selectedMode} overrides recommended mode ${recommendation.recommendedMode}.`
        );
      }
    });
}

function parseMode(value: string): ModeName {
  if (!isModeName(value)) {
    throw new Error(`Unknown mode "${value}". Run "open-kitchen modes" to list modes.`);
  }
  return value;
}
