# Hoja de ruta — smash-B

Documento vivo para seguir **qué hemos hecho y qué falta** de cara a convertir
el juego (hoy 100% cliente) en algo con **puntos, gachas, rankings y modo
online**, con un objetivo acotado:

> **Objetivo del proyecto:** portafolio + jugar con amigos. **Sin** monetización
> con dinero real, **sin** pasarela de pagos y **sin** requisitos legales de
> gachas. Infraestructura ligera y, a ser posible, gratuita.

Cómo usar este archivo: marca las casillas `[ ]` → `[x]` según avances, y añade
notas/fechas en cada fase. Las fases están ordenadas de menos a más difícil.

---

## Principios que guían todo esto

1. **Nada que venga del cliente es de fiar.** Toda decisión que afecte a puntos,
   gachas o ranking debe tomarse en el **servidor**. El cliente solo muestra.
2. **El determinismo es nuestro mejor activo.** La simulación ya corre a paso
   fijo 60 Hz y es determinista (mismo input → mismo resultado). Eso permite
   que el servidor **re-simule un replay** para validar partidas, y es el
   requisito previo del netcode por rollback. Hay que **cuidarlo y no romperlo**.
3. **Secretos fuera del repo.** Claves, tokens y cadenas de conexión van en
   variables de entorno del servidor, nunca en el código (aunque el repo sea
   público).
4. **Avanzar por fases.** No intentar puntos + gachas + ranking + online a la
   vez. Cada fase deja algo jugable y enseñable.

---

## Estado actual (punto de partida)

- [x] Juego de peleas 2D jugable en navegador (TypeScript + Vite + Three.js).
- [x] Simulación determinista a **timestep fijo 60 Hz** con render interpolado.
- [x] Física (AABB, plataformas sólidas y one-way, wall jump), combate (ligeros
      direccionales, fuertes cargables), furia.
- [x] 2–4 jugadores, CPU con dificultad **por slot**, posibilidad de deshabilitar
      cualquier slot (incluido P1).
- [x] Selección de personaje y escenario con fichas (clic-coger / clic-soltar).
- [x] 3 escenarios con geometría y tema propios + escenario de entrenamiento.
- [x] Sistema de **replays** (grabación de inputs empaquetados, reproducción
      determinista) — base clave para validar partidas en el futuro.
- [x] Tutorial, menú con fondo de replays, cámara cinemática.
- [x] Repo en GitHub.

---

## Fase 0 — Dejar el repo presentable (sin backend)

Barato, rápido y mejora mucho el valor de portafolio. No toca arquitectura.

- [ ] Actualizar `README.md` (hoy dice "Canvas 2D"; en realidad es **Three.js**).
- [ ] Añadir al README: capturas o GIF del juego, lista de features, créditos.
- [ ] Reforzar `.gitignore` para futuros secretos: añadir `.env`, `.env.*`,
      `*.pem`, `*.key`.
- [ ] Añadir una licencia (p. ej. MIT) si quieres que sea claramente de código
      abierto.
- [ ] Desplegar el cliente como **web estática** para poder enseñarlo con un
      enlace (GitHub Pages, Netlify o Vercel; cualquiera sirve, es `dist/`).
- [ ] (Opcional) Pequeña página/landing con el enlace jugable.

**Entregable:** un repo que se entiende solo y un enlace donde probar el juego.

---

## Fase 1 — Preparar el terreno técnico (refactor, aún sin servidor)

El paso que hace viable todo lo demás. El objetivo es poder **ejecutar la misma
simulación en el navegador y en un servidor Node**.

- [ ] Extraer el **motor puro** a un módulo compartido sin dependencias de
      navegador ni de Three.js: `src/game`, `src/physics`, `src/combat`,
      `src/entities`, `src/core` (tipos/input) y los datos de `config.ts`.
  - [x] Verificar que ese módulo **no importa nada de `render/` ni del DOM**.
        (Confirmado: `src/engine/` no importa de `debug/`, `ui/` ni `render/`,
        y no usa APIs de navegador en código ejecutable.)
  - [ ] Que compile y corra en Node (una prueba: simular un replay por consola
        y comprobar el resultado).
