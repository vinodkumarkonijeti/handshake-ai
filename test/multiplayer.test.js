const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

let origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
let serverProcess;

before(async () => {
  if (process.env.TEST_ORIGIN) return;

  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
  origin = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe']
  });

  let serverError = '';
  serverProcess.stderr.setEncoding('utf8').on('data', chunk => { serverError += chunk; });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error(`Test server exited early: ${serverError}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  serverProcess.kill();
  throw new Error(`Test server did not become ready: ${serverError}`);
});

after(() => { serverProcess?.kill(); });

function connectedClient() {
  const client = io(origin, { transports: ['websocket'], reconnection: false, timeout: 3000 });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connection timed out')), 4000);
    client.once('connect', () => { clearTimeout(timer); resolve(client); });
    client.once('connect_error', error => { clearTimeout(timer); reject(error); });
  });
}

function onceWhere(client, event, predicate, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off(event, handler); reject(new Error(`Timed out waiting for ${event}`)); }, timeout);
    function handler(value) {
      if (!predicate(value)) return;
      clearTimeout(timer); client.off(event, handler); resolve(value);
    }
    client.on(event, handler);
  });
}

test('two independent clients join one room and receive the same authoritative match state', async t => {
  const host = await connectedClient();
  const guest = await connectedClient();
  t.after(() => { host.disconnect(); guest.disconnect(); });

  const hostJoined = onceWhere(host, 'joined-room', () => true);
  host.emit('create-room', { name: 'Host' });
  const room = await hostJoined;

  const guestJoined = onceWhere(guest, 'joined-room', () => true);
  guest.emit('join-room', { code: room.code, name: 'Guest' });
  await guestJoined;

  const hostPlaying = onceWhere(host, 'state', s => s.status === 'playing');
  const guestPlaying = onceWhere(guest, 'state', s => s.status === 'playing');
  host.emit('start-game');
  const [hostState, guestState] = await Promise.all([hostPlaying, guestPlaying]);
  assert.deepEqual(guestState, hostState);
  assert.equal(hostState.players.length, 2);
  assert.equal(hostState.players.every(p => p.snake.length === 4), true);
  assert.equal(hostState.width, 36);
  assert.equal(hostState.height, 24);

  const hostNext = onceWhere(host, 'state', s => s.status === 'playing' && s.players[0].snake[0].x !== hostState.players[0].snake[0].x);
  const guestNext = onceWhere(guest, 'state', s => s.status === 'playing' && s.players[0].snake[0].x !== guestState.players[0].snake[0].x);
  const [hostTick, guestTick] = await Promise.all([hostNext, guestNext]);
  assert.deepEqual(guestTick, hostTick);
});

test('a disconnected waiting-room player can reclaim their room slot by name', async t => {
  const host = await connectedClient();
  const guest = await connectedClient();
  t.after(() => { host.disconnect(); guest.disconnect(); });

  const joined = onceWhere(host, 'joined-room', () => true);
  host.emit('create-room', { name: 'Host' });
  const room = await joined;
  const hostId = room.id;
  host.disconnect();

  const returningHost = await connectedClient();
  t.after(() => returningHost.disconnect());
  const returned = onceWhere(returningHost, 'state', s => s.status === 'waiting' && s.players.some(p => p.id !== hostId && p.name === 'Host'));
  returningHost.emit('rejoin-room', { code: room.code, name: 'Host' });
  const rejoinedState = await returned;
  assert.equal(rejoinedState.players.length, 1);
  assert.equal(rejoinedState.hostId, rejoinedState.players[0].id);

  const guestJoined = onceWhere(guest, 'joined-room', () => true);
  guest.emit('join-room', { code: room.code, name: 'Guest' });
  await guestJoined;
});
