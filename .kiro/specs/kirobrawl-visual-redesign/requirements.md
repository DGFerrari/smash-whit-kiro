# Requirements Document

## Introduction

Rediseño visual y de UI/UX completo del juego de lucha de plataformas (estilo Smash Bros / Brawlhalla), que pasa a llamarse **KiroBrawl**. El rediseño abarca identidad de marca (logo, nombres, lore), un sistema de diseño de UI moderno y saturado, efectos visuales de impacto estilo cómic/arcade, escenarios detallados y animados con profundidad de campo, y personajes 3D estilizados (anime 3D semirrealista occidentalizado) cargados como modelos GLTF/VRM con iluminación cinemática.

El cambio es exclusivamente visual: la simulación determinista a 60 Hz (`src/engine/`), las repeticiones, el netcode online y el servidor deben seguir funcionando sin cambios de comportamiento. Los identificadores de personajes (`blue`, `red`, `yellow`, `green`, `sandbag`) y de escenarios (`neonIsland`, `sunsetIsland`, `voidIsland`, `training`) no cambian.

La entrega es por fases, en este orden: (1) sistema de diseño de UI y pantallas, (2) VFX, (3) escenarios, (4) personajes. Los nombres concretos de personajes, escenarios, lore y el diseño del logo se definirán en el documento de diseño.

## Glossary

- **Cliente_Juego**: La aplicación de navegador (TypeScript + Vite + Three.js) que contiene menús, HUD y renderizado.
- **Simulación**: El motor de juego determinista 2D a 60 Hz en `src/engine/`, que produce el estado de partida.
- **Estado_Simulación**: El conjunto de datos de partida producido por la Simulación en cada tick (jugadores, posiciones, daño, vidas, RNG).
- **Renderizador**: El módulo que dibuja el Estado_Simulación en 2.5D con Three.js (`src/render/`).
- **Sistema_Diseño**: El conjunto de tokens visuales (colores, tipografía, espaciado, radios, sombras, animaciones) y componentes de UI reutilizables (botones, paneles, tarjetas, diálogos).
- **Pantalla_UI**: Cualquier pantalla o diálogo DOM de `src/ui/` (menú principal, selección, pausa, gacha, ranking, online, repeticiones, tutorial, diálogos).
- **HUD**: La capa de información en combate (porcentaje de daño, vidas, barra de furia, retratos) dibujada sobre la escena.
- **Navegador_Menús**: El componente que gestiona el foco y la navegación de las Pantalla_UI con teclado y gamepad.
- **Gestor_Calidad**: El componente que selecciona y aplica el Preset_Calidad.
- **Preset_Calidad**: Uno de los niveles gráficos seleccionables `bajo`, `medio` o `alto`, que define un valor para cada Control_Gráfico. Además existe el estado derivado `personalizado`, que no se selecciona directamente y que indica que al menos un Control_Gráfico tiene un valor distinto del que define el preset seleccionado por última vez.
- **Control_Gráfico**: Cada uno de los ajustes gráficos individuales del menú de opciones: densidad de partículas, destellos de impacto y de pantalla, destellos de lente, bloom, profundidad de campo, sombras, vibración de cámara, líneas de velocidad y animaciones de fondo (cada uno con los niveles `desactivado`, `bajo`, `medio` y `alto`), y escala de resolución de render (de 50 % a 100 % en pasos de 5 %).
- **Pantalla_Carga**: La Pantalla_UI que se muestra mientras el Cliente_Juego carga assets, con el progreso real de la carga.
- **Caché_Assets**: El almacén en memoria de la sesión del navegador con los assets (fuentes, imágenes, modelos y texturas) ya cargados, reutilizables sin nuevas peticiones de red.
- **Postprocesado**: Efectos de pantalla completa aplicados tras el render de escena: bloom, profundidad de campo (DOF) y destellos de lente.
- **Sistema_VFX**: El componente que genera efectos visuales de combate (líneas de velocidad, ondas de choque, partículas brillantes, destellos de impacto, vibración de cámara).
- **Sistema_Escenarios**: El componente que dibuja los fondos, la geometría visual y los elementos animados de cada escenario.
- **Cargador_Modelos**: El componente que carga los modelos GLTF/VRM de personajes y sus texturas.
- **Modelo_Respaldo**: La representación visual alternativa de un personaje (geometría procedimental estilizada) usada cuando su modelo GLTF/VRM no está disponible.
- **Animador_Personaje**: El componente que traduce el estado visual de un jugador (posición interpolada, orientación, ataque, carga, escudo, esquiva, aturdimiento, deslizamiento en pared, furia) en animaciones del modelo.
- **Preferencias_Visuales**: Los ajustes persistidos por el usuario: Preset_Calidad mostrado (`bajo`, `medio`, `alto` o `personalizado`), el nivel de cada Control_Gráfico y Movimiento_Reducido.
- **Movimiento_Reducido**: La opción de accesibilidad que atenúa o desactiva vibración de cámara, destellos y efectos de movimiento intensos.
- **Registro_Créditos**: El archivo y la pantalla que listan cada asset de terceros con su autor, origen y licencia.
- **Aturdimiento**: El estado de hitstun de un jugador tras recibir un golpe (`player.stunned`).
- **Knockback_Efectivo**: La fuerza de lanzamiento de un golpe, escalada por la carga del ataque.

## Requirements

### Requirement 1: Identidad de marca KiroBrawl

**User Story:** Como jugador, quiero que el juego tenga una identidad propia y reconocible, para que se sienta como un producto acabado.

#### Acceptance Criteria

