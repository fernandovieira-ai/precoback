-- ============================================================================
-- Migration 003: Autonomia de descontos configurada por GRUPO (nao mais por usuario)
--
-- Contexto: sp_atualiza_usuario trazia so usuarios dos grupos 6 e 13, e
-- descartava a informacao de grupo. Isso mudou: agora trazemos TODOS os
-- usuarios ativos e TODOS os grupos ativos do EMSys3, e a autonomia passa a
-- ser configurada uma vez por grupo (ex: "Gerente Posto e Lojas") em vez de
-- usuario por usuario -- com 300+ usuarios isso e inviavel de configurar
-- individualmente.
--
-- As tabelas tbl_usuario_perfil_aprovacao e tbl_historico_config_perfil da
-- migration 001 NAO sao mais usadas por este fluxo (ficam orfas, sem drop,
-- para nao perder o que ja foi configurado manualmente ate aqui).
-- ============================================================================

\set schema zmaisz

-- ----------------------------------------------------------------------------
-- 1. Catalogo de grupos do EMSys3 (sincronizado)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS :schema.tab_grupo_usuario (
    cod_grupo       INTEGER PRIMARY KEY,
    des_grupo       VARCHAR(100) NOT NULL,
    dta_atualizacao TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE :schema.tab_grupo_usuario IS
    'Catalogo de grupos de usuario do EMSys3, sincronizado por sp_atualiza_usuario';

-- ----------------------------------------------------------------------------
-- 2. Relacao usuario-grupo (N:N, sincronizada)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS :schema.tab_usuario_grupo (
    cod_usuario INTEGER NOT NULL REFERENCES :schema.tab_usuario(cod_usuario),
    cod_grupo   INTEGER NOT NULL REFERENCES :schema.tab_grupo_usuario(cod_grupo),
    PRIMARY KEY (cod_usuario, cod_grupo)
);

CREATE INDEX IF NOT EXISTS idx_usuario_grupo_grupo
    ON :schema.tab_usuario_grupo(cod_grupo);

-- ----------------------------------------------------------------------------
-- 3. Perfil de autonomia POR GRUPO
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS :schema.tbl_grupo_perfil_aprovacao (
    cod_grupo                   INTEGER PRIMARY KEY REFERENCES :schema.tab_grupo_usuario(cod_grupo),
    des_grupo                   VARCHAR(100),
    ind_perfil_aprovacao        VARCHAR(20) NOT NULL
        CHECK (ind_perfil_aprovacao IN ('gerente_unidade', 'supervisor', 'diretor')),
    val_margem_minima_autonomia NUMERIC(10,2) NOT NULL DEFAULT 0.20,
    ind_ativo                   CHAR(1) NOT NULL DEFAULT 'S' CHECK (ind_ativo IN ('S','N')),
    cod_usuario_alteracao       INTEGER,
    nom_usuario_alteracao       VARCHAR(50),
    dta_cadastro                 TIMESTAMP NOT NULL DEFAULT NOW(),
    dta_alteracao                 TIMESTAMP
);

COMMENT ON TABLE :schema.tbl_grupo_perfil_aprovacao IS
    'Perfil de autonomia configurado por grupo do EMSys3. Todo usuario daquele grupo herda a margem automaticamente.';

-- ----------------------------------------------------------------------------
-- 4. Historico de alteracoes de perfil por grupo (auditoria)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS :schema.tbl_historico_config_grupo (
    seq_historico          SERIAL PRIMARY KEY,
    cod_grupo               INTEGER NOT NULL,
    des_grupo               VARCHAR(100),
    cod_usuario_admin       INTEGER NOT NULL,
    nom_usuario_admin       VARCHAR(50),
    ind_perfil_anterior      VARCHAR(20),
    ind_perfil_novo          VARCHAR(20),
    val_margem_anterior      NUMERIC(10,2),
    val_margem_nova          NUMERIC(10,2),
    des_justificativa        TEXT NOT NULL,
    ip_origem                VARCHAR(50),
    dta_alteracao             TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hist_config_grupo
    ON :schema.tbl_historico_config_grupo(cod_grupo);

-- ----------------------------------------------------------------------------
-- 5. Funcao de validacao de autonomia, agora por grupo
--
-- Regra quando o usuario pertence a mais de um grupo com perfil configurado:
-- usa o de MENOR margem minima (mais permissivo) -- ele "ganhou" aquele
-- nivel de autonomia atraves de qualquer um dos grupos que participa.
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
DECLARE
    v_empresas INTEGER[];
    v_melhor RECORD;
BEGIN
    SELECT empresa INTO v_empresas
    FROM tab_usuario
    WHERE cod_usuario = p_cod_usuario;

    IF v_empresas IS NULL OR NOT (p_cod_empresa = ANY(v_empresas)) THEN
        RETURN QUERY SELECT
            FALSE,
            'sem_empresa'::VARCHAR,
            NULL::NUMERIC,
            'Usuario nao tem acesso a esta empresa no EMSys3'::TEXT;
        RETURN;
    END IF;

    SELECT gp.ind_perfil_aprovacao, gp.val_margem_minima_autonomia
    INTO v_melhor
    FROM tab_usuario_grupo ug
    JOIN tbl_grupo_perfil_aprovacao gp
        ON gp.cod_grupo = ug.cod_grupo AND gp.ind_ativo = 'S'
    WHERE ug.cod_usuario = p_cod_usuario
    ORDER BY gp.val_margem_minima_autonomia ASC
    LIMIT 1;

    IF v_melhor IS NULL THEN
        RETURN QUERY SELECT
            FALSE,
            'sem_perfil'::VARCHAR,
            NULL::NUMERIC,
            'Nenhum dos grupos deste usuario tem perfil de autonomia configurado'::TEXT;
        RETURN;
    END IF;

    IF p_margem_negociacao >= v_melhor.val_margem_minima_autonomia THEN
        RETURN QUERY SELECT
            TRUE,
            v_melhor.ind_perfil_aprovacao,
            v_melhor.val_margem_minima_autonomia,
            NULL::TEXT;
    ELSE
        RETURN QUERY SELECT
            FALSE,
            v_melhor.ind_perfil_aprovacao,
            v_melhor.val_margem_minima_autonomia,
            format('Margem de R$ %s requer aprovacao de nivel superior (autonomia atual: R$ %s)',
                   p_margem_negociacao, v_melhor.val_margem_minima_autonomia)::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql
SET search_path = :"schema", public;
