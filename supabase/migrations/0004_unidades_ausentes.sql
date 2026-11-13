-- Unidades que siguen "en_inventario" en la base pero ya no vienen en un archivo SAP.
-- p_vins: VINs del archivo. p_divisiones: limita el alcance a esas divisiones (null = todo el inventario).
create or replace function public.unidades_ausentes(p_vins jsonb, p_divisiones text[] default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not es_admin() then raise exception 'sin_permiso'; end if;
  with f as (select distinct upper(x) as vin from jsonb_array_elements_text(p_vins) x),
  alcance as (
    select u.*, f.vin is null as ausente from unidades u left join f on f.vin = u.vin
    where u.status = 'en_inventario' and (p_divisiones is null or u.division_sap = any (p_divisiones))
  )
  select jsonb_build_object(
    'en_alcance', (select count(*) from alcance),
    'ausentes_total', (select count(*) from alcance where ausente),
    'ausentes', coalesce((select jsonb_agg(jsonb_build_object(
        'vin', a.vin, 'modelo', a.modelo, 'anio', a.anio, 'segmento', a.segmento,
        'division_sap', a.division_sap, 'localidad', l.nombre) order by a.modelo, a.vin)
      from (select * from alcance where ausente order by modelo, vin limit 300) a
      left join localidades l on l.id = a.localidad_id), '[]'::jsonb))
  into v;
  return v;
end $$;

-- Cambia el status de esas unidades ausentes (mismo alcance). Queda en bitácora.
create or replace function public.marcar_ausentes(p_vins jsonb, p_status status_unidad, p_divisiones text[] default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n int; muestra jsonb;
begin
  if not es_admin() then raise exception 'sin_permiso'; end if;
  if p_status not in ('facturada_en_cartera', 'vendida') then raise exception 'status_no_permitido'; end if;

  drop table if exists _aus;
  create temp table _aus on commit drop as
    with f as (select distinct upper(x) as vin from jsonb_array_elements_text(p_vins) x)
    select u.vin from unidades u left join f on f.vin = u.vin
    where f.vin is null and u.status = 'en_inventario'
      and (p_divisiones is null or u.division_sap = any (p_divisiones));

  select count(*), coalesce(jsonb_agg(vin) filter (where true), '[]') into n, muestra
    from (select vin from _aus order by vin limit 200) q;
  update unidades set status = p_status where vin in (select vin from _aus);
  get diagnostics n = row_count;

  insert into bitacora (tabla, registro, accion, detalle)
  values ('unidades', null, 'marcar_ausentes_sap',
          jsonb_build_object('status', p_status, 'divisiones', p_divisiones, 'cantidad', n, 'muestra_vins', muestra));
  return n;
end $$;

revoke execute on function public.unidades_ausentes(jsonb, text[]), public.marcar_ausentes(jsonb, status_unidad, text[]) from public, anon;
grant execute on function public.unidades_ausentes(jsonb, text[]), public.marcar_ausentes(jsonb, status_unidad, text[]) to authenticated;
