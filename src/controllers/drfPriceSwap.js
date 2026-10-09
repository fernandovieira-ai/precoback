/* eslint-disable no-unused-vars */
/**
 * arquivo: controllers/drfPriceSwap.js
 * descrição: arquivo responsável pela lógica do CRUD (API) TrocaPreco
 * data: 29/01/2026 (atualizado com correção da procedure)
 * autor: Renato Filho
 */

const db = require("../config/database");
require("dotenv-safe").config();
const moment = require("moment");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const { Console } = require("console");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

/**
 * Busca a menor margem (preço negociado - custo médio) entre os itens de um
 * lote/empresa e valida se o usuário tem autonomia para aprovar essa margem.
 * Usa o "piores caso" (MIN) do lote como critério conservador.
 */
async function sistemaAutonomiaAtivo(schema) {
  const result = await db.query_trocaprecos(
    `SELECT ind_ativo FROM ${schema}.tbl_parametro_autonomia WHERE cod_parametro = 1`,
  );
  return result.rows[0]?.ind_ativo === "S";
}

async function validarAutonomia(schema, cod_usuario, cod_empresa, seq_lote) {
  const margemResult = await db.query_trocaprecos(
    `SELECT MIN(val_margem) AS margem_minima
       FROM ${schema}.vw_negociacao_margem
      WHERE seq_lote_alteracao = $1
        AND cod_empresa = $2`,
    [seq_lote, cod_empresa],
  );

  const margemBruta = margemResult.rows[0]?.margem_minima;

  if (margemBruta === null || margemBruta === undefined) {
    return {
      pode_aprovar: false,
      perfil: "sem_dados",
      margem_autonomia: null,
      margem_negociacao: null,
      motivo: "Não foi possível calcular a margem deste lote (custo não encontrado).",
    };
  }

  // val_preco_venda/val_custo_medio são float8: a subtração entre eles gera
  // ruído de ponto flutuante (ex: 0.08650999999999964 em vez de 0.09).
  // Arredonda para centavos ANTES de comparar com a autonomia configurada —
  // senão a regra nunca bate exatamente com o valor mostrado na tela.
  const margemMinima = Math.round(margemBruta * 100) / 100;

  const validacao = await db.query_trocaprecos(
    `SELECT * FROM ${schema}.fn_validar_autonomia_aprovacao($1, $2, $3)`,
    [cod_usuario, margemMinima, cod_empresa],
  );

  const row = validacao.rows[0];

  return {
    pode_aprovar: row.pode_aprovar,
    perfil: row.perfil,
    // NUMERIC do Postgres volta como string no driver pg (para não perder
    // precisão) — o frontend chama .toFixed() direto nesses campos, então
    // aqui garantimos number sempre, senão .toFixed() quebra em silêncio
    // (promise rejeitada sem tratamento, o alerta nunca chega a aparecer).
    margem_autonomia: row.margem_autonomia !== null ? Number(row.margem_autonomia) : null,
    margem_negociacao: margemMinima !== null && margemMinima !== undefined ? Number(margemMinima) : null,
    motivo: row.motivo,
  };
}

/**
 * Avalia a autonomia ITEM A ITEM (cliente a cliente) dentro de um lote, em
 * vez de usar só a pior margem do lote inteiro. Um lote pode ter descontos
 * distintos por cliente/produto — se um item está dentro da autonomia e
 * outro não, só o segundo deve ficar pendente; o primeiro pode ser
 * aprovado normalmente.
 */
async function avaliarItensLote(schema, cod_usuario, cod_empresa, seq_lote) {
  const result = await db.query_trocaprecos(
    `SELECT v.seq_registro, v.cod_item, v.val_margem,
            f.pode_aprovar, f.perfil, f.margem_autonomia, f.motivo
       FROM ${schema}.vw_negociacao_margem v
       LEFT JOIN LATERAL (
         SELECT * FROM ${schema}.fn_validar_autonomia_aprovacao(
           $1, ROUND(v.val_margem::numeric, 2), v.cod_empresa
         )
         WHERE v.val_margem IS NOT NULL
       ) f ON TRUE
      WHERE v.seq_lote_alteracao = $2
        AND v.cod_empresa = $3
        AND v.ind_status = 'X'`,
    [cod_usuario, seq_lote, cod_empresa],
  );

  const liberados = [];
  const bloqueados = [];

  for (const item of result.rows) {
    const margem = item.val_margem !== null ? Math.round(item.val_margem * 100) / 100 : null;

    if (margem === null) {
      bloqueados.push({
        seq_registro: item.seq_registro,
        cod_item: item.cod_item,
        margem: null,
        perfil: "sem_dados",
        margem_autonomia: null,
        motivo: "Custo não encontrado para este item.",
      });
      continue;
    }

    // 'sem_perfil' = nem grupo nem sistema restringem esse item -> legado.
    if (item.perfil === "sem_perfil" || item.pode_aprovar) {
      liberados.push({
        seq_registro: item.seq_registro,
        cod_item: item.cod_item,
        margem,
        perfil: item.perfil,
        margem_autonomia: item.margem_autonomia !== null ? Number(item.margem_autonomia) : null,
      });
    } else {
      bloqueados.push({
        seq_registro: item.seq_registro,
        cod_item: item.cod_item,
        margem,
        perfil: item.perfil,
        margem_autonomia: item.margem_autonomia !== null ? Number(item.margem_autonomia) : null,
        motivo: item.motivo,
      });
    }
  }

  return { totalItens: result.rows.length, liberados, bloqueados };
}

/**
 * Confirma que cod_usuario_admin é, de fato, um administrador ATIVO
 * (tbl_admin_perfis) antes de permitir conceder/revogar acesso de outra
 * pessoa. Sem essa checagem, qualquer chamada direta à API (sem passar
 * pela tela/senha) poderia se autopromover a admin só informando um
 * cod_usuario_admin arbitrário no corpo da requisição.
 */
async function ehAdminAtivo(schema, cod_usuario_admin) {
  if (!cod_usuario_admin) return false;
  const result = await db.query_trocaprecos(
    `SELECT 1 FROM ${schema}.tbl_admin_perfis WHERE cod_usuario = $1 AND ind_ativo = 'S'`,
    [cod_usuario_admin],
  );
  return result.rows.length > 0;
}

// NOTA IMPORTANTE: Este arquivo foi copiado do projeto original
// com a correção aplicada na função sincronizaCadastros para usar
// sp_atualiza_cadastro(param1, param2, param3, param4)

//=> metodo responsavel por fazer login (case-insensitive)
// Aceita usuário em maiúsculo ou minúsculo (SUPORTE, suporte, Suporte)
exports.fazerLogin = async (req, res) => {
  const { nom_usuario, senha } = req.body;

  // Log para debug - login case-insensitive ativo
  console.log(`[LOGIN] Tentativa de login: ${nom_usuario} (case-insensitive)`);

  const user = await db.query_trocaprecos(
    `
    SELECT
      cod_usuario,
      nom_usuario,
      senha,
      schema_base AS schema,
      ARRAY[]::INTEGER[] AS cod_empresa_usuario,
      ARRAY[]::INTEGER[] AS cod_empresa_sel,
      empresa,
      des_rede,
      img_rede,
      ind_aprova_negociacao
    FROM
      tab_usuario
    WHERE
      UPPER(nom_usuario) = UPPER($1)
      AND senha = $2
    AND ind_ativo = 'S'`,
    [nom_usuario, senha],
  );

  if (user.rows.length !== 0) {
    const response = user.rows.map((row) => {
      const { img_rede, ...rest } = row;
      const base64Image = img_rede ? img_rede.toString() : null;
      return { ...rest, img_rede: base64Image };
    });

    const id = (user.rows[0].cod_usuario * 100) / 5;

    const token = jwt.sign({ id }, process.env.SECRET, {
      expiresIn: 3600, // 1h de prazo para expirar a sessão.
    });

    res.status(200).json({ auth: true, token, user: response });
  } else {
    res.status(500).json({
      message: "Usuário e Senha inválidos ou não existentes.",
    });
  }
};

exports.alterarSenha = async (req, res) => {
  const { cod_usuario, senha } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    const empresas = await db.query_trocaprecos(
      "update tab_usuario set senha = $1 where cod_usuario = $2",
      [senha, cod_usuario],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: "Senha Alterada com Sucesso",
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em alterar senha, tente novamente:" + error,
    });
  }
};

exports.novoUsuario = async (req, res) => {
  const {
    nom_usuario,
    senha,
    schema_base,
    des_rede,
    img_rede,
    ind_aprova_negociacao,
  } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    await db.query_trocaprecos(
      `insert into tab_usuario (nom_usuario, senha, schema_base, des_rede, img_rede, ind_aprova_negociacao, ind_ativo)
                                values
                                ($1, $2, $3, $4, $5, $6, 'S')`,
      [
        nom_usuario,
        senha,
        schema_base,
        des_rede,
        img_rede,
        ind_aprova_negociacao,
      ],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: "Usuário Cadastrado com Sucesso.",
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em cadastrar usuario, tente novamente:" + error,
    });
  }
};

// exports.sincronizaCadastros = async (req, res) => {

//   const { schema_base } = req.body;

//   try {

//     await db.query_trocaprecos("BEGIN");

//     await db.query_trocaprecos(`select ${schema_base}.sp_atualiza_usuario('zmaisz')`);

//     await db.query_trocaprecos(`select zmaisz.sp_busca_preco (
//                                 1, --codbase
//                                 ARRAY[0], --codempresa
//                                 ARRAY[0], --coditem
//                                 ARRAY[0], --codpessoa
//                                 ARRAY[0], --codformapagto
//                                 'R'--conexaotipo
//                               )`)

//     await db.query_trocaprecos("COMMIT");

//     res.status(200).json({
//       message: "Atualizacao solicitada"
//     });

//   } catch (error) {

//     await db.query_trocaprecos("ROLLBACK");
//     res.status(500).json({
//       message: "Falha em cadastrar usuario, tente novamente:" + error
//     });
//   }
// };

exports.sincronizaCadastros = async (req, res) => {
  const { schema_base, param1, param2, param3, param4 } = req.body;
  try {
    await db.query_trocaprecos("BEGIN");

    // Chama a procedure correta: sp_atualiza_cadastro com os 4 parâmetros
    const query = `SELECT ${schema_base}.sp_atualiza_cadastro($1, $2, $3, $4) as resultado`;
    const resultadoSP = await db.query_trocaprecos(query, [
      param1,
      param2,
      param3,
      param4,
    ]);

    await db.query_trocaprecos("COMMIT");

    // Retorna o resultado da procedure
    const mensagemRetorno =
      resultadoSP.rows[0]?.resultado || "Sincronização concluída";
    res.status(200).json({
      message: "Dados foram baixados com sucesso",
      detalhe: mensagemRetorno,
      status: "concluído",
    });
  } catch (error) {
    console.error("Erro ao executar sincronizaCadastros:", error);
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha no processo de sincronização: " + error.message,
    });
  }
};

exports.atualizaUsuarios = async (req, res) => {
  const { schema_base } = req.body;
  try {
    await db.query_trocaprecos("BEGIN");

    // Chama a procedure sp_atualiza_usuario
    const query = `SELECT ${schema_base}.sp_atualiza_usuario($1) as resultado`;
    const resultadoSP = await db.query_trocaprecos(query, [schema_base]);

    await db.query_trocaprecos("COMMIT");

    const mensagemRetorno =
      resultadoSP.rows[0]?.resultado || "Usuários atualizados";
    res.status(200).json({
      message: "Usuários atualizados com sucesso",
      detalhe: mensagemRetorno,
      status: "concluído",
    });
  } catch (error) {
    console.error("Erro ao executar sp_atualiza_usuario:", error);
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha ao atualizar usuários: " + error.message,
    });
  }
};

exports.atualizarCadastroClientes = async (req, res) => {
  const { schema } = req.body;
  // Não espera pela conclusão, executa em background
  // Isso permite que o login não seja bloqueado
  setImmediate(async () => {
    try {
      await db.query_trocaprecos("BEGIN");

      // Chama a procedure sp_cadastro_cliente
      const query = `SELECT ${schema}.sp_cadastro_cliente($1) as resultado`;
      const resultadoSP = await db.query_trocaprecos(query, [schema]);

      await db.query_trocaprecos("COMMIT");

      const mensagemRetorno =
        resultadoSP.rows[0]?.resultado || "Cadastro de clientes atualizado";
    } catch (error) {
      console.error(
        "Erro ao executar sp_cadastro_cliente (background):",
        error,
      );
      await db.query_trocaprecos("ROLLBACK");
    }
  });

  // Retorna imediatamente para não bloquear o login
  res.status(200).json({
    message: "Atualização de cadastro iniciada em background",
    status: "processando",
  });
};

exports.removeUsuario = async (req, res) => {
  const { cod_usuario, schema_base } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    await db.query_trocaprecos(
      `update tab_usuario 
                                set ind_ativo = 'N'
                                where cod_usuario = $1
                                and schema_base = $2`,
      [cod_usuario, schema_base],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: "Usuário Desabilitado com Sucesso.",
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em desabilitar usuario, tente novamente:" + error,
    });
  }
};

exports.buscaUsuario = async (req, res) => {
  const { schema_base } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    const users = await db.query_trocaprecos(
      "select cod_usuario, nom_usuario, ind_aprova_negociacao from tab_usuario where schema_base = $1 and ind_ativo = 'S'",
      [schema_base],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: users.rows,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em buscar usuarios, tente novamente:" + error,
    });
  }
};

