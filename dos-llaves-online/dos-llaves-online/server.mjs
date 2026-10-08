import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LEVELS, ROLES, locate, newLevelState } from './levels.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const ALLOWED_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/game.js', ['game.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_BODY = 4096;

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function getJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const err = new Error('Solicitud demasiado grande');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const err = new Error('JSON no válido');
    err.status = 400;
    throw err;
  }
}

function displayName(value, fallback) {
  const name = String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
  return name || fallback;
}

function randomRoomId(rooms) {
  for (let tries = 0; tries < 20; tries++) {
    let id = '';
    for (let i = 0; i < 6; i++) id += ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)];
    if (!rooms.has(id)) return id;
  }
  throw new Error('No se pudo crear la sala');
}

function otherRole(role) { return role === 'sol' ? 'luna' : 'sol'; }
function tileAt(map, x, y) { return map[y]?.[x] ?? '#'; }
function at(pos, target) { return pos.x === target.x && pos.y === target.y; }

export function createGameServer() {
  const rooms = new Map();

  function pushMessage(room, kind, text, role = null) {
    room.nextMessageId++;
    room.messages.push({ id: room.nextMessageId, kind, text, role, time: Date.now() });
    if (room.messages.length > 45) room.messages.shift();
  }

  function snapshot(room, role) {
    const level = LEVELS[room.level];
    const peerRole = otherRole(role);
    const peer = room.players[peerRole];
    const ownPosition = room.board.positions[role];
    const peerExit = locate(level.maps[peerRole], 'E');
    const exit = locate(level.maps[role], 'E');
    return {
      id: room.id,
      role,
      ownName: room.players[role].name,
      peerName: peer?.name ?? null,
      peerOnline: Boolean(peer && room.clients[peerRole].size),
      status: room.status,
      level: room.level + 1,
      totalLevels: LEVELS.length,
      levelName: level.name,
      hint: level.hint,
      map: level.maps[role],
      position: ownPosition,
      gateOpen: room.board.gates[role],
      ownSwitchActivated: room.board.gates[peerRole],
      crystalCollected: room.board.crystals[role],
      crystalRequired: Boolean(locate(level.maps[role], 'C')),
      atExit: at(ownPosition, exit),
      peerAtExit: Boolean(peer && at(room.board.positions[peerRole], peerExit)),
      peerCrystalCollected: room.board.crystals[peerRole],
      messages: room.messages,
      startedAt: room.startedAt,
      finishedAt: room.finishedAt,
    };
  }

  function sendState(room) {
    room.updatedAt = Date.now();
    for (const role of ROLES) {
      if (!room.players[role]) continue;
      const event = `event: state\ndata: ${JSON.stringify(snapshot(room, role))}\n\n`;
      for (const client of room.clients[role]) {
        if (client.destroyed || client.writableEnded) { room.clients[role].delete(client); continue; }
        try { client.write(event); } catch { room.clients[role].delete(client); }
      }
    }
  }

  function newRoom(name) {
    const id = randomRoomId(rooms);
    const token = crypto.randomBytes(24).toString('hex');
    const room = {
      id,
      players: { sol: { token, name: displayName(name, 'Sol') }, luna: null },
      clients: { sol: new Set(), luna: new Set() },
      board: newLevelState(0),
      level: 0,
      status: 'waiting',
      startedAt: null,
      finishedAt: null,
      messages: [],
      nextMessageId: 0,
      updatedAt: Date.now(),
      transitionTimeout: null,
      lastChat: { sol: 0, luna: 0 },
    };
    pushMessage(room, 'system', 'Sala creada. Comparte el enlace para empezar.');
    rooms.set(id, room);
    return { room, token, role: 'sol' };
  }

  function auth(room, token) {
    return ROLES.find(r => room.players[r]?.token === token) ?? null;
  }

  function action(room, role, data) {
    if (data.type === 'restart') {
      if (room.status === 'transition' && room.transitionTimeout) clearTimeout(room.transitionTimeout);
      room.level = 0;
      room.board = newLevelState(0);
      room.status = room.players.luna ? 'playing' : 'waiting';
      room.startedAt = room.players.luna ? Date.now() : null;
      room.finishedAt = null;
      pushMessage(room, 'system', `${room.players[role].name} ha reiniciado la aventura.`);
      sendState(room);
      return { ok: true };
    }

    if (data.type === 'chat') {
      const text = String(data.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
      if (!text) return { ok: false, reason: 'Escribe un mensaje.' };
      if (Date.now() - room.lastChat[role] < 500) return { ok: false, reason: 'Espera un instante antes de enviar otro mensaje.' };
      room.lastChat[role] = Date.now();
      pushMessage(room, 'chat', text, role);
      sendState(room);
      return { ok: true };
    }

    if (data.type !== 'move' || !['up', 'down', 'left', 'right'].includes(data.direction)) {
      return { ok: false, reason: 'Acción no válida.' };
    }
    if (room.status !== 'playing') return { ok: false, reason: 'Espera a tu compañero para jugar.' };
    if (!room.clients.sol.size || !room.clients.luna.size) {
      return { ok: false, reason: 'Tu compañero está desconectado.' };
    }
    const step = {
      up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
    }[data.direction];
    const pos = room.board.positions[role];
    const next = { x: pos.x + step[0], y: pos.y + step[1] };
    const symbol = tileAt(LEVELS[room.level].maps[role], next.x, next.y);
    if (symbol === '#') return { ok: false, reason: 'Por ahí no hay camino.' };
    if (symbol === 'D' && !room.board.gates[role]) {
      return { ok: false, reason: 'La puerta está cerrada. Tu pareja debe activar su interruptor.' };
    }
    if (symbol === 'E' && locate(LEVELS[room.level].maps[role], 'C') && !room.board.crystals[role]) {
      return { ok: false, reason: 'Necesitas recoger primero el cristal.' };
    }
    room.board.positions[role] = next;
    if (symbol === 'P' && !room.board.gates[otherRole(role)]) {
      room.board.gates[otherRole(role)] = true;
      pushMessage(room, 'system', `¡${room.players[role].name} ha abierto la puerta de su pareja!`);
    }
    if (symbol === 'C' && !room.board.crystals[role]) {
      room.board.crystals[role] = true;
      pushMessage(room, 'system', `${room.players[role].name} ha encontrado su cristal.`);
    }
    if (symbol === 'E') {
      pushMessage(room, 'system', `${room.players[role].name} ha llegado a la salida.`);
    }
    const exits = ROLES.every(r => at(room.board.positions[r], locate(LEVELS[room.level].maps[r], 'E')));
    if (exits) {
      if (room.level === LEVELS.length - 1) {
        room.status = 'finished';
        room.finishedAt = Date.now();
        pushMessage(room, 'system', '¡Habéis completado los tres niveles juntos!');
      } else {
        room.status = 'transition';
        pushMessage(room, 'system', '¡Nivel superado! Preparando el siguiente...');
        room.transitionTimeout = setTimeout(() => {
          room.level++;
          room.board = newLevelState(room.level);
          room.status = 'playing';
          room.transitionTimeout = null;
          pushMessage(room, 'system', `Nivel ${room.level + 1}: ${LEVELS[room.level].name}.`);
          sendState(room);
        }, 1500);
        room.transitionTimeout.unref?.();
      }
    }
    sendState(room);
    return { ok: true };
  }

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    try {
      if (req.method === 'POST' && pathname === '/api/rooms') {
        const input = await getJson(req);
        const { room, token, role } = newRoom(input.name);
        return json(res, 201, { id: room.id, token, role });
      }
      const roomMatch = /^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|state|events|action))?$/.exec(pathname);
      if (roomMatch) {
        const id = roomMatch[1];
        const command = roomMatch[2];
        const room = rooms.get(id);
        if (!room) return json(res, 404, { error: 'Esa sala no existe o ha caducado.' });
        if (command === 'join' && req.method === 'POST') {
          const input = await getJson(req);
          if (room.players.luna) return json(res, 409, { error: 'La sala ya tiene dos jugadores.' });
          const token = crypto.randomBytes(24).toString('hex');
          room.players.luna = { token, name: displayName(input.name, 'Luna') };
          room.status = 'playing';
          room.startedAt = Date.now();
          pushMessage(room, 'system', `${room.players.luna.name} se ha unido. ¡A jugar!`);
          sendState(room);
          return json(res, 201, { id, token, role: 'luna' });
        }
        if (command === 'action' && req.method === 'POST') {
          const input = await getJson(req);
          const role = auth(room, input.token);
          if (!role) return json(res, 401, { error: 'Tu acceso a la sala no es válido.' });
          return json(res, 200, action(room, role, input));
        }
        if (req.method !== 'GET' || !['state', 'events'].includes(command)) {
          return json(res, 404, { error: 'Ruta no encontrada.' });
        }
        const token = url.searchParams.get('token');
        const role = auth(room, token);
        if (!role) return json(res, 401, { error: 'Tu acceso a la sala no es válido.' });
        if (command === 'state' && req.method === 'GET') return json(res, 200, snapshot(room, role));
        if (command === 'events' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.write(': conectado\n\n');
          room.clients[role].add(res);
          sendState(room);
          const heartbeat = setInterval(() => {
            if (!res.destroyed && !res.writableEnded) res.write(': latido\n\n');
          }, 20000);
          res.on('error', () => { room.clients[role].delete(res); });
          res.on('close', () => {
            clearInterval(heartbeat);
            room.clients[role].delete(res);
            sendState(room);
          });
          return;
        }
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && ALLOWED_FILES.has(pathname)) {
        const [file, type] = ALLOWED_FILES.get(pathname);
        const contents = await readFile(path.join(PUBLIC, file));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : contents);
      }
      return json(res, 404, { error: 'No encontrado.' });
    } catch (error) {
      if (!res.headersSent) json(res, error.status ?? 500, { error: error.status ? error.message : 'Error interno del servidor.' });
      else res.end();
    }
  }

  const server = http.createServer(handle);
  const sweep = setInterval(() => {
    for (const [id, room] of rooms) {
      if (Date.now() - room.updatedAt > ROOM_MAX_AGE_MS && !room.clients.sol.size && !room.clients.luna.size) {
        if (room.transitionTimeout) clearTimeout(room.transitionTimeout);
        rooms.delete(id);
      }
    }
  }, 60000);
  sweep.unref();
  server.on('close', () => {
    clearInterval(sweep);
    for (const room of rooms.values()) {
      if (room.transitionTimeout) clearTimeout(room.transitionTimeout);
      for (const role of ROLES) for (const res of room.clients[role]) res.end();
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const server = createGameServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Dos Llaves disponible en http://localhost:${port}`);
  });
}
