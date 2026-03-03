# 🚀 Backend TrocaPreco

Backend para o sistema de troca de preços de combustíveis e produtos.

## 📦 Tecnologias

- **Node.js** - Runtime JavaScript
- **Express** - Framework web
- **Socket.IO** - WebSocket para comunicação em tempo real
- **PostgreSQL** - Banco de dados
- **JWT** - Autenticação
- **Moment.js** - Manipulação de datas

## 🔧 Instalação Local

```bash
# 1. Clonar repositório
git clone https://github.com/fernandovieira-ai/precoback.git
cd precoback

# 2. Instalar dependências
npm install

# 3. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais

# 4. Iniciar servidor
npm start

# Para desenvolvimento com hot reload:
npm run dev
```

## 🌐 Deploy no Railway

### Opção 1: Via Interface Web (Recomendado)

1. Acesse https://railway.app
2. Clique em **"New Project"**
3. Selecione **"Deploy from GitHub repo"**
4. Escolha o repositório `fernandovieira-ai/precoback`
5. Railway detectará automaticamente `railway.json`
6. Configure as variáveis de ambiente:
   - `DATABASE_URL_TROCAPRECOS`
   - `SECRET`
   - `NODE_ENV=production`
7. Aguarde o deploy finalizar

### Opção 2: Via Railway CLI

```bash
# 1. Instalar Railway CLI
npm i -g @railway/cli

# 2. Login
railway login

# 3. Inicializar projeto
railway init

# 4. Adicionar variáveis
railway variables set DATABASE_URL_TROCAPRECOS="postgresql://..."
railway variables set SECRET="sua_chave"
railway variables set NODE_ENV="production"

# 5. Deploy
railway up
```

## 🔐 Variáveis de Ambiente

Variáveis necessárias no Railway:

```env
DATABASE_URL_TROCAPRECOS=postgresql://usuario:senha@host:porta/database
SECRET=sua_chave_jwt_secreta
NODE_ENV=production
```

⚠️ **Não defina `PORT`** - Railway configura automaticamente

## 🧪 Testar o Backend

### Localmente
```bash
npm test
```

### Em Produção
```bash
npm run test:prod
# ou
BACKEND_URL=https://sua-url.up.railway.app npm test
```

### Manual
```bash
# Health check
curl https://sua-url.up.railway.app/

# Resposta esperada:
# {"statusCode":200,"msg":"Api trocapreco funcionando"}
```

## 📚 Documentação

- [Deploy Railway - Guia Completo](./RAILWAY_DEPLOY.md)
- [Comandos Rápidos](./COMANDOS_RAILWAY.md)

## 🏗️ Estrutura do Projeto

```
backend/
├── src/
│   ├── config/
│   │   └── database.js      # Configuração PostgreSQL
│   ├── controllers/
│   │   └── drfPriceSwap.js  # Lógica de negócios
│   ├── routes/
│   │   ├── index.js         # Rota raiz
│   │   └── drfPriceSwap.js  # Rotas da API
│   └── app.js               # Configuração Express
├── server.js                # Servidor HTTP + Socket.IO
├── railway.json             # Configuração Railway
├── package.json             # Dependências
└── .env.example             # Template de variáveis
```

## 🔌 Endpoints Principais

### Autenticação
```http
POST /drfPriceSwap/login
Content-Type: application/json

{
  "nom_usuario": "usuario",
  "senha": "senha",
  "schema": "schema"
}
```

### Buscar Negociações
```http
POST /drfPriceSwap/buscaNegociacoesEmpresa
Authorization: Bearer {token}
Content-Type: application/json

{
  "schema": "zmaisz",
  "cod_empresa": [155]
}
```

Ver documentação completa dos endpoints na aplicação frontend.

## 🔄 WebSocket Events

### Conectar
```javascript
socket.emit('usuarioApp', {
  usuario: 'nome_usuario',
  app: 'trocaPreco'
});
```

### Atualizar Tarefas
```javascript
socket.emit('atualizacaoTarefas', {
  usuario: 'nome_usuario'
});
```

### Receber Atualizações
```javascript
socket.on('atualizarTarefas', () => {
  // Atualizar lista de tarefas
});
```

## 🌍 CORS Configurado

Origens permitidas:
- `localhost:4200` e `localhost:8100`
- IPs locais `192.168.x.x`
- Qualquer domínio `.vercel.app`
- `https://trocaprecopub.vercel.app`

Para adicionar mais origens, edite `src/app.js`.

## 📊 Monitoramento

```bash
# Ver logs
railway logs

# Ver status
railway status

# Ver domínio
railway domain
```

## 🛠️ Scripts Disponíveis

```bash
npm start        # Iniciar servidor
npm run dev      # Modo desenvolvimento (nodemon)
npm test         # Testar backend local
npm run test:prod # Testar backend em produção
```

## 🔗 Links Úteis

- **GitHub:** https://github.com/fernandovieira-ai/precoback
- **Railway:** https://railway.app
- **Frontend:** https://github.com/fernandovieira-ai/trocapreco

## 📝 Licença

ISC

---

**Desenvolvido por Fernando Vieira**
