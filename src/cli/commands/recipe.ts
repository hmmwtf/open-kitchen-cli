import type { Command } from "commander";
import type { AgentAdapterName } from "../../agents/adapter.js";
import { availableAgentAdapterNames, isAgentAdapterName } from "../../agents/registry.js";
import { RunController } from "../../core/run-controller.js";
import { availableStepIds, getRecipe, getRecipeStep, listRecipes } from "../../recipes/registry.js";
import { RecipeWorkflowRunner } from "../../recipes/workflow-runner.js";
import type { RecipeWorkflowRun } from "../../recipes/workflow-types.js";
import { parseValidationCommands } from "../../validation/command-config.js";
import { renderApprovalSummaryLines, renderValidationSummaryLines } from "../../validation/summary.js";

interface RecipeRunOptions {
  step?: string;
  adapter?: string;
  ledgerRoot?: string;
  tasks?: boolean;
  requireApproval?: boolean;
  approve?: boolean;
  validateCommand?: string[];
  validationTimeoutMs?: string;
}

interface RecipeWorkflowRunOptions {
  adapter?: string;
  ledgerRoot?: string;
  workflowLedgerRoot?: string;
  tasks?: boolean;
  requireApprovalStep?: string[];
  validateCommand?: string[];
  validationTimeoutMs?: string;
}

interface RecipeWorkflowShowOptions {
  workflowLedgerRoot?: string;
}

interface RecipeWorkflowResumeOptions {
  ledgerRoot?: string;
  workflowLedgerRoot?: string;
  adapter?: string;
  tasks?: boolean;
  approve?: boolean;
  validateCommand?: string[];
  validationTimeoutMs?: string;
}

export function registerRecipeCommand(program: Command): void {
  const recipe = program.command("recipe").description("Work with reusable OpenKitchen recipes.");

  recipe
    .command("list")
    .description("List available recipes.")
    .action(() => {
      for (const definition of listRecipes()) {
        console.log(`${definition.id} ${definition.name} (${definition.steps.length} step(s))`);
      }
    });

  recipe
    .command("show")
    .description("Show a recipe workflow.")
    .argument("<recipe-id>", "Recipe id to show.")
    .action((recipeId: string) => {
      const definition = getRecipe(recipeId);
      console.log(`${definition.name} (${definition.id})`);
      console.log(definition.description);
      console.log(`Version: ${definition.version}`);
      for (const [index, step] of definition.steps.entries()) {
        console.log(`${index + 1}. ${step.id} [${step.mode}] ${step.title}`);
        console.log(`   ${step.description}`);
      }
    });

  recipe
    .command("run")
    .description("Run one explicit recipe step.")
    .argument("<recipe-id>", "Recipe id to run.")
    .argument("[prompt]", "Prompt to execute for the selected step.")
    .option("--step <step-id>", "Recipe step id to run.")
    .option("--adapter <adapter>", "Agent adapter to use.", "mock")
    .option("--ledger-root <path>", "Override the filesystem ledger root.")
    .option("--tasks", "Force task-list execution for modes that support it.")
    .option("--require-approval", "Require an explicit approval gate before completion.")
    .option("--approve", "Approve a required approval gate.")
    .option("--validate-command <json-argv>", "Validation command as a JSON argv array. Can be repeated.", collectValues, [])
    .option("--validation-timeout-ms <ms>", "Validation command timeout in milliseconds.")
    .action(async (recipeId: string, prompt: string | undefined, options: RecipeRunOptions) => {
      const definition = getRecipe(recipeId);
      if (!options.step) {
        throw new Error(`Recipe "${definition.id}" requires --step. Available steps: ${availableStepIds(definition)}.`);
      }
      if (!prompt) {
        throw new Error(`Recipe "${definition.id}" step "${options.step}" requires a prompt.`);
      }

      const step = getRecipeStep(definition, options.step);
      const adapter = parseAdapter(options.adapter ?? "mock");
      const validationCommands = parseValidationCommands({
        values: options.validateCommand,
        timeoutMs: options.validationTimeoutMs
      });
      const result = await new RunController().run({
        mode: step.mode,
        prompt,
        adapter,
        ledgerRoot: options.ledgerRoot,
        forceTasks: options.tasks ?? false,
        requireApproval: options.requireApproval ?? false,
        approved: options.approve ?? false,
        validationCommands,
        recipeContext: {
          recipeId: definition.id,
          recipeName: definition.name,
          stepId: step.id,
          stepTitle: step.title
        }
      });

      console.log(result.summary);
      console.log(`Recipe: ${definition.id} (${definition.name})`);
      console.log(`Step: ${step.id} (${step.title})`);
      console.log(`Run: ${result.runId}`);
      console.log(`Mode: ${result.mode}`);
      console.log(`Adapter: ${result.adapter.name} (${result.adapter.displayName})`);
      console.log(`Strategy: ${result.policy.strategy}`);
      console.log(`Decision: ${result.decision.reason}`);
      console.log(result.plan ? `Plan: ${result.plan.reason} (${result.plan.tasks.length} task(s))` : "Plan: skipped");
      if (result.validation) {
        for (const line of renderValidationSummaryLines(result.validation)) {
          console.log(line);
        }
      }
      if (result.approval) {
        for (const line of renderApprovalSummaryLines(result.approval)) {
          console.log(line);
        }
      }
      console.log(`Ledger: ${result.ledgerPath}`);
    });

  const workflow = recipe.command("workflow").description("Run and inspect recipe-wide workflows.");

  workflow
    .command("run")
    .description("Run a full recipe workflow sequentially.")
    .argument("<recipe-id>", "Recipe id to run.")
    .argument("<prompt>", "Prompt to execute for each workflow step.")
    .option("--adapter <adapter>", "Agent adapter to use.", "mock")
    .option("--ledger-root <path>", "Override the normal step run ledger root.")
    .option("--workflow-ledger-root <path>", "Override the recipe workflow ledger root.")
    .option("--tasks", "Force task-list execution for modes that support it.")
    .option(
      "--require-approval-step <step-id>",
      "Require approval for a specific workflow step. Can be repeated.",
      collectValues,
      []
    )
    .option("--validate-command <json-argv>", "Validation command as a JSON argv array. Can be repeated.", collectValues, [])
    .option("--validation-timeout-ms <ms>", "Validation command timeout in milliseconds.")
    .action(async (recipeId: string, prompt: string, options: RecipeWorkflowRunOptions) => {
      const adapter = parseAdapter(options.adapter ?? "mock");
      const validationCommands = parseValidationCommands({
        values: options.validateCommand,
        timeoutMs: options.validationTimeoutMs
      });
      const result = await new RecipeWorkflowRunner().run({
        recipeId,
        prompt,
        adapter,
        ledgerRoot: options.ledgerRoot,
        workflowLedgerRoot: options.workflowLedgerRoot,
        forceTasks: options.tasks ?? false,
        requireApprovalSteps: options.requireApprovalStep ?? [],
        validationCommands
      });

      printWorkflowResult(result.workflow, result.ledgerPath);
    });

  workflow
    .command("show")
    .description("Show a recipe workflow run.")
    .argument("<workflow-run-id>", "Workflow run id to show.")
    .option("--workflow-ledger-root <path>", "Override the recipe workflow ledger root.")
    .action(async (workflowRunId: string, options: RecipeWorkflowShowOptions) => {
      const result = await new RecipeWorkflowRunner().show(workflowRunId, options.workflowLedgerRoot);
      printWorkflowResult(result.workflow, result.ledgerPath, true);
    });

  workflow
    .command("resume")
    .description("Resume a recipe workflow paused for approval.")
    .argument("<workflow-run-id>", "Workflow run id to resume.")
    .option("--ledger-root <path>", "Override the normal step run ledger root.")
    .option("--workflow-ledger-root <path>", "Override the recipe workflow ledger root.")
    .option("--adapter <adapter>", "Agent adapter to use.", "mock")
    .option("--tasks", "Force task-list execution for modes that support it.")
    .option("--approve", "Approve the pending workflow step.")
    .option("--validate-command <json-argv>", "Validation command as a JSON argv array. Can be repeated.", collectValues, [])
    .option("--validation-timeout-ms <ms>", "Validation command timeout in milliseconds.")
    .action(async (workflowRunId: string, options: RecipeWorkflowResumeOptions) => {
      const adapter = parseAdapter(options.adapter ?? "mock");
      const validationCommands = parseValidationCommands({
        values: options.validateCommand,
        timeoutMs: options.validationTimeoutMs
      });
      const result = await new RecipeWorkflowRunner().resume({
        workflowRunId,
        ledgerRoot: options.ledgerRoot,
        workflowLedgerRoot: options.workflowLedgerRoot,
        adapter,
        forceTasks: options.tasks ?? false,
        approve: options.approve ?? false,
        validationCommands
      });

      printWorkflowResult(result.workflow, result.ledgerPath);
    });
}

