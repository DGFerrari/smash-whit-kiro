# smash-B — servidor (Fase 2+)

Backend del juego: cuentas (login con Google), puntos y ranking. Node +
TypeScript con [Hono](https://hono.dev/). Vive en el mismo repo que el cliente
(monorepo "ligero"): el server es independiente y, más adelante, importará el
**motor** de `../src/engine/` para validar partidas (re-simular replays).

## Requisitos

- Node.js 20+

## Arrancar en desarrollo

```bash
cd server
npm install
npm run dev     # tsx watch: recarga al guardar; escucha en http://localhost:8787
```

Prueba rápida:

```bash
curl http://localhost:8787/api/health
# {"status":"ok","service":"smash-b-server","time":"..."}
```

## Scripts

- `npm run dev` — desarrollo con recarga (tsx).
- `npm run typecheck` — comprobar tipos sin compilar.
- `npm run build` — compila a `dist/` (lo que ejecuta el hosting).
- `npm start` — ejecuta la build (`node dist/index.js`).

## Configuración

Copia `.env.example` a `.env` y rellena los valores (nunca subas `.env`). De
momento solo `PORT`; en los próximos pasos se añaden la base de datos (Neon) y
el login con Google.

## Estado

- [x] Esqueleto: endpoint de salud `/api/health`.
- [ ] Base de datos (Neon Postgres) + migraciones (Drizzle).
- [ ] Login con Google (OAuth) + tabla de usuarios.
- [ ] Puntos y ranking (validando replays con el motor compartido).

Ver la hoja de ruta completa en [`../docs/ROADMAP.md`](../docs/ROADMAP.md).
