# con§tel-db — Contexto del proyecto

## Relación con constel (standalone)

Este repo es la versión **colaborativa** de con§tel. Comparte la misma UI (CSS, componentes, tabs) pero reemplaza:
- `server.mjs` → Netlify Functions (serverless)
- `constel-db.json` → PostgreSQL (Netlify DB / Neon)
- localStorage → API REST autenticada
- Modo single-user → Multi-user con roles (user/admin)

El repo standalone (`hspencer/constel`) se mantiene como herramienta individual de investigación.

## Arquitectura

```
Frontend (Vanilla JS)          Netlify Functions           Netlify DB (Postgres)
public/js/                     netlify/functions/          db/schema.sql
  api.js  ──fetch /api/*──→      auth.js                    users
  state.js (cache)               sources.js                 sources
  tabs/                          excerpts.js                excerpts
  components/                    concepts.js                concepts
                                 themes.js                  concept_excerpts
                                 notes.js                   theme_concepts
                                 graph.js                   notes
                                 admin.js                   activity_log
                                 utils/
                                   db.js (postgres client)
                                   auth.js (JWT + helpers)
```

## Stack

- **Frontend**: Vanilla JS (ES6 modules), sin build step
- **Backend**: Netlify Functions (Node.js serverless)
- **Database**: Netlify DB (Postgres via Neon)
- **Auth**: Netlify Identity (Google OAuth)
- **Hosting**: Netlify (CDN + Functions)
- **DB client**: `postgres` (porsager/postgres)

## Modelo de datos

### Entidades
- `users` — id (Identity sub), email, name, avatar_url, role (user|admin)
- `sources` — textos del corpus (content almacenado en DB, no en archivos)
- `excerpts` — selecciones de texto con start_pos/end_pos
- `concepts` — etiquetas (label único, case-insensitive)
- `themes` — agrupaciones de conceptos con color
- `notes` — anotaciones por tema
- `activity_log` — auditoría

### Relaciones (many-to-many)
- `concept_excerpts` — concepto ↔ excerpt (con linked_by para ownership)
- `theme_concepts` — tema ↔ concepto (con added_by para ownership)

### Permisos
- **user**: CRUD propio (crear excerpt, concepto, tema, nota; agregar a ajenos; borrar solo lo propio)
- **admin**: todo lo anterior + borrar cualquier cosa + gestionar corpus + gestionar usuarios

## Archivos clave

### Frontend (shared con constel)
- `public/css/*` — diseño completo
- `public/js/components/*` — concept-map.js, concept-map-3d.js, text-highlighter.js, etc.
- `public/js/tabs/*` — sources.js, reader.js, themes.js

### Frontend (diverge de constel)
- `public/js/api.js` — cliente REST con auth bearer
- `public/js/state.js` — cache in-memory + API calls async
- `public/js/main.js` — boot con Netlify Identity login flow

### Backend (nuevo)
- `netlify/functions/utils/db.js` — postgres connection pool
- `netlify/functions/utils/auth.js` — JWT extraction, user upsert, permission helpers
- `netlify/functions/*.js` — endpoints REST

### Config
- `netlify.toml` — build config, redirects /api/* → functions
- `db/schema.sql` — DDL completo
- `.env` (local) — DATABASE_URL

## Convenciones

- IDs generados por Postgres: `prefix_` + md5 random
- Todos los CRUD son async (devuelven Promises)
- `state.js` mantiene cache local; lecturas son sync, escrituras async
- Campo names en DB: snake_case (`source_id`, `start_pos`, `concept_ids`)
- Campo names en frontend: se mantienen como vienen del API (snake_case)
- Tipografía: Gabarito (UI), Sorts Mill Goudy (lectura)
- Tema claro/oscuro: `data-theme="light|dark"` en `<html>`

## Desarrollo local

```bash
npm install
# Crear .env con DATABASE_URL de Neon
netlify dev   # arranca functions + frontend en localhost:8888
```

## Deploy

Push a main → Netlify auto-deploy. La DB se provisiona via Netlify DB integration.

## Pasos pendientes para puesta en marcha

1. Configurar Netlify Identity en el dashboard (habilitar Google provider)
2. Provisionar Netlify DB (o conectar Neon manualmente)
3. Ejecutar `db/schema.sql` en la DB
4. Configurar primer admin (INSERT manual o via Identity webhook)
5. Adaptar tabs (sources.js, reader.js, themes.js) para async state
6. Agregar UI de login/logout/avatar en index.html
7. Agregar panel admin (gestión de usuarios, actividad)
8. Testing end-to-end
