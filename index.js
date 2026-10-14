#!/usr/bin/env node
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import select from '@inquirer/select';

const media = new URL('./media/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, media));

const ESC = '\x1b[';
const reset = `${ESC}0m`;
const bold = (s) => `${ESC}1m${s}${reset}`;
const dim = (s) => `${ESC}2m${s}${reset}`;
const rgb = (code, [r, g, b]) => `${ESC}${code};2;${r};${g};${b}m`;

function gradient(text, from, to) {
  const chars = [...text];
  return (
    chars
      .map((ch, i) => {
        const t = chars.length > 1 ? i / (chars.length - 1) : 0;
        return rgb(38, from.map((v, k) => Math.round(v + (to[k] - v) * t))) + ch;
      })
      .join('') + reset
  );
}

function portrait() {
  const rows = JSON.parse(read('portrait.json'));
  return rows
    .map((row) =>
      row.map(([ch, fg, bg]) => (fg ? rgb(38, fg) : '') + (bg ? rgb(48, bg) : '') + ch + reset).join(''),
    )
    .join('\n');
}

function openUrl(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

// ---------- Music: the Strudel tune with its code lighting up ----------

// Windows has no command-line mp3 player, but every Windows 10/11 machine has
// Windows PowerShell and the WPF media player. It prints "playing" once
// playback starts, so the animation clock can start with the sound.
function windowsPlayer(file, seconds) {
  const script = [
    'Add-Type -AssemblyName PresentationCore',
    '$p = New-Object System.Windows.Media.MediaPlayer',
    `$p.Open([Uri]'${file.replaceAll("'", "''")}')`,
    '$p.Play()',
    "[Console]::Out.WriteLine('playing'); [Console]::Out.Flush()",
    `Start-Sleep -Seconds ${Math.ceil(seconds) + 1}`,
  ].join('; ');
  // -EncodedCommand sidesteps every quoting rule between Node, cmd and PowerShell.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', encoded], true];
}

// Find something that can play an mp3 on this machine: [command, args, signalsStart].
function findPlayer(file, seconds) {
  if (process.platform === 'win32') return windowsPlayer(file, seconds);
  const candidates =
    process.platform === 'darwin'
      ? [['afplay', [file]]]
      : [
          ['mpg123', ['-q', file]],
          ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]],
          ['paplay', [file]],
        ];
  return candidates.find(([cmd]) => spawnSync('which', [cmd]).status === 0);
}

// Start the audio; resolves once it is (about to be) audible.
function startAudio(player) {
  if (!player) return Promise.resolve(null);
  const [cmd, args, signalsStart] = player;
  const audio = spawn(cmd, args, { stdio: ['ignore', signalsStart ? 'pipe' : 'ignore', 'ignore'], windowsHide: true });
  // Never leave music playing after the CLI is gone.
  const killOnExit = () => audio.kill();
  process.on('exit', killOnExit);
  audio.once('close', () => process.off('exit', killOnExit));
  return new Promise((resolve) => {
    audio.once('error', () => resolve(null)); // couldn't start: animation only
    if (!signalsStart) return audio.once('spawn', () => resolve(audio));
    const ready = () => resolve(audio);
    audio.stdout.once('data', ready);
    audio.once('exit', ready);
    setTimeout(ready, 5000);
  });
}

// Colors for the code view, close to Strudel's default dark theme.
const THEME = {
  text: [171, 178, 191],
  string: [152, 195, 121],
  highlight: [238, 233, 223],
  highlightText: [23, 21, 18],
};

// Per-character base colors: strings (mini-notation) stand out from the rest.
function baseColors(code) {
  const colors = new Array(code.length).fill('text');
  let quote = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      colors[i] = 'string';
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
      colors[i] = 'string';
    }
  }
  return colors;
}

