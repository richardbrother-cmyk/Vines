-- Gestión de usuarios y permisos desde la app (solo admin).

-- Lista de usuarios con correo (auth.users no es legible desde el cliente) y localidades asignadas.
create or replace function public.usuarios_listar()
returns table (id uuid, email text, nombre text, rol rol_usuario, activo boolean,
               creado_en timestamptz, ultimo_acceso timestamptz, localidades uuid[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'sin_permiso'; end if;
  return query
    select p.id, u.email::text, p.nombre, p.rol, p.activo, p.created_at, u.last_sign_in_at,
           coalesce((select array_agg(ul.localidad_id) from usuario_localidades ul where ul.usuario_id = p.id), '{}')
    from perfiles p join auth.users u on u.id = p.id
    order by p.activo, p.nombre;
end $$;

-- Cambia nombre, rol, estado y localidades de un usuario en una sola operación.
create or replace function public.usuario_actualizar(
  p_id uuid, p_nombre text, p_rol rol_usuario, p_activo boolean, p_localidades uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare antes perfiles;
begin
  if not es_admin() then raise exception 'sin_permiso'; end if;
  select * into antes from perfiles where id = p_id for update;
  if not found then raise exception 'usuario_no_existe'; end if;
  -- Nadie se quita a sí mismo el acceso de administrador (evita quedarse fuera por error).
  if p_id = auth.uid() and (p_rol <> 'admin' or not p_activo) then raise exception 'no_puedes_quitarte_admin'; end if;

  update perfiles set nombre = nullif(trim(p_nombre), ''), rol = p_rol, activo = p_activo where id = p_id;

  delete from usuario_localidades where usuario_id = p_id;
  if p_rol = 'auditor' then
    insert into usuario_localidades (usuario_id, localidad_id)
    select p_id, l.id from localidades l where l.id = any (coalesce(p_localidades, '{}'));
  end if;

  insert into bitacora (tabla, registro, accion, detalle)
  values ('perfiles', p_id::text, 'usuario_actualizado', jsonb_build_object(
    'antes', jsonb_build_object('rol', antes.rol, 'activo', antes.activo),
    'despues', jsonb_build_object('rol', p_rol, 'activo', p_activo, 'localidades', p_localidades)));
end $$;

-- Candado a nivel de tabla: siempre debe quedar al menos un administrador activo,
-- sin importar por dónde se haga el cambio.
create or replace function public.exigir_un_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from perfiles) and not exists (select 1 from perfiles where rol = 'admin' and activo) then
    raise exception 'debe_quedar_un_admin: no se puede dejar el sistema sin un administrador activo';
  end if;
  return null;
end $$;
create trigger perfiles_un_admin after update or delete on perfiles
  for each statement execute function public.exigir_un_admin();

revoke execute on function public.usuarios_listar(), public.usuario_actualizar(uuid, text, rol_usuario, boolean, uuid[]) from public, anon;
grant execute on function public.usuarios_listar(), public.usuario_actualizar(uuid, text, rol_usuario, boolean, uuid[]) to authenticated;
