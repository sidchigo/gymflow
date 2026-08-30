import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GymFlow",
    short_name: "GymFlow",
    description: "Adaptive, agentic strength & MMA conditioning copilot synchronized with live gym scheduling.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0014",
    theme_color: "#7c3aed",
    icons: [
      {
        src: "/icon.jpg",
        sizes: "512x512",
        type: "image/jpeg",
        purpose: "any",
      },
    ],
  };
}
