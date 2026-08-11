import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: "5px",
        padding: "12px",
        borderRadius: "14px",
        background: "#070913",
      }}
    >
      <span style={{ width: "9px", height: "18px", background: "#C8FF4D" }} />
      <span style={{ width: "9px", height: "29px", background: "#43E7FF" }} />
      <span style={{ width: "9px", height: "40px", background: "#8B5CF6" }} />
    </div>,
    size,
  );
}
