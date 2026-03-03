/**
 * arquivo: routes/index.js
 * descrição: rota padrão da API
 * data: 29/01/2026
 */

const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.status(200).send({
    success: true,
    message: "API TrocaPreco - Backend Online",
    version: "1.0.0",
  });
});

module.exports = router;
