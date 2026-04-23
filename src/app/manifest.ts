import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gil Alter",
    short_name: "Gil",
    description: "Archive of all posts by Gil Alter",
    start_url: "/admin",
    display: "standalone",
    background_color: "#f9fafb",
    theme_color: "#1f2937",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
