#!/usr/bin/env node
/**
 * プロフィール README 用の画像 (assets/*.svg) を作る。
 *
 * ポートフォリオ (kanade0525.github.io/portfolio) と同じ見た目にそろえるため、
 * 同じフォント「Nuあんこもち」と同じドット絵を使う。
 *
 *   npm i --no-save opentype.js@1.3.4
 *   node tools/build.cjs
 *
 * フォントと元画像は ~/development/portfolio から読む (PORTFOLIO で変更可)。
 * フォントは再頒布できないので、このリポジトリには置かない。
 * 文字は1行ごとに1つのパスへまとめて SVG に描いている (1字ずつの切り出しはしない)。
 *
 * Nuあんこもちに無い漢字は実行時にエラーで知らせる。カタカナ等に置き換えること。
 * 作品の画像は WebP のままでは埋め込まず、sips で JPEG / PNG に直してから入れる (macOS 前提)。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const opentype = require('opentype.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(ROOT, 'assets');
const PORTFOLIO = process.env.PORTFOLIO || path.join(os.homedir(), 'development', 'portfolio');
// Actions の上ではポートフォリオを別に取ってきて、FONT でフォントの場所を渡す
const FONT_PATH =
  process.env.FONT ||
  path.join(PORTFOLIO, 'font', 'NuAnkoMochi-v1.0.0-20200104', 'Nuあんこもち', 'NuAnkoMochi-Reg.otf');

/* ---------- 色 (ポートフォリオの暗いテーマ / 明るいテーマと同じ値) ---------- */
const THEMES = {
  dark: {
    window: '#000', line: '#fff', text: '#fff', name: '#e9e9ef', weak: '#a2a2b0', link: '#5cc6f2',
    shotBg: '#0d0d13',
    blue: '#209cee', green: '#92cc41', yellow: '#f7d51d', red: '#e76e55',
    skill: {
      ruby: '#ef7a67', javascript: '#d7bb2e', typescript: '#6cb3f0', vue: '#58c08d',
      html: '#f0967c', python: '#6fb2e8', sql: '#8fb5c9', aws: '#f0a63e',
      docker: '#58b3f2', linux: '#c9c9d6', english: '#b79ce0', perf: '#f0836a',
    },
  },
  // 見出しの4色は、白地でも読めるようにスキルの色 (コントラスト比3:1以上) から取っている
  light: {
    window: '#fff', line: '#212529', text: '#333', name: '#333', weak: '#6b6b6b', link: '#1479a8',
    shotBg: '#222529',
    blue: '#1B7FCC', green: '#35895F', yellow: '#A88A00', red: '#B5432E',
    skill: {
      ruby: '#9F2616', javascript: '#A88A00', typescript: '#3178C6', vue: '#35895F',
      html: '#D45D3C', python: '#3776AB', sql: '#436374', aws: '#C77700',
      docker: '#1B7FCC', linux: '#333', english: '#7B5EA7', perf: '#B5432E',
    },
  },
};

/** いま描いているテーマ。build() が差し替える */
let THEME = 'dark';
let C = THEMES.dark;

/* ---------- 文字 ---------- */
const font = opentype.loadSync(FONT_PATH);
const UPM = font.unitsPerEm; // 800。1ドット = 100

/** 文字幅 (px)。size は 8 の倍数にするとドットが整数pxに乗る */
function textWidth(str, size, ls = 0) {
  let w = 0;
  for (const ch of str) w += (font.charToGlyph(ch).advanceWidth * size) / UPM + ls;
  return w - (str.length ? ls : 0);
}

const missing = new Set();

/** 1行ぶんの文字を1つの path の d にする。x は左端、y はベースライン */
function textD(str, x, y, size, ls = 0) {
  let d = '';
  let cx = x;
  for (const ch of str) {
    const g = font.charToGlyph(ch);
    if (g.index === 0 && ch.trim()) missing.add(ch);
    for (const c of g.getPath(cx, y, size).commands) {
      if (c.type === 'Z') d += 'Z';
      else d += c.type + r(c.x) + ' ' + r(c.y);
    }
    cx += (g.advanceWidth * size) / UPM + ls;
  }
  return d;
}

