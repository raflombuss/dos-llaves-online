import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createGameServer } from '../server.mjs';
import { LEVELS, ROLES, locate } from '../levels.mjs';

function shortestPath(map, start, target, unlocked) {
  if (start.x === target.x && start.y === target.y) return [];
  const moves = [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
  const queue = [{x:start.x,y:start.y,path:[]}];
  const visited = new Set([`${start.x},${start.y}`]);
  for (const p of queue) {
    for (const [direction,dx,dy] of moves) {
      const x=p.x+dx,y=p.y+dy,symbol=map[y]?.[x];
      if (!symbol || symbol==='#' || (symbol==='D' && !unlocked) || visited.has(`${x},${y}`)) continue;
      const path=[...p.path,direction];
      if (x === target.x && y === target.y) return path;
      visited.add(`${x},${y}`);
      queue.push({x,y,path});
    }
  }
  return null;
}

for (const [index, level] of LEVELS.entries()) {
  test(`Nivel ${index + 1}: los dos mapas se pueden resolver y requieren abrir una puerta`, () => {
    for (const role of ROLES) {
      const map = level.maps[role];
      assert.ok(map.every(line => line.length === map[0].length), `Mapa rectangular: ${role}`);
      for (const symbol of ['S','P','D','E']) assert.equal(map.join('').split(symbol).length-1,1,`${symbol} único`);
      const start = locate(map, 'S');
      const plate = locate(map, 'P');
      const exit = locate(map, 'E');
      assert.ok(shortestPath(map,start,plate,false), `Placa accesible: ${role}`);
      assert.equal(shortestPath(map,start,exit,false),null,`La puerta es necesaria: ${role}`);
      assert.ok(shortestPath(map,start,exit,true), `La salida se puede alcanzar: ${role}`);
      if (locate(map,'C')) assert.ok(shortestPath(map,plate,locate(map,'C'),false), `Cristal accesible: ${role}`);
    }
  });
}

test('Dos clientes se conectan, cooperan, envían chat y completan la aventura', async (t) => {
  const server = createGameServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const controllers = [];
  const streams = [];
  t.after(async () => {
    for(const controller of controllers) controller.abort();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  async function post(url, obj) {
    const res=await fetch(`${base}${url}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)});
    return { status:res.status, data:await res.json() };
  }
  async function get(url) {
    const res=await fetch(`${base}${url}`);
    return {status:res.status,data:await res.json()};
  }
  const create=await post('/api/rooms',{name:'Alex'});
  assert.equal(create.status,201);
  assert.equal(create.data.role,'sol');
  const id=create.data.id;
  const a=create.data;
  const initial=await get(`/api/rooms/${id}/state?token=${a.token}`);
  assert.equal(initial.data.status,'waiting');
  assert.equal((await post(`/api/rooms/${id}/action`,{token:a.token,type:'move',direction:'right'})).data.ok,false);

  const join=await post(`/api/rooms/${id}/join`,{name:'Sam'});
  assert.equal(join.status,201);
  const b=join.data;
  assert.equal(b.role,'luna');
  assert.equal((await post(`/api/rooms/${id}/join`,{name:'Tercero'})).status,409);
  assert.equal((await get(`/api/rooms/${id}/state?token=incorrecto`)).status,401);

  for (const player of [a,b]) {
    const controller=new AbortController();
    controllers.push(controller);
    const response=await fetch(`${base}/api/rooms/${id}/events?token=${player.token}`,{signal:controller.signal});
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/text\/event-stream/);
    const reader = response.body.getReader();
    const firstChunk = await reader.read();
    assert.equal(firstChunk.done, false);
    streams.push({ response, reader });
  }

  async function snapshot(player) { return (await get(`/api/rooms/${id}/state?token=${player.token}`)).data; }
  async function goto(player, symbol) {
    let s=await snapshot(player);
    const target=locate(s.map,symbol);
    assert.ok(target, `Existe ${symbol}`);
    const path=shortestPath(s.map,s.position,target,s.gateOpen);
    assert.ok(path, `Hay camino hasta ${symbol} para ${player.role}`);
    for (const direction of path) {
      const response=await post(`/api/rooms/${id}/action`,{token:player.token,type:'move',direction});
      assert.equal(response.data.ok,true,`Movimiento válido ${direction}: ${response.data.reason}`);
    }
  }
  const locked=await snapshot(a);
  assert.equal(locked.gateOpen,false);
  await goto(a,'P');
  assert.equal((await snapshot(b)).gateOpen,true,'El interruptor de Sol abre la puerta de Luna');
  await goto(b,'P');
  assert.equal((await snapshot(a)).gateOpen,true,'El interruptor de Luna abre la puerta de Sol');
  assert.equal((await post(`/api/rooms/${id}/action`,{token:a.token,type:'chat',text:'¡Voy a la salida!'})).data.ok,true);
  assert.ok((await snapshot(b)).messages.some(m=>m.text==='¡Voy a la salida!'));
  await goto(a,'E');
  assert.equal((await snapshot(a)).atExit,true);
  assert.equal((await snapshot(a)).status,'playing');
  await goto(b,'E');
  assert.equal((await snapshot(a)).status,'transition');

  for (let level=2;level<=3;level++) {
    // Transition to next stage is intentionally short so players see the achievement.
    let s;
    for (let tries=0;tries<50;tries++) {
      s=await snapshot(a);
      if (s.level===level && s.status==='playing') break;
      await new Promise(resolve=>setTimeout(resolve,40));
    }
    assert.equal(s.level,level);
    assert.equal(s.status,'playing');
    await goto(a,'P');
    await goto(b,'P');
    await goto(a,'C');
    await goto(b,'C');
    assert.equal((await snapshot(a)).crystalCollected,true);
    await goto(a,'E');
    await goto(b,'E');
  }
  const completed=await snapshot(a);
  assert.equal(completed.status,'finished');
  assert.ok(completed.finishedAt);
  const restarted=await post(`/api/rooms/${id}/action`,{token:b.token,type:'restart'});
  assert.equal(restarted.data.ok,true);
  assert.equal((await snapshot(a)).level,1);
  assert.equal((await snapshot(b)).status,'playing');
});
