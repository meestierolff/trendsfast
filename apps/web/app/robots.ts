import type { MetadataRoute } from "next";
import { deploymentSurface } from "@trendsfast/config";
import { absoluteUrl, siteOrigin } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  if (deploymentSurface() === "ops") {
    return {
      rules: { userAgent: "*", disallow: "/" },
      host: siteOrigin(),
    };
  }
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
