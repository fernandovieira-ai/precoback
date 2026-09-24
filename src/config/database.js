/**
 * arquivo: config/database.js
 * descrição: arquivo responsável pelas requisições no banco de dados
 * data: 29/01/2026
 */

const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

const isDevelopment = process.env.NODE_ENV !== 'production';

//=> conexão com a base de dados trocaprecos
const pool_trocaprecos = new Pool({
  connectionString: process.env.DATABASE_URL_TROCAPRECOS,
  max: 30,                          // Aumentar de 10 para 30 conexões
  min: 5,                           // Manter mínimo 5 conexões abertas
  idleTimeoutMillis: 45000,         // Fechar conexão ociosa após 45s
  connectionTimeoutMillis: 15000,   // Timeout para obter conexão = 15s
  statement_timeout: 60000,         // Timeout em queries = 60s
  allowExitOnIdle: true,
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

// Função para executar queries
const query_trocaprecos = (text, params) => {
  if (isDevelopment) {
    console.log("📝 Executando query:", text);
    if (params) console.log("📦 Parâmetros:", params);
  }

  return pool_trocaprecos.connect().then((client) => {
    return client
      .query(text, params)
      .then((res) => {
        client.release();
        return res;
      })
      .catch((err) => {
        client.release();
        console.error("❌ Erro na query:", err.stack);
        throw err;
      });
  });
};

module.exports = {
  query_trocaprecos,
};
