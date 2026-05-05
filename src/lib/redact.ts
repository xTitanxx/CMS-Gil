// Strip token-shaped substrings from a string so it can be safely logged or
// shown in error redirects. Provider error responses occasionally embed an
// `access_token=...` fragment in their `error_description`, and we don't want
// those landing in browser referrers, server logs, or `?detail=` query params.

const TOKEN_KEY_RE = /(access_token|refresh_token|client_secret|code|fb_exchange_token|input_token|app_secret_proof)=[^&\s"',}]+/gi;

const JSON_TOKEN_RE = /"(access_token|refresh_token|client_secret|code|fb_exchange_token|input_token|app_secret_proof)"\s*:\s*"[^"]+"/gi;

export function redactSecrets(input: unknown): string {
  const s = typeof input === "string" ? input : String(input);
  return s
    .replace(TOKEN_KEY_RE, (_, k) => `${k}=[redacted]`)
    .replace(JSON_TOKEN_RE, (_, k) => `"${k}":"[redacted]"`);
}
