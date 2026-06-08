# OpenKitchen Modes

A mode is a runtime policy contract. It is not an agent and not just a prompt
preset.

Modes determine how a request should be handled: direct execution, task planning,
parallel execution, validation, approval, or handoff recommendation.

## Current Mode Registry

| Mode | Purpose | Current Behavior |
| --- | --- | --- |
| Chef | Default orchestration | Direct execution by default; may use tasks or approval; may recommend handoff |
| Prep | Context and readiness | Mock inspection/readiness execution with read/evidence-first policies |
| Cook | Focused implementation | Mock implementation execution with validation-aware policy support |
| Taste | Validation and review | Mock validation/review execution with review-gated behavior |
| Banquet | Multi-agent parallel execution | Deterministic mock parallel task execution and reconciliation |

## Recommendation, Decision, and Policy

OpenKitchen separates recommendation from execution.

The Mode Recommendation Engine records:

- recommended mode
- selected mode
- confidence
- signals
- alternatives
- whether the selected mode is an override

The Decision Engine records why the selected mode uses direct execution, task
generation, or parallel task execution. The Policy Resolver turns that decision
into policies consumed by planning, execution, validation, and approvals.

Selecting or recommending a mode never causes automatic mode switching.

## Mode Details

### Chef

Chef is the default orchestration mode.

Current behavior:

- Direct execution when no task or parallel trigger is detected.
- Task-list execution when `--tasks` or task-splitting language is used.
- Approval-gated execution when `--require-approval` is passed.
- Handoff recommendations for prompts that look better suited to Prep, Cook,
  Taste, or Banquet.

Chef must not become a mandatory planning gate.

### Prep

Prep is the context and readiness mode.

Current behavior:

- Executes through the selected adapter.
- Represents inspection and context gathering.
- Generates a Repository Context Map for TypeScript and JavaScript files.
- Uses read/evidence-first policy concepts.
- RepoMap is an MVP: it extracts imports, exports, symbols, and rankings, but it
  is not a full semantic repository analyzer.

### Cook

Cook is the focused implementation mode.

Current behavior:

- Executes through the mock adapter.
- Represents implementation work.
- Supports validation-aware policy concepts.
- Does not edit code through a real provider yet.

### Taste

Taste is the validation and review mode.

Current behavior:

- Executes through the mock adapter.
- Represents review and validation.
- Uses evidence-first and review-gated policy concepts.
- Can record validation evidence and run local validation commands.

Taste does not perform real agentic review yet.

### Banquet

Banquet is the multi-agent parallel execution mode.

Current behavior:

- Always resolves to parallel task execution.
- Planner Stub creates deterministic worker tasks.
- Worker tasks execute through the mock adapter.
- Conflicts and reconciliation are recorded in Banquet ledger data.
- Validation can include Banquet reconciliation evidence.

Banquet has real mock parallel ledger structure, but no real worker isolation,
merge handling, or provider-backed reconciliation yet.

Banquet is not a packaging mode.

## Handoff Recommendations

Handoffs are recommendation-only.

A handoff records:

- source mode
- target mode
- reason
- confidence
- suggested next command
- `autoExecute: false`

OpenKitchen never runs the recommended mode automatically.

Example:

```bash
npm run dev -- run "inspect the current project"
```

Chef may recommend Prep, but the run remains a Chef run unless the user
explicitly runs the suggested command.

## Validation Commands

Validation commands are local commands passed as JSON argv arrays:

```powershell
npm run dev -- run --mode taste --validate-command "[\"npm.cmd\",\"run\",\"typecheck\"]" "review this project"
```

On non-Windows shells, substitute `npm` for `npm.cmd`.

Repeat `--validate-command` for multiple commands. Use
`--validation-timeout-ms` to set the command timeout.

Validation command results are written to `validation.json`, validation evidence,
events, and command stdout/stderr artifacts when present.

## Approval

Modes that allow approval-gated policy can pause a run:

```bash
npm run dev -- run --require-approval "coordinate this change"
```

Resume the pending run:

```bash
npm run dev -- resume <run-id> --approve
```

Recipe workflow approval uses a separate workflow resume command:

```bash
npm run dev -- recipe workflow resume <workflow-run-id> --approve
```

Top-level resume approves a single pending run. It does not continue a paused
recipe workflow.

## Execution Policies

Current policy concepts:

- Direct execution.
- Planner-optional execution.
- Task-first execution.
- Parallel execution.
- Read-first behavior.
- Evidence-first behavior.
- Review-gated behavior.
- Approval-gated behavior.
- Handoff-enabled behavior.
- Validation-aware behavior.

`mock` remains the default adapter. Provider Adapter v1 also supports Codex CLI,
Claude Code, and Ollama when configured.