1. THE Cliente_Juego SHALL mostrar el texto exacto "KiroBrawl", respetando mayúsculas y minúsculas, como título del documento del navegador, en el menú principal y en la pantalla de carga, sin que aparezca ningún nombre anterior del juego en esas tres ubicaciones.
2. WHEN se muestra el menú principal, THE Cliente_Juego SHALL mostrar el logo de KiroBrawl en formato vectorial (SVG), que se escala sin pixelado en anchos de ventana de 1280 px a 2560 px y tiene un texto alternativo accesible "KiroBrawl".
3. THE Cliente_Juego SHALL asociar a cada identificador de personaje (`blue`, `red`, `yellow`, `green`, `sandbag`) un nombre visible de 1 a 20 caracteres, un título de 1 a 40 caracteres y una descripción de lore de 1 a 300 caracteres, todos definidos en el documento de diseño.
4. THE Cliente_Juego SHALL asociar a cada identificador de escenario (`neonIsland`, `sunsetIsland`, `voidIsland`, `training`) un nombre visible de 1 a 24 caracteres y una descripción de 1 a 200 caracteres, todos definidos en el documento de diseño.
5. THE Cliente_Juego SHALL conservar sin cambios los identificadores de personajes `blue`, `red`, `yellow`, `green`, `sandbag` y de escenarios `neonIsland`, `sunsetIsland`, `voidIsland`, `training` en el Estado_Simulación, las repeticiones guardadas, los mensajes de red online, las peticiones al servidor y los datos persistidos en el almacenamiento local del navegador.
6. WHEN el Cliente_Juego carga una repetición guardada con identificadores existentes, THE Cliente_Juego SHALL mostrar en la lista de repeticiones, en el reproductor de repeticiones y en el HUD los nuevos nombres visibles correspondientes a esos identificadores, en lugar de los identificadores en bruto o de los nombres anteriores.
7. WHEN una Pantalla_UI o el HUD muestra un personaje o un escenario, THE Cliente_Juego SHALL mostrar el nombre visible asociado a su identificador en lugar del identificador en bruto o del nombre anterior.
8. IF un identificador de personaje o de escenario no tiene nombre visible asociado, THEN THE Cliente_Juego SHALL mostrar el propio identificador como nombre visible y seguir mostrando la Pantalla_UI o la partida sin interrumpirla.
9. IF el archivo SVG del logo no consigue cargarse, THEN THE Cliente_Juego SHALL mostrar en su lugar el texto "KiroBrawl" con la tipografía display del Sistema_Diseño, en la misma posición del menú principal.

### Requirement 2: Sistema de diseño de UI

**User Story:** Como jugador, quiero una interfaz moderna, coherente y llamativa, para que navegar por el juego resulte atractivo.

#### Acceptance Criteria

1. THE Sistema_Diseño SHALL definir los tokens de color, tipografía (familias, tamaños y pesos), espaciado, radios, sombras, brillos y duraciones de animación como variables CSS declaradas en un único punto de definición. Ningún otro archivo del Cliente_Juego declarará valores para esas variables.
2. THE Sistema_Diseño SHALL definir una paleta con al menos un color primario, un color secundario y un color de acento por cada estado (foco, peligro, éxito). Cada uno de estos colores tendrá una saturación HSL mínima del 70 % y una luminosidad HSL de entre el 35 % y el 70 %.
3. THE Sistema_Diseño SHALL usar una familia tipográfica display para títulos y una familia tipográfica de texto para el contenido. Ambas estarán alojadas en el repositorio y acompañadas de su archivo de licencia, que permitirá su redistribución.
4. IF una fuente tipográfica del Sistema_Diseño no se carga, THEN THE Cliente_Juego SHALL mostrar el texto con la fuente de respaldo declarada en los tokens de tipografía y mantener todas las Pantalla_UI operables.
5. THE Sistema_Diseño SHALL proporcionar componentes reutilizables de botón, panel, tarjeta, pestaña, interruptor, deslizador y diálogo. Cada componente interactivo tendrá estados visuales distinguibles de reposo, foco, presionado y deshabilitado, y cada estado diferirá del de reposo en al menos una propiedad visual (color, borde, sombra, brillo o escala).
6. WHILE un componente del Sistema_Diseño está en estado deshabilitado, THE Pantalla_UI SHALL ignorar su activación por ratón, teclado y gamepad.
7. THE Pantalla_UI SHALL tomar todos sus colores, familias tipográficas, tamaños de fuente, espaciados, radios y sombras de los tokens del Sistema_Diseño, sin valores literales en sus estilos, y SHALL construir todos sus botones, paneles, tarjetas, pestañas, interruptores, deslizadores y diálogos con los componentes del Sistema_Diseño.
8. WHEN una Pantalla_UI aparece o desaparece, THE Cliente_Juego SHALL reproducir una transición animada cuya duración, tomada de un token de duración de animación del Sistema_Diseño, esté entre 150 ms y 400 ms.
9. IF se solicita la aparición o desaparición de una Pantalla_UI mientras otra transición sigue en curso, THEN THE Cliente_Juego SHALL dar por terminada la transición en curso en su estado final antes de empezar la nueva, de modo que solo quede visible la Pantalla_UI de destino.

### Requirement 3: Rediseño de pantallas

**User Story:** Como jugador, quiero que todas las pantallas del juego tengan el nuevo estilo, para que la experiencia sea uniforme.

#### Acceptance Criteria

1. THE Cliente_Juego SHALL aplicar el Sistema_Diseño a las 14 Pantalla_UI existentes: menú principal, selección de personaje, selección de escenario, pausa, opciones, reasignación de teclas, gacha, ranking, pantallas online, post-partida, lista de repeticiones, reproductor de repeticiones, tutorial y diálogos. En cada una, todos los colores, fuentes y controles interactivos (botones, paneles, tarjetas, pestañas, interruptores, deslizadores y diálogos) deben proceder de los tokens y componentes definidos en el Requirement 2.
2. WHEN un personaje recibe el foco en la selección de personaje, THE Cliente_Juego SHALL mostrar, en un máximo de 200 ms, el retrato ilustrado, el nombre visible, el título y una vista previa 3D en rotación o en animación de reposo de ese personaje, y sustituir los datos del personaje enfocado antes.
3. THE Cliente_Juego SHALL mostrar en la selección de escenario, para cada uno de los escenarios `neonIsland`, `sunsetIsland`, `voidIsland` y `training`, una imagen de vista previa y su nombre visible, y SHALL resaltar con el estado de foco del Sistema_Diseño el escenario enfocado.
4. THE Cliente_Juego SHALL mantener tras el rediseño todas las acciones de cada Pantalla_UI que existían antes del rediseño (navegar entre pantallas, confirmar, cancelar, cambiar ajustes, reasignar teclas, hacer tiradas de gacha, consultar el ranking, crear y unirse a salas online, guardar, listar y reproducir repeticiones, y avanzar en el tutorial), con los mismos resultados observables, incluidos los datos guardados y las peticiones enviadas al servidor.
5. WHILE la ventana del navegador tiene un ancho de entre 1280 px y 2560 px y una altura de entre 720 px y 1440 px, THE Pantalla_UI SHALL mostrar todo su texto y todos sus controles interactivos dentro de la ventana, sin que se solapen dos elementos y sin que ningún texto o control quede recortado.
6. IF el modelo 3D de vista previa de un personaje no carga en 60 segundos o la carga falla, THEN THE Cliente_Juego SHALL mostrar en la vista previa el Modelo_Respaldo de ese personaje y SHALL mantener el retrato, el nombre, el título y la posibilidad de seleccionar el personaje.
7. IF la imagen de vista previa de un escenario no carga, THEN THE Cliente_Juego SHALL mostrar en su lugar un marcador con los colores del Sistema_Diseño y el nombre visible del escenario, y SHALL mantener ese escenario seleccionable.
8. WHILE la ventana del navegador tiene un ancho menor que 1280 px o una altura menor que 720 px, THE Pantalla_UI SHALL mantener todos los controles interactivos accesibles mediante desplazamiento vertical, sin solapamientos entre controles.

