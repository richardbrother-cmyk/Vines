-- =====================================================================
-- Fase 2: ficha de unidad, dashboard, importadores de Excel
-- =====================================================================

-- Mapeo de columnas configurable (uno por tipo de carga)
create table mapeos_columnas (
  tipo            text primary key check (tipo in ('sap', 'financiera')),
  mapeo           jsonb not null,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid default auth.uid()
);
alter table mapeos_columnas enable row level security;
create policy mapeos_admin on mapeos_columnas for all to authenticated
  using (es_admin()) with check (es_admin());

-- Vista de unidad completa: ubicación, costo, financiamiento agregado y seguro vigente.
-- security_invoker: el auditor ve costo/saldo/financieras en NULL por RLS.
create or replace view v_unidades_full with (security_invoker = true) as
select
  u.vin, u.modelo, u.anio, u.tipo, u.segmento, u.lote_sap, u.division_sap,
  u.fecha_alta_inventario, u.status, u.localidad_id, l.nombre as localidad,
  u.ubicacion_actualizada_en, u.ubicacion_conteo_id,
  c.costo,
  f.financieras, f.saldo, f.plan_piso_vence,
  (f.plan_piso_vence - current_date) as dias_plan_piso,
  s.fecha_vencimiento as seguro_vence, s.origen as seguro_origen, s.semaforo as seguro_semaforo,
  (s.fecha_vencimiento - current_date) as dias_seguro
from unidades u
left join localidades l on l.id = u.localidad_id
left join unidades_costos c on c.vin = u.vin
left join lateral (
  select array_agg(distinct x.financiera order by x.financiera) as financieras,
         sum(x.saldo) as saldo, min(x.fecha_vencimiento_plan_piso) as plan_piso_vence
  from financiamientos x where x.vin = u.vin
) f on true
left join v_seguro_unidad s on s.vin = u.vin;

-- Historial de apariciones de una unidad en conteos
create or replace view v_historial_unidad with (security_invoker = true) as
select d.vin, d.conteo_id, c.fecha, c.status as status_conteo, l.nombre as localidad_conteo,
       d.resultado, d.escaneado_en, d.observaciones, d.foto_path, d.metodo
from conteo_detalle d
join conteos c on c.id = d.conteo_id
join localidades l on l.id = c.localidad_id;

-- Dashboard global (p_localidad null) o por localidad
create or replace function public.dashboard_resumen(p_localidad uuid default null) returns jsonb
language sql stable set search_path = public as $$
with base as (
  select * from v_unidades_full
  where status = 'en_inventario' and (p_localidad is null or localidad_id = p_localidad)
),
fin as (
  select coalesce(f.financiera, 'Sin registro') as financiera,
         count(distinct b.vin) as unidades, sum(f.saldo) as saldo
  from base b left join financiamientos f on f.vin = b.vin
  group by 1
)
select jsonb_build_object(
  'unidades', (select count(*) from base),
  'valor',    (select sum(costo) from base),
  'facturadas', (select count(*) from v_unidades_full
                 where status = 'facturada_en_cartera' and (p_localidad is null or localidad_id = p_localidad)),
  'por_financiera', coalesce((select jsonb_agg(to_jsonb(fin) order by unidades desc) from fin), '[]'::jsonb),
  'por_segmento', coalesce((select jsonb_agg(jsonb_build_object(
        'segmento', coalesce(segmento::text, 'sin segmento'), 'unidades', n, 'valor', v) order by n desc)
      from (select segmento, count(*) n, sum(costo) v from base group by segmento) s), '[]'::jsonb),
  'seguros', (select jsonb_build_object(
        'vencidos',   count(*) filter (where seguro_semaforo = 'vencido'),
        'por_vencer', count(*) filter (where seguro_semaforo = 'por_vencer'),
        'vigentes',   count(*) filter (where seguro_semaforo = 'vigente'),
        'sin_dato',   count(*) filter (where seguro_semaforo is null)) from base),
  'plan_piso', (select jsonb_build_object(
        'vencido', count(*) filter (where dias_plan_piso < 0),
        'd15',     count(*) filter (where dias_plan_piso between 0 and 15),
        'd30',     count(*) filter (where dias_plan_piso between 16 and 30)) from base),
  'localidades', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'nombre', l.nombre, 'unidades', x.n, 'valor', x.v, 'ultimo_conteo', uc.j)
        order by l.nombre), '[]'::jsonb)
      from localidades l
      left join lateral (select count(*) n, sum(costo) v from v_unidades_full
                         where status = 'en_inventario' and localidad_id = l.id) x on true
      left join lateral (select jsonb_build_object('id', c.id, 'fecha', c.fecha,
                           'pct', c.resumen -> 'pct_coincidencia', 'faltantes', c.resumen -> 'faltantes') j
                         from conteos c where c.localidad_id = l.id and c.status = 'cerrado'
                         order by c.cerrado_en desc limit 1) uc on true
      where l.activa and (p_localidad is null or l.id = p_localidad))
)
$$;
grant execute on function public.dashboard_resumen(uuid) to authenticated;
revoke execute on function public.dashboard_resumen(uuid) from public, anon;

