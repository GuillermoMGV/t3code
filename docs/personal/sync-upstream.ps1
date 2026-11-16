[CmdletBinding()]
param([switch]$PublishCustom)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "git $($Arguments -join ' ') fallo. No se continua." }
}

$checkoutRoot = Split-Path (Split-Path $PSScriptRoot)
Push-Location $checkoutRoot
try {
    $root = (Invoke-Git rev-parse --show-toplevel | Out-String).Trim()
    if ([IO.Path]::GetFullPath($root) -ne [IO.Path]::GetFullPath($checkoutRoot)) {
        throw 'Ejecuta este script desde su checkout original.'
    }
    $branch = (Invoke-Git branch --show-current | Out-String).Trim()
    if ($branch -notin @('main', 'custom')) { throw 'Cambia primero a main o custom.' }
    if (Invoke-Git status --porcelain) { throw 'Guarda y confirma los cambios locales antes de actualizar.' }
    foreach ($marker in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
        $path = (Invoke-Git rev-parse --git-path $marker | Out-String).Trim()
        if (Test-Path -LiteralPath $path) { throw "Operacion Git pendiente: $marker" }
    }
    if ((Invoke-Git remote get-url origin | Out-String).Trim() -ne 'https://github.com/GuillermoMGV/t3code.git') {
        throw 'origin no apunta al fork esperado.'
    }
    if ((Invoke-Git remote get-url upstream | Out-String).Trim() -ne 'https://github.com/pingdotgg/t3code.git') {
        throw 'upstream no apunta al proyecto oficial.'
    }
    if ((Invoke-Git remote get-url --push upstream | Out-String).Trim() -ne 'DISABLED') {
        throw 'El push a upstream debe estar bloqueado con DISABLED.'
    }
    $head = Invoke-Git ls-remote --symref upstream HEAD
    if (-not ($head -match 'ref: refs/heads/main\s+HEAD')) { throw 'La rama principal oficial ha cambiado; revisa el procedimiento.' }
    Invoke-Git fetch upstream main
    Invoke-Git fetch origin main custom
    Invoke-Git merge-base --is-ancestor main upstream/main
    Invoke-Git merge-base --is-ancestor origin/main upstream/main
    Invoke-Git switch main
    Invoke-Git merge --ff-only upstream/main
    Invoke-Git push origin main
    Invoke-Git switch custom
    Invoke-Git merge --ff-only origin/custom
    Invoke-Git merge --no-edit main

    . (Join-Path $PSScriptRoot 'custom-env.ps1')
    & vp i --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la instalacion. custom no se publica.' }
    & vp run check:changed
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron las comprobaciones. custom no se publica.' }
    if (Invoke-Git status --porcelain) { throw 'Las comprobaciones dejaron cambios; revisalos antes de publicar.' }
    if ($PublishCustom) {
        Invoke-Git push origin custom
    } else {
        Write-Host 'Integracion comprobada en custom. Revisa la aplicacion y publica con: git push origin custom'
    }
} finally {
    Pop-Location
}