### Requirement 4: Navegación y accesibilidad de menús

**User Story:** Como jugador con teclado, gamepad o necesidades de accesibilidad, quiero navegar y leer los menús sin ratón y con buen contraste, para poder jugar cómodamente.

#### Acceptance Criteria

1. THE Navegador_Menús SHALL permitir alcanzar todos los controles interactivos habilitados de cada Pantalla_UI usando solo teclado, con Tab y Mayús+Tab para avanzar y retroceder en el orden de foco y con las teclas de flecha para moverse entre controles adyacentes. Activar un control se hará con Enter o Espacio.
2. THE Navegador_Menús SHALL permitir alcanzar todos los controles interactivos habilitados de cada Pantalla_UI usando solo gamepad, con la cruceta o el stick izquierdo para mover el foco y el botón inferior del mapeo estándar (A / Cruz) para activar el control enfocado. Si se mantiene pulsada una dirección, el foco se repetirá como máximo una vez cada 150 ms, tras un retardo inicial de entre 300 ms y 500 ms.
3. THE Navegador_Menús SHALL excluir del orden de foco los controles deshabilitados y los controles no visibles, y SHALL seguir un orden de foco que coincida con el orden visual de lectura (de arriba abajo y de izquierda a derecha).
4. WHILE un control interactivo tiene el foco, THE Pantalla_UI SHALL mostrar un indicador de foco visible de al menos 2 px de grosor con un contraste mínimo de 3:1 respecto al fondo adyacente, y SHALL mostrar el indicador en exactamente un control a la vez.
5. THE Pantalla_UI SHALL mostrar el texto con un contraste mínimo de 4.5:1 respecto a su fondo para texto normal y de 3:1 para texto grande. Se considera texto grande el de al menos 24 px, o el de al menos 18.66 px en negrita.
6. WHEN se abre un diálogo, THE Navegador_Menús SHALL mover el foco al primer control interactivo del diálogo en un máximo de 100 ms y SHALL mantenerlo dentro del diálogo hasta que se cierre, de modo que Tab, Mayús+Tab, las flechas y la cruceta o el stick pasen de forma cíclica entre los controles del diálogo.
7. WHEN se cierra un diálogo, THE Navegador_Menús SHALL devolver el foco al control que lo abrió.
8. IF al cerrarse un diálogo el control que lo abrió ya no existe o está deshabilitado, THEN THE Navegador_Menús SHALL mover el foco al primer control interactivo habilitado de la Pantalla_UI subyacente.
9. WHEN se muestra una Pantalla_UI que no es un diálogo, THE Navegador_Menús SHALL poner el foco en su primer control interactivo habilitado en un máximo de 100 ms.
10. WHEN el usuario pulsa Escape en el teclado o el botón derecho del mapeo estándar del gamepad (B / Círculo) con un diálogo abierto que no es obligatorio, THE Navegador_Menús SHALL cerrar ese diálogo sin aplicar su acción de confirmación.

### Requirement 5: HUD de combate

**User Story:** Como jugador, quiero un HUD llamativo y legible durante el combate, para conocer el estado de la partida de un vistazo.

#### Acceptance Criteria

1. WHILE una partida está en curso, THE HUD SHALL mostrar un panel por cada jugador de la partida (de 2 a 4 jugadores). Cada panel SHALL contener el retrato del personaje, su nombre visible, su porcentaje de daño como número entero seguido del símbolo "%", sus vidas restantes como indicadores individuales y su medidor de furia, usando solo la tipografía y los tokens de color del Sistema_Diseño.
2. WHEN el porcentaje de daño de un jugador aumenta en el Estado_Simulación, THE HUD SHALL animar el porcentaje de ese jugador con un efecto de sacudida y escala que dure entre 100 ms y 300 ms y termine en la escala y la posición originales del porcentaje.
3. WHEN el porcentaje de daño de un jugador vuelve a aumentar mientras su animación de sacudida y escala sigue en curso, THE HUD SHALL reiniciar la animación desde el principio, de modo que la duración total desde el último aumento no pase de 300 ms.
4. THE HUD SHALL colorear el porcentaje de daño de cada jugador interpolando de forma continua y monótona entre el token de color neutro del Sistema_Diseño al 0% y el token de color de peligro del Sistema_Diseño al 150%. Por encima del 150%, el porcentaje SHALL mantenerse en el color de peligro.
5. WHEN el número de vidas restantes de un jugador disminuye en el Estado_Simulación, THE HUD SHALL reproducir una animación de pérdida de vida de entre 200 ms y 600 ms solo en el indicador de la vida perdida de ese jugador. Al terminar la animación, el indicador de vidas SHALL mostrar el número de vidas restantes actualizado.
6. WHILE un jugador tiene 0 vidas restantes, THE HUD SHALL mantener visible el panel de ese jugador con el retrato en estado atenuado y sin ningún indicador de vida activo.
7. THE HUD SHALL mostrar el medidor de furia de cada jugador con un relleno proporcional, de 0% a 100%, a la carga de furia acumulada en el Estado_Simulación. WHILE la furia de un jugador está activa, el medidor de ese jugador SHALL mostrar un estado visual distinto del estado de acumulación.
8. WHILE la ventana del navegador tiene un ancho de entre 1280 px y 2560 px, THE HUD SHALL mostrar todos los paneles de jugador sin que se solapen entre sí ni queden recortados por los bordes de la ventana.

