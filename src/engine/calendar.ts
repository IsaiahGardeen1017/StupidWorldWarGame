/** Gregorian UTC arithmetic is independent of the machine's clock/timezone. */
export const TICKS_PER_DAY = 3;
export const START_DATE = "1936-01-01";
export const SIMULATION_END_DATE = "1946-01-01";
const epoch = Date.UTC(1936, 0, 1);
const dayMs = 86400000;
export function tickForDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error("Use YYYY-MM-DD");
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(ms) ||
    new Date(ms).toISOString().slice(0, 10) !== date ||
    ms < epoch
  )
    throw Error("Invalid date or date before 1936-01-01");
  return ((ms - epoch) / dayMs) * TICKS_PER_DAY;
}
export const SIMULATION_END_TICK = tickForDate(SIMULATION_END_DATE);
export function calendar(tick: number) {
  if (!Number.isSafeInteger(tick) || tick < 0) throw Error("Invalid tick");
  const date = new Date(epoch + Math.floor(tick / TICKS_PER_DAY) * dayMs);
  return {
    date: date.toISOString().slice(0, 10),
    label: `${date.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    phase: ["Day · early", "Day · late", "Night"][tick % TICKS_PER_DAY],
    day: Math.floor(tick / TICKS_PER_DAY),
  };
}
