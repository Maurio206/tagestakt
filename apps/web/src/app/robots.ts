import type { MetadataRoute } from "next";

/** Private Anwendung: Suchmaschinen sollen nichts crawlen. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