### Requirement 6: Presets de calidad gráfica

**User Story:** Como jugador con un portátil de GPU integrada, quiero que el juego elija y me deje ajustar la calidad gráfica, para jugar fluido.

#### Acceptance Criteria

1. THE Gestor_Calidad SHALL ofrecer exactamente tres Preset_Calidad seleccionables, `bajo`, `medio` y `alto`, cada uno con un valor definido para cada Control_Gráfico, de modo que el valor de cada Control_Gráfico en `bajo` sea menor o igual que en `medio` y el de `medio` menor o igual que en `alto`.
2. WHEN el Cliente_Juego se inicia sin Preferencias_Visuales guardadas, THE Gestor_Calidad SHALL aplicar el Preset_Calidad `medio` sea cual sea la GPU detectada, salvo que no pueda identificar la GPU o el dispositivo tenga menos de 4 núcleos lógicos de CPU, en cuyo caso SHALL aplicar el Preset_Calidad `bajo`. La detección automática solo puede bajar el preset de `medio` a `bajo` y nunca selecciona `alto`.
3. WHEN el usuario cambia el Preset_Calidad en el menú de opciones, THE Gestor_Calidad SHALL aplicar el nuevo preset en 1 segundo como máximo, sin recargar la página y sin modificar el Estado_Simulación de una partida en curso.
4. THE Cliente_Juego SHALL ofrecer en el menú de opciones, además del selector de Preset_Calidad, un control individual por cada Control_Gráfico: densidad de partículas, destellos de impacto y de pantalla, destellos de lente, bloom, profundidad de campo, sombras, vibración de cámara, líneas de velocidad y animaciones de fondo, cada uno con los niveles `desactivado`, `bajo`, `medio` y `alto`, y escala de resolución de render, con valores de 50 % a 100 % en pasos de 5 %.
5. WHEN el usuario cambia el nivel de un Control_Gráfico, THE Gestor_Calidad SHALL aplicar ese nivel en 1 segundo como máximo, con prioridad sobre el valor que define el Preset_Calidad seleccionado para ese Control_Gráfico, sin recargar la página y sin modificar el Estado_Simulación.
6. WHEN el nivel de al menos un Control_Gráfico pasa a diferir del valor que define el Preset_Calidad seleccionado, THE Gestor_Calidad SHALL mostrar automáticamente el Preset_Calidad como `personalizado` en el menú de opciones, conservando el nivel de cada Control_Gráfico.
7. WHEN el nivel de todos los Control_Gráfico vuelve a coincidir con los valores que define uno de los Preset_Calidad `bajo`, `medio` o `alto`, THE Gestor_Calidad SHALL mostrar ese Preset_Calidad como seleccionado en lugar de `personalizado`.
8. WHEN el usuario modifica las Preferencias_Visuales (Preset_Calidad, el nivel de cualquier Control_Gráfico o Movimiento_Reducido), THE Cliente_Juego SHALL persistir las Preferencias_Visuales completas en el almacenamiento local del navegador antes de que pase 1 segundo desde el cambio.
9. FOR ALL Preferencias_Visuales válidas, guardar y después cargar las Preferencias_Visuales SHALL producir unas Preferencias_Visuales equivalentes, es decir, con el mismo Preset_Calidad mostrado (incluido `personalizado`), el mismo nivel de cada Control_Gráfico y el mismo valor de Movimiento_Reducido (propiedad de ida y vuelta).
10. IF las Preferencias_Visuales guardadas no se pueden interpretar, contienen un Preset_Calidad distinto de `bajo`, `medio`, `alto` o `personalizado`, contienen un nivel de Control_Gráfico fuera de los valores del criterio 4, o les falta algún campo, o algún campo tiene un tipo de valor no válido, THEN THE Gestor_Calidad SHALL descartarlas por completo, aplicar el Preset_Calidad elegido según la regla del criterio 2 con todos los Control_Gráfico en los valores de ese preset, y sobrescribir los datos guardados con estas Preferencias_Visuales válidas.
11. WHILE el Preset_Calidad `medio` está activo en una GPU integrada de referencia (Intel Iris Xe o AMD Radeon Vega 8) a una resolución de ventana de 1920×1080, THE Renderizador SHALL mantener una media de al menos 60 fotogramas por segundo, medida durante 60 segundos continuos de una partida de 4 jugadores.
12. WHEN el usuario selecciona un Preset_Calidad `bajo`, `medio` o `alto` (también estando en `personalizado`), THE Gestor_Calidad SHALL restablecer el nivel de todos los Control_Gráfico a los valores que define el preset seleccionado.
13. IF el almacenamiento local del navegador no está disponible o rechaza la escritura, THEN THE Cliente_Juego SHALL mantener las Preferencias_Visuales aplicadas durante la sesión actual y mostrar un aviso no bloqueante de que los ajustes no se guardarán, sin interrumpir la partida ni el menú.

### Requirement 7: Iluminación cinemática y postprocesado

**User Story:** Como jugador, quiero una iluminación dramática con brillos y separación clara de los personajes respecto al fondo, para que la escena se vea espectacular.

#### Acceptance Criteria

