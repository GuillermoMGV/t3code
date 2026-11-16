$ErrorActionPreference = 'Stop'
$activation = Join-Path $env:APPDATA 'vite-plus/env.ps1'
if (-not (Test-Path -LiteralPath $activation)) { throw 'Instala Vite+ siguiendo docs/operations/development.md.' }
. $activation
$manifest = Get-Content -LiteralPath (Join-Path (Split-Path (Split-Path $PSScriptRoot)) 'package.json') -Raw | ConvertFrom-Json
$resolvedPath = & vp env exec --node $manifest.engines.node --package-manager $manifest.packageManager node -p 'process.env.PATH'
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar el entorno oficial de Node y pnpm.' }
$env:PATH = ($resolvedPath | Select-Object -Last 1)
$cargoBin = Join-Path $env:USERPROFILE '.cargo/bin'
if (Test-Path -LiteralPath $cargoBin) { $env:PATH = "$cargoBin;$env:PATH" }
Write-Host "Entorno listo: Node $($manifest.engines.node), $($manifest.packageManager)."
