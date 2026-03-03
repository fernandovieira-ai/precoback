# 🚂 Deploy do Backend TrocaPreco no Railway

## 📋 Pré-requisitos

- Conta no Railway: https://railway.app
- Banco de dados PostgreSQL acessível pela internet
- Git instalado

---

## 🚀 Passo a Passo para Deploy

### 1️⃣ Preparar o Projeto

O projeto já está configurado com:
- ✅ `railway.json` - Configurações do Railway
- ✅ `package.json` com script `start`
- ✅ `.gitignore` - Não sobe arquivos sensíveis
- ✅ `.env.example` - Template de variáveis

### 2️⃣ Criar Projeto no Railway

1. Acesse https://railway.app
2. Clique em **"New Project"**
3. Escolha **"Deploy from GitHub repo"** (ou "Empty Project" se preferir CLI)

#### Opção A: Via GitHub (Recomendado)
1. Conecte seu repositório GitHub
2. Selecione o repositório do projeto
3. Railway detectará automaticamente a pasta `backend`

#### Opção B: Via Railway CLI
```bash
# Instalar Railway CLI
npm i -g @railway/cli

# Login
railway login

# Ir para a pasta do backend
cd backend

# Inicializar projeto
railway init

# Fazer deploy
railway up
```

### 3️⃣ Configurar Variáveis de Ambiente

No painel do Railway, vá em **"Variables"** e adicione:

```env
DATABASE_URL_TROCAPRECOS=postgresql://usuario:senha@host:porta/database
SECRET=sua_chave_secreta_jwt_aqui
NODE_ENV=production
```

#### 📝 Exemplo de DATABASE_URL:
```
postgresql://drftrocapreco:senha@cloud.digitalrf.com.br:5432/drftrocapreco
```

⚠️ **IMPORTANTE:**
- Não coloque a variável `PORT` - o Railway define automaticamente
- Use o mesmo `SECRET` que está no `.env` local para manter compatibilidade

### 4️⃣ Configurar Build

O Railway já detecta automaticamente pelo `railway.json`:
- **Builder:** NIXPACKS (Node.js)
- **Start Command:** `node server.js`
- **Restart Policy:** ON_FAILURE (até 10 tentativas)

### 5️⃣ Deploy Automático

Após configurar as variáveis:
1. Railway fará o deploy automaticamente
2. Aguarde a build terminar (2-5 minutos)
3. Railway fornecerá uma URL pública: `https://seu-projeto.up.railway.app`

---

## 🧪 Testar o Backend

### Teste 1: Health Check
```bash
curl https://seu-projeto.up.railway.app/
```

**Resposta esperada:**
```json
{
  "statusCode": 200,
  "msg": "Api trocapreco funcionando"
}
```

### Teste 2: Endpoint de Login
```bash
curl -X POST https://seu-projeto.up.railway.app/drfPriceSwap/login \
  -H "Content-Type: application/json" \
  -d '{
    "nom_usuario": "seu_usuario",
    "senha": "sua_senha",
    "schema": "seu_schema"
  }'
```

### Teste 3: WebSocket
Abra o console do navegador em `https://seu-projeto.up.railway.app` e verifique se não há erros de CORS.

---

## 🔧 Configurações Importantes

### CORS - Origens Permitidas

O backend já aceita:
- ✅ `localhost:4200` e `localhost:8100`
- ✅ IPs da rede local `192.168.x.x`
- ✅ Qualquer domínio `.vercel.app`
- ✅ `https://trocaprecopub.vercel.app`

Para adicionar mais origens, edite `src/app.js` linha 14-21.

### WebSocket (Socket.IO)

Configurado em `server.js` linhas 16-36:
- ✅ CORS habilitado para as mesmas origens
- ✅ Eventos: `usuarioApp`, `atualizacaoTarefas`
- ✅ Suporta reconexão automática

---

## 📊 Monitoramento

### Logs em Tempo Real
```bash
railway logs
```

### Ver Deploy Atual
```bash
railway status
```

### Métricas no Painel
- CPU Usage
- Memory Usage
- Network Traffic
- Requests/segundo

---

## 🔄 Redeploy após Alterações

### Automático (via GitHub)
1. Faça commit das alterações
2. Push para o repositório
3. Railway faz deploy automaticamente

### Manual (via CLI)
```bash
cd backend
railway up
```

---

## 🐛 Troubleshooting

### ❌ Erro: "Cannot connect to database"
**Solução:** Verifique se `DATABASE_URL_TROCAPRECOS` está correta e se o banco aceita conexões externas.

### ❌ Erro: "Application failed to respond"
**Solução:**
1. Verifique os logs: `railway logs`
2. Confirme que não está usando variável `PORT` customizada
3. Certifique-se que o banco está acessível

### ❌ Erro: "CORS policy blocked"
**Solução:** Adicione a origem do frontend em `src/app.js` linha 14-21.

### ❌ Erro: "Module not found"
**Solução:**
1. Verifique se `package.json` tem todas as dependências
2. Delete `node_modules` local antes do deploy
3. Railway instala dependências automaticamente

---

## 📱 Conectar Frontend

Após o deploy, atualize o frontend:

### Arquivo: `src/environments/environment.prod.ts`
```typescript
export const environment = {
  production: true,
  endPoint: 'https://seu-projeto.up.railway.app/drfPriceSwap'
};
```

### WebSocket no Frontend
```typescript
const socket = io('https://seu-projeto.up.railway.app', {
  transports: ['websocket', 'polling']
});
```

---

## 💡 Dicas de Performance

1. **Use Railway Pro** para melhor performance (não dorme)
2. **Configure Health Checks** para manter o servidor ativo
3. **Ative Cache** no banco de dados
4. **Monitore uso de memória** - Node.js pode usar até 512MB no plano gratuito

---

## 🔒 Segurança

✅ **Já configurado:**
- Variável `SECRET` para JWT
- CORS restrito a origens específicas
- `.env` não commitado (está no `.gitignore`)
- HTTPS automático no Railway

⚠️ **Recomendações:**
- Troque o `SECRET` para produção
- Use senhas fortes no banco
- Monitore tentativas de login suspeitas

---

## 📞 Suporte

- Railway Docs: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- PostgreSQL Docs: https://www.postgresql.org/docs/

---

## ✅ Checklist Final

- [ ] Variáveis de ambiente configuradas
- [ ] Build finalizada com sucesso
- [ ] Health check retorna 200
- [ ] Login funciona
- [ ] WebSocket conecta
- [ ] Frontend conectado ao backend
- [ ] Logs sem erros críticos
- [ ] CORS configurado corretamente

🎉 **Backend pronto para produção!**
