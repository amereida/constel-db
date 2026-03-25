# con§tel-db

**Herramienta colaborativa de análisis temático de corpus textuales.**

Versión multi-usuario de [con§tel](https://github.com/hspencer/constel) con backend, base de datos y autenticación.

[![Netlify Status](https://api.netlify.com/api/v1/badges/c507d3c6-f8b7-4e39-b818-19f2f3f5aafc/deploy-status)](https://app.netlify.com/projects/constel-amereida/deploys)

## Características

- Corpus compartido gestionado por administradores
- Anotación colaborativa: cada usuario crea sus propios excerpts, conceptos y temas
- Los usuarios pueden sumar a lo creado por otros (pero no borrar)
- Mapa de conceptos 2D/3D — total, por usuario, o por fuente
- Autenticación via Google (Netlify Identity)
- Auditoría de actividad

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | Vanilla JS (ES6 modules) |
| Backend | Netlify Functions (serverless) |
| Base de datos | PostgreSQL (Netlify DB / Neon) |
| Auth | Netlify Identity + Google OAuth |
| Hosting | Netlify |

## Documentacion

- **[Arquitectura tecnica](docs/ARCHITECTURE.md)** — modelo de datos, API, flujo de datos, stack completo
- **[Roadmap](ROADMAP.md)** — fases de desarrollo, features pendientes, propuesta de milestones

## Desarrollo local

```bash
npm install
cp .env.example .env  # configurar DATABASE_URL
npx netlify dev       # arranca en http://localhost:8888
```

Si el puerto queda ocupado de una sesion anterior:

```bash
lsof -ti :3999 -ti :8888 | xargs kill  # liberar puertos
npx netlify dev
```

## Licencia

MIT
