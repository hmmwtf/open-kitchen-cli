import { builtInRecipes } from "./built-ins.js";
import { validateRecipe } from "./validator.js";
import type { RecipeDefinition, RecipeStepDefinition } from "./types.js";

const recipes = new Map<string, RecipeDefinition>(
  builtInRecipes.map((recipe) => {
    const validated = validateRecipe(recipe);
    return [validated.id, validated];
  })
);

export function listRecipes(): RecipeDefinition[] {
  return [...recipes.values()];
}

export function getRecipe(recipeId: string): RecipeDefinition {
  const recipe = recipes.get(recipeId);
  if (!recipe) {
    throw new Error(`Unknown recipe "${recipeId}". Available recipes: ${availableRecipeIds()}.`);
  }
  return recipe;
}

export function getRecipeStep(recipe: RecipeDefinition, stepId: string): RecipeStepDefinition {
  const step = recipe.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new Error(`Unknown step "${stepId}" for recipe "${recipe.id}". Available steps: ${availableStepIds(recipe)}.`);
  }
  return step;
}

export function availableStepIds(recipe: RecipeDefinition): string {
  return recipe.steps.map((step) => step.id).join(", ");
}

function availableRecipeIds(): string {
  return listRecipes()
    .map((recipe) => recipe.id)
    .join(", ");
}
