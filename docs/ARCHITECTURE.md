# con§tel-db — Arquitectura técnica

## Visión general

con§tel-db es una herramienta colaborativa de análisis temático. Los usuarios leen textos de un corpus compartido, seleccionan fragmentos (secciones), les asignan conceptos, y agrupan conceptos en temas. El resultado es un mapa de conceptos interconectados que emerge del corpus.

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Vanilla JS, ES6 modules, sin build step)         │
│                                                             │
│  public/js/                                                 │
│    main.js          → boot, auth flow, Identity widget      │
│    api.js           → fetch wrapper con JWT + progress bar  │
│    state.js         → cache in-memory + pub/sub             │
│    router.js        → hash-based routing (#tab/params)      │
│    tabs/                                                    │
│      sources.js     → lista de fuentes, import, edit        │
│      reader.js      → lector con selección y etiquetado     │
│      themes.js      → agrupación de conceptos en temas      │
│    components/                                              │
│      text-highlighter.js  → renderiza <mark> sobre texto    │
│      popup.js             → popup de creación de excerpt    │
│      autocomplete.js      → sugerencia de conceptos         │
│      concept-gloss.js     → sidebar de conceptos por texto  │
│      concept-map.js       → grafo 2D (d3-force)            │
│      concept-map-3d.js    → grafo 3D (3d-force-graph)      │
│      minimap.js           → miniatura de posición           │
│      split-view.js        → paneles redimensionables        │
└──────────────┬──────────────────────────────────────────────┘
               │ fetch /api/*
               ▼
┌─────────────────────────────────────────────────────────────┐
│  Netlify Functions (Node.js serverless)                     │
│                                                             │
│  netlify/functions/                                         │
│    auth.js          → POST /api/auth (user upsert)          │
│    sources.js       → CRUD /api/sources                     │
│    excerpts.js      → CRUD /api/excerpts                    │
│    concepts.js      → CRUD + link/unlink excerpts           │
│    themes.js        → CRUD + add/remove concepts            │
│    notes.js         → CRUD por tema                         │
│    graph.js         → GET /api/graph (concept map data)     │
│    admin.js         → usuarios, actividad, stats            │
│    utils/                                                   │
│      db.js          → postgres connection pool              │
│      auth.js        → JWT extraction, user upsert, perms   │
└──────────────┬──────────────────────────────────────────────┘
               │ postgres (porsager/postgres)
               ▼
┌─────────────────────────────────────────────────────────────┐
│  PostgreSQL (Neon, serverless)                              │
│                                                             │
│  Tablas: users, sources, excerpts, concepts, themes,        │
│          concept_excerpts, theme_concepts, notes,            │
│          activity_log                                        │
└─────────────────────────────────────────────────────────────┘
```

## Modelo de datos

### Diagrama ER

```
users ─────────────────────────────────────────────────┐
  id (TEXT, PK, from Identity sub)                     │
  email (UNIQUE)                                       │
  name, avatar_url                                     │
  role ('user' | 'admin')                              │
                                                       │
sources ◄──uploaded_by─┘                               │
  id (TEXT, PK, auto 'src_' + md5)                     │
  filename, title, author, date                        │
  content (TEXT, full text)                             │
  word_count (INT, auto-calculated)                    │
                                                       │
excerpts ◄──source_id── sources                        │
  id (TEXT, PK, auto 'exc_' + md5)          ◄──created_by─┘
  text, start_pos, end_pos                             │
                                                       │
concepts                                               │
  id (TEXT, PK, auto 'con_' + md5)          ◄──created_by─┘
  label (UNIQUE, case-sensitive en DB)                 │
                                                       │
themes                                                 │
  id (TEXT, PK, auto 'thm_' + md5)          ◄──created_by─┘
  label (UNIQUE), color                                │
                                                       │
concept_excerpts (M:N)                                 │
  concept_id ──► concepts                              │
  excerpt_id ──► excerpts                   ◄──linked_by─┘
                                                       │
theme_concepts (M:N)                                   │
  theme_id ──► themes                                  │
  concept_id ──► concepts                   ◄──added_by──┘
                                                       │
notes                                                  │
  id (TEXT, PK, auto 'note_' + md5)         ◄──created_by─┘
  theme_id ──► themes                                  │
  text                                                 │
                                                       │
activity_log                                           │
  user_id ──► users                                    │
  action, entity_type, entity_id, detail (JSONB)       │
```

### Ownership y permisos

Cada entidad registra quién la creó:
- `sources.uploaded_by` — quién importó la fuente
- `excerpts.created_by` — quién marcó la sección
- `concepts.created_by` — quién creó el concepto
- `themes.created_by` — quién creó el tema
- `concept_excerpts.linked_by` — quién vinculó concepto con sección
- `theme_concepts.added_by` — quién agregó concepto al tema
- `notes.created_by` — quién escribió la nota

Roles:
- **user**: CRUD propio. Puede crear, puede agregar a lo ajeno, solo puede borrar lo propio.
- **admin**: todo lo anterior + borrar cualquier cosa + gestionar corpus + gestionar usuarios.

## API REST

Todos los endpoints viven bajo `/api/*` (redirect via `netlify.toml`).

### Autenticación

- GET endpoints son **publicos** (no requieren JWT)
- POST/PUT/DELETE requieren `Authorization: Bearer <JWT>` de Netlify Identity
- En dev local (`netlify dev`), si no hay JWT se usa el usuario definido en `.env` (`DEV_USER_*`)

### Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/auth` | JWT | Sync user a DB (upsert) |
| GET | `/api/auth` | JWT | Info del usuario actual |
| GET | `/api/sources` | - | Lista fuentes (sin content) |
| GET | `/api/sources?id=X` | - | Fuente con content |
| POST | `/api/sources` | admin | Crear fuente |
| PUT | `/api/sources` | admin | Actualizar fuente |
| DELETE | `/api/sources?id=X` | admin | Eliminar fuente + excerpts |
| GET | `/api/excerpts?source_id=X` | - | Excerpts de una fuente |
| GET | `/api/excerpts?concept_id=X` | - | Excerpts de un concepto |
| POST | `/api/excerpts` | JWT | Crear excerpt |
| DELETE | `/api/excerpts?id=X` | JWT | Eliminar (propio o admin) |
| GET | `/api/concepts` | - | Lista conceptos con counts |
| GET | `/api/concepts?id=X` | - | Detalle de concepto |
| POST | `/api/concepts` | JWT | Crear concepto |
| PUT | `/api/concepts` | JWT | Renombrar (propio o admin) |
| DELETE | `/api/concepts?id=X` | admin | Eliminar concepto |
| POST | `/api/concepts/link-excerpt` | JWT | Vincular concepto-excerpt |
| POST | `/api/concepts/unlink-excerpt` | JWT | Desvincular (propio o admin) |
| GET | `/api/themes` | - | Lista temas |
| POST | `/api/themes` | JWT | Crear tema |
| PUT | `/api/themes` | JWT | Actualizar tema |
| DELETE | `/api/themes?id=X` | admin | Eliminar tema |
| POST | `/api/themes/add-concept` | JWT | Agregar concepto a tema |
| POST | `/api/themes/remove-concept` | JWT | Quitar concepto de tema |
| GET | `/api/notes?theme_id=X` | - | Notas de un tema |
| POST | `/api/notes` | JWT | Crear nota |
| PUT | `/api/notes` | JWT | Actualizar nota |
| DELETE | `/api/notes?id=X` | JWT | Eliminar (propio o admin) |
| GET | `/api/graph` | - | Grafo completo de conceptos |
| GET | `/api/graph?source_id=X` | - | Grafo filtrado por fuente |
| GET | `/api/graph?user_id=X` | - | Grafo filtrado por usuario |
| GET | `/api/admin/users` | admin | Lista usuarios |
| PUT | `/api/admin/users` | admin | Cambiar rol |
| GET | `/api/admin/activity` | admin | Log de actividad |
| GET | `/api/admin/stats` | admin | Estadisticas generales |

## Frontend: flujo de datos

```
                    ┌─────────┐
                    │  api.js │ ◄── fetch + JWT + progress bar
                    └────┬────┘
                         │ async
                    ┌────▼────┐
                    │ state.js│ ◄── cache in-memory + normalización
                    └────┬────┘
                         │ notify()
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         sources.js  reader.js  themes.js   ◄── subscribers re-renderizan
```

### state.js

- **Cache**: objetos indexados por ID (`state.sources`, `state.excerpts`, etc.)
- **Pub/Sub**: `subscribe(fn)` registra listeners, `notify()` los dispara
- **Normalización**: API devuelve `snake_case`, state normaliza a `camelCase`
- **Lazy loading**: excerpts se cargan por fuente, notes por tema
- **Optimistic updates**: `addExcerpt` muestra el mark antes de confirmar con server

### Excerpt creation flow

1. Usuario selecciona texto en el reader
2. `popup.js` captura la selección y calcula offsets sobre el texto plano
3. Usuario escribe nombre de concepto (con autocomplete)
4. `reader.js > handleCreateExcerpt` orquesta:
   - `state.addConcept(label)` si es nuevo → POST /api/concepts
   - `state.addExcerpt({...})` → optimistic render + POST /api/excerpts
5. `notify()` dispara re-render del texto (marks) y sidebar (gloss)

## Tipografia

| Uso | Fuente | Peso |
|-----|--------|------|
| UI (botones, labels, nav) | Gabarito | 400-700 |
| Lectura (reader) | Sorts Mill Goudy | 400, 400i |
| Editor / codigo | IBM Plex Mono | 400, 400i, 700 |

IBM Plex Mono se sirve self-hosted desde `public/fonts/ibm-plex-mono/`.

## Desarrollo local

```bash
npm install
netlify dev          # arranca functions + frontend en localhost:8888
```

En local, la autenticación se bypasea usando las variables de `.env`:
```
DEV_USER_EMAIL=hspencer@ead.cl
DEV_USER_NAME=Herbert Spencer
DEV_USER_ID=user_mn5b5yb6
```

No se necesita login con Google en localhost. Las funciones serverless detectan la ausencia de JWT y usan el dev user.

## Deploy

Push a `main` → Netlify auto-deploy. La DB es compartida entre dev y produccion (misma Neon).
