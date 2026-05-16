// Default fetch has no timeout — a hung remote (R2, TikTok, LinkedIn, IG) will
// silently drain the lambda's 300s budget and leave PublishRecord rows stuck
// in PROCESSING when the function is killed. Wrap every platform call with an
// AbortController so a hang gets caught and surfaced as a FAILED record.

export async function fetchWithTimeout(
  url: string | URL,
  init: (RequestInit & { timeoutMs?: number }) = {},
): Promise<Response> {
  const { timeoutMs = 30_000, signal: externalSignal, ...rest } = init;
  const ctl = new AbortController();
  const onExternalAbort = () => ctl.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) ctl.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => {
    ctl.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
