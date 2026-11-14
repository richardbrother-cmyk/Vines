-- Correcciones de la revisión previa al despliegue.

-- 1) Carrera cierre vs. escaneo: sin bloqueo, un escaneo simultáneo al cierre podía insertarse
--    después de congelar faltantes/resumen. FOR SHARE espera al cierre y entonces ve 'cerrado'.
create or replace function public.detalle_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare c conteos; u unidades;
begin
  select * into c from conteos where id = new.conteo_id for share;
  if not found or c.status <> 'abierto' then raise exception 'conteo_cerrado'; end if;
  select * into u from unidades where vin = new.vin;
  if not found then
    new.resultado := 'sobrante';
    new.localidad_esperada_id := null;
  else
    new.localidad_esperada_id := u.localidad_id;
    new.resultado := case
      when u.status = 'facturada_en_cartera' then 'facturada_en_patio'
      when u.status = 'vendida'              then 'vendida_en_patio'
      when u.localidad_id = c.localidad_id   then 'esperada'
      else 'otra_localidad' end;
  end if;
  return new;
end $$;

-- 2) Catálogo en orden estable para poder paginarlo (PostgREST corta en 1000 filas por petición).
create or replace function public.conteo_catalogo(p_conteo uuid)
returns table (vin text, modelo text, anio smallint, segmento segmento_unidad,
               status status_unidad, localidad_id uuid, localidad_nombre text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from conteos c where c.id = p_conteo and puede_ver_localidad(c.localidad_id)) then
    raise exception 'sin_permiso';
  end if;
  return query
    select u.vin, u.modelo, u.anio, u.segmento, u.status, u.localidad_id, l.nombre
    from unidades u left join localidades l on l.id = u.localidad_id
    order by u.vin;
end $$;

-- 3) Fotos: la política anterior convertía la carpeta a uuid sin validar (error si el nombre no es
--    un uuid) y dejaba subir a cualquier ruta. Ahora: leer solo fotos de conteos visibles; subir
--    solo a conteos ABIERTOS de una localidad que el usuario puede operar.
create or replace function public.conteo_de_foto(p_nombre text) returns uuid
language sql immutable as $$
  select case when split_part(p_nombre, '/', 1) ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
              then split_part(p_nombre, '/', 1)::uuid end
$$;

create or replace function public.puede_subir_foto(p_nombre text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conteos c
                 where c.id = conteo_de_foto(p_nombre) and c.status = 'abierto'
                   and puede_operar_localidad(c.localidad_id))
$$;

drop policy if exists fotos_insert on storage.objects;
drop policy if exists fotos_select on storage.objects;
create policy fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'conteo-fotos' and puede_subir_foto(name));
create policy fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'conteo-fotos' and puede_ver_conteo(conteo_de_foto(name)));

-- 4) Lo mismo al editar/quitar: esperar a un cierre en curso antes de decidir.
create or replace function public.detalle_inmutable() returns trigger
language plpgsql security definer set search_path = public as $$
declare st status_conteo;
begin
  select status into st from conteos where id = old.conteo_id for share;
  if st = 'cerrado' then raise exception 'conteo_cerrado: una sesión cerrada no se edita'; end if;
  if tg_op = 'UPDATE' and (
       new.conteo_id is distinct from old.conteo_id or new.vin is distinct from old.vin
    or new.resultado is distinct from old.resultado or new.escaneado_en is distinct from old.escaneado_en
    or new.client_id is distinct from old.client_id) then
    raise exception 'Solo se pueden editar foto y observaciones';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;

-- 5) Usuarios nuevos nacen INACTIVOS (no ven nada) hasta que un admin los active.
--    Solo el primer usuario del proyecto queda activo y como admin.
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
declare primero boolean := not exists (select 1 from perfiles);
begin
  insert into perfiles (id, nombre, rol, activo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    case when primero then 'admin'::rol_usuario else 'consulta'::rol_usuario end,
    primero
  );
  return new;
end $$;

-- 6) Fechas en hora de Guadalajara (el servidor corre en UTC: después de las 18:00 ya era "mañana").
create or replace function public.hoy() returns date
language sql stable as $$ select (now() at time zone 'America/Mexico_City')::date $$;
alter table conteos alter column fecha set default (now() at time zone 'America/Mexico_City')::date;

-- 7) Seguro: gana el acuse manual MÁS RECIENTE REGISTRADO (antes, uno sin fecha de alta perdía
--    contra uno viejo). La regla de 355 días se calcula igual para todos los roles.
alter table seguros alter column created_by set default auth.uid();

