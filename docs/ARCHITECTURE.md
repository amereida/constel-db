# Arquitectura de con§tel-db

## Vision general

con§tel-db es una herramienta colaborativa de analisis tematico de corpus textuales.
Un grupo de lectores trabaja sobre un corpus compartido: seleccionan fragmentos,
les asignan conceptos, y agrupan conceptos en temas. El resultado es un mapa de
relaciones conceptuales que emerge de la lectura colectiva.

## Pipeline de renderizado

El contenido de cada fuente se almacena como **markdown con milestones embebidos**:

```
Texto normal <!-- §b exc_123 -->texto marcado<!-- §e exc_123 --> mas texto.
```

```mermaid
flowchart TD
    A[Source markdown\ncon milestones] --> B[preprocessSource]
    B --> B1["1. Milestones a mark HTML"]
    B --> B2["2. poem blocks a div.poem"]
    B --> B3["3. Indent 4+ a nbsp"]
    B1 --> C[marked.parse]
    B2 --> C
    B3 --> C
    C --> C1[poemBlock extension]
    C --> C2[markedFootnote]
    C --> C3[standard markdown]
    C1 --> D[smartQuotes]
    C2 --> D
    C3 --> D
    D --> D1["comillas tipograficas"]
    D --> D2["em dash"]
    D --> D3["ellipsis"]
    D1 --> E["HTML final con mark interactivos"]
    D2 --> E
    D3 --> E
```

### Por que milestones se procesan ANTES de marked

Los milestones se convierten a `<mark>` HTML antes de que marked procese el texto.
Esto garantiza que funcionen dentro de **cualquier contexto markdown**:
blockquotes, listas, headers, poem blocks.

Si se usaran como inline extensions de marked, no funcionarian dentro de
blockquotes ni otros bloques donde marked no ejecuta extensiones inline.

## Modelo de datos

```mermaid
erDiagram
    users {
        text id PK "Identity sub UUID"
        text email UK
        text name
        text role "user | admin"
        text profile_url
    }
    sources {
        text id PK
        text title
        text author
        text date
        text content "markdown con milestones"
        int word_count
        text uploaded_by FK
    }
    excerpts {
        text id PK
        text source_id FK
        text text
        text created_by FK
    }
    concepts {
        text id PK
        text label UK "case-insensitive"
        text created_by FK
    }
    themes {
        text id PK
        text name
        text color "hex"
        text created_by FK
    }
    notes {
        text id PK
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

    users ||--o{ sources : "uploaded_by"
    users ||--o{ excerpts : "created_by"
    users ||--o{ concepts : "created_by"
    sources ||--o{ excerpts : "source_id"
    excerpts ||--|{ concept_excerpts : "excerpt_id"
    concepts ||--|{ concept_excerpts : "concept_id"
    themes ||--o{ theme_concepts : "theme_id"
    concepts ||--o{ theme_concepts : "concept_id"
    themes ||--o{ notes : "theme_id"
    concepts ||--o{ notes : "concept_id"
```

## Regla fundamental: no hay secciones huerfanas

Una seccion (excerpt) **siempre** tiene al menos 1 concepto asociado.

| Operacion | Donde se aplica | Logica |
|-----------|-----------------|--------|
| Crear seccion | `handleCreateExcerpt` | Se crea con concepto obligatorio |
| Desvincular concepto | `concepts.js` unlink-excerpt | Si excerpt queda con 0 conceptos: elimina excerpt + milestones |
| Eliminar concepto | `concepts.js` DELETE | Para cada excerpt: si queda con 0 conceptos, elimina |
| Frontend | `state.js` removeConceptFromExcerpt | Limpia state local si 0 conceptos |
| Frontend | `state.js` removeConcept | Limpia excerpts huerfanos del state |

## Flujos de operaciones

### Crear seccion

```mermaid
sequenceDiagram
    actor U as Usuario
    participant R as reader.js
    participant S as state.js
    participant API as Backend
    participant DB as PostgreSQL

    U->>R: Selecciona texto + concepto
    R->>S: addConcept(label)
    S->>API: POST /concepts
    API->>DB: INSERT concepts
    DB-->>API: concept.id
    API-->>S: concept
    R->>S: addExcerpt({sourceId, text, conceptIds})
    S->>API: POST /excerpts
    API->>DB: INSERT excerpts + concept_excerpts
    DB-->>API: excerpt.id
    API-->>S: excerpt
    R->>R: insertMilestones(source, text, excId)
    R->>S: updateSourceContent(sourceId, updated)
    S->>API: PUT /sources
    API->>DB: UPDATE sources.content
    R->>R: re-render con nueva marca
```

### Agregar concepto a seccion existente

```mermaid
sequenceDiagram
    actor U as Usuario
    participant R as reader.js
    participant S as state.js
    participant API as Backend

    U->>R: Click en mark → popover → concepto
    R->>S: addConceptToExcerpt(excerptId, conceptId)
    S->>API: POST /concepts/link-excerpt
    API-->>S: ok
    S->>S: excerpt.conceptIds.push(conceptId)
    S->>R: notify → re-render tooltip
```

### Desvincular concepto (con regla de huerfanos)

```mermaid
sequenceDiagram
    actor U as Usuario
    participant R as reader.js
    participant S as state.js
    participant API as Backend
    participant DB as PostgreSQL

    U->>R: Click x en excerpt
    R->>S: removeConceptFromExcerpt(excId, conceptId)
    S->>API: POST /concepts/unlink-excerpt
    API->>DB: DELETE concept_excerpts
    API->>DB: SELECT count(*) WHERE excerpt_id=?
    alt 0 conceptos restantes
        API->>DB: Remove milestones from source
        API->>DB: DELETE excerpt
        API-->>S: excerpt_deleted: true
        S->>S: delete state.excerpts[excId]
    else 1+ conceptos restantes
        API-->>S: excerpt_deleted: false
    end
    S->>R: notify → re-render
```

