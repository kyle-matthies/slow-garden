import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Garden, Plot } from "@/lib/garden/types";
import { ImportForm } from "./import-form";

const mocks = vi.hoisted(() => ({ importThought: vi.fn(), parse: vi.fn(), push: vi.fn() }));
vi.mock("./actions", () => ({ importThought: mocks.importThought }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/garden/import", async (original) => ({
  ...await original<typeof import("@/lib/garden/import")>(),
  parseImportFile: mocks.parse,
}));

const gardens = [{ id: "g1", name: "Garden one" }, { id: "g2", name: "Garden two" }] as Garden[];
const plots = [{ id: "p1", name: "Notes" }, { id: "p2", name: "Questions" }] as Plot[];
const thought = (name: string, body = "Synthetic writing") => ({
  title: name.replace(/\.md$/, ""), sourceName: name, hash: name,
  entries: [{ body, date: "2026-10-01", hash: name }], warnings: [],
});
function file(name: string, text: () => Promise<string> = async () => "Synthetic writing") {
  return { name, size: 20, lastModified: 10, text };
}
function choose(files: ReturnType<typeof file>[]) {
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.importThought.mockReset();
  mocks.parse.mockReset().mockImplementation(async (input: { name: string; text: string }) => thought(input.name, input.text));
});
afterEach(cleanup);

it("reports partial completion and retries only the failed thought with its original title and destination", async () => {
  mocks.importThought
    .mockResolvedValueOnce({ ok: true, id: "s1", created: 1, skipped: 0 })
    .mockResolvedValueOnce({ ok: false, message: "Could not save this thought." })
    .mockResolvedValueOnce({ ok: true, id: "s2", created: 0, skipped: 1 });
  render(<ImportForm gardens={gardens} gardenId="g1" plots={plots} />);
  choose([file("One.md"), file("Two.md")]);
  await screen.findByDisplayValue("Two");
  expect(mocks.importThought).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Import 2 thoughts into Notes" }));
  await screen.findByText(/1 thought imported\. 1 thought needs a retry/);
  expect(screen.getByLabelText("Title for Two.md")).toBeDisabled();
  expect(screen.getByLabelText("Topic")).toBeDisabled();
  expect(screen.getByRole("link", { name: "Open One" })).toHaveAttribute("href", "/garden?garden=g1&topic=p1&thought=s1");
  fireEvent.click(screen.getByRole("button", { name: "Retry 1 thought into Notes" }));
  await screen.findByText(/2 thoughts imported\. All attempted thoughts are saved/);
  expect(mocks.importThought).toHaveBeenCalledTimes(3);
  expect(mocks.importThought.mock.calls[2][0]).toEqual(mocks.importThought.mock.calls[1][0]);
  expect(screen.getByRole("link", { name: "Open Two" })).toHaveAttribute("href", "/garden?garden=g1&topic=p1&thought=s2");
});

it("recovers a thrown request without claiming that the import completed", async () => {
  mocks.importThought.mockRejectedValueOnce(new Error("Synthetic network failure"));
  render(<ImportForm gardens={gardens} gardenId="g1" plots={plots} />);
  choose([file("Retry.md")]);
  await screen.findByDisplayValue("Retry");
  fireEvent.click(screen.getByRole("button", { name: "Import 1 thought into Notes" }));
  await screen.findByText(/The connection was interrupted/);
  expect(screen.getByText(/0 thoughts imported\. 1 thought needs a retry/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open garden" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry 1 thought into Notes" })).toBeEnabled();
});

it("lets an invalid preview title be corrected before any import attempt", async () => {
  render(<ImportForm gardens={gardens} gardenId="g1" plots={plots} />);
  choose([file("Title.md")]);
  const title = await screen.findByLabelText("Title for Title.md");
  fireEvent.change(title, { target: { value: "   " } });
  expect(screen.getByRole("button", { name: "Import 1 thought into Notes" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("title between 1 and 160");
  fireEvent.change(title, { target: { value: "Corrected title" } });
  expect(screen.getByRole("button", { name: "Import 1 thought into Notes" })).toBeEnabled();
  expect(mocks.importThought).not.toHaveBeenCalled();
});

it("locks controls while saving and releases the destination only for a deliberate new import", async () => {
  const saving = deferred<{ ok: true; id: string; created: number; skipped: number }>();
  mocks.importThought.mockReturnValueOnce(saving.promise);
  render(<ImportForm gardens={gardens} gardenId="g1" plots={plots} />);
  choose([file("Pending.md")]);
  await screen.findByDisplayValue("Pending");
  fireEvent.click(screen.getByRole("button", { name: "Import 1 thought into Notes" }));
  await waitFor(() => expect(screen.getByLabelText("Garden")).toBeDisabled());
  expect(screen.getByLabelText("Files")).toBeDisabled();
  expect(screen.getByLabelText("Title for Pending.md")).toBeDisabled();
  await act(async () => saving.resolve({ ok: true, id: "s1", created: 1, skipped: 0 }));
  fireEvent.click(screen.getByRole("button", { name: "Start another import" }));
  expect(screen.getByLabelText("Garden")).toBeEnabled();
  expect(screen.getByLabelText("Topic")).toBeEnabled();
  expect(screen.queryByLabelText("Title for Pending.md")).not.toBeInTheDocument();
});

it("isolates an unreadable file while preserving the other previews", async () => {
  render(<ImportForm gardens={gardens} gardenId="g1" plots={plots} />);
  choose([file("Unreadable.md", async () => { throw new Error("Synthetic read failure"); }), file("Good.md")]);
  await screen.findByDisplayValue("Good");
  expect(screen.getByText(/Could not read this file/)).toBeInTheDocument();
  expect(screen.getByLabelText("Include Unreadable.md")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Import 1 thought into Notes" })).toBeEnabled();
  expect(mocks.importThought).not.toHaveBeenCalled();
});

it("keeps the newest preview when an older file selection finishes late", async () => {
  const old = deferred<string>();
  const read = vi.fn(() => old.promise);
  render(<ImportForm gardens={gardens} gardenId="g1" plots={plots} />);
  choose([file("Old.md", read)]);
  await waitFor(() => expect(read).toHaveBeenCalled());
  choose([file("New.md")]);
  await screen.findByDisplayValue("New");
  await act(async () => old.resolve("Older synthetic writing"));
  expect(screen.getByDisplayValue("New")).toBeInTheDocument();
  expect(screen.queryByDisplayValue("Old")).not.toBeInTheDocument();
});

it("keeps duplicate file names independent and prevents submission to a stale topic", async () => {
  const { rerender } = render(<ImportForm gardens={gardens} gardenId="g1" plots={plots} />);
  choose([file("Same.md", async () => "First synthetic body"), file("Same.md", async () => "Second synthetic body")]);
  await waitFor(() => expect(screen.getAllByLabelText("Include Same.md")).toHaveLength(2));
  fireEvent.click(screen.getAllByLabelText("Include Same.md")[0]);
  expect(screen.getAllByLabelText("Include Same.md")[1]).toBeChecked();
  rerender(<ImportForm gardens={gardens} gardenId="g2" plots={[{ id: "p9", name: "Other topic" }] as Plot[]} />);
  expect(screen.getByRole("button", { name: "Import 1 thought into topic" })).toBeDisabled();
  expect(screen.getByLabelText("Topic")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Topic"), { target: { value: "p9" } });
  expect(screen.getByRole("button", { name: "Import 1 thought into Other topic" })).toBeEnabled();
});
