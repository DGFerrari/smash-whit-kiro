// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SELECTABLE_CHARACTERS } from "../engine/game/characters.ts";
import { SELECTABLE_STAGES } from "../engine/game/stages.ts";
import { characterLore, stageLore } from "../content/lore.ts";
import type { HandCursor } from "./handCursor.ts";
import { CharacterSelect, StageSelect } from "./selectScreens.ts";

const hand = { setGrabbing: () => {} } as unknown as HandCursor;

afterEach(() => {
  document.body.replaceChildren();
});

describe("CharacterSelect", () => {
  it("muestra cada personaje con retrato SVG y nombre visible", () => {
    new CharacterSelect({ onConfirm: vi.fn(), onBack: vi.fn() }, hand);
    const cells = document.querySelectorAll<HTMLElement>("#char-select .portrait:not(.is-random)");
    expect(cells.length).toBe(SELECTABLE_CHARACTERS.length);
    // Tarjeta extra "Aleatorio" (una sola).
    const random = document.querySelectorAll<HTMLElement>("#char-select .portrait.is-random");
    expect(random.length).toBe(1);
    expect(random[0].querySelector(".portrait-name")?.textContent).toBe("Aleatorio");
    SELECTABLE_CHARACTERS.forEach((id, i) => {
      expect(cells[i].querySelector("svg.kb-portrait")).not.toBeNull();
      expect(cells[i].querySelector(".portrait-name")?.textContent).toBe(characterLore(id).name);
    });
  });

  it("al enfocar un personaje sustituye nombre, título, lore y vista previa en la misma llamada", () => {
    const cs = new CharacterSelect({ onConfirm: vi.fn(), onBack: vi.fn() }, hand);
    const panel = document.querySelector<HTMLElement>("#char-select .kb-cs-panel")!;
    for (const id of SELECTABLE_CHARACTERS) {
      const cell = document.querySelector<HTMLElement>(`#char-select .portrait[data-character-id="${id}"]`)!;
      cell.dispatchEvent(new Event("pointerenter"));
      const lore = characterLore(id);
      expect(cs.focusedCharacter).toBe(id);
      expect(panel.querySelector(".kb-cs-name")?.textContent).toBe(lore.name);
      expect(panel.querySelector(".kb-cs-title")?.textContent).toBe(lore.title);
      expect(panel.querySelector(".kb-cs-lore")?.textContent).toBe(lore.lore);
      const art = panel.querySelectorAll(".kb-preview3d svg.kb-portrait");
      expect(art.length).toBe(1);
      expect(art[0].getAttribute("data-character-id")).toBe(id);
      expect(document.querySelectorAll("#char-select .portrait.is-focused").length).toBe(1);
      expect(cell.classList.contains("is-focused")).toBe(true);
    }
    // Aleatorio: panel propio.
    const randomCell = document.querySelector<HTMLElement>("#char-select .portrait.is-random")!;
    randomCell.dispatchEvent(new Event("pointerenter"));
    expect(cs.focusedCharacter).toBe("random");
    expect(panel.querySelector(".kb-cs-name")?.textContent).toBe("Aleatorio");
    expect(randomCell.classList.contains("is-focused")).toBe(true);
    cs.hide();
  });

  it("no permite continuar sin jugadores activos", () => {
    const onConfirm = vi.fn();
    new CharacterSelect({ onConfirm, onBack: vi.fn() }, hand);
    const go = document.querySelector<HTMLButtonElement>("#char-select .kb-select__go")!;
    expect(go.getAttribute("aria-disabled")).toBe("true");
    go.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("con teclado: Enter en un retrato elige por el slot activo (enciende P1 si hace falta)", () => {
    const onConfirm = vi.fn();
    new CharacterSelect({ onConfirm, onBack: vi.fn() }, hand);
    const [a, b] = SELECTABLE_CHARACTERS;
    const cell = (id: string) =>
      document.querySelector<HTMLButtonElement>(`#char-select .portrait[data-character-id="${id}"]`)!;
    // `click()` sin puntero (detail 0) = Enter / botón A.
    cell(a).click();
    const cards = document.querySelectorAll<HTMLElement>("#char-select .player-card");
    expect(cards[0].classList.contains("ready")).toBe(true);
    // Activar P2 como CPU lo convierte en el slot que elige.
    cards[1].querySelectorAll<HTMLButtonElement>(".player-card-tab")[1].click();
    expect(cards[1].classList.contains("kb-assigning")).toBe(true);
    cell(b).click();
    document.querySelector<HTMLButtonElement>("#char-select .kb-select__go")!.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual([a, b]);
    expect(onConfirm.mock.calls[0][1]).toEqual(["human", "cpu"]);
  });
});

describe("StageSelect", () => {
  it("muestra cada escenario con vista previa y nombre visible, y enfoca al pasar", () => {
    const ss = new StageSelect({ onConfirm: vi.fn(), onBack: vi.fn() }, hand);
    const cells = document.querySelectorAll<HTMLElement>("#stage-select .stage-cell");
    expect(cells.length).toBe(SELECTABLE_STAGES.length);
    SELECTABLE_STAGES.forEach((id, i) => {
      expect(cells[i].querySelector(".kb-stage-preview")).not.toBeNull();
      expect(cells[i].querySelector(".stage-name")?.textContent).toBe(stageLore(id).name);
    });
    const last = SELECTABLE_STAGES[SELECTABLE_STAGES.length - 1];
    cells[cells.length - 1].dispatchEvent(new Event("pointerenter"));
    expect(ss.focusedStage).toBe(last);
    expect(document.querySelector("#stage-select .stage-preview-name")?.textContent).toBe(stageLore(last).name);
    expect(document.querySelector("#stage-select .stage-preview-desc")?.textContent).toBe(
      stageLore(last).description,
    );
    expect(document.querySelectorAll("#stage-select .stage-cell.is-focused").length).toBe(1);
    const go = document.querySelector<HTMLButtonElement>("#stage-select .kb-select__go")!;
    expect(go.getAttribute("aria-disabled")).toBe("true");
  });
});
