import type { MetadataRoute } from "next";

// Administrative sites must never be indexed.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
