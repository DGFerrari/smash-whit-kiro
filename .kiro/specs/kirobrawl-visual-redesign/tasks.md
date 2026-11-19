# Implementation Plan: KiroBrawl Visual Redesign

## Overview

Implementación incremental en TypeScript (Vite + Three.js, DOM imperativo) siguiendo las cuatro fases del diseño: (1) marca, sistema de diseño, carga, preferencias y pantallas; (2) grafo retenido, VFX y postprocesado; (3) escenarios; (4) personajes. La lógica se aísla en módulos puros probados con `vitest` + `fast-check`; Three.js queda en adaptadores finos. `src/engine/**` no se modifica en ninguna tarea.

## Tasks

- [x] 1. Configuración base del cliente
  - [x] 1.1 Añadir infraestructura de pruebas al cliente
    - Añadir a `package.json` raíz `vitest`, `fast-check` (`3.23.2`) y `jsdom` con versiones exactas (sin `^`) y el script `"test": "vitest --run"`
    - Crear `vitest.config.ts` con entorno `node` por defecto y `jsdom` por archivo (`// @vitest-environment jsdom`)
    - _Requirements: 13.2_
  - [x] 1.2 Autoalojar fuentes y renombrar el título
    - Añadir `public/fonts/` con Russo One y Rajdhani (500/600/700) en woff2 (latín + latín extendido) y `OFL.txt`
    - Crear `src/ui/design/fonts.css` con `@font-face` y `font-display: swap`; preload en `index.html` y `<title>KiroBrawl</title>`
    - _Requirements: 1.1, 2.3, 2.4, 14.4_

- [x] 2. Sistema de diseño y navegación
  - [x] 2.1 Crear `src/ui/design/tokens.css`
    - Declarar paleta, neutros, tipografía (`--font-display`, `--font-text`, `--fs-*`), espaciado, radios, sombras, brillos y duraciones/easings según el diseño; único punto de declaración
    - Regla `[data-reduced-motion]` en `<html>` para anular escalas en foco/presionado
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.8, 9.8_
  - [ ]* 2.2 Escribir pruebas unitarias de tokens
    - Paleta con saturación HSL ≥ 70 % y luminosidad 35–70 %; contraste de pares declarados (4.5:1 / 3:1, anillo de foco ≥ 3:1)
    - Lint: ninguna declaración `--color-|--font-|--fs-|--space-|--radius-|--shadow-|--glow-|--dur-` fuera de `tokens.css` y sin literales `#hex`/`rgb(` en estilos de Pantalla_UI
    - _Requirements: 2.1, 2.2, 2.7, 4.4, 4.5_
  - [x] 2.3 Implementar `src/ui/design/components.ts`
    - `button`, `panel`, `card`, `tabs`, `toggle` (`role="switch"`), `slider`, `levelSelect`, `dialog`, `setDisabled`
    - Estados reposo/foco/presionado/deshabilitado con `aria-disabled`; guarda de activación que ignora clic, Enter/Espacio y botón A si está deshabilitado
    - _Requirements: 2.5, 2.6, 2.7_
  - [x] 2.4 Implementar `src/ui/design/transitions.ts`
    - Una sola transición activa; `finish()` de la anterior antes de iniciar la nueva; entrada `--dur-base`, salida `--dur-fast` con Web Animations API
    - Con Movimiento_Reducido, solo fundido de opacidad; al terminar avisa al Navegador_Menús para enfocar
    - _Requirements: 2.8, 2.9, 9.8_
  - [ ]* 2.5 Escribir prueba de propiedad para componentes deshabilitados y transiciones
    - **Property 29: Componentes deshabilitados y transiciones**
    - **Validates: Requirements 2.6, 2.9**
  - [x] 2.6 Implementar `src/ui/nav/menuNavigator.ts`
    - `mount(root, { dialog, mandatory, returnFocus })`: orden de foco por fila/columna excluyendo ocultos y deshabilitados, Tab/Mayús+Tab/flechas, Enter/Espacio
    - Trampa de foco cíclica en diálogos, foco inicial ≤ 100 ms, retorno de foco al opener o al primer control habilitado, Escape/B cierra diálogos no obligatorios
    - `pollGamepad(now)`: cruceta/stick, A activa, B cancela, repetición con retardo 400 ms y cada 150 ms
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 4.8, 4.9, 4.10_
  - [ ]* 2.7 Escribir prueba de propiedad para orden de foco y trampa de diálogo
    - **Property 30: Orden de foco y trampa de diálogo**
    - **Validates: Requirements 4.3, 4.6**
  - [ ]* 2.8 Escribir prueba de propiedad para la repetición de foco del gamepad
    - **Property 31: Repetición de foco del gamepad**
    - **Validates: Requirements 4.2**
  - [ ]* 2.9 Escribir pruebas unitarias de diálogos
    - Retorno de foco, opener eliminado o deshabilitado, Escape/B en diálogo obligatorio y no obligatorio
    - _Requirements: 4.7, 4.8, 4.10_

