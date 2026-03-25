# con§tel-db -- Arquitectura

## Vision general

con§tel-db es una herramienta colaborativa de analisis tematico de corpus textuales. Un grupo de lectores trabaja sobre un corpus compartido: seleccionan fragmentos, les asignan conceptos, y agrupan conceptos en temas. El resultado es un mapa de relaciones conceptuales que emerge de la lectura colectiva.

## Stack

```mermaid
graph TB
    subgraph Cliente["Navegador (Vanilla JS, sin build)"]
        UI["tabs: sources / reader / themes"]
        State["state.js — cache + pub/sub"]
        API["api.js — fetch + JWT"]
    end

    subgraph Netlify["Netlify (CDN + Functions)"]
        Static["CDN — archivos estaticos"]
        Functions["Functions — Node.js serverless"]
        Identity["Identity — Google OAuth + JWT"]
    end

    subgraph DB["Neon (Postgres serverless)"]
        Tables["users, sources, excerpts,\nconcepts, themes, notes,\nconcept_excerpts, theme_concepts,\nactivity_log"]
    end

    UI --> State
    State --> API
    API -- "fetch /api/*" --> Functions
    API -- "JWT token" --> Identity
    Functions -- "postgres (porsager)" --> Tables
    Identity -- "user sub + email" --> Functions
    Cliente -- "HTML/CSS/JS" --> Static
```

## Modelo de datos

```mermaid
erDiagram
    users {
        text id PK "Identity sub"
        text email UK
        text name
        text avatar_url
        text role "user | admin"
    }

    sources {
        text id PK "src_ + md5"
        text filename
        text title
        text author
        text date
        text content "texto completo"
        int word_count
        text uploaded_by FK
    }

    excerpts {
        text id PK "exc_ + md5"
        text source_id FK
        text text "fragmento seleccionado"
        int start_pos
        int end_pos
        text created_by FK
    }

    concepts {
        text id PK "con_ + md5"
        text label UK
        text created_by FK
    }

    themes {
        text id PK "thm_ + md5"
        text label UK
        text color
        text created_by FK
    }

    notes {
        text id PK "note_ + md5"
        text theme_id FK "nullable"
        text concept_id FK "nullable"
        text text
        text created_by FK
    }

    concept_excerpts {
        text concept_id FK
        text excerpt_id FK
        text linked_by FK
    }

    theme_concepts {
        text theme_id FK
        text concept_id FK
        text added_by FK
    }

    activity_log {
        bigint id PK
        text user_id FK
        text action
        text entity_type
        text entity_id
        jsonb detail
    }

    users ||--o{ sources : "uploaded_by"
    users ||--o{ excerpts : "created_by"
    users ||--o{ concepts : "created_by"
    users ||--o{ themes : "created_by"
    users ||--o{ notes : "created_by"
    sources ||--o{ excerpts : "source_id"
    concepts ||--o{ concept_excerpts : "concept_id"
    excerpts ||--o{ concept_excerpts : "excerpt_id"
    themes ||--o{ theme_concepts : "theme_id"
    concepts ||--o{ theme_concepts : "concept_id"
    themes ||--o{ notes : "theme_id"
    concepts ||--o{ notes : "concept_id"
    users ||--o{ activity_log : "user_id"
```

## Flujo de datos en el frontend

```mermaid
sequenceDiagram
    participant U as Usuario
    participant Tab as Tab activo
    participant S as state.js
    participant A as api.js
    participant F as Netlify Function
    participant DB as Postgres

    Note over U,DB: Boot (al cargar la pagina)
    A->>F: POST /api/auth (sync user)
    F->>DB: UPSERT user
    A->>F: GET /sources, /concepts, /themes, /excerpts
    F->>DB: SELECT * ...
    DB-->>F: rows
    F-->>A: JSON
    A-->>S: indexar por ID en state.*
    S-->>Tab: notify() → re-render

    Note over U,DB: Crear un excerpt
    U->>Tab: Selecciona texto + escribe concepto
    Tab->>S: addExcerpt(data)
    S->>S: optimistic update (render inmediato)
    S->>A: POST /api/excerpts
    A->>F: { source_id, text, start_pos, end_pos, concept_ids }
    F->>DB: INSERT excerpt + concept_excerpts
    DB-->>F: excerpt creado
    F-->>A: JSON
    A-->>S: reemplazar temp → real
    S-->>Tab: notify() → actualizar marks
```

## Permisos y ownership

```mermaid
graph LR
    subgraph User["Rol: user"]
        U1["Crear excerpts, conceptos, temas, notas"]
        U2["Agregar conceptos a excerpts ajenos"]
        U3["Agregar conceptos a temas ajenos"]
        U4["Eliminar solo lo propio"]
    end

    subgraph Admin["Rol: admin"]
        A1["Todo lo de user"]
        A2["Importar/editar/eliminar fuentes"]
        A3["Eliminar cualquier entidad"]
        A4["Gestionar usuarios y roles"]
    end
```

Cada entidad registra quien la creo:

| Campo | Tabla | Significado |
|-------|-------|-------------|
| `uploaded_by` | sources | quien importo la fuente |
| `created_by` | excerpts, concepts, themes, notes | quien la creo |
| `linked_by` | concept_excerpts | quien vinculo concepto con seccion |
| `added_by` | theme_concepts | quien agrego concepto al tema |

## API REST

