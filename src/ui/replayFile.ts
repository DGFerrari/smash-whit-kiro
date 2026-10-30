import type { ReplayData } from "../engine/game/replay.ts";

/**
 * Import/export de replays como ARCHIVO .json. Vive en la capa de cliente (usa
 * `document`/`Blob`/`File`, APIs de navegador), fuera del motor de simulación
 * (`engine/`), que debe poder correr también en Node sin el DOM.
 */

/** Descarga un replay como archivo .json. */
export function downloadReplay(data: ReplayData): void {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = data.recordedAt.replace(/[:.]/g, "-");
  a.download = `smashb-replay-${data.mode}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lee y valida un replay desde un File (input type=file). */
export async function loadReplayFile(file: File): Promise<ReplayData> {
  const text = await file.text();
  const data = JSON.parse(text) as ReplayData;
  if (
    typeof data.version !== "number" ||
    typeof data.seed !== "number" ||
    !Array.isArray(data.steps)
  ) {
    throw new Error("Archivo de replay no válido.");
  }
  return data;
}
