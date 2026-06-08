# OpenKitchen

OpenKitchen is a local-first CLI for running AI coding workflows through clear
modes, then inspecting what happened through a local ledger.

In daily use, it looks like this:

```powershell
ok prep --instant --adapter codex-cli "Summarize the README and CLI structure in 5 bullets"
ok last
ok show <run-id>
ok logs <run-id> --provider
```

## What OpenKitchen Is

OpenKitchen gives AI coding work a small set of explicit modes:

- `prep`: inspect a repository and gather context.
- `cook`: implement a focused change.
- `taste`: review, validate, and test work.
- `banquet`: split work across multiple perspectives.

It wraps provider-backed coding agents such as Codex CLI, Claude Code, and
Ollama behind one command surface. Each run writes a local filesystem ledger with
the selected mode, decision, provider output, repository context, validation
evidence, events, and artifacts.

OpenKitchen is not an autonomous agent runtime. It is a local workflow layer for
making coding-agent work easier to run, compare, inspect, and explain.

Korean README: [README.ko.md](./README.ko.md)

## Why It Exists

AI coding sessions can be hard to track:

- prompts disappear into chat history
- provider output can be long and noisy
- tool calls are hard to compare across runs
- quick daily checks need a faster path than deep repository exploration
- QA needs a readable way to see what happened after a run

OpenKitchen focuses on operational clarity:

- short `ok` commands for daily work
- explicit mode and strategy decisions
- local run ledgers
- provider-neutral records
- prompt-aware repository context for fast Prep runs
- validation, approval, and QA evidence
- compact reader commands for recent runs

## Quick Start

## Install Manually

Install and build:

```bash
npm install
npm run build
npm link
```

Check the CLI:

```bash
ok --help
ok modes
```

Run a safe mock Prep workflow:

```bash
ok prep --adapter mock "inspect this repo"
```

Inspect the latest run:

```bash
ok last
```

Manual installation is the primary path. It keeps the setup explicit and easy to
debug.

## Install With An AI Coding Agent

You can also ask any coding agent to install and verify OpenKitchen for you, as
long as it can execute shell commands, clone repositories, and run npm commands.

This can work with Codex CLI, Claude Code, OpenCode, Cursor, Gemini CLI, Aider,
Qwen Code, Kimi K2, local Ollama workflows, and future coding agents.

OpenKitchen is provider-neutral. Examples often use Codex CLI because it was
commonly available during development, but OpenKitchen is designed to work with
multiple coding agents and local models. Current provider adapters include
Codex CLI, Claude Code, and Ollama.

Copy this prompt into your agent:

```text
Install OpenKitchen from this repository:

https://github.com/hmmwtf/open-kitchen-cli

Please do the following safely:

1. Clone the repository.
2. Run npm install.
3. Run npm run build.
4. Link the CLI locally with npm link.
5. Verify:
   - ok --help
   - ok modes
   - ok prep --adapter mock "inspect this repo"
6. Do not run live provider-backed commands unless I explicitly ask.
7. Do not commit or push anything.
8. Report the installed path, verification results, and any errors.
```

