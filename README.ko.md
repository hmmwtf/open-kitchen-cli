# OpenKitchen

OpenKitchen은 AI 코딩 작업을 명확한 모드로 실행하고, 실행 결과를 로컬
ledger로 다시 확인할 수 있게 해주는 local-first CLI입니다.

일상 사용 흐름은 이렇게 생겼습니다:

```powershell
ok prep --instant --adapter codex-cli "README와 CLI 구조만 5줄로 요약해"
ok last
ok show <run-id>
ok logs <run-id> --provider
ok stats --limit 50
```

## OpenKitchen이란?

OpenKitchen은 AI 코딩 작업을 몇 가지 명시적인 모드로 다룹니다.

- `prep`: 레포를 살펴보고 맥락을 모읍니다.
- `cook`: 집중해서 기능이나 수정 사항을 구현합니다.
- `taste`: 변경 내용을 검토하고 검증합니다.
- `banquet`: 여러 관점으로 작업을 나누어 봅니다.

Codex CLI, Claude Code, Ollama 같은 provider-backed 코딩 에이전트를 하나의
명령어 표면 뒤에 감싸고, 각 실행을 로컬 파일시스템 ledger에 남깁니다.
ledger에는 선택된 모드, 실행 결정, provider 출력, repository context,
validation evidence, event, artifact가 기록됩니다.

OpenKitchen은 자율 에이전트 런타임이 아닙니다. AI 코딩 작업을 더 쉽게
실행하고, 비교하고, 검토하고, 설명하기 위한 로컬 workflow layer입니다.

English README: [README.md](./README.md)

## 왜 만들었나?

AI 코딩 세션은 금방 추적하기 어려워집니다.

- prompt가 채팅 기록 속으로 사라집니다.
- provider 출력이 길고 noisy할 수 있습니다.
- tool call을 run끼리 비교하기 어렵습니다.
- 짧은 daily check에 깊은 repository exploration은 너무 느릴 수 있습니다.
- QA 후에 무슨 일이 있었는지 빠르게 읽을 표면이 필요합니다.

OpenKitchen은 실행 능력 자체보다 운영 가시성에 집중합니다.

- 매일 쓰기 쉬운 짧은 `ok` 명령어
- 명시적인 mode와 strategy 결정 기록
- 로컬 run ledger
- provider-neutral record
- 빠른 Prep을 위한 prompt-aware repository context
- validation, approval, QA evidence
- 최근 run을 빠르게 읽는 reader command

## Quick Start

## 직접 설치하기

설치하고 빌드합니다:

```bash
npm install
npm run build
npm link
```

CLI를 확인합니다:

```bash
ok --help
ok modes
```

안전한 mock Prep workflow를 실행합니다:

```bash
ok prep --adapter mock "이 레포를 분석해"
```

가장 최근 run을 확인합니다:

```bash
ok last
```

직접 설치가 기본 경로입니다. 설치 과정을 명확하게 볼 수 있고 문제가 생겼을 때
디버깅하기 쉽습니다.

## AI Coding Agent로 설치하기

shell command 실행, repository clone, npm command 실행이 가능한 coding agent라면
어떤 agent에도 OpenKitchen 설치와 검증을 맡길 수 있습니다.

Codex CLI, Claude Code, OpenCode, Cursor, Gemini CLI, Aider, Qwen Code,
Kimi K2, local Ollama workflow, 그리고 앞으로 나올 coding agent에서도 같은 방식으로
사용할 수 있습니다.

OpenKitchen은 provider-neutral 도구입니다. 예시는 개발 과정에서 자주 사용한
Codex CLI를 포함하지만, OpenKitchen은 여러 coding agent와 local model을 함께
쓰기 위해 설계되었습니다. 현재 provider adapter는 Codex CLI, Claude Code,
Ollama를 지원합니다.

아래 프롬프트를 그대로 붙여넣으세요:

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

