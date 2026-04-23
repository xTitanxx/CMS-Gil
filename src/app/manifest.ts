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
        src: "/icon.jpg",
        sizes: "180x180",
        type: "image/jpeg",
      },
    ],
  };
}
