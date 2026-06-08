import type { RecipeDefinition } from "./types.js";

export const builtInRecipes: RecipeDefinition[] = [
  {
    id: "inspect-build-review",
    name: "Inspect, Build, Review",
    description: "A simple Prep -> Cook -> Taste workflow.",
    version: "0.1",
    steps: [
      {
        id: "prep",
        mode: "prep",
        title: "Inspect context",
        description: "Gather project context before implementation."
      },
      {
        id: "cook",
        mode: "cook",
        title: "Implement change",
        description: "Apply the requested implementation."
      },
      {
        id: "taste",
        mode: "taste",
        title: "Review result",
        description: "Validate and review the result."
      }
    ]
  },
  {
    id: "approve-build-review",
    name: "Approve, Build, Review",
    description: "A Chef approval gate followed by Cook -> Taste execution.",
    version: "0.1",
    steps: [
      {
        id: "approve",
        mode: "chef",
        title: "Approve work",
        description: "Coordinate the requested work behind an explicit approval gate."
      },
      {
        id: "cook",
        mode: "cook",
        title: "Implement change",
        description: "Apply the requested implementation."
      },
      {
        id: "taste",
        mode: "taste",
        title: "Review result",
        description: "Validate and review the result."
      }
    ]
  }
];
