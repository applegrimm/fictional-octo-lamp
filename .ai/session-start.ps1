# =============================================================================
# session-start.ps1
# 概要: セッション開始時に PROJECT_STATE と git 状態を表示する
# 仕様: リポジトリルートまたは .ai 配下から実行。YAML は解釈しない
# 制限: STATE の書き換えは行わない。Cursor 用は -CursorJson
# =============================================================================

[CmdletBinding()]
param(
    [switch]$CursorJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$scriptDir = $PSScriptRoot
$repoRoot = $scriptDir
if ((Split-Path -Leaf $scriptDir) -eq '.ai') {
    $repoRoot = Split-Path -Parent $scriptDir
}

$statePath = Join-Path $repoRoot '.ai\PROJECT_STATE.yaml'
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('=== PROJECT CONTINUITY ===')
$lines.Add(("Repo: {0}" -f $repoRoot))
$lines.Add('')

$lines.Add('--- PROJECT_STATE.yaml ---')
if (Test-Path -LiteralPath $statePath) {
    $stateText = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($stateText)) {
        $lines.Add('(empty file)')
    }
    else {
        $lines.Add($stateText.TrimEnd())
    }
}
else {
    $lines.Add('(missing) Create .ai/PROJECT_STATE.yaml when work starts.')
}

$lines.Add('')
$lines.Add('--- git status -sb ---')
Push-Location -LiteralPath $repoRoot
try {
    $status = & git status -sb 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) {
        $lines.Add('(git status failed)')
        foreach ($s in @($status)) { $lines.Add([string]$s) }
    }
    else {
        foreach ($s in @($status)) { $lines.Add([string]$s) }
    }

    $lines.Add('')
    $lines.Add('--- recent commits (3) ---')
    $log = & git log -n 3 --oneline 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) {
        $lines.Add('(git log failed)')
    }
    else {
        foreach ($s in @($log)) { $lines.Add([string]$s) }
    }
}
finally {
    Pop-Location
}

$lines.Add('')
$lines.Add('Continue from current/next in PROJECT_STATE. Respect locked_decisions.')
$text = ($lines -join "`n")

if ($CursorJson) {
    $payload = [ordered]@{
        additional_context = $text
    }
    $payload | ConvertTo-Json -Compress
}
else {
    Write-Output $text
}
