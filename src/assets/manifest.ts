/**
 * Manifiesto de assets por grupo de carga: arranque (`boot`), personaje y
 * escenario. Todas las URLs son relativas a `import.meta.env.BASE_URL` (sin
 * esquema, sin `//` y sin `/` inicial) para que el sitio funcione bajo
 * cualquier subruta y sin dominios externos (R14.4).
 *
 * `sizeHint` = tamaño en bytes del archivo en `public/`, para tener progreso
 * por bytes aunque el servidor no envíe `Content-Length` (R15.2).
 *
 * Los grupos de personaje y escenario están vacíos hasta que lleguen sus
 * modelos/texturas en fases posteriores.
 */

import type { CharacterId } from "../engine/game/characters";
import type { StageId } from "../engine/game/stages";
import type { AssetRequest } from "./assetLoader";
import { CHARACTER_MODELS, modelAssetId } from "../render/characters/characterAssets.ts";

/** Fuentes de marca (OFL) servidas desde `public/fonts`. */
export const BOOT_GROUP: readonly AssetRequest[] = [
  { id: "font:russo-one-400", url: "fonts/russo-one-latin-400-normal.woff2", kind: "font", sizeHint: 7344 },
  { id: "font:rajdhani-500", url: "fonts/rajdhani-latin-500-normal.woff2", kind: "font", sizeHint: 15084 },
  { id: "font:rajdhani-600", url: "fonts/rajdhani-latin-600-normal.woff2", kind: "font", sizeHint: 15732 },
  { id: "font:rajdhani-700", url: "fonts/rajdhani-latin-700-normal.woff2", kind: "font", sizeHint: 15688 },
];

/** Modelo GLTF de cada personaje (KayKit, CC0). El saco usa el modelo procedimental. */
function modelGroup(id: CharacterId): readonly AssetRequest[] {
  const m = CHARACTER_MODELS[id];
  return m ? [{ id: modelAssetId(id), url: m.url, kind: "gltf", sizeHint: m.sizeHint }] : [];
}

export const CHARACTER_GROUPS: Readonly<Record<CharacterId, readonly AssetRequest[]>> = {
  blue: modelGroup("blue"),
  red: modelGroup("red"),
  yellow: modelGroup("yellow"),
  green: modelGroup("green"),
  kael: modelGroup("kael"),
  nova: modelGroup("nova"),
  rook: modelGroup("rook"),
  kaito: modelGroup("kaito"),
  taro: modelGroup("taro"),
  bolt: modelGroup("bolt"),
  gloop: modelGroup("gloop"),
  unit7: modelGroup("unit7"),
  sandbag: modelGroup("sandbag"),
};

export const STAGE_GROUPS: Readonly<Record<StageId, readonly AssetRequest[]>> = {
  neonIsland: [],
  sunsetIsland: [],
  voidIsland: [],
  training: [],
};

/** Grupo de una partida: personajes + escenario, sin ids repetidos. */
export function matchGroup(characters: readonly CharacterId[], stage: StageId): AssetRequest[] {
  const out: AssetRequest[] = [];
  const seen = new Set<string>();
  const add = (list: readonly AssetRequest[] | undefined): void => {
    for (const r of list ?? []) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
      }
    }
  };
  for (const c of characters) add(CHARACTER_GROUPS[c]);
  add(STAGE_GROUPS[stage]);
  return out;
}

/** Todas las entradas del manifiesto (para pruebas y auditoría de URLs). */
export function allManifestEntries(): AssetRequest[] {
  return [
    ...BOOT_GROUP,
    ...Object.values(CHARACTER_GROUPS).flat(),
    ...Object.values(STAGE_GROUPS).flat(),
  ];
}

/** `true` si la URL es relativa a la base: sin esquema, sin `//`, sin `/` inicial ni `..`. */
export function isRelativeAssetUrl(url: string): boolean {
  if (url.length === 0) return false;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url)) return false;
  if (url.startsWith("/") || url.startsWith("\\")) return false;
  return !url.split("/").includes("..");
}