create or replace function public.fecha_regla_seguro(p_vin text) returns date
language sql stable security definer set search_path = public as $$
  select coalesce(u.fecha_alta_inventario,
                  (select min(f.fecha_entrada_plan_piso) from financiamientos f where f.vin = u.vin)) + 355
  from unidades u where u.vin = p_vin
$$;
revoke execute on function public.fecha_regla_seguro(text) from public, anon;
grant execute on function public.fecha_regla_seguro(text) to authenticated;

create or replace view v_seguro_unidad with (security_invoker = true) as
select
  u.vin,
  coalesce(m.fecha_vencimiento, r.fecha_regla) as fecha_vencimiento,
  case when m.vin is not null then 'manual'::origen_seguro else 'regla'::origen_seguro end as origen,
  case
    when coalesce(m.fecha_vencimiento, r.fecha_regla) is null then null
    when coalesce(m.fecha_vencimiento, r.fecha_regla) < hoy() then 'vencido'
    when coalesce(m.fecha_vencimiento, r.fecha_regla) <= hoy() + 30 then 'por_vencer'
    else 'vigente' end as semaforo
from unidades u
left join lateral (
  select s.vin, s.fecha_vencimiento from seguros s
  where s.vin = u.vin and s.origen = 'manual'
  order by s.created_at desc limit 1
) m on true
left join lateral (select fecha_regla_seguro(u.vin) as fecha_regla) r on true;

create or replace view v_unidades_full with (security_invoker = true) as
select
  u.vin, u.modelo, u.anio, u.tipo, u.segmento, u.lote_sap, u.division_sap,
  u.fecha_alta_inventario, u.status, u.localidad_id, l.nombre as localidad,
  u.ubicacion_actualizada_en, u.ubicacion_conteo_id,
  c.costo,
  f.financieras, f.saldo, f.plan_piso_vence,
  (f.plan_piso_vence - hoy()) as dias_plan_piso,
  s.fecha_vencimiento as seguro_vence, s.origen as seguro_origen, s.semaforo as seguro_semaforo,
  (s.fecha_vencimiento - hoy()) as dias_seguro
from unidades u
left join localidades l on l.id = u.localidad_id
left join unidades_costos c on c.vin = u.vin
left join lateral (
  select array_agg(distinct x.financiera order by x.financiera) as financieras,
         sum(x.saldo) as saldo, min(x.fecha_vencimiento_plan_piso) as plan_piso_vence
  from financiamientos x where x.vin = u.vin
) f on true
left join v_seguro_unidad s on s.vin = u.vin;

-- 8) marcar_ausentes con candados: no acepta archivo vacío y aborta si la cantidad a marcar
--    no es la que el usuario vio en pantalla.
drop function if exists public.marcar_ausentes(jsonb, status_unidad, text[]);
create or replace function public.marcar_ausentes(
  p_vins jsonb, p_status status_unidad, p_divisiones text[], p_esperadas integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare n int; muestra jsonb;
begin
  if not es_admin() then raise exception 'sin_permiso'; end if;
  if p_status not in ('facturada_en_cartera', 'vendida') then raise exception 'status_no_permitido'; end if;
  if coalesce(jsonb_array_length(p_vins), 0) = 0 then raise exception 'archivo_vacio'; end if;

  drop table if exists _aus;
  create temp table _aus on commit drop as
    with f as (select distinct upper(x) as vin from jsonb_array_elements_text(p_vins) x)
    select u.vin from unidades u left join f on f.vin = u.vin
    where f.vin is null and u.status = 'en_inventario'
      and (p_divisiones is null or u.division_sap = any (p_divisiones));

  select count(*) into n from _aus;
  if n <> p_esperadas then
    raise exception 'cantidad_distinta: se esperaban % y hay %; vuelve a revisar la lista', p_esperadas, n;
  end if;
  select coalesce(jsonb_agg(vin), '[]'::jsonb) into muestra from (select vin from _aus order by vin limit 200) q;
  update unidades set status = p_status where vin in (select vin from _aus);

  insert into bitacora (tabla, registro, accion, detalle)
  values ('unidades', null, 'marcar_ausentes_sap',
          jsonb_build_object('status', p_status, 'divisiones', p_divisiones, 'cantidad', n, 'muestra_vins', muestra));
  return n;
end $$;
revoke execute on function public.marcar_ausentes(jsonb, status_unidad, text[], integer) from public, anon;
grant execute on function public.marcar_ausentes(jsonb, status_unidad, text[], integer) to authenticated;
