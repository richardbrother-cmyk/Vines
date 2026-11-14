-- Prueba de gestión de usuarios. Requiere migraciones 0001–0006.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'jefe@x.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'nuevo@x.com');
update perfiles set activo = true, rol = 'admin' where id = '00000000-0000-0000-0000-0000000000c1';
insert into localidades (id, nombre) values ('10000000-0000-0000-0000-0000000000e1', 'Loc U1'), ('10000000-0000-0000-0000-0000000000e2', 'Loc U2');

set local role authenticated;
-- un usuario inactivo / no admin no puede listar ni editar
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);
do $$ begin
  begin perform * from usuarios_listar(); raise exception 'debio fallar';
  exception when others then assert sqlerrm = 'sin_permiso', sqlerrm; end;
  begin perform usuario_actualizar('00000000-0000-0000-0000-0000000000c2', 'Yo', 'admin', true, null); raise exception 'debio fallar';
  exception when others then assert sqlerrm = 'sin_permiso', sqlerrm; end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$ declare r record; n int; begin
  select * into r from usuarios_listar() where id = '00000000-0000-0000-0000-0000000000c2';
  assert r.email = 'nuevo@x.com' and not r.activo and r.rol = 'consulta', 'nuevo aparece inactivo con su correo';

  -- activar como auditor con una localidad
  perform usuario_actualizar('00000000-0000-0000-0000-0000000000c2', '  Ana  ', 'auditor', true,
    array['10000000-0000-0000-0000-0000000000e1']::uuid[]);
  select * into r from usuarios_listar() where id = '00000000-0000-0000-0000-0000000000c2';
  assert r.activo and r.rol = 'auditor' and r.nombre = 'Ana' and r.localidades = array['10000000-0000-0000-0000-0000000000e1']::uuid[], 'auditor activado';

  -- cambiar localidades reemplaza las anteriores; pasar a consulta las quita
  perform usuario_actualizar('00000000-0000-0000-0000-0000000000c2', 'Ana', 'auditor', true,
    array['10000000-0000-0000-0000-0000000000e2']::uuid[]);
  select count(*) into n from usuario_localidades where usuario_id = '00000000-0000-0000-0000-0000000000c2'; assert n = 1, 'reemplaza';
  perform usuario_actualizar('00000000-0000-0000-0000-0000000000c2', 'Ana', 'consulta', true,
    array['10000000-0000-0000-0000-0000000000e2']::uuid[]);
  select count(*) into n from usuario_localidades where usuario_id = '00000000-0000-0000-0000-0000000000c2'; assert n = 0, 'consulta sin localidades';

  -- no puede quitarse a sí mismo el admin ni desactivarse
  begin perform usuario_actualizar('00000000-0000-0000-0000-0000000000c1', 'Jefe', 'consulta', true, null); raise exception 'debio fallar';
  exception when others then assert sqlerrm = 'no_puedes_quitarte_admin', sqlerrm; end;
  begin perform usuario_actualizar('00000000-0000-0000-0000-0000000000c1', 'Jefe', 'admin', false, null); raise exception 'debio fallar';
  exception when others then assert sqlerrm = 'no_puedes_quitarte_admin', sqlerrm; end;

  select count(*) into n from bitacora where accion = 'usuario_actualizado'; assert n = 3, 'bitácora';
end $$;

-- candado de tabla: ni por fuera de la RPC se puede dejar el sistema sin admin activo
reset role;
do $$ begin
  begin update perfiles set activo = false where rol = 'admin'; raise exception 'debio fallar';
  exception when others then assert sqlerrm like 'debe_quedar_un_admin%', sqlerrm; end;
end $$;
rollback;
\echo 'OK: usuarios'
