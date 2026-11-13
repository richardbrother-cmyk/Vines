-- Prueba de fase 2: importadores, vistas y dashboard. Requiere 0001 + 0002 aplicadas.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'admin2@x.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'aud2@x.com');
update perfiles set rol = 'admin'   where id = '00000000-0000-0000-0000-0000000000b1';
update perfiles set rol = 'auditor' where id = '00000000-0000-0000-0000-0000000000b2';
insert into localidades (id, nombre, divisiones) values
  ('10000000-0000-0000-0000-0000000000f1', 'Loc F1', '{9001}'),
  ('10000000-0000-0000-0000-0000000000f2', 'Loc F2', '{9002}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$ begin
  begin perform importar_unidades('[]'); raise exception 'debio fallar';
  exception when others then assert sqlerrm = 'sin_permiso', sqlerrm; end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$ declare r jsonb; n int; l uuid; st text; cst numeric; begin
  r := importar_unidades('[
    {"vin":"3alacwfc0mdmz0001","modelo":"M2","anio":2024,"tipo":"nueva","segmento":"carga","division_sap":"9001","costo":1000000,"fecha_alta_inventario":"2026-01-01"},
    {"vin":"3ALACWFC0MDMZ0002","modelo":"Actros","anio":2024,"tipo":"nueva","segmento":"fl360","division_sap":"9002","costo":2000000,"status":"facturada_en_cartera"},
    {"vin":"INVALIDO","modelo":"X"}]');
  assert (r->>'insertadas')::int = 2 and (r->>'actualizadas')::int = 0, 'insert: ' || r::text;

  select localidad_id into l from unidades where vin = '3ALACWFC0MDMZ0001';
  assert l = '10000000-0000-0000-0000-0000000000f1', 'localidad por división';

  -- reimportar: actualiza; campos vacíos no borran; no pisa ubicación existente
  update unidades set localidad_id = '10000000-0000-0000-0000-0000000000f2' where vin = '3ALACWFC0MDMZ0001';
  r := importar_unidades('[{"vin":"3ALACWFC0MDMZ0001","modelo":"M2 nuevo","division_sap":"9001"}]');
  assert (r->>'insertadas')::int = 0 and (r->>'actualizadas')::int = 1, 'upd: ' || r::text;
  select localidad_id, status::text into l, st from unidades where vin = '3ALACWFC0MDMZ0001';
  assert l = '10000000-0000-0000-0000-0000000000f2', 'no pisa ubicación';
  assert st = 'en_inventario', 'status intacto';
  select costo into cst from unidades_costos where vin = '3ALACWFC0MDMZ0001';
  assert cst = 1000000, 'costo intacto';
  assert (select modelo from unidades where vin = '3ALACWFC0MDMZ0001') = 'M2 nuevo', 'modelo actualizado';
  select count(*) into n from unidades where vin like '3ALACWFC0MDMZ%'; assert n = 2, 'sin duplicados';
  assert (select segmento::text from unidades where vin = '3ALACWFC0MDMZ0002') = 'fl360', 'segmento fl360';

  r := importar_financiamientos('[
    {"vin":"3ALACWFC0MDMZ0001","financiera":"SANTANDER","disposicion":1,"concepto":"chasis","saldo":500,"fecha_entrada_plan_piso":"2026-02-01","fecha_vencimiento_plan_piso":"2026-12-01"},
    {"vin":"3ALACWFC0MDMZ0001","financiera":"SANTANDER","disposicion":2,"concepto":"carrocería","saldo":300,"fecha_vencimiento_plan_piso":"2026-11-20"},
    {"vin":"3ALACWFC0MDMX9998","financiera":"SANTANDER"},
    {"vin":"3ALACWFC0MDMX9999","financiera":"BBVA IPP"}]');
  assert (r->>'insertadas')::int = 2, 'fin ins: ' || r::text;
  assert jsonb_array_length(r->'omitidas_sin_unidad') = 2, 'omitida sin unidad: ' || r::text;
  r := importar_financiamientos('[{"vin":"3ALACWFC0MDMZ0001","financiera":"SANTANDER","disposicion":1,"saldo":450}]');
  assert (r->>'actualizadas')::int = 1, 'fin upd';
  assert (select fecha_vencimiento_plan_piso from financiamientos where vin='3ALACWFC0MDMZ0001' and disposicion=1) = '2026-12-01', 'fecha intacta';
end $$;

-- seguro: regla (alta + 355) y luego manual gana
do $$ declare s text; v date; o text; begin
  select seguro_semaforo, seguro_vence, seguro_origen::text into s, v, o from v_unidades_full where vin = '3ALACWFC0MDMZ0001';
  assert v = date '2026-01-01' + 355 and o = 'regla', 'regla 355: ' || v;
  insert into seguros (vin, fecha_alta_seguro, fecha_vencimiento, origen) values ('3ALACWFC0MDMZ0001', current_date - 300, current_date + 10, 'manual');
  select seguro_semaforo, seguro_origen::text into s, o from v_unidades_full where vin = '3ALACWFC0MDMZ0001';
  assert s = 'por_vencer' and o = 'manual', 'manual gana: ' || s;
end $$;

-- dashboard
do $$ declare d jsonb; begin
  d := dashboard_resumen('10000000-0000-0000-0000-0000000000f2');
  assert (d->>'unidades')::int = 1, 'unidades f2: ' || d::text;           -- Z0001 (movida a f2); Z0002 es facturada
  assert (d->>'valor')::numeric = 1000000, 'valor';
  assert (d->'seguros'->>'por_vencer')::int = 1, 'seguro por vencer';
  assert (d->'plan_piso'->>'d30')::int + (d->'plan_piso'->>'d15')::int >= 0, 'plan piso';
  d := dashboard_resumen();
  assert jsonb_array_length(d->'por_financiera') >= 1, 'por financiera';
  assert (d->>'facturadas')::int >= 1, 'facturadas';
end $$;

-- el auditor no ve costo/saldo en la vista
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$ declare c numeric; f text[]; begin
  select costo, financieras into c, f from v_unidades_full where vin = '3ALACWFC0MDMZ0001';
  assert c is null and f is null, 'auditor sin costo/financieras';
end $$;
rollback;
\echo 'OK: fase2'
