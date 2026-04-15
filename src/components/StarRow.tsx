"use client";

export function StarRow({
  value,
  onChange,
  size = "sm",
}: {
  value: number | null;
  onChange: (v: number) => void;
  size?: "sm" | "lg";
}) {
  const px = size === "lg" ? "text-4xl" : "text-xl";
  return (
    <div className="inline-flex gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          onClick={() => onChange(n)}
          className={`${px} leading-none transition ${
            value !== null && n <= value ? "text-yellow-400" : "text-gray-300 hover:text-yellow-200"
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
