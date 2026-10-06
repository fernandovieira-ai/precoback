/**
 * arquivo: config/database.js
 * descrição: arquivo responsável pelas requisições no banco de dados
 * data: 29/01/2026
 */

const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

// Em desenvolvimento, .env.local (se existir) sobrepõe a conexão para
// apontar para o banco local de testes (Docker). Nunca afeta produção.
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local", override: true });
}

const isDevelopment = process.env.NODE_ENV !== 'production';

//=> conexão com a base de dados trocaprecos
const pool_trocaprecos = new Pool({
  connectionString: process.env.DATABASE_URL_TROCAPRECOS,
  max: 20, // Máximo de conexões no pool
  idleTimeoutMillis: 30000, // Libera conexões ociosas após 30s
  connectionTimeoutMillis: 10000, // Timeout para obter conexão: 10s
  allowExitOnIdle: false, // Mantém o processo ativo mesmo sem conexões
});

// Tratamento de erros
pool_trocaprecos.on("error", (err, client) => {
  console.error("⚠️  Erro inesperado no cliente ocioso:", err.message);
  // NOTA: Não mata o servidor para permitir testes sem banco configurado
  // process.exit(-1);
});

// Confirmação de conexão
pool_trocaprecos.on("connect", () => {
  if (isDevelopment) {
    console.log("✅ Base de dados TrocaPrecos conectada com sucesso!");
  }
});

// Monitoramento de saúde do pool (desenvolvimento)
if (isDevelopment) {
  setInterval(() => {
    const { totalCount, idleCount, waitingCount } = pool_trocaprecos;
    if (waitingCount > 0 || totalCount >= 15) {
      console.log(`📊 Pool Status: Total: ${totalCount}, Idle: ${idleCount}, Waiting: ${waitingCount}`);
    }
  }, 30000); // A cada 30 segundos
}

// Função para executar queries (usa pool diretamente - mais eficiente)
const query_trocaprecos = async (text, params) => {
  if (isDevelopment) {
    console.log("📝 Executando query:", text.substring(0, 100) + "...");
    if (params) console.log("📦 Parâmetros:", params);
  }

  try {
    const start = Date.now();
    const res = await pool_trocaprecos.query(text, params);
    const duration = Date.now() - start;

    if (isDevelopment && duration > 1000) {
      console.log(`⏱️  Query lenta (${duration}ms):`, text.substring(0, 80) + "...");
    }

    return res;
  } catch (err) {
    console.error("❌ Erro na query:", err.message);
    console.error("📄 Query:", text.substring(0, 200));
    if (params) console.error("📦 Params:", params);
    throw err;
  }
};

module.exports = {
  query_trocaprecos,
};
