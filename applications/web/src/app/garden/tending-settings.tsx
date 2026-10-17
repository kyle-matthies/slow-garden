"use client";
import { useId, useMemo, useState } from "react";
import { setTendingPreferences } from "./actions";

/**
 * Overnight tending (ADR-008). Saving this preference never starts processing:
 * only topics that allow AI tending are read, only when something new was
 * written, and only once the service's tending gate is open.
 */
export function TendingSettings({
  account,
  aiAvailable,
  onSaved,
}: {
  account: { tendOvernight: boolean; timezone: string };
  aiAvailable: boolean;
  onSaved: () => void;
}) {
  const id = useId();
  const detected = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const zones = useMemo(() => {
    try {
      const list = Intl.supportedValuesOf("timeZone");
      return list.includes("UTC") ? list : ["UTC", ...list];
    } catch {
      return [account.timezone, detected].filter((z, i, a) => a.indexOf(z) === i);
    }
  }, [account.timezone, detected]);
  const [enabled, setEnabled] = useState(account.tendOvernight);
  const [timezone, setTimezone] = useState(
    account.timezone === "UTC" && !account.tendOvernight ? detected : account.timezone,
  );
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(nextEnabled: boolean, nextZone: string) {
    setSaving(true);
    setStatus("");
    try {
      const result = await setTendingPreferences(nextEnabled, nextZone);
      if (!result.ok) setStatus(result.message);
      else {
        setStatus(nextEnabled ? `Overnight tending is on for ${nextZone}.` : "Overnight tending is off.");
        onSaved();
      }
    } catch {
      setStatus("Could not save that preference. Please retry.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="tending-settings" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Overnight tending</h3>
      <p>
        Around 2 a.m. in your time zone, topics that allow AI tending are gently
        catalogued, and connections are noticed. This only happens when you
        have written something new. Returns appear quietly in the garden. Nothing
        is sent to you, and your writing is never changed.
      </p>
      {!aiAvailable && (
        <p className="form-note">
          AI tending isn&apos;t switched on for this service yet. Your choice is
          saved for when it is.
        </p>
      )}
      <label className="tending-toggle">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(e) => {
            setEnabled(e.target.checked);
            save(e.target.checked, timezone);
          }}
        />{" "}
        Tend my garden overnight
      </label>
      <label htmlFor={`${id}-zone`}>Your time zone</label>
      <select
        id={`${id}-zone`}
        value={timezone}
        disabled={saving}
        onChange={(e) => {
          setTimezone(e.target.value);
          save(enabled, e.target.value);
        }}
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replaceAll("_", " ")}
            {zone === detected ? " (this device)" : ""}
          </option>
        ))}
      </select>
      <p role="status" className="form-note">
        {status}
      </p>
    </section>
  );
}