exports.updateUsuario = async (req, res) => {
  const { cod_usuario, schema_base, status } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    const users = await db.query_trocaprecos(
      "UPDATE tab_usuario set ind_aprova_negociacao = $3 where schema_base = $1 and cod_usuario = $2",
      [schema_base, cod_usuario, status === true ? "S" : "N"],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: "Registro alterado com sucesso",
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em atualizar usuarios, tente novamente:" + error,
    });
  }
};

exports.atualizaSchema = async (req, res) => {
  const { schema, cod_empresa } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    await db.query_trocaprecos(`select ${schema}.sp_busca_preco (
      1, --codbase
      ARRAY[${cod_empresa}], --codempresa
      ARRAY[0], --coditem
      ARRAY[0], --codpessoa
      ARRAY[0], --codformapagto
      'R'--conexaotipo
    )`);

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: "Dados Atualizados com sucesso",
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em atualizar o schema:" + error,
    });
  }
};

exports.buscaEmpresasBase = async (req, res) => {
  const { schema, empresa } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    // Extrair códigos de empresa do array de objetos ou array de IDs
    let empresaIds = [];
    if (Array.isArray(empresa)) {
      // Se for array de objetos {cod_empresa: X}
      if (empresa.length > 0 && typeof empresa[0] === "object") {
        empresaIds = empresa.map((e) => e.cod_empresa);
      } else {
        // Se for array de números
        empresaIds = empresa;
      }
    }

    // Se não houver empresas, retornar vazio
    if (empresaIds.length === 0) {
      await db.query_trocaprecos("COMMIT");
      return res.status(200).json({
        message: [],
      });
    }

    const empresas = await db.query_trocaprecos(
      `select cod_empresa, nom_fantasia, false as ind_selecionado 
       from ${schema}.tab_empresa_schema 
       where cod_empresa = ANY($1::INTEGER[]) 
       order by cod_empresa`,
      [empresaIds],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: empresas.rows,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    console.error("Erro em buscaEmpresasBase:", error);
    res.status(500).json({
      message: "Falha em obter empresas: " + error.message,
    });
  }
};

exports.buscaFiltroPreLoad = async (req, res) => {
  const { schema } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    // await db.query_trocaprecos(`select
    //                   (select  ${schema}.sp_busca_preco (
    //                      1,--codbase
    //                      4,--codempresa
    //                      0,--coditem
    //                      0,--codsubgrupo
    //                      a.cod_pessoa,--codpessoa
    //                      0,--codformapagto
    //                      0,--codregiao
    //                      0,--codclasse
    //                      'R' -- charconexaotipo
    //                   ) `)

    const pessoa = await db.query_trocaprecos(
      `select cod_pessoa, nom_pessoa, coalesce(num_cnpj_cpf, '') as num_cnpj_cpf , cod_regiao_venda, dta_cadastro, false as ind_selecionado from ${schema}.tab_pessoa`,
    );
    const regiao = await db.query_trocaprecos(
      `select cod_regiao_venda, des_regiao_venda, false as ind_selecionado from ${schema}.tab_regiao_venda`,
    );
    // const item = await db.query_trocaprecos(`select distinct
    //                               a.cod_item,
    //                               a.des_item,
    //                               a.cod_barra,
    //                               a.cod_subgrupo,
    //                               false as ind_selecionado,
    //                               b.val_preco_venda,
    //                               b.val_custo_medio,
    //                               b.cod_empresa,
    //                               d.nom_fantasia
    //                               from ${schema}.tab_item a
    //                               inner join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item)
    //                               inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item and c.cod_empresa = b.cod_empresa)
    //                               inner join ${schema}.tab_empresa_schema d on (c.cod_empresa = d.cod_empresa)
    //                               where cod_subgrupo in (1)
    //                               and b.cod_empresa in (${cod_empresa})
    //                               order by cod_item`);
    const subGrupo = await db.query_trocaprecos(
      `select distinct cod_subgrupo, des_subgrupo from ${schema}.tab_item`,
    );
    //const formaPagto = await db.query_trocaprecos(`select distinct cod_forma_pagto, des_forma_pagto, false as ind_selecionado, ind_tipo, false as ind_selecionado_todos from ${schema}.tab_forma_pagto where cod_empresa in (${cod_empresa}) order by cod_forma_pagto`);
    // const itemFull = await db.query_trocaprecos(`select a.cod_item, a.des_item
    //                                   from ${schema}.tab_item a
    //                                   inner join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item)
    //                                   inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item and c.cod_empresa = b.cod_empresa)
    //                                   where a.cod_subgrupo in (1)
    //                                   and b.cod_empresa in (${cod_empresa})
    //                                   group by a.cod_item, a.des_item
    //                                   order by a.cod_item`);
    // const tipoFormaPagto = await db.query_trocaprecos(`select ind_tipo,
    //                                         CASE ind_tipo
    //                                           WHEN 'CC' THEN 'Cartao Credito'
    //                                           WHEN 'CD' THEN 'Cartao Debito'
    //                                           WHEN 'DI' THEN 'Dinheiro'
    //                                           WHEN 'CF' THEN 'Carta Frete'
    //                                           WHEN 'AC' THEN 'Adiantamento Cliente'
    //                                           WHEN 'NP' THEN 'Nota a Prazo'
    //                                           WHEN 'VO' THEN 'Voucher'
    //                                           WHEN 'PL' THEN 'Private Label'
    //                                           WHEN 'CN' THEN 'Cheque Normal'
    //                                           WHEN 'CT' THEN 'CTF'
    //                                           WHEN 'CP' THEN 'Cheque Pre'
    //                                           ELSE ind_tipo
    //                                         END AS des_forma_pagto from ${schema}.tab_forma_pagto where cod_empresa in (${cod_empresa}) group by 1`);

    await db.query_trocaprecos("COMMIT");
    res.status(200).json({
      pessoa: pessoa.rows,
      regiao: regiao.rows,
      //item: item.rows,
      subGrupo: subGrupo.rows,
      //formaPagto: formaPagto.rows,
      //itemfull: itemFull.rows,
      //tipoFormaPagto: tipoFormaPagto.rows
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em obter dados, tente novamente:" + error,
    });
  }
};

exports.buscaFiltro = async (req, res) => {
  const { schema, cod_empresa } = req.body;
  try {
    await db.query_trocaprecos("BEGIN");

    //const pessoa = await db.query_trocaprecos(`select cod_pessoa, nom_pessoa, coalesce(num_cnpj_cpf, '') as num_cnpj_cpf , cod_regiao_venda, false as ind_selecionado from ${schema}.tab_pessoa`);
    //const regiao = await db.query_trocaprecos(`select cod_regiao_venda, des_regiao_venda, false as ind_selecionado from ${schema}.tab_regiao_venda`);
    const item = await db.query_trocaprecos(`select distinct
                                  a.cod_item,
                                  a.des_item,
                                  a.cod_barra,
                                  a.cod_subgrupo,
                                  false as ind_selecionado,
                                  b.val_preco_venda,
                                  b.val_preco_venda_a,
                                  b.val_preco_venda_b,
                                  b.val_preco_venda_c,
                                  b.val_preco_venda_d,
                                  b.val_preco_venda_e,
                                  b.val_custo_medio,
                                  c.cod_empresa,
                                  d.nom_fantasia
                                  from ${schema}.tab_item a
                                  inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item)
                                  inner join ${schema}.tab_empresa_schema d on (c.cod_empresa = d.cod_empresa)
                                  left join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item and b.cod_empresa = c.cod_empresa)
                                  where a.cod_subgrupo in (1, 43, 47)
                                  and c.cod_empresa in (${cod_empresa})
                                  order by a.cod_item`);
    //const subGrupo = await db.query_trocaprecos(`select distinct cod_subgrupo, des_subgrupo from ${schema}.tab_item`);
    const formaPagto = await db.query_trocaprecos(
      `select distinct cod_forma_pagto, des_forma_pagto, false as ind_selecionado, ind_tipo, false as ind_selecionado_todos from ${schema}.tab_forma_pagto where cod_empresa in (${cod_empresa}) order by cod_forma_pagto`,
    );
    const itemFull = await db.query_trocaprecos(`select a.cod_item, a.des_item
                                      from ${schema}.tab_item a
                                      inner join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item)
                                      inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item and c.cod_empresa = b.cod_empresa)
                                      where a.cod_subgrupo in (1, 43)
                                      and b.cod_empresa in (${cod_empresa})
                                      group by a.cod_item, a.des_item
                                      order by a.cod_item`);
    const tipoFormaPagto = await db.query_trocaprecos(`select ind_tipo,
                                            CASE ind_tipo
                                              WHEN 'CC' THEN 'Cartao Credito'
                                              WHEN 'CD' THEN 'Cartao Debito'
                                              WHEN 'DI' THEN 'Dinheiro'
                                              WHEN 'CF' THEN 'Carta Frete'
                                              WHEN 'AC' THEN 'Adiantamento Cliente'
                                              WHEN 'NP' THEN 'Nota a Prazo'
                                              WHEN 'VO' THEN 'Voucher'
                                              WHEN 'PL' THEN 'Private Label'
                                              WHEN 'CN' THEN 'Cheque Normal'
                                              WHEN 'CT' THEN 'CTF'
                                              WHEN 'CP' THEN 'Cheque Pre'
                                              ELSE ind_tipo
                                            END AS des_forma_pagto from ${schema}.tab_forma_pagto where cod_empresa in (${cod_empresa}) group by 1`);

    await db.query_trocaprecos("COMMIT");
    res.status(200).json({
      //pessoa: pessoa.rows,
      //regiao: regiao.rows,
      item: item.rows,
      //subGrupo: subGrupo.rows,
      formaPagto: formaPagto.rows,
      itemfull: itemFull.rows,
      tipoFormaPagto: tipoFormaPagto.rows,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em obter dados, tente novamente:" + error,
    });
  }
};

