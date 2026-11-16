import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GardenStoreProvider } from "@/lib/garden/store/provider";
import { storeOf } from "@/lib/garden/store/testing/render";
import type { StoreSession } from "@/lib/garden/store/types";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { SignedInRedirect } from "./signed-in-redirect";

afterEach(() => {
  cleanup();
  router.replace.mockClear();
});

function mount(getSession: () => Promise<StoreSession>) {
  return render(
    <GardenStoreProvider store={storeOf({ getSession }, "browser")}>
      <SignedInRedirect />
    </GardenStoreProvider>,
  );
}

it("sends a signed-in visitor on to the garden and renders nothing", async () => {
  const { container } = mount(async () => ({ signedIn: true, tenantId: "synthetic", email: null }));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/garden"));
  expect(container).toBeEmptyDOMElement();
});

it("leaves a signed-out visitor on the page", async () => {
  const getSession = vi.fn(async (): Promise<StoreSession> => ({ signedIn: false }));
  mount(getSession);
  await waitFor(() => expect(getSession).toHaveBeenCalled());
  expect(router.replace).not.toHaveBeenCalled();
});

it("stays put when the session cannot be read (offline, no configuration)", async () => {
  const getSession = vi.fn(async (): Promise<StoreSession> => {
    throw new Error("unreachable");
  });
  mount(getSession);
  await waitFor(() => expect(getSession).toHaveBeenCalled());
  expect(router.replace).not.toHaveBeenCalled();
});

it("does not navigate after it has been unmounted", async () => {
  let answer: (session: StoreSession) => void = () => {};
  const view = mount(() => new Promise<StoreSession>((resolve) => (answer = resolve)));
  view.unmount();
  answer({ signedIn: true, tenantId: "synthetic", email: null });
  await Promise.resolve();
  expect(router.replace).not.toHaveBeenCalled();
});