-- ---------------------------------------------------------------------
-- Importadores (upsert por VIN). Solo admin. Los campos vacíos NO borran datos existentes.
-- La ubicación física de una unidad ya conocida no se pisa: la localidad (por división SAP)
-- solo se asigna a unidades nuevas o sin ubicación.
-- ---------------------------------------------------------------------
create or replace function public.importar_unidades(p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_upd int; v_ins int;
begin
  if not es_admin() then raise exception 'sin_permiso'; end if;

  drop table if exists _f;
  create temp table _f on commit drop as
    select upper(x.vin) as vin, x.modelo, x.anio, x.tipo, x.segmento, x.lote_sap, x.division_sap,
           x.costo, x.fecha_alta_inventario, x.status,
           (select l.id from localidades l where l.activa and x.division_sap = any (l.divisiones)
            order by l.nombre limit 1) as loc_id
    from jsonb_to_recordset(p_filas) as x(vin text, modelo text, anio int, tipo text, segmento text,
         lote_sap text, division_sap text, costo numeric, fecha_alta_inventario date, status text)
    where upper(x.vin) ~ '^[A-HJ-NPR-Z0-9]{17}$';

  with u as (
    update unidades t set
      modelo = coalesce(f.modelo, t.modelo), anio = coalesce(f.anio, t.anio),
      tipo = coalesce(f.tipo::tipo_unidad, t.tipo), segmento = coalesce(f.segmento::segmento_unidad, t.segmento),
      lote_sap = coalesce(f.lote_sap, t.lote_sap), division_sap = coalesce(f.division_sap, t.division_sap),
      fecha_alta_inventario = coalesce(f.fecha_alta_inventario, t.fecha_alta_inventario),
      status = coalesce(f.status::status_unidad, t.status),
      localidad_id = coalesce(t.localidad_id, f.loc_id)
    from _f f where t.vin = f.vin returning t.vin)
  select count(*) into v_upd from u;

  with i as (
    insert into unidades (vin, modelo, anio, tipo, segmento, lote_sap, division_sap,
                          fecha_alta_inventario, status, localidad_id)
    select f.vin, f.modelo, f.anio::smallint, f.tipo::tipo_unidad, f.segmento::segmento_unidad,
           f.lote_sap, f.division_sap, f.fecha_alta_inventario,
           coalesce(f.status::status_unidad, 'en_inventario'), f.loc_id
    from _f f where not exists (select 1 from unidades t where t.vin = f.vin)
    returning vin)
  select count(*) into v_ins from i;

  insert into unidades_costos (vin, costo) select vin, costo from _f where costo is not null
  on conflict (vin) do update set costo = excluded.costo;

  return jsonb_build_object('insertadas', v_ins, 'actualizadas', v_upd);
end $$;

create or replace function public.importar_financiamientos(p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ins int; v_upd int; v_omit jsonb;
begin
  if not es_admin() then raise exception 'sin_permiso'; end if;

  drop table if exists _g;
  create temp table _g on commit drop as
    select upper(x.vin) as vin, x.financiera, coalesce(x.disposicion, 1) as disposicion, x.concepto,
           x.saldo, x.fecha_entrada_plan_piso, x.fecha_vencimiento_plan_piso
    from jsonb_to_recordset(p_filas) as x(vin text, financiera text, disposicion int, concepto text,
         saldo numeric, fecha_entrada_plan_piso date, fecha_vencimiento_plan_piso date)
    where upper(x.vin) ~ '^[A-HJ-NPR-Z0-9]{17}$';

  select coalesce(jsonb_agg(vin), '[]'::jsonb) into v_omit
    from (select vin from _g g where not exists (select 1 from unidades u where u.vin = g.vin) limit 200) q;

  with r as (
    insert into financiamientos (vin, financiera, disposicion, concepto, saldo,
                                 fecha_entrada_plan_piso, fecha_vencimiento_plan_piso)
    select g.vin, g.financiera, g.disposicion, g.concepto, g.saldo,
           g.fecha_entrada_plan_piso, g.fecha_vencimiento_plan_piso
    from _g g where exists (select 1 from unidades u where u.vin = g.vin)
    on conflict (vin, disposicion) do update set
      financiera = excluded.financiera,
      concepto = coalesce(excluded.concepto, financiamientos.concepto),
      saldo = coalesce(excluded.saldo, financiamientos.saldo),
      fecha_entrada_plan_piso = coalesce(excluded.fecha_entrada_plan_piso, financiamientos.fecha_entrada_plan_piso),
      fecha_vencimiento_plan_piso = coalesce(excluded.fecha_vencimiento_plan_piso, financiamientos.fecha_vencimiento_plan_piso)
    returning (xmax = 0) as nueva)
  select count(*) filter (where nueva), count(*) filter (where not nueva) into v_ins, v_upd from r;

  return jsonb_build_object('insertadas', v_ins, 'actualizadas', v_upd, 'omitidas_sin_unidad', v_omit);
end $$;

revoke execute on function public.importar_unidades(jsonb), public.importar_financiamientos(jsonb) from public, anon;
grant execute on function public.importar_unidades(jsonb), public.importar_financiamientos(jsonb) to authenticated;
