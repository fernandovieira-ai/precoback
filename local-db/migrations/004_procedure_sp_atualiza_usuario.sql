-- ============================================================================
-- Migration 004: sp_atualiza_usuario atualizada (traz TODOS usuarios/grupos)
--
-- IMPORTANTE: este arquivo e a PROCEDURE REAL usada em producao para
-- sincronizar usuarios do EMSys3. Diferente das demais migrations desta
-- pasta (que so criam tabelas novas), este script SUBSTITUI uma procedure
-- que ja roda em producao hoje. Aplicar com atencao, fora do fluxo
-- automatico, so quando o time decidir subir esta mudanca.
--
-- O que mudou em relacao a versao anterior:
--   1. Removido o filtro "WHERE d.cod_grupo IN (13, 6)" -- agora traz TODOS
--      os usuarios ativos (ind_bloqueado = 'N'), nao so dos grupos 6/13.
--   2. Passa a popular tab_grupo_usuario (catalogo de grupos) e
--      tab_usuario_grupo (relacao N:N usuario-grupo), que antes eram
--      descartados -- so usados como filtro e depois jogados fora.
--   3. TROCADO de "DELETE + INSERT" para UPSERT (INSERT ... ON CONFLICT DO
--      UPDATE) em tab_usuario. Motivo: tab_usuario_grupo, tbl_admin_perfis
--      e tbl_usuario_perfil_aprovacao agora tem foreign key para
--      tab_usuario -- o DELETE original quebraria com violacao de FK assim
--      que qualquer uma dessas tabelas tivesse registros. UPSERT tambem
--      preserva o historico dessas tabelas de configuracao entre execucoes.
--
-- Isso e o que possibilita a tela de administracao de autonomia configurar
-- margem por GRUPO (ex: "Gerente Posto e Lojas") em vez de usuario por
-- usuario -- com centenas de usuarios, configurar um por um era inviavel.
-- ============================================================================

CREATE OR REPLACE FUNCTION zmaisz.sp_atualiza_usuario (
  schema varchar
)
RETURNS integer AS
$body$
DECLARE

basedados varchar(30);
host varchar(20);
usuario varchar(30);
senha varchar(30);
porta varchar(4);
conexao text;
codbase integer;
dtaatualizacao DATE;
conexaotipo char(1);


BEGIN



select dbname,

hostaddr ,

userbase ,

password ,

port,

cod_base,
dta_atualizacao,
conexao_tipo into

basedados,

host ,

usuario ,

senha ,

porta,

codbase,
dtaatualizacao,

conexaotipo

from tab_base

where nom_schema = schema;

if conexaotipo = 'R'
then
conexao='dbname=' || basedados || ' hostaddr=' || host || ' user=' || usuario || ' password=' || senha || ' port=' || porta;
ELSE
conexao='dbname=' || basedados ||  ' user=' || usuario || ' password=' || senha || ' port=' || porta;
END IF;



/**************************/

/*   USUARIO     */

/**************************/

-- Marca como inativo quem nao veio mais na lista do EMSys3 (bloqueado la),
-- sem apagar a linha -- preserva FKs de tab_usuario_grupo, tbl_admin_perfis
-- e tbl_usuario_perfil_aprovacao.
UPDATE tab_usuario
   SET ind_ativo = 'N'
 WHERE schema_base = schema;

INSERT INTO tab_usuario (
    cod_usuario, nom_usuario, senha, schema_base, des_rede, img_rede,
    ind_aprova_negociacao, ind_ativo, empresa
)
SELECT
    t.cod_usuario, t.nom_usuario, t.senha, t.schema_base, t.des_rede,
    t.img_rede, t.ind_aprova_negociacao, t.ind_ativo, t.empresa
FROM dblink(conexao,
'select   a.cod_usuario,
       a.nom_usuario,
       a.des_senha,
       cast(''zmaisz'' as varchar(50)) as schema_base,
       cast(''zmaisz'' as varchar(50)) as des_rede,
       null as img_rede,
       case
       when exists (select 1 from tab_acesso_usuario bb
       where cod_programa = 31390
       and   bb.cod_usuario = a.cod_usuario)
       then cast(''S'' AS CHAR(1))
       else cast(''N'' AS CHAR(1)) end as  ind_aprova_negociacao,
       cast(''S'' AS CHAR(1)) as  ind_ativo,
       (select array_agg(aa.cod_empresa  ORDER BY aa.cod_empresa) from tab_rel_usuario_empresa aa
       where aa.cod_usuario = a.cod_usuario) as empresa

 from tab_usuario a
 where a.ind_bloqueado = ''N''
 order by a.nom_usuario') t
  (cod_usuario integer,
  nom_usuario VARCHAR(50),
  senha VARCHAR(100),
  schema_base VARCHAR(20),
  des_rede VARCHAR(50),
  img_rede BYTEA,
  ind_aprova_negociacao CHAR(1),
  ind_ativo CHAR(1),
  empresa INTEGER [])
ON CONFLICT (cod_usuario) DO UPDATE SET
    nom_usuario = EXCLUDED.nom_usuario,
    senha = EXCLUDED.senha,
    ind_aprova_negociacao = EXCLUDED.ind_aprova_negociacao,
    ind_ativo = EXCLUDED.ind_ativo,
    empresa = EXCLUDED.empresa;



/**************************/

/*   GRUPOS (catalogo)    */

/**************************/

INSERT INTO zmaisz.tab_grupo_usuario (cod_grupo, des_grupo)
SELECT DISTINCT t.cod_grupo, t.des_grupo
FROM dblink(conexao,
'SELECT DISTINCT g.cod_grupo, g.des_grupo
 FROM tab_grupo_usuario g
 JOIN tab_rel_usuario_grupo rg ON rg.cod_grupo = g.cod_grupo
 JOIN tab_usuario u ON u.cod_usuario = rg.cod_usuario
 WHERE u.ind_bloqueado = ''N''
 ORDER BY 1') t (cod_grupo integer, des_grupo varchar(100))
ON CONFLICT (cod_grupo) DO UPDATE SET
    des_grupo = EXCLUDED.des_grupo,
    dta_atualizacao = NOW();

/**************************/

/*   USUARIO x GRUPO      */

/**************************/

DELETE FROM zmaisz.tab_usuario_grupo ug
WHERE EXISTS (
    SELECT 1 FROM zmaisz.tab_usuario u
    WHERE u.cod_usuario = ug.cod_usuario AND u.schema_base = schema
);

INSERT INTO zmaisz.tab_usuario_grupo (cod_usuario, cod_grupo)
SELECT DISTINCT t.cod_usuario, t.cod_grupo
FROM dblink(conexao,
'SELECT rg.cod_usuario, rg.cod_grupo
 FROM tab_rel_usuario_grupo rg
 JOIN tab_usuario u ON u.cod_usuario = rg.cod_usuario
 WHERE u.ind_bloqueado = ''N''') t (cod_usuario integer, cod_grupo integer)
WHERE EXISTS (SELECT 1 FROM zmaisz.tab_usuario tu WHERE tu.cod_usuario = t.cod_usuario)
  AND EXISTS (SELECT 1 FROM zmaisz.tab_grupo_usuario tg WHERE tg.cod_grupo = t.cod_grupo)
ON CONFLICT DO NOTHING;



 RETURN 0;



END;
$body$
LANGUAGE 'plpgsql'
VOLATILE
CALLED ON NULL INPUT
SECURITY INVOKER
PARALLEL UNSAFE
COST 100;

ALTER FUNCTION zmaisz.sp_atualiza_usuario (schema varchar)
  OWNER TO user_dba;
