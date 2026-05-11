import { Music } from "lucide-react";

const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ["#7c3aed", "#ec4899", "#f59e0b"], // violet → pink → amber
  ["#0ea5e9", "#6366f1", "#a855f7"], // sky → indigo → purple
  ["#10b981", "#06b6d4", "#3b82f6"], // emerald → cyan → blue
  ["#f97316", "#ef4444", "#db2777"], // orange → red → pink
  ["#14b8a6", "#84cc16", "#eab308"], // teal → lime → yellow
  ["#8b5cf6", "#3b82f6", "#06b6d4"], // violet → blue → cyan
  ["#e11d48", "#9333ea", "#1d4ed8"], // rose → purple → blue
  ["#65a30d", "#0891b2", "#7c3aed"], // lime → cyan → violet
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function AudioThumbnail({
  seed,
  size = 56,
  className,
  showIcon = true,
}: {
  seed: string;
  size?: number;
  className?: string;
  showIcon?: boolean;
}) {
  const h = hash(seed);
  const [c1, c2, c3] = PALETTES[h % PALETTES.length];
  const angle = (h >>> 3) % 360;

  // Three blobs at deterministic positions inside the 0–100 viewBox.
  const blobs = [0, 1, 2].map((i) => {
    const seed2 = (h >>> (i * 5)) & 0xffff;
    const cx = 20 + (seed2 % 60);
    const cy = 20 + ((seed2 >>> 4) % 60);
    const r = 28 + ((seed2 >>> 8) % 18);
    return { cx, cy, r };
  });

  const gradId = `aud-grad-${seed.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div
      className={
        className ??
        "relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md"
      }
      style={className ? undefined : { width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <linearGradient
            id={gradId}
            gradientTransform={`rotate(${angle} 50 50)`}
          >
            <stop offset="0%" stopColor={c1} />
            <stop offset="50%" stopColor={c2} />
            <stop offset="100%" stopColor={c3} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#${gradId})`} />
        {blobs.map((b, i) => (
          <circle
            key={i}
            cx={b.cx}
            cy={b.cy}
            r={b.r}
            fill="white"
            fillOpacity={0.12 + i * 0.04}
          />
        ))}
      </svg>
      {showIcon && (
        <Music
          className="relative h-1/2 w-1/2 text-white/90 drop-shadow-sm"
          strokeWidth={2.25}
        />
      )}
    </div>
  );
}
