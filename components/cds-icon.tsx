import { glyphMap, type IconName } from "@coinbase/cds-icons";
import type { CSSProperties } from "react";

export type CdsIconProps = {
  accessibilityLabel?: string;
  active?: boolean;
  className?: string;
  name: IconName;
  size?: 12 | 16 | 24;
};

export function CdsIcon({
  accessibilityLabel,
  active = false,
  className = "",
  name,
  size = 16,
}: CdsIconProps) {
  const glyphKey = `${name}-${size}-${active ? "active" : "inactive"}` as keyof typeof glyphMap;
  const glyph = glyphMap[glyphKey];

  return (
    <span
      aria-hidden={accessibilityLabel ? undefined : true}
      aria-label={accessibilityLabel}
      className={`cds-icon ${className}`.trim()}
      role={accessibilityLabel ? "img" : undefined}
      style={{ "--cds-icon-size": `${size}px` } as CSSProperties}
    >
      {glyph}
    </span>
  );
}
