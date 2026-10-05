import { SVGNS } from "./util";

const S0 = 'fill="none" stroke="#000" stroke-width="0.2"';

/** [file name, quantity, svg source] — loaded on first open. */
export const SAMPLES: [string, number, string][] = [
  [
    "star-ornament.svg",
    8,
    `<svg xmlns="${SVGNS}" width="70mm" height="67mm" viewBox="0 0 70 67"><polygon points="35,0.5 43.2,24.6 69.2,25.1 48.6,40.8 56.1,65.9 35,51 13.9,65.9 21.4,40.8 0.8,25.1 26.8,24.6" ${S0}/><circle cx="35" cy="12" r="1.8" ${S0}/></svg>`,
  ],
  [
    "l-bracket.svg",
    6,
    `<svg xmlns="${SVGNS}" width="80mm" height="60mm" viewBox="0 0 80 60"><polygon points="0,0 80,0 80,16 16,16 16,60 0,60" ${S0}/><circle cx="8" cy="50" r="2.5" ${S0}/><circle cx="70" cy="8" r="2.5" ${S0}/></svg>`,
  ],
  [
    "crescent-moon.svg",
    6,
    `<svg xmlns="${SVGNS}" width="34mm" height="60mm" viewBox="0 0 34 60"><path d="M30 0 A30 30 0 0 0 30 60 A36 36 0 0 1 30 0 Z" ${S0}/></svg>`,
  ],
  [
    "coaster-round.svg",
    4,
    `<svg xmlns="${SVGNS}" width="95mm" height="95mm" viewBox="0 0 95 95"><circle cx="47.5" cy="47.5" r="47.4" ${S0}/><circle cx="47.5" cy="47.5" r="38" fill="none" stroke="#2d55f0" stroke-width="0.3"/></svg>`,
  ],
  [
    "hex-tag.svg",
    6,
    `<svg xmlns="${SVGNS}" width="50mm" height="43.3mm" viewBox="0 0 50 43.3"><polygon points="12.5,0.1 37.5,0.1 49.9,21.65 37.5,43.2 12.5,43.2 0.1,21.65" ${S0}/><circle cx="25" cy="8" r="2" ${S0}/></svg>`,
  ],
  [
    "shop-sign.svg",
    2,
    `<svg xmlns="${SVGNS}" width="180mm" height="80mm" viewBox="0 0 180 80"><rect x="0.1" y="0.1" width="179.8" height="79.8" rx="8" ${S0}/><circle cx="12" cy="40" r="2.5" ${S0}/><circle cx="168" cy="40" r="2.5" ${S0}/><rect x="30" y="22" width="120" height="36" rx="3" fill="#2d55f0" opacity=".35"/></svg>`,
  ],
];
