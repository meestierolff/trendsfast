export function SocialImage() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "58px",
        color: "#F8F9FF",
        background: "#070913",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "28px" }}>
          <div
            style={{
              width: "34px",
              height: "34px",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              gap: "4px",
            }}
          >
            <span style={{ width: "7px", height: "12px", background: "#C8FF4D" }} />
            <span style={{ width: "7px", height: "23px", background: "#43E7FF" }} />
            <span style={{ width: "7px", height: "32px", background: "#8B5CF6" }} />
          </div>
          <strong>TrendsFast</strong>
        </div>
        <span style={{ color: "#AAB3CB", fontSize: "18px" }}>TREND INTELLIGENCE FOR AI AGENTS</span>
      </div>

      <div style={{ display: "flex", gap: "42px", alignItems: "stretch" }}>
        <div style={{ width: "52%", display: "flex", flexDirection: "column" }}>
          <span style={{ color: "#43E7FF", fontSize: "22px", marginBottom: "18px" }}>
            URL → EVIDENCE → ONE NEXT MOVE
          </span>
          <div style={{ fontSize: "62px", lineHeight: 1.02, fontWeight: 700 }}>
            Spot the trends your users care about.
          </div>
          <div style={{ color: "#C8FF4D", fontSize: "45px", marginTop: "16px" }}>
            Know what to distribute next.
          </div>
        </div>

        <div
          style={{
            width: "48%",
            display: "flex",
            flexDirection: "column",
            padding: "28px",
            border: "2px solid rgba(255,255,255,.16)",
            borderLeft: "9px solid #C8FF4D",
            borderRadius: "24px",
            background: "#11172A",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px" }}>
            <span style={{ color: "#AAB3CB" }}>YOUR NEXT DISTRIBUTION MOVE</span>
            <span style={{ color: "#C8FF4D" }}>◆ FOUNDER-REVIEWED</span>
          </div>
          <div style={{ display: "flex", gap: "12px", marginTop: "30px" }}>
            <span
              style={{
                padding: "9px 13px",
                color: "#070913",
                background: "#C8FF4D",
                fontWeight: 800,
              }}
            >
              PUBLISH
            </span>
            <span style={{ padding: "9px 13px", color: "#AAB3CB", border: "1px solid #303852" }}>
              FOUNDER POST · X
            </span>
          </div>
          <strong style={{ fontSize: "36px", lineHeight: 1.08, marginTop: "26px" }}>
            Turn evidence into one decision your agent can use.
          </strong>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "auto",
              paddingTop: "22px",
              borderTop: "1px solid #303852",
              color: "#AAB3CB",
              fontSize: "15px",
            }}
          >
            <span>Evidence-linked</span>
            <span>Private by default</span>
            <span>No auto-posting</span>
          </div>
        </div>
      </div>
    </div>
  );
}
