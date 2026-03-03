Write-Host "Iniciando Backend TrocaPreco..." -ForegroundColor Green
Write-Host "Porta: 3000" -ForegroundColor Cyan
Write-Host "Pressione Ctrl+C para parar" -ForegroundColor Yellow
Write-Host ""

Set-Location $PSScriptRoot
node server.js
