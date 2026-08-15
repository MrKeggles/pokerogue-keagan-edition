# SPDX-FileCopyrightText: 2026 Pagefault Games
# SPDX-License-Identifier: AGPL-3.0-only

[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$productName = "Pok$([char]0x00E9)Rogue Keagan Edition"
$smokeProfilePrefix = "pokerogue-keagan-smoke-"
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$smokeProfilePath = [System.IO.Path]::GetFullPath(
  (Join-Path $tempRoot "$smokeProfilePrefix$([guid]::NewGuid().ToString('N'))")
)
Set-Location $repoRoot

function Invoke-Pnpm {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    & pnpm @Arguments
  } elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
    & corepack pnpm @Arguments
  } else {
    throw "pnpm was not found. Install pnpm or enable Corepack before running the smoke test."
  }

  if ($LASTEXITCODE -ne 0) {
    throw "pnpm command failed: pnpm $($Arguments -join ' ')"
  }
}

if (-not $SkipBuild) {
  Write-Host "Building $productName (Vite mode: app)..."
  Invoke-Pnpm -Arguments @("build:app")
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "dist\index.html") -PathType Leaf)) {
  throw "App build output is missing. Run 'pnpm build:app' before the smoke test."
}

$electronCmd = Join-Path $repoRoot "node_modules\.bin\electron.cmd"
if (-not (Test-Path -LiteralPath $electronCmd -PathType Leaf)) {
  throw "Electron is not installed. Run 'pnpm install' before the smoke test."
}

$previousSmokeSetting = $env:POKEROGUE_DESKTOP_SMOKE
$previousSmokeUserDataSetting = $env:POKEROGUE_DESKTOP_SMOKE_USER_DATA
$previousElectronRunAsNode = $env:ELECTRON_RUN_AS_NODE
$expectedSmokeParent = $tempRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$actualSmokeParent = [System.IO.Path]::GetDirectoryName($smokeProfilePath)
$actualSmokeName = [System.IO.Path]::GetFileName($smokeProfilePath)

if (
  -not [string]::Equals($actualSmokeParent, $expectedSmokeParent, [System.StringComparison]::OrdinalIgnoreCase) -or
  -not $actualSmokeName.StartsWith($smokeProfilePrefix, [System.StringComparison]::OrdinalIgnoreCase)
) {
  throw "Refusing to use an unexpected smoke profile path: $smokeProfilePath"
}

New-Item -Path $smokeProfilePath -ItemType Directory -Force | Out-Null
$smokeExitCode = 1
try {
  $env:POKEROGUE_DESKTOP_SMOKE = "1"
  $env:POKEROGUE_DESKTOP_SMOKE_USER_DATA = $smokeProfilePath
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  & $electronCmd $repoRoot
  $smokeExitCode = $LASTEXITCODE
} finally {
  if ($null -eq $previousSmokeSetting) {
    Remove-Item Env:POKEROGUE_DESKTOP_SMOKE -ErrorAction SilentlyContinue
  } else {
    $env:POKEROGUE_DESKTOP_SMOKE = $previousSmokeSetting
  }

  if ($null -eq $previousSmokeUserDataSetting) {
    Remove-Item Env:POKEROGUE_DESKTOP_SMOKE_USER_DATA -ErrorAction SilentlyContinue
  } else {
    $env:POKEROGUE_DESKTOP_SMOKE_USER_DATA = $previousSmokeUserDataSetting
  }

  if ($null -eq $previousElectronRunAsNode) {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  } else {
    $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
  }

  if (Test-Path -LiteralPath $smokeProfilePath) {
    Remove-Item -LiteralPath $smokeProfilePath -Recurse -Force
  }
}

if ($smokeExitCode -ne 0) {
  throw "Desktop smoke test failed with exit code $smokeExitCode"
}

Write-Host "Desktop smoke test completed successfully."
