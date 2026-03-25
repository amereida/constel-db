# con§tel-db — Roadmap

## Estado actual (2026-03-25)
- ✅ Deploy en Netlify con continuous deployment
- ✅ Base de datos Neon conectada
- ✅ Google OAuth configurado (Netlify Identity)
- ✅ Login/logout funcional
- ✅ Corpus cargado y visible

---

## Prioridad ALTA — Bugs / UX inmediata

### Cache y actualización en tiempo real
- [ ] Al crear excerpt, concepto o sección → debe reflejarse sin recargar página
- [ ] Gestionar estado local (optimistic updates) + sincronización con API
- [ ] Evitar recargar todo el estado en cada mutación

---

## Prioridad MEDIA — Features admin

### Importar fuentes (admin)
- **Complejidad:** Baja
- **Backend:** ya existe (`POST /api/sources`, admin-only)
- **Cliente:** ya existe (`api.sources.create()`)
- [ ] UI: botón "Importar fuente" en tab Sources
- [ ] Modal con campos: título, autor, fecha, contenido (textarea o file upload)
- [ ] Soporte para importar .txt y .md

### Gestión de roles (admin)
- **Complejidad:** Baja
- **Backend:** ya existe (`GET/PUT /api/admin/users`)
- **Cliente:** ya existe (`api.admin.setRole()`)
- [ ] UI: panel admin (tab o modal)
- [ ] Listar usuarios con stats (excerpts, conceptos)
- [ ] Toggle/select para cambiar rol (user ↔ admin)
- [ ] Mostrar actividad reciente

---

## Prioridad BAJA — Mejora de contenido

### Markdown en fuentes
- **Complejidad:** Alta (por sistema de offsets `start_pos/end_pos`)
- **Problema:** excerpts usan character offsets sobre texto plano; markdown cambia los offsets
- **Opciones evaluadas:**
  - **A) Secciones sobre plain text** (recomendada) — detectar `#` como headings, sin cambiar offsets
  - **B) Dual storage** (md + plain) — importar en MD, operar sobre plain text
  - **C) Migrar offsets a texto renderizado** — reescribir text-highlighter (muy costoso)
- [ ] Implementar opción A como primer paso
- [ ] Evaluar necesidad real de markdown completo vs. secciones simples