1. THE Renderizador SHALL iluminar a cada personaje con tres luces: una luz principal, una luz de relleno de menor intensidad que la luz principal y una luz de contorno (rim light) situada detrás del personaje respecto a la cámara. La luz de contorno SHALL producir un borde iluminado visible a lo largo de la silueta del personaje en todos los escenarios y con todos los Preset_Calidad.
2. THE Renderizador SHALL asignar a cada material de personaje uno de los tipos metal, cuero, tela o pelo, y SHALL renderizar cada tipo con una respuesta especular propia: metal con reflejos especulares nítidos y de alta intensidad, cuero con reflejos especulares suaves de intensidad media, tela sin reflejo especular perceptible y pelo con un reflejo especular en banda alargado en la dirección del mechón. Esto SHALL aplicarse tanto a los modelos GLTF/VRM como a los Modelo_Respaldo.
3. WHERE el bloom está activo, THE Renderizador SHALL aplicar un halo de brillo solo a las superficies emisivas de personajes y escenarios y a los efectos brillantes del Sistema_VFX, sin aplicar halo a las superficies no emisivas iluminadas de forma normal.
4. WHERE la profundidad de campo está activa, THE Renderizador SHALL desenfocar las capas de fondo del escenario situadas detrás del plano de combate, y SHALL renderizar nítidos el plano de combate, las plataformas, los personajes, los efectos del Sistema_VFX y el HUD.
5. WHERE los destellos de lente están activos, THE Renderizador SHALL mostrar un destello de lente en cada fuente de luz del escenario marcada como intensa en el documento de diseño mientras esté dentro del encuadre de la cámara, y en el punto de impacto de cada ataque pesado (el mismo evento que activa las líneas de velocidad del Sistema_VFX), con una duración máxima de 0,5 segundos por impacto.
6. WHERE el bloom, la profundidad de campo o los destellos de lente están desactivados según las Preferencias_Visuales o el Preset_Calidad, THE Renderizador SHALL omitir por completo ese efecto de Postprocesado y SHALL seguir renderizando la escena con la iluminación de los criterios 1 y 2.
7. WHILE Movimiento_Reducido está activo, THE Renderizador SHALL dejar de mostrar los destellos de lente de los impactos de ataques pesados, aunque los destellos de lente estén activos.
8. THE Renderizador SHALL calcular la iluminación y el Postprocesado sin modificar el Estado_Simulación, de modo que una misma partida o repetición produzca un Estado_Simulación idéntico con cualquier combinación de efectos de Postprocesado activados o desactivados.

### Requirement 8: Efectos visuales de impacto

**User Story:** Como jugador, quiero efectos de impacto exagerados y energéticos, para que cada golpe se sienta potente.

#### Acceptance Criteria

1. WHEN un ataque impacta a un jugador, THE Sistema_VFX SHALL generar, en el primer fotograma renderizado tras el tick del impacto, un destello de impacto de una duración máxima de 150 ms y una onda de choque estilizada de una duración máxima de 400 ms, ambos centrados en el punto de impacto. Si varios impactos ocurren en el mismo tick, el sistema genera un par destello/onda independiente por cada uno.
2. WHEN un ataque pesado (de tipo `heavy`) impacta a un jugador, THE Sistema_VFX SHALL generar líneas de velocidad orientadas en la dirección del knockback y una vibración de cámara de entre 100 ms y 400 ms. La amplitud y la duración de ambos efectos son monótonamente no decrecientes respecto al Knockback_Efectivo del golpe y alcanzan su valor máximo con el Knockback_Efectivo máximo de un ataque pesado a carga completa.
3. WHEN un ataque ligero (de tipo `light`) impacta a un jugador, THE Sistema_VFX SHALL generar un destello de impacto y una onda de choque de menor tamaño que los de cualquier ataque pesado, sin líneas de velocidad ni vibración de cámara.
4. WHILE un jugador está en Aturdimiento provocado por un golpe, THE Sistema_VFX SHALL dibujar detrás de ese jugador una estela que sigue su trayectoria. Cuando el Aturdimiento termina, la estela se desvanece por completo en un máximo de 300 ms.
5. WHILE un jugador carga un ataque pesado, THE Sistema_VFX SHALL emitir alrededor de ese jugador partículas brillantes cuya cantidad y brillo son monótonamente no decrecientes respecto a la proporción de carga (de 0 a 1). Esas partículas dejan de emitirse en el primer fotograma renderizado tras el tick en que se suelta el ataque o se interrumpe la carga.
6. WHILE la furia de un jugador está activa, THE Sistema_VFX SHALL mostrar un aura brillante alrededor de ese jugador. El aura aparece en el primer fotograma renderizado tras el tick de activación de la furia y desaparece en un máximo de 300 ms tras el tick en que la furia termina.
7. WHEN un jugador es eliminado, THE Sistema_VFX SHALL reproducir, con una duración máxima de 1,5 segundos, un efecto de eliminación estilizado situado en el borde del escenario por el que salió (izquierdo, derecho, superior o inferior) y orientado hacia el interior del escenario.
8. THE Sistema_VFX SHALL limitar el número máximo de partículas activas simultáneas según el nivel del Control_Gráfico de densidad de partículas: 0 en `desactivado`, 200 en `bajo`, 500 en `medio` y 1000 en `alto`.
9. IF generar nuevas partículas superaría el máximo de partículas activas del nivel de densidad de partículas vigente, THEN THE Sistema_VFX SHALL eliminar primero las partículas activas más antiguas para no superar el máximo, sin dejar de generar los destellos de impacto, las ondas de choque ni la vibración de cámara asociados al evento.
10. WHEN el nivel de densidad de partículas cambia durante una partida (directamente o por un cambio de Preset_Calidad), THE Sistema_VFX SHALL aplicar el nuevo máximo de partículas activas en un máximo de 1 segundo, eliminando las partículas más antiguas que excedan ese máximo.

### Requirement 9: Movimiento reducido

**User Story:** Como jugador sensible al movimiento o a los destellos, quiero reducir los efectos intensos, para jugar sin molestias.

#### Acceptance Criteria

