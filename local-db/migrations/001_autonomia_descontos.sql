-- ============================================================================
-- Migration 001: Sistema de Autonomia de Descontos
--
-- Cria as tabelas de perfil/autonomia, histórico de aprovação e administração,
-- DENTRO do schema de cada cliente (multi-tenant, igual as demais tabelas de
-- negócio: tab_usuario, tab_nova_regra, etc. já vivem em "zmaisz").
--
-- Execução: psql -v schema=zmaisz -f 001_autonomia_descontos.sql
-- (ou substitua :schema manualmente antes de rodar)
-- ============================================================================

\set schema zmaisz

-- ----------------------------------------------------------------------------
-- 1. Perfis de autonomia por usuário
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS :schema.tbl_usuario_perfil_aprovacao (
    cod_usuario                INTEGER PRIMARY KEY REFERENCES :schema.tab_usuario(cod_usuario),
    nom_usuario                VARCHAR(50) NOT NULL,
    ind_perfil_aprovacao       VARCHAR(20) NOT NULL
        CHECK (ind_perfil_aprovacao IN ('gerente_unidade', 'supervisor', 'diretor')),
    val_margem_minima_autonomia NUMERIC(10,2) NOT NULL DEFAULT 0.20,
    cod_empresa                INTEGER[],
    ind_ativo                  CHAR(1) NOT NULL DEFAULT 'S' CHECK (ind_ativo IN ('S','N')),

    -- Protege contra sobrescrita pela sincronização automática (sp_atualiza_usuario)
    ind_config_manual          CHAR(1) NOT NULL DEFAULT 'N' CHECK (ind_config_manual IN ('S','N')),
    cod_usuario_alteracao      INTEGER,
    nom_usuario_alteracao      VARCHAR(50),

    dta_cadastro                TIMESTAMP NOT NULL DEFAULT NOW(),
    dta_alteracao                TIMESTAMP
);

COMMENT ON TABLE :schema.tbl_usuario_perfil_aprovacao IS
    'Perfil de autonomia de aprovação por usuário. ind_config_manual=S protege contra a sincronização automática de sp_atualiza_usuario.';

CREATE INDEX IF NOT EXISTS idx_perfil_aprovacao_tipo
    ON :schema.tbl_usuario_perfil_aprovacao(ind_perfil_aprovacao);

CREATE INDEX IF NOT EXISTS idx_perfil_aprovacao_ativo
    ON :schema.tbl_usuario_perfil_aprovacao(ind_ativo) WHERE ind_ativo = 'S';