// Novo endpoint: Busca apenas custos/preços atualizados para itens específicos
// Novo endpoint: Busca clientes com filtro (sob demanda)
exports.buscaClientesFiltro = async (req, res) => {
  const { schema, busca = "", limit = 500 } = req.body;

  // Validar que tem pelo menos 3 caracteres na busca
  if (!busca || busca.trim().length < 3) {
    return res.status(400).json({
      message: "Digite pelo menos 3 caracteres para buscar clientes",
      clientes: [],
    });
  }

  try {
    const buscaTerm = `%${busca.trim().toLowerCase()}%`;

    const query = `
      SELECT
        cod_pessoa,
        nom_pessoa,
        COALESCE(num_cnpj_cpf, '') as num_cnpj_cpf,
        cod_regiao_venda,
        dta_cadastro,
        false as ind_selecionado
      FROM ${schema}.tab_pessoa
      WHERE
        LOWER(nom_pessoa) LIKE $1
        OR num_cnpj_cpf LIKE $2
        OR CAST(cod_pessoa AS TEXT) LIKE $2
      ORDER BY nom_pessoa
      LIMIT $3
    `;

    const result = await db.query_trocaprecos(query, [
      buscaTerm,
      busca.trim(),
      limit,
    ]);

    console.log(
      `[buscaClientesFiltro] Busca: "${busca}" - Encontrados: ${result.rows.length} clientes`,
    );

    res.status(200).json({
      message: "Clientes encontrados",
      clientes: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    console.error("[buscaClientesFiltro] ERRO:", error);
    res.status(500).json({
      message: "Falha ao buscar clientes: " + error.message,
      clientes: [],
    });
  }
};

exports.buscaCustoPrecoItens = async (req, res) => {
  let { schema, cod_empresa, itens } = req.body;

  // Garantir que cod_empresa seja um inteiro
  if (Array.isArray(cod_empresa)) {
    cod_empresa = cod_empresa[0];
  }
  cod_empresa = parseInt(cod_empresa);

  // Extrair array de cod_item
  const codItens = itens.map((item) => item.cod_item);

  try {
    const query = `
      SELECT
        cod_item,
        cod_empresa,
        val_preco_venda,
        val_preco_venda_a,
        val_preco_venda_b,
        val_preco_venda_c,
        val_preco_venda_d,
        val_preco_venda_e,
        val_custo_medio
      FROM ${schema}.tab_custo_preco
      WHERE cod_empresa = $1
      AND cod_item = ANY($2::integer[])
    `;

    const result = await db.query_trocaprecos(query, [cod_empresa, codItens]);

    res.status(200).json({
      custosPrecos: result.rows,
    });
  } catch (error) {
    console.error("[buscaCustoPrecoItens] Erro:", error.message);
    res.status(500).json({
      message: "Falha ao buscar custos/preços: " + error.message,
    });
  }
};

// Novo endpoint: Atualiza custos/preços apenas para itens selecionados
exports.atualizaCustoPrecoPorItens = async (req, res) => {
  let { schema, cod_empresa, itens } = req.body;

  // Garantir que cod_empresa seja um inteiro (caso venha como array)
  if (Array.isArray(cod_empresa)) {
    cod_empresa = cod_empresa[0];
  }
  cod_empresa = parseInt(cod_empresa);

  // Extrair array de cod_item dos itens selecionados
  const codItens = itens.map((item) => item.cod_item);

  try {
    await db.query_trocaprecos("BEGIN");

    // Usar a nova procedure sp_custo_preco_app que aceita arrays
    const empresasArray = `ARRAY[${cod_empresa}]`;
    const itensArray = `ARRAY[${codItens.join(",")}]`;
    const query = `SELECT ${schema}.sp_custo_preco_app(${empresasArray}, ${itensArray})`;

    await db.query_trocaprecos(query);
    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: "Custos e preços atualizados com sucesso",
      itensAtualizados: itens.length,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    console.error("[atualizaCustoPrecoPorItens] Erro:", error.message);
    res.status(500).json({
      message: "Falha ao atualizar custos/preços: " + error.message,
    });
  }
};

exports.buscaItensPrecoAtualizacao = async (req, res) => {
  const { schema, cod_empresa } = req.body;
  try {
    const item = await db.query_trocaprecos(`select distinct
                                  a.cod_item,
                                  a.des_item,
                                  a.cod_barra,
                                  a.cod_subgrupo,
                                  false as ind_selecionado
                                  from ${schema}.tab_item a
                                  where exists (
                                    select 1
                                    from ${schema}.tab_item_empresa aa
                                    where aa.cod_empresa in (${cod_empresa})
                                    and aa.cod_item = a.cod_item
                                  )
                                  order by a.cod_item`);

    const formaPagto = await db.query_trocaprecos(
      `select distinct cod_forma_pagto, des_forma_pagto, false as ind_selecionado, ind_tipo, false as ind_selecionado_todos from ${schema}.tab_forma_pagto where cod_empresa in (${cod_empresa}) order by cod_forma_pagto`,
    );

    res.status(200).json({
      item: item.rows,
      formaPagto: formaPagto.rows,
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha em obter dados, tente novamente:" + error,
    });
  }
};

exports.buscaItemBomba = async (req, res) => {
  const { schema } = req.body;
  let { cod_empresa } = req.body;

  // Garantir que cod_empresa seja um array de números
  let empresasSelecionadas = [];
  if (cod_empresa) {
    if (Array.isArray(cod_empresa)) {
      empresasSelecionadas = cod_empresa.map((e) => parseInt(e, 10));
    } else {
      empresasSelecionadas = [parseInt(cod_empresa, 10)];
    }
  }

  try {
    await db.query_trocaprecos("BEGIN");

    console.log("[buscaItemBomba] Schema:", schema);
    console.log("[buscaItemBomba] Empresas:", empresasSelecionadas);

    // Criar placeholders parametrizados para as empresas
    const placeholders = empresasSelecionadas
      .map((_, i) => `$${i + 1}`)
      .join(",");

    const item = await db.query_trocaprecos(
      `select distinct
                                        a.cod_item,
                                        a.des_item,
                                        a.cod_barra,
                                        a.cod_subgrupo,
                                        false as ind_selecionado,
                                        b.val_preco_venda,
                                        b.val_preco_venda_a,
                                        b.val_preco_venda_b,
                                        b.val_preco_venda_c,
                                        b.val_preco_venda_d,
                                        b.val_preco_venda_e,
                                        b.val_custo_medio,
                                        c.cod_empresa,
                                        d.nom_fantasia,
                                        0 as val_novo_preco_venda
                                        from ${schema}.tab_item a
                                        inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item)
                                        inner join ${schema}.tab_empresa_schema d on (c.cod_empresa = d.cod_empresa)
                                        left join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item and b.cod_empresa = c.cod_empresa)
                                        where a.cod_subgrupo in (1)
                                        and c.cod_empresa in (${placeholders})
                                        order by a.cod_item`,
      empresasSelecionadas,
    );

    console.log("[buscaItemBomba] Itens encontrados:", item.rows.length);

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      item: item.rows,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    console.error("[buscaItemBomba] ERRO:", error);
    res.status(500).json({
      message: "Falha em obter itens:" + error,
    });
  }
};

exports.buscaFiltroItem = async (req, res) => {
  const { schema } = req.body;
  let { cod_empresa } = req.body;

  // Garantir que cod_empresa seja um array de números
  let empresasSelecionadas = [];
  if (cod_empresa) {
    if (Array.isArray(cod_empresa)) {
      empresasSelecionadas = cod_empresa.map((e) => parseInt(e, 10));
    } else {
      empresasSelecionadas = [parseInt(cod_empresa, 10)];
    }
  }

  try {
    await db.query_trocaprecos("BEGIN");

    console.log("[buscaFiltroItem] Schema:", schema);
    console.log("[buscaFiltroItem] Empresas:", empresasSelecionadas);

    // Criar placeholders parametrizados para as empresas
    const placeholders = empresasSelecionadas
      .map((_, i) => `$${i + 1}`)
      .join(",");

    const item = await db.query_trocaprecos(
      `select distinct
                                  a.cod_item,
                                  a.des_item,
                                  a.cod_barra,
                                  a.cod_subgrupo,
                                  false as ind_selecionado,
                                  b.val_preco_venda,
                                  b.val_preco_venda_a,
                                  b.val_preco_venda_b,
                                  b.val_preco_venda_c,
                                  b.val_preco_venda_d,
                                  b.val_preco_venda_e,
                                  b.val_custo_medio,
                                  c.cod_empresa,
                                  d.nom_fantasia
                                  from ${schema}.tab_item a
                                  inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item and c.cod_empresa in (${placeholders}))
                                  inner join ${schema}.tab_empresa_schema d on (c.cod_empresa = d.cod_empresa)
                                  left join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item and b.cod_empresa = c.cod_empresa)
                                  where a.cod_subgrupo in (1)
                                  order by a.cod_item`,
      empresasSelecionadas,
    );

    const formaPagto = await db.query_trocaprecos(
      `select distinct cod_forma_pagto, des_forma_pagto, false as ind_selecionado, ind_tipo from ${schema}.tab_forma_pagto where cod_empresa in (${placeholders}) order by cod_forma_pagto`,
      empresasSelecionadas,
    );

    const itemFull = await db.query_trocaprecos(
      `select a.cod_item, a.des_item
                                      from ${schema}.tab_item a
                                      inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item and c.cod_empresa in (${placeholders}))
                                      left join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item and b.cod_empresa = c.cod_empresa)
                                      where a.cod_subgrupo in (1)
                                      group by a.cod_item, a.des_item
                                      order by a.cod_item`,
      empresasSelecionadas,
    );

    const tipoFormaPagto = await db.query_trocaprecos(
      `select ind_tipo,
                                      CASE ind_tipo
                                        WHEN 'CC' THEN 'Cartao Credito'
                                        WHEN 'CD' THEN 'Cartao Debito'
                                        WHEN 'DI' THEN 'Dinheiro'
                                        WHEN 'CF' THEN 'Carta Frete'
                                        WHEN 'AC' THEN 'Adiantamento Cliente'
                                        WHEN 'NP' THEN 'Nota a Prazo'
                                        WHEN 'VO' THEN 'Voucher'
                                        WHEN 'PL' THEN 'Private Label'
                                        WHEN 'CN' THEN 'Cheque Normal'
                                        WHEN 'CT' THEN 'CTF'
                                        WHEN 'CP' THEN 'Cheque Pre'
                                        ELSE ind_tipo
                                      END AS des_forma_pagto from ${schema}.tab_forma_pagto where cod_empresa in (${placeholders}) group by 1`,
      empresasSelecionadas,
    );

    console.log("[buscaFiltroItem] Itens:", item.rows.length);
    console.log("[buscaFiltroItem] Formas pagto:", formaPagto.rows.length);

    await db.query_trocaprecos("COMMIT");
    res.status(200).json({
      item: item.rows,
      formaPagto: formaPagto.rows,
      itemfull: itemFull.rows,
      tipoFormaPagto: tipoFormaPagto.rows,
      //pessoa: pessoa.rows
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    console.error("[buscaFiltroItem] ERRO:", error);
    res.status(500).json({
      message: "Falha em obter tipos de depesas:" + error,
    });
  }
};

exports.buscaSubgruposPista = async (req, res) => {
  const { schema, modulo } = req.body;
  let { cod_empresa_sel } = req.body;

  // Garantir que cod_empresa_sel é um array de números inteiros
  let empresasSelecionadas = [];
  if (cod_empresa_sel) {
    if (Array.isArray(cod_empresa_sel)) {
      empresasSelecionadas = cod_empresa_sel.map((e) => parseInt(e, 10));
    } else {
      empresasSelecionadas = [parseInt(cod_empresa_sel, 10)];
    }
  }

  try {
    await db.query_trocaprecos("BEGIN");

    console.log(
      `[buscaSubgruposPista] Iniciando - Schema: ${schema}, Empresas: ${empresasSelecionadas.join(", ")}`,
    );

    // Buscar empresas selecionadas
    let empresas;
    if (empresasSelecionadas.length > 0) {
      const placeholders = empresasSelecionadas
        .map((_, i) => `$${i + 1}`)
        .join(",");
      empresas = await db.query_trocaprecos(
        `
        SELECT DISTINCT
          e.cod_empresa,
          e.nom_fantasia
        FROM ${schema}.tab_empresa_schema e
        INNER JOIN ${schema}.tab_item_empresa ie ON e.cod_empresa = ie.cod_empresa
        WHERE e.cod_empresa IN (${placeholders})
        ORDER BY e.cod_empresa
      `,
        empresasSelecionadas,
      );
    } else {
      empresas = await db.query_trocaprecos(`
        SELECT DISTINCT
          e.cod_empresa,
          e.nom_fantasia
        FROM ${schema}.tab_empresa_schema e
        INNER JOIN ${schema}.tab_item_empresa ie ON e.cod_empresa = ie.cod_empresa
        ORDER BY e.cod_empresa
      `);
    }
    // Para cada empresa, buscar subgrupos e itens usando a query otimizada
    const empresasComItens = [];

    for (const empresa of empresas.rows) {
      try {
        // ✅ Query otimizada: Busca direto de tab_item
        // Mostra APENAS produtos COM preço cadastrado (INNER JOIN)
        const itensEmpresa = await db.query_trocaprecos(
          `
          SELECT
            b.cod_subgrupo,
            b.des_subgrupo,
            b.cod_item,
            b.des_item,
            b.cod_barra,
            cp.val_preco_venda,
            cp.val_custo_medio
          FROM ${schema}.tab_item b
          INNER JOIN ${schema}.tab_item_empresa c ON (c.cod_item = b.cod_item)
          INNER JOIN ${schema}.tab_custo_preco cp ON (cp.cod_item = b.cod_item AND cp.cod_empresa = c.cod_empresa)
          WHERE c.cod_empresa = $1
          ORDER BY b.cod_subgrupo, b.des_subgrupo, b.des_item
        `,
          [empresa.cod_empresa],
        );
        // Log dos primeiros itens para debug
        if (itensEmpresa.rows.length > 0) {
          console.log(
            `[buscaSubgruposPista] Primeiros 3 itens:`,
            itensEmpresa.rows.slice(0, 3).map((i) => ({
              cod_item: i.cod_item,
              des_item: i.des_item,
              cod_subgrupo: i.cod_subgrupo,
              des_subgrupo: i.des_subgrupo,
            })),
          );
        }

        // Agrupar itens por subgrupo
        const subgruposMap = new Map();

        itensEmpresa.rows.forEach((item) => {
          const subgrupoKey = `${item.cod_subgrupo}_${item.des_subgrupo}`;

          if (!subgruposMap.has(subgrupoKey)) {
            subgruposMap.set(subgrupoKey, {
              cod_subgrupo: item.cod_subgrupo,
              des_subgrupo:
                item.des_subgrupo || `Subgrupo ${item.cod_subgrupo}`,
              itens: [],
            });
          }

          subgruposMap.get(subgrupoKey).itens.push({
            cod_item: item.cod_item,
            des_item: item.des_item,
            cod_barra: item.cod_barra,
            val_preco_venda: item.val_preco_venda,
            val_custo_medio: item.val_custo_medio,
            ind_selecionado: false,
          });
        });

        const subgruposArray = Array.from(subgruposMap.values());

        const totalItens = subgruposArray.reduce(
          (total, s) => total + (s.itens ? s.itens.length : 0),
          0,
        );
        if (subgruposArray.length === 0) {
        }

        if (subgruposArray.length > 0) {
          empresasComItens.push({
            cod_empresa: empresa.cod_empresa,
            nom_fantasia: empresa.nom_fantasia,
            subgrupos: subgruposArray,
          });
        }
      } catch (empresaError) {
        console.error(
          `[buscaSubgruposPista] Erro ao processar empresa ${empresa.nom_fantasia}:`,
          empresaError.message,
        );
        // Continua para próxima empresa
      }
    }
    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      empresas: empresasComItens,
      message: `${empresasComItens.length} empresa(s) com produtos pista encontradas`,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    console.error("[buscaSubgruposPista] ERRO:", error);
    console.error("[buscaSubgruposPista] Stack:", error.stack);
    res.status(500).json({
      message: "Falha ao buscar subgrupos pista: " + error.message,
      error: error.message,
      stack: error.stack,
    });
  }
};

// ✅ VERSÃO OTIMIZADA - Usa sp_custo_preco_app em LOTE
exports.atualizarCustosPrecoPista = async (req, res) => {
  const { schema, cod_empresa_sel } = req.body;

  try {
    // Retorna imediatamente para não bloquear a UI
    res.status(200).json({
      message: "Atualização de custos/preços iniciada em background",
      empresas: cod_empresa_sel.length,
    });

    // Executa a atualização em background
    setImmediate(async () => {
      try {
        const startTime = Date.now();
        console.log(`[atualizarCustosPrecoPista] 🚀 Iniciando atualização para ${cod_empresa_sel.length} empresa(s)`);

        // ✅ OTIMIZAÇÃO 1: Buscar todos os itens de uma vez
        const resultItens = await db.query_trocaprecos(
          `SELECT DISTINCT cod_item
           FROM ${schema}.tab_item
           WHERE cod_subgrupo IN (1, 43, 47)
           ORDER BY cod_item`
        );

        const todosItens = resultItens.rows.map(r => r.cod_item);
        console.log(`[atualizarCustosPrecoPista] 📊 ${todosItens.length} itens para atualizar`);

        if (todosItens.length === 0) {
          console.warn("[atualizarCustosPrecoPista] ⚠️  Nenhum item encontrado para atualizar");
          return;
        }

        // ✅ OTIMIZAÇÃO 2: Quebrar em lotes se houver muitos itens
        const TAMANHO_LOTE = 500;
        const lotes = [];
        for (let i = 0; i < todosItens.length; i += TAMANHO_LOTE) {
          lotes.push(todosItens.slice(i, i + TAMANHO_LOTE));
        }

        console.log(`[atualizarCustosPrecoPista] 📦 Processando ${lotes.length} lote(s) de até ${TAMANHO_LOTE} itens`);

        // ✅ OTIMIZAÇÃO 3: Usar transação e sp_custo_preco_app (batch)
        await db.query_trocaprecos("BEGIN");

        for (const empresa of cod_empresa_sel) {
          console.log(`[atualizarCustosPrecoPista] 🏢 Atualizando empresa ${empresa}...`);

          for (let i = 0; i < lotes.length; i++) {
            const lote = lotes[i];
            const empresasArray = `ARRAY[${empresa}]`;
            const itensArray = `ARRAY[${lote.join(",")}]`;

            const query = `SELECT ${schema}.sp_custo_preco_app(${empresasArray}, ${itensArray})`;

            try {
              await db.query_trocaprecos(query);
              console.log(`[atualizarCustosPrecoPista] ✅ Empresa ${empresa} - Lote ${i + 1}/${lotes.length} processado (${lote.length} itens)`);
            } catch (loteError) {
              console.error(`[atualizarCustosPrecoPista] ❌ Erro no lote ${i + 1}:`, loteError.message);
              throw loteError;
            }
          }
        }

        await db.query_trocaprecos("COMMIT");

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        console.log(`✅ [atualizarCustosPrecoPista] Concluído com sucesso em ${duration}s`);
        console.log(`   - ${cod_empresa_sel.length} empresa(s) atualizadas`);
        console.log(`   - ${todosItens.length} itens processados`);
        console.log(`   - ${lotes.length} lote(s) de até ${TAMANHO_LOTE} itens`);

      } catch (bgError) {
        // ✅ OTIMIZAÇÃO 4: Fazer ROLLBACK em caso de erro
        try {
          await db.query_trocaprecos("ROLLBACK");
          console.error("[atualizarCustosPrecoPista] 🔄 ROLLBACK executado devido a erro");
        } catch (rollbackError) {
          console.error("[atualizarCustosPrecoPista] ❌ Erro ao fazer ROLLBACK:", rollbackError);
        }

        console.error("[atualizarCustosPrecoPista] ❌ Erro no processamento background:", bgError);
        console.error("Stack:", bgError.stack);
      }
    });
  } catch (error) {
    console.error("[atualizarCustosPrecoPista] ❌ ERRO ao iniciar:", error);
    res.status(500).json({
      message: "Falha ao iniciar atualização de custos/preços: " + error.message,
      error: error.message,
    });
  }
};

exports.buscaPrecosCliente = async (req, res) => {
  const { cliente, schema } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    const pessoaNegociacao = await db.query_trocaprecos(`SELECT distinct
                                                a.cod_item,
                                                a.dta_inicio,
                                                a.val_preco_venda_a,
                                                a.val_preco_venda_b,
                                                a.val_preco_venda_c,
                                                a.val_preco_venda_d,
                                                a.val_preco_venda_e,
                                                a.cod_pessoa,
                                                a.cod_condicao_pagamento,
                                                c.des_forma_pagto,
                                                a.dta_inclusao,
                                                a.ind_tipo_negociacao,
                                                a.ind_percentual_valor,
                                                a.ind_tipo_preco_base,
                                                b.val_custo_medio,
                                                b.val_preco_venda_a as val_preco_venda_custo_a,
                                                b.val_preco_venda_b as val_preco_venda_custo_b,
                                                b.val_preco_venda_c as val_preco_venda_custo_c,
                                                b.val_preco_venda_d as val_preco_venda_custo_d,
                                                b.val_preco_venda_e as val_preco_venda_custo_e,
                                                d.nom_pessoa,
                                                e.des_item,
                                                false as ind_adicionado
                                              from ${schema}.tab_preco_emsys a
                                              left join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item and a.cod_empresa = b.cod_empresa)
                                              right join ${schema}.tab_forma_pagto c on (a.cod_condicao_pagamento = c.cod_forma_pagto)
                                              left join ${schema}.tab_pessoa d on (a.cod_pessoa = d.cod_pessoa)
                                              left join ${schema}.tab_item e on (a.cod_item = e.cod_item)
                                              where a.cod_pessoa in (${cliente})`);

    await db.query_trocaprecos("COMMIT");
    res.status(200).json({
      message: pessoaNegociacao.rows,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em obter tipos de depesas:" + error,
    });
  }
};

exports.novaNegociacao = async (req, res) => {
  const { schema, cod_empresa, nom_usuario, cod_usuario, cliente, itens } =
    req.body;

  try {
    // Gerar o número do lote antes de retornar
    const seq_lote = await db.query_trocaprecos(
      `select nextval('${schema}.gen_lote')`,
    );

    const seq_lote_alteracao = seq_lote.rows[0].nextval;

    // Retornar resposta imediatamente com o número do lote
    res.status(200).json({
      message: "Negociações Enviadas, consulte Histórico!",
      seq_lote_alteracao: seq_lote_alteracao,
      cod_empresa: cod_empresa, // Array de empresas
    });

    // Processar a inserção em background
    novaNegociacaoInsert(
      schema,
      cod_empresa,
      nom_usuario,
      cod_usuario,
      cliente,
      itens,
      seq_lote_alteracao,
    );
  } catch (error) {
    res.status(500).json({
      message: "Falha em aplicar as negociações: " + error.message,
    });
  }
};

/**
 * Mesma checagem de autonomia usada na tela de Aprovação de Negociações
 * (sistemaAutonomiaAtivo + avaliarItensLote / fn_validar_autonomia_aprovacao),
 * só que aplicada já na criação do lote: itens cujo usuário tem autonomia
 * suficiente (pela margem configurada para o GRUPO dele no EMSys3) nascem
 * direto aprovados (ind_status='T'), sem precisar de um passo manual
 * depois na tela de Aprovação. Os itens fora da autonomia continuam
 * pendentes ('X'), exatamente como hoje.
 *
 * Como fica dentro de novaNegociacaoInsert (usado por TODAS as telas que
 * criam negociação: combustível, produtos na pista, atualização de preço,
 * preços), vale igual para qualquer usuário/tela, não só um caso específico.
 */
async function autoAprovarItensAutonomia(
  schema,
  cod_usuario,
  nom_usuario,
  seq_lote_alteracao,
  itens,
) {
  if (!cod_usuario || !(await sistemaAutonomiaAtivo(schema))) {
    return "Concluído e Pendente de Aprovação";
  }

  const empresas = [...new Set(itens.map((item) => item.cod_empresa))];

  let liberados = 0;
  let bloqueados = 0;

  for (const cod_empresa_item of empresas) {
    const avaliacao = await avaliarItensLote(
      schema,
      cod_usuario,
      cod_empresa_item,
      seq_lote_alteracao,
    );
    bloqueados += avaliacao.bloqueados.length;

    const idsLiberados = avaliacao.liberados.map((i) => i.seq_registro);
    if (idsLiberados.length > 0) {
      await db.query_trocaprecos(
        `update ${schema}.tab_nova_regra
            set ind_status = 'T',
                usuario_aprovacao = $2
          where seq_registro = ANY($1)`,
        [idsLiberados, nom_usuario],
      );
      liberados += idsLiberados.length;
    }
  }

  if (liberados === 0) {
    return "Concluído e Pendente de Aprovação";
  }
  if (bloqueados === 0) {
    return "Aprovado Automaticamente";
  }
  return `Aprovado parcialmente (${bloqueados} item(ns) pendente(s) de aprovação superior)`;
}

async function novaNegociacaoInsert(
  schema,
  cod_empresa,
  nom_usuario,
  cod_usuario,
  cliente,
  itens,
  seq_lote_alteracao,
) {
  const total = itens.length * cliente.length; // Corrija o acesso ao tamanho do array
  const batchSize = 100; // Tamanho do lote para chamar geraStatus
  let progresso = 0;
  let empresa = 0;

  try {
    for (const c of cliente) {
      for (let i = 0; i < itens.length; i++) {
        // Executa a inserção dentro da transação
        await db.query_trocaprecos(
          `INSERT INTO ${schema}.tab_nova_regra ( seq_lote_alteracao,
            cod_condicao_pagamento, cod_empresa, nom_usuario, cod_usuario,
            cod_item, cod_pessoa, dta_inclusao, dta_inicio, ind_percentual_valor,
            ind_tipo_negociacao, ind_tipo_preco_base, val_preco_venda_a,
            val_preco_venda_b, val_preco_venda_c, val_preco_venda_d,
            val_preco_venda_e, ind_excluido, ind_status, des_observacao
          ) VALUES (
            ${seq_lote_alteracao}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
          )`,
          [
            itens[i].cod_condicao_pagamento,
            itens[i].cod_empresa,
            nom_usuario,
            cod_usuario,
            itens[i].cod_item,
            c.cod_pessoa,
            itens[i].dta_inclusao,
            itens[i].dta_inicio,
            itens[i].ind_percentual_valor,
            itens[i].ind_tipo_negociacao,
            itens[i].ind_tipo_preco_base,
            itens[i].val_preco_venda_a,
            itens[i].val_preco_venda_b,
            itens[i].val_preco_venda_c,
            itens[i].val_preco_venda_d,
            itens[i].val_preco_venda_e,
            "N",
            "X",
            `${seq_lote_alteracao} Inclusao Negociação`,
          ],
        );

        // Atualiza o progresso
        progresso++;
        empresa = itens[i].cod_empresa;

        // Verifica se já foram inseridos 100 registros
        if (progresso % batchSize === 0) {
          // Chama geraStatus
          await geraStatus(
            seq_lote_alteracao,
            total,
            progresso,
            "sem erro",
            empresa,
            schema,
          );
        }

        if (progresso === total) {
          const mensagemFinal = await autoAprovarItensAutonomia(
            schema,
            cod_usuario,
            nom_usuario,
            seq_lote_alteracao,
            itens,
          );

          await geraStatus(
            seq_lote_alteracao,
            total,
            progresso,
            mensagemFinal,
            empresa,
            schema,
          );
        }
      }
    }
  } catch (error) {
    await geraStatus(
      seq_lote_alteracao,
      null,
      null,
      error.message,
      empresa,
      schema,
    );
    throw error;
  }
}

async function geraStatus(lote, total, progresso, error, empresa, schema) {
  try {
    await db.query_trocaprecos("BEGIN");

    const resgistro = await db.query_trocaprecos(
      `select * from ${schema}.tab_progresso_lote where seq_lote = $1`,
      [lote],
    );

    if (resgistro.rows.length > 0) {
      await db.query_trocaprecos(
        `update ${schema}.tab_progresso_lote set progresso = $1, error = $3 where seq_lote = $2`,
        [progresso, lote, error],
      );
    } else {
      await db.query_trocaprecos(
        `insert into ${schema}.tab_Progresso_lote ( seq_lote, total, progresso, error )
                                                        values ( $1, $2, $3, $4)`,
        [lote, total, progresso, error],
      );
    }

    await db.query_trocaprecos("COMMIT");
  } catch (err) {
    await db.query_trocaprecos("ROLLBACK");
    await db.query_trocaprecos(
      `update ${schema}.tab_progresso_lote set error = $1 where seq_lote = $2`,
      [error, lote],
    );
    throw err;
  }
}

exports.buscaMinhasNegociacoes = async (req, res) => {
  const { schema, cod_usuario, cod_empresa } = req.body;
  try {
    await db.query_trocaprecos("BEGIN");

    const result = await db.query_trocaprecos(
      `SELECT a.dta_inclusao, a.seq_lote_alteracao, b.nom_fantasia, b.cod_empresa, a.ind_excluido, COUNT(*) AS total_registros, c.progresso, c.total, c.error, a.des_observacao, a.ind_status
                                          FROM ${schema}.tab_nova_regra a
                                          inner join ${schema}.tab_empresa_schema b on (a.cod_empresa = b.cod_empresa)
                                          inner join ${schema}.tab_progresso_lote c on (a.seq_lote_alteracao = c.seq_lote)
                                          where cod_usuario = $1
                                          and a.cod_empresa in (${cod_empresa})
                                          group by 1,3,2,4,5,7,8,9,10,11
                                          order by a.dta_inclusao desc, a.seq_lote_alteracao desc`,
      [cod_usuario],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: result.rows,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em obter historio de negociações:" + error,
    });
  }
};

exports.buscaNegociacoesEmpresa = async (req, res) => {
  const { schema, cod_empresa } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    const result =
      await db.query_trocaprecos(`SELECT a.dta_inclusao, a.seq_lote_alteracao, b.nom_fantasia, b.cod_empresa, a.ind_excluido, COUNT(*) AS total_registros, c.progresso, c.total, c.error, a.des_observacao, a.nom_usuario
                                          FROM ${schema}.tab_nova_regra a
                                          inner join ${schema}.tab_empresa_schema b on (a.cod_empresa = b.cod_empresa)
                                          inner join ${schema}.tab_progresso_lote c on (a.seq_lote_alteracao = c.seq_lote)
                                          where a.cod_empresa in (${cod_empresa})
                                          and a.ind_excluido != 'S'
                                          and a.ind_status = 'X'
                                          group by 1,3,2,4,5,7,8,9,10,11
                                          order by a.dta_inclusao desc, a.seq_lote_alteracao desc`);

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: result.rows,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em obter historio de negociações:" + error,
    });
  }
};

