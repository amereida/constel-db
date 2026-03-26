# con§tel-db -- Roadmap

## Hecho

- [x] Frontend con tabs (Fuentes, Lector, Mapa, Escuela)
- [x] Backend Netlify Functions + Postgres (Neon)
- [x] Auth Google via Netlify Identity (fix Safari/iPad)
- [x] Lazy login: app publica, auth solo para crear
- [x] CRUD excerpts, concepts, themes, notes
- [x] Milestones: `<!-- §b/§e -->` reemplazan offsets fragiles
- [x] Markdown rendering (marked.js) con bloques `poem` custom
- [x] Smart quotes (tipograficas) y em/en dashes
- [x] Editor de fuentes inline (IBM Plex Mono, no modal)
- [x] Importar fuentes desde UI (admin)
- [x] Tab Escuela: usuarios, roles, actividad, stats (admin-only)
- [x] Permisos: user crea/edita lo propio, admin todo
- [x] Concept map 2D/3D con controles
- [x] Grilla Mondrian en tab Fuentes
- [x] Ficha de fuente con secciones y conceptos
- [x] Iconos SVG (close, trash, login, school)
- [x] Placeholders centralizados (mono italic centrado)
- [x] IBM Plex Mono descargada (woff2 local)

---

## Pendiente

### UX inmediata

- [ ] Feedback visual al crear seccion (highlight palpitante se estabiliza)
- [ ] La animacion de pulsing no debe quedar infinita si falla la creacion
- [ ] Progress bar mas elegante al cargar
- [ ] Notas por concepto (textarea en panel derecho del mapa)
- [ ] Boton eliminar nota (propio) / admin elimina cualquiera

### Mapa: filtros

Cajon colapsable en la barra de controles del mapa.
Por default todo seleccionado.

- [ ] Filtro por usuario: checkboxes con los usuarios que tienen excerpts
- [ ] Filtro por fuente: checkboxes con las fuentes del corpus
- [ ] El mapa se recalcula mostrando solo los excerpts que pasan el filtro
- [ ] Los conteos de links entre conceptos se ajustan al filtro

### Rendering y tipografia

- [ ] Bloques `poem` dentro de `pre` tienen altura minima fija (bug CSS)
- [ ] Itálica en bloques `poem`: desactivar, dar otro color
- [ ] `white-space: pre-wrap` en parrafos para preservar indentacion poetica
- [ ] Milestones dentro de bloques `poem` no se renderizan (fenced block escapa HTML)

### Colaboracion

- [ ] Mostrar quien creo cada excerpt (avatar/nombre en tooltip)
- [ ] Distinguir visualmente "mis secciones" vs "de otros" en el reader
- [ ] Notificaciones o feed de actividad reciente al entrar

### Futuro

- [ ] Exportar datos (JSON, CSV)
- [ ] Busqueda full-text en el corpus completo
- [ ] PWA / modo offline con sincronizacion
- [ ] API publica (read-only)
- [ ] Historial de cambios (undo basado en activity_log)
