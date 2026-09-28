import { useId } from "react";

export type GarmentSpec = {
  /** Main fabric colour. */
  base: string;
  /** Slightly darker tone used for shading and seams. */
  shade?: string;
  collar?: "crew" | "polo";
  detail?: "plain" | "stripes" | "pocket" | "graphic" | "small-graphic";
  /** Colour for detail work such as stripes, graphics or a polo collar. */
  accent?: string;
};

const SHIRT =
  "M52 22C58 34 102 34 108 22L136 38L152 62L132 74L120 60V138H40V60L28 74L8 62L24 38Z";

/**
 * Stand-in product shot. The reference design used photography of branded
 * garments; this draws a neutral garment in the same palette instead, so no
 * third-party trademark is reproduced.
 */
export function ProductImage({ spec }: { spec: GarmentSpec }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const clipId = `clip-${uid}`;
  const shade = spec.shade ?? shadeOf(spec.base);
  const accent = spec.accent ?? "#ffffff";

  return (
    <svg viewBox="0 0 160 160" role="img" aria-hidden="true" className="h-full w-full">
      <defs>
        <clipPath id={clipId}>
          <path d={SHIRT} />
        </clipPath>
        <linearGradient id={`sh-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={shade} stopOpacity="0.28" />
          <stop offset="34%" stopColor={shade} stopOpacity="0" />
          <stop offset="72%" stopColor={shade} stopOpacity="0" />
          <stop offset="100%" stopColor={shade} stopOpacity="0.22" />
        </linearGradient>
      </defs>

      <path d={SHIRT} fill={spec.base} />

      {spec.detail === "stripes" && (
        <g clipPath={`url(#${clipId})`} opacity={0.55}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <rect key={i} x={0} y={44 + i * 13} width={160} height={6} fill={accent} />
          ))}
        </g>
      )}

      {/* soft volume shading, clipped so it never spills past the silhouette */}
      <rect
        x={0}
        y={0}
        width={160}
        height={160}
        fill={`url(#sh-${uid})`}
        clipPath={`url(#${clipId})`}
      />

      {spec.collar === "polo" ? (
        <>
          <path
            d="M52 22L72 41L80 29L88 41L108 22"
            fill="none"
            stroke={accent}
            strokeWidth={4}
            strokeLinejoin="round"
          />
          <g fill={accent}>
            <circle cx={80} cy={46} r={2.4} />
            <circle cx={80} cy={57} r={2.4} />
          </g>
        </>
      ) : (
        <path
          d="M52 22C58 34 102 34 108 22"
          fill="none"
          stroke={shade}
          strokeWidth={3}
          opacity={0.7}
        />
      )}

      {spec.detail === "pocket" && (
        <path
          d="M96 62h28v32H96z"
          fill="none"
          stroke={shade}
          strokeWidth={2.5}
          opacity={0.8}
        />
      )}

      {spec.detail === "graphic" && (
        <g fill={accent}>
          <rect x={64} y={62} width={32} height={4} rx={2} />
          <rect x={70} y={71} width={20} height={4} rx={2} opacity={0.8} />
        </g>
      )}

      {spec.detail === "small-graphic" && (
        <g fill={accent} opacity={0.8}>
          <rect x={70} y={66} width={20} height={3} rx={1.5} />
          <rect x={73} y={72} width={14} height={3} rx={1.5} />
          <rect x={76} y={78} width={8} height={3} rx={1.5} />
        </g>
      )}
    </svg>
  );
}

/** Derives a plausible darker tone from a hex colour. */
function shadeOf(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return "#000000";
  const r = Math.max(0, ((n >> 16) & 255) - 26);
  const g = Math.max(0, ((n >> 8) & 255) - 26);
  const b = Math.max(0, (n & 255) - 26);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
