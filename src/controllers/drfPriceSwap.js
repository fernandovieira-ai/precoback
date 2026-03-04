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

// NOTA IMPORTANTE: Este arquivo foi copiado do projeto original
// com a correção aplicada na função sincronizaCadastros para usar
// sp_atualiza_cadastro(param1, param2, param3, param4)

//=> metodo responsavel por listar os usuarios por ID
exports.fazerLogin = async (req, res) => {
  const { nom_usuario, senha } = req.body;

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
      nom_usuario = $1
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
                                  b.val_custo_medio,
                                  b.cod_empresa,
                                  d.nom_fantasia
                                  from ${schema}.tab_item a
                                  inner join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item)
                                  inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item and c.cod_empresa = b.cod_empresa)
                                  inner join ${schema}.tab_empresa_schema d on (c.cod_empresa = d.cod_empresa)
                                  where cod_subgrupo in (1, 43, 47)
                                  and b.cod_empresa in (${cod_empresa})
                                  order by cod_item`);
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
                                        b.val_custo_medio,
                                        b.cod_empresa,
                                        d.nom_fantasia,
                                        0 as val_novo_preco_venda
                                        from ${schema}.tab_item a
                                        inner join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item)
                                        inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item and c.cod_empresa = b.cod_empresa) 
                                        inner join ${schema}.tab_empresa_schema d on (c.cod_empresa = d.cod_empresa) 
                                        where cod_subgrupo in (1) 
                                        and b.cod_empresa in (${placeholders})
                                        order by cod_item`,
      empresasSelecionadas,
    );


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
                                  b.val_custo_medio,
                                  b.cod_empresa,
                                  d.nom_fantasia
                                  from ${schema}.tab_item a
                                  inner join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item)
                                  inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item and c.cod_empresa = b.cod_empresa) 
                                  inner join ${schema}.tab_empresa_schema d on (c.cod_empresa = d.cod_empresa) 
                                  where cod_subgrupo in (1) 
                                  and b.cod_empresa in (${placeholders})
                                  order by cod_item`,
      empresasSelecionadas,
    );

    const formaPagto = await db.query_trocaprecos(
      `select distinct cod_forma_pagto, des_forma_pagto, false as ind_selecionado, ind_tipo from ${schema}.tab_forma_pagto where cod_empresa in (${placeholders}) order by cod_forma_pagto`,
      empresasSelecionadas,
    );

    const itemFull = await db.query_trocaprecos(
      `select a.cod_item, a.des_item 
                                      from ${schema}.tab_item a
                                      inner join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item)
                                      inner join ${schema}.tab_item_empresa c on (c.cod_item = a.cod_item and c.cod_empresa = b.cod_empresa) 
                                      where a.cod_subgrupo in (1) 
                                      and b.cod_empresa in (${placeholders})
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
        // Query otimizada: JOIN direto entre tab_subgrupo_item, tab_item e tab_item_empresa
        // Filtra apenas itens que possuem preço cadastrado na empresa selecionada
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
          FROM zmaisz.tab_subgrupo_item a 
          INNER JOIN ${schema}.tab_item b ON (a.cod_subgrupo_item = b.cod_subgrupo) 
          INNER JOIN ${schema}.tab_item_empresa c ON (c.cod_item = b.cod_item)
          LEFT JOIN ${schema}.tab_custo_preco cp ON (cp.cod_item = b.cod_item AND cp.cod_empresa = c.cod_empresa)
          WHERE c.cod_empresa = $1
            AND LOWER(a.des_modulo) = LOWER($2)
            AND EXISTS (
              SELECT 1 FROM ${schema}.tab_custo_preco aa
              WHERE aa.cod_item = b.cod_item
              AND aa.cod_empresa = $1
            )
          ORDER BY b.des_subgrupo, b.des_item
        `,
          [empresa.cod_empresa, modulo || "pista"],
        );
        // Log dos primeiros itens para debug
        if (itensEmpresa.rows.length > 0) {
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

        // Para cada empresa, executa o procedimento para todos os itens
        for (const empresa of cod_empresa_sel) {
          // Executa o procedimento para atualizar custos/preços
          const query = `
            SELECT ${schema}.sp_custo_preco(${empresa}, a.cod_item, 0) 
            FROM ${schema}.tab_item a
          `;

          await db.query_trocaprecos(query);
        }

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
      } catch (bgError) {
        console.error(
          "[atualizarCustosPrecoPista] Erro no processamento background:",
          bgError,
        );
      }
    });
  } catch (error) {
    console.error("[atualizarCustosPrecoPista] ERRO:", error);
    res.status(500).json({
      message:
        "Falha ao iniciar atualização de custos/preços: " + error.message,
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
                                                d.nom_pessoa,
                                                e.des_item,
                                                false as ind_adicionado,
                                                b.val_preco_venda
                                              from ${schema}.tab_preco_emsys a
                                              left join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item)
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

  // LOG CRÍTICO: Verificar dados recebidos do frontend
  itens.slice(0, 3).forEach((item, idx) => {
      ind_tipo_negociacao: item.ind_tipo_negociacao,
      ind_percentual_valor: item.ind_percentual_valor,
      ind_tipo_preco_base: item.ind_tipo_preco_base,
      val_preco_venda_a: item.val_preco_venda_a,
      val_preco_venda_b: item.val_preco_venda_b,
      valor_calculado: item.valor_calculado,
      valor: item.valor,
    });
  });

  try {
    res.status(200).json({
      message: "Negociações Enviadas, consulte Histórico!",
    });

    novaNegociacaoInsert(
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

async function novaNegociacaoInsert(
  schema,
  cod_empresa,
  nom_usuario,
  cod_usuario,
  cliente,
  itens,
) {
  const total = itens.length * cliente.length; // Corrija o acesso ao tamanho do array
  const batchSize = 100; // Tamanho do lote para chamar geraStatus
  let progresso = 0;
  let empresa = 0;

  const seq_lote = await db.query_trocaprecos(
    `select nextval('${schema}.gen_lote')`,
  );

  try {
    for (const c of cliente) {
      for (let i = 0; i < itens.length; i++) {
        // LOG: Verificar valores antes do INSERT
          ind_tipo_negociacao: itens[i].ind_tipo_negociacao,
          ind_percentual_valor: itens[i].ind_percentual_valor,
          val_preco_venda_a: itens[i].val_preco_venda_a,
          valor_informado: itens[i].valor,
          valor_calculado: itens[i].valor_calculado,
        });

        // Executa a inserção dentro da transação
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
            `${seq_lote.rows[0].nextval} Inclusao Negociação`,
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

        if (progresso === total) {
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
    }
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
        [lote, total, progresso, "Concluído e Pendente de Aprovação"],
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
      await db.query_trocaprecos(`SELECT a.dta_inclusao, a.seq_lote_alteracao, b.nom_fantasia, b.cod_empresa, a.ind_excluido, COUNT(*) AS total_registros, c.progresso, c.total, c.error, a.des_observacao
                                          FROM ${schema}.tab_nova_regra a
                                          inner join ${schema}.tab_empresa_schema b on (a.cod_empresa = b.cod_empresa)
                                          inner join ${schema}.tab_progresso_lote c on (a.seq_lote_alteracao = c.seq_lote)
                                          where a.cod_empresa in (${cod_empresa})
                                          and a.ind_excluido != 'S'
                                          and a.ind_status = 'X'
                                          group by 1,3,2,4,5,7,8,9,10
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
                                    a.ind_percentual_valor, ind_tipo_negociacao, ind_tipo_preco_base, val_preco_venda_a, val_preco_venda_b, val_preco_venda_c, val_preco_venda_d, val_preco_venda_e, a.ind_status,
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
  const { schema, cod_empresa, nom_usuario, seq_lote } = req.body;
  try {
    await db.query_trocaprecos("BEGIN");

    await db.query_trocaprecos(
      `update ${schema}.tab_nova_regra
                    set ind_status = 'T',
                        usuario_aprovacao = $2
                    where cod_empresa in ($3)
                    and seq_lote_alteracao = $1`,
      [seq_lote, nom_usuario, cod_empresa],
    );

    await db.query_trocaprecos(
      `update ${schema}.tab_progresso_lote
                    set error = 'Aprovado'
                    where seq_lote = $1`,
      [seq_lote],
    );

    await db.query_trocaprecos("COMMIT");

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

    await db.query_trocaprecos(
      `update ${schema}.tab_nova_regra
                    set ind_excluido = 'S'
                    where seq_lote_alteracao = $1`,
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
                                                d.nom_pessoa,
                                                e.des_item,
                                                false as ind_adicionado,
                                                b.val_preco_venda
                                              from ${schema}.tab_preco_emsys a
                                              left join ${schema}.tab_custo_preco b on (a.cod_item = b.cod_item)
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
  } = req.body;

    "Tipo Negociação:",
    tipoNegociacao,
    "| Tipo:",
    typeof tipoNegociacao,
    "| Length:",
    tipoNegociacao?.length,
  );

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

    await db.query_trocaprecos(queryProcedure, paramsProcedure);

    // PASSO 2: Buscar os dados da tabela com os JOINs

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
    `;

    const result = await db.query_trocaprecos(querySelect);

    if (result.rows.length > 0) {
    } else {
    }

    res.status(200).json({
      message: result.rows,
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
