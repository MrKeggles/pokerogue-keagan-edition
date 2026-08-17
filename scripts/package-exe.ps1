# SPDX-FileCopyrightText: 2026 Pagefault Games
# SPDX-License-Identifier: AGPL-3.0-only

[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$UnpackedOnly,
  [string]$GitHubOwner = $env:POKEROGUE_GITHUB_OWNER,
  [string]$GitHubRepository = $env:POKEROGUE_GITHUB_REPO
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$distDir = Join-Path $repoRoot "dist"
$electronDir = Join-Path $repoRoot "electron"
$builderConfigPath = Join-Path $repoRoot "electron-builder.json"
$packageJsonPath = Join-Path $repoRoot "package.json"
$logoPath = Join-Path $repoRoot "assets\logo512.png"
$installerScriptPath = Join-Path $repoRoot "electron\installer.nsh"
$licensePath = Join-Path $repoRoot "LICENSE"
$licensesDir = Join-Path $repoRoot "LICENSES"
$readmePath = Join-Path $repoRoot "README.md"
$patchNotesPath = Join-Path $repoRoot "PATCH_NOTES.md"
$distributionNoticePath = Join-Path $repoRoot "docs\distribution-notice.md"
$stageNodeDependencyScript = Join-Path $repoRoot "scripts\stage-node-dependency.cjs"
$appBuildMarkerPath = Join-Path $distDir ".pokerogue-app-build.json"
$releaseDir = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "release\windows"))
$expectedReleaseDir = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "release\windows"))
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stageDir = [System.IO.Path]::GetFullPath((Join-Path $tempRoot "pokerogue-keagan-electron-$([guid]::NewGuid().ToString('N'))"))
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$productName = "Pok$([char]0x00E9)Rogue Keagan Edition"
$upstreamRepository = "pagefaultgames/pokerogue"

function Invoke-Pnpm {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($pnpmCmd) {
    & pnpm @Arguments
  } elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
    & corepack pnpm @Arguments
  } else {
    throw "pnpm was not found. Install pnpm or enable Corepack before packaging."
  }

  if ($LASTEXITCODE -ne 0) {
    throw "pnpm command failed: pnpm $($Arguments -join ' ')"
  }
}

function Invoke-GitRaw {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ArgumentLine,
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory
  )

  $gitCommand = Get-Command git -ErrorAction SilentlyContinue
  if (-not $gitCommand) {
    throw "Git is required to create the corresponding-source archive."
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $gitCommand.Source
  $startInfo.Arguments = $ArgumentLine
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = $utf8NoBom
  $startInfo.StandardErrorEncoding = $utf8NoBom

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) {
      throw "Git could not be started."
    }

    $standardOutput = $process.StandardOutput.ReadToEnd()
    $standardError = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $exitCode = $process.ExitCode
  } finally {
    $process.Dispose()
  }

  if ($exitCode -ne 0) {
    throw "Git command failed (git $ArgumentLine): $($standardError.Trim())"
  }

  return $standardOutput
}