- [x] 3. Marca y contenido
  - [x] 3.1 Crear `src/content/lore.ts`
    - Tablas de personajes y escenarios del diseño; `characterLore(id)` y `stageLore(id)` con respaldo al propio id
    - _Requirements: 1.3, 1.4, 1.5, 1.7, 1.8_
  - [ ]* 3.2 Escribir pruebas de lore
    - **Property 28: Resolución de nombres visibles**
    - **Validates: Requirements 1.7, 1.8**
    - Unitarias: longitudes (nombre ≤ 20/24, título ≤ 40, lore ≤ 300, descripción ≤ 200) y cobertura de todos los ids (R1.3, R1.4)
  - [x] 3.3 Implementar `src/ui/brand/logo.ts` y `src/ui/brand/portraits.ts`
    - Logo SVG procedimental con `role="img"` y `aria-label="KiroBrawl"`; respaldo `<h1>` "KiroBrawl" con `--font-display`
    - Retratos de personaje y vistas previas de escenario en SVG por semilla; marcador con nombre visible si falla la vista previa
    - _Requirements: 1.2, 1.9, 3.3, 3.7_
  - [ ]* 3.4 Escribir pruebas unitarias de logo y vistas previas
    - Respaldo de texto del logo en la misma posición; marcador de escenario seleccionable
    - _Requirements: 1.9, 3.7_

- [x] 4. Carga de assets
  - [x] 4.1 Implementar `src/assets/progress.ts` (puro)
    - Acumulador de `AssetProgress` y cálculo de `LoadProgress`: bytes o recuento, tope 99 hasta terminar, `max` con el anterior, `assetsTotal = 0 ⇒ 100`, fallidos/caché cuentan como procesados, timeout ⇒ 100
    - Formateo `"12,4 MB / 30,0 MB"` y `"N recursos restantes"`
    - _Requirements: 15.3, 15.4, 15.5, 15.7, 15.8, 15.9, 15.10_
  - [ ]* 4.2 Escribir prueba de propiedad de invariantes del porcentaje de carga
    - **Property 8: Invariantes del porcentaje de carga**
    - **Validates: Requirements 15.3, 15.4, 15.5, 15.7, 15.8, 15.9, 15.10, 12.5**
  - [x] 4.3 Implementar `src/assets/assetLoader.ts` y `src/assets/manifest.ts`
    - `fetch` + `ReadableStream` con `Content-Length` o `sizeHint`; Caché_Assets en memoria; motivos `network`/`notFound`/`parse`/`timeout`; tiempo límite global de 60 s; `onProgress` cada 100 ms; `done` nunca rechaza
    - Manifiesto por grupos (`boot`, personaje, escenario) solo con URLs relativas a `import.meta.env.BASE_URL`
    - _Requirements: 12.2, 14.4, 15.1, 15.2, 15.6, 15.9, 15.10, 15.12_
  - [ ]* 4.4 Escribir prueba de propiedad de caché sin red
    - **Property 9: Caché de assets sin peticiones de red**
    - **Validates: Requirements 15.12**
  - [ ]* 4.5 Escribir pruebas unitarias del AssetLoader
    - `fetch` simulado con streams troceados, sin `Content-Length`, 404, error de red, timeout con fake timers; manifiesto sin dominios externos
    - _Requirements: 14.4, 15.9, 15.10_
  - [x] 4.6 Implementar `src/ui/loadingScreen.ts`
    - Logo, barra, porcentaje, MB y recursos restantes, consejo/lore rotatorio (≤ 200 caracteres) con componentes y tokens; refresco ≤ 250 ms
    - Variante previa a partida con retratos y vista previa del escenario; con todo en caché, 100 % y arranque ≤ 1 s
    - _Requirements: 1.1, 12.5, 12.6, 15.1, 15.2, 15.5, 15.6, 15.11, 15.13_

