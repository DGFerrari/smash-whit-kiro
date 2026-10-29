# smash-B

Juego de peleas de plataformas **2D** para navegador (estilo Smash Bros /
Brawlhalla): se **simula en 2D** de forma determinista, pero se **renderiza en
3D (2.5D)** con Three.js. Hecho con TypeScript + Vite.

> Proyecto de portafolio / para jugar con amigos. Hoja de ruta (puntos, gachas,
> rankings, online) en [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Features

- Combate: ataques **ligeros direccionales** y **fuertes cargables**, escudo,
  esquiva aérea, dash, wall jump y medidor de **furia**.
- **2–4 jugadores** en la misma pantalla.
- **CPU con dificultad por slot** (fácil / normal / difícil, cada bot la suya) y
  posibilidad de deshabilitar cualquier slot, incluido el Jugador 1.
- **Selección de personaje y escenario** con fichas (clic para coger, clic para
  soltar).
- **3 escenarios** con geometría, colores y fondo propios, más un escenario de
  **entrenamiento** con rejilla y dummy configurable.
- **Replays**: las partidas se graban (inputs empaquetados) y se reproducen de
  forma determinista; el menú usa replays como fondo animado.
- **Tutorial** guiado por objetivos con sub-tareas.
- Cámara con encuadre dinámico y momentos cinemáticos; POV ajustable.

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
npm run build     # comprueba tipos (tsc) y genera dist/
npm run preview   # sirve la build de producción
```

## Controles

| Acción | Teclas (P1) |
| --- | --- |
| Mover | `A` / `D` o `←` / `→` |
| Saltar / doble salto | `Espacio`, `W`, `↑` |
| Apuntar ataque | `W`/`↑` arriba, `S`/`↓` abajo |
| Ataque ligero | `J` |
| Ataque fuerte (cargar) | `K` (mantener y soltar) |
| Escudo / esquiva aérea | `L` |
| Pausa / menú | `Esc` |

Las teclas de cada jugador se pueden reasignar desde el menú de pausa. Agárrate
a las paredes manteniendo la dirección contra ellas (recuperas saltos) y salta
para hacer wall jump en diagonal.

## Arquitectura

- `src/config.ts` — valores de ajuste del "feel" (física, cámara, combate, POV).
- `src/core/` — tipos base, input (abstracción de intención, no teclas) y bindings.
- `src/physics/` — colisión AABB y plataformas (sólidas y atravesables).
- `src/entities/` — el jugador (física + estado de combate).
- `src/combat/` — datos de ataques (frame data) y ataque en ejecución.
- `src/game/` — mundo (estado simulable), game loop, escenarios, IA de la CPU y
  sistema de replays.
- `src/render/` — cámara, renderer 3D (Three.js), fondos por capas y texturas.
- `src/ui/` — menús, selección, HUD, pausa, tutorial y pantallas de replay.

La simulación corre con **timestep fijo a 60 Hz** y el render **interpola** entre
pasos. El motor es **determinista** (mismo input → mismo resultado), lo que
sostiene los replays y es la base para un futuro netcode por rollback y para
validar partidas en servidor.
