// Keep this pure URL helper outside a `"use client"` module so it can be used
// safely during both server rendering and client rendering.
export function posterUrlFor(videoUrl: string): string {
  return videoUrl.replace(/\.[^/.]+$/, ".poster.jpg");
}