- [x] Añadir **tests de determinismo**: dado un replay (semilla + inputs), el
      resultado final es siempre el mismo. — Hecho con **Vitest**
      (`tests/determinism.test.ts`): reproduce `menu1/2/3.json` dos veces y
      compara el estado final de los combatientes.
- [x] Versionar el **formato de simulación**: `ENGINE_VERSION` en
      `engine/config.ts` (se sube a mano al cambiar física/balance). Cada replay
      guarda `engineVersion`; al reproducir, si no coincide con la actual, la
      pantalla de replay muestra un aviso ("puede no reproducirse igual").

**Entregable:** un paquete `engine` reutilizable en cliente y servidor, con una
prueba que confirma que una partida se reproduce idéntica.

> Nota: si cualquier cambio futuro de balance rompe el determinismo de replays
> antiguos, hay que subir la versión del motor y aceptar que los replays viejos
> son "solo para ver", no para validar.

### Auditoría de dependencias de navegador (hecha)

Antes de mover código, se auditó qué ficheros de la zona de simulación tocan el
navegador o azar/tiempo no determinista. **La lógica de simulación en sí está
limpia**; el acoplamiento es por **imports a nivel de módulo**. Resumen:

**Núcleo de simulación — limpio (no toca navegador, no usa azar sin semilla):**
- `src/physics/*`, `src/combat/*`, `src/entities/player.ts`,
  `src/game/world.ts`, `src/game/cpuBrain.ts`, `src/game/characters.ts`,
  `src/game/stages.ts`, `config.ts`.
- El azar va siempre por `core/rng.ts` (PRNG con semilla). `randomSeed()` usa
  `Math.random` pero **solo al iniciar una grabación**, nunca durante la
  simulación de un replay. ✅

**Acoplamientos a aislar (import de módulo que arrastra el navegador):**
- `core/input.ts` importa `core/bindings.ts`, y `bindings.ts` lee
  **`localStorage`** al cargarse (`loadBindings()`). Como `world.ts`,
  `cpuBrain.ts`, `player.ts` y `replay.ts` importan `input.ts`, **todo el motor
  arrastra `localStorage` solo por importar tipos de input**. → Ese warning de
  `localStorage` en los tests viene de aquí. **Plan:** separar el *tipo*
  `InputState` + `createInputState` (puros, van al engine) de `KeyboardInput` +
  `bindings`/`localStorage` (quedan en la capa de cliente).
- `game/world.ts` importa `debug/debugState.ts`. Es inofensivo (solo un objeto
  de flags; `debugState` solo importa `POV` de config), pero conceptualmente el
  motor no debería depender del estado de depuración de la UI. **Plan:** pasar
  lo que necesite como parámetro, o mover el flag relevante a config.

**Fuera del motor (se quedan en la capa de cliente, no estorban):**
- `game/loop.ts`: `performance.now`, `requestAnimationFrame`, `KeyboardInput`,
  Renderer/Camera. Es el bucle del navegador, no simulación.
- `game/replay.ts`: `ReplayRecorder`/`ReplayPlayer` + `unpack` son puros y van
  al engine; `downloadReplay`/`loadReplayFile` usan `document`/`Blob`/`File`
  (cliente) → separarlos en un helper de cliente.
- `game/replayStore.ts`: `localStorage` + `Date.now`/`Math.random` para ids.
  Es persistencia de cliente, no simulación → se queda fuera del engine.

**Conclusión:** la extracción del engine es viable y de bajo riesgo. El único
corte real a hacer antes de mover nada es **partir `core/input.ts`** (tipos
puros vs lector de teclado) para cortar la cadena a `localStorage`.

---

## Fase 2 — Backend mínimo + cuentas

Sin cuentas no hay a quién asignarle puntos ni inventario. Mantenerlo simple.

- [ ] Elegir y montar un **servidor** (Node + TypeScript, para compartir el
      motor). Empezar en local.
- [ ] Elegir una **base de datos** (algo sencillo y con capa gratuita).
- [ ] **Login** con un proveedor externo (p. ej. Google o Discord) para no
      gestionar contraseñas nosotros. Para "amigos", Discord encaja muy bien.
- [ ] Modelo de datos inicial: `usuario` (id, nombre, avatar, fecha alta).
- [ ] Config por **variables de entorno** (`.env` local, secretos en el hosting).
- [ ] El cliente guarda la sesión y sabe "quién soy".
- [ ] Desplegar el backend en un hosting con capa gratuita.

