const $ = id => document.getElementById(id);
const landing = $('landing');
const game = $('game');
const landingError = $('landingError');
const board = $('board');
const state = { session: null, data: null, events: null, lastMessageId: -1, lastBoardSignature: '', lastMoveAt: 0, toasting: null, connected: false };

function show(id, visible) { $(id).classList.toggle('hidden', !visible); }
function roomLink(id) { return `${location.origin}/?sala=${encodeURIComponent(id)}`; }
function savedKey(id) { return `dos-llaves:session:${id}`; }
function setError(message) { landingError.textContent = message || ''; }
function setBusy(busy) { $('createButton').disabled = busy; $('joinButton').disabled = busy; }
function nameValue() { return $('playerName').value.trim().slice(0, 20); }
function sessionSaved(session) {
  localStorage.setItem(savedKey(session.id), JSON.stringify(session));
  history.replaceState(null, '', `/?sala=${session.id}`);
}
async function request(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Ha ocurrido un error de conexión.');
  return json;
}

async function createRoom() {
  setBusy(true); setError('');
  try {
    const result = await request('/api/rooms', { name: nameValue() });
    await enterRoom(result);
  } catch (error) { setError(error.message); }
  finally { setBusy(false); }
}

async function joinRoom() {
  const id = $('roomCode').value.replace(/[^a-zA-Z2-9]/g, '').toUpperCase();
  if (id.length !== 6) return setError('Introduce un código de seis caracteres.');
  setBusy(true); setError('');
  try {
    const result = await request(`/api/rooms/${id}/join`, { name: nameValue() });
    await enterRoom(result);
  } catch (error) { setError(error.message); }
  finally { setBusy(false); }
}

