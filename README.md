# Inventario físico de vehículos por localidad

PWA mobile-first (Next.js 15 App Router + React 19 + Supabase) para levantar inventarios físicos
escaneando VINs en el patio, con validación en vivo, cola offline y reporte de diferencias.

> **Estado: Fases 1 y 2 completas** — esquema SQL con RLS, conteo físico con escáner y cola offline,
> cierre con reporte de diferencias, ficha de unidad, importadores de Excel (SAP / financieras),
> dashboard global y por localidad, y exporte a Excel de cualquier listado filtrable.

## 1. Configurar Supabase

1. Crea un proyecto en <https://supabase.com>.
2. En **SQL Editor** ejecuta, en orden, `supabase/migrations/0001_esquema.sql`, `0002_fase2.sql`, `0003_segmento_fl360.sql`, `0004_unidades_ausentes.sql` y `supabase/seed.sql`
   (o usa `supabase db push` con la CLI). `seed.sql` crea las 4 localidades (Patio Vallarta, Zapopan, Guadalajara, Laredo) **sin divisiones**: asígnalas con `update localidades set divisiones = '{6056}' where nombre = 'Laredo';` cuando se sepa a qué localidad corresponde cada Cod. Sucursal. Sin divisiones, las unidades importadas quedan sin ubicación y el primer conteo (con *actualizar ubicación*) la fija.
3. En **Authentication → Providers** deja habilitado *Email*. Crea tus usuarios en
   **Authentication → Users** (o desactiva el registro público si solo invitas).
   - **El primer usuario creado queda como `admin`**; los demás nacen como `consulta`.
4. Asigna roles y localidades en el SQL Editor:

```sql
update perfiles set rol = 'auditor' where id = (select id from auth.users where email = 'auditor@empresa.com');
insert into usuario_localidades (usuario_id, localidad_id)
  select u.id, l.id from auth.users u, localidades l
  where u.email = 'auditor@empresa.com' and l.nombre = 'Guadalajara Matriz';
```

## 2. Variables de entorno

Copia `.env.example` a `.env.local`:

| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto (Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clave `anon` (pública; la protege RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **solo** para `scripts/` de carga; nunca en Vercel como `NEXT_PUBLIC_*` |

## 3. Correr en local y datos demo

```bash
npm install
node --env-file=.env.local scripts/seed-demo.mjs   # genera datos/demo_inventario.xlsx (20 unidades) y las carga
npm run dev                                         # http://localhost:3000
```

La cámara requiere HTTPS (o `localhost`). Para probar en el celular usa el deploy de Vercel o un túnel HTTPS.

## 4. Desplegar en Vercel

Importa el repo en Vercel, define `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`
y despliega (`vercel deploy`). En el celular: *Compartir → Agregar a pantalla de inicio* para instalarla como app.

## Cómo funciona el conteo

1. El auditor abre/continúa la sesión de su localidad (**una sesión abierta por localidad**; varios
   auditores pueden sumarse a la misma y comparten el "ya escaneado").
2. Al entrar, el teléfono descarga el catálogo de unidades (IndexedDB). **Toda la validación es local**:
   *esperada aquí*, *pertenece a otra localidad*, *sobrante* (no existe en la base), *ya escaneado*,
   *facturada aún en patio* y *vendida encontrada*.
3. Cada escaneo entra a una cola local y se sincroniza en lotes cuando hay red; reintentar es seguro
   (idempotente por `client_id`). El servidor recalcula el resultado y es la fuente de verdad.
4. Entrada por cámara (Code 39/128/QR; usa la Barcode Detection API nativa si existe y, si no, ZXing vía
   `html5-qrcode`) o a mano: VIN completo o **últimos 4–8 dígitos** con autocompletado.
5. **Cerrar** (reporte → *Cerrar conteo*): congela los faltantes, calcula % de coincidencia y,
   opcionalmente, actualiza la *última ubicación conocida*. No deja cerrar con escaneos sin sincronizar en el dispositivo.
6. Las sesiones cerradas son **inmutables** (triggers en BD). Correcciones: nueva sesión o nota de admin (`conteo_notas`, con bitácora).

## Pantallas

| Ruta | Qué hace | Roles |
|---|---|---|
| `/conteos` | iniciar/continuar conteo por localidad, historial de cerrados | todos (operar: admin, auditor) |
| `/conteos/[id]` · `/reporte` | escáner, cola offline · diferencias, cierre, Excel | idem |
| `/unidades` | búsqueda por VIN/últimos dígitos y filtros (localidad, status, financiera, segmento, seguro, plan piso); **Exportar a Excel** respeta los filtros | todos |
| `/unidades/[vin]` | ficha: ubicación + historial de conteos con fotos/observaciones, financiamiento y saldo, plan piso, seguro con semáforo, costo; alta de acuse de aseguradora (admin) | todos (auditor no ve costo ni saldo) |
| `/dashboard` | global o por localidad: unidades y valor, por financiera y segmento, seguros vencidos/por vencer, plan piso ≤15/≤30 d, último conteo y % de coincidencia. Cada cifra enlaza al listado filtrado (accionable y exportable) | todos |
| `/cargas` | importar Excel SAP o de financiera con mapeo de columnas configurable + bitácora | admin |

## Carga de Excel

1. Entra a **Cargas**, elige *Inventario SAP* o *Estado de cuenta financiera* y sube el `.xlsx`
   (se detecta la fila de encabezados aunque haya títulos arriba).
2. El mapeo de columnas se sugiere solo (por nombre) y se puede corregir; **se guarda** en `mapeos_columnas` para la siguiente carga.
3. La vista previa muestra filas válidas, errores, VIN repetidos y VIN corregidos (O→0, I→1, sufijos) antes de importar.
4. **Unidades que ya no vienen**: al cargar un archivo SAP de inventario, el importador compara contra la base y avisa cuántas unidades siguen "en inventario" pero no están en el archivo (por defecto solo dentro de las divisiones que trae el archivo; hay una casilla para comparar contra todo). Alerta en rojo si son >30 % (posible archivo incompleto). Puedes marcarlas como *facturadas en cartera* o *vendidas*, con confirmación y registro en `bitacora`; nunca se cambia nada sin tu acción.
5. **Upsert por VIN**: nunca duplica; los campos vacíos no borran datos; la ubicación física ya conocida no se pisa
   (la localidad se asigna por *división SAP* solo a unidades nuevas o sin ubicación). Cada carga queda en la bitácora `cargas` con sus errores.
6. Financieras: si el archivo trae dos filas por VIN, la 1.ª es la disposición 1 (chasis) y la 2.ª la 2 (carrocería), salvo que mapees una columna de disposición.
   Los VIN que no existan en el inventario se **omiten y se reportan** (carga primero SAP).

## Normalización de VIN (`src/lib/vin.ts`)

Mayúsculas, sin espacios/guiones, `O→0`, `I→1`, descarta el prefijo `I` de 18 caracteres que agregan
algunos lectores Code 39, y trunca a 17. La BD exige `^[A-HJ-NPR-Z0-9]{17}$`.

## Seguridad (RLS)

- Los clientes **no escriben** en `conteos`/`conteo_detalle`; todo pasa por RPC `security definer` que validan rol y localidad.
- `auditor`: solo ve/opera sus localidades y **no ve costos ni saldos** (`unidades_costos` y `financiamientos` solo admin/consulta).
- `consulta`: lectura global. `admin`: todo. Fotos en bucket privado `conteo-fotos`.

## Pruebas

```bash
npm test                      # VIN, clasificación, cola offline, normalización/lectura de Excel (vitest)
npx tsc --noEmit              # tipos
psql "$DB_URL" -f supabase/tests/flujo_conteo.sql   # conteo: permisos, idempotencia, cierre, inmutabilidad
psql "$DB_URL" -f supabase/tests/fase2.sql          # importadores, regla de seguro 355 d, dashboard, RLS de costos
# (en Supabase real, los inserts a auth.users de las pruebas requieren una base de pruebas, no producción)
```

## Decisiones y desviaciones

- `costo` vive en `unidades_costos` (no en `unidades`) para ocultarlo al auditor con RLS pura.
- `vendida_en_patio` es un resultado extra (unidad dada de salida pero encontrada).
- Service worker mínimo: abre la app y reanuda un conteo **ya visitado** sin red; la primera carga de una sesión requiere conexión.
- Íconos PWA: solo SVG; para iOS conviene agregar PNG 180×180/512×512 (`apple-touch-icon`).
