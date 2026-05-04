"use client";

import { useEffect, useRef } from "react";

interface SyncedAudioVideoProps {
  videoSrc: string;
  audioSrc: string;
  className?: string;
  controls?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
}

export function SyncedAudioVideo({
  videoSrc,
  audioSrc,
  className,
  controls = true,
  autoPlay = false,
  loop = false,
}: SyncedAudioVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    const syncPlay = () => {
      audio.currentTime = video.currentTime;
      audio.play().catch(() => {});
    };
    const syncPause = () => audio.pause();
    const syncSeek = () => {
      audio.currentTime = video.currentTime;
    };

    video.addEventListener("play", syncPlay);
    video.addEventListener("pause", syncPause);
    video.addEventListener("seeked", syncSeek);

    return () => {
      video.removeEventListener("play", syncPlay);
      video.removeEventListener("pause", syncPause);
      video.removeEventListener("seeked", syncSeek);
    };
  }, [audioSrc]);

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        src={videoSrc}
        muted
        controls={controls}
        autoPlay={autoPlay}
        loop={loop}
        playsInline
        className={className}
      />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={audioSrc} preload="metadata" loop={loop} />
    </>
  );
}
