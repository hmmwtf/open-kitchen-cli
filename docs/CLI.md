# OpenKitchen CLI Reference

This reference lists commands that are implemented today. OpenKitchen is in
early dogfooding: the default adapter is `mock`, and provider-backed runs depend
on local provider setup and authentication.

Use `npm run dev -- ...` while developing from the repository. After `npm run
build` and `npm link`, use either `open-kitchen` or the shorter `ok` alias.

On Windows, validation commands that invoke npm should usually use `npm.cmd`
inside JSON argv arrays. On non-Windows shells, use `npm`.

## Ledger Locations

| Record type | Default location | Override |
| --- | --- | --- |
| Normal runs | `.open-kitchen/runs/` | `--ledger-root <path>` |
| Recipe workflows | `.open-kitchen/recipe-workflows/` | `--workflow-ledger-root <path>` |
| Provider checks | `.open-kitchen/provider-checks/` | `adapters check --ledger-root <path>` |
| RepoMap evaluations | `output\repomap-eval\YYYY\MM\DD\HHmmss-<set>\` | script-defined |

## Daily Mode Shortcuts

Mode shortcuts are real commands and thin wrappers around `run --mode ...`.
They write the same run ledgers and print the same final summary as `run`.

```bash
ok chef "coordinate this change"
ok prep "inspect this repo"
ok cook "implement this feature"
ok taste "review and test this change"
ok banquet "split this across multiple perspectives"
```

Equivalent long form:

```bash
open-kitchen prep "inspect this repo"
npm run dev -- run --mode prep "inspect this repo"
```

Shortcut commands support the daily run options: `--adapter`, `--ledger-root`,
`--tasks`, `--require-approval`, `--approve`, `--fast`, `--instant`,
`--validate-command`, and `--validation-timeout-ms`.

Adapter priority:

```text
explicit --adapter
OPEN_KITCHEN_DEFAULT_ADAPTER
mock
```

Set a default provider adapter for local dogfooding:

```powershell
$env:OPEN_KITCHEN_DEFAULT_ADAPTER="codex-cli"
ok prep --instant "README and CLI structure in 5 bullets"
```

## Prep Latency Modes

Use `--instant` as the primary daily path for short, context-only Prep checks:

```powershell
ok prep --instant --adapter codex-cli "README and CLI structure in 5 bullets"
```

Use default Prep when deeper evidence matters:

```powershell
ok prep --adapter codex-cli "Analyze this repository with evidence"
```

Use `--fast` when you want shallow provider-backed exploration but not strict
context-only behavior:

```powershell
ok prep --fast --adapter codex-cli "Quickly inspect this repository structure"
```

| Mode | Best for | Behavior |
| --- | --- | --- |
| default | deeper evidence and broader repository analysis | Allows normal provider exploration and may take longer. |
| `--fast` | shallow provider-backed checks | Reduces context and asks for concise answers, but still allows limited exploration. |
| `--instant` | daily summaries and quick QA | Context-only, prompt-aware anchors, and command count should usually stay at zero. |

`--instant` targets low latency but does not guarantee sub-10s responses. It may
say context is insufficient instead of reading more files. Prompt-aware anchors
provide compact context for README/CLI, architecture, provider, RepoMap, pitch,
important-files, technical-debt, run-command, and bug-analysis prompts.

Current Prep instant evidence cards include:

- **Important Files Evidence** for canonical core-file questions.
- **Technical Debt Evidence** for implementation/test risk areas.
- **Run Command Evidence** for `run command`, `execution flow`, and mode
  shortcut flow questions. The output contract asks for exactly five
  evidence-backed steps.
- bug implementation/test pairs for domain-specific bug-analysis prompts.

## Core Commands

### `modes`

List the registered modes.

```bash
npm run dev -- modes
ok modes
```

### `recommend`

Ask the recommendation engine which mode fits a prompt. This is advisory only.

```bash
npm run dev -- recommend "inspect this repository"
npm run dev -- recommend --mode prep "inspect this repository"
```

### `run`

Run a prompt through a mode and adapter.

```bash
npm run dev -- run "summarize this repo"
npm run dev -- run --mode prep "inspect this repo"
npm run dev -- run --mode banquet "split this work across agents"
npm run dev -- run --adapter codex-cli --mode prep "inspect this repo"
npm run dev -- run --mode prep --instant --adapter codex-cli "summarize this repo in 5 bullets"
npm run dev -- run --ledger-root "output\manual-runs" "summarize this repo"
```

Important options:

| Option | Purpose |
| --- | --- |
| `--mode <mode>` | Select `chef`, `prep`, `cook`, `taste`, or `banquet`. |
| `--adapter <adapter>` | Select `mock`, `codex-cli`, `claude-code`, or `ollama`. |
| `--ledger-root <path>` | Store run records outside `.open-kitchen/runs/`. |
| `--tasks` | Force task-list execution where supported. |
| `--fast` | Prefer lower latency with less exhaustive provider-backed execution. |
| `--instant` | Use context-only, latency-first provider-backed execution; low-latency target, not guaranteed. |
| `--require-approval` | Pause completion until approved. |
| `--approve` | Approve a run that also requires approval. |
| `--validate-command <json-argv>` | Run a local validation command and record evidence. |
| `--validation-timeout-ms <ms>` | Set validation command timeout. |

Validation example:

```powershell
npm run dev -- run --mode taste --validate-command "[\"npm.cmd\",\"run\",\"typecheck\"]" "review this project"
```

### `resume`

Approve one pending top-level run.

```bash
npm run dev -- resume <run-id> --approve
npm run dev -- resume <run-id> --ledger-root "output\manual-runs" --approve
```

## Ledger Inspection Shortcuts

Use these commands after QA or dogfooding. They are read-only and avoid dumping
huge raw output by default.

### `last`

Show the latest valid normal run. Incomplete run directories are skipped.

```bash
ok last
ok last --ledger-root "output\manual-runs"
```

### `show`

Show a compact run summary.

```bash
ok show <run-id>
ok show <run-id> --no-answer
ok show <run-id> --full
ok show <run-id> --ledger-root "output\manual-runs"
```

`ok show` includes status, mode, adapter, strategy, provider duration/timeout,
RepoMap files/symbols, output size, command counts, and a final answer preview.

### `logs`

Show a readable event timeline.

```bash
ok logs <run-id>
ok logs <run-id> --provider
ok logs <run-id> --tail 20
ok logs <run-id> --raw
```

Provider stream chunks are compressed in normal output. Use `--raw` only when
you need original JSONL event lines.

### `stats`

Show recent local run statistics for QA and dogfooding.

```bash
ok stats
ok stats --limit 50
ok stats --json
ok stats --ledger-root "output\manual-runs"
```

`ok stats` reads recent valid runs, skips incomplete runs, and avoids dumping
raw provider output or final answer bodies. The default text output includes:

- summary metrics: run count, completion rate, timeout rate, average total and
  provider duration, average command count, output sizes, and runs over 14s
- grouping by adapter
- grouping by inferred prompt category
- instant quality proxies: inferred instant runs, zero-command rate, RepoMap
  truncation count, and average files/symbols

Use `--json` when another script or report needs parseable output.

### Direct Artifact Reads On Windows PowerShell 5.1

Prefer `ok show`, `ok logs`, and `ok stats` over manual artifact reads. When you
do inspect ledger artifacts directly on Windows PowerShell 5.1, pass explicit
UTF-8 encoding:

```powershell
Get-Content -Encoding UTF8 .open-kitchen\runs\<run-id>\result.json | ConvertFrom-Json
Get-Content -Encoding UTF8 .open-kitchen\runs\<run-id>\events.jsonl | ForEach-Object { $_ | ConvertFrom-Json }
```

Ledger JSON is written as valid UTF-8 without BOM. Node `JSON.parse` should be
treated as the source of truth for JSON validity. Windows PowerShell 5.1 may
misread BOM-less UTF-8 if `-Encoding UTF8` is omitted.

The lower-level ledger commands are still available:

```bash
npm run dev -- ledger list
npm run dev -- ledger show <run-id>
```

## Provider Commands

### `adapters list`

List provider adapters and capabilities.

```bash
npm run dev -- adapters list
```

### `adapters check`

Run provider diagnostics. Smoke tests only run when `--smoke` is passed.

```bash
npm run dev -- adapters check mock
npm run dev -- adapters check codex-cli --smoke
npm run dev -- adapters check ollama --timeout-ms 30000
npm run dev -- adapters check codex-cli --ledger-root "output\provider-checks"
```

## Recipe Commands

### `recipe list` and `recipe show`

```bash
npm run dev -- recipe list
npm run dev -- recipe show inspect-build-review
```

### `recipe run`

Run one explicit recipe step.

```bash
npm run dev -- recipe run inspect-build-review --step prep "inspect this project"
npm run dev -- recipe run inspect-build-review --step taste --validate-command "[\"npm.cmd\",\"run\",\"typecheck\"]" "review this project"
```

Important options match `run`: `--adapter`, `--ledger-root`, `--tasks`,
`--require-approval`, `--approve`, `--validate-command`, and
`--validation-timeout-ms`.

### `recipe workflow run`

Run all steps in a built-in recipe.

```bash
npm run dev -- recipe workflow run inspect-build-review "inspect build and review"
npm run dev -- recipe workflow run approve-build-review --require-approval-step approve "coordinate this change"
npm run dev -- recipe workflow run inspect-build-review --ledger-root "output\workflow-runs" --workflow-ledger-root "output\workflows" "inspect build and review"
```

### `recipe workflow show`

```bash
npm run dev -- recipe workflow show <workflow-run-id>
npm run dev -- recipe workflow show <workflow-run-id> --workflow-ledger-root "output\workflows"
```

### `recipe workflow resume`

Resume a workflow paused for approval.

```bash
npm run dev -- recipe workflow resume <workflow-run-id> --approve
npm run dev -- recipe workflow resume <workflow-run-id> --workflow-ledger-root "output\workflows" --approve
```

## QA Workflow

Daily dogfooding usually samples multiple Prep instant prompts and then inspects
the ledgers:

```powershell
$env:OPEN_KITCHEN_PROVIDER_TIMEOUT_MS="15000"