**Entregable:** puedes iniciar sesión, y el juego sabe quién eres.

---

## Fase 3 — Puntos y ranking (validados en servidor)

Aquí entra en juego el determinismo. Empezar por lo fácil de validar.

- [ ] Al acabar una partida, el cliente **envía el replay** (semilla + inputs +
      config) al servidor. No envía "he ganado": envía la partida.
- [ ] El servidor **re-simula** el replay con el motor compartido y obtiene el
      resultado real. Si el cliente mintió, el servidor lo ignora.
- [ ] Empezar por partidas **contra la CPU** (más fáciles de validar: no hay
      otro humano) y luego partidas locales.
- [ ] El servidor calcula y guarda los **puntos** del usuario.
- [ ] Tabla de **ranking** (ordenar por puntos). El cliente solo la lee.
- [ ] Pantalla de ranking en el juego.
- [ ] Protección básica anti-abuso: límites de envío, rechazar replays
      imposibles o demasiado largos, etc.

**Entregable:** jugar da puntos verificados y hay una clasificación real.

> Límite honesto: la validación por re-simulación es sólida contra "inventar el
> resultado", pero un replay puede ser de una partida real jugada de forma
> aburrida para farmear puntos. Para portafolio/amigos es más que suficiente;
> no hace falta anticheat avanzado.

---

## Fase 4 — Gachas

Toda la aleatoriedad y el premio ocurren en el servidor.

- [ ] Definir el **catálogo** de objetos (skins, personajes, cosméticos) y sus
      **probabilidades**, guardados en el servidor.
- [ ] Moneda del juego (ganada jugando; **no** dinero real).
- [ ] Endpoint de **tirada**: el servidor genera el azar, decide el premio, lo
      añade al inventario del usuario y descuenta la moneda — todo atómico.
- [ ] **Inventario** por usuario en la base de datos.
- [ ] El cliente solo pide "tira" y **muestra la animación** del resultado que
      devuelve el servidor.
- [ ] Pantalla de gacha + inventario + equipar cosméticos.

**Entregable:** tiradas que dan objetos reales a tu cuenta, imposibles de
falsear desde el cliente.

> Como no hay dinero real, **no aplican** los requisitos legales de gachas
> (mostrar probabilidades por ley, restricciones de edad, etc.). Aun así, mostrar
> las probabilidades es buena práctica y queda profesional.

---

## Fase 5 — Modo online

Lo más difícil; por eso va al final. Plantearlo en dos escalones.

### 5a — Online asíncrono (recomendado primero)
- [ ] Retar a un amigo: se juega contra su "fantasma"/replay o contra su CPU, y
      el servidor valida el resultado. No requiere sincronización en vivo.
- [ ] Reutiliza casi todo de las fases 2–3.

### 5b — PvP en tiempo real (rollback netcode)
- [ ] Transporte de baja latencia entre clientes (WebSockets/WebRTC).
- [ ] Implementar **rollback netcode**: intercambiar inputs, predecir, y
      corregir re-simulando cuando llega el input real. Requiere el motor
      determinista (ya lo tenemos) y guardar/restaurar estado del mundo.
- [ ] Emparejamiento simple (salas por código para jugar con amigos).
- [ ] Manejo de desconexiones y desincronizaciones.

**Entregable 5a:** desafíos online asíncronos con resultado verificado.
**Entregable 5b:** combate 1v1 en vivo entre dos máquinas.

> El rollback es un mini-proyecto en sí mismo. Para "jugar con amigos" puede ser
> suficiente con 5a, o con un PvP más simple (input lock-step) asumiendo algo de
> latencia. Decidir según cuánto quieras invertir.

---

## Orden sugerido y por qué

1. **Fase 0** (repo presentable) — valor inmediato de portafolio, riesgo cero.
2. **Fase 1** (motor compartido + tests) — habilita todo lo demás; sin esto, las
   fases 3 y 5 no se sostienen.
3. **Fase 2** (cuentas) — base para puntos/gachas/online.
4. **Fase 3** (puntos + ranking) — primer "sistema de progresión" real y
   enseñable.
