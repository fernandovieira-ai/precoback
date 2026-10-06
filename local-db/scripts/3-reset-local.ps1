# ============================================================================
# 3-reset-local.ps1
#
# Derruba o container local e apaga o volume de dados, para recomeçar do
# zero (ex: depois de testar uma alteração destrutiva na procedure/schema).
# NÃO toca em produção — só afeta o container Docker local.
# ============================================================================

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Write-Output "Isso vai APAGAR o volume 'trocapreco_pgdata_local' (dados locais)."
$confirm = Read-Host "Confirma? (s/n)"
if ($confirm -ne "s") {
    Write-Output "Operação cancelada."
    exit 0
}

Push-Location $root
try {
    docker compose down -v
    Write-Output "Container e volume local removidos. Rode 2-restore-local.ps1 para recriar."
}
finally {
    Pop-Location
}