1. THE Cliente_Juego SHALL ofrecer en el menú de opciones la opción Movimiento_Reducido como un interruptor con dos estados, activado y desactivado, que muestra en todo momento su estado actual.
2. WHEN el Cliente_Juego se inicia sin Preferencias_Visuales guardadas y el navegador indica `prefers-reduced-motion: reduce`, THE Cliente_Juego SHALL activar Movimiento_Reducido antes de mostrar la primera Pantalla_UI.
3. IF el Cliente_Juego se inicia sin Preferencias_Visuales guardadas y el navegador no indica `prefers-reduced-motion: reduce` (incluido el caso de que el navegador no admita esa consulta), THEN THE Cliente_Juego SHALL iniciar con Movimiento_Reducido desactivado.
4. WHEN el Cliente_Juego se inicia con Preferencias_Visuales guardadas, THE Cliente_Juego SHALL aplicar el valor de Movimiento_Reducido guardado, sea cual sea el valor de `prefers-reduced-motion` que indique el navegador.
5. WHEN el usuario cambia Movimiento_Reducido en el menú de opciones, THE Cliente_Juego SHALL aplicar el nuevo valor al Sistema_VFX y a las Pantalla_UI en 1 segundo como máximo, sin recargar la página ni interrumpir la partida en curso.
6. WHILE Movimiento_Reducido está activo, THE Sistema_VFX SHALL desactivar por completo la vibración de cámara y las líneas de velocidad a pantalla completa, tanto en las partidas como en la reproducción de repeticiones.
7. WHILE Movimiento_Reducido está activo, THE Sistema_VFX SHALL limitar los destellos a pantalla completa (destellos que cubren más del 25 % del área de la ventana de juego) a un máximo de 3 en cualquier intervalo de 1 segundo, y no mostrará los destellos que superen ese límite.
8. WHILE Movimiento_Reducido está activo, THE Pantalla_UI SHALL sustituir las transiciones de desplazamiento y escala por fundidos de opacidad de entre 150 ms y 400 ms.
9. THE Sistema_VFX SHALL producir el mismo Estado_Simulación en cada tick con Movimiento_Reducido activado y desactivado, de modo que esta opción solo afecte a la presentación visual.

### Requirement 10: Escenarios detallados y animados

**User Story:** Como jugador, quiero escenarios vivos y profundos que mezclen fantasía con arquitectura y naturaleza realista, para que cada combate tenga ambiente propio.

#### Acceptance Criteria

1. THE Sistema_Escenarios SHALL dibujar cada escenario (`neonIsland`, `sunsetIsland`, `voidIsland`, `training`) con al menos tres capas de profundidad en todos los Preset_Calidad: primer plano, situado delante del plano de combate; plano de combate, que contiene las plataformas y los personajes; y fondo lejano, situado detrás del plano de combate. Ningún elemento del primer plano SHALL tapar a los personajes ni a las superficies de las plataformas dentro de la zona visible de combate.
2. WHILE se muestra un escenario y el Control_Gráfico de animaciones de fondo no está en `desactivado`, THE Sistema_Escenarios SHALL animar en cada fotograma renderizado al menos dos elementos de fondo por escenario, con movimiento en bucle sin pausas ni saltos visibles en el punto de reinicio del ciclo.
3. THE Sistema_Escenarios SHALL alinear los bordes superior, izquierdo y derecho de la geometría visual de cada plataforma con los límites de colisión que la Simulación define para ese escenario, con una desviación máxima de 2 píxeles a una resolución de 1920×1080.
4. THE Sistema_Escenarios SHALL dar a cada escenario un color dominante de fondo, un color de luz principal y un conjunto de elementos ambientales que no comparte ningún otro escenario, según la definición por escenario del documento de diseño.
5. THE Sistema_Escenarios SHALL animar 0 elementos de fondo con el Control_Gráfico de animaciones de fondo en `desactivado` y como mínimo 2 con `bajo`, 4 con `medio` y 6 con `alto`, y SHALL usar capas de fondo cuyo número de elementos visibles no disminuya al pasar de `bajo` a `medio` ni de `medio` a `alto` en el Preset_Calidad.
6. THE Sistema_Escenarios SHALL derivar todas las animaciones de fondo del tiempo de render, sin leer ni modificar el Estado_Simulación, de modo que con las mismas entradas el Estado_Simulación sea idéntico tick a tick con cualquier Preset_Calidad y con las animaciones de fondo activadas o desactivadas.
7. WHEN el usuario cambia el Preset_Calidad o el Control_Gráfico de animaciones de fondo durante una partida, THE Sistema_Escenarios SHALL aplicar el número de elementos animados y el detalle de las capas del nuevo preset en un máximo de 1 segundo, sin recargar la página, sin interrumpir la partida y sin modificar los límites de colisión de las plataformas.
8. IF un asset visual de un escenario (textura, modelo o capa de fondo) no se carga, THEN THE Sistema_Escenarios SHALL dibujar esa capa con una representación alternativa procedimental, mantener visibles las plataformas alineadas con sus límites de colisión y permitir que la partida empiece o continúe sin interrupción.
9. WHERE Movimiento_Reducido está activo, THE Sistema_Escenarios SHALL reducir al menos un 50 % la velocidad y la amplitud de las animaciones de fondo respecto a su valor con Movimiento_Reducido desactivado, y SHALL desactivar los parpadeos y destellos de los elementos de fondo.

### Requirement 11: Personajes 3D estilizados

**User Story:** Como jugador, quiero personajes 3D detallados de estilo anime semirrealista con animaciones expresivas, para identificarme con ellos.

#### Acceptance Criteria

1. THE Cargador_Modelos SHALL cargar un modelo GLTF o VRM con texturas para cada uno de los personajes `blue`, `red`, `yellow`, `green` y `sandbag`.
2. THE Renderizador SHALL escalar y posicionar cada modelo de personaje para que el ancho y el alto de su silueta coincidan con el ancho y el alto de la caja de colisión del jugador en la Simulación con una tolerancia de ±15 % en cada dimensión, y para que la base del modelo quede alineada con el borde inferior de esa caja de colisión.
3. THE Animador_Personaje SHALL reproducir una animación distinta para cada estado según esta correspondencia con el estado visual del jugador: reposo (en suelo y velocidad horizontal nula), carrera (en suelo y velocidad horizontal no nula), salto (en el aire con velocidad vertical ascendente), caída (en el aire con velocidad vertical descendente o nula), ataque ligero (ataque activo de tipo ligero), ataque pesado (ataque activo de tipo pesado), carga (carga activa), escudo (radio de escudo mayor que 0), esquiva (esquiva activa), aturdimiento (Aturdimiento activo), deslizamiento en pared (deslizamiento en pared activo) y celebración.
4. WHEN la orientación de un jugador cambia, THE Animador_Personaje SHALL girar el modelo hasta la nueva orientación en un máximo de 100 ms desde el primer fotograma renderizado con la nueva orientación.
5. WHILE un jugador tiene el destello de golpe activo, THE Renderizador SHALL aplicar un tinte de impacto a todo el modelo de ese jugador y SHALL retirarlo en el primer fotograma renderizado tras desactivarse el destello de golpe.
6. THE Renderizador SHALL asignar a cada uno de los personajes `blue`, `red`, `yellow` y `green` un modelo exclusivo y un color dominante de paleta correspondiente a su identificador (azul, rojo, amarillo y verde respectivamente), sin que dos de estos personajes compartan modelo ni color dominante.
7. THE Animador_Personaje SHALL derivar todas las animaciones del estado visual interpolado del jugador, sin modificar el Estado_Simulación.
8. IF el estado visual de un jugador cumple las condiciones de más de un estado de animación a la vez, THEN THE Animador_Personaje SHALL reproducir únicamente la animación del estado de mayor prioridad según este orden descendente: aturdimiento, esquiva, escudo, ataque pesado, ataque ligero, carga, deslizamiento en pared, salto, caída, carrera, reposo.
9. WHEN una partida termina con un ganador, THE Animador_Personaje SHALL reproducir la animación de celebración en el modelo del jugador ganador.
10. WHEN el estado de animación de un jugador cambia, THE Animador_Personaje SHALL completar la transición a la nueva animación en un máximo de 150 ms, y SHALL iniciar las animaciones de ataque ligero, ataque pesado y esquiva en el primer fotograma renderizado en que el estado correspondiente está activo.

