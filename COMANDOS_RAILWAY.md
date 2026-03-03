# ⚡ Comandos Rápidos - Railway

## 🚀 Deploy Inicial

```bash
# 1. Instalar Railway CLI
npm i -g @railway/cli

# 2. Fazer login
railway login

# 3. Ir para pasta do backend
cd backend

# 4. Inicializar projeto (primeira vez)
railway init

# 5. Fazer deploy
railway up

# 6. Abrir no navegador
railway open
```

---

## 🔧 Gerenciar Variáveis de Ambiente

```bash
# Ver todas as variáveis
railway variables

# Adicionar variável
railway variables set DATABASE_URL_TROCAPRECOS="postgresql://..."
railway variables set SECRET="sua_chave_aqui"
railway variables set NODE_ENV="production"

# Remover variável
railway variables delete NOME_VARIAVEL
```

---

## 📊 Monitoramento

```bash
# Ver logs em tempo real
railway logs

# Ver logs com filtro
railway logs --filter="error"

# Ver status do deploy
railway status

# Abrir dashboard
railway open
```

---

## 🔄 Redeploy

```bash
# Redeploy completo
railway up

# Redeploy forçado (rebuild)
railway up --force

# Redeploy de um serviço específico
railway up --service backend
```

---

## 🧪 Teste Local Antes do Deploy

```bash
# 1. Instalar dependências
npm install

# 2. Copiar .env.example para .env
cp .env.example .env

# 3. Editar .env com suas credenciais
# (Usar editor de texto)

# 4. Rodar localmente
npm start

# 5. Testar endpoint
curl http://localhost:3000/

# 6. Testar login
curl -X POST http://localhost:3000/drfPriceSwap/login \
  -H "Content-Type: application/json" \
  -d '{"nom_usuario":"teste","senha":"teste","schema":"zmaisz"}'
```

---

## 🔍 Debug

```bash
# Ver informações do projeto
railway status

# Ver domínio público
railway domain

# Conectar ao banco (se tiver)
railway connect

# Executar comando no container
railway run node --version
railway run npm --version
```

---

## 🌐 Domínio Customizado

```bash
# Adicionar domínio customizado
railway domain add seu-dominio.com

# Ver domínios configurados
railway domain list

# Remover domínio
railway domain remove seu-dominio.com
```

---

## 📦 Serviços

```bash
# Listar serviços
railway service list

# Selecionar serviço
railway service select backend

# Ver configuração do serviço
railway service info
```

---

## 🗑️ Limpar/Remover

```bash
# Remover projeto (CUIDADO!)
railway delete

# Deslinkar projeto local
railway unlink
```

---

## 🔗 Links Úteis

```bash
# Abrir dashboard do projeto
railway open

# Abrir aplicação deployada
railway open --service

# Abrir documentação
open https://docs.railway.app
```

---

## 💾 Backup de Variáveis

```bash
# Exportar variáveis para arquivo
railway variables > railway-vars-backup.txt

# Ou manualmente:
railway variables | grep "=" > .env.railway
```

---

## 🎯 Deploy Específico por Branch

```bash
# Ver configuração atual
railway status

# Deploy de branch específica (se configurado no GitHub)
# Isso é feito no dashboard do Railway em Settings > Source
```

---

## 📝 Exemplo Completo: Deploy do Zero

```bash
# 1. Instalar CLI
npm i -g @railway/cli

# 2. Login
railway login

# 3. Entrar na pasta
cd c:\Linx\cliente\digitalrf\projeto\trocapreco\backend

# 4. Criar projeto
railway init
# Selecionar: Create new project
# Nome: trocapreco-backend

# 5. Adicionar variáveis
railway variables set DATABASE_URL_TROCAPRECOS="postgresql://drftrocapreco:senha@cloud.digitalrf.com.br:5432/drftrocapreco"
railway variables set SECRET="123Mud@r"
railway variables set NODE_ENV="production"

# 6. Deploy
railway up

# 7. Ver logs
railway logs

# 8. Pegar URL pública
railway domain
# Exemplo: https://trocapreco-backend-production.up.railway.app

# 9. Testar
curl https://trocapreco-backend-production.up.railway.app/
```

---

## ⚠️ Troubleshooting Rápido

```bash
# Build falhou? Ver logs detalhados
railway logs --service backend

# Deploy travado? Forçar rebuild
railway up --force

# Variáveis erradas? Verificar
railway variables

# Banco não conecta? Testar conexão
# (Usar ferramenta como DBeaver ou psql)
psql "postgresql://usuario:senha@host:porta/database"

# Railway CLI não funciona? Reinstalar
npm uninstall -g @railway/cli
npm i -g @railway/cli
railway login
```

---

## 🎉 Comandos para CI/CD (GitHub Actions)

Se quiser automatizar via GitHub Actions:

```yaml
# .github/workflows/deploy.yml
name: Deploy to Railway

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm i -g @railway/cli
      - run: railway up
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

Para pegar o token:
```bash
railway token
# Adicionar como secret no GitHub: RAILWAY_TOKEN
```
