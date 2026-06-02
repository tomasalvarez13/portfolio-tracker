# Portfolio Tracker

Tracker personal de portafolio de inversiones (multi-usuario). Acciones USA, acciones chilenas, Bitcoin, fondos mutuos chilenos y APV — todo en CLP y USD, con dólar observado del Banco Central.

## Stack

- **Frontend:** React + Vite + Tailwind (dark mode) + Recharts
- **Backend:** Node.js + Express
- **DB:** PostgreSQL en Supabase (Auth + RLS)
- **Hosting:** Render (backend) + Vercel/Netlify (frontend)

## Estructura

```
backend/    API Express, fetchers de precios, cron diario
frontend/   SPA React con 4 secciones (Resumen, Posiciones, Rentabilidad, Mercado)
```

## Fuentes de datos (validadas)

| Instrumento | Fuente | Estado |
|---|---|---|
| Dólar observado | mindicador.cl | ✅ |
| Bitcoin | CoinGecko | ✅ |
| Acciones/ETF USA | Alpha Vantage | ✅ calce 100% |
| Fondos Fintual | CMF (admin 76810627) | ✅ -0.001% |
| APV PlanVital | Superintendencia de Pensiones | ✅ exacto |
| FIP Venturance (Tronador, Sierra Nevada) | — (manual) | sin API pública |

## Setup local

### 1. Base de datos (Supabase)
1. Crea un proyecto en [supabase.com](https://supabase.com).
2. SQL Editor → ejecuta `backend/src/db/schema.sql`.
3. Regístrate en la app (sección siguiente) para crear tu usuario.
4. Edita `backend/src/db/seed.sql` (línea `seed_email`) con tu email y ejecútalo.

### 2. Backend
```bash
cd backend
cp .env.example .env     # completa SUPABASE_*, DATABASE_URL, ALPHA_VANTAGE_API_KEY
npm install
npm run dev              # http://localhost:3001
```

### 3. Frontend
```bash
cd frontend
cp .env.example .env     # completa VITE_SUPABASE_* y VITE_API_URL
npm install
npm run dev              # http://localhost:5173
```

### 4. Cargar precios
Desde la app, en **Posiciones → ↻ Actualizar precios**, o:
```bash
cd backend && npm run fetch:prices
```

## Cron de precios

`node-cron` corre el fetch + snapshot diario (default 08:30 L-V, `America/Santiago`).
Configurable con `PRICE_CRON_SCHEDULE` / `CRON_TIMEZONE`. Desactivable con `RUN_CRON=false`.

## Multi-usuario

- Auth con Supabase Auth (email + password). El JWT viaja en `Authorization: Bearer`.
- RLS activo: cada usuario solo ve sus `positions`, `movements` y `portfolio_snapshots`.
- `instruments`, `prices` y `exchange_rates` son globales (datos de mercado).
- Rutas `/api/admin/*` preparadas (rol `admin`), responden 501 en v1.

## Pendiente para v2 (arquitectura ya preparada)

- Vistas de administración (gestión de usuarios/roles).
- Parsing automático de cartolas PDF/Excel.
- Chat AI sobre el portafolio.
- Automatizar valor cuota de FIP Venturance.

## Deploy

- **Backend (Render):** Web Service, root `backend/`, build `npm install`, start `npm start`. Variables de entorno del `.env`. El cron corre dentro del proceso.
- **Frontend (Vercel/Netlify):** root `frontend/`, build `npm run build`, output `dist/`. Variables `VITE_*`.
- Ajusta `FRONTEND_ORIGIN` (backend) y `VITE_API_URL` (frontend) a las URLs de producción.
