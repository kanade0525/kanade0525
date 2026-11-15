#!/usr/bin/env node
/**
 * 毎日変わる統計の画像 (assets/stat-*.svg) を作る。
 * .github/workflows/stats.yml が1日1回これを動かしてコミットする。
 *
 *   GH_TOKEN=$(gh auth token) node tools/stats.cjs
 *
 * GH_TOKEN         … GitHub の統計を読む。本人のトークンなら非公開の活動も数に入る
 * WAKATIME_API_KEY … WakaTime の OAuth トークン。無ければ「きろくなし」の窓になる
 * --sample         … WakaTime の窓を見本の数字で描く (見た目の確認用。コミットしない)
 *
 * 外に送るのは GitHub と WakaTime への問い合わせだけ。トークンはログに出さない。
 */
'use strict';

const { eachTheme, assertNoMissing, text, textWidth, dqWindow, svg, write } = require('./build.cjs');

const LOGIN = process.env.GH_LOGIN || 'kanade0525';
const SAMPLE = process.argv.includes('--sample');
const ROWS = 7; // 4つの窓の行数をそろえる

/** 言語名 → スキルの色のキー。無いものは灰色 */
const LANG_KEY = {
  Ruby: 'ruby', JavaScript: 'javascript', TypeScript: 'typescript', Vue: 'vue',
  HTML: 'html', CSS: 'docker', Python: 'python', SQL: 'sql', Shell: 'linux',
  Swift: 'perf', Markdown: 'english', JSON: 'aws', YAML: 'aws',
};

/* ---------- GitHub ---------- */
async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${process.env.GH_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profile-stats',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`GitHub API: ${res.status} ${JSON.stringify(json.errors || json.message)}`);
  }
  return json.data;
}

async function github() {
  const base = await gql(
    `query($login:String!){
      user(login:$login){
        pullRequests{totalCount}
        issues{totalCount}
        contributionsCollection{contributionYears}
        repositories(ownerAffiliations:OWNER,isFork:false,privacy:PUBLIC,first:100,orderBy:{field:PUSHED_AT,direction:DESC}){
          totalCount
          nodes{name pushedAt languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{name}}}}
        }
      }
    }`,
    { login: LOGIN }
  );
  const u = base.user;

  // 年ごとのカレンダーを1回でまとめて取る
  const years = [...u.contributionsCollection.contributionYears].sort();
  const parts = years.map(
    (y) =>
      `y${y}: contributionsCollection(from:"${y}-01-01T00:00:00Z",to:"${y}-12-31T23:59:59Z"){contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}`
  );
  const cal = (await gql(`query($login:String!){user(login:$login){${parts.join(' ')}}}`, { login: LOGIN })).user;

  const days = [];
  let total = 0;
  for (const y of years) {
    const c = cal[`y${y}`].contributionCalendar;
    total += c.totalContributions;
    for (const w of c.weeks) for (const d of w.contributionDays) days.push(d);
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));

  // 日づけは日本時間で数える
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const past = days.filter((d) => d.date <= today);
  const yearAgo = new Date(Date.now() + 9 * 3600e3 - 365 * 86400e3).toISOString().slice(0, 10);
  const lastYear = past.filter((d) => d.date > yearAgo).reduce((n, d) => n + d.contributionCount, 0);

  let longest = 0, run = 0;
  for (const d of past) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  // きょうがまだ 0 でも、きのうまで続いていれば切れていない扱いにする
  let i = past.length - 1;
  if (i >= 0 && past[i].contributionCount === 0) i--;
  let current = 0;
  for (; i >= 0 && past[i].contributionCount > 0; i--) current++;

  const sizes = {};
  for (const repo of u.repositories.nodes) {
    for (const e of repo.languages.edges) sizes[e.node.name] = (sizes[e.node.name] || 0) + e.size;
  }
  const sum = Object.values(sizes).reduce((a, b) => a + b, 0) || 1;
  const langs = Object.entries(sizes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, ROWS)
    .map(([name, size]) => ({ name, percent: (size / sum) * 100 }));

  const recent = u.repositories.nodes
    .filter((r) => r.name !== LOGIN)
    .slice(0, ROWS)
    .map((r) => ({ name: r.name, date: new Date(new Date(r.pushedAt).getTime() + 9 * 3600e3) }));

  return {
    total, lastYear, current, longest,
    prs: u.pullRequests.totalCount,
    issues: u.issues.totalCount,
    repos: u.repositories.totalCount,
    langs, recent,
  };
}

/* ---------- WakaTime ---------- */
async function wakatime() {
  if (SAMPLE) {
    return {
      seconds: 23 * 3600 + 40 * 60,
      langs: [
        ['JavaScript', 46.2], ['TypeScript', 21.5], ['CSS', 12.8],
        ['HTML', 9.1], ['Ruby', 6.3], ['Markdown', 4.1],
      ].map(([name, percent]) => ({ name, percent })),
    };
  }
  const key = process.env.WAKATIME_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://wakatime.com/api/v1/users/current/stats/last_7_days?api_key=${encodeURIComponent(key)}`
    );
    // 202 は「集計中」。数字がそろうまでは出さない
    if (res.status !== 200) {
      console.warn(`WakaTime: HTTP ${res.status} (今回は「きろくなし」で描く)`);
      return null;
    }
    const d = (await res.json()).data || {};
    const langs = (d.languages || [])
      .filter((l) => l.total_seconds > 0)
      .slice(0, ROWS - 1)
      .map((l) => ({ name: l.name, percent: l.percent }));
    if (!d.total_seconds || !langs.length) return null;
    return { seconds: d.total_seconds, langs };
  } catch (e) {
    console.warn(`WakaTime: 取得できませんでした (${e.name})`);
    return null;
  }
}

