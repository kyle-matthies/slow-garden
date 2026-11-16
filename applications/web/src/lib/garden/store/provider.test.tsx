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
});
