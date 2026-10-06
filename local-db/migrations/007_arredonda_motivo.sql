-- ============================================================================
-- Migration 007: arredonda os valores exibidos no "motivo" da validacao
--
-- p_margem_negociacao chega com residuo de ponto flutuante (ex:
-- 0.08650999999999964, resultado de subtracao entre colunas float8) e o
-- format() da funcao usava o valor bruto direto no texto -- aparecia
-- "R$ 0.08650999999999964" na mensagem pro usuario. Arredonda pra 2 casas
-- antes de montar o texto.
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
                   ROUND(p_margem_negociacao, 2), ROUND(v_melhor.val_margem_minima_autonomia, 2))::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql
SET search_path = :"schema", public;
