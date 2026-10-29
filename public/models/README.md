# Modelos 3D (glTF / glb)

Coloca aquí los modelos de los personajes en formato **.glb** (recomendado) o
**.gltf**. Un `.glb` empaqueta malla + materiales + texturas + esqueleto +
animaciones en un solo archivo.

## Cómo asignar un modelo a un personaje

Edita `src/game/characters.ts` y añade el campo `model` al personaje. La ruta es
absoluta desde `public/`, p. ej. un archivo en `public/models/azul.glb` se
referencia como `/models/azul.glb`:

```ts
blue: {
  id: "blue", name: "Azul", color: "#7fb2ff",
  model: {
    url: "/models/azul.glb",
    scale: 56,          // ajusta hasta que el alto cuadre con el juego
    offsetY: 0,         // sube/baja el modelo para que pise el suelo
    forwardX: 1,        // 1 si el modelo mira a la DERECHA de fábrica, -1 si a la izquierda
    tint: false,        // true para teñir un modelo gris con el color del personaje
    clips: {            // nombre del clip de animación DENTRO del .glb por estado
      idle: "Idle",
      run: "Run",
      jump: "Jump",
      fall: "Fall",
      attack: "Punch",
      hit: "Hit",
      shield: "Block",
    },
  },
},
```

## Notas

- Si un personaje **no** tiene `model`, se dibuja con el cubo redondeado de
  siempre. Así el juego funciona sin modelos.
- Los nombres de los clips (`clips`) dependen de cómo se exportó el modelo. Si
  no sabes cómo se llaman, ábrelo en https://gltf-viewer.donmccurdy.com/ y mira
  la lista de animaciones; pon esos nombres exactos.
- La animación es puramente visual: la física y los replays no cambian. Un
  replay grabado con cubos se verá con modelos si luego asignas uno al personaje.
- Si un modelo falla al cargar, ese personaje vuelve al cubo (no rompe nada).
- ¿De dónde sacar modelos con animaciones? Mixamo (humanoides riggeados gratis),
  Quaternius, Kenney, o modelarlos en Blender y exportar a .glb. Revisa siempre
  la licencia.
```
