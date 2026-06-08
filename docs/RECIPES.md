# OpenKitchen Recipes

A recipe is a reusable ordered workflow made of mode steps.

Recipes are first-class OpenKitchen concepts. They can run one explicit step, or
they can run a full sequential workflow through the Recipe Workflow Runner.

## Current Behavior

Current recipe behavior:

- built-in recipes only
- explicit single-step execution
- full sequential workflow execution
- workflow pause/resume for approval-gated steps
- Workflow Context v1 audit history
- Workflow State v2 deterministic state snapshot
- optional validation commands passed into validating workflow steps
- no external recipe files
- no variables
- no conditions
- no prompt templates
- no automatic handoff execution
- no provider-specific behavior

A recipe step is executed as a normal OpenKitchen run with recipe context
attached. A recipe workflow wraps multiple normal runs and writes a separate
workflow ledger.

## Built-In Recipes

Current built-in recipes:

```text
inspect-build-review
approve-build-review
```

`inspect-build-review`:

1. `prep`: Inspect context
2. `cook`: Implement change
3. `taste`: Review result

`approve-build-review`:

1. `approve`: Approve work
2. `cook`: Implement change
3. `taste`: Review result

Show a recipe:

```bash
npm run dev -- recipe show inspect-build-review
```

## Single-Step Recipe Runs

List recipes:

```bash
npm run dev -- recipe list
```

Run one explicit step:

```bash
npm run dev -- recipe run inspect-build-review --step prep "inspect this project"
```

Running a recipe without `--step` fails intentionally for single-step recipe
runs:

```bash
npm run dev -- recipe run inspect-build-review "inspect this project"
```

Use `recipe workflow run` when the intent is to execute the whole recipe.

## Recipe Workflow Runner

Run a full recipe workflow:

```bash
npm run dev -- recipe workflow run inspect-build-review "inspect build and review"
```

Show a workflow:

```bash
npm run dev -- recipe workflow show <workflow-run-id>
```

Workflow output includes:

- workflow status
- recipe id
- completed, failed, and pending step counts
- Workflow Context v1 entry count
- Workflow State v2 fact and artifact counts
- current step when paused
- workflow ledger path

Workflow ledgers are written under:

```text
.open-kitchen/recipe-workflows/<workflow-run-id>/
```

## Workflow Context v1 vs Workflow State v2

Workflow Context v1 is append-only audit history in `context.json`.

It records entries such as:

- step result summaries
- agent outputs, including output text
- validation summaries
- Banquet summaries

Workflow State v2 is the compact state snapshot in `state.json`.

It records stable sections for:

- completed steps
- artifact refs
- deterministic facts
- validation summaries
- Banquet reconciliation summaries
- `lastCompletedStepId`

Later workflow step prompts consume Workflow State v2. They do not consume the
full Workflow Context v1 entry list. Context v1 remains available for ledger
history and debugging.

## Validation Commands in Workflows

Validation commands use JSON argv arrays:

```powershell
npm run dev -- recipe workflow run inspect-build-review --validate-command "[\"npm.cmd\",\"run\",\"typecheck\"]" "inspect build and review"
```

On non-Windows shells, substitute `npm` for `npm.cmd`.

Multiple commands can be passed by repeating `--validate-command`:

```powershell
npm run dev -- recipe workflow run inspect-build-review --validate-command "[\"npm.cmd\",\"run\",\"typecheck\"]" --validate-command "[\"npm.cmd\",\"test\"]" "inspect build and review"
```

Set a shared timeout:

```powershell
npm run dev -- recipe workflow run inspect-build-review --validation-timeout-ms 180000 --validate-command "[\"npm.cmd\",\"run\",\"typecheck\"]" "inspect build and review"
```

Validation command results are recorded in step run ledgers. Completed validating
steps also add command counts to Workflow State v2 validation summaries.

## Approval-Gated Workflows

Run a workflow that requires approval for the `approve` step:

```bash
npm run dev -- recipe workflow run approve-build-review --require-approval-step approve "coordinate this change"
```

The workflow pauses with `needs_input` and prints a pending run plus the next
workflow resume command.

Resume the workflow:

```bash
npm run dev -- recipe workflow resume <workflow-run-id> --approve
```

Workflow resume approves the pending step, updates Workflow Context v1 and
Workflow State v2 for that step, and continues the remaining workflow steps.

Top-level `resume` is different:

```bash
npm run dev -- resume <run-id> --approve
```

Top-level resume approves a single pending run. It does not continue a paused
recipe workflow.

## Workflow Ledger

A workflow ledger contains:

```text
workflow.json
steps.json
context.json
state.json
result.json
result.md
events.jsonl
```

Normal step run ledgers remain under `.open-kitchen/runs/`.

## Recipe File Format

External recipe files are deferred, but the future shape is JSON.

Example:

```json
{
  "id": "inspect-build-review",
  "name": "Inspect, Build, Review",
  "description": "A simple Prep -> Cook -> Taste workflow.",
  "version": "0.1",
  "steps": [
    {
      "id": "prep",
      "mode": "prep",
      "title": "Inspect context",
      "description": "Gather project context before implementation."
    },
    {
      "id": "cook",
      "mode": "cook",
      "title": "Implement change",
      "description": "Apply the requested implementation."
    },
    {
      "id": "taste",
      "mode": "taste",
      "title": "Review result",
      "description": "Validate and review the result."
    }
  ]
}
```

Today recipes are built into the TypeScript codebase rather than loaded from
disk.

## Deferred Recipe Features

Deferred:

- loading recipe files from disk
- recipe variables
- prompt templates
- step conditions
- step dependencies
- recipe-specific provider selection
- richer workflow controls beyond sequential execution and approval resume
