import type { Decision, DecisionAlternative, DecisionSignal, HandoffRecommendation, ModeDefinition, ModeName } from "./types.js";
import { createDecisionId, createHandoffId } from "../utils/ids.js";

export interface DecisionInput {
  mode: ModeDefinition;
  prompt: string;
  forceTasks?: boolean;
}

export class DecisionEngine {
  decide(input: DecisionInput): Decision {
    const signals = collectSignals(input);
    const handoffRecommendation = recommendHandoff(input);

    if (input.mode.name === "banquet") {
      return {
        id: createDecisionId(),
        kind: "parallel_execution",
        selectedMode: input.mode.name,
        selectedStrategy: "parallel_tasks",
        reason: "Banquet selected parallel execution because Banquet requires task-first parallel execution with reconciliation.",
        signals,
        handoffRecommendation,
        alternatives: [
          {
            strategy: "direct",
            reasonNotSelected: "Direct execution was not selected because Banquet is reserved for multi-agent parallel work."
          },
          {
            strategy: "task_list",
            reasonNotSelected: "Sequential task-list execution was not selected because Banquet dispatches worker tasks in parallel."
          }
        ]
      };
    }

    if (input.forceTasks) {
      return {
        id: createDecisionId(),
        kind: "task_generation",
        selectedMode: input.mode.name,
        selectedStrategy: "task_list",
        reason: "Task-list execution was selected because the user explicitly requested task generation with --tasks.",
        signals,
        handoffRecommendation,
        alternatives: directAlternative(input.mode)
      };
    }

    if (hasTaskListSignal(input.prompt)) {
      return {
        id: createDecisionId(),
        kind: "task_generation",
        selectedMode: input.mode.name,
        selectedStrategy: "task_list",
        reason: "Task-list execution was selected because the prompt asks OpenKitchen to split work into tasks.",
        signals,
        handoffRecommendation,
        alternatives: directAlternative(input.mode)
      };
    }

    return {
      id: createDecisionId(),
      kind: "direct_execution",
      selectedMode: input.mode.name,
      selectedStrategy: "direct",
      reason: `${input.mode.displayName} selected direct execution because no task-generation or parallel-execution trigger matched.`,
      signals,
      handoffRecommendation,
      alternatives: [
        {
          strategy: "task_list",
          reasonNotSelected: "Task-list execution was not selected because no task split was requested or inferred."
        },
        {
          strategy: "parallel_tasks",
          reasonNotSelected: "Parallel execution was not selected because Banquet was not the active mode."
        }
      ]
    };
  }
}

function collectSignals(input: DecisionInput): DecisionSignal[] {
  return [
    {
      name: "selected_mode",
      value: input.mode.name,
      explanation: `The user selected ${input.mode.displayName}.`
    },
    {
      name: "force_tasks",
      value: input.forceTasks ?? false,
      explanation: "Whether the user requested task generation with --tasks."
    },
    {
      name: "prompt_requests_split",
      value: hasTaskListSignal(input.prompt),
      explanation: "Whether the prompt contains simple task-splitting language."
    },
    {
      name: "mode_requires_parallel",
      value: input.mode.name === "banquet",
      explanation: "Whether the selected mode requires parallel task execution."
    }
  ];
}

function hasTaskListSignal(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return normalized.includes("task list") || normalized.includes("split");
}

function directAlternative(mode: ModeDefinition): DecisionAlternative[] {
  return [
    {
      strategy: "direct",
      reasonNotSelected: `${mode.displayName} direct execution was not selected because task generation was requested or inferred.`
    },
    {
      strategy: "parallel_tasks",
      reasonNotSelected: "Parallel execution was not selected because Banquet was not the active mode."
    }
  ];
}

function recommendHandoff(input: DecisionInput): HandoffRecommendation | undefined {
  const target = inferHandoffTarget(input.mode.name, input.prompt);
  if (!target) {
    return undefined;
  }

  return {
    id: createHandoffId(),
    fromMode: input.mode.name,
    toMode: target,
    reason: buildHandoffReason(input.mode.name, target),
    confidence: "medium",
    nextCommand: `open-kitchen run --mode ${target} "${input.prompt}"`,
    autoExecute: false
  };
}

function inferHandoffTarget(currentMode: ModeName, prompt: string): ModeName | undefined {
  const normalized = prompt.toLowerCase();

  if (currentMode === "chef") {
    if (normalized.includes("inspect") || normalized.includes("analyze") || normalized.includes("context")) {
      return "prep";
    }
    if (normalized.includes("review") || normalized.includes("test") || normalized.includes("validate")) {
      return "taste";
    }
    if (normalized.includes("implement") || normalized.includes("fix") || normalized.includes("change")) {
      return "cook";
    }
    if (normalized.includes("parallel") || normalized.includes("multi-agent")) {
      return "banquet";
    }
    return undefined;
  }

  if (currentMode === "prep" && hasImplementationSignal(normalized)) {
    return "chef";
  }
  if (currentMode === "cook" && hasInspectionSignal(normalized)) {
    return "chef";
  }
  if (currentMode === "taste" && hasImplementationSignal(normalized)) {
    return "chef";
  }
  if (currentMode === "banquet" && !hasParallelSignal(normalized)) {
    return "chef";
  }

  return undefined;
}

function buildHandoffReason(fromMode: ModeName, toMode: ModeName): string {
  if (fromMode === "chef") {
    return `Chef recommends ${toMode} because the prompt appears better suited to that mode.`;
  }
  return `${fromMode} recommends Chef because the prompt appears outside the selected mode's focused responsibility.`;
}

function hasInspectionSignal(prompt: string): boolean {
  return prompt.includes("inspect") || prompt.includes("analyze") || prompt.includes("context");
}

function hasImplementationSignal(prompt: string): boolean {
  return prompt.includes("implement") || prompt.includes("fix") || prompt.includes("change");
}

function hasParallelSignal(prompt: string): boolean {
  return prompt.includes("parallel") || prompt.includes("multi-agent") || prompt.includes("split");
}
