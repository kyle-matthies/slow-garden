import type { Plot } from "@/lib/garden/types";

/**
 * A topic's tending state, said the same way everywhere it appears
 * (market readiness plan, "Vocabulary").
 */
export type TendingState = "off" | "on" | "across";

export function tendingState(
  plot: Pick<Plot, "ai_enabled" | "cross_pollinate">,
): TendingState {
  return !plot.ai_enabled ? "off" : plot.cross_pollinate ? "across" : "on";
}

export const TENDING_LABEL: Record<TendingState, string> = {
  off: "Tending off",
  on: "Tending on",
  across: "Tending on · connects across topics",
};

export function tendingLabel(
  plot: Pick<Plot, "ai_enabled" | "cross_pollinate">,
): string {
  return TENDING_LABEL[tendingState(plot)];
}
