# ============================================================================
# 2-restore-local.ps1
#
# Sobe o PostgreSQL local (Docker) e restaura o dump mais recente gerado
# por 1-dump-producao.ps1. A base local fica isolada, sem afetar produção.
# ============================================================================

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$dumpsDir = Join-Path $root "dumps"

if (-not (Test-Path $envFile)) {
    Write-Error "Arquivo .env não encontrado em $envFile."
    exit 1
}

Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$' -and $_ -notmatch '^\s*#') {
        Set-Item -Path "env:$($matches[1])" -Value $matches[2]
    }
}

$latestDump = Get-ChildItem -Path $dumpsDir -Filter "dump_*.sql" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $latestDump) {
    Write-Error "Nenhum dump encontrado em $dumpsDir. Execute 1-dump-producao.ps1 primeiro."
    exit 1
}

Write-Output "============================================================"
Write-Output " Subindo PostgreSQL local (Docker Compose)"
Write-Output "============================================================"

Push-Location $root
try {
    docker compose up -d
    if ($LASTEXITCODE -ne 0) { throw "Falha ao subir o container." }

    Write-Output "Aguardando o banco local ficar saudável..."
    $maxTries = 20
    $tries = 0
    do {
        Start-Sleep -Seconds 2
        $status = docker inspect --format='{{.State.Health.Status}}' trocapreco-postgres-local 2>$null
        $tries++
    } while ($status -ne "healthy" -and $tries -lt $maxTries)

    if ($status -ne "healthy") {
        throw "Banco local não ficou saudável a tempo. Verifique 'docker logs trocapreco-postgres-local'."
    }

    Write-Output "Banco local pronto."
    Write-Output ""
    Write-Output "============================================================"
    Write-Output " Restaurando dump: $($latestDump.Name)"
    Write-Output "============================================================"

    # Recria o schema public do zero antes de restaurar (idempotente)
    docker exec -e PGPASSWORD="$($env:LOCAL_DB_PASSWORD)" trocapreco-postgres-local `
        psql -U "$($env:LOCAL_DB_USER)" -d "$($env:LOCAL_DB_NAME)" `
        -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

    # Copia o dump para dentro do container e restaura
    docker cp "$($latestDump.FullName)" "trocapreco-postgres-local:/tmp/restore.sql"

    docker exec -e PGPASSWORD="$($env:LOCAL_DB_PASSWORD)" trocapreco-postgres-local `
        psql -U "$($env:LOCAL_DB_USER)" -d "$($env:LOCAL_DB_NAME)" -f /tmp/restore.sql

    if ($LASTEXITCODE -ne 0) {
        Write-Warning "psql retornou código de erro — revise o log acima (pode ser apenas 'já existe', que é normal em alguns objetos)."
    }

    $connString = "postgresql://" + $env:LOCAL_DB_USER + ":" + $env:LOCAL_DB_PASSWORD + "@localhost:" + $env:LOCAL_DB_PORT + "/" + $env:LOCAL_DB_NAME

    Write-Output ""
    Write-Output "Restauração concluída."
    Write-Output ""
    Write-Output "Conexão local para testes:"
    Write-Output ("  " + $connString)
    Write-Output ""
    Write-Output "Para usar no backend, crie backend/.env.local com:"
    Write-Output ("  DATABASE_URL_TROCAPRECOS=" + $connString)
}
finally {
    Pop-Location
}

