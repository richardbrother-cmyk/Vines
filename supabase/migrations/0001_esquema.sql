-- =====================================================================
-- Inventario físico de vehículos por localidad — Esquema base
-- Supabase (Postgres 15+). Ejecutar con `supabase db push` o en el SQL Editor.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type rol_usuario     as enum ('admin', 'auditor', 'consulta');
create type tipo_unidad     as enum ('nueva', 'usada');
create type segmento_unidad as enum ('tracto', 'carga', 'pasaje', 'seminuevos', 'semirremolques');
create type status_unidad   as enum ('en_inventario', 'facturada_en_cartera', 'vendida');
create type origen_seguro   as enum ('regla', 'manual');
create type status_conteo   as enum ('abierto', 'cerrado');
create type resultado_scan  as enum (
  'esperada',            -- unidad en inventario cuya ubicación es esta localidad
  'otra_localidad',      -- unidad en inventario ubicada (o sin ubicación) en otra localidad
  'sobrante',            -- VIN que no existe en la base
  'facturada_en_patio',  -- facturada en cartera pero aún físicamente aquí
  'vendida_en_patio'     -- ya dada de salida pero encontrada
);

-- ---------------------------------------------------------------------
-- Perfiles / roles
-- ---------------------------------------------------------------------
create table perfiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nombre     text,
  rol        rol_usuario not null default 'consulta',
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create table localidades (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  divisiones text[] not null default '{}',
  direccion  text,
  activa     boolean not null default true
);

-- Qué localidades puede contar cada auditor (admin y consulta ven todas)
create table usuario_localidades (
  usuario_id   uuid not null references perfiles (id) on delete cascade,
  localidad_id uuid not null references localidades (id) on delete cascade,
  primary key (usuario_id, localidad_id)
);

-- Primer usuario que se registra queda como admin; el resto como consulta.
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    case when exists (select 1 from perfiles) then 'consulta'::rol_usuario else 'admin'::rol_usuario end
  );
  return new;
end $$;

create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

-- ---------------------------------------------------------------------
-- Funciones de autorización
-- ---------------------------------------------------------------------
create or replace function public.mi_rol() returns rol_usuario
language sql stable security definer set search_path = public as
$$ select rol from perfiles where id = auth.uid() and activo $$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(mi_rol() = 'admin', false) $$;