exports.buscaMinhasNegociacoesDetalhe = async (req, res) => {
  const {
    schema,
    cod_usuario,
    cod_empresa,
    seq_lote_alteracao,
    ind_aprovacao,
  } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    if (ind_aprovacao === "S") {
      const result = await db.query_trocaprecos(
        `select distinct a.seq_lote_alteracao, a.cod_condicao_pagamento, 
                                                  CASE
                                                  WHEN c.des_forma_pagto is null  THEN 'Preço Geral'
                                                  ELSE c.des_forma_pagto
                                                  END AS des_forma_pagto,
                                                  a.cod_item, 
                                                  d.des_item, 
                                                  a.cod_pessoa, 
                                                  b.nom_pessoa, 
                                                  a.dta_inclusao, 
                                                  a.ind_excluido,
                                                  a.ind_percentual_valor, 
                                                  a.ind_tipo_negociacao, 
                                                  a.ind_tipo_preco_base, 
                                                  a.val_preco_venda_a,
                                                  a.val_preco_venda_b, 
                                                  a.val_preco_venda_c, 
                                                  a.val_preco_venda_d, 
                                                  a.val_preco_venda_e, 
                                                  a.ind_status,
                                                  e.val_custo_medio,
                                                  e.val_preco_venda
                                                  
                                                  from ${schema}.tab_nova_regra a
                                                  left join ${schema}.tab_pessoa b on (a.cod_pessoa = b.cod_pessoa)
                                                  left join ${schema}.tab_forma_pagto c on (a.cod_condicao_pagamento = c.cod_forma_pagto)
                                                  left join ${schema}.tab_item d on (a.cod_item = d.cod_item)                                                   
                                                  left join ${schema}.tab_custo_preco e on (e.cod_item = a.cod_item and e.cod_empresa = a.cod_empresa)
                                                  where a.seq_lote_alteracao = $1
                                                  and a.cod_empresa in (${cod_empresa})
                                                  and a.ind_status = 'X'
                                                  order by b.nom_pessoa, d.des_item`,
        [seq_lote_alteracao],
      );

      await db.query_trocaprecos("COMMIT");

      res.status(200).json({
        message: result.rows,
      });
    } else {
      const result = await db.query_trocaprecos(
        `select distinct a.seq_lote_alteracao, a.cod_condicao_pagamento,
                                    CASE
                                    WHEN c.des_forma_pagto is null  THEN 'Preço Geral'
                                    ELSE c.des_forma_pagto
                                    END AS des_forma_pagto,
                                    a.cod_item, d.des_item, a.cod_pessoa, b.nom_pessoa, a.dta_inclusao, a.ind_excluido,
                                    a.ind_percentual_valor, a.ind_tipo_negociacao, a.ind_tipo_preco_base, a.val_preco_venda_a, a.val_preco_venda_b, a.val_preco_venda_c, a.val_preco_venda_d, a.val_preco_venda_e, a.ind_status,
                                    e.val_custo_medio,
                                    e.val_preco_venda
                                    from ${schema}.tab_nova_regra a
                                    left join ${schema}.tab_pessoa b on (a.cod_pessoa = b.cod_pessoa)
                                    left join ${schema}.tab_forma_pagto c on (a.cod_condicao_pagamento = c.cod_forma_pagto)
                                    left join ${schema}.tab_item d on (a.cod_item = d.cod_item)
                                    left join ${schema}.tab_custo_preco e on (e.cod_item = a.cod_item and e.cod_empresa = a.cod_empresa)
                                    where a.seq_lote_alteracao = $1
                                    and a.cod_usuario = $2
                                    and a.cod_empresa in (${cod_empresa})
                                    order by b.nom_pessoa, d.des_item`,
        [seq_lote_alteracao, cod_usuario],
      );

      await db.query_trocaprecos("COMMIT");

      res.status(200).json({
        message: result.rows,
      });
    }
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em obter historio de negociações:" + error,
    });
  }
};

