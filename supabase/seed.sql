-- Localidades reales. Las divisiones SAP (Cod. Sucursal) NO se asignan aquí: se ignora a qué
-- localidad corresponde cada una y varias comparten la 4105. Mientras `divisiones` esté vacío,
-- las unidades nuevas quedan sin ubicación y el primer conteo físico (con "actualizar ubicación") la fija.
-- Cuando una división apunte a una sola localidad, asígnala así:
--   update localidades set divisiones = '{6056}' where nombre = 'Laredo';
insert into localidades (nombre) values
  ('Patio Vallarta'), ('Zapopan'), ('Guadalajara'), ('Laredo')
on conflict (nombre) do nothing;
