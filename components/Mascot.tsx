"use client";

import { memo } from "react";

// Bento Cards mascot — octopus footballer (public/mascot.webp).
// `animate` adds a gentle float on the hero/loading screen.
interface MascotProps {
  size?: number;
  className?: string;
  animate?: boolean;
  /** @deprecated ball is baked into the asset; kept for call-site compatibility */
  kick?: boolean;
  /** @deprecated ball is baked into the asset; kept for call-site compatibility */
  ball?: boolean;
}

function Mascot({ size = 220, className, animate = true }: MascotProps) {
  return (
    <img
      src="/mascot.webp"
      alt="Bento Cards mascot"
      width={size}
      height={size}
      className={`${animate ? "animate-float" : ""} ${className ?? ""}`}
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
    />
  );
}

export default memo(Mascot);
