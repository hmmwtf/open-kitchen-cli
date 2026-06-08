# OpenKitchen Architecture

OpenKitchen is a local-first orchestration core exposed through a CLI.

The CLI is the current backend/core interface. Future web or desktop interfaces
should call the same core modules instead of duplicating orchestration logic.

## Current Run Lifecycle

Normal runs:

```text
CLI input
-> mode loaded from Mode Registry
-> adapter resolved from Provider Adapter Registry
-> filesystem run ledger initialized
-> Mode Recommendation Engine records recommended vs selected mode
-> Decision Engine creates a structured explanation
-> policy resolved from the decision
-> Planner Stub runs or is skipped
-> tasks are written
-> Mock Agent Adapter executes tasks
-> Banquet record is written when the mode is banquet
-> Validation Engine records evidence and optional command results
-> Approval Gate may pause the run
-> result and artifacts are written to the ledger
```

Recipe workflow runs add an outer workflow runner:

```text
recipe workflow run
-> workflow ledger initialized
-> each recipe step starts a normal run
-> later step prompts receive Workflow State v2 when state exists
-> completed steps append Workflow Context v1 entries
-> completed steps update Workflow State v2
-> approval-gated steps may pause the workflow
-> workflow resume approves the pending run and continues remaining steps
```

## Components

### Mode Registry

The Mode Registry defines the available runtime modes:

- Chef
- Prep
- Cook
- Taste
- Banquet

Modes are runtime policy contracts. They are not agents.

### Mode Recommendation Engine

The Mode Recommendation Engine records the recommended mode for the prompt, the
selected mode, confidence, signals, alternatives, and whether the selected mode
is an override.

Recommendations are advisory. They do not switch the selected mode.

### Decision Engine and Policy Resolver

The Decision Engine records why OpenKitchen selected direct execution, task
generation, or parallel task execution.

The Policy Resolver turns that decision into execution policies consumed by the
planner, executor, validation, and approval layers.

### Planner Stub

The Planner Stub is deterministic. It only runs when the resolved policy requires
tasks.

Direct runs skip the planner and record `planner.skipped`.

### Handoff Recommendation

Handoffs are recommendations only. They include a target mode, reason, confidence
level, next command, and `autoExecute: false`.

OpenKitchen does not automatically switch modes.

### Provider Adapter Registry

The adapter registry currently exposes:

- `mock`
- `codex-cli`
- `claude-code`
- `ollama`

`mock` is deterministic and remains the default. `codex-cli` and `claude-code`
run provider CLIs as subprocesses. `ollama` calls the local Ollama HTTP API.

### Provider Diagnostics

Provider diagnostics expose adapter setup health outside normal runs:

- `open-kitchen adapters list`
- `open-kitchen adapters check <adapter>`

Default checks inspect installation, auth observability, model configuration,
Windows shim behavior, and adapter capabilities. Provider smoke tests are
explicit-only with `--smoke`.

Provider health records are separate from run ledgers and are written under
`.open-kitchen/provider-checks/`.

### Executor and Banquet

The executor runs direct work or task lists through the selected adapter.

Banquet uses deterministic mock parallelism: worker tasks are assigned, executed
through the mock adapter, checked for conflicts, and reconciled into a Banquet
record. This records real ledger structure for parallelism, but not real worker
isolation or merge behavior.

### Validation

The Validation Engine records validation status, gate status, evidence, checks,
and artifacts. It can also run configured local validation commands.

Validation commands are JSON argv arrays passed with `--validate-command`.
Multiple commands may be supplied, and `--validation-timeout-ms` sets a shared
positive timeout.

### Approval Resume

Approval-gated runs pause with `needs_input` until resumed with `--approve`.

Top-level `open-kitchen resume` approves a single pending run. Recipe workflow
resume approves the pending workflow step and then continues the remaining
workflow steps.

### Recipe System and Workflow Runner

Recipes define reusable ordered mode workflows. OpenKitchen supports both:

- explicit single-step recipe runs
- full sequential recipe workflows

Recipe workflows are separate ledger records under
`.open-kitchen/recipe-workflows/`.

