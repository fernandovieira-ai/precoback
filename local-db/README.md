# Base Local de Testes (cópia de produção)

Ambiente isolado para testar mudanças de schema/procedures (ex: o sistema
de autonomia de descontos) **sem tocar na base de produção**.

Usa Docker, então não precisa instalar PostgreSQL no Windows.

---

## ⚠️ Antes de tudo

- Esta pasta contém **credenciais de produção** (`.env`) e vai conter
  **dumps com dados reais** (`dumps/*.sql`). Nada disso deve ir para o git —
  já está protegido pelo `.gitignore` da raiz do projeto.
- **Não faça commit/push deste diretório até validar as alterações
  localmente.** Depois de testado, só o código de aplicação (procedures,
  migrations, telas) deve subir — nunca os dumps ou o `.env` com senha real.
- O dump é **somente leitura** na produção (`pg_dump` não altera nada).

---

## Passo a passo

### 1. Pré-requisito: Docker Desktop rodando

Verifique com `docker --version`. Se não tiver, instale o Docker Desktop.

### 2. Gerar o dump da produção

```powershell
cd backend/local-db/scripts
./1-dump-producao.ps1
```

Isso conecta em `cloud.digitalrf.com.br` (credenciais já em `local-db/.env`,
copiadas de `backend/.env`) e salva um dump em `local-db/dumps/dump_<data>.sql`.
Pede confirmação antes de executar.

### 3. Subir o banco local e restaurar o dump

```powershell
./2-restore-local.ps1
```

Isso:
- Sobe um container PostgreSQL 16 local (porta **5433**, para não conflitar
  com nada na 5432).
- Recria o schema `public` do zero dentro do container local.
- Restaura o dump mais recente.

### 4. Apontar o backend para o banco local

```powershell
cd ../../..   # volta para backend/
copy .env.local.example .env.local
```

O `.env.local` já vem apontando para
`postgresql://drftrocapreco_local:localdev123@localhost:5433/drftrocapreco_local`.

Rode o backend normalmente (`npm start` / `node server.js`) — o
`database.js` foi ajustado para carregar `.env.local` **apenas fora de
produção**, sobrepondo `DATABASE_URL_TROCAPRECOS`. Sem esse arquivo, nada
muda e o backend continua usando `.env` (produção) como sempre.

### 5. Testar as alterações (procedures, tabelas novas, etc.)

Rode os scripts SQL da proposta de autonomia de descontos direto contra o
banco local:

```powershell
docker exec -it trocapreco-postgres-local psql -U drftrocapreco_local -d drftrocapreco_local
```

Ou use um cliente gráfico (DBeaver, pgAdmin) apontando para
`localhost:5433`.

### 6. Resetar e recomeçar (se necessário)

```powershell
cd backend/local-db/scripts
./3-reset-local.ps1
./2-restore-local.ps1
```

---

## Depois de validar

Quando as mudanças estiverem testadas e aprovadas:

1. Extraia **apenas o SQL das alterações de schema/procedure** (não o dump
   inteiro) para um script de migration versionado no projeto.
2. Faça commit só desse script de migration.
3. Aplique manualmente (ou via pipeline) na produção, fora deste fluxo local.

Os arquivos desta pasta (`local-db/`) continuam existindo só como
ferramenta de desenvolvimento — nunca como fonte de verdade do schema de
produção.
