"use client";
import { useId, useMemo, useRef, useState } from "react";
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
      return [...new Set(["UTC", account.timezone, detected, ...list])];
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
  const confirmed = useRef({ enabled: account.tendOvernight, timezone: account.timezone });
  function restoreSaved() {
    setEnabled(confirmed.current.enabled);
    setTimezone(confirmed.current.timezone);
  }
  async function save(nextEnabled: boolean, nextZone: string) {
    setSaving(true);
    setStatus("");
    try {
      const result = await setTendingPreferences(nextEnabled, nextZone);
      if (!result.ok) {
        restoreSaved();
        setStatus(result.message);
      }
      else {
        confirmed.current = { enabled: nextEnabled, timezone: nextZone };
        setStatus(nextEnabled ? `Preference saved for ${nextZone}. This does not start or confirm an overnight run.` : "Preference saved: overnight tending is off.");
        onSaved();
      }
    } catch {
      restoreSaved();
      setStatus("Could not save that preference. Please retry.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="tending-settings" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Overnight tending</h3>
      <p>
        When the service&apos;s overnight schedule is active, tending checks for
        new writing around 2 a.m. in your time zone. It only reads topics that
        allow AI. Your saved preference does not confirm that scheduling is active.
        Results appear quietly in the garden; your writing is never changed.
      </p>
      {!aiAvailable && (
        <p className="form-note">
          AI reflection requests aren&apos;t available in this app right now.
          Your overnight preference can still be saved. Earlier manual results,
          if any, remain available.
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
