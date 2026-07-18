const noiseSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2"/></filter><rect width="120" height="120" filter="url(#n)"/></svg>';
const NOISE = `url("data:image/svg+xml;utf8,${encodeURIComponent(noiseSvg)}")`;

export default function Background() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-bg">
      <div
        className="animate-flood absolute"
        style={{
          top: "-34%",
          left: "50%",
          width: "120%",
          height: "92%",
          background:
            "radial-gradient(50% 62% at 50% 0%, rgba(57,211,83,.16), rgba(13,17,23,.2) 46%, rgba(13,17,23,0) 72%)",
        }}
      />
      <div
        className="absolute"
        style={{
          top: "-10%",
          left: "4%",
          width: "38%",
          height: "78%",
          background: "radial-gradient(closest-side, rgba(38,166,65,.12), transparent 72%)",
          filter: "blur(18px)",
          transform: "rotate(16deg)",
        }}
      />
      <div
        className="absolute"
        style={{
          top: "-10%",
          right: "4%",
          width: "34%",
          height: "78%",
          background: "radial-gradient(closest-side, rgba(212,175,55,.08), transparent 72%)",
          filter: "blur(20px)",
          transform: "rotate(-16deg)",
        }}
      />
      <div
        className="absolute"
        style={{
          bottom: "-24%",
          left: "50%",
          width: "150%",
          height: "55%",
          transform: "translateX(-50%)",
          background: "radial-gradient(60% 100% at 50% 100%, rgba(1,4,9,.85), transparent 72%)",
        }}
      />
      <div className="absolute inset-0" style={{ opacity: 0.04, backgroundImage: NOISE, mixBlendMode: "overlay" }} />
    </div>
  );
}