Windows PowerShell에서는 agent가 아래 명령을 사용할 수 있습니다:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd link
ok --help
ok modes
ok prep --adapter mock "inspect this repo"
```

설치 후에는 이렇게 확인해볼 수 있습니다:

```powershell
ok prep --instant --adapter mock "이 레포를 분석해"
ok last
ok show <run-id>
ok logs <run-id> --provider
```

## Daily Use

짧은 daily 질문에는 `prep --instant`를 기본 흐름으로 권장합니다.

```powershell
ok prep --instant --adapter codex-cli "README와 CLI 구조만 5줄로 요약해"
```

다른 작업은 mode shortcut으로 이어갑니다.

```bash
ok prep "이 레포를 분석해"
ok cook "이 기능을 구현해"
ok taste "검토하고 테스트해"
ok banquet "여러 관점으로 나눠서 돌려"
```

로컬 provider를 기본값으로 쓰고 싶다면 default adapter를 설정합니다.

```powershell
$env:OPEN_KITCHEN_DEFAULT_ADAPTER="codex-cli"
ok prep --instant "README와 CLI 구조만 5줄로 요약해"
```

mode shortcut은 `run --mode ...`의 얇은 wrapper입니다. 따라서 ledger 동작은
같습니다.

```bash
open-kitchen prep "이 레포를 분석해"
npm run dev -- run --mode prep "이 레포를 분석해"
```

## Instant Mode

`--instant`는 짧은 daily 질문을 위한 저지연 Prep 경로입니다.

```powershell
ok prep --instant --adapter codex-cli "Discord에 공유할 프로젝트 요약을 작성해"
```

Instant mode는 provider-backed이지만 context-only에 가깝게 동작하도록
유도합니다.

- OpenKitchen이 제공한 repository context를 우선 사용합니다.
- shell command와 추가 file read를 강하게 억제합니다.
- sub-10s 응답을 목표로 하지만 보장하지는 않습니다.
- context가 부족하면 더 탐색하지 않고 부족한 내용을 말할 수 있습니다.

Prep instant는 prompt-aware context anchors를 사용합니다. OpenKitchen은
prompt에 맞춰 작은 anchor를 선택합니다.

- README와 CLI 질문은 `README.md`, `package.json`, CLI entry file을 anchor로
  넣습니다.
- architecture 질문은 architecture 문서와 core file을 anchor로 넣습니다.
- provider 질문은 adapter file을 anchor로 넣습니다.
- Repository Context Map 질문은 repository-map file을 anchor로 넣습니다.
- 중요한 파일 질문은 canonical core file을 담은 **Important Files Evidence**를
  사용합니다.
- 기술 부채 질문은 compact한 구현/test risk pair를 담은
  **Technical Debt Evidence**를 사용합니다.
- run command와 shortcut flow 질문은 **Run Command Evidence**를 사용하고,
  근거 파일이 포함된 정확히 5단계 실행 흐름 답변을 유도합니다.
- bug 분석 질문은 domain이 감지되면 구현 파일과 관련 test file을 짝으로
  묶는 anchor pair를 사용합니다.

더 깊은 근거 확인이 필요하면 기본 경로를 사용합니다.

```powershell
ok prep --adapter codex-cli "근거 중심으로 이 레포를 분석해"
```

strict context-only는 아니지만 얕은 provider-backed 탐색을 원하면 `--fast`를
사용합니다.

```powershell
ok prep --fast --adapter codex-cli "이 레포 구조를 빠르게 분석해"
```

### Default vs Fast vs Instant

| 모드 | 적합한 상황 | 동작 |
| --- | --- | --- |
| default | 깊은 근거 확인과 넓은 repository 분석 | provider의 일반 탐색을 허용하며 더 오래 걸릴 수 있습니다. |
| `--fast` | 얕은 provider-backed 확인 | context를 줄이고 concise 답변을 유도하지만 제한적인 탐색은 허용합니다. |
| `--instant` | daily summary와 빠른 QA | context-only, prompt-aware anchors, command count 0을 지향합니다. |

## Ledger Inspection

일반 run은 `.open-kitchen/runs/` 아래에 로컬 ledger를 남깁니다.

QA나 dogfooding 후에는 reader shortcut을 사용합니다.

```bash
ok last
ok show <run-id>
ok show <run-id> --no-answer
ok show <run-id> --full
ok logs <run-id>
ok logs <run-id> --provider
ok stats
ok stats --limit 50
ok stats --json
```

`ok show`는 compact summary를 출력합니다.

- run id
- mode
- adapter
- status
- strategy
- ledger path
- provider duration과 timeout
- provider가 timeout되었지만 구조화된 final answer를 남겼는지 여부
- RepoMap files와 symbols
- output size
- command count
- final answer preview

`ok logs`는 event timeline을 읽기 쉽게 보여주고, noisy한 provider stream
chunk는 기본적으로 압축해서 표시합니다.

`ok stats`는 최근 local run을 요약합니다. completion/timeout rate, 평균
duration, command count, raw/final answer size, adapter별 grouping,
prompt category별 grouping, zero-command rate와 RepoMap truncation 같은
instant quality proxy를 보여줍니다. 또한 provider timeout을 구조화된 답변이
있는 timeout과 usable structured answer가 없는 timeout으로 나누어 보여줍니다.
그래서 실패로 기록된 run도 salvage 가능한 답변이 있는지 빠르게 확인할 수 있습니다.

낮은 수준의 ledger command도 그대로 사용할 수 있습니다.

```bash
ok ledger list
ok ledger show <run-id>
```

## QA Workflow

일상 dogfooding에서는 여러 Prep instant prompt를 샘플로 돌린 뒤 ledger
summary를 읽습니다.

```powershell
$env:OPEN_KITCHEN_PROVIDER_TIMEOUT_MS="15000"

