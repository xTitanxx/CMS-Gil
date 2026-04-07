import { useState, useCallback, useRef } from "react";

export function useConfirm(onConfirm: () => void): {
  confirming: boolean;
  trigger: () => void;
} {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(() => {
    if (confirming) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setConfirming(false);
      onConfirm();
    } else {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 3000);
    }
  }, [confirming, onConfirm]);

  return { confirming, trigger };
}