For Windows PowerShell, the agent may use:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd link
ok --help
ok modes
ok prep --adapter mock "inspect this repo"
```

After that, try:

```powershell
ok prep --instant --adapter mock "inspect this repo"
ok last
ok show <run-id>
ok logs <run-id> --provider
```

## Daily Use

The recommended daily path is `prep --instant` when you want a quick,
context-only answer:

```powershell
ok prep --instant --adapter codex-cli "README and CLI structure in 5 bullets"
```

Use the other mode shortcuts for the rest of the workflow:

```bash
ok prep "inspect this repo"
ok cook "implement this feature"
ok taste "review and test this change"
ok banquet "split this across multiple perspectives"
```

Set a default adapter when dogfooding with a local provider:

```powershell
$env:OPEN_KITCHEN_DEFAULT_ADAPTER="codex-cli"
ok prep --instant "README and CLI structure in 5 bullets"
```

The mode shortcuts are thin wrappers around `run --mode ...`, so ledger behavior
is the same:

```bash
open-kitchen prep "inspect this repo"
npm run dev -- run --mode prep "inspect this repo"
```

## Instant Mode

`--instant` is the low-latency Prep path for short daily questions.

```powershell
ok prep --instant --adapter codex-cli "Summarize this project for Discord"
```

Instant mode is provider-backed but context-only:

- it uses the OpenKitchen repository context supplied to the provider
- it strongly discourages shell commands and extra file reads
- it targets sub-10s responses, but does not guarantee them
- it may say context is insufficient instead of exploring further

Prep instant includes prompt-aware context anchors. OpenKitchen selects compact
anchors based on the prompt:

- README and CLI questions anchor `README.md`, `package.json`, and CLI entry
  files.
- architecture questions anchor architecture and core files.
- provider questions anchor adapter files.
- Repository Context Map questions anchor repository-map files.
- bug-analysis questions use bug anchor pairs: implementation files plus related
  tests.

Use the default path when deeper evidence matters:

```powershell
ok prep --adapter codex-cli "Analyze this repo with evidence"
```

Use `--fast` when you want shallow provider-backed exploration but not strict
context-only behavior:

```powershell
ok prep --fast --adapter codex-cli "Quickly inspect this repo structure"
```

### Default vs Fast vs Instant

| Mode | Best for | Behavior |
| --- | --- | --- |
| default | deeper evidence and broad repository analysis | Allows normal provider exploration and may take longer. |
| `--fast` | shallow provider-backed checks | Reduces context and encourages concise answers, but still allows limited exploration. |
| `--instant` | daily summaries and quick QA | Context-only, prompt-aware anchors, command count should usually stay at zero. |

## Ledger Inspection

Every normal run writes a local ledger under `.open-kitchen/runs/`.

Use the shortcut readers after QA or dogfooding:

```bash
ok last
ok show <run-id>
ok show <run-id> --no-answer
ok show <run-id> --full
ok logs <run-id>
ok logs <run-id> --provider
```

`ok show` prints a compact summary:

- run id
- mode
- adapter
- status
- strategy
- ledger path
- provider duration and timeout when available
- RepoMap files and symbols
- output size
- command counts
- final answer preview

`ok logs` prints a readable event timeline and compresses noisy provider stream
chunks by default.

The lower-level ledger commands are still available:

```bash
ok ledger list
ok ledger show <run-id>
```

## QA Workflow

A typical default vs fast vs instant QA loop:

```powershell
$env:OPEN_KITCHEN_PROVIDER_TIMEOUT_MS="15000"

ok prep --adapter codex-cli "README and CLI structure in 5 bullets"
ok prep --fast --adapter codex-cli "README and CLI structure in 5 bullets"
ok prep --instant --adapter codex-cli "README and CLI structure in 5 bullets"

ok last
ok show <run-id>
ok logs <run-id> --provider
```

Compare:

- total latency
- provider duration
- command count
- blocked or failed commands
- raw output size
- final answer length
- RepoMap budget and included symbols
- whether instant stayed context-only
- whether the answer is acceptable for shallow daily use

## What Works Today

Implemented today:

- mode shortcuts: `chef`, `prep`, `cook`, `taste`, and `banquet`
- package bin alias: `ok`
- mode recommendation and decision records
- direct, planned, and mock parallel execution policies
- Provider Adapter Layer for `mock`, Codex CLI, Claude Code, and Ollama
- provider diagnostics and explicit smoke checks
- Prep Repository Context Map
- Prep `--instant` with prompt-aware anchors
- bug anchor pairs for implementation and test context
- `--fast` and `--instant` provider-backed Prep paths
- filesystem run ledgers
- ledger inspection shortcuts: `ok last`, `ok show`, and `ok logs`
- validation evidence and local validation command runner
- approval resume
- built-in recipes and sequential recipe workflows
- workflow context and workflow state records
- RepoMap evaluation helper scripts

## Not Yet

OpenKitchen is still early. The following are not implemented or remain limited:

- real planner beyond the deterministic Planner Stub
- real Banquet worker isolation and merge handling
- automatic handoff execution
- external recipe files
- rich recipe variables, templates, and conditions
- web UI
- desktop UI
- MCP integration
- memory system
- database persistence
- plugin system
- guaranteed sub-10s provider responses
- guaranteed provider obedience to no-command instructions

`mock` remains the default adapter. Provider-backed runs depend on local provider
setup and authentication.

## Documentation

- [CLI Reference](./docs/CLI.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Modes](./docs/MODES.md)
- [Recipes](./docs/RECIPES.md)
- [Product Positioning](./PRODUCT.md)