- [x] 5. Preferencias visuales y calidad (módulos puros)
  - [x] 5.1 Implementar `src/render/quality/visualPrefs.ts`
    - Tipos `Level`, `RenderScale`, `GraphicControls`, `VisualPreferences`, tabla `PRESETS`
    - `parseVisualPrefs` (validación estricta; `preset` incoherente se recalcula), `serializeVisualPrefs`, `loadVisualPrefs`, `saveVisualPrefs` con clave `kirobrawl.visualPrefs.v1`, debounce 250 ms y `try/catch`
    - _Requirements: 6.1, 6.4, 6.8, 6.9, 6.10, 6.13_
  - [ ]* 5.2 Escribir prueba de propiedad de ida y vuelta
    - **Property 1: Ida y vuelta de Preferencias_Visuales**
    - **Validates: Requirements 6.9, 6.8**
  - [ ]* 5.3 Escribir prueba de propiedad de preferencias inválidas
    - **Property 2: Preferencias inválidas producen un estado válido por defecto**
    - **Validates: Requirements 6.10**
  - [ ]* 5.4 Escribir prueba de propiedad de monotonía de presets
    - **Property 5: Monotonía de presets**
    - **Validates: Requirements 6.1**
  - [x] 5.5 Implementar `src/render/quality/qualityManager.ts`
    - `detectDefaultPreset`, `derivePresetLabel`, `selectPreset`, `setControl`, `setReducedMotion`, `subscribe` síncrono
    - `ResolvedQuality` con recortes de Movimiento_Reducido; valor inicial de Movimiento_Reducido desde preferencias guardadas o `prefers-reduced-motion`; `data-reduced-motion` en `<html>`; aviso no bloqueante una vez por sesión si falla el almacenamiento
    - _Requirements: 6.2, 6.3, 6.5, 6.6, 6.7, 6.12, 6.13, 7.7, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [ ]* 5.6 Escribir prueba de propiedad del preset por defecto
    - **Property 3: Preset por defecto según hardware**
    - **Validates: Requirements 6.2**
  - [ ]* 5.7 Escribir prueba de propiedad de derivación de preset
    - **Property 4: Derivación de preset y personalizado**
    - **Validates: Requirements 6.5, 6.6, 6.7, 6.12**
  - [ ]* 5.8 Escribir prueba de propiedad de Movimiento_Reducido resuelto
    - **Property 6: Movimiento_Reducido en la calidad resuelta**
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.6, 7.7**
  - [ ]* 5.9 Escribir pruebas unitarias de persistencia
    - Debounce ≤ 1 s, `localStorage` ausente o `setItem` que lanza, aviso una sola vez
    - _Requirements: 6.8, 6.13_

- [x] 6. Checkpoint - Fundamentos de la fase 1
  - Asegurar que build y tests pasan, preguntar al usuario si surgen dudas.

