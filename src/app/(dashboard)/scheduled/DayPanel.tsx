import type { CalendarEntry } from "./types";

interface Props {
  day: Date;
  entries: CalendarEntry[];
  onClose: () => void;
  onScheduled: () => void;
}

export function DayPanel(_props: Props) {
  return <div />;
}