5. **Fase 4** (gachas) — contenido y engagement.
6. **Fase 5** (online) — la guinda; empezar por el asíncrono.

Si tu prioridad fuese "jugar con un amigo ya", se podría adelantar un PvP
sencillo, pero a costa de más complejidad temprana.

---

## Trabajo visual: cuándo y cómo sin romper el determinismo

Las mejoras gráficas se pueden hacer **en cualquier momento** y **sin miedo**,
porque tocan la capa de **presentación**, no la de **simulación**:

- **Presentación** (libre de tocar): `src/render/` (Three.js, cámara, fondos,
  texturas) y `src/ui/` (menús, HUD, CSS). Puede usar azar, tiempo real y todo
  lo que quiera.
- **Simulación** (intocable desde lo visual): `src/game/`, `src/physics/`,
  `src/combat/`, `src/entities/` y los valores de `config.ts`.

Regla de oro: **lo visual nunca debe influir en la simulación.**

- No modificar física/combate en `config.ts` ni la lógica de `game`/`physics`
  "para que se vea mejor".
- Nada de `Math.random()` sin semilla ni `Date.now`/`performance.now` **dentro**
  de la simulación (sí fuera, en efectos visuales).
- Un efecto puede **leer** el estado del mundo, nunca **escribirlo**.

Orden recomendado (no obligatorio): hacer mejoras visuales **idealmente tras la
Fase 1**, porque esa fase separa definitivamente render y motor y deja tests de
determinismo como red de seguridad. Si se meten **assets pesados** (modelos,
texturas, audio), planificar dónde viven y su carga (afecta al tamaño del bundle
y al despliegue), pero eso es optimización, no un bloqueo.

---

## Riesgos y notas a vigilar

- **Romper el determinismo** sin querer (usar `Math.random` sin semilla, fechas,
  orden de iteración no estable...). Los tests de la Fase 1 son la red de
  seguridad.
- **Secretos en el repo.** Revisar antes de cada commit al añadir backend.
- **Alcance.** Es fácil que "online" se coma meses. Mantener cada fase pequeña y
  jugable.
- **Costes.** Con capas gratuitas debería bastar para amigos; vigilar límites si
  algún día crece.

---

## Registro de decisiones (ir apuntando aquí)

| Fecha | Decisión | Motivo |
| --- | --- | --- |
| 2026-10 | Objetivo = portafolio + amigos, sin dinero real | Acota alcance: sin pagos ni requisitos legales de gachas |
| 2026-10 | Licencia MIT | Código abierto simple para portafolio |
| 2026-10 | Despliegue en GitHub Pages vía GitHub Actions | Gratis y el repo ya está en GitHub |
| _(pendiente)_ | Backend / base de datos / auth | Se decide al llegar a la Fase 2 |

## Bitácora de avances (ir apuntando aquí)

| Fecha | Qué se hizo | Fase |
| --- | --- | --- |
| 2026-10 | README actualizado (Three.js, features), `.gitignore` de secretos | Fase 0 |
| 2026-10 | ROADMAP.md creado + nota de trabajo visual | Fase 0 |
| 2026-10 | Licencia MIT y workflow de GitHub Pages | Fase 0 |
| 2026-10 | Pages activado + despliegue en verde + enlace jugable + CI Node 22 | Fase 0 |
| 2026-10 | Vitest + test de determinismo (menu1/2/3) | Fase 1 |
| 2026-10 | Auditoría de dependencias de navegador del motor | Fase 1 |
| 2026-10 | core/input.ts partido: inputState.ts (puro) vs KeyboardInput; motor sin localStorage | Fase 1 |
| 2026-10 | Motor movido a src/engine/ (core/physics/combat/entities/game + config); cliente en render/ui/core-input/loop | Fase 1 |
| 2026-10 | downloadReplay/loadReplayFile movidos a ui/replayFile.ts (engine sin DOM) | Fase 1 |
| 2026-10 | Opciones de dummy movidas a engine/game/trainingOptions.ts; engine ya no importa debug/ui/render | Fase 1 |
| 2026-10 | ENGINE_VERSION: replays etiquetados con la versión del motor + aviso en el reproductor si no coincide (replay v6) | Fase 1 |
| _(pendiente)_ | Capturas/GIF en README | Fase 0 |
