-- ============================================================================
-- Migration 006: remove o fallback por USUARIO adicionado na migration 005
--
-- Decisao do usuario: quem manda e o GRUPO, ponto. Nao deve haver
-- configuracao individual valendo nada -- se o usuario nao esta em nenhum
-- grupo com perfil ativo, cai direto na regra antiga (legado, sem
-- restricao), sem passar por tbl_usuario_perfil_aprovacao.
--
-- tbl_usuario_perfil_aprovacao continua existindo (nao foi dropada, para
-- nao perder historico/auditoria), mas a partir desta migration ela NAO E
-- MAIS CONSULTADA em nenhum fluxo de aprovacao.
-- ============================================================================

\set schema zmaisz

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

    -- Unica fonte de verdade: perfil configurado por GRUPO (o mais
    -- permissivo entre os grupos ativos do usuario, caso pertenca a mais
    -- de um). Sem fallback por usuario individual.
    SELECT gp.ind_perfil_aprovacao, gp.val_margem_minima_autonomia
    INTO v_melhor
    FROM tab_usuario_grupo ug
    JOIN tbl_grupo_perfil_aprovacao gp
        ON gp.cod_grupo = ug.cod_grupo AND gp.ind_ativo = 'S'
    WHERE ug.cod_usuario = p_cod_usuario
    ORDER BY gp.val_margem_minima_autonomia ASC
    LIMIT 1;

    -- Nenhum grupo do usuario tem perfil ativo -> legado (sem restricao)
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
