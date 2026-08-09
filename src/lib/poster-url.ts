// Keep this pure URL helper outside a `"use client"` module so it can be used
// safely during both server rendering and client rendering.
export function posterUrlFor(videoUrl: string): string {
  const proxied = videoUrl.match(/^(.*\/api\/media\/[^/?]+\/)content(?:\?.*)?$/);
  if (proxied) return `${proxied[1]}poster`;
  return videoUrl.replace(/\.[^/.]+$/, ".poster.jpg");
}