function r(n) {
  return String(Math.round(n * 100) / 100);
}

/**
 * 文字を描く。
 * opts.bold … ブラウザの太字合成と同じく、同じ色の線で太らせる
 * opts.anchor … 'start' | 'middle' | 'end'
 */
function text(str, x, y, size, opts = {}) {
  const { fill = C.text, bold = false, anchor = 'start', ls = 0, extra = '' } = opts;
  const w = textWidth(str, size, ls);
  const x0 = anchor === 'middle' ? Math.round(x - w / 2) : anchor === 'end' ? Math.round(x - w) : x;
  const stroke = bold ? ` stroke="${fill}" stroke-width="${r(size / 16)}" stroke-linejoin="miter"` : '';
  return `<path fill="${fill}"${stroke}${extra} d="${textD(str, x0, y, size, ls)}"/>`;
}

/**
 * 幅に収まるように折り返す。日本語は1文字ずつ、英単語は途中で切らない。
 * 切れ目を決めたいところには \n を入れておく
 */
function wrap(str, size, maxW) {
  if (str.includes('\n')) return str.split('\n').flatMap((part) => wrap(part, size, maxW));
  const tokens = str.match(/[A-Za-z0-9.+#/'-]+|\s+|./gu) || [];
  const lines = [];
  let line = '';
  for (const t of tokens) {
    if (textWidth(line + t, size) > maxW && line.trim()) {
      lines.push(line.trimEnd());
      line = t.trim() ? t : '';
    } else {
      line += t;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  // 行頭に句読点が来たら前の行へ送る
  for (let i = 1; i < lines.length; i++) {
    if (/^[、。）」]/u.test(lines[i])) {
      lines[i - 1] += lines[i][0];
      lines[i] = lines[i].slice(1);
    }
  }
  return lines.filter(Boolean);
}

/* ---------- 部品 ---------- */

/** ドラクエ風の窓。title を渡すと上の枠線の中央に見出しを載せる */
function dqWindow(x, y, w, h, title) {
  let s =
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.line}"/>` +
    `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" fill="${C.window}"/>`;
  if (title) {
    const size = 16;
    const tw = textWidth(title, size);
    const cx = x + w / 2;
    s +=
      `<rect x="${Math.round(cx - tw / 2) - 12}" y="${y - 8}" width="${Math.round(tw) + 24}" height="20" fill="${C.window}"/>` +
      text(title, cx, y + 9, size, { anchor: 'middle' });
  }
  return s;
}

/** 点滅 (SMIL)。動かない環境では出たままになる */
function blink(inner, dur = '1s') {
  return `<g>${inner}<animate attributeName="opacity" values="1;0" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/></g>`;
}

let clipSeq = 0;

/**
 * 1文字ずつ出てくる行。動かない環境では最初から全部見える。
 * begin … 出はじめる秒、cps … 1秒あたりの文字数
 */
function typed(str, x, y, size, begin, cps = 22, opts = {}) {
  const id = 'c' + ++clipSeq;
  const widths = [0];
  let w = 0;
  for (const ch of str) {
    w += (font.charToGlyph(ch).advanceWidth * size) / UPM;
    widths.push(Math.ceil(w));
  }
  const dur = str.length / cps;
  const top = y - size;
  const clip =
    `<clipPath id="${id}"><rect x="${x}" y="${top}" width="${widths[widths.length - 1]}" height="${size * 1.5}">` +
    `<animate attributeName="width" values="${widths.join(';')}" calcMode="discrete" begin="${r(begin)}s" dur="${r(dur)}s" fill="freeze"/>` +
    (begin > 0
      ? `<set attributeName="width" to="0" begin="0s" end="${r(begin)}s"/>`
      : '') +
    `</rect></clipPath>`;
  return {
    svg: clip + `<g clip-path="url(#${id})">${text(str, x, y, size, opts)}</g>`,
    end: begin + dur,
    width: widths[widths.length - 1],
  };
}

function dataUri(file, mime) {
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** ポートフォリオの WebP を、SVG に埋め込める形式に直して data URI で返す */
function convert(src, format, maxSize) {
  const tmp = path.join(os.tmpdir(), `profile-${path.basename(src)}.${format === 'png' ? 'png' : 'jpg'}`);
  const args = ['-s', 'format', format];
  if (format === 'jpeg') args.push('-s', 'formatOptions', '78');
  if (maxSize) args.push('-Z', String(maxSize));
  execFileSync('sips', [...args, src, '--out', tmp], { stdio: 'ignore' });
  const uri = dataUri(tmp, format === 'png' ? 'image/png' : 'image/jpeg');
  fs.unlinkSync(tmp);
  return uri;
}

function svg(w, h, label, body) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}" shape-rendering="crispEdges">` +
    `<title>${label}</title>` +
    body +
    `</svg>\n`
  );
}

function write(name, content) {
  const file = `${name}-${THEME}.svg`;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), content);
  console.log(`${file}  ${(Buffer.byteLength(content) / 1024).toFixed(1)} KB`);
}