-- ----------------------------------------------------------------------------
-- 2. Histórico de solicitações/aprovações (quando falta autonomia)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS :schema.tbl_historico_aprovacao_negociacao (
    seq_historico              SERIAL PRIMARY KEY,
    seq_lote_alteracao         INTEGER NOT NULL,
    cod_empresa                INTEGER NOT NULL,

    cod_usuario_solicitante    INTEGER NOT NULL,
    nom_usuario_solicitante    VARCHAR(50),

    cod_usuario_aprovador      INTEGER,
    nom_usuario_aprovador      VARCHAR(50),

    val_margem_negociacao      NUMERIC(10,2),
    ind_perfil_necessario      VARCHAR(20),
    ind_aprovacao_automatica   CHAR(1) NOT NULL DEFAULT 'N' CHECK (ind_aprovacao_automatica IN ('S','N')),
    ind_status                 VARCHAR(20) NOT NULL DEFAULT 'PENDENTE'
        CHECK (ind_status IN ('PENDENTE','APROVADO','REPROVADO')),

    des_observacao              TEXT,
    dta_solicitacao              TIMESTAMP NOT NULL DEFAULT NOW(),
    dta_aprovacao                TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_historico_aprov_lote
    ON :schema.tbl_historico_aprovacao_negociacao(seq_lote_alteracao, cod_empresa);

CREATE INDEX IF NOT EXISTS idx_historico_aprov_status
    ON :schema.tbl_historico_aprovacao_negociacao(ind_status);

-- ----------------------------------------------------------------------------
-- 3. Histórico de alterações manuais de perfil (auditoria da tela admin)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS :schema.tbl_historico_config_perfil (
    seq_historico               SERIAL PRIMARY KEY,
    cod_usuario_configurado     INTEGER NOT NULL,
    nom_usuario_configurado     VARCHAR(50),

    cod_usuario_admin           INTEGER NOT NULL,
    nom_usuario_admin           VARCHAR(50),

    ind_perfil_anterior          VARCHAR(20),
    ind_perfil_novo              VARCHAR(20),
    val_margem_anterior          NUMERIC(10,2),
    val_margem_nova              NUMERIC(10,2),
    empresas_anterior            INTEGER[],
    empresas_novas                INTEGER[],

    des_justificativa            TEXT NOT NULL,
    ip_origem                    VARCHAR(50),
    dta_alteracao                 TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hist_config_usuario
    ON :schema.tbl_historico_config_perfil(cod_usuario_configurado);

-- ----------------------------------------------------------------------------
-- 4. Usuários com acesso à tela de administração de perfis
--
-- NAO guarda senha propria: a validacao reusa a senha de LOGIN que o
-- usuario ja tem em tab_usuario.senha (mesmo hash MD5 calculado no
-- frontend, igual ao fluxo de login normal). Esta tabela e apenas a lista
-- de quem tem permissao de acessar a tela — nao ha credencial duplicada.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS :schema.tbl_admin_perfis (
    cod_usuario         INTEGER PRIMARY KEY REFERENCES :schema.tab_usuario(cod_usuario),
    nom_usuario         VARCHAR(50) NOT NULL,
    ind_ativo           CHAR(1) NOT NULL DEFAULT 'S' CHECK (ind_ativo IN ('S','N')),
    dta_cadastro         TIMESTAMP NOT NULL DEFAULT NOW(),
    dta_ultimo_acesso    TIMESTAMP,
    qtd_acessos          INTEGER NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- 5. Função: valida se um usuário tem autonomia para aprovar dada margem
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION :schema.fn_validar_autonomia_aprovacao(
    p_cod_usuario INTEGER,
    p_margem_negociacao NUMERIC,
    p_cod_empresa INTEGER
) RETURNS TABLE (
    pode_aprovar BOOLEAN,
    perfil VARCHAR,
    margem_autonomia NUMERIC,
    motivo TEXT
) AS $$
-- Nota: dentro do corpo desta função o psql NAO substitui a variavel de
-- schema (limitacao do dollar-quoting) -- por isso as tabelas abaixo sao
-- referenciadas sem prefixo, resolvidas via search_path (ver a clausula
-- SET search_path na declaracao da funcao, ao final).
DECLARE
    v_perfil RECORD;
BEGIN
    SELECT * INTO v_perfil
    FROM tbl_usuario_perfil_aprovacao
    WHERE cod_usuario = p_cod_usuario
      AND ind_ativo = 'S';

    IF v_perfil IS NULL THEN
        RETURN QUERY SELECT
            FALSE,
            'sem_perfil'::VARCHAR,
            NULL::NUMERIC,
            'Usuário não possui perfil de aprovação configurado'::TEXT;
        RETURN;
    END IF;

    IF v_perfil.cod_empresa IS NOT NULL AND NOT (p_cod_empresa = ANY(v_perfil.cod_empresa)) THEN
        RETURN QUERY SELECT
            FALSE,
            v_perfil.ind_perfil_aprovacao,
            v_perfil.val_margem_minima_autonomia,
            'Usuário não tem permissão para aprovar nesta empresa'::TEXT;
        RETURN;
    END IF;

    IF p_margem_negociacao >= v_perfil.val_margem_minima_autonomia THEN
        RETURN QUERY SELECT
            TRUE,
            v_perfil.ind_perfil_aprovacao,
            v_perfil.val_margem_minima_autonomia,
            NULL::TEXT;
    ELSE
        RETURN QUERY SELECT
            FALSE,
            v_perfil.ind_perfil_aprovacao,
            v_perfil.val_margem_minima_autonomia,
            format('Margem de R$ %s requer aprovação de nível superior (autonomia atual: R$ %s)',
                   p_margem_negociacao, v_perfil.val_margem_minima_autonomia)::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql
SET search_path = :"schema", public;

-- ----------------------------------------------------------------------------
-- 6. View: margem real de cada negociação pendente, cruzando com custo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW :schema.vw_negociacao_margem AS
SELECT
    r.seq_registro,
    r.seq_lote_alteracao,
    r.cod_empresa,
    r.cod_item,
    r.cod_usuario,
    r.nom_usuario,
    r.ind_status,
    r.ind_tipo_preco_base,
    -- preço de venda praticado, conforme o tipo de preço base da negociação (A-E)
    CASE r.ind_tipo_preco_base
        WHEN 'A' THEN r.val_preco_venda_a
        WHEN 'B' THEN r.val_preco_venda_b
        WHEN 'C' THEN r.val_preco_venda_c
        WHEN 'D' THEN r.val_preco_venda_d
        WHEN 'E' THEN r.val_preco_venda_e
    END AS val_preco_negociado,
    c.val_custo_medio,
    (CASE r.ind_tipo_preco_base
        WHEN 'A' THEN r.val_preco_venda_a
        WHEN 'B' THEN r.val_preco_venda_b
        WHEN 'C' THEN r.val_preco_venda_c
        WHEN 'D' THEN r.val_preco_venda_d
        WHEN 'E' THEN r.val_preco_venda_e
    END - c.val_custo_medio) AS val_margem
FROM :schema.tab_nova_regra r
LEFT JOIN :schema.tab_custo_preco c
    ON c.cod_empresa = r.cod_empresa AND c.cod_item = r.cod_item
WHERE r.ind_excluido != 'S';

COMMENT ON VIEW :schema.vw_negociacao_margem IS
    'Calcula a margem real (preço negociado - custo médio) por registro de tab_nova_regra, já que a margem não é armazenada.';