### Eliminar concepto (admin, cascada)

```mermaid
sequenceDiagram
    actor A as Admin
    participant R as reader.js
    participant S as state.js
    participant API as Backend
    participant DB as PostgreSQL

    A->>R: Confirma eliminacion
    R->>S: removeConcept(id)
    S->>API: DELETE /concepts?id=X
    API->>DB: DELETE concepts (CASCADE → concept_excerpts)
    loop Cada excerpt vinculado
        API->>DB: SELECT count(*) conceptos restantes
        alt 0 conceptos (huerfano)
            API->>DB: Remove milestones from source
            API->>DB: DELETE excerpt
        end
    end
    API-->>S: {orphans_deleted: N}
    S->>S: Limpiar excerpts huerfanos del state
    S->>R: notify → re-render
```

## Event delegation (interaccion robusta)

La interaccion con las marcas y la seleccion de texto usa **event delegation**:
un solo listener por tipo de evento en `.reader-text-wrapper`, que cubre
tanto `.reader-content` (texto) como `.reader-sidenotes` (notas al pie).

```mermaid
flowchart TD
    W[".reader-text-wrapper"]
    W -->|"click"| D{"target.closest\n mark data-excerpt"}
    D -->|"Si"| P["showExcerptPopover\n(excerptId, markEl)"]
    D -->|"No"| X[ignorar]
    W -->|"mouseup"| S{"hay seleccion\n >= 3 chars?"}
    S -->|"Si"| C["popup.triggerSelection\n -> showCreatePopover"]
    S -->|"No"| X
```

Ventajas sobre listeners individuales por `<mark>`:
- Funciona con marks creados dinamicamente (sin re-registrar)
- Un solo listener es mas eficiente que N
- Cubre sidenotes automaticamente
- No se rompe al re-renderizar el texto

Los listeners se registran **una sola vez** en `initReaderTab()` (reader.js).

## Popover unificado

Existe un solo componente popover para secciones, con dos modos:

```mermaid
stateDiagram-v2
    [*] --> View: click en mark
    [*] --> Create: seleccionar texto
    View --> Edit: click lapiz
    Edit --> View: Escape
    View --> [*]: click fuera
    Create --> [*]: Marcar o Cancelar
    Edit --> [*]: excerpt eliminado
```

- **View**: pills de conceptos (read-only) + lapiz + basura
- **Edit**: pills con X para quitar + input autocomplete para agregar
- **Create**: input autocomplete + Marcar/Cancelar

El popover se posiciona `absolute` dentro de `.reader-text-wrapper`
(scrollea con el texto). Coordenadas via `getBoundingClientRect`
relativo al wrapper.

## Permisos

| Recurso | Crear | Editar | Eliminar |
|---------|-------|--------|----------|
| Fuente | admin | admin | admin |
| Seccion | user+ | - | propio o admin |
| Concepto | user+ | propio o admin (rename) | admin |
| Tema | user+ | propio o admin | admin |
| Nota | user+ | propio o admin | propio o admin |
| Vincular concepto-seccion | user+ | - | propio o admin |
| Perfil | propio | propio | - |
| Roles | - | admin | - |

## Filtros del mapa

```mermaid
flowchart LR
    F1[Filtro fuentes] --> Q[SQL query]
    F2[Filtro usuarios] --> Q
    Q --> G[Grafo: nodos + links]
    G --> M2D[concept-map.js D3]
    G --> M3D[concept-map-3d.js Three.js]
```

```
GET /api/graph?min_excerpts=1&sources=id1,id2&users=id1,id2
```

- `sources`: filtra excerpts por `source_id IN (...)`
- `users`: filtra por `created_by IN (...) OR linked_by IN (...)`
- Ambos: interseccion
- Sin filtros: grafo completo

## Sidenotes (notas al pie)

```mermaid
flowchart TD
    A["markdown con footnotes"] --> B[marked-footnote]
    B --> C["HTML: sup + section.footnotes"]
    C --> D[convertFootnotesToSidenotes]
    D --> E["Mueve notas a columna lateral"]
    E --> F["Calcula posicion vertical"]
    F --> G["Click en sup resalta nota"]
```

Las footnotes en markdown (`[^1]: texto`) se renderizan como sidenotes
en una columna lateral derecha, alineadas con su referencia `<sup>`.

## Auto-anotacion

```mermaid
flowchart TD
    A[auto-annotate.mjs] --> B["Paso 1: Claude analiza texto"]
    B --> C[Propone conceptos]
    C --> D[Revision interactiva]
    D --> E["Paso 2: Claude genera secciones"]
    E --> F[Resolver anclas en texto]
    F --> G[POST /concepts]
    F --> H[POST /excerpts]
    F --> I[insertMilestones]
    F --> J[POST /concepts/link-excerpt]
    G --> K[PUT /sources con milestones]
    H --> K
    I --> K
    J --> K
```

## Stack tecnico

| Capa | Tecnologia |
|------|------------|
| Frontend | Vanilla JS (ES6 modules), sin build step |
| Markdown | marked.js + marked-footnote |
| Mapas | D3.js (2D) + 3d-force-graph / Three.js (3D) |
| Backend | Netlify Functions (Node.js serverless) |
| Database | PostgreSQL (Neon) |
| Auth | Netlify Identity (Google OAuth) |
| Hosting | Netlify (CDN + Functions) |
| AI | Claude CLI (auto-annotate) |
