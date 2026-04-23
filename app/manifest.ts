import type { MetadataRoute } from "next";

/** スプラッシュ・ステータスバーと揃える（SHLの鬼と同様に theme / background を統一） */
const THEME = "#0d4a9c";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "聴覚・音響の鬼",
    short_name: "聴覚の鬼",
    description: "聴覚・音響の鬼 (MVP)",
    id: "/",
    scope: "/",
    start_url: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    background_color: THEME,
    theme_color: THEME,
    icons: [
      {
        src: "/choukaku-oni-app-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/choukaku-oni-app-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
