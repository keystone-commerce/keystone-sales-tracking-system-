param([string]$OutputPath = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workRoot = Join-Path $projectRoot 'work'
New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
if (-not $OutputPath) { $OutputPath = Join-Path $workRoot 'sales-ops-ci-source.zip' }
if (-not [IO.Path]::IsPathRooted($OutputPath)) { $OutputPath = Join-Path $projectRoot $OutputPath }
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$resolvedWork = [IO.Path]::GetFullPath($workRoot).TrimEnd('\') + '\'
if (-not $resolvedOutput.StartsWith($resolvedWork, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($resolvedOutput) -ne '.zip') { throw 'The generated ZIP must be inside this project''s work folder.' }
$stagingRoot = Join-Path $workRoot ('ci-source-' + [Guid]::NewGuid().ToString('N'))
$backendStage = Join-Path $stagingRoot 'backend'
New-Item -ItemType Directory -Path $backendStage -Force | Out-Null
foreach ($directory in @('src','migrations','certs','ci','tests')) { Copy-Item -LiteralPath (Join-Path $projectRoot ('backend\' + $directory)) -Destination $backendStage -Recurse }
foreach ($file in @('Dockerfile','.dockerignore','package.json','package-lock.json')) { Copy-Item -LiteralPath (Join-Path $projectRoot ('backend\' + $file)) -Destination $backendStage }
Compress-Archive -LiteralPath $backendStage -DestinationPath $resolvedOutput -Force
Write-Output "Prepared backend CI source: $resolvedOutput"
Write-Output 'No environment files, local database, user uploads, Git history or node_modules were included.'