async function enterRoom(session) {
  if (state.events) state.events.close();
  const res = await fetch(`/api/rooms/${session.id}/state?token=${encodeURIComponent(session.token)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'No se ha podido entrar.');
  state.session = session;
  state.data = null;
  state.lastMessageId = -1;
  state.lastBoardSignature = '';
  state.connected = false;
  sessionSaved(session);
  landing.classList.add('hidden');
  game.classList.remove('hidden');
  render(data);
  connect();
}

function connect() {
  const { id, token } = state.session;
  const events = new EventSource(`/api/rooms/${id}/events?token=${encodeURIComponent(token)}`);
  state.events = events;
  events.addEventListener('open', () => {
    state.connected = true;
    show('connectingBanner', false);
  });
  events.addEventListener('state', event => {
    try { render(JSON.parse(event.data)); }
    catch { toast('No se pudo actualizar la partida.'); }
  });
  events.addEventListener('error', () => {
    state.connected = false;
    show('connectingBanner', true);
  });
}

function element(tag, classes = '', text = '') {
  const node = document.createElement(tag);
  if (classes) node.className = classes;
  if (text) node.textContent = text;
  return node;
}

function drawBoard(d) {
  const signature = `${d.level}|${d.role}|${d.position.x},${d.position.y}|${d.gateOpen}|${d.ownSwitchActivated}|${d.crystalCollected}`;
  if (signature === state.lastBoardSignature) return;
  state.lastBoardSignature = signature;
  board.replaceChildren();
  board.style.setProperty('--cols', d.map[0].length);
  board.style.setProperty('--rows', d.map.length);
  board.style.gridTemplateColumns = `repeat(${d.map[0].length}, minmax(0,1fr))`;
  board.style.gridTemplateRows = `repeat(${d.map.length}, minmax(0,1fr))`;
  const frag = document.createDocumentFragment();
  for (let y = 0; y < d.map.length; y++) {
    for (let x = 0; x < d.map[y].length; x++) {
      const type = d.map[y][x];
      let cls = 'tile';
      if (type === '#') cls += ' tile--wall';
      if (type === 'P') cls += ` tile--switch${d.ownSwitchActivated ? ' activated' : ''}`;
      if (type === 'D') cls += ` tile--door${d.gateOpen ? ' open' : ''}`;
      if (type === 'E') cls += ` tile--exit${d.atExit ? ' reached' : ''}`;
      if (type === 'C') cls += ` tile--crystal${d.crystalCollected ? ' collected' : ''}`;
      const tile = element('div', cls);
      tile.dataset.x = x;
      tile.dataset.y = y;
      if (x === d.position.x && y === d.position.y) {
        tile.append(element('span', `avatar avatar--${d.role}`, d.role === 'sol' ? '☀' : '☾'));
      }
      frag.append(tile);
    }
  }
  board.append(frag);
}

function setCheck(id, done) {
  const target = $(id);
  target.textContent = done ? '✓' : '○';
  target.classList.toggle('done', done);
}

function drawMessages(d) {
  const last = d.messages.at(-1)?.id ?? 0;
  if (last === state.lastMessageId) return;
  state.lastMessageId = last;
  const chat = $('chatMessages');
  const atBottom = chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 40;
  const frag = document.createDocumentFragment();
  if (!d.messages.length) frag.append(element('p', 'chat-empty', 'Aquí aparecerán vuestros mensajes.'));
  for (const message of d.messages) {
    const line = element('p', `chat-line ${message.kind}`);
    if (message.kind === 'chat') {
      const label = message.role === d.role ? 'Tú' : d.peerName || 'Pareja';
      line.append(element('span', `who ${message.role}`, `${label}:`));
      line.append(document.createTextNode(` ${message.text}`));
    } else line.textContent = message.text;
    frag.append(line);
  }
  chat.replaceChildren(frag);
  if (atBottom || last < 4) chat.scrollTop = chat.scrollHeight;
}

function render(d) {
  state.data = d;
  $('levelTitle').textContent = d.levelName;
  $('levelHint').textContent = d.hint;
  $('levelNumber').innerHTML = `${String(d.level).padStart(2, '0')} <small>/ ${String(d.totalLevels).padStart(2, '0')}</small>`;
  document.querySelectorAll('#levelTrack span').forEach((bar, i) => {
    bar.className = i + 1 < d.level ? 'complete' : i + 1 === d.level ? 'current' : '';
  });
  $('boardHeading').textContent = d.role === 'sol' ? 'Mundo Sol' : 'Mundo Luna';
  $('ownName').textContent = d.ownName;
  $('ownAvatar').className = `avatar-mini ${d.role === 'sol' ? 'sun' : 'moon'}`;
  $('ownAvatar').textContent = d.role === 'sol' ? '☀' : '☾';
  $('peerAvatar').className = `peer-avatar ${d.role === 'sol' ? 'moon' : 'sun'}`;
  $('peerAvatar').textContent = d.role === 'sol' ? '☾' : '☀';
  $('peerName').textContent = d.peerName || 'Esperando...';
  $('peerStatus').textContent = !d.peerName ? 'Todavía no ha entrado' : d.peerOnline ? (d.peerAtExit ? 'Ya está en la salida ♡' : 'Explorando su laberinto') : 'Desconectado/a';
  $('peerDot').classList.toggle('active', d.peerOnline);
  $('exitLabel').textContent = d.atExit ? 'EN LA META ♡' : 'EN CAMINO';
  $('exitLabel').classList.toggle('reached', d.atExit);
  $('shareCode').textContent = d.id;
  $('shareHint').textContent = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'Para jugar desde lugares distintos, primero publica el servidor en Internet.'
    : 'Envía este enlace a tu pareja. La sala admite solo dos jugadores.';
  show('waitingBanner', d.status === 'waiting');
  show('disconnectedBanner', d.status === 'playing' && !d.peerOnline);
  show('crystalObjective', d.crystalRequired);
  setCheck('switchIcon', d.ownSwitchActivated);
  setCheck('doorIcon', d.gateOpen);
  setCheck('crystalIcon', d.crystalCollected);
  setCheck('exitIcon', d.atExit);
  drawBoard(d);
  drawMessages(d);
  document.querySelectorAll('[data-direction]').forEach(btn => btn.disabled = d.status !== 'playing' || !d.peerOnline);
  show('victory', d.status === 'finished');
}

function toast(text) {
  const node = $('toast');
  node.textContent = text;
  clearTimeout(state.toasting);
  state.toasting = setTimeout(() => { node.textContent = ''; }, 2700);
}

async function doAction(action) {
  if (!state.session) return;
  try {
    const response = await request(`/api/rooms/${state.session.id}/action`, { token: state.session.token, ...action });
    if (!response.ok && response.reason && action.type !== 'move') toast(response.reason);
    else if (!response.ok && response.reason && response.reason !== 'Por ahí no hay camino.') toast(response.reason);
    return response.ok;
  } catch (error) { toast(error.message); return false; }
}

function move(direction) {
  if (!state.data || state.data.status !== 'playing' || !state.data.peerOnline) return;
  const now = performance.now();
  if (now - state.lastMoveAt < 65) return;
  state.lastMoveAt = now;
  void doAction({ type: 'move', direction });
}

$('createButton').addEventListener('click', createRoom);
$('joinButton').addEventListener('click', joinRoom);
$('roomCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
$('playerName').addEventListener('keydown', e => { if (e.key === 'Enter') { if ($('roomCode').value) joinRoom(); else createRoom(); } });
$('roomCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });

document.querySelectorAll('[data-direction]').forEach(btn => btn.addEventListener('click', () => move(btn.dataset.direction)));
board.addEventListener('click', e => {
  const tile = e.target.closest('.tile');
  const d = state.data;
  if (!tile || !d) return;
  const dx = Number(tile.dataset.x) - d.position.x;
  const dy = Number(tile.dataset.y) - d.position.y;
  if (dx === 1 && dy === 0) move('right');
  if (dx === -1 && dy === 0) move('left');
  if (dx === 0 && dy === 1) move('down');
  if (dx === 0 && dy === -1) move('up');
});

window.addEventListener('keydown', e => {
  if (game.classList.contains('hidden') || $('victory').classList.contains('hidden') === false) return;
  if (e.target.closest('input, textarea, button, [contenteditable]')) return;
  const direction = {
    ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
    w:'up', W:'up', a:'left', A:'left', s:'down', S:'down', d:'right', D:'right',
  }[e.key];
  if (direction) { e.preventDefault(); move(direction); }
});

$('copyLink').addEventListener('click', async () => {
  if (!state.session) return;
  try {
    await navigator.clipboard.writeText(roomLink(state.session.id));
    const btn = $('copyLink');
    const original = btn.textContent;
    btn.textContent = '¡Copiado! ✓';
    setTimeout(() => { btn.textContent = original; }, 1800);
  } catch { toast(`Enlace: ${roomLink(state.session.id)}`); }
});

$('chatForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  const ok = await doAction({ type: 'chat', text });
  if (ok) input.value = '';
});

async function restart() {
  if (state.data?.status !== 'finished' && !window.confirm('¿Reiniciar la aventura para los dos? Se perderá el progreso de los niveles.')) return;
  await doAction({ type: 'restart' });
}
$('restartButton').addEventListener('click', restart);
$('playAgain').addEventListener('click', restart);

const requestedRoom = new URLSearchParams(location.search).get('sala')?.toUpperCase();
if (requestedRoom && /^[A-Z2-9]{6}$/.test(requestedRoom)) {
  $('roomCode').value = requestedRoom;
  $('entry-title').textContent = 'Te han invitado a jugar';
  const stored = localStorage.getItem(savedKey(requestedRoom));
  if (stored) {
    try {
      const saved = JSON.parse(stored);
      enterRoom(saved).catch(err => {
        localStorage.removeItem(savedKey(requestedRoom));
        setError(`La sesión anterior no está disponible: ${err.message}`);
      });
    } catch { localStorage.removeItem(savedKey(requestedRoom)); }
  }
}