/* ---------- 描く ---------- */
const W = 416;
const X0 = 28, X1 = W - 28; // 中身の左端と右端
const ROW_H = 28;
const TOP = 12;
const WH = 40 + ROWS * ROW_H + 12;
const H = TOP + WH + 4;

function rowY(i) {
  return TOP + 50 + i * ROW_H;
}

function fmt(n) {
  return n.toLocaleString('en-US');
}

/** 幅に入らない名前は末尾を「..」にする */
function fit(str, maxW) {
  if (textWidth(str, 16) <= maxW) return str;
  let s = str;
  while (s.length > 1 && textWidth(s + '..', 16) > maxW) s = s.slice(0, -1);
  return s + '..';
}

/** 左に項目名、右に値 */
function kvWindow(C, name, title, label, rows) {
  let b = dqWindow(4, TOP, W - 8, WH, title);
  rows.forEach(([k, v], i) => {
    b += text(k, X0, rowY(i), 16) + text(v, X1, rowY(i), 16, { anchor: 'end' });
  });
  write(name, svg(W, H, label, b));
}

/** 言語名・10ますのゲージ・割合 */
function langRow(C, lang, i) {
  const y = rowY(i);
  const color = C.skill[LANG_KEY[lang.name]] || C.weak;
  let b = `<rect x="${X0}" y="${y - 12}" width="10" height="10" fill="${color}"/>`;
  b += text(fit(lang.name, 152), X0 + 20, y, 16);
  const filled = Math.max(lang.percent > 0 ? 1 : 0, Math.round(lang.percent / 10));
  for (let n = 0; n < 10; n++) {
    b += `<rect x="${208 + n * 10}" y="${y - 12}" width="8" height="10" fill="${n < filled ? color : C.gauge}"/>`;
  }
  b += text(`${lang.percent.toFixed(1)}%`, X1, y, 16, { anchor: 'end' });
  return b;
}

function draw(gh, waka) {
  eachTheme((C, theme) => {
    C.gauge = theme === 'dark' ? '#2a2a36' : '#dcdce2';

    kvWindow(C, 'stat-record', 'ぼうけんのきろく',
      `GitHub の記録: コントリビューション ${fmt(gh.total)}、この1年 ${fmt(gh.lastYear)}、プルリクエスト ${fmt(gh.prs)}、イシュー ${fmt(gh.issues)}、リポジトリ ${gh.repos}、連続 ${gh.current}日、最長 ${gh.longest}日`,
      [
        ['コントリビューション', fmt(gh.total)],
        ['この1ねん', fmt(gh.lastYear)],
        ['プルリクエスト', fmt(gh.prs)],
        ['イシュー', fmt(gh.issues)],
        ['リポジトリ', fmt(gh.repos)],
        ['れんぞく', `${gh.current}にち`],
        ['さいちょう', `${gh.longest}にち`],
      ]);

    let b = dqWindow(4, TOP, W - 8, WH, 'ことば');
    gh.langs.forEach((l, i) => { b += langRow(C, l, i); });
    write('stat-langs', svg(W, H,
      'よく使う言語: ' + gh.langs.map((l) => `${l.name} ${l.percent.toFixed(1)}%`).join('、'), b));

    kvWindow(C, 'stat-recent', 'さいきんの ぼうけん',
      '最近更新したリポジトリ: ' + gh.recent.map((r) => r.name).join('、'),
      gh.recent.map((r) => [
        fit(r.name, 290),
        `${r.date.getUTCMonth() + 1}/${r.date.getUTCDate()}`,
      ]));

    b = dqWindow(4, TOP, W - 8, WH, 'こんしゅうの しゅぎょう');
    let label = 'WakaTime: 今週の記録はまだありません';
    if (waka) {
      const h = Math.floor(waka.seconds / 3600);
      const m = Math.floor((waka.seconds % 3600) / 60);
      b += text('ごうけい', X0, rowY(0), 16) + text(`${h}じかん ${m}ふん`, X1, rowY(0), 16, { anchor: 'end' });
      waka.langs.forEach((l, i) => { b += langRow(C, l, i + 1); });
      label = `WakaTime: この7日間で ${h}時間${m}分。` + waka.langs.map((l) => `${l.name} ${l.percent.toFixed(1)}%`).join('、');
    } else {
      b += text('まだ きろくが ありません。', W / 2, rowY(3), 16, { anchor: 'middle', fill: C.weak });
    }
    write('stat-waka', svg(W, H, label, b));
  });
}

(async () => {
  if (!process.env.GH_TOKEN) {
    console.error('NG: GH_TOKEN がありません');
    process.exit(1);
  }
  const [gh, waka] = await Promise.all([github(), wakatime()]);
  draw(gh, waka);
  assertNoMissing();
  console.log('OK');
})().catch((e) => {
  console.error(`NG: ${e.message}`);
  process.exit(1);
});
