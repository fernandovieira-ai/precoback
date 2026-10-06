# ============================================================================
# 1-dump-producao.ps1
#
# Conecta na base de PRODUÇÃO (somente leitura) e gera um dump completo
# (formato custom, compactado) salvo em backend/local-db/dumps/.
#
# Não altera nada em produção. Usa um container Docker temporário com as
# ferramentas do PostgreSQL — não precisa instalar nada no Windows.
# ============================================================================

param(
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

if (-not (Test-Path $envFile)) {
    Write-Error "Arquivo .env não encontrado em $envFile. Copie .env.example para .env e preencha as credenciais de produção."
    exit 1
}

# Carrega variáveis do .env
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$' -and $_ -notmatch '^\s*#') {
        $name = $matches[1]
        $value = $matches[2]
        Set-Item -Path "env:$name" -Value $value
    }
}

if (-not $env:PROD_DB_HOST -or -not $env:PROD_DB_USER) {
    Write-Error "Credenciais de produção (PROD_DB_*) não preenchidas no .env"
    exit 1
}

$dumpsDir = Join-Path $root "dumps"
New-Item -ItemType Directory -Force -Path $dumpsDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dumpFile = "dump_${timestamp}.sql"
$dumpPathHost = Join-Path $dumpsDir $dumpFile

Write-Output "============================================================"
Write-Output " Gerando dump da base de PRODUÇÃO"
Write-Output " Host: $($env:PROD_DB_HOST)"
Write-Output " Database: $($env:PROD_DB_NAME)"
Write-Output " Destino: $dumpPathHost"
Write-Output "============================================================"
Write-Output ""
Write-Output "ATENÇÃO: este dump conterá dados reais (clientes, senhas com hash, etc)."
Write-Output "Ele fica em backend/local-db/dumps/, que é ignorado pelo git."
Write-Output ""

if (-not $Yes) {
    $confirm = Read-Host "Confirma a extração do dump de produção? (s/n)"
    if ($confirm -ne "s") {
        Write-Output "Operação cancelada."
        exit 0
    }
}

# Monta a imagem docker temporária com pg_dump, montando a pasta de dumps
docker run --rm `
    -v "${dumpsDir}:/dumps" `
    -e PGPASSWORD="$($env:PROD_DB_PASSWORD)" `
    postgres:16-alpine `
    pg_dump `
        --host="$($env:PROD_DB_HOST)" `
        --port="$($env:PROD_DB_PORT)" `
        --username="$($env:PROD_DB_USER)" `
        --dbname="$($env:PROD_DB_NAME)" `
        --no-owner `
        --no-privileges `
        --format=plain `
        --file="/dumps/$dumpFile"

if ($LASTEXITCODE -ne 0) {
    Write-Error "Falha ao gerar o dump. Verifique as credenciais e a conectividade com $($env:PROD_DB_HOST)."
    exit 1
}

Write-Output ""
Write-Output "Dump gerado com sucesso: $dumpPathHost"
Write-Output "Próximo passo: execute 2-restore-local.ps1"

