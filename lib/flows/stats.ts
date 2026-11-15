/** Numbers shown on one canvas card, counted in people. Client-safe. */
export type FlowStepStats = {
  sent: number;
  clicked: number;
  replied: number;
  /** People who tapped or clicked each button, by button id. */
  buttons: Record<string, number>;
};

/** Click-through rate in whole percent, or null when nothing was sent. */
export function ctr(clicks: number, sent: number): number | null {
  if (sent <= 0) return null;
  return Math.round((Math.min(clicks, sent) / sent) * 100);
}
