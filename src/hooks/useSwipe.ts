import { useCallback, useEffect, useRef, useState } from "react";

export interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

export interface SwipeState {
  deltaX: number;
  swiping: boolean;
  direction: "left" | "right" | null;
}

const THRESHOLD = 100;

export function useSwipe(
  ref: React.RefObject<HTMLElement | null>,
  handlers: SwipeHandlers,
) {
  const [state, setState] = useState<SwipeState>({
    deltaX: 0,
    swiping: false,
    direction: null,
  });

  const startX = useRef(0);
  const active = useRef(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const onStart = useCallback((x: number) => {
    startX.current = x;
    active.current = true;
    setState({ deltaX: 0, swiping: true, direction: null });
  }, []);

  const onMove = useCallback((x: number) => {
    if (!active.current) return;
    const dx = x - startX.current;
    setState({
      deltaX: dx,
      swiping: true,
      direction: dx < -20 ? "left" : dx > 20 ? "right" : null,
    });
  }, []);

  const onEnd = useCallback(() => {
    if (!active.current) return;
    active.current = false;

    setState((prev) => {
      if (prev.deltaX < -THRESHOLD) {
        handlersRef.current.onSwipeLeft?.();
      } else if (prev.deltaX > THRESHOLD) {
        handlersRef.current.onSwipeRight?.();
      }
      return { deltaX: 0, swiping: false, direction: null };
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const touchStart = (e: TouchEvent) => onStart(e.touches[0].clientX);
    const touchMove = (e: TouchEvent) => {
      onMove(e.touches[0].clientX);
      if (active.current) e.preventDefault();
    };
    const touchEnd = () => onEnd();

    const mouseDown = (e: MouseEvent) => onStart(e.clientX);
    const mouseMove = (e: MouseEvent) => onMove(e.clientX);
    const mouseUp = () => onEnd();

    el.addEventListener("touchstart", touchStart, { passive: true });
    el.addEventListener("touchmove", touchMove, { passive: false });
    el.addEventListener("touchend", touchEnd);
    el.addEventListener("mousedown", mouseDown);
    window.addEventListener("mousemove", mouseMove);
    window.addEventListener("mouseup", mouseUp);

    return () => {
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
      el.removeEventListener("touchend", touchEnd);
      el.removeEventListener("mousedown", mouseDown);
      window.removeEventListener("mousemove", mouseMove);
      window.removeEventListener("mouseup", mouseUp);
    };
  }, [ref, onStart, onMove, onEnd]);

  return state;
}