exports.buscaAtualizacaoNegociacao = async (req, res) => {
  const { schema, cod_usuario, cod_empresa, item, formaPagto, pessoa } =
    req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    await db.query_trocaprecos(`delete from ${schema}.tab_preco_emsys`);

    await db.query_trocaprecos(`select ${schema}.sp_busca_preco (
                                1, --codbase
                                ARRAY[${cod_empresa}], --codempresa
                                ARRAY[${item}], --coditem
                                ARRAY[0], --codpessoa
                                ARRAY[${formaPagto}], --codformapagto
                                'R'--conexaotipo
                              )`);

    const result =
      await db.query_trocaprecos(`select distinct a.cod_condicao_pagamento, c.des_forma_pagto, a.cod_item, d.des_item, a.cod_pessoa, b.nom_pessoa, a.dta_inclusao, a.dta_inicio, false as ind_alterado,
                                    a.ind_percentual_valor, ind_tipo_negociacao, ind_tipo_preco_base, val_preco_venda_a, val_preco_venda_b, val_preco_venda_c, val_preco_venda_d, val_preco_venda_e
                                    from ${schema}.tab_preco_emsys a
                                    left join ${schema}.tab_pessoa b on (a.cod_pessoa = b.cod_pessoa)
                                    left join ${schema}.tab_forma_pagto c on (a.cod_condicao_pagamento = c.cod_forma_pagto)
                                    left join ${schema}.tab_item d on (a.cod_item = d.cod_item)
                                    where a.cod_empresa in (${cod_empresa}) 
                                    and a.cod_item in (${item}) 
                                    and b.cod_pessoa in (${pessoa})
                                    and a.cod_condicao_pagamento in (${formaPagto})`);

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: result.rows,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em obter historio de negociações:" + error,
    });
  }
};

exports.atualizaNegociacao = async (req, res) => {
  const { schema, cod_empresa, nom_usuario, cod_usuario, cliente, itens } =
    req.body;

  try {
    res.status(200).json({
      message: "Negociações Enviadas, consulte Histórico!",
    });

    novaAtualizaNegociacao(
      schema,
      cod_empresa,
      nom_usuario,
      cod_usuario,
      cliente,
      itens,
    );
  } catch (error) {
    res.status(500).json({
      message: "Falha em aplicar as negociações: " + error.message,
    });
  }
};

async function novaAtualizaNegociacao(
  schema,
  cod_empresa,
  nom_usuario,
  cod_usuario,
  itens,
) {
  const total = itens.length; // Corrija o acesso ao tamanho do array
  const batchSize = 100; // Tamanho do lote para chamar geraStatus
  let progresso = 0;
  let empresa = 0;

  const seq_lote = await db.query_trocaprecos(
    `select nextval('${schema}.gen_lote')`,
  );

  try {
    await db.query_trocaprecos("BEGIN");

    for (let i = 0; i < itens.length; i++) {
      await db.query_trocaprecos(
        `INSERT INTO ${schema}.tab_nova_regra ( seq_lote_alteracao,
          cod_condicao_pagamento, cod_empresa, nom_usuario, cod_usuario, 
          cod_item, cod_pessoa, dta_inclusao, dta_inicio, ind_percentual_valor,
          ind_tipo_negociacao, ind_tipo_preco_base, val_preco_venda_a, 
          val_preco_venda_b, val_preco_venda_c, val_preco_venda_d, 
          val_preco_venda_e, ind_excluido, ind_status, des_observacao
        ) VALUES (
          ${seq_lote.rows[0].nextval}, $1, ${cod_empresa}, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        )`,
        [
          itens[i].cod_condicao_pagamento,
          nom_usuario,
          cod_usuario,
          itens[i].cod_item,
          itens[i].cod_pessoa,
          itens[i].dta_inclusao,
          itens[i].dta_inicio,
          itens[i].ind_percentual_valor,
          itens[i].ind_tipo_negociacao,
          itens[i].ind_tipo_preco_base,
          itens[i].new_val_preco_venda_a,
          itens[i].new_val_preco_venda_b,
          itens[i].new_val_preco_venda_c,
          itens[i].new_val_preco_venda_d,
          itens[i].new_val_preco_venda_e,
          "N",
          "X",
          `${seq_lote.rows[0].nextval} Atualizacao Negociação`,
        ],
      );

      // Atualiza o progresso
      progresso++;
      empresa = itens[i].cod_empresa;

      // Verifica se já foram inseridos 100 registros
      if (progresso % batchSize === 0) {
        // Chama geraStatus
        await geraStatus(
          seq_lote.rows[0].nextval,
          total,
          progresso,
          "sem erro",
          empresa,
          schema,
        );
      }

      if (progresso === itens.length) {
        await geraStatus(
          seq_lote.rows[0].nextval,
          total,
          progresso,
          "Concluído e Pendente de Aprovação",
          empresa,
          schema,
        );
      }
    }

    //await db.query_trocaprecos(`update ${schema}.tab_nova_regra set ind_status = 'T' where seq_lote_alteracao = ${seq_lote.rows[0].nextval} `);
    await db.query_trocaprecos("COMMIT");
  } catch (error) {
    await geraStatus(
      seq_lote.rows[0].nextval,
      null,
      null,
      error.message,
      empresa,
      schema,
    );
    throw error;
  }
}

exports.excluirNegociacao = async (req, res) => {
  const { schema, cod_usuario, cod_empresa, seq_lote } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    await db.query_trocaprecos(
      `update ${schema}.tab_nova_regra
                    set ind_excluido = 'S',
                    ind_status = 'U'
                    where cod_empresa in ($1)
                    and seq_lote_alteracao = $2`,
      [cod_empresa, seq_lote],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: "Negociações Excluidas com Sucesso.",
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em aplicar negociações:" + error,
    });
  }
};

exports.enviaTrocaPreco = async (req, res) => {
  const { schema, cod_usuario, nom_usuario, empresas, item } = req.body;

  const total = item.length; // Corrija o acesso ao tamanho do array
  let progresso = 0;
  const dataDeHoje = moment();

  const seq_lote = await db.query_trocaprecos(
    `select nextval('${schema}.gen_lote')`,
  );

  try {
    await db.query_trocaprecos("BEGIN");

    const seq_lote = await db.query_trocaprecos(
      `select nextval('${schema}.gen_lote')`,
    );

    for (const i of item) {
      await db.query_trocaprecos(
        `INSERT INTO ${schema}.tab_nova_regra ( seq_lote_alteracao,
            cod_condicao_pagamento, cod_empresa, nom_usuario, cod_usuario, 
            cod_item, cod_pessoa, dta_inclusao, dta_inicio, ind_percentual_valor,
            ind_tipo_negociacao, ind_tipo_preco_base, val_preco_venda_a, 
            val_preco_venda_b, val_preco_venda_c, val_preco_venda_d, 
            val_preco_venda_e, ind_excluido, ind_status, des_observacao
          ) VALUES (
            ${seq_lote.rows[0].nextval}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
          )`,
        [
          null,
          i.cod_empresa,
          nom_usuario,
          cod_usuario,
          i.cod_item,
          null,
          dataDeHoje.format("YYYY-MM-DD"),
          dataDeHoje.format("YYYY-MM-DD"),
          "V",
          "P",
          "A",
          i.val_novo_preco_venda,
          0,
          0,
          0,
          0,
          "N",
          "X",
          `${seq_lote.rows[0].nextval} Troca de Preços Bomba`,
        ],
      );
      progresso++;

      if (progresso === total) {
        await geraStatus(
          seq_lote.rows[0].nextval,
          total,
          progresso,
          "concluído",
          0,
          schema,
        );
      }
    }
    //await db.query_trocaprecos(`update ${schema}.tab_nova_regra set ind_status = 'T' where seq_lote_alteracao = ${seq_lote.rows[0].nextval} `);
    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: "Preços Enviados com Sucesso",
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em enviar preços, tente novamente:" + error,
    });
    await geraStatus(
      seq_lote.rows[0].nextval,
      null,
      null,
      error.message,
      0,
      schema,
    );
    throw error;
  }
};