- [x] 7. Rediseño de pantallas (fase 1)
  - [x] 7.1 Migrar estilos base, menú principal y créditos
    - Eliminar literales de color/fuente de `src/style.css`; rejilla de 12 columnas y `overflow-y: auto` por debajo de 1280×720
    - Menú principal con logo y botones (incluido "Créditos"); `src/ui/creditsScreen.ts` desplazable con teclado/gamepad y `src/assets/credits.json` con las entradas de las fuentes
    - _Requirements: 1.1, 1.2, 3.1, 3.5, 3.8, 14.1, 14.3, 14.5, 14.7_
  - [ ]* 7.2 Escribir pruebas unitarias de `credits.json`
    - Cinco campos no vacíos, licencias permitidas, `attribution` en CC-BY, cada archivo de `public/fonts`, `public/models`, `public/textures` cubierto exactamente una vez
    - _Requirements: 14.1, 14.2, 14.5, 14.6_
  - [x] 7.3 Rediseñar selección de personaje y de escenario
    - Tarjetas con retrato y nombre visible; panel con nombre, título, lore y hueco de vista previa 3D (Modelo_Respaldo provisional) actualizado en el mismo frame
    - Rejilla 2×2 de escenarios con vista previa SVG, nombre visible, descripción y estado de foco
    - _Requirements: 1.7, 3.1, 3.2, 3.3, 3.6, 3.7_
  - [x] 7.4 Rediseñar el HUD
    - `src/ui/hudModel.ts` puro: paneles por jugador, texto del porcentaje, `t = clamp(d/150,0,1)`, sacudida 220 ms con reinicio, rotura de vida 400 ms, retrato atenuado con 0 vidas, relleno y estado de furia
    - `src/ui/percentHud.ts`: dibujo en canvas con tokens leídos vía `getComputedStyle`, interpolación OKLab, reparto en `n` columnas (máx. 360 px) en `resize`, pulso de color con Movimiento_Reducido
    - _Requirements: 1.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
  - [ ]* 7.5 Escribir prueba de propiedad del color de daño
    - **Property 10: Color de daño monótono y fijado en 150 %**
    - **Validates: Requirements 5.4**
  - [ ]* 7.6 Escribir prueba de propiedad de la sacudida
    - **Property 11: Sacudida del porcentaje con reinicio**
    - **Validates: Requirements 5.2, 5.3**
  - [ ]* 7.7 Escribir prueba de propiedad del modelo de HUD
    - **Property 12: Modelo de HUD por jugador**
    - **Validates: Requirements 5.1, 5.6, 5.7**
  - [x] 7.8 Rediseñar pausa, opciones y reasignación de teclas
    - Pausa como diálogo obligatorio (Escape/B = Continuar)
    - Opciones con `tabs` Gráficos (preset + etiqueta "Personalizado", un `levelSelect` por Control_Gráfico, `slider` 50–100 paso 5), Accesibilidad (`toggle` Movimiento_Reducido), Controles y Audio, conectadas a `qualityManager`
    - Reasignación con diálogo "Pulsa una tecla" y misma persistencia que antes
    - _Requirements: 3.1, 3.4, 6.3, 6.4, 6.5, 6.6, 6.7, 6.12, 9.1, 9.5_
  - [x] 7.9 Rediseñar gacha y ranking
    - Panel de moneda, tiradas x1/x10 y revelado de tarjetas; ranking con `tabs` y fila propia resaltada; mismas peticiones al servidor
    - _Requirements: 3.1, 3.4, 13.4_
  - [x] 7.10 Rediseñar pantallas online
    - Crear sala, unirse por código, fichas de jugadores y estado de conexión; mensajes de red sin cambios
    - _Requirements: 3.1, 3.4, 13.4_
  - [x] 7.11 Rediseñar post-partida y repeticiones
    - Post-partida con ganador, estadísticas y botones Revancha / Guardar repetición / Menú
    - Lista de repeticiones y reproductor con nombres visibles resueltos desde los ids guardados
    - _Requirements: 1.5, 1.6, 1.7, 3.1, 3.4_
  - [x] 7.12 Rediseñar tutorial y diálogos genéricos
    - Tutorial con paso actual, progreso y Anterior/Siguiente; migrar todos los diálogos a `dialog()` con velo y trampa de foco
    - _Requirements: 3.1, 3.4, 4.6, 4.7, 4.8, 4.10_
  - [x] 7.13 Integrar arranque y renombrar a KiroBrawl
    - Arranque: Pantalla_Carga del grupo `boot` → menú principal; todas las pantallas montadas con `menuNavigator` y `transitions`
    - Sustituir el nombre anterior del juego (smash-B) por KiroBrawl en `index.html` y `README.md` sin tocar ids de personajes, escenarios ni claves persistidas
    - _Requirements: 1.1, 1.5, 2.8, 4.9, 15.1_
  - [ ]* 7.14 Escribir pruebas de integración de regresión de payloads
    - Comparar mensajes online y peticiones al servidor con snapshots previos al rediseño
    - _Requirements: 3.4, 13.4_

