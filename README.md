# Inventario físico de vehículos por localidad

PWA mobile-first (Next.js 15 App Router + React 19 + Supabase) para levantar inventarios físicos
escaneando VINs en el patio, con validación en vivo, cola offline y reporte de diferencias.

> **Estado: Fase 1** — esquema SQL con RLS, conteo físico con escáner y cola offline, cierre con reporte
> de diferencias exportable a Excel. **Fase 2 (pendiente):** ficha de unidad, importadores de Excel
> (SAP / financieras), dashboard y exportes de listados.

## 1. Configurar Supabase

1. Crea un proyecto en <https://supabase.com>.
2. En **SQL Editor** ejecuta, en orden, `supabase/migrations/0001_esquema.sql` y `supabase/seed.sql`
   (o usa `supabase db push` con la CLI). `seed.sql` crea 3 localidades de ejemplo: edítalas a las reales.
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

## Normalización de VIN (`src/lib/vin.ts`)

Mayúsculas, sin espacios/guiones, `O→0`, `I→1`, descarta el prefijo `I` de 18 caracteres que agregan
algunos lectores Code 39, y trunca a 17. La BD exige `^[A-HJ-NPR-Z0-9]{17}$`.

## Seguridad (RLS)

- Los clientes **no escriben** en `conteos`/`conteo_detalle`; todo pasa por RPC `security definer` que validan rol y localidad.
- `auditor`: solo ve/opera sus localidades y **no ve costos ni saldos** (`unidades_costos` y `financiamientos` solo admin/consulta).
- `consulta`: lectura global. `admin`: todo. Fotos en bucket privado `conteo-fotos`.

## Pruebas

```bash
npm test                      # VIN, clasificación y cola offline (vitest)
npx tsc --noEmit              # tipos
psql "$DB_URL" -f supabase/tests/flujo_conteo.sql   # flujo completo contra Postgres (permisos, idempotencia, cierre, inmutabilidad)
```

## Decisiones y desviaciones

- `costo` vive en `unidades_costos` (no en `unidades`) para ocultarlo al auditor con RLS pura.
- `vendida_en_patio` es un resultado extra (unidad dada de salida pero encontrada).
- Service worker mínimo: abre la app y reanuda un conteo **ya visitado** sin red; la primera carga de una sesión requiere conexión.
- Íconos PWA: solo SVG; para iOS conviene agregar PNG 180×180/512×512 (`apple-touch-icon`).