### Workflow Context v1 and Workflow State v2

Workflow Context v1 is append-only audit history stored in `context.json`. It
records step result entries, agent output entries, validation summaries, and
Banquet summaries. It is useful for ledger history and debugging.

Workflow State v2 is a normalized compact snapshot stored in `state.json`. It
contains stable sections for completed steps, artifact refs, facts, validation
summaries, Banquet summaries, and `lastCompletedStepId`.

Later workflow step prompts consume Workflow State v2, not the full v1 context
entry list. This keeps prompt input deterministic and compact while preserving
full v1 history.

### Filesystem Ledger

The filesystem ledger records run state, decisions, plans, tasks, events,
artifacts, validation, approvals, and results.

## Ledger Files

A normal run directory may contain:

```text
.open-kitchen/
  runs/
    <run-id>/
      run.json
      prompt.txt
      mode-recommendation.json
      decision.json
      policy.json
      plan.json
      tasks.json
      banquet.json
      validation.json
      validation-evidence.json
      approval.json
      events.jsonl
      result.json
      result.md
      artifacts/
        agent-output-*.md
        banquet-reconciliation.md
        validation-report.md
        validation-command-*-stdout.txt
        validation-command-*-stderr.txt
```

Common normal run files:

- `run.json`: run metadata, selected mode, adapter, status, and optional recipe
  context.
- `prompt.txt`: prompt sent to the run.
- `mode-recommendation.json`: recommended mode, selected mode, signals, and
  alternatives.
- `decision.json`: structured execution decision.
- `policy.json`: resolved execution policy.
- `plan.json`: optional Planner Stub output.
- `tasks.json`: generated task list.
- `banquet.json`: Banquet worker, conflict, and reconciliation record.
- `validation.json`: validation result and optional command results.
- `validation-evidence.json`: validation evidence records.
- `approval.json`: approval gate state when approval is involved.
- `events.jsonl`: append-only lifecycle events.
- `result.json`: machine-readable final result.
- `result.md`: human-readable final result.
- `artifacts/`: mock agent outputs, validation artifacts, command output
  artifacts, and Banquet reconciliation artifacts.

A recipe workflow directory contains:

```text
.open-kitchen/
  recipe-workflows/
    <workflow-run-id>/
      workflow.json
      steps.json
      context.json
      state.json
      result.json
      result.md
      events.jsonl
```

A provider health check directory contains:

```text
.open-kitchen/
  provider-checks/
    <check-id>/
      check.json
      result.md
      events.jsonl
      artifacts/
```

Workflow files:

- `workflow.json`: full workflow run metadata.
- `steps.json`: ordered step run status.
- `context.json`: Workflow Context v1 append-only history.
- `state.json`: Workflow State v2 compact state snapshot.
- `result.json`: machine-readable workflow result.
- `result.md`: human-readable workflow result with state counts.
- `events.jsonl`: append-only workflow lifecycle events.

Common event types include:

- `run.started`
- `adapter.selected`
- `mode.recommended`
- `decision.made`
- `policy.resolved`
- `planner.skipped`
- `planner.completed`
- `tasks.generated`
- `agent.completed`
- `banquet.reconciled`
- `validation.command.completed`
- `validation.completed`
- `approval.pending`
- `approval.approved`
- `run.completed`
- `recipe.workflow.state.initialized`
- `recipe.workflow.state.attached`
- `recipe.workflow.state.updated`

## Provider Boundary

Still deterministic or stubbed:

- task planning
- Banquet worker coordination and reconciliation semantics
- validation/review semantics
- approval gates
- handoff execution

Provider adapters can invoke real local provider surfaces, but MCP, memory,
database persistence, web UI, desktop UI, and plugins are not included.

## Deferred Architecture

Deferred:

- provider adapter hardening
- provider-specific configuration guidance
- provider smoke-test workflows
- external recipe loading
- richer recipe variables, templates, and conditions
- real Banquet worker isolation and merge handling
- capability validation
- MCP
- memory
- database persistence
- web UI
- desktop UI
- plugin system
