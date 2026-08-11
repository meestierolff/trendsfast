import type { MetadataRoute } from "next";
import { absoluteUrl, siteOrigin } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/ops", "/scan/", "/api/", "/v1/"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteOrigin(),
  };
}