- [x] 8. Checkpoint - Fin de la fase 1
  - Asegurar que build y tests pasan, preguntar al usuario si surgen dudas.

- [ ] 9. Grafo de escena retenido y aislamiento (fase 2)
  - [x] 9.1 Implementar `src/render/visualRng.ts`
    - `createVisualRng(seed)` con mulberry32, independiente del RNG del `World`
    - _Requirements: 13.5_
  - [ ]* 9.2 Escribir prueba de propiedad de independencia del RNG visual
    - **Property 14: Independencia del RNG visual**
    - **Validates: Requirements 13.5**
  - [x] 9.3 Refactorizar `src/render/renderer.ts` a grafo retenido
    - Sustituir `rebuildDynamic`/`clearGroup` por objetos persistentes por jugador y plataforma; `render(snapshot, alpha, frameTimeMs)` con `ReadonlyDeep<SimSnapshot>` y `VisualFrame` interpolado
    - Rig de tres luces por personaje (principal, relleno menor, contorno), escala de render vía `setPixelRatio`, `subscribe` a `qualityManager`
    - `try/catch` alrededor del render (registro único y frame saltado) y `webglcontextlost`/`restored` sin detener la Simulación
    - _Requirements: 6.3, 6.11, 7.1, 13.1, 13.6, 13.7_
  - [ ]* 9.4 Escribir prueba de propiedad de invariancia de la simulación
    - **Property 13: Invariancia de la simulación ante la presentación**
    - **Validates: Requirements 13.1, 13.2, 13.7, 13.8, 7.8, 9.9, 10.6, 11.7, 12.7**
  - [ ]* 9.5 Escribir prueba de propiedad de tasa de fotogramas
    - **Property 15: Tasa de fotogramas no altera la simulación**
    - **Validates: Requirements 13.6**
  - [ ]* 9.6 Escribir pruebas de integración de repeticiones y contexto WebGL
    - Repeticiones de referencia previas al rediseño con ganador, vidas, daño y ticks idénticos; pérdida simulada de contexto
    - _Requirements: 13.3, 13.7_

