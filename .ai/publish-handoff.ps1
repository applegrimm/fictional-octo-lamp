# =============================================================================
# publish-shared.ps1
# 概要: 指定パスだけを本線と作業ブランチへ記録して上げる
# 仕様: 対象は一時コピーしてから退避する。強制 push しない
# 制限: 早送りできない本線は失敗。秘密情報を含むファイルは記録しない
# =============================================================================
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-ContinuitySecret {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $false }
    if ($Text -match '(?i)(api[_-]?key|password|secret|token)\s*[:=]\s*\S+') { return $true }
    if ($Text -match 'ghp_[A-Za-z0-9]{20,}') { return $true }
    if ($Text -match 'sk-[A-Za-z0-9]{20,}') { return $true }
    return $false
}

function Convert-ToRepoPath {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    return ($RelativePath -replace '/', [string][char]92)
}

function Invoke-GitLocal {
    param([Parameter(Mandatory = $true)][string[]]$GitArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & git @GitArgs 2>&1
        $code = $LASTEXITCODE
        return [pscustomobject]@{ ExitCode = $code; Output = $output }
    }
    finally {
        $ErrorActionPreference = $prev
    }
}

function Copy-RepoRelative {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$DestinationRoot
    )
    $rel = Convert-ToRepoPath -RelativePath $RelativePath
    $src = Join-Path $RepoRoot $rel
    if (-not (Test-Path -LiteralPath $src)) { return }
    $dest = Join-Path $DestinationRoot $rel
    $parent = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
}

function Restore-RepoRelative {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$SourceRoot
    )
    $rel = Convert-ToRepoPath -RelativePath $RelativePath
    $src = Join-Path $SourceRoot $rel
    if (-not (Test-Path -LiteralPath $src)) { return }
    $dest = Join-Path $RepoRoot $rel
    $parent = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    if (Test-Path -LiteralPath $dest) {
        Remove-Item -LiteralPath $dest -Recurse -Force
    }
    Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
}

