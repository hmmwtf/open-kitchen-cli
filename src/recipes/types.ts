import type { ModeName } from "../core/types.js";

export interface RecipeDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: RecipeStepDefinition[];
}

export interface RecipeStepDefinition {
  id: string;
  mode: ModeName;
  title: string;
  description: string;
}
