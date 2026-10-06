-- ============================================================================
-- Migration 005: fn_validar_autonomia_aprovacao com fallback GRUPO -> USUARIO
--
-- Bug encontrado: aprovaRegra/validarAutonomiaAprovacao (controller) ainda
-- checavam tbl_usuario_perfil_aprovacao (tabela por usuario, orfa desde o
-- pivot para grupos na migration 003) para decidir SE valida autonomia.
-- Como a tela admin grava em tbl_grupo_perfil_aprovacao, essa checagem
-- nunca encontrava nada -- exceto para 2 usuarios de teste que sobraram de
-- antes do pivot (AMANDA.QUEIROZ, DANIELE.OLIVEIRA). Resultado: a
-- configuracao por grupo nao bloqueava ninguem na pratica.
--
-- Regra correta (confirmada com o usuario): GRUPO tem prioridade -- se o
-- usuario esta em algum grupo com perfil ativo, obedece o grupo. Se nao
-- esta em nenhum grupo configurado, cai no fallback por USUARIO (a
-- configuracao individual antiga, para casos fora de qualquer grupo). Se
-- nenhum dos dois existir, mantem o comportamento legado (sem restricao).
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

    -- 1) Prioridade: perfil configurado por GRUPO (o mais permissivo entre
    -- os grupos ativos do usuario, caso pertenca a mais de um)
    SELECT gp.ind_perfil_aprovacao, gp.val_margem_minima_autonomia
    INTO v_melhor
    FROM tab_usuario_grupo ug
    JOIN tbl_grupo_perfil_aprovacao gp
        ON gp.cod_grupo = ug.cod_grupo AND gp.ind_ativo = 'S'
    WHERE ug.cod_usuario = p_cod_usuario
    ORDER BY gp.val_margem_minima_autonomia ASC
    LIMIT 1;

    -- 2) Fallback: nenhum grupo do usuario tem perfil ativo -> usa
    -- configuracao manual por USUARIO (tbl_usuario_perfil_aprovacao),
    -- para casos individuais fora de qualquer grupo configurado.
    IF v_melhor IS NULL THEN
        SELECT up.ind_perfil_aprovacao, up.val_margem_minima_autonomia
        INTO v_melhor
        FROM tbl_usuario_perfil_aprovacao up
        WHERE up.cod_usuario = p_cod_usuario AND up.ind_ativo = 'S';
    END IF;

    -- 3) Nem grupo nem usuario configurados -> legado (sem restricao)
    IF v_melhor IS NULL THEN
        RETURN QUERY SELECT
            FALSE,
            'sem_perfil'::VARCHAR,
            NULL::NUMERIC,
            'Usuario nao possui perfil de autonomia configurado (nem por grupo, nem individual)'::TEXT;
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