- [ ] 10. Sistema_VFX (fase 2)
  - [x] 10.1 Implementar `src/render/vfx/eventDetector.ts`
    - Diff de snapshots: `hit`, `heavyHit`, `stun`, `charge`, `fury`, `ko` (uno por jugador golpeado y tick)
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 8.7_
  - [ ]* 10.2 Escribir prueba de propiedad de un par destello/onda por impacto
    - **Property 18: Un par destello/onda por impacto**
    - **Validates: Requirements 8.1, 8.9**
  - [x] 10.3 Implementar `src/render/vfx/particlePool.ts`
    - Buffer circular en arrays con capacidad física 1000; `spawn` expulsa las más antiguas; `setCapacity` con `{0, 200, 500, 1000}`; adaptador `InstancedMesh` aparte
    - _Requirements: 8.8, 8.9, 8.10_
  - [ ]* 10.4 Escribir prueba de propiedad del pool de partículas
    - **Property 16: Pool de partículas acotado con expulsión de las más antiguas**
    - **Validates: Requirements 8.8, 8.9, 8.10**
  - [x] 10.5 Implementar `impactFx`, `speedLines` y `cameraShake`
    - Funciones puras de intensidad con `k = clamp(kb / KB_MAX_HEAVY_FULL, 0, 1)` (duración `100 + 300k` ms, `8 + 24k` líneas), escala ligero 0,6 / pesado 1,0–1,6; shader de onda de choque; ruido de `visualRng`; factor del nivel de cada control
    - _Requirements: 8.1, 8.2, 8.3, 9.6_
  - [ ]* 10.6 Escribir prueba de propiedad de intensidad de impacto
    - **Property 19: Intensidad de impacto según tipo y knockback**
    - **Validates: Requirements 8.2, 8.3**
  - [x] 10.7 Implementar `trails`, `auras`, partículas de carga y `koFx`
    - Estela de 16 puntos con desvanecido 250 ms; aura fresnel con desvanecido 250 ms; emisión monótona en la proporción de carga y corte en el flanco de bajada; KO de 1,2 s en el borde con mayor exceso, orientado hacia el interior
    - _Requirements: 8.4, 8.5, 8.6, 8.7_
  - [ ]* 10.8 Escribir prueba de propiedad de partículas de carga
    - **Property 20: Partículas de carga monótonas**
    - **Validates: Requirements 8.5**
  - [ ]* 10.9 Escribir prueba de propiedad del borde de KO
    - **Property 21: Borde de KO**
    - **Validates: Requirements 8.7**
  - [x] 10.10 Implementar `src/render/vfx/flashLimiter.ts`
    - Ventana deslizante de 1 s, máximo 3 destellos > 25 % del viewport con Movimiento_Reducido
    - _Requirements: 9.7_
  - [ ]* 10.11 Escribir prueba de propiedad del limitador de destellos
    - **Property 17: Limitador de destellos a pantalla completa**
    - **Validates: Requirements 9.7**
  - [x] 10.12 Conectar el Sistema_VFX al renderer
    - Eventos → efectos en el primer frame tras el tick; capacidad del pool y recortes de Movimiento_Reducido desde `ResolvedQuality` (≤ 1 s), también en repeticiones
    - _Requirements: 8.1, 8.10, 9.5, 9.6, 9.7_

- [ ] 11. Postprocesado (fase 2)
  - [x] 11.1 Implementar `src/render/post/postPipeline.ts` e integrarlo
    - Nota: integrado en el renderer; falta marcar capas `far` del escenario para el DOF (fase 3)
    - Función pura `buildPassList(q)` y adaptador `EffectComposer`: bloom selectivo en capa `EMISSIVE`, DOF solo en capas `far`, `Lensflare` en luces intensas y en golpes pesados (0,4 s, omitido con Movimiento_Reducido), `OutputPass` ACES + sRGB; render directo si todo está desactivado
    - _Requirements: 6.3, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ]* 11.2 Escribir prueba de propiedad de pases de postprocesado
    - **Property 7: Pases de postprocesado según controles**
    - **Validates: Requirements 7.6**

- [ ] 12. Checkpoint - Fin de la fase 2
  - Asegurar que build y tests pasan, preguntar al usuario si surgen dudas.