Todos los endpoints viven bajo `/api/*` (redirect via `netlify.toml`).

**Autenticacion:**
- GET = publico (sin JWT)
- POST/PUT/DELETE = requieren `Authorization: Bearer <JWT>` de Netlify Identity
- En dev local, si no hay JWT se usa el usuario de `.env` (`DEV_USER_*`)

### Sources

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/api/sources` | -- | Lista fuentes (sin content, con excerpt_count) |
| GET | `/api/sources?id=X` | -- | Fuente con content |
| POST | `/api/sources` | admin | Crear fuente |
| PUT | `/api/sources` | admin | Actualizar fuente |
| DELETE | `/api/sources?id=X` | admin | Eliminar fuente + cascada |

### Excerpts

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/api/excerpts` | -- | Todos los excerpts (boot) |
| GET | `/api/excerpts?source_id=X` | -- | Excerpts de una fuente |
| GET | `/api/excerpts?concept_id=X` | -- | Excerpts de un concepto |
| POST | `/api/excerpts` | JWT | Crear excerpt + vincular conceptos |
| DELETE | `/api/excerpts?id=X` | JWT | Eliminar (propio o admin) |

### Concepts

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/api/concepts` | -- | Lista con excerpt_count y source_count |
| POST | `/api/concepts` | JWT | Crear concepto |
| PUT | `/api/concepts` | JWT | Renombrar (propio o admin) |
| DELETE | `/api/concepts?id=X` | admin | Eliminar concepto |
| POST | `/api/concepts/link-excerpt` | JWT | Vincular concepto-excerpt |
| POST | `/api/concepts/unlink-excerpt` | JWT | Desvincular (propio o admin) |

### Themes

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/api/themes` | -- | Lista temas |
| POST | `/api/themes` | JWT | Crear tema |
| PUT | `/api/themes` | JWT | Actualizar (label, color) |
| DELETE | `/api/themes?id=X` | admin | Eliminar tema |
| POST | `/api/themes/add-concept` | JWT | Agregar concepto a tema |
| POST | `/api/themes/remove-concept` | JWT | Quitar concepto de tema |

### Notes

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/api/notes?theme_id=X` | -- | Notas de un tema |
| GET | `/api/notes?concept_id=X` | -- | Notas de un concepto |
| POST | `/api/notes` | JWT | Crear nota (theme_id o concept_id) |
| PUT | `/api/notes` | JWT | Editar (propio o admin) |
| DELETE | `/api/notes?id=X` | JWT | Eliminar (propio o admin) |

### Graph

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/api/graph` | -- | Grafo completo (nodes + links + themes) |
| GET | `/api/graph?source_id=X` | -- | Grafo filtrado por fuente |
| GET | `/api/graph?user_id=X` | -- | Grafo filtrado por usuario |

### Admin

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/api/admin/users` | admin | Lista usuarios registrados |
| PUT | `/api/admin/users` | admin | Cambiar rol (user/admin) |
| GET | `/api/admin/activity` | admin | Log de actividad |
| GET | `/api/admin/stats` | admin | Estadisticas generales |

## Arquitectura del frontend

```mermaid
graph TB
    subgraph Tabs
        T1["sources.js\nLista de fuentes\nImport/edit (admin)"]
        T2["reader.js\nLector con seleccion\nHighlighter + popup"]
        T3["themes.js\nMapa de conceptos\nTemas + notas"]
    end

    subgraph Components
        C1["text-highlighter.js\nRenderiza marks sobre texto"]
        C2["popup.js\nCaptura seleccion → excerpt"]
        C3["autocomplete.js\nSugerencia de conceptos"]
        C4["concept-gloss.js\nSidebar de conceptos"]
        C5["concept-map.js\nGrafo 2D (d3-force)"]
        C6["concept-map-3d.js\nGrafo 3D (3d-force-graph)"]
        C7["minimap.js\nMiniatura de navegacion"]
        C8["split-view.js\nPaneles redimensionables"]
    end

    subgraph Core
        M["main.js — boot + auth"]
        R["router.js — hash routing"]
        S["state.js — cache + pub/sub"]
        A["api.js — fetch + JWT + progress"]
    end

    M --> R
    R --> T1 & T2 & T3
    T1 & T2 & T3 --> S
    T2 --> C1 & C2 & C3 & C4 & C7 & C8
    T3 --> C5 & C6
    S --> A
```

## Tipografia

| Uso | Fuente | Variable CSS | Pesos |
|-----|--------|-------------|-------|
| UI (botones, labels, nav) | Gabarito | `--font` | 400-700 |
| Lectura (reader) | Sorts Mill Goudy | `--font-reading` | 400, 400i |
| Editor / codigo / preview | IBM Plex Mono | `--mono` | 400, 400i, 700 |

IBM Plex Mono se sirve self-hosted desde `public/fonts/ibm-plex-mono/` (woff2).

## Desarrollo local

```bash
npm install
cp .env.example .env   # configurar DATABASE_URL
npx netlify dev         # localhost:8888
```

En local, sin JWT, las functions usan el dev user definido en `.env`:

```
DEV_USER_EMAIL=hspencer@ead.cl
DEV_USER_NAME=Herbert Spencer
DEV_USER_ID=user_mn5b5yb6
```

La DB es compartida entre dev y produccion (misma instancia Neon).

## Deploy

Push a `main` → Netlify auto-deploy (CDN + Functions). La DB se provisiona via Neon.
