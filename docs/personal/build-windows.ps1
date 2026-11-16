[CmdletBinding()]
param(
    # Version preview unica para distinguir la compilacion propia, p. ej. 0.1.9-preview.20261117.1
    [Parameter(Mandatory = $true)][string]$BuildVersion,
    [ValidateSet('x64', 'arm64')][string]$Arch = 'x64'
)

# Reproduce en un host Windows el flujo del release oficial, que compila Windows en Linux
# y verifica el paquete despues en un runner Windows:
#   1. Empaqueta sin generar la cache V8 del servidor ni ejecutar el bundle (igual que en Linux).
#   2. Ejecuta la verificacion oficial de Windows sobre el paquete resultante.
# No publica nada: electron-builder se invoca con --publish never.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$checkoutRoot = Split-Path (Split-Path $PSScriptRoot)
Push-Location $checkoutRoot
$envNames = @('T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR', 'T3CODE_DESKTOP_UNTRUSTED_BUNDLE')
$stageDir = $null
try {
    if (& git status --porcelain) { throw 'Confirma o guarda los cambios antes de compilar: el build modifica temporalmente los manifiestos.' }
    if ($BuildVersion -notmatch '^\d+\.\d+\.\d+-preview\.') { throw 'Usa una version preview, p. ej. 0.1.9-preview.20261117.1.' }

    . (Join-Path $PSScriptRoot 'custom-env.ps1')
    $rustTarget = if ($Arch -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }

    # El preflight oficial puede dar un falso negativo del SDK; compilamos el monitor del commit actual y lo reutilizamos.
    & cargo build --locked --release --target $rustTarget --manifest-path native/resource-monitor/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la compilacion del monitor de recursos.' }

    $startedAt = Get-Date
    $env:T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR = '1'
    # Omite la cache V8 y el auto-chequeo, como el build oficial en Linux. La verificacion se hace abajo.
    $env:T3CODE_DESKTOP_UNTRUSTED_BUNDLE = 'true'
    & vp run dist:desktop:win --arch $Arch --build-version $BuildVersion --keep-stage
    if ($LASTEXITCODE -ne 0) { throw 'Fallo el empaquetado.' }
    foreach ($name in $envNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }

    $stageDir = Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 't3code-desktop-win-stage-*' |
        Where-Object { $_.CreationTime -ge $startedAt } |
        Sort-Object CreationTime -Descending | Select-Object -First 1
    if ($null -eq $stageDir) { throw 'No se encontro el directorio de staging del build.' }
    $appDir = Join-Path $stageDir.FullName 'app/dist/win-unpacked'
    if ($Arch -eq 'arm64') { $appDir = Join-Path $stageDir.FullName 'app/dist/win-arm64-unpacked' }

    & node scripts/verify-windows-desktop-artifact.ts --app-dir $appDir --arch $Arch --build-version $BuildVersion --verbose
    if ($LASTEXITCODE -ne 0) { throw 'La verificacion oficial del paquete fallo. No uses este instalador.' }

    if (& git status --porcelain) { Write-Warning 'El build dejo cambios en el arbol de trabajo; revisalos y no los confirmes.' }
    Write-Host "Instalador verificado en: $(Join-Path $checkoutRoot 'release')"
} finally {
    foreach ($name in $envNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    if ($null -ne $stageDir) { Remove-Item -LiteralPath $stageDir.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    Pop-Location
}