function Get-DefaultBranchName {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    Push-Location $RepoRoot
    try {
        $ref = Invoke-GitLocal -GitArgs @('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
        if ($ref.ExitCode -eq 0 -and $ref.Output) {
            $line = (@($ref.Output) | Where-Object { $_ -is [string] -or $_.ToString() } | Select-Object -First 1)
            return ([string]$line).Trim() -replace '^origin/', ''
        }
        $heads = Invoke-GitLocal -GitArgs @('branch', '-r')
        $text = (@($heads.Output) -join "`n")
        if ($text -match '(?m)^\s*origin/main$') { return 'main' }
        if ($text -match 'origin/main\b') { return 'main' }
        if ($text -match 'origin/master\b') { return 'master' }
        return 'main'
    }
    finally {
        Pop-Location
    }
}

function Publish-SharedPaths {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths,
        [Parameter(Mandatory = $true)][string]$CommitMessage
    )
    $result = [pscustomobject]@{
        Ok         = $false
        Error      = $null
        PushedMain = $false
        PushedWork = $false
        Skipped    = $false
    }
    $temp = Join-Path $env:TEMP ("agent-rules-publish-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    $stashed = $false
    $original = $null
    Push-Location -LiteralPath $RepoRoot
    try {
        foreach ($rel in $RelativePaths) {
            $full = Join-Path $RepoRoot (Convert-ToRepoPath -RelativePath $rel)
            if (-not (Test-Path -LiteralPath $full)) { continue }
            $item = Get-Item -LiteralPath $full
            $files = @()
            if ($item.PSIsContainer) {
                $files = @(Get-ChildItem -LiteralPath $full -Recurse -File -ErrorAction SilentlyContinue)
            }
            else {
                $files = @($item)
            }
            foreach ($file in $files) {
                $textFile = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
                if (Test-ContinuitySecret -Text $textFile) {
                    throw ("秘密情報を含むため記録しません: {0}" -f $rel)
                }
            }
            Copy-RepoRelative -RepoRoot $RepoRoot -RelativePath $rel -DestinationRoot $temp
        }

        $branchInfo = Invoke-GitLocal -GitArgs @('rev-parse', '--abbrev-ref', 'HEAD')
        $original = ([string](@($branchInfo.Output) | Select-Object -First 1)).Trim()
        if ($original -eq 'HEAD') { throw 'detached HEAD では公開しません' }
        $status = Invoke-GitLocal -GitArgs @('status', '--porcelain')
        $porcelain = @($status.Output | Where-Object { $_ -and ([string]$_).Trim() -ne '' })
        if ($porcelain.Count -gt 0) {
            $stash = Invoke-GitLocal -GitArgs @('stash', 'push', '--include-untracked', '-m', 'agent-rules-publish')
            if ($stash.ExitCode -ne 0) { throw '作業中の変更を退避できませんでした' }
            $stashed = $true
        }

        $defaultBranch = Get-DefaultBranchName -RepoRoot $RepoRoot
        $co = Invoke-GitLocal -GitArgs @('checkout', $defaultBranch)
        if ($co.ExitCode -ne 0) { throw ("本線へ移れません: {0}" -f $defaultBranch) }
        $pull = Invoke-GitLocal -GitArgs @('pull', '--ff-only', 'origin', $defaultBranch)
        if ($pull.ExitCode -ne 0) { throw ("本線を早送りできません: {0}" -f $defaultBranch) }

        foreach ($rel in $RelativePaths) {
            Restore-RepoRelative -RepoRoot $RepoRoot -RelativePath $rel -SourceRoot $temp
        }
        $existing = New-Object System.Collections.Generic.List[string]
        foreach ($rel in $RelativePaths) {
            $full = Join-Path $RepoRoot (Convert-ToRepoPath -RelativePath $rel)
            if (Test-Path -LiteralPath $full) {
                [void]$existing.Add(($rel -replace '\\', '/'))
            }
        }
        if ($existing.Count -eq 0) {
            $result.Skipped = $true
            $result.Ok = $true
        }
        else {
            $pathsMain = @($existing.ToArray())
            $addArgs = @('add', '--') + $pathsMain
            $add = Invoke-GitLocal -GitArgs $addArgs
            if ($add.ExitCode -ne 0) { throw '本線での git add に失敗しました' }
            $diff = Invoke-GitLocal -GitArgs @('diff', '--cached', '--quiet')
            if ($diff.ExitCode -eq 0) {
                $result.Skipped = $true
                $result.Ok = $true
            }
            else {
                $commit = Invoke-GitLocal -GitArgs @('commit', '-m', $CommitMessage)
                if ($commit.ExitCode -ne 0) { throw '本線への記録に失敗しました' }
                $push = Invoke-GitLocal -GitArgs @('push', 'origin', ("HEAD:{0}" -f $defaultBranch))
                if ($push.ExitCode -ne 0) { throw '本線への push に失敗しました。強制 push はしません' }
                $result.PushedMain = $true
                $result.Ok = $true
                $result.Skipped = $false
            }
        }

        if ($original -ne $defaultBranch) {
            $co2 = Invoke-GitLocal -GitArgs @('checkout', $original)
            if ($co2.ExitCode -ne 0) { throw ("作業ブランチへ戻れません: {0}" -f $original) }
            if ($stashed) {
                $pop = Invoke-GitLocal -GitArgs @('stash', 'pop')
                if ($pop.ExitCode -ne 0) { throw '退避した変更を戻せませんでした。手作業が必要です' }
                $stashed = $false
            }
            foreach ($rel in $RelativePaths) {
                Restore-RepoRelative -RepoRoot $RepoRoot -RelativePath $rel -SourceRoot $temp
            }
            $existingWork = New-Object System.Collections.Generic.List[string]
            foreach ($rel in $RelativePaths) {
                $full = Join-Path $RepoRoot (Convert-ToRepoPath -RelativePath $rel)
                if (Test-Path -LiteralPath $full) {
                    [void]$existingWork.Add(($rel -replace '\\', '/'))
                }
            }
            if ($existingWork.Count -gt 0) {
                $pathsWork = @($existingWork.ToArray())
                $addW = Invoke-GitLocal -GitArgs (@('add', '--') + $pathsWork)
                if ($addW.ExitCode -ne 0) { throw '作業ブランチでの git add に失敗しました' }
                $diffW = Invoke-GitLocal -GitArgs @('diff', '--cached', '--quiet')
                if ($diffW.ExitCode -ne 0) {
                    $commitW = Invoke-GitLocal -GitArgs @('commit', '-m', $CommitMessage)
                    if ($commitW.ExitCode -ne 0) { throw '作業ブランチへの記録に失敗しました' }
                    $pushW = Invoke-GitLocal -GitArgs @('push', '-u', 'origin', 'HEAD')
                    if ($pushW.ExitCode -ne 0) { throw '作業ブランチへの push に失敗しました。強制 push はしません' }
                    $result.PushedWork = $true
                    $result.Skipped = $false
                }
            }
        }
        elseif ($stashed) {
            $pop2 = Invoke-GitLocal -GitArgs @('stash', 'pop')
            if ($pop2.ExitCode -ne 0) { throw '退避した変更を戻せませんでした。手作業が必要です' }
            $stashed = $false
        }
        $result.Ok = $true
    }
    catch {
        $result.Ok = $false
        $result.Error = $_.Exception.Message
        if ($original) {
            [void](Invoke-GitLocal -GitArgs @('checkout', $original))
        }
        if ($stashed) {
            [void](Invoke-GitLocal -GitArgs @('stash', 'pop'))
        }
    }
    finally {
        Pop-Location
        if (Test-Path -LiteralPath $temp) {
            Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    return $result
}

if ($MyInvocation.InvocationName -ne '.') {
    $repoRoot = $PSScriptRoot
    if ((Split-Path -Leaf $repoRoot) -eq '.ai') {
        $repoRoot = Split-Path -Parent $repoRoot
    }
    $paths = @('.ai/PROJECT_STATE.yaml', '.agent-log')
    $published = Publish-SharedPaths -RepoRoot $repoRoot -RelativePaths $paths -CommitMessage 'Update shared continuity files'
    if (-not $published.Ok) {
        Write-Error $published.Error
        exit 1
    }
    Write-Output 'publish-handoff ok'
    exit 0
}