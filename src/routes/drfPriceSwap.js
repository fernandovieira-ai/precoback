/**
 * arquivo: routes/drfPriceSwap.js
 * descrição: arquivo responsável pelas rotas da API TrocaPreco
 * data: 29/01/2026
 */

const router = require("express-promise-router")();
const drfPriceSwap = require("../controllers/drfPriceSwap");

//=> Definindo as rotas do CRUD - TrocaPreco

router.post("/login", drfPriceSwap.fazerLogin);

router.post("/alterarSenha", drfPriceSwap.alterarSenha);

router.post("/novoUsuario", drfPriceSwap.novoUsuario);

router.post("/removeUsuario", drfPriceSwap.removeUsuario);

router.post("/buscaUsuario", drfPriceSwap.buscaUsuario);

router.post("/updateUsuario", drfPriceSwap.updateUsuario);

router.post("/sincronizaCadastros", drfPriceSwap.sincronizaCadastros);

router.post("/atualizaUsuarios", drfPriceSwap.atualizaUsuarios);

router.post(
  "/atualizarCadastroClientes",
  drfPriceSwap.atualizarCadastroClientes,
);

router.post("/buscaEmpresasBase", drfPriceSwap.buscaEmpresasBase);

router.post("/buscaFiltroPreLoad", drfPriceSwap.buscaFiltroPreLoad);

router.post("/buscaFiltro", drfPriceSwap.buscaFiltro);

router.post("/buscaClientesFiltro", drfPriceSwap.buscaClientesFiltro);

router.post("/atualizaCustoPrecoPorItens", drfPriceSwap.atualizaCustoPrecoPorItens);

router.post("/buscaCustoPrecoItens", drfPriceSwap.buscaCustoPrecoItens);

router.post("/buscaItensPrecoAtualizacao", drfPriceSwap.buscaItensPrecoAtualizacao);

router.post("/buscaItemBomba", drfPriceSwap.buscaItemBomba);

router.post("/buscaFiltroItem", drfPriceSwap.buscaFiltroItem);

router.post("/buscaSubgruposPista", drfPriceSwap.buscaSubgruposPista);

router.post(
  "/atualizarCustosPrecoPista",
  drfPriceSwap.atualizarCustosPrecoPista,
);

router.post("/buscaPrecosCliente", drfPriceSwap.buscaPrecosCliente);

router.post("/novaNegociacao", drfPriceSwap.novaNegociacao);

router.post("/buscaMinhasNegociacoes", drfPriceSwap.buscaMinhasNegociacoes);

router.post("/buscaNegociacoesEmpresa", drfPriceSwap.buscaNegociacoesEmpresa);

router.post(
  "/buscaMinhasNegociacoesDetalhe",
  drfPriceSwap.buscaMinhasNegociacoesDetalhe,
);

router.post(
  "/buscaAtualizacaoNegociacao",
  drfPriceSwap.buscaAtualizacaoNegociacao,
);

router.post("/atualizaNegociacao", drfPriceSwap.atualizaNegociacao);

router.post("/excluirNegociacao", drfPriceSwap.excluirNegociacao);

router.post("/enviaTrocaPreco", drfPriceSwap.enviaTrocaPreco);

router.post("/aprovaRegra", drfPriceSwap.aprovaRegra);

router.post("/reprovaRegra", drfPriceSwap.reprovaRegra);

//=> Sistema de Autonomia de Descontos
router.post("/validarAutonomiaAprovacao", drfPriceSwap.validarAutonomiaAprovacao);

router.post("/solicitarAprovacaoSuperior", drfPriceSwap.solicitarAprovacaoSuperior);

router.post("/listarPendentesAprovacaoSuperior", drfPriceSwap.listarPendentesAprovacaoSuperior);

//=> Parâmetro geral (kill switch)
router.post("/buscarParametroAutonomia", drfPriceSwap.buscarParametroAutonomia);

router.post("/atualizarParametroAutonomia", drfPriceSwap.atualizarParametroAutonomia);

//=> Administração de Perfis por GRUPO (tela protegida por senha admin)
router.post("/validarSenhaAdmin", drfPriceSwap.validarSenhaAdmin);

router.post("/listarGruposAutonomia", drfPriceSwap.listarGruposAutonomia);

router.post("/listarUsuariosGrupo", drfPriceSwap.listarUsuariosGrupo);
router.post("/buscarUsuarioGrupo", drfPriceSwap.buscarUsuarioGrupo);

router.post("/atualizarPerfilGrupo", drfPriceSwap.atualizarPerfilGrupo);

router.post("/desativarPerfilGrupo", drfPriceSwap.desativarPerfilGrupo);

router.post("/historicoConfigGrupo", drfPriceSwap.historicoConfigGrupo);

router.post("/buscaPrecoIntervalo", drfPriceSwap.buscaPrecoIntervalo);

router.post("/buscaPrecoEmsys", drfPriceSwap.buscaPrecoEmsys);

router.post("/atualizarPrecosEmsys", drfPriceSwap.atualizarPrecosEmsys);

module.exports = router;