ok prep --instant --adapter codex-cli "Explain the Provider Adapter structure"
ok prep --instant --adapter codex-cli "Explain the ok prep execution flow in 5 steps"
ok prep --instant --adapter codex-cli "Find likely technical debt in this project"

ok show <run-id>
ok logs <run-id> --provider
ok stats --limit 50
```

For latency or quality tuning, compare default, fast, and instant Prep:

```powershell
ok prep --adapter codex-cli "README and CLI structure in 5 bullets"
ok prep --fast --adapter codex-cli "README and CLI structure in 5 bullets"
ok prep --instant --adapter codex-cli "README and CLI structure in 5 bullets"
```

Compare latency, command count, output size, RepoMap budget, included symbols,
whether instant stayed context-only, and the recent trend from `ok stats`.

## Evaluation Helpers

RepoMap evaluation helpers are shell scripts, not CLI subcommands. They run
Codex CLI Prep cases and store prompt, metadata, console logs, run ledgers, and
RepoMap artifacts under a date/time batch folder.

```powershell
.\scripts\run-repomap-eval.ps1 -Set quick
.\scripts\run-repomap-eval.ps1 -Set full
```

Output shape:

```text
output/
  repomap-eval/
    YYYY/
      MM/
        DD/
          HHmmss-quick/
            case-01/
              prompt.txt
              metadata.txt
              console.log
              <run-id>/
                result.md
                repo-map.json
                artifacts/
                  repo-map.md
```

## Implemented vs Deferred

Implemented today:

- mode shortcuts and `ok` alias
- mode listing and recommendation
- normal runs with mock and provider adapters
- default, `--fast`, and `--instant` Prep paths
- prompt-aware context anchors and bug anchor pairs for Prep instant
- provider diagnostics and explicit smoke checks
- recipe single-step runs and sequential workflows
- approval resume for runs and workflows
- validation evidence and local validation commands
- filesystem ledgers and ledger inspection shortcuts
- Prep Repository Context Map

Still deterministic, experimental, or deferred:

- Planner Stub semantics
- Banquet real worker isolation and merge handling
- external recipe file loading
- automatic handoff execution
- MCP, memory, database persistence, web UI, desktop UI, and plugins
