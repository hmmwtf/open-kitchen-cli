import { describe, expect, it } from "vitest";
import { getRecipe, getRecipeStep, listRecipes } from "../src/recipes/registry.js";
import { validateRecipe } from "../src/recipes/validator.js";
import type { RecipeDefinition } from "../src/recipes/types.js";

describe("recipe registry", () => {
  it("loads the built-in inspect-build-review recipe", () => {
    const recipes = listRecipes();

    expect(recipes.map((recipe) => recipe.id)).toContain("inspect-build-review");
    expect(getRecipe("inspect-build-review").steps.map((step) => step.mode)).toEqual(["prep", "cook", "taste"]);
  });

  it("gets recipe steps by id", () => {
    const recipe = getRecipe("inspect-build-review");
    const step = getRecipeStep(recipe, "prep");

    expect(step.mode).toBe("prep");
    expect(step.title).toBe("Inspect context");
  });

  it("rejects unknown recipes", () => {
    expect(() => getRecipe("missing")).toThrow('Unknown recipe "missing"');
  });

  it("rejects duplicate step ids", () => {
    const recipe: RecipeDefinition = {
      id: "bad",
      name: "Bad",
      description: "Bad recipe",
      version: "0.1",
      steps: [
        { id: "same", mode: "prep", title: "One", description: "One" },
        { id: "same", mode: "cook", title: "Two", description: "Two" }
      ]
    };

    expect(() => validateRecipe(recipe)).toThrow('duplicate step id "same"');
  });

  it("rejects unknown mode names", () => {
    const recipe = {
      id: "bad-mode",
      name: "Bad Mode",
      description: "Bad mode",
      version: "0.1",
      steps: [{ id: "bad", mode: "unknown", title: "Bad", description: "Bad" }]
    } as unknown as RecipeDefinition;

    expect(() => validateRecipe(recipe)).toThrow('unknown mode "unknown"');
  });
});
