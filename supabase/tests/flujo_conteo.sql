-- Prueba del flujo de conteo. Requiere un Postgres con el esquema aplicado
-- (y los stubs de auth/storage si no es Supabase). Falla con error si algo no cumple.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@x.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'auditor@x.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'otro@x.com');
update perfiles set rol = 'auditor' where id = '00000000-0000-0000-0000-0000000000a2';
insert into localidades (id, nombre) values
  ('10000000-0000-0000-0000-000000000001', 'Patio A'),
  ('10000000-0000-0000-0000-000000000002', 'Patio B');
insert into usuario_localidades values
  ('00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001');
insert into unidades (vin, modelo, status, localidad_id) values
  ('3ALACWFC0MDMA0001', 'M2', 'en_inventario', '10000000-0000-0000-0000-000000000001'),
  ('3ALACWFC0MDMA0002', 'M2', 'en_inventario', '10000000-0000-0000-0000-000000000001'),
  ('3ALACWFC0MDMA0003', 'M2', 'en_inventario', '10000000-0000-0000-0000-000000000001'),
  ('3ALACWFC0MDMB0001', 'M2', 'en_inventario', '10000000-0000-0000-0000-000000000002'),
  ('3ALACWFC0MDMF0001', 'M2', 'facturada_en_cartera', '10000000-0000-0000-0000-000000000001');
insert into unidades_costos values ('3ALACWFC0MDMA0001', 999999);
insert into financiamientos (vin, financiera, saldo) values ('3ALACWFC0MDMA0001', 'SANTANDER', 5);

-- === como auditor ===
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);

do $$ declare n int; begin
  select count(*) into n from unidades_costos; assert n = 0, 'auditor no debe ver costos';
  select count(*) into n from financiamientos;  assert n = 0, 'auditor no debe ver saldos';
  select count(*) into n from unidades;         assert n = 5, 'auditor ve unidades';
end $$;

-- no puede abrir conteo en localidad no asignada
do $$ begin
  begin perform abrir_conteo('10000000-0000-0000-0000-000000000002'); raise exception 'debio fallar';
  exception when others then assert sqlerrm = 'sin_permiso', sqlerrm; end;
end $$;

select abrir_conteo('10000000-0000-0000-0000-000000000001') as cid \gset
select set_config('t.cid', :'cid', false) \gset
do $$ begin assert abrir_conteo('10000000-0000-0000-0000-000000000001') = current_setting('t.cid')::uuid, 'debe reutilizar la sesión abierta'; end $$;

select registrar_scans(:'cid', jsonb_build_array(
  jsonb_build_object('client_id','20000000-0000-0000-0000-000000000001','vin','3ALACWFC0MDMA0001'),
  jsonb_build_object('client_id','20000000-0000-0000-0000-000000000002','vin','3ALACWFC0MDMA0002'),
  jsonb_build_object('client_id','20000000-0000-0000-0000-000000000003','vin','3ALACWFC0MDMB0001'),
  jsonb_build_object('client_id','20000000-0000-0000-0000-000000000004','vin','3ALACWFC0MDMF0001'),
  jsonb_build_object('client_id','20000000-0000-0000-0000-000000000005','vin','1HGBH41JXMN109186'),
  jsonb_build_object('client_id','20000000-0000-0000-0000-000000000006','vin','CORTO'))) as r1 \gset

do $$ declare n int; begin
  select count(*) into n from conteo_detalle where resultado='esperada';           assert n = 2, 'esperadas';
  select count(*) into n from conteo_detalle where resultado='otra_localidad';     assert n = 1, 'otra loc';
  select count(*) into n from conteo_detalle where resultado='facturada_en_patio'; assert n = 1, 'facturada';
  select count(*) into n from conteo_detalle where resultado='sobrante';           assert n = 1, 'sobrante';
  select count(*) into n from conteo_detalle;                                      assert n = 5, 'vin invalido no se guarda';
end $$;

-- reintento idempotente (mismo client_id) y duplicado de otro client_id
select registrar_scans(:'cid', jsonb_build_array(
  jsonb_build_object('client_id','20000000-0000-0000-0000-000000000001','vin','3ALACWFC0MDMA0001'),
  jsonb_build_object('client_id','20000000-0000-0000-0000-000000000099','vin','3ALACWFC0MDMA0002'))) as r2 \gset
