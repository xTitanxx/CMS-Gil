import { useState, useCallback } from "react";

type Status = "idle" | "loading" | "success" | "error";

export interface AsyncState {
  status: Status;
  message: string;
  isLoading: boolean;
}

export function useAsync<T = unknown>(): AsyncState & {
  run: (fn: () => Promise<T>, successMessage?: string) => Promise<T | undefined>;
  reset: () => void;
} {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const run = useCallback(
    async (fn: () => Promise<T>, successMessage = "Done"): Promise<T | undefined> => {
      setStatus("loading");
      setMessage("");
      try {
        const result = await fn();
        setStatus("success");
        setMessage(successMessage);
        return result;
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : String(err));
        return undefined;
      }
    },
    []
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setMessage("");
  }, []);

  return { status, message, isLoading: status === "loading", run, reset };
}