ok prep --instant --adapter codex-cli "Provider Adapter 구조를 설명해"
ok prep --instant --adapter codex-cli "ok prep 실행 흐름을 5단계로 설명해"
ok prep --instant --adapter codex-cli "이 프로젝트에서 기술 부채가 생길 수 있는 부분을 찾아줘"

ok show <run-id>
ok logs <run-id> --provider
ok stats --limit 50
```

latency나 품질을 튜닝할 때는 default, fast, instant를 비교합니다.

```powershell
ok prep --adapter codex-cli "README와 CLI 구조만 5줄로 요약해"
ok prep --fast --adapter codex-cli "README와 CLI 구조만 5줄로 요약해"
ok prep --instant --adapter codex-cli "README와 CLI 구조만 5줄로 요약해"
```

비교할 항목:

- total latency
- provider duration
- timeout 중 구조화된 답변이 남았는지
- command count
- blocked 또는 failed command
- raw output size
- final answer length
- RepoMap budget과 included symbols
- instant가 context-only를 지켰는지
- 얕은 daily use에 답변 품질이 충분한지
- `ok stats`에서 보이는 최근 trend metric

## 지금 구현된 것

현재 구현된 기능:

- mode shortcut: `chef`, `prep`, `cook`, `taste`, `banquet`
- package bin alias: `ok`
- mode recommendation과 decision record
- direct, planned, mock parallel execution policy
- `mock`, Codex CLI, Claude Code, Ollama Provider Adapter Layer
- provider diagnostics와 explicit smoke check
- Prep Repository Context Map
- prompt-aware anchors가 포함된 Prep `--instant`
- Important Files, Technical Debt, Run Command, bug-analysis evidence card
- 구현 파일과 test context를 묶는 bug anchor pairs
- provider-backed Prep `--fast`, `--instant`
- filesystem run ledger
- ledger inspection shortcut: `ok last`, `ok show`, `ok logs`, `ok stats`
- validation evidence와 local validation command runner
- approval resume
- built-in recipes와 sequential recipe workflow
- workflow context와 workflow state record
- RepoMap evaluation helper script

## 아직 아닌 것

OpenKitchen은 아직 초기 단계입니다. 아래 항목은 구현되지 않았거나 제한적입니다.

- deterministic Planner Stub을 넘어선 실제 planner
- 실제 Banquet worker isolation과 merge handling
- automatic handoff execution
- external recipe files
- 풍부한 recipe variables, templates, conditions
- web UI
- desktop UI
- MCP integration
- memory system
- database persistence
- plugin system
- 보장된 sub-10s provider response
- provider가 no-command instruction을 항상 지킨다는 보장

기본 adapter는 여전히 `mock`입니다. provider-backed run은 로컬 provider 설정과
인증 상태에 의존합니다.

## 문서

- [CLI Reference](./docs/CLI.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Modes](./docs/MODES.md)
- [Recipes](./docs/RECIPES.md)
- [Product Positioning](./PRODUCT.md)
