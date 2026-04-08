import { createSplash } from 'even-toolkit/splash';

/**
 * A simple pixel-art shopping bag rendered with Canvas 2D ops, used as
 * the glasses splash / home tile. Drawn in light grey so it reads well
 * on the monochrome G2 display.
 */

const BAG_ICON = [
  '........#######........',
  '.......#.......#.......',
  '......#.........#......',
  '......#.........#......',
  '......#.........#......',
  '#####.###########.#####',
  '#...#.#.........#.#...#',
  '#...#.#.........#.#...#',
  '#...###############...#',
  '#.....................#',
  '#.....................#',
  '#....####...####......#',
  '#....####...####......#',
  '#.....................#',
  '#....#...........#....#',
  '#.....#..#####..#.....#',
  '#......##.....##......#',
  '#.....................#',
  '#.....................#',
  '#.....................#',
  '#######################',
];

function drawPixelGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
): void {
  const rows = BAG_ICON.length;
  const cols = BAG_ICON[0]!.length;
  const cell = Math.floor(Math.min(w / cols, h / rows));
  const gridW = cell * cols;
  const gridH = cell * rows;
  const offX = Math.floor((w - gridW) / 2);
  const offY = Math.floor((h - gridH) / 2);
  ctx.fillStyle = color;
  for (let y = 0; y < rows; y++) {
    const row = BAG_ICON[y]!;
    for (let x = 0; x < cols; x++) {
      if (row[x] === '#') {
        ctx.fillRect(offX + x * cell, offY + y * cell, cell, cell);
      }
    }
  }
}

export const bringSplash = createSplash({
  render: (ctx, w, h) => drawPixelGrid(ctx, w, h, '#e0e0e0'),
  tiles: 1,
  menuText: 'BRING LENS',
  canvasSize: { w: 200, h: 200 },
  minTimeMs: 1500,
  maxTimeMs: 3500,
});
