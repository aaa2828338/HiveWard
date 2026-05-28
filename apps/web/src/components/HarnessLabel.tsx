import type { HarnessDisplayParts } from "../lib/harness-labels";

export function HarnessLabel({
  label,
  badgeLabel,
  className
}: HarnessDisplayParts & {
  className?: string;
}) {
  return (
    <span className={["harness-label", className].filter(Boolean).join(" ")}>
      <span className="harness-label-name">{label}</span>
      {badgeLabel && <span className="harness-label-badge">{badgeLabel}</span>}
    </span>
  );
}
