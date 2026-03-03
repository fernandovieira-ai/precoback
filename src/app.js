/**
 * arquivo: app.js
 * descrição: arquivo responsável por fazer a configuração do express
 * data: 29/01/2026
 */

const express = require("express");
const cors = require("cors");

const app = express();

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      "http://localhost",
      "http://localhost:4200",
      "http://localhost:8100",
      "http://192.168.100.12:4200",
      "https://drf-trocaprecos.web.app",
      "https://trocaprecopub.vercel.app",
    ];

    if (!origin) return callback(null, true);
    if (origin.endsWith(".vercel.app")) return callback(null, true);
    if (origin.endsWith(".railway.app")) return callback(null, true);
    if (origin.endsWith(".digitalrf.com.br")) return callback(null, true);

    // Permitir qualquer IP da rede local 192.168.x.x
    if (origin && /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin)) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS: origem nao permitida: " + origin));
    }
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

//> rotas da api trocapreco
const index = require("./routes/index");
const drfPriceSwap = require("./routes/drfPriceSwap");

app.use(express.urlencoded({ extended: true }, { limit: "50mb" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.json({ type: "application/vnd.api+json" }));
app.use(cors(corsOptions));

app.use(index);
app.use("/drfPriceSwap/", drfPriceSwap);

module.exports = app;