- [ ] 13. Sistema_Escenarios (fase 3)
  - [x] 13.1 Implementar definiciones de escenario y `stageBuilder`
    - Nota: `stageDefs.ts` + `stageScene.ts` (cielo, capas lejanas en FAR_LAYER, props, luces intensas) y `platformLayout.ts`
    - `StageVisualDef` de los cuatro escenarios (fondo dominante, luz principal, luces intensas, capas, props) en `src/render/stages/`
    - Capas `foreground`/`combat`/`far`; plataformas generadas desde las cajas de colisión del motor (solo lectura), decoración solo por debajo y detrás
    - _Requirements: 10.1, 10.3, 10.4_
  - [ ]* 13.2 Escribir prueba de propiedad de alineación de plataformas
    - **Property 23: Alineación de plataformas**
    - **Validates: Requirements 10.3**
  - [x] 13.3 Implementar `animatedProps` y `applyQuality`
    - `pose(t)` periódica desde `performance.now()`; `N = 0/2/4/6` por nivel con conjuntos acumulativos; Movimiento_Reducido velocidad × 0,4, amplitud × 0,5, sin parpadeos; `applyQuality` sin reconstruir plataformas
    - _Requirements: 10.2, 10.5, 10.6, 10.7, 10.9_
  - [ ]* 13.4 Escribir prueba de propiedad de animaciones de fondo
    - **Property 22: Animaciones de fondo en bucle y por nivel**
    - **Validates: Requirements 10.2, 10.5, 10.9**
  - [x] 13.5 Implementar `proceduralFallback` e integrar escenarios en el renderer
    - Degradado del color dominante + siluetas con `visualRng` de semilla fija; plataformas con borde emisivo
    - Absorber `src/render/background.ts`; luces intensas al pipeline de destellos; capas `far` al DOF; carga de assets del escenario en la Pantalla_Carga previa a partida
    - _Requirements: 7.4, 7.5, 10.1, 10.8, 15.2_
  - [ ]* 13.6 Escribir pruebas unitarias del respaldo procedimental
    - Fallo de textura, modelo o capa: plataformas visibles y partida sin interrupción
    - _Requirements: 10.8_

- [ ] 14. Checkpoint - Fin de la fase 3
  - Asegurar que build y tests pasan, preguntar al usuario si surgen dudas.

- [ ] 15. Personajes 3D (fase 4)
  - [x] 15.1 Implementar `src/render/characters/fitToHitbox.ts`
    - Escala no uniforme acotada o uniforme según la proporción, tolerancia ±15 %, base alineada al borde inferior y centro X
    - _Requirements: 11.2, 12.1_
  - [ ]* 15.2 Escribir prueba de propiedad de ajuste a la caja de colisión
    - **Property 24: Ajuste del modelo a la caja de colisión**
    - **Validates: Requirements 11.2, 12.1**
  - [x] 15.3 Implementar `src/render/characters/animator.ts`
    - `selectAnimState` puro con la prioridad de R11.8; controlador de `AnimationMixer` con `crossFadeTo` de 120 ms, `reset().play()` sin fundido para ligero/pesado/esquiva, giro de yaw en 80 ms, clips sustitutos y `celebrate` forzado
    - _Requirements: 11.3, 11.4, 11.7, 11.8, 11.9, 11.10_
  - [ ]* 15.4 Escribir prueba de propiedad de prioridad de animaciones
    - **Property 25: Prioridad de estados de animación**
    - **Validates: Requirements 11.3, 11.8**
  - [ ]* 15.5 Escribir prueba de propiedad de transiciones y giro
    - **Property 26: Transiciones y giro del modelo**
    - **Validates: Requirements 11.4, 11.10**
  - [x] 15.6 Implementar `src/render/characters/materials.ts`
    - Clasificación metal/cuero/tela/pelo por `materialMap` o nombre; parámetros del diseño; chunk `onBeforeCompile` con rim fresnel y `uHitTint`
    - _Requirements: 7.1, 7.2, 11.5_
  - [x] 15.7 Implementar `src/render/characters/fallbackModel.ts`
    - Siluetas procedimentales (lancer, brawler, mage, ranger, sack) con toon de 3 bandas, rim y `dominantColor`; escudo, carga, orientación y destello de golpe con los tiempos del snapshot
    - _Requirements: 7.2, 11.6, 12.1, 12.4_
  - [ ] 15.8 Implementar `src/render/characters/modelLoader.ts`
    - `GLTFLoader` + `MeshoptDecoder` y `@pixiv/three-vrm` con versión exacta; `parse` del `ArrayBuffer` del AssetLoader; marca `timedOut` a los 60 s ignorando llegadas tardías
    - Un `console.error` por personaje y partida con id, ruta y motivo; texturas ausentes sustituidas por el color identificativo con error por ruta
    - _Requirements: 11.1, 12.1, 12.2, 12.3, 12.8_
  - [ ]* 15.9 Escribir prueba de propiedad de error único por personaje
    - **Property 27: Un único error por personaje**
    - **Validates: Requirements 12.3**
  - [ ]* 15.10 Escribir pruebas unitarias de respaldo de modelos
    - Modelo_Respaldo ante red, 404, parse y timeout; textura ausente
    - _Requirements: 12.1, 12.2, 12.8_
  - [ ] 15.11 Incorporar assets de personajes y créditos
    - `CharacterVisualDef` de los cinco personajes con color dominante exclusivo para los cuatro seleccionables
    - Añadir modelos CC0/redistribuibles optimizados con `gltf-transform` (≤ 15k triángulos, ≤ 3 MB) en `public/models/characters/{id}.glb|.vrm`, entradas en `credits.json` y grupos del manifiesto; si no hay modelo válido, el personaje queda con Modelo_Respaldo
    - _Requirements: 11.1, 11.6, 14.1, 14.2, 14.5, 14.6_
  - [x] 15.12 Integrar personajes en renderer y pantallas
    - Nota: modelo procedimental en combate, vista previa 3D en selección y celebración en post-partida
    - Modelos y animador en el renderer; tinte de golpe; vista previa 3D en selección de personaje con respaldo a 60 s; celebración del ganador en post-partida; carga de modelos en la Pantalla_Carga previa a partida
    - _Requirements: 3.2, 3.6, 11.5, 11.9, 12.5, 12.6, 12.7, 15.2, 15.13_

