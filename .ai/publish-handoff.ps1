# =============================================================================
# publish-shared.ps1
# 概要: 指定パスだけを本線と今のブランチへ記録して上げる
# 仕様: 作業ツリーは切り替えない。本線は一時 worktree で扱う。強制 push しない
# 制限: 秘密情報を含むファイルは記録しない。リモート不通は失敗にする
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
    param(
        [Parameter(Mandatory = $true)][string[]]$GitArgs,
        [string]$WorkingDirectory
    )
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($WorkingDirectory) {
            Push-Location -LiteralPath $WorkingDirectory
        }
        $output = & git @GitArgs 2>&1
        $code = $LASTEXITCODE
        $text = (@($output) | ForEach-Object { [string]$_ }) -join "`n"
        return [pscustomobject]@{ ExitCode = $code; Output = $output; Text = $text }
    }
    finally {
        if ($WorkingDirectory) {
            Pop-Location
        }
        $ErrorActionPreference = $prev
    }
}

function Format-GitFailure {
    param([string]$Prefix, $GitResult)
    $detail = [string]$GitResult.Text
    if ([string]::IsNullOrWhiteSpace($detail)) {
        return $Prefix
    }
    $oneLine = ($detail -replace '\r?\n', ' / ').Trim()
    if ($oneLine.Length -gt 300) {
        $oneLine = $oneLine.Substring(0, 300) + '...'
    }
    return ("{0}: {1}" -f $Prefix, $oneLine)
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
    if (Test-Path -LiteralPath $dest) {
        Remove-Item -LiteralPath $dest -Recurse -Force
    }
    Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
}

function Get-DefaultBranchName {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    $ref = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
    if ($ref.ExitCode -eq 0 -and $ref.Text) {
        $line = (@($ref.Output) | Select-Object -First 1)
        return ([string]$line).Trim() -replace '^origin/', ''
    }
    $heads = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('branch', '-r')
    $text = [string]$heads.Text
    if ($text -match 'origin/main\b') { return 'main' }
    if ($text -match 'origin/master\b') { return 'master' }
    return 'main'
}

function Get-ExistingRelativePaths {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths
    )
    $list = New-Object System.Collections.Generic.List[string]
    foreach ($rel in $RelativePaths) {
        $full = Join-Path $RepoRoot (Convert-ToRepoPath -RelativePath $rel)
        if (Test-Path -LiteralPath $full) {
            [void]$list.Add(($rel -replace '\\', '/'))
        }
    }
    return @($list.ToArray())
}

function Clear-AgentRulesPublishStash {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    $list = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('stash', 'list')
    $lines = @($list.Output | ForEach-Object { [string]$_ })
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
        $line = $lines[$i]
        if ($line -match 'agent-rules-publish' -and $line -match '^(stash@\{\d+\})') {
            [void](Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('stash', 'drop', $Matches[1]))
        }
    }
}

