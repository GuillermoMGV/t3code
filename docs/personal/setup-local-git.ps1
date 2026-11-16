[CmdletBinding()]
param()

# Recrea la configuracion Git local de este checkout (no viaja en los commits).
# Es idempotente: se puede ejecutar de nuevo sin efectos secundarios.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') fallo." }
}

$forkUrl = 'https://github.com/GuillermoMGV/t3code.git'
$upstreamUrl = 'https://github.com/pingdotgg/t3code.git'
$account = 'GuillermoMGV'
$email = '142916148+GuillermoMGV@users.noreply.github.com'

Push-Location (Split-Path (Split-Path $PSScriptRoot))
try {
    $remotes = @(& git remote)
    foreach ($remote in @(@{ Name = 'origin'; Url = $forkUrl }, @{ Name = 'upstream'; Url = $upstreamUrl })) {
        if ($remotes -contains $remote.Name) {
            $current = (Invoke-Git remote get-url $remote.Name | Out-String).Trim()
            if ($current -ne $remote.Url) { throw "$($remote.Name) apunta a $current. Revisalo a mano." }
        } else {
            Invoke-Git remote add $remote.Name $remote.Url
        }
    }

    # Solo las ramas que usamos: el fork copia miles de ramas del proyecto oficial.
    Invoke-Git config --replace-all remote.origin.fetch '+refs/heads/main:refs/remotes/origin/main'
    Invoke-Git config --add remote.origin.fetch '+refs/heads/custom:refs/remotes/origin/custom'
    Invoke-Git config remote.upstream.fetch '+refs/heads/main:refs/remotes/upstream/main'

    Invoke-Git remote set-url --push upstream DISABLED
    Invoke-Git config remote.pushDefault origin
    Invoke-Git config push.default simple
    Invoke-Git config core.longpaths true

    Invoke-Git config user.name $account
    Invoke-Git config user.email $email

    # Credenciales de la cuenta personal desde el almacen de gh, sin depender de la cuenta activa.
    # El valor vacio anula el helper global; --% evita que PowerShell descarte el argumento vacio.
    & git config --replace-all credential.https://github.com.helper --% ""
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo reiniciar el helper de credenciales.' }
    Invoke-Git config --add credential.https://github.com.helper "!f() { test `$1 = get || exit 0; echo username=$account; echo password=`$(gh auth token --user $account); }; f"

    & gh auth token --user $account *> $null
    if ($LASTEXITCODE -ne 0) { Write-Warning "gh no tiene sesion para $account. Ejecuta: gh auth login" }

    & git remote --verbose
} finally {
    Pop-Location
}
