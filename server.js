const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
app.use(express.static(path.join(__dirname, 'public')));
const rooms = {};
function createRoom(roomId) {
  return { id: roomId, players: {}, itPlayerId: null, lastTagTime: 0 };
}
function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) rooms[roomId] = createRoom(roomId);
  return rooms[roomId];
}
function broadcast(room, msg, excludeId) {
  const data = JSON.stringify(msg);
  for (const [pid, p] of Object.entries(room.players)) {
    if (pid !== excludeId && p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}
function broadcastAll(room, msg) { broadcast(room, msg, null); }
function sendTo(player, msg) {
  if (player.ws && player.ws.readyState === 1) player.ws.send(JSON.stringify(msg));
}
function getPublicPlayer(p) {
  return { id: p.id, name: p.name, animal: p.animal, x: p.x, y: p.y, isIt: p.isIt, score: p.score, color: p.color };
}
function pickItPlayer(room) {
  const ids = Object.keys(room.players);
  if (ids.length === 0) return;
  room.itPlayerId = ids[Math.floor(Math.random() * ids.length)];
  for (const [id, p] of Object.entries(room.players)) p.isIt = (id === room.itPlayerId);
  broadcastAll(room, { type: 'itAssigned', itId: room.itPlayerId });
}
wss.on('connection', function(ws) {
  var playerId = null;
  var roomId = null;
  var room = null;
  ws.on('message', function(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }
    if (msg.type === 'join') {
      roomId = msg.roomId || 'default';
      room = getOrCreateRoom(roomId);
      playerId = 'p_' + Math.random().toString(36).slice(2, 9);
      var spawnPoints = [{x:100,y:100},{x:700,y:100},{x:100,y:500},{x:700,y:500},{x:400,y:300}];
      var sp = spawnPoints[Object.keys(room.players).length % spawnPoints.length];
      var player = { id: playerId, ws: ws, name: msg.name || 'Player', animal: msg.animal || 'cat', color: msg.color || '#ff6b6b', x: sp.x, y: sp.y, isIt: false, score: 0 };
      room.players[playerId] = player;
      sendTo(player, { type: 'welcome', playerId: playerId, roomId: roomId, players: Object.values(room.players).map(getPublicPlayer), itId: room.itPlayerId });
      broadcast(room, { type: 'playerJoined', player: getPublicPlayer(player) }, playerId);
      if (!room.itPlayerId || !room.players[room.itPlayerId]) pickItPlayer(room);
      return;
    }
    if (!room || !playerId || !room.players[playerId]) return;
    var me = room.players[playerId];
    if (msg.type === 'move') {
      me.x = Math.max(20, Math.min(780, msg.x));
      me.y = Math.max(20, Math.min(580, msg.y));
      broadcast(room, { type: 'playerMoved', id: playerId, x: me.x, y: me.y }, playerId);
    }
    if (msg.type === 'tag') {
      if (!me.isIt) return;
      var now = Date.now();
      if (now - room.lastTagTime < 1500) return;
      var target = room.players[msg.targetId];
      if (!target) return;
      var dx = me.x - target.x;
      var dy = me.y - target.y;
      if (Math.sqrt(dx * dx + dy * dy) > 60) return;
      room.lastTagTime = now;
      me.isIt = false;
      target.isIt = true;
      room.itPlayerId = target.id;
      me.score += 1;
      broadcastAll(room, { type: 'tagged', taggerId: playerId, taggedId: target.id, taggerScore: me.score });
    }
  });
  ws.on('close', function() {
    if (!room || !playerId) return;
    delete room.players[playerId];
    broadcastAll(room, { type: 'playerLeft', id: playerId });
    if (room.itPlayerId === playerId && Object.keys(room.players).length > 0) pickItPlayer(room);
    if (Object.keys(room.players).length === 0) delete rooms[roomId];
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, function() { console.log('Tag game running on port ' + PORT); });