function Publish-PathsInRepo {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string[]]$RelativePaths,
        [Parameter(Mandatory = $true)][string]$CommitMessage,
        [string]$PushRef
    )
    $paths = @(Get-ExistingRelativePaths -RepoRoot $RepoRoot -RelativePaths $RelativePaths)
    if (@($paths).Count -eq 0) {
        return [pscustomobject]@{ Changed = $false; Pushed = $false }
    }
    $add = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs (@('add', '-f', '--') + $paths)
    if ($add.ExitCode -ne 0) {
        throw (Format-GitFailure -Prefix 'git add に失敗しました' -GitResult $add)
    }
    $diff = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('diff', '--cached', '--quiet')
    if ($diff.ExitCode -eq 0) {
        return [pscustomobject]@{ Changed = $false; Pushed = $false }
    }
    $commit = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('commit', '-m', $CommitMessage)
    if ($commit.ExitCode -ne 0) {
        throw (Format-GitFailure -Prefix 'git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" に失敗しました' -GitResult $commit)
    }
    $pushArgs = @('push', 'origin')
    if ($PushRef) {
        $pushArgs += $PushRef
    }
    else {
        $pushArgs += @('-u', 'HEAD')
    }
    $push = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs $pushArgs
    if ($push.ExitCode -ne 0) {
        throw (Format-GitFailure -Prefix 'git push に失敗しました。強制 push はしません' -GitResult $push)
    }
    return [pscustomobject]@{ Changed = $true; Pushed = $true }
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
    $contentTemp = Join-Path $env:TEMP ("agent-rules-publish-" + [guid]::NewGuid().ToString('N'))
    $worktreePath = Join-Path $env:TEMP ("agent-rules-wt-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $contentTemp -Force | Out-Null
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
            Copy-RepoRelative -RepoRoot $RepoRoot -RelativePath $rel -DestinationRoot $contentTemp
        }

        Clear-AgentRulesPublishStash -RepoRoot $RepoRoot

        $branchInfo = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('rev-parse', '--abbrev-ref', 'HEAD')
        $original = ([string](@($branchInfo.Output) | Select-Object -First 1)).Trim()
        if ($original -eq 'HEAD') { throw 'detached HEAD では公開しません' }

        $fetch = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('fetch', 'origin')
        if ($fetch.ExitCode -ne 0) {
            throw (Format-GitFailure -Prefix 'origin の取得に失敗しました' -GitResult $fetch)
        }

        $defaultBranch = Get-DefaultBranchName -RepoRoot $RepoRoot
        $originRef = "origin/$defaultBranch"
        $rev = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('rev-parse', '--verify', $originRef)
        if ($rev.ExitCode -ne 0) {
            throw ("本線の参照がありません: {0}" -f $originRef)
        }

        $wtAdd = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('worktree', 'add', '--detach', $worktreePath, $originRef)
        if ($wtAdd.ExitCode -ne 0) {
            throw (Format-GitFailure -Prefix '一時 worktree を作れませんでした' -GitResult $wtAdd)
        }

        foreach ($rel in $RelativePaths) {
            Copy-RepoRelative -RepoRoot $contentTemp -RelativePath $rel -DestinationRoot $worktreePath
        }
        # worktree 側にも作者情報がない場合があるのでローカル設定を借用
        $email = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('config', 'user.email')
        $name = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('config', 'user.name')
        if ($email.ExitCode -eq 0 -and $email.Text) {
            [void](Invoke-GitLocal -WorkingDirectory $worktreePath -GitArgs @('config', 'user.email', ([string](@($email.Output) | Select-Object -First 1)).Trim()))
        }
        if ($name.ExitCode -eq 0 -and $name.Text) {
            [void](Invoke-GitLocal -WorkingDirectory $worktreePath -GitArgs @('config', 'user.name', ([string](@($name.Output) | Select-Object -First 1)).Trim()))
        }

        $mainPub = Publish-PathsInRepo -RepoRoot $worktreePath -RelativePaths $RelativePaths -CommitMessage $CommitMessage -PushRef ("HEAD:{0}" -f $defaultBranch)
        if ($mainPub.Pushed) { $result.PushedMain = $true }

        foreach ($rel in $RelativePaths) {
            Copy-RepoRelative -RepoRoot $contentTemp -RelativePath $rel -DestinationRoot $RepoRoot
        }

        if ($original -eq $defaultBranch) {
            $pull = Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('pull', '--ff-only', 'origin', $defaultBranch)
            if ($pull.ExitCode -ne 0) {
                # 本線は worktree で上げ済み。ローカル追従だけ失敗しても公開自体は成功扱い
                $result.Ok = $true
            }
            else {
                $result.Ok = $true
            }
            if (-not $mainPub.Changed) { $result.Skipped = $true }
        }
        else {
            $workPub = Publish-PathsInRepo -RepoRoot $RepoRoot -RelativePaths $RelativePaths -CommitMessage $CommitMessage -PushRef $null
            if ($workPub.Pushed) { $result.PushedWork = $true }
            if (-not $mainPub.Changed -and -not $workPub.Changed) { $result.Skipped = $true }
            $result.Ok = $true
        }
    }
    catch {
        $result.Ok = $false
        $result.Error = $_.Exception.Message
    }
    finally {
        if (Test-Path -LiteralPath $worktreePath) {
            [void](Invoke-GitLocal -WorkingDirectory $RepoRoot -GitArgs @('worktree', 'remove', '--force', $worktreePath))
            if (Test-Path -LiteralPath $worktreePath) {
                Remove-Item -LiteralPath $worktreePath -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        if (Test-Path -LiteralPath $contentTemp) {
            Remove-Item -LiteralPath $contentTemp -Recurse -Force -ErrorAction SilentlyContinue
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