/* ПУСТОШЬ — релей кооп-рейда + топы Испытания дня */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

/* ===== хранилище топов ===== */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'board.json');
let DB = { names: {}, days: {} };
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) { console.error('хранилище:', e.message); }
let saveT = null;
function saveDB() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(DB)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); }
    catch (e) { console.error('запись:', e.message); }
  }, 300);
}
const utcDay = () => {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};
const clean = s => String(s || '').replace(/[<>&"'\\]/g, '').trim().slice(0, 16);
function board(day) {
  const rows = Object.entries((DB.days[day] || {})).map(([tok, r]) => {
    const secs = r.secs || {};
    const parts = [0, 1, 2].map(i => (secs[i] && secs[i].s) | 0);
    return { name: DB.names[tok] || '???', score: parts[0] + parts[1] + parts[2], parts,
      wins: [0, 1, 2].filter(i => secs[i] && secs[i].w).length,
      time: [0, 1, 2].reduce((a, i) => a + ((secs[i] && secs[i].t) | 0), 0) };
  });
  rows.sort((a, b) => b.score - a.score);
  return rows;
}

/* ===== HTTP: здоровье + API ===== */
function api(req, res, body) {
  const url = new URL(req.url, 'http://x');
  const send = (code, obj) => {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(obj));
  };
  if (req.method === 'OPTIONS') { send(204, {}); return; }
  if (url.pathname === '/api/hello' && req.method === 'POST') {
    let m; try { m = JSON.parse(body); } catch (e) { send(400, { err: 'json' }); return; }
    const name = clean(m.name);
    if (name.length < 2) { send(400, { err: 'позывной от 2 знаков' }); return; }
    const token = (typeof m.token === 'string' && m.token.length === 36) ? m.token : crypto.randomUUID();
    DB.names[token] = name;
    saveDB();
    send(200, { token, name });
    return;
  }
  if (url.pathname === '/api/submit' && req.method === 'POST') {
    let m; try { m = JSON.parse(body); } catch (e) { send(400, { err: 'json' }); return; }
    const token = String(m.token || '');
    if (!DB.names[token]) { send(403, { err: 'нет позывного' }); return; }
    const day = m.day | 0, today = utcDay();
    if (day !== today) { send(400, { err: 'этот день закрыт' }); return; }
    const score = m.score | 0, tm = m.time | 0, kills = m.kills | 0, sec = m.sector | 0;
    if (sec < 0 || sec > 2 || score < 0 || score > 500000 || tm < 5 || tm > 5400 || kills < 0 || kills > 30000 ||
      score > kills * 40 + tm * 30 + 3000) { send(400, { err: 'результат не принят' }); return; }
    if (!DB.days[day]) DB.days[day] = {};
    if (!DB.days[day][token]) DB.days[day][token] = { secs: {} };
    const e = DB.days[day][token];
    if (!e.secs) e.secs = {};
    if (!e.secs[sec] || score > e.secs[sec].s) {
      e.secs[sec] = { s: score, t: tm, k: kills, w: m.win ? 1 : 0, at: Date.now() };
      saveDB();
    }
    const myName = DB.names[token];
    const rows = board(day);
    const rank = rows.findIndex(r => r.name === myName) + 1;
    const mine = rows[rank - 1] || { score: 0, parts: [0, 0, 0] };
    send(200, { rank: rank || rows.length, total: rows.length, secBest: e.secs[sec].s, sum: mine.score, parts: mine.parts });
    return;
  }
  if (url.pathname === '/api/board') {
    const day = (url.searchParams.get('day') | 0) || utcDay();
    const rows = board(day).slice(0, 20);
    send(200, { day, total: board(day).length, rows });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ПУСТОШЬ relay: жив. Комнат: ' + rooms.size + ' · день: ' + utcDay() +
    ' · бойцов в топе дня: ' + board(utcDay()).length + '\n');
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
  req.on('end', () => { try { api(req, res, body); } catch (e) { try { res.writeHead(500); res.end(); } catch (e2) {} } });
});

/* ===== WebSocket-релей (без изменений) ===== */
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const rooms = new Map();
function pipeClose(ws) {
  const r = rooms.get(ws.room);
  if (!r) return;
  const peer = r.h === ws ? r.g : r.h;
  if (peer && peer.readyState === 1) { try { peer.send('{"t":"bye"}'); } catch (e) {} }
  rooms.delete(ws.room);
}
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    const raw = data.toString();
    if (!ws.room) {
      let m;
      try { m = JSON.parse(raw); } catch (e) { ws.close(); return; }
      const code = String(m.room || '').toUpperCase().slice(0, 8);
      if (!code || (m.j !== 'h' && m.j !== 'g')) { ws.close(); return; }
      let r = rooms.get(code);
      if (!r) { r = { h: null, g: null }; rooms.set(code, r); }
      const slot = m.j === 'h' ? 'h' : 'g';
      if (r[slot] && r[slot].readyState === 1) { ws.send('{"err":"в комнате уже двое"}'); ws.close(); return; }
      r[slot] = ws;
      ws.room = code;
      if (r.h && r.g && r.h.readyState === 1 && r.g.readyState === 1) {
        r.h.send('{"paired":1}');
        r.g.send('{"paired":1}');
      }
      return;
    }
    const r = rooms.get(ws.room);
    if (!r) return;
    const peer = r.h === ws ? r.g : r.h;
    if (peer && peer.readyState === 1) peer.send(raw);
  });
  ws.on('close', () => pipeClose(ws));
  ws.on('error', () => {});
});
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { try { ws.terminate(); } catch (e) {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('relay+board на порту', PORT));