exports.aprovaRegra = async (req, res) => {
  const { schema, cod_empresa, nom_usuario, cod_usuario, seq_lote } = req.body;
  try {
    // Validação de autonomia: só entra em vigor se o parâmetro geral estiver
    // ativado. Analisa ITEM A ITEM (não o lote inteiro) — um lote pode ter
    // vários descontos, cada um com sua própria margem; só os itens fora
    // da autonomia ficam pendentes, os demais são aprovados normalmente.
    let itensBloqueados = [];
    let idsLiberados = null; // null = sem restrição (sistema off ou sem cod_usuario)

    if (cod_usuario && (await sistemaAutonomiaAtivo(schema))) {
      const avaliacao = await avaliarItensLote(schema, cod_usuario, cod_empresa, seq_lote);
      idsLiberados = avaliacao.liberados.map((i) => i.seq_registro);
      itensBloqueados = avaliacao.bloqueados;
    }

    await db.query_trocaprecos("BEGIN");

    if (idsLiberados !== null) {
      // Aprovação seletiva: só os itens dentro da autonomia mudam de status.
      if (idsLiberados.length > 0) {
        await db.query_trocaprecos(
          `update ${schema}.tab_nova_regra
                        set ind_status = 'T',
                            usuario_aprovacao = $2
                      where seq_registro = ANY($1)`,
          [idsLiberados, nom_usuario],
        );
      }
    } else {
      // Sistema de autonomia não se aplica: aprova o lote inteiro (legado).
      await db.query_trocaprecos(
        `update ${schema}.tab_nova_regra
                      set ind_status = 'T',
                          usuario_aprovacao = $2
                    where cod_empresa in ($3)
                    and seq_lote_alteracao = $1`,
        [seq_lote, nom_usuario, cod_empresa],
      );
    }

    await db.query_trocaprecos(
      `update ${schema}.tab_progresso_lote
                    set error = $2
                    where seq_lote = $1`,
      [
        seq_lote,
        itensBloqueados.length > 0
          ? `Aprovado parcialmente (${itensBloqueados.length} item(ns) pendente(s) de aprovação superior)`
          : "Aprovado",
      ],
    );

    await db.query_trocaprecos("COMMIT");

    if (itensBloqueados.length > 0) {
      const qtdLiberados = idsLiberados?.length || 0;
      return res.status(200).json({
        message:
          qtdLiberados > 0
            ? `${qtdLiberados} item(ns) aprovado(s). ${itensBloqueados.length} item(ns) fora da sua autonomia continuam pendentes.`
            : `Nenhum item foi aprovado: os ${itensBloqueados.length} item(ns) deste lote estão fora da sua autonomia.`,
        parcial: true,
        itens_bloqueados: itensBloqueados,
      });
    }

    res.status(200).json({
      message: "Negociações Aprovadas com Sucesso.",
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em aplicar negociações:" + error,
    });
  }
};

exports.reprovaRegra = async (req, res) => {
  const { schema, seq_lote } = req.body;
  try {
    await db.query_trocaprecos("BEGIN");

    // Só reprova o que ainda está pendente (ind_status='X'). Com a
    // aprovação parcial por item, um lote pode ter itens já aprovados
    // ('T') convivendo com itens pendentes no mesmo seq_lote — sem esse
    // filtro, reprovar excluiria também os itens já aprovados.
    await db.query_trocaprecos(
      `update ${schema}.tab_nova_regra
                    set ind_excluido = 'S'
                    where seq_lote_alteracao = $1
                    and ind_status = 'X'`,
      [seq_lote],
    );

    await db.query_trocaprecos(
      `update ${schema}.tab_progresso_lote
                    set error = 'Reprovado'
                    where seq_lote = $1`,
      [seq_lote],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: "Negociação Reprovada com Sucesso.",
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em reprovar negociação:" + error,
    });
  }
};

// ============================================================================
// SISTEMA DE AUTONOMIA DE DESCONTOS
// ============================================================================

//=> Consulta se o usuário tem autonomia para aprovar um lote, sem aprovar.
// Usado pelo frontend para decidir entre "Aprovar Diretamente" ou
// "Solicitar Aprovação Superior" antes de chamar /aprovaRegra.
exports.validarAutonomiaAprovacao = async (req, res) => {
  const { schema, cod_usuario, cod_empresa, seq_lote } = req.body;

  const respostaLegado = {
    pode_aprovar: true,
    perfil: "legado",
    margem_autonomia: null,
    margem_negociacao: null,
    motivo: null,
    sistema_autonomia_ativo: false,
    qtd_total: 0,
    qtd_liberados: 0,
    qtd_bloqueados: 0,
    itens_bloqueados: [],
  };

  try {
    if (!(await sistemaAutonomiaAtivo(schema))) {
      return res.status(200).json(respostaLegado);
    }

    // Analisa ITEM A ITEM: um lote pode ter vários descontos com margens
    // diferentes, cada um avaliado contra a autonomia do usuário.
    const avaliacao = await avaliarItensLote(schema, cod_usuario, cod_empresa, seq_lote);

    if (avaliacao.totalItens === 0 || avaliacao.bloqueados.length === 0) {
      // Nada bloqueado (ou nenhum item pendente encontrado): libera geral.
      return res.status(200).json({
        ...respostaLegado,
        pode_aprovar: true,
        sistema_autonomia_ativo: avaliacao.totalItens > 0,
        qtd_total: avaliacao.totalItens,
        qtd_liberados: avaliacao.liberados.length,
      });
    }

    // Pega o item mais restritivo entre os bloqueados só para exibir um
    // resumo no alerta (margem/autonomia/motivo "pior caso"). Item sem
    // custo/margem calculável (margem null) é tratado como o mais grave.
    const pior = avaliacao.bloqueados.reduce((a, b) => {
      if (a.margem === null) return a;
      if (b.margem === null) return b;
      return a.margem <= b.margem ? a : b;
    });

    res.status(200).json({
      pode_aprovar: false,
      perfil: pior.perfil,
      margem_autonomia: pior.margem_autonomia,
      margem_negociacao: pior.margem,
      motivo: pior.motivo,
      sistema_autonomia_ativo: true,
      qtd_total: avaliacao.totalItens,
      qtd_liberados: avaliacao.liberados.length,
      qtd_bloqueados: avaliacao.bloqueados.length,
      itens_bloqueados: avaliacao.bloqueados,
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha ao validar autonomia: " + error,
    });
  }
};

//=> Mesma análise de autonomia, mas ANTES de o lote existir no banco — usada
// nas telas de negociação (combustível, produtos na pista, atualização de
// preço, preços) para avisar o usuário, antes de enviar, quais itens já
// serão aprovados automaticamente (dentro da margem do GRUPO dele) e quais
// ficarão pendentes. Recebe a margem já calculada no frontend (preço
// negociado - custo médio), já que ainda não há seq_lote/tab_nova_regra
// para consultar vw_negociacao_margem como em avaliarItensLote.
exports.validarAutonomiaNegociacao = async (req, res) => {
  const { schema, cod_usuario, itens } = req.body;

  const qtdTotalRecebida = Array.isArray(itens) ? itens.length : 0;

  const respostaLegado = {
    sistema_autonomia_ativo: false,
    qtd_total: qtdTotalRecebida,
    qtd_liberados: qtdTotalRecebida,
    qtd_bloqueados: 0,
    margem_autonomia: null,
    itens_bloqueados: [],
  };

  try {
    if (
      !cod_usuario ||
      qtdTotalRecebida === 0 ||
      !(await sistemaAutonomiaAtivo(schema))
    ) {
      return res.status(200).json(respostaLegado);
    }

    const bloqueados = [];
    const validos = []; // itens com margem/empresa utilizáveis, na ordem em que serão enviados ao banco

    itens.forEach((item) => {
      const margemBruta = item.margem_valor;
      const margem =
        margemBruta !== null && margemBruta !== undefined && item.cod_empresa
          ? Math.round(Number(margemBruta) * 100) / 100
          : null;

      if (margem === null || Number.isNaN(margem)) {
        bloqueados.push({
          cod_item: item.cod_item,
          des_item: item.des_item,
          cod_empresa: item.cod_empresa,
          margem: null,
          motivo: "Não foi possível calcular a margem deste item.",
        });
        return;
      }

      validos.push({ ...item, margem });
    });

    let liberadosCount = 0;
    let margemAutonomiaUsuario = null;

    if (validos.length > 0) {
      // Uma única query para todos os itens (em vez de uma por item): usa
      // UNNEST para transformar os arrays recebidos em linhas e faz o LEFT
      // JOIN LATERAL com fn_validar_autonomia_aprovacao por linha — mesmo
      // padrão já usado (e testado em produção) por avaliarItensLote, só
      // que aqui a "tabela" de entrada vem dos arrays em vez de uma tabela
      // real, já que o lote ainda não existe no banco.
      const result = await db.query_trocaprecos(
        `SELECT f.pode_aprovar, f.perfil, f.margem_autonomia, f.motivo
           FROM UNNEST($1::int[], $2::numeric[]) WITH ORDINALITY AS e(cod_empresa, margem, ord)
           LEFT JOIN LATERAL (
             SELECT * FROM ${schema}.fn_validar_autonomia_aprovacao($3, ROUND(e.margem, 2), e.cod_empresa)
           ) f ON TRUE
          ORDER BY e.ord`,
        [validos.map((v) => v.cod_empresa), validos.map((v) => v.margem), cod_usuario],
      );

      result.rows.forEach((row, i) => {
        const item = validos[i];
        const margemAutonomia =
          row.margem_autonomia !== null ? Number(row.margem_autonomia) : null;

        if (margemAutonomia !== null) {
          margemAutonomiaUsuario = margemAutonomia;
        }

        if (row.perfil === "sem_perfil" || row.pode_aprovar) {
          liberadosCount++;
        } else {
          bloqueados.push({
            cod_item: item.cod_item,
            des_item: item.des_item,
            cod_empresa: item.cod_empresa,
            margem: item.margem,
            perfil: row.perfil,
            margem_autonomia: margemAutonomia,
            motivo: row.motivo,
          });
        }
      });
    }

    res.status(200).json({
      sistema_autonomia_ativo: true,
      qtd_total: qtdTotalRecebida,
      qtd_liberados: liberadosCount,
      qtd_bloqueados: bloqueados.length,
      margem_autonomia: margemAutonomiaUsuario,
      itens_bloqueados: bloqueados,
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha ao validar autonomia da negociação: " + error,
    });
  }
};

//=> Registra a solicitação de aprovação superior (quando falta autonomia).
// Não aprova nada — apenas deixa um registro de PENDENTE para o supervisor
// ou diretor decidir depois (via aprovaRegra normal, que fará a checagem de
// autonomia novamente para o cod_usuario que efetivamente aprovar).
exports.solicitarAprovacaoSuperior = async (req, res) => {
  const {
    schema,
    cod_empresa,
    seq_lote,
    cod_usuario_solicitante,
    nom_usuario_solicitante,
    des_observacao,
  } = req.body;

  try {
    const autonomia = await validarAutonomia(
      schema,
      cod_usuario_solicitante,
      cod_empresa,
      seq_lote,
    );

    await db.query_trocaprecos(
      `INSERT INTO ${schema}.tbl_historico_aprovacao_negociacao (
         seq_lote_alteracao, cod_empresa, cod_usuario_solicitante,
         nom_usuario_solicitante, val_margem_negociacao,
         ind_perfil_necessario, ind_status, des_observacao
       ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDENTE', $7)`,
      [
        seq_lote,
        cod_empresa,
        cod_usuario_solicitante,
        nom_usuario_solicitante,
        autonomia.margem_negociacao,
        autonomia.perfil,
        des_observacao || null,
      ],
    );

    res.status(200).json({
      message: "Solicitação de aprovação enviada.",
    });
  } catch (error) {
    res.status(500).json({
      message: "Falha ao solicitar aprovação: " + error,
    });
  }
};

//=> Lista solicitações pendentes de aprovação superior (para supervisores/diretores)
exports.listarPendentesAprovacaoSuperior = async (req, res) => {
  const { schema } = req.body;

  try {
    const result = await db.query_trocaprecos(
      `SELECT h.seq_historico, h.seq_lote_alteracao, h.cod_empresa,
              h.nom_usuario_solicitante, h.val_margem_negociacao,
              h.ind_perfil_necessario, h.des_observacao, h.dta_solicitacao,
              e.nom_fantasia
         FROM ${schema}.tbl_historico_aprovacao_negociacao h
         LEFT JOIN ${schema}.tab_empresa_schema e ON e.cod_empresa = h.cod_empresa
        WHERE h.ind_status = 'PENDENTE'
        ORDER BY h.dta_solicitacao ASC`,
    );

    res.status(200).json({ message: result.rows });
  } catch (error) {
    res.status(500).json({
      message: "Falha ao listar pendentes: " + error,
    });
  }
};

// ----------------------------------------------------------------------------
// Parâmetro geral (kill switch) — liga/desliga toda a regra de autonomia
// ----------------------------------------------------------------------------

//=> Consulta se o sistema de autonomia está ativo (usado pela tela de
// aprovação para decidir se mostra os badges de margem, e pela tela admin
// para mostrar o estado do interruptor geral).
exports.buscarParametroAutonomia = async (req, res) => {
  const { schema } = req.body;

  try {
    const result = await db.query_trocaprecos(
      `SELECT ind_ativo, dta_alteracao, nom_usuario_alteracao, des_justificativa
         FROM ${schema}.tbl_parametro_autonomia WHERE cod_parametro = 1`,
    );

    res.status(200).json({
      ativo: result.rows[0]?.ind_ativo === "S",
      ...result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ message: "Falha ao buscar parâmetro: " + error });
  }
};

//=> Liga/desliga o sistema de autonomia por completo. Requer autenticação
// admin (validada no frontend antes de chamar) e justificativa obrigatória.
exports.atualizarParametroAutonomia = async (req, res) => {
  const { schema, ativo, cod_usuario_admin, nom_usuario_admin, des_justificativa } = req.body;

  if (!des_justificativa || !des_justificativa.trim()) {
    return res.status(400).json({ message: "Justificativa é obrigatória." });
  }

  try {
    await db.query_trocaprecos(
      `UPDATE ${schema}.tbl_parametro_autonomia
          SET ind_ativo = $1, cod_usuario_alteracao = $2,
              nom_usuario_alteracao = $3, des_justificativa = $4, dta_alteracao = NOW()
        WHERE cod_parametro = 1`,
      [ativo ? "S" : "N", cod_usuario_admin, nom_usuario_admin, des_justificativa],
    );

    res.status(200).json({
      message: ativo
        ? "Sistema de autonomia ATIVADO."
        : "Sistema de autonomia DESATIVADO (voltou ao comportamento legado).",
    });
  } catch (error) {
    res.status(500).json({ message: "Falha ao atualizar parâmetro: " + error });
  }
};