### Requirement 12: Respaldo ante fallos de carga de modelos

**User Story:** Como jugador, quiero poder jugar aunque un modelo 3D no cargue, para que un fallo de red o de archivo no rompa la partida.

#### Acceptance Criteria

1. IF el Cargador_Modelos no consigue cargar el modelo de un personaje por un error de red, un archivo inexistente, un archivo GLTF/VRM que no se puede interpretar o el tiempo límite agotado del criterio 2, THEN THE Renderizador SHALL mostrar el Modelo_Respaldo de ese personaje con su color identificativo, escalado para que coincida con el ancho y alto de la caja de colisión del jugador en la Simulación con una tolerancia del 15%.
2. IF el Cargador_Modelos no termina de cargar el modelo de un personaje en 60 segundos desde que empieza la carga, THEN THE Cargador_Modelos SHALL tratar la carga como fallida y mantener el Modelo_Respaldo durante el resto de la partida, aunque el modelo termine de cargarse después.
3. IF la carga de un modelo falla, THEN THE Cargador_Modelos SHALL registrar en la consola del navegador un único error por personaje y partida, con el identificador del personaje, la ruta del modelo y el motivo del fallo (error de red, archivo inexistente, archivo no interpretable o tiempo agotado).
4. WHILE se usa un Modelo_Respaldo, THE Renderizador SHALL mostrar la orientación, el escudo, la carga y el destello de golpe del jugador, con el mismo momento de inicio y la misma duración que tienen esos estados en el Estado_Simulación.
5. WHILE los modelos de personaje se están cargando, THE Cliente_Juego SHALL mostrar el progreso de carga en la Pantalla_Carga definida en el Requirement 15, contando cada modelo cargado o fallido como procesado.
6. WHEN todos los modelos de personaje de la partida se han cargado o se han marcado como fallidos, THE Cliente_Juego SHALL ocultar la Pantalla_Carga y empezar la partida, en un máximo de 60 segundos desde el inicio de la carga.
7. IF uno o más modelos de personaje no se cargan, THEN THE Cliente_Juego SHALL empezar y ejecutar la partida sin modificar el Estado_Simulación, de modo que el Estado_Simulación sea idéntico tick a tick al de una partida con los mismos datos de entrada en la que todos los modelos se cargan.
8. IF el modelo de un personaje se carga pero no se carga una o más de sus texturas, THEN THE Renderizador SHALL mostrar ese modelo con su color identificativo en lugar de las texturas que faltan, y THE Cargador_Modelos SHALL registrar en la consola del navegador un error con el identificador del personaje y la ruta de cada textura que falta.

### Requirement 13: Aislamiento de la simulación

**User Story:** Como desarrollador, quiero que el rediseño no altere la simulación, para que repeticiones, juego online y servidor sigan funcionando.

#### Acceptance Criteria

1. THE Renderizador, THE Sistema_VFX, THE Sistema_Escenarios y THE Animador_Personaje SHALL acceder al Estado_Simulación solo en modo lectura, de modo que el Estado_Simulación de cada tick sea idéntico campo a campo (jugadores, posiciones, velocidades, daño, vidas y estado del RNG) antes y después de dibujar cada fotograma.
2. FOR ALL secuencias de entradas de entre 1 y 36.000 ticks (10 minutos a 60 Hz) y FOR ALL combinaciones de Preferencias_Visuales (cada Preset_Calidad `bajo`, `medio`, `alto` o `personalizado`, cada combinación de niveles de los Control_Gráfico y Movimiento_Reducido activado o desactivado), la Simulación SHALL producir un Estado_Simulación idéntico campo a campo en cada tick (propiedad de invariancia).
3. WHEN el Cliente_Juego reproduce una repetición grabada antes del rediseño, THE Cliente_Juego SHALL reproducirla con un Estado_Simulación final idéntico al de la grabación original, incluidos el ganador, las vidas restantes y el daño final de cada jugador y el número total de ticks de la partida.
4. THE Cliente_Juego SHALL enviar y aceptar los mensajes de red online y las peticiones al servidor con el mismo conjunto de campos, los mismos tipos de datos y la misma semántica que antes del rediseño, de modo que un servidor sin cambios procese las peticiones del Cliente_Juego rediseñado sin errores ni rechazos atribuibles al formato.
5. THE Sistema_VFX SHALL obtener cualquier aleatoriedad visual de una fuente independiente del generador aleatorio de la Simulación, de modo que el estado del RNG del Estado_Simulación sea idéntico en cada tick con el Sistema_VFX activo, desactivado o con cualquier densidad de partículas.
6. WHILE una partida está en curso, THE Simulación SHALL avanzar a 60 ticks por segundo con independencia de la tasa de fotogramas del Renderizador, sin que una tasa de fotogramas entre 1 y 240 fotogramas por segundo cambie el número de ticks simulados ni el Estado_Simulación de cada tick.
7. IF el Renderizador, el Cargador_Modelos o el Sistema_VFX producen un error durante una partida (incluida la pérdida del contexto WebGL o el fallo de carga de un modelo GLTF/VRM), THEN THE Simulación SHALL seguir avanzando sin detenerse y con un Estado_Simulación idéntico al que produciría sin ese error.
8. WHEN dos instancias del Cliente_Juego con Preferencias_Visuales distintas participan en la misma partida online, THE Simulación de cada instancia SHALL producir un Estado_Simulación idéntico campo a campo en cada tick confirmado.

