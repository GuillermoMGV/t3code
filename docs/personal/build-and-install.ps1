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
#   3. Cierra la app instalada si esta abierta.
#   4. Copia ~/.t3/userdata a ~/.t3/userdata-backup-<fecha-hora>.
#   5. Ejecuta el instalador y comprueba la version instalada.
# No publica nada.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$checkoutRoot = Split-Path (Split-Path $PSScriptRoot)
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\t3code'
$userData = Join-Path $env:USERPROFILE '.t3\userdata'

function Get-InstalledT3 {
    Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like 'T3 Code*' } |
        Select-Object -First 1
}

function Get-InstalledAppProcesses {
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) }
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

    $running = @(Get-InstalledAppProcesses)
    if ($running.Count -gt 0) {
        Write-Host 'Cerrando T3 Code instalado...'
        $running | ForEach-Object { [void]$_.CloseMainWindow() }
        $deadline = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $deadline -and @(Get-InstalledAppProcesses).Count -gt 0) { Start-Sleep -Milliseconds 500 }
        # Puede quedar en la bandeja del sistema; SQLite en modo WAL tolera un cierre forzado.
        Get-InstalledAppProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        if (@(Get-InstalledAppProcesses).Count -gt 0) { throw 'T3 Code sigue abierto. Cierralo y vuelve a ejecutar.' }
    }

    if (-not $SkipBackup -and (Test-Path -LiteralPath $userData)) {
        $backup = Join-Path (Split-Path $userData) "userdata-backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
        Copy-Item -LiteralPath $userData -Destination $backup -Recurse
        Write-Host "Copia de datos: $backup"
    }

    $process = Start-Process -FilePath $installer -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "El instalador termino con codigo $($process.ExitCode)." }

    $installed = Get-InstalledT3
    if (-not $installed -or $installed.DisplayVersion -ne $BuildVersion) {
        throw "La version instalada no coincide (esperada $BuildVersion)."
    }
    Write-Host "Instalado $($installed.DisplayName) en $installDir. Acceso directo: escritorio y menu Inicio."
} finally {
    Pop-Location
}
