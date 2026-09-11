import assert from "node:assert/strict";
import test from "node:test";
import { isThoughtWritable } from "./writable.ts";

const base = () => ({
  gardens: [{ id: "g", name: "G", status: "active" }],
  plots: [
    {
      id: "p",
      garden_id: "g",
      name: "P",
      ai_enabled: false,
      cross_pollinate: false,
      archived_at: null,
      permission_version: 1,
    },
  ],
  seeds: [
    {
      id: "s",
      garden_id: "g",
      plot_id: "p",
      title: "S",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
  ],
});

test("active thought in active topic and garden is writable", () => {
  assert.equal(isThoughtWritable(base(), "s"), true);
});

test("archived thought is not writable", () => {
  const d = base();
  d.seeds[0].status = "archived";
  assert.equal(isThoughtWritable(d, "s"), false);
});

test("archived topic or garden blocks continuation", () => {
  const plot = base();
  plot.plots[0].archived_at = "2026-02-01T00:00:00Z";
  assert.equal(isThoughtWritable(plot, "s"), false);
  const garden = base();
  garden.gardens[0].status = "archived";
  assert.equal(isThoughtWritable(garden, "s"), false);
});

test("unknown thought is not writable", () => {
  assert.equal(isThoughtWritable(base(), "missing"), false);
});
