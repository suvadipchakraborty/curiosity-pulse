const COUNTRIES = [
  ['US', 'United States'], ['IN', 'India'], ['GB', 'United Kingdom'], ['JP', 'Japan'],
  ['ZA', 'South Africa'], ['BR', 'Brazil'], ['DE', 'Germany'], ['AU', 'Australia'],
];
const API_HEADERS = { 'Api-User-Agent': 'CuriosityPulse/1.0 (suvadipchakraborty@gmail.com)' };
// Browsers forbid overriding User-Agent; Wikimedia reads Api-User-Agent for browser clients.
const SKIP = /^(Main_Page|-|Special:.*|Wikipedia:.*|Help:.*|Portal:.*|File:.*|Category:.*|Talk:.*|User:.*|Template:.*)$/i;
const $ = (id) => document.getElementById(id);
const flag = (c) => String.fromCodePoint(...[...c].map((x) => 127397 + x.charCodeAt(0)));
const fmt = new Intl.NumberFormat('en');

/* ---------- Typing tagline ---------- */
(function type() {
  const text = 'tapping into the nervous system of the internet', el = $('tagline');
  let i = 0;
  const tick = () => { el.textContent = text.slice(0, ++i); if (i < text.length) setTimeout(tick, 45); };
  tick();
})();

/* ---------- Reading Pulse ---------- */
const ymd = (daysAgo) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - daysAgo);
  return [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')];
};

async function fetchTop(code) {
  for (const back of [1, 2]) { // yesterday, then fall back a day if not aggregated yet
    const [y, m, d] = ymd(back);
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country/${code}/all-access/${y}/${m}/${d}`;
    const res = await fetch(url, { headers: API_HEADERS });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const articles = (data.items?.[0]?.articles || [])
      .filter((a) => !SKIP.test(a.article))
      .slice(0, 3);
    return { articles, date: `${y}-${m}-${d}` };
  }
  throw new Error('no data');
}

function card([code, name], { articles }) {
  const el = document.createElement('article');
  el.className = 'card';
  const h = document.createElement('h3');
  h.innerHTML = `<span class="flag">${flag(code)}</span>`;
  h.append(name);
  const ol = document.createElement('ol');
  const max = articles[0]?.views_ceil || 1;
  articles.forEach((a, i) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `https://${a.project}.org/wiki/${encodeURIComponent(a.article)}`;
    link.target = '_blank'; link.rel = 'noopener';
    link.textContent = decodeURIComponent(a.article.replace(/%(?![0-9A-F]{2})/gi, '%25')).replace(/_/g, ' ');
    const meta = document.createElement('span');
    meta.className = 'views';
    meta.textContent = `${a.project.replace('.wikipedia', '')} · ≤${fmt.format(a.views_ceil)} views`;
    const bar = document.createElement('div');
    bar.className = 'bar'; bar.style.width = `${Math.max(12, (a.views_ceil / max) * 100)}%`;
    const box = document.createElement('div');
    box.append(link, meta, bar);
    li.innerHTML = `<span class="rank">#${i + 1}</span>`;
    li.append(box); ol.append(li);
  });
  el.append(h, ol);
  return el;
}

async function loadReading() {
  const grid = $('grid');
  grid.replaceChildren(...COUNTRIES.map(() => Object.assign(document.createElement('div'), { className: 'skel' })));
  const results = await Promise.allSettled(COUNTRIES.map(([c]) => fetchTop(c)));
  grid.replaceChildren();
  let date = '';
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { grid.append(card(COUNTRIES[i], r.value)); date = r.value.date; }
    else {
      const e = document.createElement('div');
      e.className = 'card err';
      e.textContent = `${COUNTRIES[i][1]}: couldn't load data. Reload to retry.`;
      grid.append(e);
    }
  });
  $('readDate').textContent = date ? `top reads · ${date} UTC` : '';
}

/* ---------- Live Edit Stream ---------- */
const feed = $('feed'), globe = $('globe'), status = $('status');
const BUCKETS = 40, buckets = new Array(BUCKETS).fill(0);
let total = 0, lastShown = 0, spinTimer;
const pad = (n) => String(n).padStart(2, '0');

function addEdit(e) {
  total++; buckets[BUCKETS - 1]++;
  $('count').textContent = fmt.format(total);
  globe.classList.add('spin');
  clearTimeout(spinTimer); spinTimer = setTimeout(() => globe.classList.remove('spin'), 800);

  const now = performance.now();
  if (now - lastShown < 250) return; // cap DOM rate (~4 rows/sec) for smooth readability
  lastShown = now;

  const t = new Date((e.timestamp || Date.now() / 1000) * 1000);
  const lang = e.wiki.replace(/wiki$/, '') || e.wiki;
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = e.notify_url || e.meta?.uri || '#'; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = `"${e.title}"`;
  const parts = [
    ['t', `[${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}] `], [null, '🌍 '],
    ['w', `[${lang}] `], ['u', e.user], [null, ' edited '],
  ];
  parts.forEach(([cls, txt]) => {
    const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = txt; li.append(s);
  });
  li.append(a);
  feed.prepend(li);
  while (feed.children.length > 60) feed.lastChild.remove();
}

function connect() {
  const es = new EventSource('https://stream.wikimedia.org/v2/stream/recentchange');
  es.onopen = () => { status.className = 'status on'; status.querySelector('b').textContent = 'live'; };
  es.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data);
      if (e.type === 'edit' && e.bot === false) addEdit(e);
    } catch { /* ignore malformed event */ }
  };
  es.onerror = () => {
    status.className = 'status err'; status.querySelector('b').textContent = 'reconnecting';
    // EventSource auto-retries; if it fully closes, reopen manually
    if (es.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
  };
}

/* ---------- Sparkline ---------- */
const cv = $('spark'), ctx = cv.getContext('2d');
function draw() {
  const w = cv.width, h = cv.height, max = Math.max(5, ...buckets);
  ctx.clearRect(0, 0, w, h);
  const pts = buckets.map((v, i) => [(i / (BUCKETS - 1)) * w, h - 6 - (v / max) * (h - 14)]);
  ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 10; ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.shadowBlur = 0; ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,43,214,.35)'); g.addColorStop(1, 'rgba(255,43,214,0)');
  ctx.fillStyle = g; ctx.fill();
  const [lx, ly] = pts[pts.length - 1];
  ctx.beginPath(); ctx.arc(lx - 3, ly, 3, 0, 7); ctx.fillStyle = '#b6ff3b'; ctx.fill();
}
setInterval(() => {
  const recent = buckets.slice(-5).reduce((a, b) => a + b, 0) / 5;
  $('rate').textContent = `${recent.toFixed(1)}/s`;
  buckets.shift(); buckets.push(0); draw();
}, 1000);
draw();

/* ---------- PWA: install, share, service worker ---------- */
let deferred;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; });
$('installBtn').addEventListener('click', async () => {
  if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; }
  else alert('To install: open your browser menu and choose "Install app" or "Add to Home Screen" (on iPhone: Share → Add to Home Screen).');
});
$('shareBtn').addEventListener('click', async () => {
  const data = { title: 'Curiosity Pulse', text: 'See what the world is reading on Wikipedia, live.', url: 'https://curiosity-pulse.suvadipchakraborty.workers.dev/' };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(data.url); $('shareBtn').lastChild.textContent = ' Link copied'; setTimeout(() => ($('shareBtn').lastChild.textContent = ' Share'), 2000); }
  } catch { /* share cancelled */ }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

loadReading();
connect();
