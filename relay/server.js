/* ПУСТОШЬ — релей кооп-рейда: сшивает двух игроков по коду комнаты */
const http = require('http');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ПУСТОШЬ relay: жив. Комнат активно: ' + rooms.size + '\n');
});
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const rooms = new Map(); // code -> { h, g }

function pipeClose(ws) {
  const r = rooms.get(ws.room);
  if (!r) return;
  const peer = r.h === ws ? r.g : r.h;
  if (peer && peer.readyState === 1) {
    try { peer.send('{"t":"bye"}'); } catch (e) {}
  }
  rooms.delete(ws.room);
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    const raw = data.toString();
    if (!ws.room) {
      // первое сообщение — регистрация: {"j":"h"|"g","room":"X7K2"}
      let m;
      try { m = JSON.parse(raw); } catch (e) { ws.close(); return; }
      const code = String(m.room || '').toUpperCase().slice(0, 8);
      if (!code || (m.j !== 'h' && m.j !== 'g')) { ws.close(); return; }
      let r = rooms.get(code);
      if (!r) { r = { h: null, g: null }; rooms.set(code, r); }
      const slot = m.j === 'h' ? 'h' : 'g';
      if (r[slot] && r[slot].readyState === 1) {
        ws.send('{"err":"в комнате уже двое"}');
        ws.close();
        return;
      }
      r[slot] = ws;
      ws.room = code;
      ws.slot = slot;
      if (r.h && r.g && r.h.readyState === 1 && r.g.readyState === 1) {
        r.h.send('{"paired":1}');
        r.g.send('{"paired":1}');
      }
      return;
    }
    // дальше — чистая труба к напарнику
    const r = rooms.get(ws.room);
    if (!r) return;
    const peer = r.h === ws ? r.g : r.h;
    if (peer && peer.readyState === 1) peer.send(raw);
  });
  ws.on('close', () => pipeClose(ws));
  ws.on('error', () => {});
});

// чистка мёртвых соединений
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { try { ws.terminate(); } catch (e) {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('relay на порту', PORT));