// ----------------------------------------------------------------------------
// Administração de perfis (tela protegida por senha extra)
// ----------------------------------------------------------------------------

//=> Valida a senha de administrador para liberar a tela de configuração.
// Não existe senha separada: reusa a MESMA senha de login que o usuário já
// tem em tab_usuario (o frontend envia o MD5, exatamente como faz no login
// normal). tbl_admin_perfis é só a lista de quem tem essa permissão.
exports.validarSenhaAdmin = async (req, res) => {
  const { schema, cod_usuario, senha_admin } = req.body;

  try {
    const result = await db.query_trocaprecos(
      `SELECT a.cod_usuario, a.nom_usuario
         FROM ${schema}.tbl_admin_perfis a
         JOIN ${schema}.tab_usuario u ON u.cod_usuario = a.cod_usuario
        WHERE a.cod_usuario = $1 AND a.ind_ativo = 'S' AND u.senha = $2`,
      [cod_usuario, senha_admin],
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        sucesso: false,
        mensagem: "Você não tem permissão de administrador ou a senha está incorreta.",
      });
    }

    const admin = result.rows[0];

    await db.query_trocaprecos(
      `UPDATE ${schema}.tbl_admin_perfis
          SET dta_ultimo_acesso = NOW(), qtd_acessos = qtd_acessos + 1
        WHERE cod_usuario = $1`,
      [cod_usuario],
    );

    res.status(200).json({
      sucesso: true,
      admin: { cod_usuario: admin.cod_usuario, nom_usuario: admin.nom_usuario },
    });
  } catch (error) {
    res.status(500).json({ message: "Falha ao validar senha admin: " + error });
  }
};

//=> Lista os grupos do EMSys3 (sincronizados por sp_atualiza_usuario),
// indicando se já têm perfil de autonomia configurado e quantos usuários
// ativos pertencem a cada grupo. Configurar aqui aplica a margem para TODOS
// os usuários daquele grupo de uma vez — muito mais viável que configurar
// usuário por usuário quando há centenas deles.
exports.listarGruposAutonomia = async (req, res) => {
  const { schema } = req.body;

  try {
    const result = await db.query_trocaprecos(
      `SELECT g.cod_grupo, g.des_grupo,
              COUNT(DISTINCT ug.cod_usuario) AS qtd_usuarios,
              p.ind_perfil_aprovacao, p.val_margem_minima_autonomia,
              p.ind_ativo AS perfil_ativo, p.dta_alteracao,
              p.nom_usuario_alteracao
         FROM ${schema}.tab_grupo_usuario g
         LEFT JOIN ${schema}.tab_usuario_grupo ug ON ug.cod_grupo = g.cod_grupo
         LEFT JOIN ${schema}.tbl_grupo_perfil_aprovacao p ON p.cod_grupo = g.cod_grupo
        GROUP BY g.cod_grupo, g.des_grupo, p.cod_grupo, p.ind_perfil_aprovacao,
                 p.val_margem_minima_autonomia, p.ind_ativo, p.dta_alteracao,
                 p.nom_usuario_alteracao
        ORDER BY (p.cod_grupo IS NOT NULL) DESC, qtd_usuarios DESC`,
    );

    res.status(200).json({ message: result.rows });
  } catch (error) {
    res.status(500).json({ message: "Falha ao listar grupos: " + error });
  }
};

//=> Lista os usuários ativos vinculados a um grupo específico — usado para
// a tela de administração permitir "abrir" um grupo e conferir quem
// exatamente vai herdar a margem configurada, antes de salvar.
exports.listarUsuariosGrupo = async (req, res) => {
  const { schema, cod_grupo } = req.body;

  try {
    const result = await db.query_trocaprecos(
      `SELECT u.cod_usuario, u.nom_usuario, u.empresa
         FROM ${schema}.tab_usuario u
         JOIN ${schema}.tab_usuario_grupo ug ON ug.cod_usuario = u.cod_usuario
        WHERE ug.cod_grupo = $1 AND u.ind_ativo = 'S'
        ORDER BY u.nom_usuario ASC`,
      [cod_grupo],
    );

    res.status(200).json({ message: result.rows });
  } catch (error) {
    res.status(500).json({ message: "Falha ao listar usuários do grupo: " + error });
  }
};

//=> Busca usuário(s) por nome e devolve em quais grupos cada um está, com o
// perfil/margem já configurado (se houver) — ajuda o admin a achar rápido
// "em qual grupo mexer" para liberar autonomia de uma pessoa específica.
exports.buscarUsuarioGrupo = async (req, res) => {
  const { schema, busca } = req.body;

  if (!busca || !busca.trim()) {
    return res.status(200).json({ message: [] });
  }

  try {
    const result = await db.query_trocaprecos(
      `SELECT u.cod_usuario, u.nom_usuario,
              json_agg(
                json_build_object(
                  'cod_grupo', g.cod_grupo,
                  'des_grupo', g.des_grupo,
                  'ind_perfil_aprovacao', p.ind_perfil_aprovacao,
                  'val_margem_minima_autonomia', p.val_margem_minima_autonomia,
                  'perfil_ativo', p.ind_ativo
                ) ORDER BY g.des_grupo
              ) AS grupos
         FROM ${schema}.tab_usuario u
         JOIN ${schema}.tab_usuario_grupo ug ON ug.cod_usuario = u.cod_usuario
         JOIN ${schema}.tab_grupo_usuario g ON g.cod_grupo = ug.cod_grupo
         LEFT JOIN ${schema}.tbl_grupo_perfil_aprovacao p ON p.cod_grupo = g.cod_grupo
        WHERE u.ind_ativo = 'S' AND u.nom_usuario ILIKE $1
        GROUP BY u.cod_usuario, u.nom_usuario
        ORDER BY u.nom_usuario
        LIMIT 20`,
      [`%${busca.trim()}%`],
    );

    res.status(200).json({ message: result.rows });
  } catch (error) {
    res.status(500).json({ message: "Falha ao buscar usuário: " + error });
  }
};

