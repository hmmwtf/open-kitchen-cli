# OpenKitchen Product Positioning

OpenKitchen is a **local-first CLI for mode-based AI coding workflows with
inspectable run ledgers**.

It gives everyday AI coding work a small command surface:

```powershell
ok prep --instant --adapter codex-cli "Summarize this repository"
ok last
ok show <run-id>
ok logs <run-id> --provider
ok stats --limit 50
```

OpenKitchen is in early dogfooding. The default adapter is `mock`, and
provider-backed runs depend on local setup for Codex CLI, Claude Code, or
Ollama.

## Position

OpenKitchen turns AI coding work into structured local runs.

Each run should make it easy to answer:

- which mode handled the request
- why a strategy was selected
- which adapter ran
- what repository context was supplied
- what the provider or mock adapter produced
- whether commands were completed, failed, or blocked
- what validation evidence was collected
- whether approval was required
- where the durable ledger record lives

The product goal is operational clarity: AI coding work should leave a local
record that a person, team, or future tool can inspect.

## Focus Pillars

**Mode-first daily workflow**

OpenKitchen exposes practical mode shortcuts: `prep`, `cook`, `taste`, and
`banquet`. These are not prompt personas. They are runtime policy contracts that
shape how work should be handled.

**Fast Prep for daily questions**

`ok prep --instant` is the primary low-latency daily workflow. It is
provider-backed but context-only, uses prompt-aware anchors, and strongly
discourages shell commands or extra file reads. It targets quick answers, not
exhaustive evidence.

**Prompt-aware repository context**

Prep instant selects compact anchors based on the prompt. README/CLI,
architecture, provider, RepoMap, pitch, and bug-analysis questions receive
different context. The current system includes purpose-built evidence cards for
important-files, technical-debt, and run-command questions, plus
implementation/test anchor pairs for domain-specific bug analysis.

**Ledger-first accountability**

OpenKitchen treats the ledger as a product primitive. Decisions, policies,
tasks, provider metadata, events, results, validation evidence, approval state,
and artifacts are written to local files so runs can be audited later.

**Reader surface after execution**

`ok last`, `ok show <run-id>`, `ok logs <run-id>`, and `ok stats` make
dogfooding and QA faster. Users should not need to manually open `result.json`,
`result.md`, and `events.jsonl` for every run.

`ok stats` turns recent ledger runs into product-level signals: completion
rate, timeout rate, provider duration, command count, adapter grouping,
prompt-category grouping, and instant quality proxies.

**Provider-neutral execution**

OpenKitchen separates workflow structure from provider choice. The same mode and
ledger concepts should work across mock execution, Codex CLI, Claude Code,
Ollama, and future adapters.

## Differentiation From Agent Harness Tools

Agent harness tools optimize agent capability: tool access, hooks, skills,
background execution, model routing, IDE integration, and coding throughput.
They make agents stronger and more autonomous.

OpenKitchen optimizes workflow readability and accountability: short mode
commands, structured decisions, prompt-aware context, local audit history,
validation evidence, and provider-neutral execution records.

These layers are complementary. A harness can be one execution surface behind
OpenKitchen, but OpenKitchen's value is the workflow and ledger around the work.

## What OpenKitchen Is Not

OpenKitchen is not:

- an autonomous coding agent runtime
- a model provider
- a full IDE
- a web UI or desktop UI
- an MCP platform
- a memory system
- a database-backed product
- a plugin marketplace
- a tool that guarantees sub-10s provider responses
- a tool that guarantees providers always obey no-command instructions

OpenKitchen intentionally keeps workflow visible. The product bet is that
serious AI coding work benefits from explicit modes, durable records,
validation, and human approval boundaries.

## Target Users

OpenKitchen is for:

- solo builders who want local history for AI coding workflows
- maintainers who need auditable AI-assisted runs
- engineers comparing provider-backed coding tools without losing process
  consistency
- teams experimenting with repeatable AI development processes
- tool builders who want a small local orchestration core

## Current Status

Implemented today:

- `ok` alias and mode shortcuts
- default, `--fast`, and `--instant` Prep paths
- prompt-aware anchors for Prep instant
- Important Files, Technical Debt, and Run Command Evidence cards
- bug implementation/test anchor pairs for Prep instant
- provider adapters for `mock`, Codex CLI, Claude Code, and Ollama
- provider diagnostics and explicit smoke checks
- local filesystem run ledgers
- ledger inspection and stats shortcuts
- validation evidence and local validation commands
- approval resume
- built-in recipes and sequential recipe workflows
- Prep Repository Context Map

Still limited or deferred:

- deterministic Planner Stub instead of a real planner
- mock Banquet parallelism instead of real worker isolation and merge handling
- built-in recipes only
- no automatic handoff execution
- no web UI or desktop UI
- no MCP, memory, database persistence, or plugin system

## Near-term Roadmap

Near-term work should reinforce the positioning:

- document provider setup and troubleshooting
- keep README and CLI docs aligned with implemented behavior
- harden provider adapter diagnostics
- improve ledger reader surfaces
- support external recipe files
- harden Banquet worker isolation and reconciliation
- add optional UI only over the existing core, not as a replacement for it
