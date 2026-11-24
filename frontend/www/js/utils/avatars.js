const SVG_NS = 'http://www.w3.org/2000/svg';
const LOCAL_AVATAR_STORAGE_KEY = 'memberAvatars';
const INK = '#3B3A34';
const BLUSH = '#E2A894';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  return node;
}

function strokeAttrs(extra = {}) {
  return {
    fill: 'none',
    stroke: INK,
    'stroke-width': '1.6',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    ...extra
  };
}

// 12 款文青・樸素・清新插畫風頭像（純 SVG DOM 建構，零外部資源、符合嚴格 CSP）
export const AVATARS = [
  {
    id: 'human-short',
    label: '短髮旅人',
    bg: '#E6EFE9',
    draw: (g) => {
      g.append(
        svgEl('path', { d: 'M15 64c2-11 8.5-15.5 17-15.5S47 53 49 64Z', fill: '#5F7E6A', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('rect', { x: 28.5, y: 41, width: 7, height: 9, rx: 3.5, fill: '#F5E4D3' }),
        svgEl('circle', { cx: 32, cy: 31, r: 12.5, fill: '#F8E9DA', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('path', { d: 'M19.5 30c0-8.5 5.5-14 12.8-14 6.8 0 12.2 4.8 12.2 13.5-2.6-4.5-6.5-6-11.2-6-5.2 0-9.8 1.5-13.8 6.5Z', fill: '#4A443D', stroke: INK, 'stroke-width': '1.4', 'stroke-linejoin': 'round' }),
        svgEl('circle', { cx: 27.5, cy: 31.5, r: 1.25, fill: INK }),
        svgEl('circle', { cx: 36.5, cy: 31.5, r: 1.25, fill: INK }),
        svgEl('circle', { cx: 24.5, cy: 34.5, r: 1.8, fill: BLUSH, opacity: '0.55' }),
        svgEl('circle', { cx: 39.5, cy: 34.5, r: 1.8, fill: BLUSH, opacity: '0.55' }),
        svgEl('path', strokeAttrs({ d: 'M29 36.2c1.4 1.3 4.6 1.3 6 0', 'stroke-width': '1.4' }))
      );
    }
  },
  {
    id: 'human-bob',
    label: '微捲短髮',
    bg: '#F4EAE4',
    draw: (g) => {
      g.append(
        svgEl('path', { d: 'M18 33c0-10 5.5-17 14-17s14 7 14 17c0 6.5-1.5 11.5-4.5 14H22.5C19.5 44.5 18 39.5 18 33Z', fill: '#574B41', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('path', { d: 'M16 64c2-10.5 8.5-15 16-15s14 4.5 16 15Z', fill: '#C58A6D', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('rect', { x: 28.5, y: 41.5, width: 7, height: 8, rx: 3.5, fill: '#F5E4D3' }),
        svgEl('circle', { cx: 32, cy: 32, r: 11.5, fill: '#F9EBDD', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('path', { d: 'M20.8 29.5c2.2-5.5 6.8-8.2 11.2-8.2 4.8 0 9.4 2.8 11.2 8.2-3.5-2.8-6.8-3.8-11.2-3.8-4.4 0-7.7 1-11.2 3.8Z', fill: '#574B41' }),
        svgEl('circle', { cx: 28, cy: 32.5, r: 1.2, fill: INK }),
        svgEl('circle', { cx: 36, cy: 32.5, r: 1.2, fill: INK }),
        svgEl('circle', { cx: 25, cy: 35.2, r: 1.9, fill: BLUSH, opacity: '0.6' }),
        svgEl('circle', { cx: 39, cy: 35.2, r: 1.9, fill: BLUSH, opacity: '0.6' }),
        svgEl('path', strokeAttrs({ d: 'M29.4 36.8c1.3 1.2 3.9 1.2 5.2 0', 'stroke-width': '1.4' }))
      );
    }
  },
  {
    id: 'human-glasses',
    label: '眼鏡書生',
    bg: '#E7EEF0',
    draw: (g) => {
      g.append(
        svgEl('path', { d: 'M15 64c2-11 8.5-15.5 17-15.5S47 53 49 64Z', fill: '#6F8086', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('path', { d: 'M28 48.5l4 5 4-5', fill: '#FCFBF8', stroke: INK, 'stroke-width': '1.3', 'stroke-linejoin': 'round' }),
        svgEl('rect', { x: 28.5, y: 41, width: 7, height: 8.5, rx: 3.5, fill: '#F5E4D3' }),
        svgEl('circle', { cx: 32, cy: 31, r: 12.2, fill: '#F8E9DA', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('path', { d: 'M19.8 29c.5-7.8 5.8-13 12.5-13 6.5 0 11.7 4.8 11.9 12.8-3.8-4.2-8.2-5.4-13.2-5.4-4.5 0-8 1.4-11.2 5.6Z', fill: '#3E3C37', stroke: INK, 'stroke-width': '1.3' }),
        svgEl('circle', strokeAttrs({ cx: 27, cy: 31.5, r: 3.6, fill: '#FCFBF8', 'fill-opacity': '0.45', 'stroke-width': '1.35' })),
        svgEl('circle', strokeAttrs({ cx: 37, cy: 31.5, r: 3.6, fill: '#FCFBF8', 'fill-opacity': '0.45', 'stroke-width': '1.35' })),
        svgEl('path', strokeAttrs({ d: 'M30.6 31.5h2.8', 'stroke-width': '1.35' })),
        svgEl('circle', { cx: 27, cy: 31.5, r: 1.1, fill: INK }),
        svgEl('circle', { cx: 37, cy: 31.5, r: 1.1, fill: INK }),
        svgEl('path', strokeAttrs({ d: 'M29.5 37c1.2 1 3.8 1 5 0', 'stroke-width': '1.35' }))
      );
    }
  },
  {
    id: 'human-bun',
    label: '丸子頭',
    bg: '#F3ECE0',
    draw: (g) => {
      g.append(
        svgEl('circle', { cx: 32, cy: 14.5, r: 6.2, fill: '#4E443B', stroke: INK, 'stroke-width': '1.4' }),
        svgEl('circle', { cx: 36.5, cy: 13, r: 1.7, fill: '#E7DDD0', stroke: INK, 'stroke-width': '1.1' }),
        svgEl('path', { d: 'M16 64c2-10.5 8.5-15 16-15s14 4.5 16 15Z', fill: '#7B9884', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('rect', { x: 28.5, y: 42, width: 7, height: 8, rx: 3.5, fill: '#F5E4D3' }),
        svgEl('circle', { cx: 32, cy: 32.5, r: 11.8, fill: '#F9EBDD', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('path', { d: 'M20.3 31c.6-7.5 5.4-12 11.7-12s11.1 4.5 11.7 12c-2.5-3.4-5.4-5-9.2-5.4-1.5 1.8-4.5 2-6.5.2-3 .8-5.5 2.4-7.7 5.2Z', fill: '#4E443B', stroke: INK, 'stroke-width': '1.3' }),
        svgEl('path', strokeAttrs({ d: 'M26.2 33.2c.8-.9 2.2-.9 3 0', 'stroke-width': '1.4' })),
        svgEl('path', strokeAttrs({ d: 'M34.8 33.2c.8-.9 2.2-.9 3 0', 'stroke-width': '1.4' })),
        svgEl('circle', { cx: 25, cy: 36, r: 1.8, fill: BLUSH, opacity: '0.6' }),
        svgEl('circle', { cx: 39, cy: 36, r: 1.8, fill: BLUSH, opacity: '0.6' }),
        svgEl('path', strokeAttrs({ d: 'M29.6 37.6c1.2 1.1 3.6 1.1 4.8 0', 'stroke-width': '1.35' }))
      );
    }
  },
  {
    id: 'cat-orange',
    label: '暖橘貓',
    bg: '#F7ECE2',
    draw: (g) => {
      g.append(
        svgEl('path', { d: 'M18 30L16 15.5l12 7.5Z', fill: '#DA9763', stroke: INK, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M46 30l2-14.5-12 7.5Z', fill: '#DA9763', stroke: INK, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M19.5 26.5L18.5 19l6.5 4.2Z', fill: '#F6DFC9' }),
        svgEl('path', { d: 'M44.5 26.5L45.5 19l-6.5 4.2Z', fill: '#F6DFC9' }),
        svgEl('ellipse', { cx: 32, cy: 37, rx: 16.5, ry: 14.2, fill: '#E1A16C', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('ellipse', { cx: 32, cy: 42.5, rx: 9, ry: 6.2, fill: '#FAF2E6' }),
        svgEl('path', strokeAttrs({ d: 'M32 23.5v4.5M28.5 24.5l.8 3.5M35.5 24.5l-.8 3.5', stroke: '#B36C3B', 'stroke-width': '1.6' })),
        svgEl('circle', { cx: 26, cy: 36, r: 1.5, fill: INK }),
        svgEl('circle', { cx: 38, cy: 36, r: 1.5, fill: INK }),
        svgEl('path', { d: 'M30.5 39.5h3l-1.5 1.8Z', fill: '#C97B6E' }),
        svgEl('path', strokeAttrs({ d: 'M32 41.3c-.6 1.6-2.2 2-3.4 1.2M32 41.3c.6 1.6 2.2 2 3.4 1.2', 'stroke-width': '1.35' })),
        svgEl('path', strokeAttrs({ d: 'M13.5 37.5l6.5.8M14 41.5l6-.4M50.5 37.5l-6.5.8M50 41.5l-6-.4', 'stroke-width': '1.2' }))
      );
    }
  },
  {
    id: 'cat-tuxedo',
    label: '賓士貓',
    bg: '#ECEAE4',
    draw: (g) => {
      g.append(
        svgEl('path', { d: 'M18 30L16.5 15.5l11.5 7.5Z', fill: '#454643', stroke: INK, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M46 30l1.5-14.5-11.5 7.5Z', fill: '#454643', stroke: INK, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M19.8 26.5l-.8-7 5.8 3.8Z', fill: '#E4C8C0' }),
        svgEl('path', { d: 'M44.2 26.5l.8-7-5.8 3.8Z', fill: '#E4C8C0' }),
        svgEl('ellipse', { cx: 32, cy: 37, rx: 16.2, ry: 14, fill: '#454643', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('path', { d: 'M32 30.5c2 4.5 9.5 6.8 12.2 12.5-2.8 5-7 7.8-12.2 7.8s-9.4-2.8-12.2-7.8c2.7-5.7 10.2-8 12.2-12.5Z', fill: '#FCFBF8' }),
        svgEl('circle', { cx: 26, cy: 35.5, r: 1.7, fill: '#EBD399' }),
        svgEl('circle', { cx: 26, cy: 35.5, r: 0.9, fill: INK }),
        svgEl('circle', { cx: 38, cy: 35.5, r: 1.7, fill: '#EBD399' }),
        svgEl('circle', { cx: 38, cy: 35.5, r: 0.9, fill: INK }),
        svgEl('path', { d: 'M30.5 39.8h3l-1.5 1.8Z', fill: '#D58F87' }),
        svgEl('path', strokeAttrs({ d: 'M32 41.6c-.6 1.5-2.1 1.9-3.2 1.1M32 41.6c.6 1.5 2.1 1.9 3.2 1.1', 'stroke-width': '1.35' })),
        svgEl('path', strokeAttrs({ d: 'M13.5 38l6.2.6M14 41.8l5.8-.5M50.5 38l-6.2.6M50 41.8l-5.8-.5', 'stroke-width': '1.2' }))
      );
    }
  },
  {
    id: 'cat-calico',
    label: '三花貓',
    bg: '#F6F0E4',
    draw: (g) => {
      g.append(
        svgEl('path', { d: 'M18 30L16 15.5l12 7.5Z', fill: '#CF8459', stroke: INK, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M46 30l2-14.5-12 7.5Z', fill: '#4E4B46', stroke: INK, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        svgEl('ellipse', { cx: 32, cy: 37, rx: 16.5, ry: 14.2, fill: '#FCF9F2', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('path', { d: 'M17.5 31c1.8-5.5 6.8-8.2 12.2-8.2-.4 5-3.8 8.8-12.2 8.2Z', fill: '#CF8459' }),
        svgEl('path', { d: 'M46.5 31c-1.8-5.5-6.5-8.2-11.5-8.2.8 4.8 4 8.4 11.5 8.2Z', fill: '#4E4B46' }),
        svgEl('circle', { cx: 26, cy: 36.2, r: 1.45, fill: INK }),
        svgEl('circle', { cx: 38, cy: 36.2, r: 1.45, fill: INK }),
        svgEl('circle', { cx: 22.8, cy: 39, r: 1.9, fill: BLUSH, opacity: '0.55' }),
        svgEl('circle', { cx: 41.2, cy: 39, r: 1.9, fill: BLUSH, opacity: '0.55' }),
        svgEl('path', { d: 'M30.6 39.8h2.8l-1.4 1.6Z', fill: '#D58F87' }),
        svgEl('path', strokeAttrs({ d: 'M32 41.4c-.6 1.5-2.1 1.9-3.2 1.1M32 41.4c.6 1.5 2.1 1.9 3.2 1.1', 'stroke-width': '1.35' })),
        svgEl('path', strokeAttrs({ d: 'M13.5 38l6.2.6M50.5 38l-6.2.6', 'stroke-width': '1.2' }))
      );
    }
  },
  {
    id: 'dog-shiba',
    label: '柴犬',
    bg: '#F6EEDA',
    draw: (g) => {
      g.append(
        svgEl('path', { d: 'M17 29.5L18 14.5l10.5 8.5Z', fill: '#D19A54', stroke: INK, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M47 29.5L46 14.5l-10.5 8.5Z', fill: '#D19A54', stroke: INK, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M19.2 26l.6-7.2 5.6 4.6Z', fill: '#FAF4E8' }),
        svgEl('path', { d: 'M44.8 26l-.6-7.2-5.6 4.6Z', fill: '#FAF4E8' }),
        svgEl('path', { d: 'M15 37c0-9.2 7.2-15 17-15s17 5.8 17 15c0 8.5-7 14.2-17 14.2S15 45.5 15 37Z', fill: '#D6A15C', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('path', { d: 'M16.6 40.5c1.8-4.5 5.4-5.2 9.4-3.8 2 .7 3.8 1.5 6 1.5s4-.8 6-1.5c4-1.4 7.6-.7 9.4 3.8-2.4 6.5-8.2 10-15.4 10s-13-3.5-15.4-10Z', fill: '#FBF7EE' }),
        svgEl('ellipse', { cx: 26.8, cy: 30.8, rx: 1.7, ry: 1.1, fill: '#FBF7EE' }),
        svgEl('ellipse', { cx: 37.2, cy: 30.8, rx: 1.7, ry: 1.1, fill: '#FBF7EE' }),
        svgEl('circle', { cx: 26, cy: 35.5, r: 1.45, fill: INK }),
        svgEl('circle', { cx: 38, cy: 35.5, r: 1.45, fill: INK }),
        svgEl('ellipse', { cx: 32, cy: 40, rx: 2.6, ry: 1.9, fill: INK }),
        svgEl('path', strokeAttrs({ d: 'M32 41.8v1.6M28.6 43.2c1.2 1.6 5.6 1.6 6.8 0', 'stroke-width': '1.4' }))
      );
    }
  },
  {
    id: 'dog-poodle',
    label: '捲毛貴賓',
    bg: '#F3EBE3',
    draw: (g) => {
      g.append(
        svgEl('ellipse', { cx: 16.8, cy: 38, rx: 5.5, ry: 10.2, fill: '#CCA883', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('ellipse', { cx: 47.2, cy: 38, rx: 5.5, ry: 10.2, fill: '#CCA883', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('circle', { cx: 25, cy: 23, r: 6.5, fill: '#E3C8AA', stroke: INK, 'stroke-width': '1.4' }),
        svgEl('circle', { cx: 39, cy: 23, r: 6.5, fill: '#E3C8AA', stroke: INK, 'stroke-width': '1.4' }),
        svgEl('circle', { cx: 32, cy: 20.5, r: 7.2, fill: '#E3C8AA', stroke: INK, 'stroke-width': '1.4' }),
        svgEl('circle', { cx: 32, cy: 36, r: 13.5, fill: '#E6CEB4', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('circle', { cx: 25, cy: 23.5, r: 5.5, fill: '#E6CEB4' }),
        svgEl('circle', { cx: 39, cy: 23.5, r: 5.5, fill: '#E6CEB4' }),
        svgEl('circle', { cx: 32, cy: 22, r: 6.2, fill: '#E6CEB4' }),
        svgEl('ellipse', { cx: 32, cy: 40.5, rx: 7.8, ry: 5.8, fill: '#F7EFE5' }),
        svgEl('circle', { cx: 26.8, cy: 34.8, r: 1.5, fill: INK }),
        svgEl('circle', { cx: 37.2, cy: 34.8, r: 1.5, fill: INK }),
        svgEl('ellipse', { cx: 32, cy: 39, rx: 2.3, ry: 1.7, fill: '#4A423C' }),
        svgEl('path', strokeAttrs({ d: 'M32 40.7c-.5 1.4-2 1.8-3 1M32 40.7c.5 1.4 2 1.8 3 1', 'stroke-width': '1.35' }))
      );
    }
  },
  {
    id: 'dog-corgi',
    label: '柯基犬',
    bg: '#EBF0E6',
    draw: (g) => {
      g.append(
        svgEl('path', { d: 'M18.5 31C12 24 11.5 14.5 16.5 12.5c4.5-1.8 10 5 11.2 12.5Z', fill: '#CC8E55', stroke: INK, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M45.5 31c6.5-7 7-16.5 2-18.5-4.5-1.8-10 5-11.2 12.5Z', fill: '#CC8E55', stroke: INK, 'stroke-width': '1.5', 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M19.5 27c-3.5-4.2-4-9.8-1.5-10.8 2.4-1 5.5 3 6.2 7.8Z', fill: '#F5E4D4' }),
        svgEl('path', { d: 'M44.5 27c3.5-4.2 4-9.8 1.5-10.8-2.4-1-5.5 3-6.2 7.8Z', fill: '#F5E4D4' }),
        svgEl('ellipse', { cx: 32, cy: 38, rx: 15.8, ry: 13.5, fill: '#D1955C', stroke: INK, 'stroke-width': '1.5' }),
        svgEl('path', { d: 'M32 25.5c2 5.5 1.8 9.2 4.5 11.2 3.2 2.2 7.2 1.2 9.5 4.8-2.2 5.8-7.6 9.5-14 9.5s-11.8-3.7-14-9.5c2.3-3.6 6.3-2.6 9.5-4.8 2.7-2 2.5-5.7 4.5-11.2Z', fill: '#FCFBF8' }),
        svgEl('circle', { cx: 26, cy: 36.2, r: 1.45, fill: INK }),
        svgEl('circle', { cx: 38, cy: 36.2, r: 1.45, fill: INK }),
        svgEl('ellipse', { cx: 32, cy: 40.4, rx: 2.5, ry: 1.8, fill: INK }),
        svgEl('path', strokeAttrs({ d: 'M28.5 43.2c1.4 2.2 5.6 2.2 7 0', 'stroke-width': '1.4' })),
        svgEl('path', { d: 'M30.7 44.6c.4 1.6 2.2 1.6 2.6 0Z', fill: '#DA8D82' })
      );
    }
  },
  {
    id: 'botanical-leaf',
    label: '晨露嫩葉',
    bg: '#E5EFE8',
    draw: (g) => {
      g.append(
        svgEl('path', strokeAttrs({ d: 'M32 51c0-11 .8-20 4.5-30', stroke: '#4A6754', 'stroke-width': '1.8' })),
        svgEl('path', { d: 'M33.2 38C23 37.5 17 31.5 18 22c9.2.6 15.5 6.4 15.2 16Z', fill: '#6E917B', stroke: INK, 'stroke-width': '1.45', 'stroke-linejoin': 'round' }),
        svgEl('path', strokeAttrs({ d: 'M32.5 37.2L22.5 27', stroke: '#EAF2EC', 'stroke-width': '1.2' })),
        svgEl('path', { d: 'M34.2 31.5c10-.8 15-6.6 14-15.5-8.8 1-14.2 6.5-14 15.5Z', fill: '#94B39E', stroke: INK, 'stroke-width': '1.45', 'stroke-linejoin': 'round' }),
        svgEl('path', strokeAttrs({ d: 'M34.8 30.8l8.8-9.2', stroke: '#F1F7F2', 'stroke-width': '1.2' })),
        svgEl('circle', { cx: 21.5, cy: 17.5, r: 2.2, fill: '#FCFBF8', stroke: '#6E917B', 'stroke-width': '1.2' })
      );
    }
  },
  {
    id: 'lifestyle-mug',
    label: '手沖咖啡',
    bg: '#F1EBE0',
    draw: (g) => {
      g.append(
        svgEl('path', strokeAttrs({ d: 'M26.5 21.5c0-2.5 2-3.5 2-6M33.5 20.5c0-2.5 2-3.5 2-6', stroke: '#9C9486', 'stroke-width': '1.5' })),
        svgEl('path', strokeAttrs({ d: 'M42 30.5h4.2a4.6 4.6 0 0 1 0 9.2H42', 'stroke-width': '2' })),
        svgEl('path', { d: 'M19 26.5h23v14a8.5 8.5 0 0 1-8.5 8.5h-6A8.5 8.5 0 0 1 19 40.5v-14Z', fill: '#FCFBF8', stroke: INK, 'stroke-width': '1.6', 'stroke-linejoin': 'round' }),
        svgEl('path', { d: 'M19.8 34.5h21.4v6a7.7 7.7 0 0 1-7.7 7.7h-6a7.7 7.7 0 0 1-7.7-7.7v-6Z', fill: '#C88B6A', opacity: '0.88' }),
        svgEl('path', strokeAttrs({ d: 'M15 49.5h32', stroke: '#A89F91', 'stroke-width': '1.5' }))
      );
    }
  }
];

const AVATAR_MAP = new Map(AVATARS.map((a) => [a.id, a]));

export function isValidAvatarId(id) {
  return typeof id === 'string' && AVATAR_MAP.has(id);
}

export function getDefaultAvatarForType(type) {
  if (type === 'cat') return 'cat-orange';
  if (type === 'dog') return 'dog-shiba';
  return 'human-short';
}

function readLocalAvatarMap() {
  try {
    const raw = localStorage.getItem(LOCAL_AVATAR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalAvatarMap(map) {
  try {
    localStorage.setItem(LOCAL_AVATAR_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 忽略儲存空間受限錯誤
  }
}

export function getSavedLocalAvatar(memberId) {
  if (!memberId) return null;
  const map = readLocalAvatarMap();
  const id = map[String(memberId)];
  return isValidAvatarId(id) ? id : null;
}

export function saveLocalAvatar(memberId, avatarId) {
  if (!memberId || !isValidAvatarId(avatarId)) return;
  const map = readLocalAvatarMap();
  map[String(memberId)] = avatarId;
  writeLocalAvatarMap(map);
}

export function migrateLocalAvatar(oldId, newId) {
  if (!oldId || !newId || oldId === newId) return;
  const map = readLocalAvatarMap();
  if (map[String(oldId)]) {
    map[String(newId)] = map[String(oldId)];
    delete map[String(oldId)];
    writeLocalAvatarMap(map);
  }
}

export function removeLocalAvatar(memberId) {
  if (!memberId) return;
  const map = readLocalAvatarMap();
  if (Object.prototype.hasOwnProperty.call(map, String(memberId))) {
    delete map[String(memberId)];
    writeLocalAvatarMap(map);
  }
}

export function resolveMemberAvatar(member) {
  if (member && isValidAvatarId(member.avatar)) return member.avatar;
  if (member && member.id) {
    const local = getSavedLocalAvatar(member.id);
    if (local) return local;
  }
  return getDefaultAvatarForType(member?.type);
}

export function createAvatarNode(avatarId, sizeClass = 'w-10 h-10') {
  const def = AVATAR_MAP.get(avatarId) || AVATAR_MAP.get('human-short');
  const wrap = document.createElement('span');
  wrap.className = `avatar-badge ${sizeClass}`;
  wrap.setAttribute('aria-hidden', 'true');

  const svg = svgEl('svg', { viewBox: '0 0 64 64' });
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: 64, height: 64, fill: def.bg }));
  const g = svgEl('g');
  def.draw(g);
  svg.appendChild(g);
  wrap.appendChild(svg);
  return wrap;
}

export function renderAvatarPicker(container, selectedId, onSelect) {
  if (!container) return;
  const activeId = isValidAvatarId(selectedId) ? selectedId : 'human-short';

  const buttons = AVATARS.map((av) => {
    const isSelected = av.id === activeId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.avatarId = av.id;
    btn.className = `avatar-option ${isSelected ? 'is-selected' : ''}`;
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    btn.setAttribute('title', av.label);

    const badge = createAvatarNode(av.id, 'w-10 h-10');
    const label = document.createElement('span');
    label.className = `text-[10px] leading-tight truncate max-w-full ${isSelected ? 'text-sage-700 font-semibold' : 'text-ink-500'}`;
    label.textContent = av.label;

    btn.append(badge, label);
    btn.onclick = () => {
      onSelect(av.id);
      renderAvatarPicker(container, av.id, onSelect);
    };
    return btn;
  });

  container.replaceChildren(...buttons);
}
