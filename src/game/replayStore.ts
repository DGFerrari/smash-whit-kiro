import type { ReplayData } from "./replay.ts";

/**
 * Almacén de replays DENTRO del navegador (localStorage), para no depender de
 * descargar/subir archivos. Cada partida terminada se guarda aquí y la lista de
 * replays la lee de aquí.
 *
 * Decisión: usamos localStorage (patrón idéntico al de core/bindings.ts) porque
 * un replay es pequeño (solo inputs empaquetados + seed). Para no superar el
 * límite (~5 MB), podamos a MAX_REPLAYS entradas (se borra la más antigua).
 * Si en el futuro se graban partidas muy largas o se quieren guardar muchas,
 * convendría migrar a IndexedDB (API asíncrona, sin límite práctico).
 */

const STORAGE_KEY = "smashb.replays.v1";
const MAX_REPLAYS = 30;

/** Entrada guardada: un id estable + el replay completo. */
export interface StoredReplay {
  id: string;
  data: ReplayData;
}

/** Genera un id único y razonablemente corto. */
function makeId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readAll(): StoredReplay[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredReplay[];
    if (!Array.isArray(parsed)) return [];
    // Filtra entradas corruptas (sin id o sin steps).
    return parsed.filter(
      (e) => e && typeof e.id === "string" && e.data && Array.isArray(e.data.steps),
    );
  } catch {
    return [];
  }
}

function writeAll(list: StoredReplay[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage lleno o no disponible: lo ignoramos en silencio. En el peor
    // caso el replay no se guarda, pero el juego sigue funcionando.
  }
}

/** Lista los replays guardados, del más reciente al más antiguo. */
export function listReplays(): StoredReplay[] {
  const list = readAll();
  // Orden descendente por fecha de grabación.
  return list.sort(
    (a, b) =>
      new Date(b.data.recordedAt).getTime() -
      new Date(a.data.recordedAt).getTime(),
  );
}

/**
 * Guarda un replay nuevo. Devuelve su id. Poda las entradas más antiguas si se
 * supera MAX_REPLAYS.
 */
export function saveReplay(data: ReplayData): string {
  const list = readAll();
  const id = makeId();
  list.push({ id, data });
  // Ordena por fecha (reciente primero) y recorta.
  list.sort(
    (a, b) =>
      new Date(b.data.recordedAt).getTime() -
      new Date(a.data.recordedAt).getTime(),
  );
  writeAll(list.slice(0, MAX_REPLAYS));
  return id;
}

/** Importa un replay (desde archivo) al almacén. Devuelve su id. */
export function importReplay(data: ReplayData): string {
  return saveReplay(data);
}

/** Borra un replay por id. */
export function deleteReplay(id: string): void {
  const list = readAll().filter((e) => e.id !== id);
  writeAll(list);
}

/** Obtiene un replay por id, o null. */
export function getReplay(id: string): StoredReplay | null {
  return readAll().find((e) => e.id === id) ?? null;
}
