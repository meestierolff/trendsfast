import { ImageResponse } from "next/og";
import { SocialImage } from "../components/social-image";

export const alt = "TrendsFast — spot relevant trends and know what to distribute next";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(<SocialImage />, size);
}