function New-SourceArchive {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryRoot,
    [Parameter(Mandatory = $true)]
    [string]$StagingDirectory,
    [Parameter(Mandatory = $true)]
    [string]$DestinationPath,
    [Parameter(Mandatory = $true)]
    [string]$ProductName
  )

  $resolvedRepositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
  $reportedRepositoryRoot = (Invoke-GitRaw -ArgumentLine "rev-parse --show-toplevel" -WorkingDirectory $resolvedRepositoryRoot).Trim()
  if (-not [string]::Equals(
      [System.IO.Path]::GetFullPath($reportedRepositoryRoot),
      $resolvedRepositoryRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Git resolved an unexpected repository root: $reportedRepositoryRoot"
  }

  $sourceTreeDir = [System.IO.Path]::GetFullPath((Join-Path $StagingDirectory "source-tree"))
  $stagingPrefix = [System.IO.Path]::GetFullPath($StagingDirectory).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $sourceTreeDir.StartsWith($stagingPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to stage source outside the validated temporary directory: $sourceTreeDir"
  }

  New-Item -Path $sourceTreeDir -ItemType Directory -Force | Out-Null

  $sourcePathOutput = Invoke-GitRaw `
    -ArgumentLine "-c core.quotepath=false ls-files -z --cached --others --exclude-standard" `
    -WorkingDirectory $resolvedRepositoryRoot
  $sourcePaths = @($sourcePathOutput.Split([char]0) | Where-Object { -not [string]::IsNullOrEmpty($_) })

  $indexOutput = Invoke-GitRaw `
    -ArgumentLine "-c core.quotepath=false ls-files --stage -z" `
    -WorkingDirectory $resolvedRepositoryRoot
  $submodulePaths = New-Object System.Collections.Generic.List[string]
  foreach ($indexEntry in $indexOutput.Split([char]0)) {
    if ($indexEntry -match '^160000 [0-9a-fA-F]+ \d+\t(.+)$') {
      $submodulePaths.Add($Matches[1].Replace("\", "/").TrimEnd("/"))
    }
  }

  $metadataFileName = "SOURCE-METADATA.txt"
  if ($sourcePaths -contains $metadataFileName) {
    throw "The reserved source metadata path already exists in the working tree: $metadataFileName"
  }

  $repositoryPrefix = $resolvedRepositoryRoot.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  $sourceTreePrefix = $sourceTreeDir.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  $archivedPaths = New-Object System.Collections.Generic.List[string]
  $missingPaths = New-Object System.Collections.Generic.List[string]

  foreach ($sourcePath in $sourcePaths) {
    $normalizedPath = $sourcePath.Replace("\", "/").TrimStart("/")
    $isSubmoduleContent = $false
    foreach ($submodulePath in $submodulePaths) {
      if (
        [string]::Equals($normalizedPath, $submodulePath, [System.StringComparison]::Ordinal) -or
        $normalizedPath.StartsWith("$submodulePath/", [System.StringComparison]::Ordinal)
      ) {
        $isSubmoduleContent = $true
        break
      }
    }
    if ($isSubmoduleContent) {
      continue
    }

    $platformRelativePath = $normalizedPath.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $sourceFullPath = [System.IO.Path]::GetFullPath((Join-Path $resolvedRepositoryRoot $platformRelativePath))
    $targetFullPath = [System.IO.Path]::GetFullPath((Join-Path $sourceTreeDir $platformRelativePath))
    if (
      -not $sourceFullPath.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not $targetFullPath.StartsWith($sourceTreePrefix, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
      throw "Refusing to archive a path outside the repository: $sourcePath"
    }

    if ([System.IO.File]::Exists($sourceFullPath)) {
      $pathSegment = $sourceFullPath
      while (-not [string]::Equals(
          $pathSegment,
          $resolvedRepositoryRoot,
          [System.StringComparison]::OrdinalIgnoreCase
        )) {
        $pathItem = Get-Item -LiteralPath $pathSegment -Force
        if (($pathItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
          throw "Refusing to archive a reparse-point source path: $sourcePath"
        }
        $pathSegment = Split-Path -Parent $pathSegment
      }

      $targetParent = Split-Path -Parent $targetFullPath
      New-Item -Path $targetParent -ItemType Directory -Force | Out-Null
      [System.IO.File]::Copy($sourceFullPath, $targetFullPath, $true)
      [System.IO.File]::SetLastWriteTimeUtc($targetFullPath, [System.IO.File]::GetLastWriteTimeUtc($sourceFullPath))
      $archivedPaths.Add($normalizedPath)
    } elseif (-not [System.IO.Directory]::Exists($sourceFullPath)) {
      $missingPaths.Add($normalizedPath)
    }
  }

  $baseCommit = (Invoke-GitRaw -ArgumentLine "rev-parse HEAD" -WorkingDirectory $resolvedRepositoryRoot).Trim()
  $remotes = (Invoke-GitRaw -ArgumentLine "remote -v" -WorkingDirectory $resolvedRepositoryRoot).Trim()
  $submoduleRevisions = (Invoke-GitRaw -ArgumentLine "submodule status --recursive" -WorkingDirectory $resolvedRepositoryRoot).Trim()
  $workingTreeStatus = (Invoke-GitRaw `
      -ArgumentLine "-c core.quotepath=false status --short --untracked-files=all" `
      -WorkingDirectory $resolvedRepositoryRoot
    ).TrimEnd()

  $metadataLines = New-Object System.Collections.Generic.List[string]
  $metadataLines.Add("$ProductName corresponding-source snapshot")
  $metadataLines.Add("Archive format: 1")
  $metadataLines.Add("Created (UTC): $([DateTime]::UtcNow.ToString('o'))")
  $metadataLines.Add("Base commit: $baseCommit")
  $metadataLines.Add("Archived working-tree files: $($archivedPaths.Count)")
  $metadataLines.Add("")
  $metadataLines.Add("The archive contains existing regular files reported by:")
  $metadataLines.Add("  git ls-files --cached --others --exclude-standard")
  $metadataLines.Add("Git-ignored/generated files, Git administrative data, and submodule contents are excluded.")
  $metadataLines.Add("")
  $metadataLines.Add("REMOTES")
  $metadataLines.Add($(if ($remotes) { $remotes } else { "(none)" }))
  $metadataLines.Add("")
  $metadataLines.Add("RECURSIVE SUBMODULE REVISIONS")
  $metadataLines.Add($(if ($submoduleRevisions) { $submoduleRevisions } else { "(none)" }))
  $metadataLines.Add("")
  $metadataLines.Add("WORKING TREE STATUS AT SNAPSHOT TIME")
  $metadataLines.Add($(if ($workingTreeStatus) { $workingTreeStatus } else { "(clean)" }))
  $metadataLines.Add("")
  $metadataLines.Add("TRACKED PATHS OMITTED BECAUSE THEY DID NOT EXIST")
  if ($missingPaths.Count -eq 0) {
    $metadataLines.Add("(none)")
  } else {
    foreach ($missingPath in ($missingPaths | Sort-Object)) {
      $metadataLines.Add($missingPath)
    }
  }
  $metadataLines.Add("")
  $metadataLines.Add("SHA-256 OF ARCHIVED WORKING-TREE FILES")
  foreach ($archivedPath in ($archivedPaths | Sort-Object)) {
    $archivedFullPath = Join-Path $sourceTreeDir $archivedPath.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $fileHash = (Get-FileHash -LiteralPath $archivedFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $currentSourcePath = Join-Path $resolvedRepositoryRoot $archivedPath.Replace(
      "/",
      [System.IO.Path]::DirectorySeparatorChar
    )
    if (-not [System.IO.File]::Exists($currentSourcePath)) {
      throw "The working tree changed while its source archive was being created: $archivedPath"
    }
    $currentSourceHash = (Get-FileHash -LiteralPath $currentSourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not [string]::Equals($fileHash, $currentSourceHash, [System.StringComparison]::Ordinal)) {
      throw "The working tree changed while its source archive was being created: $archivedPath"
    }
    $metadataLines.Add("$fileHash  $archivedPath")
  }

  $currentSourcePathOutput = Invoke-GitRaw `
    -ArgumentLine "-c core.quotepath=false ls-files -z --cached --others --exclude-standard" `
    -WorkingDirectory $resolvedRepositoryRoot
  if (-not [string]::Equals(
      $sourcePathOutput,
      $currentSourcePathOutput,
      [System.StringComparison]::Ordinal
    )) {
    throw "The working-tree file list changed while its source archive was being created."
  }

  [System.IO.File]::WriteAllLines(
    (Join-Path $sourceTreeDir $metadataFileName),
    [string[]]$metadataLines,
    $utf8NoBom
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $DestinationPath) {
    throw "Refusing to overwrite an existing source archive: $DestinationPath"
  }
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $sourceTreeDir,
    $DestinationPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )

  $sourceArchive = [System.IO.Compression.ZipFile]::OpenRead($DestinationPath)
  try {
    $archiveEntryNames = @($sourceArchive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
    foreach ($requiredEntry in @("LICENSE", "README.md", $metadataFileName)) {
      if ($archiveEntryNames -notcontains $requiredEntry) {
        throw "The source archive is missing a required entry: $requiredEntry"
      }
    }
  } finally {
    $sourceArchive.Dispose()
  }

  return [pscustomobject]@{
    Path = $DestinationPath
    FileCount = $archivedPaths.Count
    Sha256 = (Get-FileHash -LiteralPath $DestinationPath -Algorithm SHA256).Hash
  }
}

if (-not [string]::Equals($releaseDir, $expectedReleaseDir, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to clean an unexpected release directory: $releaseDir"
}

$tempPrefix = $tempRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $stageDir.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use a staging directory outside the system temp directory: $stageDir"
}

Set-Location $repoRoot

if (-not $SkipBuild) {
  Write-Host "Building $productName (Vite mode: app)..."
  Invoke-Pnpm -Arguments @("build:app")
}

if (-not (Test-Path -LiteralPath (Join-Path $distDir "index.html") -PathType Leaf)) {
  throw "App build output is missing. Run 'pnpm build:app' before packaging."
}

if (-not (Test-Path -LiteralPath $appBuildMarkerPath -PathType Leaf)) {
  throw "The app build marker is missing. Run 'pnpm build:app' before packaging."
}
try {
  $appBuildMarker = Get-Content -LiteralPath $appBuildMarkerPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  throw "The app build marker is not valid JSON: $appBuildMarkerPath"
}
if (
  -not [string]::Equals([string]$appBuildMarker.mode, "app", [System.StringComparison]::Ordinal) -or
  -not [string]::Equals(
    [string]$appBuildMarker.serverUrl,
    "pokerogue://app/api",
    [System.StringComparison]::Ordinal
  )
) {
  throw "Refusing to package a non-app build. Expected mode=app and serverUrl=pokerogue://app/api."
}

foreach ($requiredPath in @(
    $electronDir,
    $builderConfigPath,
    $packageJsonPath,
    $logoPath,
    $installerScriptPath,
    $licensePath,
    $licensesDir,
    $readmePath,
    $patchNotesPath,
    $distributionNoticePath,
    $stageNodeDependencyScript
  )) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required packaging input is missing: $requiredPath"
  }
}

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$originalVersion = [string]$packageJson.version
if ($originalVersion -notmatch '^(\d+\.\d+\.\d+)(?:\.\d+)?$') {
  throw "The game version cannot be converted to an Electron package version: $originalVersion"
}
$packageVersion = $Matches[1]
$sourceArchiveName = "PokeRogue-Keagan-Edition-$packageVersion-source.zip"
$sourceArchivePath = Join-Path $stageDir $sourceArchiveName

$packageManager = [string]$packageJson.packageManager
if ($packageManager -notmatch '^pnpm@\d+\.\d+\.\d+$') {
  throw "Could not determine the pinned pnpm version from package.json"
}

$electronVersion = [string]$packageJson.devDependencies.electron
if ($electronVersion -notmatch '(\d+\.\d+\.\d+)') {
  throw "Could not determine the Electron version from package.json"
}
$electronVersion = $Matches[1]

$updaterVersion = [string]$packageJson.dependencies.'electron-updater'
if ($updaterVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "electron-updater must be pinned to an exact version in package.json"
}

$hasGitHubOwner = -not [string]::IsNullOrWhiteSpace($GitHubOwner)
$hasGitHubRepository = -not [string]::IsNullOrWhiteSpace($GitHubRepository)
if ($hasGitHubOwner -ne $hasGitHubRepository) {
  throw "Set both POKEROGUE_GITHUB_OWNER and POKEROGUE_GITHUB_REPO, or neither."
}
$updatesConfigured = $hasGitHubOwner -and $hasGitHubRepository
if ($updatesConfigured) {
  if ($GitHubOwner -notmatch '^[A-Za-z0-9_.-]+$' -or $GitHubRepository -notmatch '^[A-Za-z0-9_.-]+$') {
    throw "The GitHub owner and repository contain unsupported characters."
  }
  if ([string]::Equals(
      "$GitHubOwner/$GitHubRepository",
      $upstreamRepository,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Refusing to configure Keagan Edition updates against the upstream PokéRogue repository."
  }
}

if (Test-Path -LiteralPath $releaseDir) {
  Write-Host "Cleaning previous Windows artifacts: $releaseDir"
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -Path $releaseDir -ItemType Directory -Force | Out-Null
New-Item -Path $stageDir -ItemType Directory -Force | Out-Null

$previousCodeSigningSetting = $env:CSC_IDENTITY_AUTO_DISCOVERY
$previousPath = $env:PATH
$hasExplicitSigningCertificate =
  -not [string]::IsNullOrWhiteSpace($env:CSC_LINK) -or
  -not [string]::IsNullOrWhiteSpace($env:WIN_CSC_LINK)

if (-not $hasExplicitSigningCertificate) {
  $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
}

try {
  Write-Host "Creating exact working-tree source archive..."
  $sourceArchiveInfo = New-SourceArchive `
    -RepositoryRoot $repoRoot `
    -StagingDirectory $stageDir `
    -DestinationPath $sourceArchivePath `
    -ProductName $productName
  Write-Host "Archived $($sourceArchiveInfo.FileCount) source files (SHA-256 $($sourceArchiveInfo.Sha256))."

  $stagePackageJson = [ordered]@{
    name = "pokerogue-keagan-edition"
    version = $packageVersion
    description = $productName
    author = "Keagan"
    main = "electron/main.cjs"
    private = $true
    packageManager = $packageManager
    dependencies = [ordered]@{
      'electron-updater' = $updaterVersion
    }
    license = "AGPL-3.0-only"
    homepage = "https://pokerogue.net"
  }
  [System.IO.File]::WriteAllText(
    (Join-Path $stageDir "package.json"),
    ($stagePackageJson | ConvertTo-Json -Depth 10),
    $utf8NoBom
  )

  Write-Host "Staging the installed updater runtime and production dependencies..."
  & node $stageNodeDependencyScript "electron-updater" $stageDir
  if ($LASTEXITCODE -ne 0) {
    throw "The electron-updater production dependency tree could not be staged."
  }

  $builderConfig = Get-Content -LiteralPath $builderConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $builderConfig.directories.output = $releaseDir
  $builderConfig.files = @(
    [ordered]@{
      from = $distDir
      to = "dist"
      filter = @("**/*")
    },
    [ordered]@{
      from = $electronDir
      to = "electron"
      filter = @("**/*", "!**/*.test.cjs")
    },
    "package.json"
  )
  $builderConfig.extraResources = @(
    [ordered]@{
      from = $licensePath
      to = "LICENSE"
    },
    [ordered]@{
      from = $licensesDir
      to = "LICENSES"
      filter = @("**/*")
    },
    [ordered]@{
      from = $readmePath
      to = "README.md"
    },
    [ordered]@{
      from = $distributionNoticePath
      to = "DISTRIBUTION-NOTICE.md"
    },
    [ordered]@{
      from = $patchNotesPath
      to = "PATCH_NOTES.md"
    },
    [ordered]@{
      from = $sourceArchivePath
      to = $sourceArchiveName
    }
  )
  $builderConfig.win.icon = $logoPath
  # electron-builder resolves NSIS resources relative to the staged project.
  # Keep this migration script anchored to the real source tree instead.
  $builderConfig.nsis.include = $installerScriptPath
  $builderConfig | Add-Member -NotePropertyName electronVersion -NotePropertyValue $electronVersion -Force
  $builderConfig.extraMetadata.dependencies = [ordered]@{
    'electron-updater' = $updaterVersion
  }

  if ($updatesConfigured) {
    $repositoryUrl = "https://github.com/$GitHubOwner/$GitHubRepository"
    $builderConfig | Add-Member -NotePropertyName publish -NotePropertyValue @(
        [ordered]@{
          provider = "github"
          owner = $GitHubOwner
          repo = $GitHubRepository
          releaseType = "release"
        }
      ) -Force
    $builderConfig.extraMetadata.homepage = $repositoryUrl
    $builderConfig.extraMetadata | Add-Member -NotePropertyName repository -NotePropertyValue ([ordered]@{
        type = "git"
        url = "$repositoryUrl.git"
      }) -Force
    Write-Host "Installed builds will check for updates at: $repositoryUrl/releases"
  } else {
    # An empty publish list and non-GitHub package metadata prevent Electron
    # Builder from inferring the upstream repository as an update provider.
    $builderConfig | Add-Member -NotePropertyName publish -NotePropertyValue @() -Force
    $builderConfig.extraMetadata.homepage = "https://pokerogue.net"
    $builderConfig.extraMetadata.PSObject.Properties.Remove("repository")
    Write-Warning (
      "No GitHub update repository was configured. This build will run normally, " +
      "but automatic updates will be inactive."
    )
  }

  $stageBuilderConfigPath = Join-Path $stageDir "electron-builder.stage.json"
  [System.IO.File]::WriteAllText(
    $stageBuilderConfigPath,
    ($builderConfig | ConvertTo-Json -Depth 30),
    $utf8NoBom
  )

  $electronBuilderCmd = Join-Path $repoRoot "node_modules\.bin\electron-builder.cmd"
  if (-not (Test-Path -LiteralPath $electronBuilderCmd -PathType Leaf)) {
    throw "electron-builder is not installed. Run 'pnpm install' before packaging."
  }

  $pnpmCommand = Get-Command pnpm -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $pnpmCommand) {
    $corepackCommand = Get-Command corepack.cmd -CommandType Application -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if (-not $corepackCommand) {
      throw "Electron Builder requires either pnpm.cmd or corepack.cmd to collect package metadata."
    }

    $packageManagerShimDir = Join-Path $stageDir ".corepack-shims"
    New-Item -Path $packageManagerShimDir -ItemType Directory -Force | Out-Null
    & $corepackCommand.Source enable --install-directory $packageManagerShimDir pnpm
    if ($LASTEXITCODE -ne 0) {
      throw "Corepack could not create the temporary pnpm shim required by Electron Builder."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $packageManagerShimDir "pnpm.cmd") -PathType Leaf)) {
      throw "Corepack did not create the expected temporary pnpm.cmd shim."
    }
    $env:PATH = "$packageManagerShimDir$([System.IO.Path]::PathSeparator)$previousPath"
  }

  $builderArguments = @("--projectDir", $stageDir, "--config", $stageBuilderConfigPath, "--win")
  if ($UnpackedOnly) {
    $builderArguments += "--dir"
  }

  Write-Host "Creating Windows Electron artifacts..."
  & $electronBuilderCmd @builderArguments
  if ($LASTEXITCODE -ne 0) {
    throw "electron-builder failed with exit code $LASTEXITCODE"
  }

  if ($UnpackedOnly) {
    if (-not (Test-Path -LiteralPath (Join-Path $releaseDir "win-unpacked") -PathType Container)) {
      throw "electron-builder did not create the expected win-unpacked directory"
    }
  } else {
    $installer = Get-ChildItem -LiteralPath $releaseDir -Filter "PokeRogue-Keagan-Edition-*-nsis.exe" -File
    $portable = Get-ChildItem -LiteralPath $releaseDir -Filter "PokeRogue-Keagan-Edition-*-portable.exe" -File
    if (-not $installer -or -not $portable) {
      throw "electron-builder did not create both the NSIS installer and portable executable"
    }
  }

  $unpackedResourcesDir = Join-Path $releaseDir "win-unpacked\resources"
  if (-not (Test-Path -LiteralPath $unpackedResourcesDir -PathType Container)) {
    throw "electron-builder did not leave an unpacked resources directory for compliance verification"
  }

  $expectedResourceFiles = @(
    (Join-Path $unpackedResourcesDir "LICENSE"),
    (Join-Path $unpackedResourcesDir "README.md"),
    (Join-Path $unpackedResourcesDir "PATCH_NOTES.md"),
    (Join-Path $unpackedResourcesDir "DISTRIBUTION-NOTICE.md"),
    (Join-Path $unpackedResourcesDir $sourceArchiveName)
  )
  $licenseDirectoryPrefix = $licensesDir.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  foreach ($licenseFile in Get-ChildItem -LiteralPath $licensesDir -Recurse -File) {
    $relativeLicensePath = $licenseFile.FullName.Substring($licenseDirectoryPrefix.Length)
    $expectedResourceFiles += Join-Path $unpackedResourcesDir (Join-Path "LICENSES" $relativeLicensePath)
  }
  foreach ($expectedResourceFile in $expectedResourceFiles) {
    if (-not (Test-Path -LiteralPath $expectedResourceFile -PathType Leaf)) {
      throw "Packaged compliance resource is missing: $expectedResourceFile"
    }
  }

  $packagedSourceHash = (Get-FileHash `
      -LiteralPath (Join-Path $unpackedResourcesDir $sourceArchiveName) `
      -Algorithm SHA256
    ).Hash
  if (-not [string]::Equals(
      $packagedSourceHash,
      $sourceArchiveInfo.Sha256,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "The packaged source archive does not match the source snapshot."
  }

  $adjacentSourceArchivePath = Join-Path $releaseDir $sourceArchiveName
  [System.IO.File]::Copy($sourceArchivePath, $adjacentSourceArchivePath, $false)
  $adjacentSourceHash = (Get-FileHash -LiteralPath $adjacentSourceArchivePath -Algorithm SHA256).Hash
  if (-not [string]::Equals(
      $adjacentSourceHash,
      $sourceArchiveInfo.Sha256,
      [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "The adjacent source archive does not match the packaged source snapshot."
  }

  Write-Host "Windows artifacts created in: $releaseDir"
  Get-ChildItem -LiteralPath $releaseDir -File | Select-Object Name, Length
} finally {
  $env:PATH = $previousPath

  if (-not $hasExplicitSigningCertificate) {
    if ($null -eq $previousCodeSigningSetting) {
      Remove-Item Env:CSC_IDENTITY_AUTO_DISCOVERY -ErrorAction SilentlyContinue
    } else {
      $env:CSC_IDENTITY_AUTO_DISCOVERY = $previousCodeSigningSetting
    }
  }

  if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
  }
}
