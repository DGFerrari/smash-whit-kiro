import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAssetLoader,
  type AssetRequest,
  type FetchLike,
  type FetchResponseLike,
} from "./assetLoader";
import { BOOT_GROUP, allManifestEntries, isRelativeAssetUrl } from "./manifest";

/** Respuesta simulada con cuerpo troceado. */
function chunkedResponse(chunks: number[][], opts: { contentLength?: number; status?: number } = {}): FetchResponseLike {
  const status = opts.status ?? 200;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new Uint8Array(c));
      controller.close();
    },
  });
  const headers = new Map<string, string>();
  if (opts.contentLength !== undefined) headers.set("content-length", String(opts.contentLength));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
    body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

const req = (id: string, extra: Partial<AssetRequest> = {}): AssetRequest => ({
  id,
  url: `models/${id}.glb`,
  kind: "gltf",
  ...extra,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createAssetLoader", () => {
  it("lee un stream troceado con Content-Length y resuelve la URL contra la base", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      chunkedResponse([[1, 2], [3, 4, 5], [6]], { contentLength: 6 }),
    );
    const loader = createAssetLoader({ fetch: fetchMock, baseUrl: "/kirobrawl/" });
    const handle = loader.load([req("a")]);
    const result = await handle.done;

    expect(fetchMock).toHaveBeenCalledWith("/kirobrawl/models/a.glb", expect.anything());
    const out = result.get("a");
    expect(out?.status).toBe("loaded");
    if (out?.status === "loaded") {
      expect([...new Uint8Array(out.data)]).toEqual([1, 2, 3, 4, 5, 6]);
      expect(out.fromCache).toBe(false);
    }
    expect(handle.progress()).toMatchObject({ bytesLoaded: 6, bytesTotal: 6, percent: 100 });
  });

  it("reutiliza la Caché_Assets sin nueva petición y la cuenta como procesada desde el inicio", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => chunkedResponse([[9, 9, 9]]));
    const loader = createAssetLoader({ fetch: fetchMock, baseUrl: "/" });
    await loader.load([req("a")]).done;
    expect(loader.cached("a")?.byteLength).toBe(3);

    const second = loader.load([req("a")]);
    expect(second.progress()).toMatchObject({ assetsDone: 1, percent: 100 });
    const out = (await second.done).get("a");
    expect(out).toMatchObject({ status: "loaded", fromCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clasifica 404, error de red y JSON inválido", async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (url.includes("missing")) return chunkedResponse([], { status: 404 });
      if (url.includes("broken")) throw new TypeError("Failed to fetch");
      return chunkedResponse([[0x7b]]); // "{" ⇒ JSON inválido
    });
    const loader = createAssetLoader({ fetch: fetchMock, baseUrl: "/" });
    const result = await loader.load([
      req("missing"),
      req("broken"),
      req("bad", { kind: "json", url: "data/bad.json" }),
    ]).done;
    expect(result.get("missing")).toEqual({ status: "failed", reason: "notFound" });
    expect(result.get("broken")).toEqual({ status: "failed", reason: "network" });
    expect(result.get("bad")).toEqual({ status: "failed", reason: "parse" });
  });

  it("marca timeout a los pendientes al vencer el tiempo límite y emite progreso", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<FetchLike>(() => new Promise<FetchResponseLike>(() => undefined));
    const loader = createAssetLoader({ fetch: fetchMock, baseUrl: "/" });
    const handle = loader.load([req("slow", { sizeHint: 1000 })]);
    const seen: number[] = [];
    handle.onProgress((p) => seen.push(p.percent));

    await vi.advanceTimersByTimeAsync(59_999);
    expect(handle.progress().percent).toBe(0);
    await vi.advanceTimersByTimeAsync(1);

    const result = await handle.done;
    expect(result.get("slow")).toEqual({ status: "failed", reason: "timeout" });
    expect(handle.progress().percent).toBe(100);
    expect(seen[seen.length - 1]).toBe(100);
  });
});

describe("manifest", () => {
  it("solo contiene URLs relativas a BASE_URL", () => {
    expect(BOOT_GROUP.length).toBeGreaterThan(0);
    for (const e of allManifestEntries()) expect(isRelativeAssetUrl(e.url), e.url).toBe(true);
    expect(isRelativeAssetUrl("https://cdn.example.com/x.woff2")).toBe(false);
    expect(isRelativeAssetUrl("/fonts/x.woff2")).toBe(false);
  });
});