/* ---------- ヘッダー ---------- */
function header() {
  const W = 840;
  const H = 404;
  let b = '';

  // 左: つよさ
  const sx = 16, sy = 28, sw = 292, sh = 132;
  b += dqWindow(sx, sy, sw, sh, 'かなで');
  const rows = [
    ['しごと', 'Webエンジニア'],
    ['けいけん', '6ねんめ'],
    ['とくい', 'Ruby / Nuxt 3'],
  ];
  rows.forEach(([k, v], i) => {
    const y = sy + 48 + i * 30;
    b += text(k, sx + 28, y, 16) + text(v, sx + 116, y, 16);
  });

  // 右: コマンド
  const cw = 252, cx = W - 16 - cw, cy = 28, ch = 132;
  b += dqWindow(cx, cy, cw, ch, 'コマンド');
  ['ポートフォリオ', 'さくひん', 'とくぎ'].forEach((label, i) => {
    const y = cy + 48 + i * 30;
    if (i === 0) b += blink(text('▶', cx + 28, y, 16), '0.9s');
    b += text(label, cx + 52, y, 16);
  });

  // 中央: 自画像 (46x60 のドット絵を 3倍) と名前
  const iw = 138, ih = 180;
  const portrait = convert(path.join(PORTFOLIO, 'img', 'mv.webp'), 'png');
  b += `<image href="${portrait}" x="${(W - iw) / 2}" y="20" width="${iw}" height="${ih}" style="image-rendering:pixelated"/>`;
  b += text('KANADE ISHIDA', W / 2, 250, 40, { anchor: 'middle', bold: true, ls: 4, fill: C.name });

  // 下: メッセージ
  const mx = 16, my = 276, mw = W - 32, mh = 112;
  b += dqWindow(mx, my, mw, mh);
  const l1 = typed('HELLO WORLD! Ruby と JavaScript で なんでも つくる Webエンジニアです。', mx + 28, my + 44, 16, 0);
  const l2 = typed('おもいついたら とりあえず つくる。', mx + 28, my + 80, 16, l1.end + 0.25);
  b += l1.svg + l2.svg;
  b += blink(text('▼', mx + mw - 44, my + mh - 20, 16), '1s');

  write('header', svg(W, H, '石田かなで。Webエンジニア、6年目。得意は Ruby と Nuxt 3。', b));
}

/* ---------- 見出し ---------- */
function heading(name, label, color) {
  const W = 840, H = 64;
  const b = text(label, W / 2, 46, 32, { anchor: 'middle', bold: true, ls: 2, fill: color });
  write(name, svg(W, H, label, b));
}

/* ---------- 作品カード ---------- */
function work({ id, title, subtitle, tags }) {
  const W = 416;
  const pad = 16;
  const iw = W - pad * 2, ih = Math.round((iw * 9) / 16);
  const lines = wrap(subtitle, 16, iw - 8);
  const H = pad + ih + 34 + lines.length * 26 + 30 + pad + 2;

  let b = dqWindow(4, 4, W - 8, H - 8);
  const shot = convert(path.join(PORTFOLIO, 'img', 'works', `${id}.webp`), 'jpeg', 640);
  b += `<rect x="${pad}" y="${pad}" width="${iw}" height="${ih}" fill="${C.shotBg}"/>`;
  b += `<image href="${shot}" x="${pad}" y="${pad}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid slice"/>`;

  let y = pad + ih + 32;
  b += text(title, pad + 4, y, 16);
  lines.forEach((ln) => {
    y += 26;
    b += text(ln, pad + 4, y, 16, { fill: C.weak });
  });
  y += 30;
  b += text(tags.join(' / '), pad + 4, y, 16, { fill: C.link });

  write(`work-${id}`, svg(W, H, `${title}。${subtitle.replace(/\n/g, '')}`, b));
  return H;
}

