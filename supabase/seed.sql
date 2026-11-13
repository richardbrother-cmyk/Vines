-- Localidades de ejemplo (ajusta nombres, divisiones y direcciones a las reales)
insert into localidades (nombre, divisiones, direccion) values
  ('Guadalajara Matriz',   '{4105,4106}',      'Av. Ejemplo 100, Guadalajara, Jal.'),
  ('Guadalajara Seminuevos','{4111,4113}',     'Calle Ejemplo 200, Zapopan, Jal.'),
  ('Guadalajara Pasaje',   '{4305,6056}',      'Carretera Ejemplo km 5, Tlaquepaque, Jal.')
on conflict (nombre) do nothing;
