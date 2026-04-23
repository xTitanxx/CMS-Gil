import type { Season } from "@prisma/client";

export function currentSeason(date: Date): Season {
  const m = date.getMonth(); // 0..11
  if (m === 11 || m <= 1) return "WINTER";
  if (m >= 2 && m <= 4) return "SPRING";
  if (m >= 5 && m <= 7) return "SUMMER";
  return "FALL";
}

const ORDER: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

export function seasonFit(target: Season, postSeason: Season): number {
  if (target === postSeason) return 1;
  const a = ORDER.indexOf(target);
  const b = ORDER.indexOf(postSeason);
  const diff = Math.min(Math.abs(a - b), 4 - Math.abs(a - b));
  if (diff === 1) return 0.3;
  return -1;
}
