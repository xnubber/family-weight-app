const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    node.setAttribute(key, String(val));
  }
  return node;
}

const ICON_SHAPES = {
  refresh: [
    ['path', { d: 'M20 11a8 8 0 0 0-14.5-4.6L3 9' }],
    ['path', { d: 'M3 4v5h5' }],
    ['path', { d: 'M4 13a8 8 0 0 0 14.5 4.6L21 15' }],
    ['path', { d: 'M21 20v-5h-5' }]
  ],
  cloud: [
    ['path', { d: 'M6.5 18h11a4 4 0 0 0 .8-7.92A5.5 5.5 0 0 0 7.6 8.3 3.8 3.8 0 0 0 6.5 18Z' }]
  ],
  plus: [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'M5 12h14' }]
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['path', { d: 'M12 7.5v4.8l3 1.7' }]
  ],
  target: [
    ['circle', { cx: 12, cy: 12, r: 8.5 }],
    ['circle', { cx: 12, cy: 12, r: 4.8 }],
    ['circle', { cx: 12, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }]
  ],
  chart: [
    ['path', { d: 'M4 19h16' }],
    ['path', { d: 'M5.5 15l4-4 3.2 2.6L18.5 7' }],
    ['path', { d: 'M15 7h3.5v3.5' }]
  ],
  edit: [
    ['path', { d: 'M15.8 5.2a2.1 2.1 0 0 1 3 3L8.5 18.5 4.5 19.5l1-4 10.3-10.3Z' }]
  ],
  leaf: [
    ['path', { d: 'M6 19C6 11 11.5 6 19 5c-.5 7.5-5.5 13-13 14Z' }],
    ['path', { d: 'M6 19l6.5-6.5' }]
  ],
  paw: [
    ['circle', { cx: 7.5, cy: 9.5, r: 1.6 }],
    ['circle', { cx: 12, cy: 7.2, r: 1.6 }],
    ['circle', { cx: 16.5, cy: 9.5, r: 1.6 }],
    ['path', { d: 'M8 15.6c0-2.1 1.8-3.6 4-3.6s4 1.5 4 3.6c0 1.4-1.1 2.4-2.5 2.4-.7 0-1.1-.3-1.5-.3s-.8.3-1.5.3C9.1 18 8 17 8 15.6Z' }]
  ],
  chevronLeft: [
    ['path', { d: 'M14.5 6.5L9 12l5.5 5.5' }]
  ],
  chevronRight: [
    ['path', { d: 'M9.5 6.5L15 12l-5.5 5.5' }]
  ],
  chevronsLeft: [
    ['path', { d: 'M13.5 7L8.5 12l5 5' }],
    ['path', { d: 'M18 7l-5 5 5 5' }]
  ],
  chevronsRight: [
    ['path', { d: 'M10.5 7l5 5-5 5' }],
    ['path', { d: 'M6 7l5 5-5 5' }]
  ],
  check: [
    ['path', { d: 'M5.5 12.5l4.2 4.2 8.8-9.2' }]
  ],
  eye: [
    ['path', { d: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z' }],
    ['circle', { cx: 12, cy: 12, r: 2.6 }]
  ],
  eyeOff: [
    ['path', { d: 'M3 3l18 18' }],
    ['path', { d: 'M10.4 6.2A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16.8 16.8 0 0 1-3.1 3.7' }],
    ['path', { d: 'M6.5 8.1A16.6 16.6 0 0 0 2.5 12s3.5 6 9.5 6a9.6 9.6 0 0 0 3.7-.7' }],
    ['path', { d: 'M9.9 9.9a3 3 0 0 0 4.2 4.2' }]
  ],
  lock: [
    ['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2.5 }],
    ['path', { d: 'M8.5 11V8.2a3.5 3.5 0 0 1 7 0V11' }]
  ],
  unlock: [
    ['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2.5 }],
    ['path', { d: 'M8.5 11V8.2a3.5 3.5 0 0 1 6.7-1.4' }]
  ],
  calendar: [
    ['rect', { x: 3.5, y: 5, width: 17, height: 15.5, rx: 2.5 }],
    ['path', { d: 'M8 3.5v3M16 3.5v3M3.5 9.5h17' }]
  ],
  close: [
    ['path', { d: 'M6 6l12 12M18 6L6 18' }]
  ]
};

// 建立細緻文青線條 SVG 圖示（純 DOM 建構，無 innerHTML、符合嚴格 CSP）
export function createIcon(name, className = 'w-4 h-4 shrink-0') {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.65',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  });
  if (className) svg.setAttribute('class', className);

  const shapes = ICON_SHAPES[name] || ICON_SHAPES.leaf;
  shapes.forEach(([tag, attrs]) => svg.appendChild(svgEl(tag, attrs)));
  return svg;
}
