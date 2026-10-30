const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN || true }, pingInterval: 25000, pingTimeout: 20000 });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'snake-battle' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const rooms = new Map();
const W = 36, H = 24, MAX_PLAYERS = 8, TICK_MS = 120;
const COLORS = ['#b8ff61', '#ff6b8a', '#68ddff', '#ffc857', '#b493ff', '#ff8d5c', '#6fffd2', '#ff76da'];
const DIRECTIONS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' };
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
const rand = (n) => Math.floor(Math.random() * n);
function foodSpot(room) {
  const occupied = new Set([...room.players.values()].flatMap(p => p.snake.map(c => `${c.x},${c.y}`)));
  for (let i = 0; i < 300; i++) { const p = { x: rand(W), y: rand(H) }; if (!occupied.has(`${p.x},${p.y}`)) return p; }
  return { x: rand(W), y: rand(H) };
}
function snapshot(room) {
  return { code: room.code, status: room.status, hostId: room.hostId, players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score, alive: p.alive, connected: p.connected, snake: p.snake })), food: room.food, width: W, height: H, startedAt: room.startedAt, round: room.round };
}
function publish(room) { io.to(room.code).emit('state', snapshot(room)); }
function begin(room) {
  room.status = 'playing'; room.startedAt = Date.now(); room.round++;
  let i = 0;
  for (const p of room.players.values()) {
    const x = i % 2 ? 27 : 8, y = Math.floor(i / 2) * 5 + 5;
    p.snake = Array.from({ length: 4 }, (_, n) => ({ x: x + (i % 2 ? n : -n), y }));
    p.dir = i % 2 ? 'left' : 'right'; p.nextDir = p.dir; p.score = 0; p.alive = true; p.grow = 0; i++;
  }
  room.food = foodSpot(room); publish(room);
}
function tick(room) {
  if (room.status !== 'playing') return;
  const alive = [...room.players.values()].filter(p => p.alive && p.connected);
  const bodySet = new Set([...room.players.values()].filter(p => p.alive).flatMap(p => p.snake.slice(0, -1).map(c => `${c.x},${c.y}`)));
  for (const p of alive) {
    p.dir = p.nextDir;
    const d = DIRECTIONS[p.dir], head = { x: p.snake[0].x + d.x, y: p.snake[0].y + d.y };
    const key = `${head.x},${head.y}`;
    if (head.x < 0 || head.x >= W || head.y < 0 || head.y >= H || bodySet.has(key) || p.snake.slice(0, -1).some(c => c.x === head.x && c.y === head.y)) { p.alive = false; continue; }
    p.snake.unshift(head);
    if (head.x === room.food.x && head.y === room.food.y) { p.score += 10; p.grow += 2; room.food = foodSpot(room); }
    if (p.grow > 0) p.grow--; else p.snake.pop();
  }
  if (alive.length && [...room.players.values()].filter(p => p.connected && p.alive).length <= 1) {
    room.status = 'over'; room.winnerId = [...room.players.values()].find(p => p.alive)?.id || null;
  }
  publish(room);
}
function startLoop(room) { if (room.timer) clearInterval(room.timer); room.timer = setInterval(() => tick(room), TICK_MS); }
function pruneDisconnected(room, playerId) {
  const p = room.players.get(playerId);
  if (!p || p.connected) return;
  room.players.delete(playerId); room.reconnectTimers.delete(playerId);
  if (room.hostId === playerId) room.hostId = room.players.keys().next().value || null;
  if (!room.players.size) { clearInterval(room.timer); rooms.delete(room.code); return; }
  publish(room);
}
function removePlayer(socket, { disconnect = false } = {}) {
  const room = rooms.get(socket.data.room); if (!room) return;
  const p = room.players.get(socket.id); if (!p) return;
  if (disconnect) {
    p.connected = false;
    if (room.status === 'playing') p.alive = false;
    const timer = setTimeout(() => pruneDisconnected(room, socket.id), 45000);
    room.reconnectTimers.set(socket.id, timer);
  } else {
    clearTimeout(room.reconnectTimers.get(socket.id)); room.reconnectTimers.delete(socket.id); room.players.delete(socket.id);
  }
  if (!room.players.size) { clearInterval(room.timer); rooms.delete(room.code); return; }
  if (room.hostId === socket.id) room.hostId = [...room.players.values()].find(player => player.connected)?.id || room.players.keys().next().value || null;
  if (room.status === 'playing' && [...room.players.values()].filter(x => x.connected && x.alive).length <= 1) room.status = 'over';
  publish(room);
}
io.on('connection', socket => {
  socket.emit('connection-status', { connected: true });
  socket.on('create-room', ({ name }) => {
    const roomCode = code();
    const room = { code: roomCode, status: 'waiting', hostId: socket.id, players: new Map(), reconnectTimers: new Map(), food: { x: 18, y: 12 }, round: 0, timer: null };
    rooms.set(roomCode, room); join(socket, room, name);
  });
  socket.on('join-room', ({ code: raw, name }) => {
    const room = rooms.get(String(raw || '').trim().toUpperCase());
    if (!room) return socket.emit('room-error', 'That room code was not found. Check it and try again.');
    join(socket, room, name);
  });
  socket.on('start-game', () => {
    const room = rooms.get(socket.data.room);
    if (!room || socket.id !== room.hostId) return;
    if (room.players.size < 2) return socket.emit('room-error', 'Invite at least one more player before starting.');
    begin(room); startLoop(room);
  });
  socket.on('direction', dir => {
    const room = rooms.get(socket.data.room), p = room?.players.get(socket.id);
    if (!p || !p.alive || !DIRECTIONS[dir] || opposite[p.dir] === dir) return;
    p.nextDir = dir;
  });
  socket.on('restart-game', () => {
    const room = rooms.get(socket.data.room);
    if (!room || socket.id !== room.hostId || room.players.size < 2) return;
    begin(room); startLoop(room);
  });
  socket.on('rejoin-room', ({ code: raw, name }) => {
    const room = rooms.get(String(raw || '').trim().toUpperCase());
    if (!room) return socket.emit('room-error', 'That room is no longer available. Create a new room.');
    const old = [...room.players.values()].find(p => !p.connected && p.name === String(name || '').trim().slice(0, 18));
    if (old) { const oldId = old.id; clearTimeout(room.reconnectTimers.get(oldId)); room.reconnectTimers.delete(oldId); room.players.delete(oldId); old.id = socket.id; old.connected = true; old.alive = room.status === 'playing' ? false : old.alive; room.players.set(socket.id, old); socket.data.room = room.code; socket.data.name = old.name; socket.join(room.code); if (room.hostId === oldId || !room.players.has(room.hostId)) room.hostId = socket.id; socket.emit('joined-room', { code: room.code, id: socket.id }); publish(room); }
    else join(socket, room, name);
  });
  socket.on('leave-room', () => { removePlayer(socket); socket.leave(socket.data.room); socket.data.room = null; });
  socket.on('disconnect', () => { removePlayer(socket, { disconnect: true }); });
});
function join(socket, room, rawName) {
  if (room.status !== 'waiting') return socket.emit('room-error', 'This match has already started.');
  if (room.players.size >= MAX_PLAYERS) return socket.emit('room-error', 'This room is full (8 players maximum).');
  const name = String(rawName || '').trim().slice(0, 18) || 'Player';
  const color = COLORS[room.players.size % COLORS.length];
  room.players.set(socket.id, { id: socket.id, name, color, score: 0, alive: true, connected: true, snake: [], dir: 'right', nextDir: 'right', grow: 0 });
  socket.data.room = room.code; socket.data.name = name; socket.join(room.code); socket.emit('joined-room', { code: room.code, id: socket.id }); publish(room);
}
const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Snake Battle listening on http://localhost:${port}`));
