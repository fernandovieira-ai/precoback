-- ============================================================================
-- Migration 002: Parametro geral de ativacao do sistema de autonomia
--
-- Permite desligar TODA a regra de autonomia de uma vez (kill switch),
-- independente dos perfis individuais ja configurados. Quando desativado,
-- o comportamento volta a ser o legado: quem tem ind_aprova_negociacao='S'
-- aprova qualquer margem, como sempre foi.
-- ============================================================================

\set schema zmaisz

CREATE TABLE IF NOT EXISTS :schema.tbl_parametro_autonomia (
    cod_parametro           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (cod_parametro = 1), -- linha unica
    ind_ativo               CHAR(1) NOT NULL DEFAULT 'N' CHECK (ind_ativo IN ('S','N')),
    cod_usuario_alteracao   INTEGER,
    nom_usuario_alteracao   VARCHAR(50),
    des_justificativa       TEXT,
    dta_alteracao            TIMESTAMP NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE :schema.tbl_parametro_autonomia IS
    'Liga/desliga o sistema de autonomia de descontos por margem para todo o schema. Linha unica (cod_parametro=1). ind_ativo=N restaura o comportamento legado (ind_aprova_negociacao decide tudo, sem checar margem).';

-- Garante a linha unica, ja desativada por padrao (rollout controlado:
-- so passa a valer depois que alguem ativar explicitamente pela tela admin).
INSERT INTO :schema.tbl_parametro_autonomia (cod_parametro, ind_ativo)
VALUES (1, 'N')
ON CONFLICT (cod_parametro) DO NOTHING;