async function playMusic() {
  const tune = JSON.parse(read('tune.json'));
  const mp3 = fileURLToPath(new URL('tune.mp3', media));
  const lines = tune.code.replace(/\n$/, '').split('\n');
  const lineStarts = [];
  lines.reduce((offset, line) => (lineStarts.push(offset), offset + line.length + 1), 0);
  const base = baseColors(tune.code);
  const end = tune.duration + 3;

  const player = findPlayer(mp3, tune.duration);
  const audio = await startAudio(player);
  const startedAt = performance.now();

  const out = process.stdout;
  out.write(`${ESC}?1049h${ESC}?25l`); // alternate screen, hide cursor

  let scroll = 0;
  let timer;
  let done;
  const finished = new Promise((resolve) => (done = resolve));

  let stopped = false;
  const stop = () => {
    // Runs once: the audio's exit handler fires after q, and a second pause
    // of stdin would pull it out from under the menu that's back on screen.
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    audio?.kill();
    process.stdin.off('data', onKey);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    out.write(`${ESC}?25h${ESC}?1049l`);
    done();
  };
  const onKey = (key) => {
    // q, Esc, or Ctrl+C
    if (key === 'q' || key === 'Q' || key === '\x1b' || key === '\x03') stop();
  };
  process.stdin.setRawMode?.(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', onKey);
  audio?.on('exit', () => setTimeout(stop, 300));

  function frame() {
    const t = (performance.now() - startedAt) / 1000;
    if (t > end) return stop();

    // Same rule as Strudel: a code range is lit while any of its events sound.
    const lit = new Uint8Array(tune.code.length);
    const litLines = [];
    for (const [t0, t1, ranges] of tune.events) {
      if (t0 > t) break;
      if (t >= t1) continue;
      for (const [from, to] of ranges) {
        lit.fill(1, from, to);
        litLines.push(lineStarts.findLastIndex((s) => s <= from));
      }
    }

    const width = out.columns || 80;
    const height = Math.max((out.rows || 24) - 3, 5);
    const maxScroll = Math.max(lines.length - height, 0);
    if (litLines.length) {
      // Ease toward the median lit line, so a long-held line far away
      // (like the chords at the top) doesn't drag the view off the action.
      const median = litLines.sort((a, b) => a - b)[litLines.length >> 1];
      const target = Math.min(Math.max(median - (height >> 1), 0), maxScroll);
      scroll += Math.sign(target - scroll) * Math.ceil(Math.abs(target - scroll) / 6);
    }

    const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const barWidth = Math.max(width - 40, 10);
    const filled = Math.round(Math.min(t / tune.duration, 1) * barWidth);
    let screen = `${ESC}H`;
    screen += ` ${bold('🎵 ' + tune.title)}  ${'━'.repeat(filled)}${dim('─'.repeat(barWidth - filled))}  ${mm(Math.min(t, tune.duration))} / ${mm(tune.duration)}${ESC}K\n${ESC}K\n`;

    for (let row = 0; row < height; row++) {
      const n = scroll + row;
      if (n >= lines.length) break;
      const line = lines[n].slice(0, width - 1);
      let current = '';
      let text = ' ';
      for (let i = 0; i < line.length; i++) {
        const at = lineStarts[n] + i;
        const style = lit[at]
          ? rgb(48, THEME.highlight) + rgb(38, THEME.highlightText)
          : rgb(38, THEME[base[at]]);
        if (style !== current) text += reset + style;
        current = style;
        text += line[i];
      }
      screen += text + reset + `${ESC}K\n`;
    }
    screen += `${ESC}J${ESC}${out.rows || 24};1H${dim(audio ? ' q to stop' : ' (no audio player found — animation only)  q to stop')}`;
    out.write(screen);
  }

  timer = setInterval(frame, 1000 / 30);
  frame();
  await finished;
}

// ---------- Update check ----------

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)));

// npx can keep running an old cached copy, so ask the registry what's newest.
// Offline or slow: skip quietly rather than hold up the card.
async function latestVersion() {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const { version } = await res.json();
    return newer(version, pkg.version) ? version : null;
  } catch {
    return null;
  }
}

function newer(a, b) {
  const [x, y] = [a, b].map((v) => v.split('-')[0].split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const update = await latestVersion();

// ---------- Business card ----------

const links = [
  { name: '💻 Overtone Foundry', value: 'https://overtonefoundry.com' },
  { name: '🏢 LinkedIn', value: 'https://www.linkedin.com/in/jeremy-mooer-7959812/' },
  { name: '🐙 GitHub', value: 'https://github.com/jeremym' },
  { name: '📧 Email', value: 'mailto:jeremy.mooer@gmail.com' },
];

function card() {
  console.clear();
  console.log(portrait());
  console.log();
  console.log(' ' + bold(gradient('Jeremy Mooer', [255, 209, 102], [6, 214, 160])));
  console.log(' ' + dim('✨ Bringer of Jollity ✨'));
  console.log();
  if (update) {
    console.log(` ${bold(`🎁 v${update} is out`)} ${dim(`(you're on v${pkg.version})`)} — run ${bold(`npx ${pkg.name}@latest`)}`);
    console.log();
  }
}

card();
try {
  while (true) {
    const choice = await select({
      message: 'Where to?',
      choices: [
        ...links,
        { name: '🎵 Music experiment', value: 'music', description: 'A Strudel tune, with its code lighting up as it plays' },
        { name: '❌ Exit', value: 'exit' },
      ],
    });
    if (choice === 'exit') break;
    if (choice === 'music') {
      await playMusic();
      card();
    } else {
      openUrl(choice);
    }
  }
} catch (error) {
  // Ctrl+C inside the menu
  if (error?.name !== 'ExitPromptError') throw error;
}
console.log(dim('\n👋 Stay jolly.'));
