# SPDX-FileCopyrightText: 2026 Pagefault Games
# SPDX-License-Identifier: AGPL-3.0-only

[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$packageScript = Join-Path $PSScriptRoot "package-exe.ps1"

Write-Warning "The browser/Python ZIP is no longer supported. Creating the Electron installer and portable executable instead."
if ($SkipBuild) {
  & $packageScript -SkipBuild
} else {
  & $packageScript
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