function parseAdapter(value: string): AgentAdapterName {
  if (!isAgentAdapterName(value)) {
    throw new Error(`Unknown adapter "${value}". Available adapters: ${availableAgentAdapterNames()}.`);
  }
  return value;
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function printWorkflowResult(workflow: RecipeWorkflowRun, ledgerPath: string, includeSteps = false): void {
  const completed = workflow.steps.filter((step) => step.status === "completed").length;
  const failed = workflow.steps.filter((step) => step.status === "failed").length;
  const pending = workflow.steps.filter((step) => step.status === "pending").length;

  console.log(`Recipe workflow: ${workflow.status}`);
  console.log(`Recipe: ${workflow.recipeId}`);
  console.log(`Steps: ${completed} completed, ${failed} failed, ${pending} pending`);
  console.log(`Context: ${workflow.contextEntryCount} entr${workflow.contextEntryCount === 1 ? "y" : "ies"}`);
  console.log(`State: ${workflow.stateFactCount} fact${workflow.stateFactCount === 1 ? "" : "s"}, ${workflow.stateArtifactCount} artifact${workflow.stateArtifactCount === 1 ? "" : "s"}`);
  if (workflow.currentStepId) {
    console.log(`Current step: ${workflow.currentStepId}`);
  }
  const pendingStep = workflow.steps.find((step) => step.status === "needs_input");
  if (pendingStep?.runId) {
    console.log(`Pending run: ${pendingStep.runId}`);
    console.log(`Next: open-kitchen recipe workflow resume ${workflow.workflowRunId} --approve`);
  }
  console.log(`Workflow: ${workflow.workflowRunId}`);
  if (includeSteps) {
    for (const step of workflow.steps) {
      console.log(`${step.stepIndex}. ${step.stepId} [${step.mode}] ${step.status}${step.runId ? ` ${step.runId}` : ""}`);
    }
  }
  console.log(`Ledger: ${ledgerPath}`);
}