/* ---------- スキル ---------- */
function skills() {
  const W = 840;
  const items = [
    ['Ruby (Rails)', 'ruby'],
    ['JavaScript', 'javascript'],
    ['TypeScript', 'typescript'],
    ['Vue.js / Nuxt 3', 'vue'],
    ['HTML5 / CSS3', 'html'],
    ['Python', 'python'],
    ['SQL', 'sql'],
    ['AWS', 'aws'],
    ['Docker', 'docker'],
    ['Linux', 'linux'],
    ['English', 'english'],
    ['Performance Tuning', 'perf'],
  ];
  const cols = 3;
  const rowsN = Math.ceil(items.length / cols);
  const wx = 16, wy = 12, ww = W - 32, wh = 56 + rowsN * 30;
  const H = wy + wh + 16;
  let b = dqWindow(wx, wy, ww, wh, 'とくぎ');
  const colW = (ww - 56) / cols;
  items.forEach(([label, key], i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = wx + 32 + Math.round(col * colW);
    const y = wy + 50 + row * 30;
    b += `<rect x="${x}" y="${y - 12}" width="10" height="10" fill="${C.skill[key]}"/>`;
    b += text(label, x + 22, y, 16);
  });
  write('skills', svg(W, H, 'スキル: ' + items.map((i) => i[0]).join('、'), b));
}

/* ---------- 実行 ---------- */
const WORKS = [
  {
    id: 'getting-secure-it',
    title: 'Getting Secure It',
    subtitle: '毎日ちがうコウゲキからネットショップを守る、\nWebセキュリティを学ぶゲーム',
    tags: ['JavaScript', 'Web Audio', 'SVG'],
  },
  {
    id: 'roguelike-game',
    title: 'Katabasis',
    subtitle: '入るたびに形の変わるダンジョンをタンサクする、\n不思議のダンジョン風ローグライク',
    tags: ['Nuxt 3', 'TypeScript', 'Phaser 3'],
  },
  {
    id: 'showa-retro-css',
    title: 'ショウワレトロ.css',
    subtitle: '画像もJavaScriptも使わない、\nショウワレトロなCSSフレームワーク',
    tags: ['CSS', 'npm'],
  },
  {
    id: 'oyayubi-dojo',
    title: 'オヤユビシフトタイピング道場',
    subtitle: '同時打ケンのズレをミリ秒で見せる、\nオヤユビシフトのレンシュウサイト',
    tags: ['JavaScript', 'Web Audio'],
  },
];

/** テーマを1つずつ切り替えながら fn を呼ぶ */
function eachTheme(fn) {
  for (const theme of Object.keys(THEMES)) {
    THEME = theme;
    C = THEMES[theme];
    fn(C, theme);
  }
}

/** フォントに無い文字を使っていたら、知らせて止める */
function assertNoMissing() {
  if (missing.size) {
    console.error(`NG: Nuあんこもちに無い文字があります: ${[...missing].join(' ')}`);
    process.exit(1);
  }
}

function main() {
  let heights = [];
  eachTheme(() => {
    header();
    heading('heading-works', 'WORKS', C.blue);
    heading('heading-skill', 'SKILL', C.green);
    heading('heading-status', 'STATUS', C.red);
    heading('heading-activity', 'ACTIVITY', C.yellow);
    heights = WORKS.map(work);
    skills();
  });
  if (new Set(heights).size > 1) {
    console.warn(`注意: 作品カードの高さがそろっていません (${heights.join(', ')})。説明文の行数をそろえてください。`);
  }
  assertNoMissing();
  console.log('OK');
}

// 毎日作り直す統計の画像は tools/stats.cjs。部品はここから借りる
module.exports = { eachTheme, assertNoMissing, text, textWidth, dqWindow, svg, write };

if (require.main === module) main();
