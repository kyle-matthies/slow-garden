import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWith, storeOf } from "@/lib/garden/store/testing/render";
import { LoginForm } from "./login-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const store = (kind: "server" | "browser", signedIn = false) => {
  const requestEmailCode = vi.fn().mockResolvedValue({ ok: true });
  const verifyEmailCode = vi.fn().mockResolvedValue({ ok: true });
  const getSession = vi.fn().mockResolvedValue(signedIn ? { signedIn: true, tenantId: "t", email: null } : { signedIn: false });
  return { requestEmailCode, verifyEmailCode, getSession, store: storeOf({ requestEmailCode, verifyEmailCode, getSession }, kind) };
};
async function signIn() {
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "ada@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
  fireEvent.change(await screen.findByLabelText("Six-digit code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Open my garden" }));
}

it("server mode: asks for a code that may create the account, verifies it, then opens the garden as before", async () => {
  const s = store("server");
  renderWith(s.store)(<LoginForm configured />);
  await signIn();
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/garden"));
  expect(router.refresh).toHaveBeenCalledOnce();
  expect(s.requestEmailCode.mock.calls).toEqual([["ada@example.test", { createAccount: true }]]);
  expect(s.verifyEmailCode.mock.calls).toEqual([["ada@example.test", "123456"]]);
  // The server decides where a signed-in visitor goes; the form asks nothing.
  expect(s.getSession).not.toHaveBeenCalled();
});

it("shows the auth service's own message when a step fails", async () => {
  const s = store("server");
  s.requestEmailCode.mockResolvedValueOnce({ ok: false, message: "Email rate limit exceeded" });
  renderWith(s.store)(<LoginForm configured />);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "ada@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
  expect(await screen.findByText("Email rate limit exceeded")).toHaveAttribute("data-error", "true");
  expect(screen.queryByLabelText("Six-digit code")).toBeNull();
});

it("does nothing and says so when the service is not configured", () => {
  const s = store("server");
  renderWith(s.store)(<LoginForm configured={false} />);
  expect(screen.getByText("Service configuration is pending.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Email me a sign-in code" })).toBeDisabled();
});

it("browser mode: a visitor who is already signed in is sent on to the garden", async () => {
  const s = store("browser", true);
  renderWith(s.store)(<LoginForm configured />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/garden"));
});

it("browser mode, inside the garden: a verified code hands back to the page instead of navigating", async () => {
  const s = store("browser");
  const onSignedIn = vi.fn();
  renderWith(s.store)(<LoginForm configured onSignedIn={onSignedIn} />);
  await signIn();
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
  expect(router.replace).not.toHaveBeenCalled();
  expect(s.getSession).not.toHaveBeenCalled();
});
