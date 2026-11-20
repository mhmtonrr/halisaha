import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Halısaha Performans",
    short_name: "Halısaha",
    description: "Maç sonrası puanlama, FIFA tarzı rating ve dengeli takım kurma",
    start_url: "/",
    display: "standalone",
    background_color: "#04130b",
    theme_color: "#04130b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
