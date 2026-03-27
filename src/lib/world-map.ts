/**
 * World map utilities — reused from network-dashboard.
 * Uses simple-world-map SVG (CC BY-SA 3.0, Al MacDonald / Fritz Lekschas).
 */

const SVG_VB_X = 30.767;
const SVG_VB_Y = 241.591;
const SVG_VB_W = 784.077;
const SVG_VB_H = 458.627;

export const COUNTRIES: Record<string, { lon: number; lat: number; name: string }> = {
  US: { lon: -98, lat: 39, name: "United States" }, CA: { lon: -106, lat: 56, name: "Canada" },
  MX: { lon: -102, lat: 23, name: "Mexico" }, BR: { lon: -51, lat: -14, name: "Brazil" },
  AR: { lon: -64, lat: -34, name: "Argentina" }, CL: { lon: -71, lat: -35, name: "Chile" },
  CO: { lon: -74, lat: 4, name: "Colombia" }, PE: { lon: -76, lat: -10, name: "Peru" },
  UY: { lon: -56, lat: -33, name: "Uruguay" }, PY: { lon: -58, lat: -23, name: "Paraguay" },
  EC: { lon: -78, lat: -2, name: "Ecuador" }, VE: { lon: -66, lat: 8, name: "Venezuela" },
  CR: { lon: -84, lat: 10, name: "Costa Rica" }, PA: { lon: -80, lat: 9, name: "Panama" },
  GB: { lon: -2, lat: 54, name: "United Kingdom" }, DE: { lon: 10, lat: 51, name: "Germany" },
  FR: { lon: 2, lat: 46, name: "France" }, ES: { lon: -4, lat: 40, name: "Spain" },
  IT: { lon: 12, lat: 42, name: "Italy" }, CH: { lon: 8, lat: 47, name: "Switzerland" },
  NL: { lon: 5, lat: 52, name: "Netherlands" }, SE: { lon: 18, lat: 60, name: "Sweden" },
  NO: { lon: 10, lat: 62, name: "Norway" }, FI: { lon: 26, lat: 64, name: "Finland" },
  PT: { lon: -8, lat: 39, name: "Portugal" }, IE: { lon: -8, lat: 53, name: "Ireland" },
  PL: { lon: 20, lat: 52, name: "Poland" }, AT: { lon: 14, lat: 47, name: "Austria" },
  BE: { lon: 4, lat: 51, name: "Belgium" }, UA: { lon: 32, lat: 49, name: "Ukraine" },
  RU: { lon: 40, lat: 56, name: "Russia" }, NG: { lon: 8, lat: 10, name: "Nigeria" },
  ZA: { lon: 25, lat: -29, name: "South Africa" }, KE: { lon: 38, lat: 0, name: "Kenya" },
  EG: { lon: 30, lat: 27, name: "Egypt" }, MA: { lon: -5, lat: 32, name: "Morocco" },
  GH: { lon: -2, lat: 8, name: "Ghana" }, AE: { lon: 54, lat: 24, name: "UAE" },
  SA: { lon: 45, lat: 24, name: "Saudi Arabia" }, IL: { lon: 35, lat: 31, name: "Israel" },
  TR: { lon: 32, lat: 39, name: "Turkey" }, IN: { lon: 78, lat: 21, name: "India" },
  CN: { lon: 104, lat: 35, name: "China" }, JP: { lon: 138, lat: 36, name: "Japan" },
  KR: { lon: 128, lat: 36, name: "South Korea" }, SG: { lon: 104, lat: 1, name: "Singapore" },
  TH: { lon: 101, lat: 15, name: "Thailand" }, VN: { lon: 108, lat: 14, name: "Vietnam" },
  ID: { lon: 113, lat: -1, name: "Indonesia" }, PH: { lon: 122, lat: 13, name: "Philippines" },
  MY: { lon: 102, lat: 4, name: "Malaysia" }, AU: { lon: 133, lat: -25, name: "Australia" },
  NZ: { lon: 174, lat: -41, name: "New Zealand" },
};

export function projectCountry(code: string): { x: number; y: number } | null {
  const c = COUNTRIES[code.toUpperCase()];
  if (!c) return null;
  return {
    x: SVG_VB_X + ((c.lon + 180) / 360) * SVG_VB_W,
    y: SVG_VB_Y + ((85 - c.lat) / 145) * SVG_VB_H,
  };
}

export function getCountryName(code: string): string {
  return COUNTRIES[code]?.name ?? code;
}

/**
 * Build an SVG string showing the world map with jurisdiction pins.
 */
export async function renderJurisdictionMap(jurisdictions: string[]): Promise<string> {
  const res = await fetch("/world-map.svg");
  if (!res.ok) return "";
  const svgText = await res.text();

  // Extract the inner content (paths) from the SVG
  const innerMatch = svgText.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  if (!innerMatch) return "";

  const codes = new Set(jurisdictions.map((c) => c.toLowerCase()));
  const BASE = "#2a2d35";
  const HIGHLIGHT = "#6366f1";
  const STROKE = "#1e2028";

  let svgContent = innerMatch[1];

  // Remove title/desc (prevents "Simple World Map" tooltip)
  svgContent = svgContent.replace(/<title>[^<]*<\/title>/g, "");
  svgContent = svgContent.replace(/<desc>[\s\S]*?<\/desc>/g, "");

  // Replace every <path> fill inline based on whether its parent or itself is a jurisdiction
  // We process the SVG as text — find each path's id (or its parent g's id) and decide the color
  svgContent = svgContent.replace(/<path([^>]*)\/>/g, (match, attrs) => {
    const idMatch = attrs.match(/id="([^"]+)"/);
    const id = idMatch ? idMatch[1] : "";
    const isHighlighted = codes.has(id);
    const fill = isHighlighted ? HIGHLIGHT : BASE;
    const extra = isHighlighted ? ` style="cursor:pointer"><title>${getCountryName(id.toUpperCase())}</title></path>` : "/>";
    return `<path${attrs} fill="${fill}" stroke="${STROKE}" stroke-width="0.5"${extra}`;
  });

  // For paths inside <g> groups: check if the group id is a jurisdiction
  for (const code of codes) {
    svgContent = svgContent.replace(
      new RegExp(`(<g[^>]*id="${code}"[^>]*>)([\\s\\S]*?)(</g>)`, "gi"),
      (_match, open, inner, close) => {
        const name = getCountryName(code.toUpperCase());
        // Replace fill on all child paths
        const highlighted = inner.replace(
          new RegExp(`fill="${BASE}"`, "g"),
          `fill="${HIGHLIGHT}"`,
        );
        return `${open}<title>${name}</title>${highlighted}${close}`;
      },
    );
  }

  return `<svg viewBox="30.767 241.591 784.077 458.627" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
    ${svgContent}
  </svg>`;
}
