import type { MetadataRoute } from "next";
import { SAMPLE_LOGINS } from "@/lib/bento/samples";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

// Home + the showcase markets (indexable demo cards). Per-market pages are
// generated on demand, so they aren't enumerated here.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE, changeFrequency: "weekly", priority: 1 },
    ...SAMPLE_LOGINS.map((login) => ({
      url: `${BASE}/${login}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