-- Ver: admin y consulta ven todo; auditor solo sus localidades.
create or replace function public.puede_ver_localidad(p_localidad uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case mi_rol()
    when 'admin' then true
    when 'consulta' then true
    when 'auditor' then exists (
      select 1 from usuario_localidades
      where usuario_id = auth.uid() and localidad_id = p_localidad)
    else false end
$$;

-- Operar (abrir/escanear/cerrar conteos): admin, o auditor asignado.
create or replace function public.puede_operar_localidad(p_localidad uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case mi_rol()
    when 'admin' then true
    when 'auditor' then exists (
      select 1 from usuario_localidades
      where usuario_id = auth.uid() and localidad_id = p_localidad)
    else false end
$$;

-- ---------------------------------------------------------------------
-- Unidades y financiamiento
-- ---------------------------------------------------------------------
create table unidades (
  vin                     text primary key check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  modelo                  text,
  anio                    smallint,
  tipo                    tipo_unidad,
  segmento                segmento_unidad,
  lote_sap                text,
  division_sap            text,
  fecha_alta_inventario   date,
  status                  status_unidad not null default 'en_inventario',
  -- Última ubicación conocida (la actualiza el cierre de conteo o la carga)
  localidad_id            uuid references localidades (id),
  ubicacion_actualizada_en timestamptz,
  ubicacion_conteo_id     uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index on unidades (localidad_id, status);
create index on unidades (vin text_pattern_ops);

-- El costo vive aparte para poder ocultarlo al rol auditor con RLS.
create table unidades_costos (
  vin   text primary key references unidades (vin) on delete cascade,
  costo numeric(14, 2)
);

create or replace function public.tocar_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger unidades_updated before update on unidades
  for each row execute function public.tocar_updated_at();

create table financiamientos (
  id                          uuid primary key default gen_random_uuid(),
  vin                         text not null references unidades (vin) on delete cascade,
  financiera                  text not null check (financiera in
    ('BBVA IPP', 'DAIMLER MP315', 'DAIMLER MP340', 'SANTANDER', 'NO FINANCIADA')),
  disposicion                 smallint not null default 1 check (disposicion in (1, 2)),
  concepto                    text,              -- p. ej. 'chasis' / 'carrocería'
  saldo                       numeric(14, 2),
  fecha_entrada_plan_piso     date,
  fecha_vencimiento_plan_piso date,
  unique (vin, disposicion)
);

create table seguros (
  id                uuid primary key default gen_random_uuid(),
  vin               text not null references unidades (vin) on delete cascade,
  fecha_alta_seguro date,
  fecha_vencimiento date not null,
  origen            origen_seguro not null default 'manual',
  notas             text,
  created_by        uuid references perfiles (id),
  created_at        timestamptz not null default now()
);
create index on seguros (vin);

-- Vigencia efectiva: el registro manual más reciente siempre gana; si no hay,
-- aplica la regla (alta en inventario, o entrada a plan piso, + 355 días).
create or replace view v_seguro_unidad with (security_invoker = true) as
select
  u.vin,
  coalesce(m.fecha_vencimiento, r.fecha_regla) as fecha_vencimiento,
  case when m.vin is not null then 'manual'::origen_seguro else 'regla'::origen_seguro end as origen,
  case
    when coalesce(m.fecha_vencimiento, r.fecha_regla) is null then null
    when coalesce(m.fecha_vencimiento, r.fecha_regla) < current_date then 'vencido'
    when coalesce(m.fecha_vencimiento, r.fecha_regla) <= current_date + 30 then 'por_vencer'
    else 'vigente' end as semaforo
from unidades u
left join lateral (
  select s.vin, s.fecha_vencimiento from seguros s
  where s.vin = u.vin and s.origen = 'manual'
  order by s.fecha_alta_seguro desc nulls last, s.created_at desc limit 1
) m on true
left join lateral (
  select (coalesce(u.fecha_alta_inventario,
                   (select min(f.fecha_entrada_plan_piso) from financiamientos f where f.vin = u.vin))
          + 355) as fecha_regla
) r on true;

-- ---------------------------------------------------------------------
-- Conteos físicos
-- ---------------------------------------------------------------------
create table conteos (
  id                 uuid primary key default gen_random_uuid(),
  localidad_id       uuid not null references localidades (id),
  fecha              date not null default current_date,
  usuario_id         uuid not null references perfiles (id),
  status             status_conteo not null default 'abierto',
  creado_en          timestamptz not null default now(),
  cerrado_en         timestamptz,
  cerrado_por        uuid references perfiles (id),
  actualizo_ubicacion boolean not null default false,
  resumen            jsonb
);
-- Una sola sesión abierta por localidad: varios auditores pueden sumarse a ella.
create unique index conteos_una_abierta_por_localidad
  on conteos (localidad_id) where status = 'abierto';

create table conteo_detalle (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null unique,      -- idempotencia de la cola offline
  conteo_id            uuid not null references conteos (id),
  vin                  text not null check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  escaneado_en         timestamptz not null default now(),
  usuario_id           uuid references perfiles (id),
  resultado            resultado_scan not null,
  localidad_esperada_id uuid references localidades (id),  -- ubicación según la base al momento del escaneo
  metodo               text not null default 'manual' check (metodo in ('camara', 'manual')),
  foto_path            text,
  observaciones        text,
  unique (conteo_id, vin)
);
create index on conteo_detalle (conteo_id);
create index on conteo_detalle (vin);

-- Foto instantánea de los faltantes al cerrar (no cambia aunque luego se muevan unidades)
create table conteo_faltantes (
  conteo_id uuid not null references conteos (id),
  vin       text not null,
  modelo    text,
  anio      smallint,
  segmento  segmento_unidad,
  primary key (conteo_id, vin)
);

create table conteo_notas (
  id         uuid primary key default gen_random_uuid(),
  conteo_id  uuid not null references conteos (id),
  usuario_id uuid not null references perfiles (id) default auth.uid(),
  nota       text not null check (length(trim(nota)) > 0),
  creado_en  timestamptz not null default now()
);

create table bitacora (
  id         bigint generated always as identity primary key,
  tabla      text not null,
  registro   text,
  accion     text not null,
  usuario_id uuid default auth.uid(),
  detalle    jsonb,
  creado_en  timestamptz not null default now()
);

-- Bitácora de cargas de Excel (fase 2)
create table cargas (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null,            -- 'sap' | 'financiera'
  archivo     text,
  usuario_id  uuid default auth.uid(),
  filas_total integer,
  insertadas  integer,
  actualizadas integer,
  errores     jsonb,
  creado_en   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Inmutabilidad del historial
-- ---------------------------------------------------------------------
create or replace function public.conteos_inmutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Los conteos no se pueden eliminar'; end if;
  if old.status = 'cerrado' then raise exception 'conteo_cerrado: una sesión cerrada no se edita'; end if;
  return new;
end $$;
create trigger conteos_inmutable before update or delete on conteos
  for each row execute function public.conteos_inmutable();

-- Detalle: se calcula el resultado al insertar; después solo se pueden tocar
-- foto/observaciones, y solo mientras la sesión esté abierta.
create or replace function public.detalle_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare c conteos; u unidades;
begin
  select * into c from conteos where id = new.conteo_id;
  if c.status <> 'abierto' then raise exception 'conteo_cerrado'; end if;
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
create trigger detalle_before_insert before insert on conteo_detalle
  for each row execute function public.detalle_before_insert();

create or replace function public.detalle_inmutable() returns trigger
language plpgsql security definer set search_path = public as $$
declare st status_conteo;
begin
  select status into st from conteos where id = old.conteo_id;
  if st = 'cerrado' then raise exception 'conteo_cerrado: una sesión cerrada no se edita'; end if;
  if tg_op = 'UPDATE' and (
       new.conteo_id is distinct from old.conteo_id or new.vin is distinct from old.vin
    or new.resultado is distinct from old.resultado or new.escaneado_en is distinct from old.escaneado_en
    or new.client_id is distinct from old.client_id) then
    raise exception 'Solo se pueden editar foto y observaciones';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;
create trigger detalle_inmutable before update or delete on conteo_detalle
  for each row execute function public.detalle_inmutable();

create or replace function public.siempre_inmutable() returns trigger
language plpgsql as $$ begin raise exception 'Registro inmutable'; end $$;
create trigger faltantes_inmutable before update or delete on conteo_faltantes
  for each row execute function public.siempre_inmutable();
create trigger notas_inmutable before update or delete on conteo_notas
  for each row execute function public.siempre_inmutable();

-- Cada nota de admin queda en bitácora
create or replace function public.nota_a_bitacora() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into bitacora (tabla, registro, accion, usuario_id, detalle)
  values ('conteo_notas', new.conteo_id::text, 'nota_admin', new.usuario_id, to_jsonb(new));
  return new;
end $$;
create trigger nota_bitacora after insert on conteo_notas
  for each row execute function public.nota_a_bitacora();

-- ---------------------------------------------------------------------
-- Vistas de apoyo
-- ---------------------------------------------------------------------
create or replace view v_conteo_detalle with (security_invoker = true) as
select d.id, d.client_id, d.conteo_id, d.vin, d.escaneado_en, d.resultado, d.metodo,
       d.foto_path, d.observaciones, d.usuario_id,
       u.modelo, u.anio, u.segmento, u.status as status_unidad,
       le.nombre as localidad_esperada
from conteo_detalle d
left join unidades u on u.vin = d.vin
left join localidades le on le.id = d.localidad_esperada_id;

-- ---------------------------------------------------------------------
-- RPC del flujo de conteo (security definer; todas validan permisos)
-- ---------------------------------------------------------------------

-- Abre una sesión en la localidad, o devuelve la que ya está abierta.
create or replace function public.abrir_conteo(p_localidad uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not puede_operar_localidad(p_localidad) then raise exception 'sin_permiso'; end if;
  select id into v_id from conteos where localidad_id = p_localidad and status = 'abierto';
  if v_id is null then
    insert into conteos (localidad_id, usuario_id) values (p_localidad, auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Catálogo para validar en el teléfono sin red (todas las unidades no vendidas
-- más las vendidas, para poder avisar "ya tuvo salida").
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
    from unidades u left join localidades l on l.id = u.localidad_id;
end $$;

-- Registro por lotes, idempotente por client_id.
create or replace function public.registrar_scans(p_conteo uuid, p_scans jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c conteos; el jsonb; v_vin text; v_cid uuid; r conteo_detalle; v_out jsonb := '[]'::jsonb;
begin
  select * into c from conteos where id = p_conteo;
  if not found or not puede_operar_localidad(c.localidad_id) then raise exception 'sin_permiso'; end if;
  if c.status <> 'abierto' then raise exception 'conteo_cerrado'; end if;

  for el in select * from jsonb_array_elements(p_scans) loop
    v_vin := upper(el ->> 'vin');
    v_cid := (el ->> 'client_id')::uuid;
    if v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then
      v_out := v_out || jsonb_build_object('client_id', v_cid, 'vin', v_vin, 'error', 'vin_invalido');
      continue;
    end if;
    insert into conteo_detalle (client_id, conteo_id, vin, escaneado_en, usuario_id, metodo, observaciones)
    values (v_cid, p_conteo, v_vin,
            coalesce((el ->> 'escaneado_en')::timestamptz, now()), auth.uid(),
            coalesce(el ->> 'metodo', 'manual'), nullif(el ->> 'observaciones', ''))
    on conflict do nothing;
    select * into r from conteo_detalle where conteo_id = p_conteo and vin = v_vin;
    v_out := v_out || jsonb_build_object(
      'client_id', v_cid, 'vin', v_vin, 'resultado', r.resultado,
      'duplicado', r.client_id <> v_cid, 'server_client_id', r.client_id);
  end loop;
  return v_out;
end $$;

-- Foto / observaciones de un escaneo (solo con la sesión abierta)
create or replace function public.actualizar_scan(
  p_conteo uuid, p_client_id uuid, p_foto_path text, p_observaciones text) returns void
language plpgsql security definer set search_path = public as $$
declare c conteos;
begin
  select * into c from conteos where id = p_conteo;
  if not found or not puede_operar_localidad(c.localidad_id) then raise exception 'sin_permiso'; end if;
  update conteo_detalle
     set foto_path = coalesce(p_foto_path, foto_path),
         observaciones = coalesce(p_observaciones, observaciones)
   where conteo_id = p_conteo and client_id = p_client_id;
end $$;

create or replace function public.quitar_scan(p_conteo uuid, p_client_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c conteos;
begin
  select * into c from conteos where id = p_conteo;
  if not found or not puede_operar_localidad(c.localidad_id) then raise exception 'sin_permiso'; end if;
  delete from conteo_detalle where conteo_id = p_conteo and client_id = p_client_id;
end $$;

-- Faltantes calculados en vivo (vista previa mientras la sesión está abierta)
create or replace function public.conteo_faltantes_calc(p_conteo uuid)
returns table (vin text, modelo text, anio smallint, segmento segmento_unidad)
language plpgsql stable security definer set search_path = public as $$
declare c conteos;
begin
  select * into c from conteos where id = p_conteo;
  if not found or not puede_ver_localidad(c.localidad_id) then raise exception 'sin_permiso'; end if;
  return query
    select u.vin, u.modelo, u.anio, u.segmento from unidades u
    where u.localidad_id = c.localidad_id and u.status = 'en_inventario'
      and not exists (select 1 from conteo_detalle d where d.conteo_id = p_conteo and d.vin = u.vin)
    order by u.modelo, u.vin;
end $$;

create or replace function public.cerrar_conteo(p_conteo uuid, p_actualizar_ubicacion boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c conteos; v_resumen jsonb; v_esp int; v_enc int; v_falt int; v_total int;
begin
  select * into c from conteos where id = p_conteo for update;
  if not found or not puede_operar_localidad(c.localidad_id) then raise exception 'sin_permiso'; end if;
  if c.status <> 'abierto' then raise exception 'conteo_cerrado'; end if;

  insert into conteo_faltantes (conteo_id, vin, modelo, anio, segmento)
    select p_conteo, f.vin, f.modelo, f.anio, f.segmento from conteo_faltantes_calc(p_conteo) f;

  select count(*) into v_esp from unidades u
    where u.localidad_id = c.localidad_id and u.status = 'en_inventario';
  select count(*) into v_enc from conteo_detalle where conteo_id = p_conteo and resultado = 'esperada';
  select count(*) into v_falt from conteo_faltantes where conteo_id = p_conteo;
  select count(*) into v_total from conteo_detalle where conteo_id = p_conteo;

  v_resumen := jsonb_build_object(
    'esperadas_total', v_esp,
    'esperadas_encontradas', v_enc,
    'faltantes', v_falt,
    'total_escaneadas', v_total,
    'sobrantes',          (select count(*) from conteo_detalle where conteo_id = p_conteo and resultado = 'sobrante'),
    'otra_localidad',     (select count(*) from conteo_detalle where conteo_id = p_conteo and resultado = 'otra_localidad'),
    'facturadas_en_patio',(select count(*) from conteo_detalle where conteo_id = p_conteo and resultado = 'facturada_en_patio'),
    'vendidas_en_patio',  (select count(*) from conteo_detalle where conteo_id = p_conteo and resultado = 'vendida_en_patio'),
    'pct_coincidencia',   case when v_esp = 0 then null else round(100.0 * v_enc / v_esp, 1) end
  );

  if p_actualizar_ubicacion then
    update unidades set localidad_id = c.localidad_id, ubicacion_actualizada_en = now(),
                        ubicacion_conteo_id = p_conteo
     where vin in (select vin from conteo_detalle
                   where conteo_id = p_conteo
                     and resultado in ('esperada', 'otra_localidad', 'facturada_en_patio'));
  end if;

  update conteos set status = 'cerrado', cerrado_en = now(), cerrado_por = auth.uid(),
                     actualizo_ubicacion = p_actualizar_ubicacion, resumen = v_resumen
   where id = p_conteo;
  return v_resumen;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table perfiles            enable row level security;
alter table localidades         enable row level security;
alter table usuario_localidades enable row level security;
alter table unidades            enable row level security;
alter table unidades_costos     enable row level security;
alter table financiamientos     enable row level security;
alter table seguros             enable row level security;
alter table conteos             enable row level security;
alter table conteo_detalle      enable row level security;
alter table conteo_faltantes    enable row level security;
alter table conteo_notas        enable row level security;
alter table bitacora            enable row level security;
alter table cargas              enable row level security;

create or replace function public.puede_ver_conteo(p_conteo uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from conteos c where c.id = p_conteo and puede_ver_localidad(c.localidad_id)) $$;

-- perfiles
create policy perfiles_select on perfiles for select to authenticated
  using (id = auth.uid() or es_admin() or mi_rol() = 'consulta');
create policy perfiles_admin  on perfiles for all to authenticated
  using (es_admin()) with check (es_admin());

-- catálogos
create policy localidades_select on localidades for select to authenticated using (true);
create policy localidades_admin  on localidades for all to authenticated
  using (es_admin()) with check (es_admin());

create policy ul_select on usuario_localidades for select to authenticated
  using (usuario_id = auth.uid() or es_admin());
create policy ul_admin  on usuario_localidades for all to authenticated
  using (es_admin()) with check (es_admin());

-- unidades: todos los roles leen; solo admin escribe (las cargas usan service role)
create policy unidades_select on unidades for select to authenticated using (mi_rol() is not null);
create policy unidades_admin  on unidades for all to authenticated
  using (es_admin()) with check (es_admin());

-- costo y financiamiento: el auditor NO los ve
create policy costos_select on unidades_costos for select to authenticated
  using (mi_rol() in ('admin', 'consulta'));
create policy costos_admin  on unidades_costos for all to authenticated
  using (es_admin()) with check (es_admin());
create policy fin_select on financiamientos for select to authenticated
  using (mi_rol() in ('admin', 'consulta'));
create policy fin_admin  on financiamientos for all to authenticated
  using (es_admin()) with check (es_admin());

-- seguros: lectura para todos; alta manual solo admin
create policy seguros_select on seguros for select to authenticated using (mi_rol() is not null);
create policy seguros_admin  on seguros for all to authenticated
  using (es_admin()) with check (es_admin());

-- conteos: solo lectura directa; toda escritura pasa por las RPC
create policy conteos_select on conteos for select to authenticated
  using (puede_ver_localidad(localidad_id));
create policy detalle_select on conteo_detalle for select to authenticated
  using (puede_ver_conteo(conteo_id));
create policy faltantes_select on conteo_faltantes for select to authenticated
  using (puede_ver_conteo(conteo_id));
create policy notas_select on conteo_notas for select to authenticated
  using (puede_ver_conteo(conteo_id));
create policy notas_insert on conteo_notas for insert to authenticated
  with check (es_admin() and usuario_id = auth.uid());

create policy bitacora_select on bitacora for select to authenticated using (es_admin());
create policy cargas_admin on cargas for all to authenticated
  using (es_admin()) with check (es_admin());

-- Endurecer: sin escritura directa del cliente en tablas del conteo
revoke insert, update, delete on conteos, conteo_detalle, conteo_faltantes from authenticated, anon;
revoke all on bitacora from authenticated, anon;
grant select on bitacora to authenticated;

-- Las RPC no deben ser invocables sin sesión
revoke execute on function public.abrir_conteo(uuid), public.conteo_catalogo(uuid),
  public.registrar_scans(uuid, jsonb), public.actualizar_scan(uuid, uuid, text, text),
  public.quitar_scan(uuid, uuid), public.conteo_faltantes_calc(uuid),
  public.cerrar_conteo(uuid, boolean) from public, anon;
grant execute on function public.abrir_conteo(uuid), public.conteo_catalogo(uuid),
  public.registrar_scans(uuid, jsonb), public.actualizar_scan(uuid, uuid, text, text),
  public.quitar_scan(uuid, uuid), public.conteo_faltantes_calc(uuid),
  public.cerrar_conteo(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Storage: fotos de conteo (privado, ruta: <conteo_id>/<client_id>.jpg)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('conteo-fotos', 'conteo-fotos', false)
on conflict (id) do nothing;

create policy fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'conteo-fotos' and mi_rol() in ('admin', 'auditor'));
create policy fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'conteo-fotos'
         and puede_ver_conteo(((storage.foldername(name))[1])::uuid));
