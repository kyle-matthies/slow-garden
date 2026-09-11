import assert from "node:assert/strict";
import test from "node:test";
import {
  appendContinuation,
  queueContinuation,
  takeContinuation,
} from "./continuation.ts";

class MemoryStorage {
  values = new Map();
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

test("continuations queue, accumulate, and are taken once", () => {
  const storage = new MemoryStorage();
  assert.equal(queueContinuation(storage, "t", "s", "> one"), true);
  assert.equal(queueContinuation(storage, "t", "s", "> two"), true);
  assert.equal(takeContinuation(storage, "t", "other"), null);
  assert.equal(takeContinuation(storage, "t", "s"), "> one\n\n> two");
  assert.equal(takeContinuation(storage, "t", "s"), null);
  assert.equal(queueContinuation(null, "t", "s", "x"), false);
  assert.equal(takeContinuation(null, "t", "s"), null);
});

test("appending never discards the waiting draft", () => {
  assert.equal(appendContinuation("", "> q"), "> q");
  assert.equal(appendContinuation("   ", "> q"), "> q");
  assert.equal(appendContinuation("Mine\n\n", "> q"), "Mine\n\n> q");
});
