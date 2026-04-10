import type { CalendarEntry } from "./types";

interface Props {
  cursor: Date;
  entries: CalendarEntry[];
  onDayClick: (day: Date) => void;
  selectedDay: Date | null;
}

export function WeekView(_props: Props) {
  return <div />;
}
