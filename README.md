# con§tel-db

**Herramienta colaborativa de análisis temático de corpus textuales.**

Versión multi-usuario de [con§tel](https://github.com/hspencer/constel) con backend, base de datos y autenticación.

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

## Desarrollo local

```bash
npm install
cp .env.example .env  # configurar DATABASE_URL
netlify dev
```

## Licencia

MIT
