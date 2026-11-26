[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$BuildVersion,
    [Parameter(Mandatory)][string]$LogPath,
    [switch]$SkipBackup
)

# Paso final de build-and-install.ps1. Se lanza fuera del arbol de procesos de quien lo llama
# (Win32_Process.Create), porque cerrar T3 Code mata las terminales que T3 Code abrio, incluido
# el agente que ejecuta el build. Escribe su progreso en $LogPath; la ultima linea es
# "OK <version>" o "ERROR <mensaje>".
#   1. Cierra la app instalada si esta abierta.
#   2. Copia ~/.t3/userdata a ~/.t3/userdata-backup-<fecha-hora>.
#   3. Ejecuta el instalador, comprueba la version instalada y vuelve a abrir la app si estaba abierta.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\t3code'
$userData = Join-Path $env:USERPROFILE '.t3\userdata'

function Write-Log([string]$Message) {
    Add-Content -LiteralPath $LogPath -Value "$(Get-Date -Format HH:mm:ss) $Message" -Encoding utf8
}

function Get-InstalledT3 {
    Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like 'T3 Code*' } |
        Select-Object -First 1
}

function Get-InstalledAppProcesses {
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) }
}

try {
    $running = @(Get-InstalledAppProcesses)
    $wasRunning = $running.Count -gt 0
    if ($wasRunning) {
        Write-Log 'Cerrando T3 Code instalado...'
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
        # robocopy /XJ salta los enlaces (junctions): las skills enlazadas de los proveedores viven
        # fuera de userdata y un enlace roto hacia ellas tumbaba Copy-Item.
        robocopy $userData $backup /E /XJ /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "Fallo la copia de datos (robocopy $LASTEXITCODE)." }
        Write-Log "Copia de datos: $backup"
    }

    Write-Log 'Instalando...'
    $process = Start-Process -FilePath $Installer -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "El instalador termino con codigo $($process.ExitCode)." }

    $installed = Get-InstalledT3
    if (-not $installed -or $installed.DisplayVersion -ne $BuildVersion) {
        throw "La version instalada no coincide (esperada $BuildVersion)."
    }
    Write-Log "Instalado $($installed.DisplayName) en $installDir. Acceso directo: escritorio y menu Inicio."

    # El instalador suele abrir la app; si no lo hizo y estaba abierta antes, se reabre.
    Start-Sleep -Seconds 3
    if ($wasRunning -and @(Get-InstalledAppProcesses).Count -eq 0) {
        $exe = Get-ChildItem -LiteralPath $installDir -Filter 'T3 Code*.exe' |
            Where-Object { $_.Name -notlike 'Uninstall*' } | Select-Object -First 1
        if ($exe) { Start-Process -FilePath $exe.FullName; Write-Log 'T3 Code reabierto.' }
    }
    Write-Log "OK $BuildVersion"
} catch {
    Write-Log "ERROR $_"
    exit 1
}
