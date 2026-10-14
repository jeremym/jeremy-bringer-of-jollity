// Turn the two-tone profile PNG into terminal art.
// Uses half-block characters: each cell shows two stacked pixels, top in the
// foreground color and bottom in the background color.
// Writes media/portrait.json (cells the CLI renders) and
// art/preview.ansi (cat it to see the result).
//
//   node scripts/build-art.js art/profile.png [columns]
import fs from 'node:fs';
import { PNG } from 'pngjs';

const [file, colsArg = '40'] = process.argv.slice(2);
const cols = Number(colsArg);
const png = PNG.sync.read(fs.readFileSync(file));

// The art is a rounded blue square on a white page; crop to the square.
const CROP = { x: 6, y: 6, size: 276, radius: 24 };

function insideSquare(x, y) {
  const { size, radius: r } = CROP;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Average color of a w x h box in cropped-square coordinates, or null if
// the box center falls outside the rounded square.
function sample(x, y, w, h) {
  if (!insideSquare(x + w / 2, y + h / 2)) return null;
  const sum = [0, 0, 0];
  let n = 0;
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      const i = ((py + CROP.y) * png.width + px + CROP.x) * 4;
      sum[0] += png.data[i];
      sum[1] += png.data[i + 1];
      sum[2] += png.data[i + 2];
      n++;
    }
  }
  return sum.map((v) => Math.round(v / n));
}

// A cell is [char, fg, bg]; fg/bg are [r,g,b] or null for the terminal default.
function blocks() {
  const px = CROP.size / cols;
  const rows = [];
  for (let y = 0; y < cols; y += 2) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      const top = sample(x * px, y * px, px, px);
      const bottom = sample(x * px, (y + 1) * px, px, px);
      if (!top && !bottom) row.push([' ', null, null]);
      else if (!bottom) row.push(['▀', top, null]);
      else if (!top) row.push(['▄', bottom, null]);
      else row.push(['▀', top, bottom]);
    }
    rows.push(row);
  }
  return rows;
}

function toAnsi(rows) {
  const color = (code, c) => (c ? `\x1b[${code};2;${c.join(';')}m` : '');
  return rows
    .map((row) => row.map(([ch, fg, bg]) => color(38, fg) + color(48, bg) + ch + '\x1b[0m').join(''))
    .join('\n');
}

fs.mkdirSync('media', { recursive: true });
const rows = blocks();
fs.writeFileSync('media/portrait.json', JSON.stringify(rows));
fs.writeFileSync('art/preview.ansi', toAnsi(rows) + '\n');
console.log(`portrait: ${rows[0].length}x${rows.length} -> art/preview.ansi`);
