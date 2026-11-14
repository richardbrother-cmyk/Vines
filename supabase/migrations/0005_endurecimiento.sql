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
