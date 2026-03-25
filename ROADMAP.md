# con§tel-db — Roadmap

## Estado actual (2026-03-25)
- ✅ Frontend con tabs (sources, reader, themes) funcionando
- ✅ Backend Netlify Functions conectado a Postgres (Neon)
- ✅ Auth con Google vía Netlify Identity
- ✅ CRUD de excerpts, concepts, themes, notes
- ✅ Concept map (2D/3D)
- ✅ Dev mode: bypass de auth en localhost

---

## Fase 1 — Estabilidad y UX inmediata

### 1.1 Actualización reactiva (sin reload)
- [ ] Verificar que `notify()` se propaga correctamente al crear/eliminar excerpts
- [ ] Asegurar que el hash de excerpts detecta cambios incrementales
- [ ] Feedback visual inmediato al crear secciones (toast + highlight + scroll)

### 1.2 Caché y rendimiento
- [ ] Excerpts se cargan por fuente (lazy) — verificar que no se recargan innecesariamente
- [ ] Concepts y themes se cargan al boot — evaluar si necesitan refresh parcial

---

## Fase 2 — Markdown y contenido enriquecido

### 2.1 Paso 1: Markdown con offsets (actual)
- [ ] Almacenar `content` como Markdown en la DB
- [ ] Renderizar HTML en el reader (marked.js o similar, client-side)
- [ ] Calcular offsets sobre texto plano extraído del Markdown (sin tags)
- [ ] Editor de fuentes muestra Markdown raw (IBM Plex Mono)
- [ ] Reader muestra HTML renderizado (Sorts Mill Goudy)
- [ ] Detectar headings y generar tabla de contenido / navegación

### 2.2 Paso 2: Milestones (futuro — reemplaza offsets)

Reemplazar `start_pos`/`end_pos` por marcadores inline en el Markdown source.
Esto elimina el problema fundamental de offsets frágiles: si se edita una fuente,
todos los offsets posteriores se invalidan. Con milestones, los marcadores se
mueven junto con el texto.

**Formato propuesto**: HTML comments dentro del Markdown.

```markdown
Texto normal del documento que se está leyendo.

<!-- §init exc_a3f conceptos:levedad,peso creado:user_mn5b5yb6 -->
Este fragmento es una sección marcada. Puede contener **negritas**,
saltos de línea y cualquier Markdown válido.
<!-- §end exc_a3f -->

Más texto sin marcar.
```

**Por qué HTML comments:**
- Sobreviven todos los parsers de Markdown (pasan directo al HTML)
- Son invisibles en el reader (no se renderizan)
- Son visibles en el editor monoespaciado (el admin ve dónde hay marcas)
- No rompen la sintaxis Markdown

**Cambios arquitecturales que implica:**
1. Crear un excerpt = editar el `content` de la fuente (INSERT de comments)
2. La tabla `excerpts` se simplifica: solo `id`, `source_id`, `created_by`, `created_at` (sin posiciones ni texto)
3. El `text` del excerpt se extrae al parsear (contenido entre §init y §end)
4. La relación excerpt-concepto puede ir en el comment mismo o en `concept_excerpts`
5. Mapeo de selección HTML → posición en Markdown source para insertar markers
6. Excerpts superpuestos son posibles (§init/§end pueden anidarse)
7. Migración: convertir offsets actuales a milestones (script one-time)

**Riesgos:**
- Dos usuarios editando la misma fuente simultáneamente → conflictos
- El admin debe cuidar no borrar milestones al editar el source
- Parser custom para extraer milestones del Markdown

---

## Fase 3 — Gestión de corpus (admin)

### 3.1 Importar fuentes desde la UI
- [ ] Botón "Agregar fuente" visible solo para admins
- [ ] Formulario: subir archivo `.txt` o `.md`, campos título/autor/fecha
- [ ] Parsear contenido del archivo en el frontend, enviar como JSON al API
- [ ] Calcular `word_count` automáticamente

### 3.2 Gestión de usuarios (admin)
- [ ] Panel admin: listar usuarios registrados
- [ ] Cambiar rol de usuario (user ↔ admin)
- [ ] Ver actividad por usuario (basado en `activity_log`)
- [ ] Los endpoints `PUT /api/admin/users` y `GET /api/admin/activity` ya existen

---

## Fase 4 — Colaboración y multi-usuario

### 4.1 Visibilidad de autoría
- [ ] Mostrar quién creó cada excerpt (avatar/nombre en tooltip)
- [ ] Filtrar vista del concept map por usuario
- [ ] Distinguir visualmente "mis secciones" vs "de otros"

### 4.2 Permisos granulares
- [ ] User puede crear excerpts, concepts, themes
- [ ] User puede agregar conceptos a excerpts ajenos
- [ ] User solo puede eliminar lo propio
- [ ] Admin puede eliminar cualquier cosa

---

## Fase 5 — Mejoras futuras

- [ ] Exportar datos (JSON, CSV)
- [ ] Búsqueda full-text en el corpus
- [ ] Historial de cambios (undo basado en `activity_log`)
- [ ] PWA / modo offline con sincronización
- [ ] API pública (read-only) para integración externa