select set_config('t.r2', :'r2', false) \gset
do $$ declare n int; begin
  select count(*) into n from conteo_detalle; assert n = 5, 'sin duplicados';
  assert (current_setting('t.r2')::jsonb -> 1 ->> 'duplicado')::boolean, 'marca duplicado';
end $$;

-- editar resultado está prohibido; observaciones sí
do $$ begin
  begin update conteo_detalle set resultado='sobrante' where vin='3ALACWFC0MDMA0001'; raise exception 'debio fallar';
  exception when others then assert sqlerrm like 'permission denied%', sqlerrm; end;
end $$;
select actualizar_scan(:'cid', '20000000-0000-0000-0000-000000000001', 'x/y.jpg', 'rayón');
-- sin escritura directa
do $$ begin
  begin insert into conteo_detalle(client_id,conteo_id,vin,resultado) values (gen_random_uuid(), current_setting('t.cid')::uuid,'3ALACWFC0MDMA0003','esperada');
        raise exception 'debio fallar';
  exception when insufficient_privilege then null; end;
end $$;

-- fotos: solo a conteos abiertos y operables; nombres raros no revientan
do $$ begin
  assert puede_subir_foto(current_setting('t.cid') || '/x.jpg'), 'puede subir a su conteo abierto';
  assert not puede_subir_foto('no-es-uuid/x.jpg'), 'ruta inválida';
  assert not puede_subir_foto(gen_random_uuid()::text || '/x.jpg'), 'conteo inexistente';
  assert conteo_de_foto('basura') is null, 'sin error de cast';
end $$;

-- vista previa de faltantes: solo A0003
do $$ declare n int; begin
  select count(*) into n from conteo_faltantes_calc(current_setting('t.cid')::uuid); assert n = 1, 'un faltante';
end $$;

select cerrar_conteo(:'cid', true) as resumen \gset
select set_config('t.resumen', :'resumen', false) \gset
do $$ declare r jsonb := current_setting('t.resumen')::jsonb; begin
  assert (r->>'esperadas_total')::int = 3, 'esperadas_total';   -- A1,A2,A3 (facturada no cuenta)
  assert (r->>'esperadas_encontradas')::int = 2, 'encontradas';
  assert (r->>'faltantes')::int = 1, 'faltantes';
  assert (r->>'pct_coincidencia')::numeric = 66.7, 'pct';
end $$;

-- ubicación actualizada: la unidad de Patio B ahora está en Patio A
do $$ declare l uuid; begin
  select localidad_id into l from unidades where vin = '3ALACWFC0MDMB0001';
  assert l = '10000000-0000-0000-0000-000000000001', 'ubicación actualizada';
end $$;

-- sesión cerrada inmutable
do $$ begin
  begin perform registrar_scans(current_setting('t.cid')::uuid, jsonb_build_array(
    jsonb_build_object('client_id','20000000-0000-0000-0000-000000000077','vin','3ALACWFC0MDMA0003')));
    raise exception 'debio fallar';
  exception when others then assert sqlerrm = 'conteo_cerrado', sqlerrm; end;
  begin perform quitar_scan(current_setting('t.cid')::uuid, '20000000-0000-0000-0000-000000000001'); raise exception 'debio fallar';
  exception when others then assert sqlerrm like 'conteo_cerrado%', sqlerrm; end;
  begin perform cerrar_conteo(current_setting('t.cid')::uuid); raise exception 'debio fallar';
  exception when others then assert sqlerrm = 'conteo_cerrado', sqlerrm; end;
end $$;

do $$ begin assert not puede_subir_foto(current_setting('t.cid') || '/x.jpg'), 'no sube fotos a conteo cerrado'; end $$;

-- === como consulta (sin asignación): ve todo, no opera ===
reset role; set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
do $$ declare n int; begin
  select count(*) into n from conteos; assert n = 1, 'consulta ve conteos';
  select count(*) into n from financiamientos; assert n = 1, 'consulta ve saldos';
  begin perform abrir_conteo('10000000-0000-0000-0000-000000000001'); raise exception 'debio fallar';
  exception when others then assert sqlerrm = 'sin_permiso', sqlerrm; end;
end $$;

rollback;
\echo 'OK: flujo_conteo'
