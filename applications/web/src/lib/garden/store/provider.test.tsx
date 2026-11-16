import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GardenData } from "../types";
import { GardenStoreProvider, useGardenData, useGardenStore } from "./provider";
import type { GardenLoad, GardenStore } from "./types";

const garden = (id: string): GardenData => ({
  tenantId: "t",
  gardens: [{ id, name: id, status: "active" }],
  gardenId: id,
  plots: [],
  seeds: [],
  entries: [],
  aiAvailable: false,
});

function storeWith(loadGarden: GardenStore["loadGarden"]): GardenStore {
  return { kind: "browser", loadGarden } as unknown as GardenStore;
}
const wrap = (store: GardenStore) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <GardenStoreProvider store={store}>{children}</GardenStoreProvider>;
  };

describe("useGardenStore", () => {
  it("returns the provided store", () => {
    const store = storeWith(vi.fn());
    function Probe() {
      return <p>{useGardenStore().kind}</p>;
    }
    render(<Probe />, { wrapper: wrap(store) });
    expect(screen.getByText("browser")).toBeInTheDocument();
  });

  it("fails loudly outside a provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useGardenStore())).toThrow(/GardenStoreProvider/);
    quiet.mockRestore();
  });
});

describe("useGardenData", () => {
  it("shows server-rendered data at once and does not load again", async () => {
    const load = vi.fn();
    const { result } = renderHook(() => useGardenData("g1", garden("g1")), { wrapper: wrap(storeWith(load)) });
    expect(result.current.status).toBe("ready");
    expect(result.current.data?.gardenId).toBe("g1");
    await act(async () => {});
    expect(load).not.toHaveBeenCalled();
  });

  it("loads on mount without initial data, and reloads on request", async () => {
    const load = vi
      .fn<GardenStore["loadGarden"]>()
      .mockResolvedValueOnce({ signedIn: true, data: garden("g1") })
      .mockResolvedValueOnce({ signedIn: true, data: { ...garden("g1"), plots: [{ id: "p" } as never] } });
    const { result } = renderHook(() => useGardenData("g1"), { wrapper: wrap(storeWith(load)) });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(load).toHaveBeenCalledExactlyOnceWith("g1");
    await act(() => result.current.reload());
    expect(result.current.data?.plots).toHaveLength(1);
  });

  it("loads again when the requested garden changes", async () => {
    const load = vi.fn<GardenStore["loadGarden"]>(async (id) => ({ signedIn: true, data: garden(id ?? "default") }));
    const { result, rerender } = renderHook(({ id }) => useGardenData(id, garden("g1")), {
      wrapper: wrap(storeWith(load)),
      initialProps: { id: "g1" },
    });
    rerender({ id: "g2" });
    await waitFor(() => expect(result.current.data?.gardenId).toBe("g2"));
    expect(load).toHaveBeenCalledExactlyOnceWith("g2");
  });

  it("reports a signed-out session instead of redirecting", async () => {
    const { result } = renderHook(() => useGardenData(), {
      wrapper: wrap(storeWith(async () => ({ signedIn: false }))),
    });
    await waitFor(() => expect(result.current.status).toBe("signed-out"));
    expect(result.current.data).toBeUndefined();
  });

  it("keeps the last good data when a reload fails", async () => {
    const load = vi.fn<GardenStore["loadGarden"]>().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useGardenData("g1", garden("g1")), { wrapper: wrap(storeWith(load)) });
    await act(() => result.current.reload());
    expect(result.current.status).toBe("error");
    expect(result.current.data?.gardenId).toBe("g1");
  });

  it("ignores a slow earlier reload that finishes after a later one", async () => {
    let release!: (value: GardenLoad) => void;
    const slow = new Promise<GardenLoad>((resolve) => (release = resolve));
    const load = vi
      .fn<GardenStore["loadGarden"]>()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce({ signedIn: true, data: garden("newer") });
    const { result } = renderHook(() => useGardenData("g1", garden("g1")), { wrapper: wrap(storeWith(load)) });
    let first!: Promise<void>;
    act(() => {
      first = result.current.reload();
    });
    await act(() => result.current.reload());
    await act(async () => {
      release({ signedIn: true, data: garden("older") });
      await first;
    });
    expect(result.current.data?.gardenId).toBe("newer");
  });

  /** Loads answered by hand, in whatever order a test chooses. */
  function manual() {
    const pending: { id: string | undefined; resolve: (v: GardenLoad) => void; reject: (e: unknown) => void }[] = [];
    const load = vi.fn<GardenStore["loadGarden"]>(
      (id) => new Promise<GardenLoad>((resolve, reject) => pending.push({ id, resolve, reject })),
    );
    const answer = (id: string) => pending.find((p) => p.id === id)!;
    return { load, answer, pending };
  }
  const storeFor = (load: GardenStore["loadGarden"], tenantId: string | null = "t") =>
    ({
      kind: "browser",
      loadGarden: load,
      getSession: async () => (tenantId ? { signedIn: true, tenantId, email: null } : { signedIn: false }),
    }) as unknown as GardenStore;

  it("never offers another garden's data as the requested garden: loading, then a failed load", async () => {
    const { load, answer } = manual();
    const { result, rerender } = renderHook(({ id }) => useGardenData(id, garden("a")), {
      wrapper: wrap(storeFor(load)),
      initialProps: { id: "a" },
    });
    rerender({ id: "b" });
    // From the first render under the new address, before any effect has run.
    expect(result.current.data).toBeUndefined();
    expect(result.current.status).toBe("loading");
    expect(result.current.previous?.gardenId).toBe("a");
    await act(async () => answer("b").reject(new Error("offline")));
    expect(result.current.status).toBe("error");
    expect(result.current.data).toBeUndefined();
    expect(result.current.previous?.gardenId).toBe("a");
    // Back at the first garden its last good data is the garden again, and it is re-read.
    rerender({ id: "a" });
    expect(result.current.data?.gardenId).toBe("a");
    await act(async () => answer("a").resolve({ signedIn: true, data: garden("a") }));
    expect(result.current.status).toBe("ready");
    expect(result.current.previous).toBeUndefined();
  });

  it("drops a slow answer for garden A that arrives after the person moved to garden B", async () => {
    const { load, answer } = manual();
    const { result, rerender } = renderHook(({ id }) => useGardenData(id), {
      wrapper: wrap(storeFor(load)),
      initialProps: { id: "a" },
    });
    rerender({ id: "b" });
    await act(async () => answer("a").resolve({ signedIn: true, data: garden("a") }));
    expect(result.current.data).toBeUndefined();
    expect(result.current.status).toBe("loading");
    await act(async () => answer("b").resolve({ signedIn: true, data: garden("b") }));
    expect(result.current.data?.gardenId).toBe("b");
    // A late failure of the first request changes nothing either.
    const { load: load2, pending } = manual();
    const second = renderHook(({ id }) => useGardenData(id), { wrapper: wrap(storeFor(load2)), initialProps: { id: "a" } });
    second.rerender({ id: "b" });
    await act(async () => pending[1].resolve({ signedIn: true, data: garden("b") }));
    await act(async () => pending[0].reject(new Error("late")));
    expect(second.result.current.status).toBe("ready");
    expect(second.result.current.data?.gardenId).toBe("b");
  });

  it("settles on the last garden when switching quickly, whatever order the answers come in", async () => {
    const { load, answer } = manual();
    const { result, rerender } = renderHook(({ id }) => useGardenData(id), {
      wrapper: wrap(storeFor(load)),
      initialProps: { id: "a" },
    });
    rerender({ id: "b" });
    rerender({ id: "c" });
    await act(async () => answer("c").resolve({ signedIn: true, data: garden("c") }));
    await act(async () => answer("b").resolve({ signedIn: true, data: garden("b") }));
    await act(async () => answer("a").reject(new Error("offline")));
    expect(result.current.status).toBe("ready");
    expect(result.current.data?.gardenId).toBe("c");
    expect(load.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
  });

  it("a reload taken from an earlier render reads the garden now requested, not the earlier one", async () => {
    const load = vi.fn<GardenStore["loadGarden"]>(async (id) => ({ signedIn: true, data: garden(id ?? "default") }));
    const { result, rerender } = renderHook(({ id }) => useGardenData(id, garden("a")), {
      wrapper: wrap(storeFor(load)),
      initialProps: { id: "a" },
    });
    const early = result.current.reload;
    rerender({ id: "b" });
    await waitFor(() => expect(result.current.data?.gardenId).toBe("b"));
    await act(() => early());
    expect(load.mock.calls.map((c) => c[0])).toEqual(["b", "b"]);
    expect(result.current.status).toBe("ready");
    expect(result.current.data?.gardenId).toBe("b");
  });

  it("drops kept data when a re-read fails and the session is now another account", async () => {
    const load = vi.fn<GardenStore["loadGarden"]>().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useGardenData("a", garden("a")), { wrapper: wrap(storeFor(load, "someone-else")) });
    await act(() => result.current.reload());
    expect(result.current.status).toBe("error");
    expect(result.current.data).toBeUndefined();
    expect(result.current.previous).toBeUndefined();
  });

  it("reports signed out when a re-read fails and there is no session any more", async () => {
    const load = vi.fn<GardenStore["loadGarden"]>().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useGardenData("a", garden("a")), { wrapper: wrap(storeFor(load, null)) });
    await act(() => result.current.reload());
    expect(result.current.status).toBe("signed-out");
    expect(result.current.data).toBeUndefined();
  });

  it("replaces the data when a re-read answers for another account", async () => {
    const load = vi.fn<GardenStore["loadGarden"]>(async () => ({ signedIn: true, data: { ...garden("z"), tenantId: "other" } }));
    const { result } = renderHook(() => useGardenData("a", garden("a")), { wrapper: wrap(storeFor(load, "other")) });
    await act(() => result.current.reload());
    expect(result.current.data?.tenantId).toBe("other");
    expect(result.current.data?.gardenId).toBe("z");
  });
});
