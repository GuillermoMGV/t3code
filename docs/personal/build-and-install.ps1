[CmdletBinding()]
param(
    # Opcional. Por defecto: <version de apps/desktop/package.json>-preview.<AAAAMMDD>.<siguiente N libre>
    [string]$BuildVersion,
    [ValidateSet('x64', 'arm64')][string]$Arch = 'x64',
    # Omite la copia de ~/.t3/userdata antes de instalar.
    [switch]$SkipBackup
)

# Compila el instalador verificado (build-windows.ps1) y lo instala en este equipo:
#   1. Calcula una version preview unica si no se pasa una.
#   2. Compila y verifica con build-windows.ps1 (arbol limpio obligatorio).
#   3. Lanza install-windows.ps1 en un proceso independiente: cierra la app, copia
#      ~/.t3/userdata a ~/.t3/userdata-backup-<fecha-hora>, instala, comprueba la version y
#      reabre la app. Sobrevive aunque este script corra en una terminal de T3 Code.
# No publica nada.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$checkoutRoot = Split-Path (Split-Path $PSScriptRoot)

function Get-InstalledT3 {
    Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like 'T3 Code*' } |
        Select-Object -First 1
}

$hostArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
if ($Arch -ne $hostArch) { throw "No se puede instalar un build $Arch en un equipo $hostArch. Usa build-windows.ps1 para solo compilar." }

Push-Location $checkoutRoot
try {
    if (-not $BuildVersion) {
        $baseVersion = (Get-Content -LiteralPath 'apps/desktop/package.json' -Raw | ConvertFrom-Json).version
        $prefix = "$baseVersion-preview.$(Get-Date -Format yyyyMMdd)."
        $used = @()
        if (Test-Path -LiteralPath 'release') {
            $used += Get-ChildItem -LiteralPath 'release' -Filter "T3-Code-$prefix*-$Arch.exe" |
                ForEach-Object { if ($_.Name -match '\.(\d+)-[a-z0-9]+\.exe$') { [int]$Matches[1] } }
        }
        $installed = Get-InstalledT3
        if ($installed -and $installed.DisplayVersion.StartsWith($prefix)) {
            $used += [int]$installed.DisplayVersion.Substring($prefix.Length)
        }
        $next = if ($used.Count -gt 0) { ($used | Measure-Object -Maximum).Maximum + 1 } else { 1 }
        $BuildVersion = "$prefix$next"
    }
    Write-Host "Version: $BuildVersion ($Arch)"

    & (Join-Path $PSScriptRoot 'build-windows.ps1') -BuildVersion $BuildVersion -Arch $Arch

    $installer = Join-Path $checkoutRoot "release\T3-Code-$BuildVersion-$Arch.exe"
    if (-not (Test-Path -LiteralPath $installer)) { throw "No se encontro el instalador: $installer" }

    # Cerrar T3 Code mata los procesos que cuelgan de el (las terminales de sus agentes), asi que el
    # cierre, la copia y la instalacion corren en un proceso aparte que sobrevive a ese cierre.
    $logPath = Join-Path $env:TEMP "t3code-install-$BuildVersion.log"
    Remove-Item -LiteralPath $logPath -ErrorAction SilentlyContinue
    $stage = Join-Path $PSScriptRoot 'install-windows.ps1'
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$stage`" -Installer `"$installer`" -BuildVersion `"$BuildVersion`" -LogPath `"$logPath`""
    if ($SkipBackup) { $command += ' -SkipBackup' }
    $launch = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command }
    if ($launch.ReturnValue -ne 0) { throw "No se pudo lanzar install-windows.ps1 (codigo $($launch.ReturnValue))." }
    Write-Host "Instalando en segundo plano (PID $($launch.ProcessId)). Registro: $logPath"
    Write-Host 'Si esta terminal es de T3 Code, se cerrara con la app; la instalacion sigue y T3 Code se reabre.'

    while (Get-Process -Id $launch.ProcessId -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }
    $log = @(Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue)
    $log | ForEach-Object { Write-Host $_ }
    if ($log.Count -eq 0 -or $log[-1] -notmatch ' OK ') { throw "La instalacion fallo. Revisa $logPath." }
} finally {
    Pop-Location
}
