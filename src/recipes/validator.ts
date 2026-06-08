import { isModeName } from "../modes/registry.js";
import type { RecipeDefinition } from "./types.js";

export function validateRecipe(recipe: RecipeDefinition): RecipeDefinition {
  if (!recipe.id.trim()) {
    throw new Error("Recipe id is required.");
  }
  if (!recipe.name.trim()) {
    throw new Error(`Recipe ${recipe.id} must have a name.`);
  }
  if (recipe.steps.length === 0) {
    throw new Error(`Recipe ${recipe.id} must define at least one step.`);
  }

  const seenStepIds = new Set<string>();
  for (const step of recipe.steps) {
    if (!step.id.trim()) {
      throw new Error(`Recipe ${recipe.id} contains a step without an id.`);
    }
    if (seenStepIds.has(step.id)) {
      throw new Error(`Recipe ${recipe.id} contains duplicate step id "${step.id}".`);
    }
    seenStepIds.add(step.id);

    if (!isModeName(step.mode)) {
      throw new Error(`Recipe ${recipe.id} step "${step.id}" uses unknown mode "${step.mode}".`);
    }
    if (!step.title.trim()) {
      throw new Error(`Recipe ${recipe.id} step "${step.id}" must have a title.`);
    }
  }

  return recipe;
}
