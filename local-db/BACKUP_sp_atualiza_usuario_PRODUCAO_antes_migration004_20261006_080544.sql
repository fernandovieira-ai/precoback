CREATE OR REPLACE FUNCTION zmaisz.sp_atualiza_usuario(schema character varying)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE

basedados varchar(30);
host varchar(20);
usuario varchar(30);
senha varchar(30);
porta varchar(4);
conexao text;
buscavendedor text;
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

 delete from tab_usuario
 WHERE schema_base = schema;
 insert into tab_usuario
  SELECT distinct t.cod_usuario,
  t.nom_usuario,
  t.senha,
  t.schema_base ,
  t.des_rede ,
  t.img_rede,
  t.ind_aprova_negociacao  ,
  t.ind_ativo  ,
  t.empresa  
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
       case
       when a.ind_bloqueado = ''S'' 
       then ''N''
       else ''S'' end  as  ind_ativo,
       (select array_agg(aa.cod_empresa  ORDER BY aa.cod_empresa) from tab_rel_usuario_empresa aa
       where aa.cod_usuario = a.cod_usuario) as empresa
        
 from tab_usuario a
 left join tab_rel_usuario_grupo c on (c.cod_usuario = a.cod_usuario)
 left join tab_grupo_usuario d on (d.cod_grupo = c.cod_grupo)
 where a.ind_bloqueado = ''N''
 and d.cod_grupo in ( 13, 6) 
 
 order by d.des_grupo, a.nom_usuario') t 
  (cod_usuario integer,
  nom_usuario VARCHAR(50),
  senha VARCHAR(100),
  schema_base VARCHAR(20),
  des_rede VARCHAR(50),
  img_rede BYTEA,
  ind_aprova_negociacao CHAR(1),
  ind_ativo CHAR(1),
  empresa INTEGER [])
  where not exists (select 1 from tab_usuario aa
  where aa.cod_usuario = t.cod_usuario) ; 

    

   

 RETURN 0;

  

END;
$function$

