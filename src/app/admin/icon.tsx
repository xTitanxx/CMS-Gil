import { ImageResponse } from "next/og";

export const dynamic = "force-dynamic";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  const isDev = process.env.NODE_ENV === "development";

  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: isDev
            ? "linear-gradient(135deg, #f97316 0%, #ef4444 100%)"
            : "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {isDev ? (
          <span
            style={{
              color: "white",
              fontSize: 22,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            L
          </span>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 2,
              width: 18,
              height: 18,
            }}
          >
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: "rgba(255,255,255,0.9)",
                }}
              />
            ))}
          </div>
        )}
      </div>
    ),
    { ...size }
  );
}
