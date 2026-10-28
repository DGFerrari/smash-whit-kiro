# smash-B

Platform fighter 2D para navegador (estilo Smash Bros / Brawlhalla), hecho con
TypeScript + Vite + Canvas 2D.

## Requisitos

- Node.js 18+

## Arrancar en desarrollo

```bash
npm install
npm run dev
```

Abre la URL que indique Vite (por defecto http://localhost:5173/).

## Compilar

```bash
npm run build     # comprueba tipos y genera dist/
npm run preview   # sirve la build de producción
```

## Controles

| Acción | Teclas |
| --- | --- |
| Mover | `A` / `D` o `←` / `→` |
| Saltar / doble salto | `Espacio`, `W`, `↑` |
| Apuntar ataque | `W`/`↑` arriba, `S`/`↓` abajo |
| Ataque ligero | `J` |
| Ataque fuerte (cargar) | `K` (mantener) |
| Pausa / menú | `Esc` |

Agárrate a las paredes manteniendo la dirección contra ellas (recuperas saltos),
y salta para hacer wall jump en diagonal.

## Arquitectura

- `src/config.ts` — valores de ajuste del "feel" (física, cámara, combate).
- `src/core/` — tipos base e input (abstracción de intención, no teclas).
- `src/physics/` — colisión AABB y plataformas (sólidas y atravesables).
- `src/entities/` — el jugador (física + estado de combate).
- `src/combat/` — datos de ataques (frame data) y ataque en ejecución.
- `src/render/` — cámara de encuadre y dibujado en Canvas 2D.
- `src/ui/` — HUD de porcentajes y menú de pausa.
- `src/game/` — mundo (estado simulable) y game loop con timestep fijo.

La simulación corre con **timestep fijo a 60 Hz** y el render **interpola** entre
pasos, de cara a un futuro netcode determinista.
