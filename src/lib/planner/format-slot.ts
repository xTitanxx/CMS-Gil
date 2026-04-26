import { formatInTimeZone } from "date-fns-tz";
import { SCHEDULE_TZ, FIXED_SLOT_HOURS } from "./fixed-slots";

/** Format a fixed-slot hour as "12pm", "3pm", "6pm", "9pm". */
export function formatSlotHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "am" : "pm";
  return `${h12}${ampm}`;
}

/** Format a UTC `scheduledAt` Date to its display hour in Asia/Jerusalem
 *  (e.g. "12pm" for the 12:00 IDT slot). */
export function formatScheduledTime(scheduledAt: Date): string {
  const hour = Number(formatInTimeZone(scheduledAt, SCHEDULE_TZ, "H"));
  return formatSlotHour(hour);
}

/** Hour for the Nth slot of a day (0→12, 1→15, 2→18, 3→21).
 *  Returns null when index is out of range. */
export function slotHourForIndex(index: number): number | null {
  return FIXED_SLOT_HOURS[index] ?? null;
}