### Requirement 14: Licencias y créditos de assets

**User Story:** Como responsable del proyecto, quiero que todos los assets de terceros respeten su licencia y estén acreditados, para evitar problemas legales.

#### Acceptance Criteria

1. THE Registro_Créditos SHALL listar cada asset de terceros incluido en el repositorio (modelos, texturas, fuentes, animaciones, imágenes, sonidos) con estos cinco campos no vacíos: nombre del asset, autor, URL de origen, nombre de la licencia y URL del texto de la licencia. Por tanto, el número de entradas del Registro_Créditos SHALL ser igual al número de assets de terceros presentes en el repositorio.
2. THE Cliente_Juego SHALL incluir únicamente assets de terceros cuya licencia permita uso, modificación y redistribución, también comercial, en un repositorio público, sin restricciones de no-comercial (NC) ni de sin-derivadas (ND). Ejemplos de licencias que cumplen: CC0, CC-BY 4.0, MIT y SIL Open Font License 1.1.
3. WHEN el usuario activa la opción "Créditos" del menú principal, THE Cliente_Juego SHALL mostrar una Pantalla_UI de créditos con todas las entradas del Registro_Créditos y los cinco campos de cada entrada.
4. THE Cliente_Juego SHALL alojar todos los assets de terceros dentro del repositorio y servirlos desde el mismo origen que el Cliente_Juego. Por tanto, durante la ejecución no se hará ninguna petición de red a dominios externos para obtener assets.
5. WHERE la licencia de un asset de terceros exija atribución, THE Registro_Créditos SHALL incluir para ese asset el texto de atribución en la forma que pida su licencia, incluidos el autor y la indicación de si el asset se modificó.
6. IF un asset de terceros no tiene autor, URL de origen o licencia verificable, o su licencia no cumple el criterio 2, THEN THE Cliente_Juego SHALL excluir ese asset del repositorio y del build publicado.
7. WHILE la pantalla de créditos está abierta, THE Navegador_Menús SHALL permitir desplazarse por todas las entradas y volver al menú principal usando solo teclado o solo gamepad.

### Requirement 15: Pantallas de carga

**User Story:** Como jugador, quiero ver cuánto falta realmente para que termine cada carga, para saber que el juego avanza y no se ha colgado.

#### Acceptance Criteria

1. WHEN el Cliente_Juego se inicia, THE Cliente_Juego SHALL mostrar una Pantalla_Carga mientras carga los assets de arranque (fuentes, imágenes de UI, modelos y texturas) y SHALL mostrar el menú principal solo después de que todos esos assets se hayan cargado o marcado como fallidos.
2. WHEN el usuario confirma la selección de personajes y escenario para empezar una partida, THE Cliente_Juego SHALL mostrar una Pantalla_Carga mientras carga los modelos y texturas de los personajes elegidos y los assets del escenario elegido.
3. WHILE se muestra una Pantalla_Carga y se conoce el tamaño en bytes de todos los assets de esa carga, THE Pantalla_Carga SHALL mostrar un porcentaje igual a los bytes procesados divididos entre los bytes totales de la carga, multiplicado por 100 y redondeado hacia abajo a un número entero.
4. IF se desconoce el tamaño en bytes de al menos un asset de la carga, THEN THE Pantalla_Carga SHALL mostrar un porcentaje igual al número de assets procesados dividido entre el número total de assets de la carga, multiplicado por 100 y redondeado hacia abajo a un número entero.
5. WHILE se muestra una Pantalla_Carga, THE Pantalla_Carga SHALL mostrar la cantidad cargada y la restante: los megabytes procesados y los megabytes totales con un decimal (por ejemplo "12,4 MB / 30,0 MB") cuando se conoce el tamaño en bytes de todos los assets, y en todos los casos el número de assets restantes.
6. WHILE una carga está en curso, THE Pantalla_Carga SHALL actualizar el porcentaje, la cantidad cargada y la cantidad restante al menos una vez cada 250 ms.
7. FOR ALL secuencias de eventos de progreso de carga (bytes recibidos, assets completados y assets fallidos, en cualquier orden), THE Pantalla_Carga SHALL mostrar un porcentaje comprendido entre 0 y 100, ambos incluidos, y monótonamente no decreciente entre una actualización y la siguiente (propiedad invariante).
8. THE Pantalla_Carga SHALL mostrar el 100 % solo cuando todos los assets de la carga se han cargado o se han marcado como fallidos.
9. IF un asset de la carga falla, THEN THE Pantalla_Carga SHALL contar ese asset como procesado, sumando su tamaño total en bytes a los bytes procesados cuando ese tamaño se conoce, y SHALL continuar con el resto de la carga.
10. IF una carga no termina en 60 segundos desde su inicio, THEN THE Cliente_Juego SHALL marcar como fallidos todos los assets pendientes, mostrar el 100 % en la Pantalla_Carga y continuar con las representaciones de respaldo (Modelo_Respaldo, fuente de respaldo y representación procedimental de escenarios).
11. THE Pantalla_Carga SHALL construirse con los tokens y componentes del Sistema_Diseño y SHALL mostrar el logo de KiroBrawl y un texto de consejo o de lore de entre 1 y 200 caracteres.
12. WHEN una carga necesita un asset que ya está en la Caché_Assets, THE Cliente_Juego SHALL reutilizar la copia de la Caché_Assets sin una nueva petición de red y SHALL contar ese asset como procesado desde el inicio de la carga.
13. WHEN se empieza una partida cuyos modelos, texturas y assets de escenario ya están todos en la Caché_Assets, THE Cliente_Juego SHALL mostrar el 100 % en la Pantalla_Carga y empezar la partida en un máximo de 1 segundo desde la confirmación de la selección.