//=> Cria ou atualiza o perfil de autonomia de um GRUPO inteiro. Todo usuário
// vinculado àquele grupo no EMSys3 passa a herdar a margem automaticamente.
exports.atualizarPerfilGrupo = async (req, res) => {
  const {
    schema,
    cod_grupo,
    des_grupo,
    ind_perfil_aprovacao,
    val_margem_minima_autonomia,
    des_justificativa,
    cod_usuario_admin,
    nom_usuario_admin,
  } = req.body;

  if (!des_justificativa || !des_justificativa.trim()) {
    return res.status(400).json({ message: "Justificativa é obrigatória." });
  }

  try {
    await db.query_trocaprecos("BEGIN");

    const anterior = await db.query_trocaprecos(
      `SELECT * FROM ${schema}.tbl_grupo_perfil_aprovacao WHERE cod_grupo = $1`,
      [cod_grupo],
    );

    await db.query_trocaprecos(
      `INSERT INTO ${schema}.tbl_grupo_perfil_aprovacao (
         cod_grupo, des_grupo, ind_perfil_aprovacao,
         val_margem_minima_autonomia, ind_ativo,
         cod_usuario_alteracao, nom_usuario_alteracao, dta_alteracao
       ) VALUES ($1, $2, $3, $4, 'S', $5, $6, NOW())
       ON CONFLICT (cod_grupo) DO UPDATE SET
         des_grupo = EXCLUDED.des_grupo,
         ind_perfil_aprovacao = EXCLUDED.ind_perfil_aprovacao,
         val_margem_minima_autonomia = EXCLUDED.val_margem_minima_autonomia,
         ind_ativo = 'S',
         cod_usuario_alteracao = EXCLUDED.cod_usuario_alteracao,
         nom_usuario_alteracao = EXCLUDED.nom_usuario_alteracao,
         dta_alteracao = NOW()`,
      [
        cod_grupo,
        des_grupo,
        ind_perfil_aprovacao,
        val_margem_minima_autonomia,
        cod_usuario_admin,
        nom_usuario_admin,
      ],
    );

    await db.query_trocaprecos(
      `INSERT INTO ${schema}.tbl_historico_config_grupo (
         cod_grupo, des_grupo, cod_usuario_admin, nom_usuario_admin,
         ind_perfil_anterior, ind_perfil_novo,
         val_margem_anterior, val_margem_nova,
         des_justificativa, ip_origem
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        cod_grupo,
        des_grupo,
        cod_usuario_admin,
        nom_usuario_admin,
        anterior.rows[0]?.ind_perfil_aprovacao || null,
        ind_perfil_aprovacao,
        anterior.rows[0]?.val_margem_minima_autonomia || null,
        val_margem_minima_autonomia,
        des_justificativa,
        req.ip,
      ],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({ message: "Perfil do grupo atualizado com sucesso." });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({ message: "Falha ao atualizar perfil do grupo: " + error });
  }
};

//=> Desativa o perfil de autonomia de um grupo (todos os usuários daquele
// grupo voltam a exigir aprovação superior para qualquer margem).
exports.desativarPerfilGrupo = async (req, res) => {
  const { schema, cod_grupo, cod_usuario_admin, nom_usuario_admin, des_justificativa } = req.body;

  if (!des_justificativa || !des_justificativa.trim()) {
    return res.status(400).json({ message: "Justificativa é obrigatória." });
  }

  try {
    await db.query_trocaprecos("BEGIN");

    const anterior = await db.query_trocaprecos(
      `SELECT * FROM ${schema}.tbl_grupo_perfil_aprovacao WHERE cod_grupo = $1`,
      [cod_grupo],
    );

    await db.query_trocaprecos(
      `UPDATE ${schema}.tbl_grupo_perfil_aprovacao
          SET ind_ativo = 'N', cod_usuario_alteracao = $2,
              nom_usuario_alteracao = $3, dta_alteracao = NOW()
        WHERE cod_grupo = $1`,
      [cod_grupo, cod_usuario_admin, nom_usuario_admin],
    );

    await db.query_trocaprecos(
      `INSERT INTO ${schema}.tbl_historico_config_grupo (
         cod_grupo, des_grupo, cod_usuario_admin, nom_usuario_admin,
         ind_perfil_anterior, ind_perfil_novo,
         val_margem_anterior, val_margem_nova,
         des_justificativa, ip_origem
       ) VALUES ($1, $2, $3, $4, $5, NULL, $6, NULL, $7, $8)`,
      [
        cod_grupo,
        anterior.rows[0]?.des_grupo || null,
        cod_usuario_admin,
        nom_usuario_admin,
        anterior.rows[0]?.ind_perfil_aprovacao || null,
        anterior.rows[0]?.val_margem_minima_autonomia || null,
        des_justificativa,
        req.ip,
      ],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({ message: "Perfil do grupo desativado com sucesso." });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({ message: "Falha ao desativar perfil do grupo: " + error });
  }
};

//=> Histórico de alterações manuais de um grupo (auditoria da tela admin)
exports.historicoConfigGrupo = async (req, res) => {
  const { schema, cod_grupo } = req.body;

  try {
    const result = await db.query_trocaprecos(
      `SELECT * FROM ${schema}.tbl_historico_config_grupo
        WHERE cod_grupo = $1
        ORDER BY dta_alteracao DESC
        LIMIT 50`,
      [cod_grupo],
    );

    res.status(200).json({ message: result.rows });
  } catch (error) {
    res.status(500).json({ message: "Falha ao buscar histórico: " + error });
  }
};

// ----------------------------------------------------------------------------
// Administradores do sistema (quem tem acesso à tela de autonomia)
// ----------------------------------------------------------------------------

//=> Lista quem tem acesso à tela de administração (tbl_admin_perfis).
exports.listarAdminsAutonomia = async (req, res) => {
  const { schema } = req.body;

  try {
    const result = await db.query_trocaprecos(
      `SELECT cod_usuario, nom_usuario, ind_ativo, dta_cadastro,
              dta_ultimo_acesso, qtd_acessos
         FROM ${schema}.tbl_admin_perfis
        WHERE ind_ativo = 'S'
        ORDER BY nom_usuario`,
    );

    res.status(200).json({ message: result.rows });
  } catch (error) {
    res.status(500).json({ message: "Falha ao listar administradores: " + error });
  }
};

//=> Busca usuário ATIVO (já sincronizado do EMSys3) por nome, para achar o
// cod_usuario de quem vai virar administrador — nunca cria usuário novo.
exports.buscarUsuarioParaAdmin = async (req, res) => {
  const { schema, busca } = req.body;

  if (!busca || !busca.trim()) {
    return res.status(200).json({ message: [] });
  }

  try {
    const result = await db.query_trocaprecos(
      `SELECT cod_usuario, nom_usuario
         FROM ${schema}.tab_usuario
        WHERE ind_ativo = 'S' AND nom_usuario ILIKE $1
        ORDER BY nom_usuario
        LIMIT 20`,
      [`%${busca.trim()}%`],
    );

    res.status(200).json({ message: result.rows });
  } catch (error) {
    res.status(500).json({ message: "Falha ao buscar usuário: " + error });
  }
};

//=> Concede acesso de administrador a um usuário já existente.
exports.adicionarAdminAutonomia = async (req, res) => {
  const { schema, cod_usuario, nom_usuario, cod_usuario_admin } = req.body;

  if (!cod_usuario || !nom_usuario) {
    return res.status(400).json({ message: "Usuário inválido." });
  }

  try {
    if (!(await ehAdminAtivo(schema, cod_usuario_admin))) {
      return res.status(403).json({ message: "Apenas administradores podem conceder esse acesso." });
    }

    await db.query_trocaprecos(
      `INSERT INTO ${schema}.tbl_admin_perfis (cod_usuario, nom_usuario, ind_ativo)
       VALUES ($1, $2, 'S')
       ON CONFLICT (cod_usuario) DO UPDATE SET
         nom_usuario = EXCLUDED.nom_usuario,
         ind_ativo = 'S'`,
      [cod_usuario, nom_usuario],
    );

    res.status(200).json({ message: `${nom_usuario} agora tem acesso de administrador.` });
  } catch (error) {
    res.status(500).json({ message: "Falha ao adicionar administrador: " + error });
  }
};

//=> Revoga acesso de administrador (soft: ind_ativo='N', preserva histórico).
// Bloqueia remover o último admin ativo, pra não trancar o acesso de todos.
exports.removerAdminAutonomia = async (req, res) => {
  const { schema, cod_usuario, cod_usuario_admin } = req.body;

  try {
    if (!(await ehAdminAtivo(schema, cod_usuario_admin))) {
      return res.status(403).json({ message: "Apenas administradores podem revogar esse acesso." });
    }

    const ativos = await db.query_trocaprecos(
      `SELECT COUNT(*) AS total FROM ${schema}.tbl_admin_perfis WHERE ind_ativo = 'S'`,
    );

    if (Number(ativos.rows[0].total) <= 1) {
      return res.status(400).json({
        message: "Não é possível remover o último administrador ativo.",
      });
    }

    await db.query_trocaprecos(
      `UPDATE ${schema}.tbl_admin_perfis SET ind_ativo = 'N' WHERE cod_usuario = $1`,
      [cod_usuario],
    );

    res.status(200).json({ message: "Acesso de administrador removido." });
  } catch (error) {
    res.status(500).json({ message: "Falha ao remover administrador: " + error });
  }
};

exports.buscaPrecoIntervalo = async (req, res) => {
  const { schema, cod_empresa, precoInicial, precoFinal } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    const result = await db.query_trocaprecos(
      `SELECT distinct
                                                a.cod_item,
                                                a.dta_inicio,
                                                a.val_preco_venda_a,
                                                a.val_preco_venda_b,
                                                a.val_preco_venda_c,
                                                a.val_preco_venda_d,
                                                a.val_preco_venda_e,
                                                a.cod_pessoa,
                                                a.cod_condicao_pagamento,
                                                c.des_forma_pagto,
                                                a.dta_inclusao,
                                                a.ind_tipo_negociacao,
                                                a.ind_percentual_valor,
                                                a.ind_tipo_preco_base,
                                                b.val_custo_medio,
                                                b.val_preco_venda_a as val_preco_venda_custo_a,
                                                b.val_preco_venda_b as val_preco_venda_custo_b,
                                                b.val_preco_venda_c as val_preco_venda_custo_c,
                                                b.val_preco_venda_d as val_preco_venda_custo_d,
                                                b.val_preco_venda_e as val_preco_venda_custo_e,
                                                d.nom_pessoa,
                                                e.des_item,
                                                false as ind_adicionado
                                              from ${schema}.tab_preco_emsys a
                                              left join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item and a.cod_empresa = b.cod_empresa)
                                              right join ${schema}.tab_forma_pagto c on (a.cod_condicao_pagamento = c.cod_forma_pagto)
                                              left join ${schema}.tab_pessoa d on (a.cod_pessoa = d.cod_pessoa)
                                              left join ${schema}.tab_item e on (a.cod_item = e.cod_item)
                                              where a.cod_empresa = ${cod_empresa}
                                              and a.val_preco_venda_a > $1
                                              and a.val_preco_venda_a < $2`,
      [precoInicial, precoFinal],
    );

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: result.rows,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    res.status(500).json({
      message: "Falha em aplicar negociações:" + error,
    });
  }
};

//=> Método responsável por buscar preços na tab_preco_emsys
exports.buscaPrecoEmsys = async (req, res) => {
  const {
    schema,
    codEmpresa,
    codItem,
    codPessoa,
    codFormaPagto,
    tipoNegociacao,
    precoMenorQue,
    page = 1,        // 👈 NOVO: Paginação (opcional, default página 1)
    pageSize = 100,  // 👈 NOVO: Registros por página (opcional, default 100)
  } = req.body;

  console.log("=== buscaPrecoEmsys - Parâmetros recebidos ===");
  console.log("Schema:", schema);
  console.log("Empresas:", codEmpresa);
  console.log("Items:", codItem);
  console.log("Clientes:", codPessoa);
  console.log("Formas Pagto:", codFormaPagto);
  console.log(
    "Tipo Negociação:",
    tipoNegociacao,
    "| Tipo:",
    typeof tipoNegociacao,
    "| Length:",
    tipoNegociacao?.length,
  );
  console.log("Preço Menor Que:", precoMenorQue);
  console.log("Paginação:", { page, pageSize });

  // Validar se pelo menos uma empresa foi selecionada
  if (!codEmpresa || codEmpresa.length === 0) {
    return res.status(400).json({
      message: "Pelo menos uma empresa deve ser selecionada.",
    });
  }

  try {
    // Preparar parâmetros para a procedure
    // Se tipoNegociacao estiver vazio, envia string vazia ao invés de null
    const tipoPreco =
      tipoNegociacao && tipoNegociacao.trim() !== ""
        ? tipoNegociacao.trim().toUpperCase()
        : "";

    console.log("=== PASSO 1: Chamando sp_busca_preco (popula tabela) ===");
    console.log("Schema:", schema);
    console.log("Empresas:", codEmpresa);
    console.log("Items:", codItem);
    console.log("Clientes:", codPessoa);
    console.log("Formas Pagto:", codFormaPagto);
    console.log("Tipo Preço:", tipoPreco);
    console.log("Preço Menor Que:", precoMenorQue || 0);

    // PASSO 1: Chamar a stored procedure que popula a tabela tab_preco_emsys
    const queryProcedure = `SELECT ${schema}.sp_busca_preco($1, $2, $3, $4, $5, $6, $7)`;
    const paramsProcedure = [
      schema,
      codEmpresa,
      codItem,
      codPessoa,
      codFormaPagto,
      tipoPreco,
      precoMenorQue || 0,
    ];

    console.log("Query Procedure:", queryProcedure);
    await db.query_trocaprecos(queryProcedure, paramsProcedure);
    console.log("✓ Procedure executada com sucesso");

    // PASSO 2: Buscar os dados da tabela com os JOINs
    console.log("=== PASSO 2: Buscando dados com JOINs ===");

    // Calcular paginação
    const offset = (page - 1) * pageSize;
    console.log(`Buscando página ${page} (LIMIT ${pageSize} OFFSET ${offset})`);

    const querySelect = `
      SELECT DISTINCT ON (a.id_preco, a.seq_preco, a.cod_empresa, a.cod_pessoa, a.cod_item, a.cod_condicao_pagamento)
        e.cod_empresa,
        e.nom_fantasia, 
        b.cod_pessoa,
        b.nom_pessoa, 
        c.cod_item,
        c.des_item, 
        d.cod_forma_pagto,
        d.des_forma_pagto,
        a.dta_inicio,
        a.ind_tipo_negociacao,
        a.ind_percentual_valor,
        a.ind_tipo_preco_base,
        a.val_preco_venda_a,
        a.val_preco_venda_b,
        a.val_preco_venda_c,
        a.val_preco_venda_d,
        a.val_preco_venda_e,
        COALESCE(f.val_custo_medio, 0) as val_custo_medio,
        COALESCE(f.val_preco_venda, 0) as val_preco_venda,
        a.cod_condicao_pagamento,
        a.des_observacao,
        a.num_chf,
        a.dta_inclusao,
        a.hra_inclusao,
        a.nom_usuario_inclusao,
        a.ind_diferencia_preco_unitario,
        a.seq_preco,
        a.ind_todas_empresas,
        a.id_preco,
        a.nom_usuario_replicacao,
        a.dta_replicacao,
        a.hra_replicacao
      FROM ${schema}.tab_preco_emsys a
      INNER JOIN ${schema}.tab_pessoa b ON (a.cod_pessoa = b.cod_pessoa)
      INNER JOIN ${schema}.tab_item c ON (c.cod_item = a.cod_item)
      INNER JOIN ${schema}.tab_forma_pagto d ON (d.cod_forma_pagto = a.cod_condicao_pagamento)
      INNER JOIN ${schema}.tab_empresa_schema e ON (e.cod_empresa = a.cod_empresa AND d.cod_empresa = e.cod_empresa)
      LEFT JOIN ${schema}.tab_custo_preco f ON (f.cod_empresa = a.cod_empresa AND f.cod_item = a.cod_item)
      ORDER BY a.id_preco, a.seq_preco, a.cod_empresa, a.cod_pessoa, a.cod_item, a.cod_condicao_pagamento, e.nom_fantasia, b.nom_pessoa, c.des_item, d.ind_tipo, d.des_forma_pagto
      LIMIT $1 OFFSET $2
    `;

    console.log("Query Select:", querySelect);
    const result = await db.query_trocaprecos(querySelect, [pageSize, offset]);

    console.log(`=== Resultados encontrados: ${result.rows.length} ===`);
    if (result.rows.length > 0) {
      console.log("Primeira linha de exemplo:", result.rows[0]);
    } else {
      console.log("⚠️ Nenhum resultado encontrado após os JOINs");
    }

    res.status(200).json({
      message: result.rows,
      pagination: {
        page: page,
        pageSize: pageSize,
        totalRetornado: result.rows.length,
        hasMore: result.rows.length === pageSize,
      },
    });
  } catch (error) {
    console.error("=== ERRO em buscaPrecoEmsys ===");
    console.error("Mensagem:", error.message);
    console.error("Stack:", error.stack);
    console.error("Detalhes:", error);
    res.status(500).json({
      message: "Falha ao buscar preços: " + error.message,
    });
  }
};

//=> Método responsável por atualizar preços na tab_preco_emsys
exports.atualizarPrecosEmsys = async (req, res) => {
  const { schema, precos } = req.body;

  try {
    await db.query_trocaprecos("BEGIN");

    let updatedCount = 0;

    for (const preco of precos) {
      // Construir cláusula SET dinâmica apenas para campos que foram alterados
      let setFields = [];
      let params = [];
      let paramCounter = 1;

      if (
        preco.val_novo_preco_a !== undefined &&
        preco.val_novo_preco_a !== null
      ) {
        setFields.push(`val_preco_venda_a = $${paramCounter}`);
        params.push(preco.val_novo_preco_a);
        paramCounter++;
      }

      if (
        preco.val_novo_preco_b !== undefined &&
        preco.val_novo_preco_b !== null
      ) {
        setFields.push(`val_preco_venda_b = $${paramCounter}`);
        params.push(preco.val_novo_preco_b);
        paramCounter++;
      }

      if (
        preco.val_novo_preco_c !== undefined &&
        preco.val_novo_preco_c !== null
      ) {
        setFields.push(`val_preco_venda_c = $${paramCounter}`);
        params.push(preco.val_novo_preco_c);
        paramCounter++;
      }

      if (
        preco.val_novo_preco_d !== undefined &&
        preco.val_novo_preco_d !== null
      ) {
        setFields.push(`val_preco_venda_d = $${paramCounter}`);
        params.push(preco.val_novo_preco_d);
        paramCounter++;
      }

      if (
        preco.val_novo_preco_e !== undefined &&
        preco.val_novo_preco_e !== null
      ) {
        setFields.push(`val_preco_venda_e = $${paramCounter}`);
        params.push(preco.val_novo_preco_e);
        paramCounter++;
      }

      // Se houver alterações, fazer o UPDATE
      if (setFields.length > 0) {
        // Adicionar informações de replicação
        const dataAtual = moment().format("YYYY-MM-DD");
        const horaAtual = moment().format("HH:mm:ss");

        setFields.push(`dta_replicacao = $${paramCounter}`);
        params.push(dataAtual);
        paramCounter++;

        setFields.push(`hra_replicacao = $${paramCounter}`);
        params.push(horaAtual);
        paramCounter++;

        setFields.push(`nom_usuario_replicacao = $${paramCounter}`);
        params.push("Sistema Atualização"); // Pode ser alterado para incluir usuário logado
        paramCounter++;

        // Adicionar parâmetros de WHERE
        params.push(preco.cod_empresa);
        const codEmpresaParam = paramCounter;
        paramCounter++;

        params.push(preco.cod_item);
        const codItemParam = paramCounter;
        paramCounter++;

        params.push(preco.dta_inicio);
        const dtaInicioParam = paramCounter;
        paramCounter++;

        const updateQuery = `
          UPDATE ${schema}.tab_preco_emsys
          SET ${setFields.join(", ")}
          WHERE cod_empresa = $${codEmpresaParam}
            AND cod_item = $${codItemParam}
            AND dta_inicio = $${dtaInicioParam}
        `;

        await db.query_trocaprecos(updateQuery, params);
        updatedCount++;
      }
    }

    await db.query_trocaprecos("COMMIT");

    res.status(200).json({
      message: `${updatedCount} preço(s) atualizado(s) com sucesso!`,
      updatedCount: updatedCount,
    });
  } catch (error) {
    await db.query_trocaprecos("ROLLBACK");
    console.error("Erro em atualizarPrecosEmsys:", error);
    res.status(500).json({
      message: "Falha ao atualizar preços: " + error.message,
    });
  }
};
