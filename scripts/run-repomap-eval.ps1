param(
  [ValidateSet("quick", "full")]
  [string]$Set = "quick"
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$RepoRoot = (Get-Location).Path
$PackageJson = Join-Path $RepoRoot "package.json"
$SrcDir = Join-Path $RepoRoot "src"

if (-not (Test-Path $PackageJson) -or -not (Test-Path $SrcDir)) {
  Write-Error "Run this script from the OpenKitchen repository root."
  exit 1
}

$StartedAt = Get-Date
$DateRoot = Join-Path $RepoRoot ("output\repomap-eval\{0}\{1}\{2}" -f $StartedAt.ToString("yyyy"), $StartedAt.ToString("MM"), $StartedAt.ToString("dd"))
$Batch = "{0}-{1}" -f $StartedAt.ToString("HHmmss"), $Set
$EvalRoot = Join-Path $DateRoot $Batch
New-Item -ItemType Directory -Force -Path $EvalRoot | Out-Null

$QuickPrompts = @(
  "Analyze this repository at a high level. Do not modify files.",
  "Explain how an open-kitchen run command flows through the codebase from CLI parsing to ledger completion. Do not modify files.",
  "Explain the provider adapter architecture and where Codex CLI execution is isolated from the rest of OpenKitchen. Do not modify files."
)

$FullPrompts = @(
  "Analyze this repository at a high level. Do not modify files.",
  "Explain how an open-kitchen run command flows through the codebase from CLI parsing to ledger completion. Do not modify files.",
  "Explain the provider adapter architecture and where Codex CLI execution is isolated from the rest of OpenKitchen. Do not modify files.",
  "Explain how OpenKitchen turns a provider run into readable ledger outputs such as result.md and result.json. Do not modify files.",
  "Explain the validation and approval flow in OpenKitchen, including when a run becomes completed, failed, or needs_input. Do not modify files.",
  "Explain how recipes and recipe workflow runs are represented and executed in OpenKitchen. Do not modify files.",
  "Explain Banquet mode and how OpenKitchen handles parallel task execution, conflicts, and reconciliation. Do not modify files.",
  "Review the Repository Context Map implementation and explain its current strengths, limitations, and correctness risks. Do not modify files.",
  "Investigate where extensionless relative imports are resolved in the Repository Context Map and explain what could go wrong if resolution is inaccurate. Do not modify files.",
  "Evaluate whether OpenKitchen is ready for daily use with Codex CLI, focusing on operational reliability and ledger usefulness. Do not modify files."
)

if ($Set -eq "full") {
  $Prompts = $FullPrompts
} else {
  $Prompts = $QuickPrompts
}

Write-Host "RepoMap ON evaluation helper"
Write-Host "Set: $Set"
Write-Host "Output root: $EvalRoot"
Write-Host "Cases: $($Prompts.Count)"
Write-Host ""

for ($Index = 0; $Index -lt $Prompts.Count; $Index += 1) {
  $CaseNumber = "{0:D2}" -f ($Index + 1)
  $CaseFolder = Join-Path $EvalRoot "case-$CaseNumber"
  $Prompt = $Prompts[$Index]
  $PromptPath = Join-Path $CaseFolder "prompt.txt"
  $ConsoleLog = Join-Path $CaseFolder "console.log"
  $MetadataPath = Join-Path $CaseFolder "metadata.txt"

  New-Item -ItemType Directory -Force -Path $CaseFolder | Out-Null
  Set-Content -Path $PromptPath -Value $Prompt -Encoding UTF8

  $Metadata = @(
    "set=$Set",
    "batch=$Batch",
    "startedAt=$($StartedAt.ToString("o"))",
    "case=case-$CaseNumber",
    "mode=prep",
    "adapter=codex-cli",
    "repoMap=on",
    "ledgerRoot=$CaseFolder",
    "prompt=$Prompt"
  )
  Set-Content -Path $MetadataPath -Value $Metadata -Encoding UTF8

  Write-Host "Running case-$CaseNumber"
  Write-Host "Prompt: $Prompt"
  Write-Host "Ledger root: $CaseFolder"

  & npm.cmd run dev -- run --adapter codex-cli --mode prep --ledger-root $CaseFolder $Prompt 2>&1 |
    Tee-Object -FilePath $ConsoleLog

  $ConsoleText = Get-Content -Path $ConsoleLog -Raw
  $RunMatch = [regex]::Match($ConsoleText, "(?m)^Run:\s*(\S+)\s*$")

  Write-Host ""
  Write-Host "Case: case-$CaseNumber"
  Write-Host "Console log: $ConsoleLog"

  if ($RunMatch.Success) {
    $RunId = $RunMatch.Groups[1].Value
    $RunPath = Join-Path $CaseFolder $RunId
    Write-Host "Run ID: $RunId"
    Write-Host "Expected result: $(Join-Path $RunPath "result.md")"
    Write-Host "Expected repo map: $(Join-Path $RunPath "artifacts\repo-map.md")"
  } else {
    Write-Host "Run ID could not be extracted reliably."
    Write-Host "Open the console log and record the Run ID manually."
    Write-Host "Expected run directory root: $CaseFolder"
  }

  Write-Host ""
}

Write-Host "RepoMap ON evaluation runs complete."
