// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import menu1 from "../replays/menu1.json";
import { getMe, getRanking, getStats, getTokens, logout, pull, submitMatch, updateNickname } from "./api.ts";
import {
  DEV_START_COINS,
  disableDevAccount,
  enableDevAccount,
  isDevAccountActive,
  resetDevAccount,
} from "./devAccount.ts";

afterEach(() => {
  disableDevAccount();
  resetDevAccount();
});

describe("cuenta de prueba local", () => {
  it("simula sesión, apodo, gacha, ranking y cierre de sesión sin servidor", async () => {
    expect(isDevAccountActive()).toBe(false);
    enableDevAccount();
    const me = await getMe();
    expect(me?.id).toBe("dev-local");
    expect(me?.nicknameChosen).toBe(false);

    expect(await updateNickname("Probador")).toEqual({ kind: "ok", nickname: "Probador" });
    expect((await getMe())?.nickname).toBe("Probador");

    const res = await pull(10);
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.pulls).toHaveLength(10);
    expect(res.coins).toBe(DEV_START_COINS - res.cost);
    const tokens = await getTokens();
    expect(tokens!.common + tokens!.epic + tokens!.legendary).toBe(res.pulls.reduce((a, p) => a + p.tokens, 0));

    const rank = await getRanking("coins", "desc");
    expect(rank?.rows.some((r) => r.userId === "dev-local" && r.nickname === "Probador")).toBe(true);
    expect(rank?.myRank).not.toBeNull();

    await logout();
    expect(isDevAccountActive()).toBe(false);
  });

  it("puntúa partidas re-simulando el replay como el servidor", async () => {
    enableDevAccount();
    const replay = JSON.parse(JSON.stringify(menu1)) as { controllers: string[] };
    // Sin humano no puntúa (igual que el servidor).
    expect((await submitMatch(replay)).kind).toBe("not-ranked");
    replay.controllers[0] = "human";
    const out = await submitMatch(replay);
    expect(out.kind).toBe("ok");
    const stats = await getStats();
    expect(stats?.matchesPlayed).toBe(1);
    if (out.kind === "ok") expect(stats?.coins).toBe(DEV_START_COINS + out.reward.coinsEarned);
  });
});
