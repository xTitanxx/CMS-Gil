"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

// Derive a poster URL from a video URL by swapping the extension to `.poster.jpg`.
// Mirrors the server-side helper in `src/lib/storage.ts` so callers without an
// explicit poster field still get a sensible placeholder.
export function posterUrlFor(videoUrl: string): string {
  return videoUrl.replace(/\.[^/.]+$/, ".poster.jpg");
}

type LazyVideoProps = {
  src: string;
  poster?: string | null;
  /** Classes applied to the wrapping <div>. */
  wrapperClassName?: string;
  /** Classes applied to both the <video> and the <img> placeholder so styling stays consistent. */
  className?: string;
  style?: CSSProperties;
  /** When the wrapper is within this many viewports of the viewport, mount the <video>. */
  mountMargin?: string;
  /** When the wrapper is more than this many viewports away, unmount and show the poster again. */
  unmountMargin?: string;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  playsInline?: boolean;
  preload?: "none" | "metadata" | "auto";
  videoRef?: React.Ref<HTMLVideoElement>;
  alt?: string;
  /** When provided, the wrapper reserves this aspect ratio before any media loads, preventing CLS. */
  naturalWidth?: number;
  naturalHeight?: number;
};

/**
 * Renders a poster <img> until the element is near the viewport, then mounts a
 * real <video>. When the element scrolls far enough away, the <video> is
 * unmounted again and the poster comes back. This caps the number of
 * concurrent <video> elements (and decoder slots) on iOS, which previously
 * caused the PWA to freeze for several seconds and lock up scrolling.
 */
export function LazyVideo({
  src,
  poster,
  wrapperClassName,
  className,
  style,
  mountMargin = "100% 0px",
  unmountMargin = "200% 0px",
  controls,
  autoPlay,
  muted,
  loop,
  playsInline = true,
  preload = "metadata",
  videoRef,
  alt = "",
  naturalWidth,
  naturalHeight,
}: LazyVideoProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const posterSrc = poster ?? posterUrlFor(src);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }

    // Two observers with different margins create hysteresis: mount when
    // close, only unmount when meaningfully far away. Avoids thrashing at the
    // boundary.
    const mountIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(true);
        }
      },
      { rootMargin: mountMargin },
    );
    const unmountIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) setActive(false);
        }
      },
      { rootMargin: unmountMargin },
    );

    mountIO.observe(el);
    unmountIO.observe(el);
    return () => {
      mountIO.disconnect();
      unmountIO.disconnect();
    };
  }, [mountMargin, unmountMargin]);

  const wrapperStyle: CSSProperties = {
    ...style,
    ...(naturalWidth && naturalHeight
      ? { aspectRatio: `${naturalWidth} / ${naturalHeight}` }
      : {}),
  };

  return (
    <div ref={wrapperRef} className={wrapperClassName} style={wrapperStyle}>
      {active ? (
        <video
          ref={videoRef}
          src={src}
          poster={posterSrc}
          controls={controls}
          autoPlay={autoPlay}
          muted={muted}
          loop={loop}
          playsInline={playsInline}
          preload={preload}
          className={className}
          // Tells the browser this element doesn't handle vertical pans, so a
          // finger swipe over the video scrolls the feed instead of getting
          // captured by the video controls. Without this, scrolling on mobile
          // gets "stuck" whenever the user's thumb lands on a video tile.
          style={{ touchAction: "pan-y" }}
        />
      ) : posterFailed ? (
        <div className={className} aria-hidden />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setPosterFailed(true)}
          className={className}
        />
      )}
    </div>
  );
}
