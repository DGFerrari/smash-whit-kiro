# Texturas

Coloca aquí las imágenes que quieras usar como texturas de las superficies 3D
(suelo, plataformas, jugadores). Formatos recomendados: PNG o JPG.

Luego referencia la ruta en `src/config.ts`, en el bloque `TEXTURES`. La ruta es
absoluta desde `public/`, p. ej. una imagen en `public/textures/suelo.png` se
referencia como `/textures/suelo.png`.

## Ejemplo

```ts
export const TEXTURES = {
  solidTop: { url: "/textures/hierba.png", repeat: [12, 2] },
  solidSide: { url: "/textures/roca.png", repeat: [12, 4] },
  oneWay: null,
  fighters: [
    { url: "/textures/p1.png" },
    null,
  ],
};
```

- `repeat: [x, y]` controla cuántas veces se repite la imagen (tiling). Para
  suelos grandes conviene un valor alto para que no se vea estirada. Si lo
  omites, se calcula un tiling automático según el tamaño de la superficie.
- `pixelated: true` usa filtrado nearest (ideal para pixel-art).
- Si una imagen no existe o falla al cargar, la superficie usa su color base; no
  se rompe nada.