- [ ] 16. Checkpoint final - Fin de la fase 4
  - Asegurar que build y tests pasan, preguntar al usuario si surgen dudas.

## Notes

- Las sub-tareas marcadas con `*` son opcionales (pruebas) y pueden omitirse para un MVP más rápido.
- Cada prueba de propiedad usa `fast-check` con `numRuns ≥ 100`, va en su propio archivo de test y lleva el comentario `// Feature: kirobrawl-visual-redesign, Property {n}: {texto}`.
- Los criterios de rendimiento (R6.11), layout en resoluciones concretas (R3.5, R3.8, R5.8) y accesibilidad completa requieren verificación manual fuera de estas tareas.
- `src/engine/**` no se modifica; toda la presentación lee snapshots de solo lectura.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "3.1", "4.1", "5.1", "9.1", "15.1"] },
    { "id": 1, "tasks": ["2.1", "3.2", "4.2", "4.3", "5.2", "5.3", "5.4", "5.5", "9.2", "15.2", "15.3"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.3", "4.4", "4.5", "5.6", "5.7", "5.8", "5.9", "15.4", "15.5"] },
    { "id": 3, "tasks": ["2.4", "2.6", "3.4"] },
    { "id": 4, "tasks": ["2.5", "2.7", "2.8", "2.9", "4.6"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 7, "tasks": ["7.5", "7.6", "7.7", "7.8", "7.9", "7.10"] },
    { "id": 8, "tasks": ["7.11", "7.12"] },
    { "id": 9, "tasks": ["7.13"] },
    { "id": 10, "tasks": ["7.14", "9.3"] },
    { "id": 11, "tasks": ["9.4", "9.5", "9.6", "10.1", "10.3", "10.10"] },
    { "id": 12, "tasks": ["10.2", "10.4", "10.5", "10.7", "10.11"] },
    { "id": 13, "tasks": ["10.6", "10.8", "10.9", "10.12"] },
    { "id": 14, "tasks": ["11.1"] },
    { "id": 15, "tasks": ["11.2", "13.1"] },
    { "id": 16, "tasks": ["13.2", "13.3"] },
    { "id": 17, "tasks": ["13.4", "13.5"] },
    { "id": 18, "tasks": ["13.6", "15.6", "15.7"] },
    { "id": 19, "tasks": ["15.8"] },
    { "id": 20, "tasks": ["15.9", "15.10", "15.11"] },
    { "id": 21, "tasks": ["15.12"] }
  ]
}
```
