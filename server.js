const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let players = {};
let orbs = [];
let powerOrbs = []; 
const WORLD_SIZE = 4000;

for (let i = 0; i < 80; i++) orbs.push({ id: i, x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE });
for (let i = 0; i < 6; i++) powerOrbs.push({ id: i, x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE });

function getUniqueColor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash % 360)}, 100%, 60%)`;
}

io.on('connection', (socket) => {
    socket.on('join', (userData) => {
        players[socket.id] = {
            id: socket.id,
            name: userData.name || "Guest",
            x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE,
            trail: [], color: getUniqueColor(socket.id), score: 200
        };
        socket.emit('init', { players, orbs, powerOrbs, myId: socket.id, worldSize: WORLD_SIZE });
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    socket.on('update', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].trail = data.trail;
            // Note: We don't update score from client to prevent cheating
        }
    });

    socket.on('slicePlayer', (data) => {
        const victim = players[data.victimId];
        const attacker = players[socket.id];
        if (victim && attacker && victim.trail.length > 0) {
            // SECURITY: Only allow slice if attacker is actually stronger
            if (attacker.score <= victim.score) return;

            let sliceIndex = data.sliceIndex;
            let slicePercent = (sliceIndex + 1) / victim.trail.length;
            let stolen = Math.floor(victim.score * slicePercent);
            
            if (slicePercent > 0.6 || (victim.score - stolen) < 100) {
                // LETHAL KILL
                io.emit('explosion', { x: victim.x, y: victim.y, color: victim.color });
                io.emit('killMessage', { killer: attacker.name, victim: victim.name });
                attacker.score += victim.score;
                victim.score = 200; victim.trail = [];
                io.emit('syncScore', { playerId: victim.id, newScore: 200 });
                io.emit('syncScore', { playerId: attacker.id, newScore: attacker.score });
                io.to(victim.id).emit('forceDeath');
            } else {
                // PARTIAL SLICE
                victim.score -= stolen; attacker.score += stolen;
                io.emit('syncScore', { playerId: victim.id, newScore: victim.score });
                io.emit('syncScore', { playerId: attacker.id, newScore: attacker.score });
                io.emit('doSlice', { victimId: data.victimId, sliceIndex: data.sliceIndex, x: victim.x, y: victim.y, stolen: stolen });
            }
        }
    });

    socket.on('playerDied', () => {
        if (players[socket.id]) {
            players[socket.id].score = 200; players[socket.id].trail = [];
            io.emit('syncScore', { playerId: socket.id, newScore: 200 });
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; io.emit('removePlayer', socket.id); });
});

// Server-Side Heartbeat for Orbs
setInterval(() => {
    Object.values(players).forEach(p => {
        orbs.forEach(o => {
            if (Math.hypot(p.x - o.x, p.y - o.y) < 60) {
                o.x = Math.random() * WORLD_SIZE; o.y = Math.random() * WORLD_SIZE;
                p.score += 50;
                io.emit('updateOrbs', orbs);
                io.emit('syncScore', { playerId: p.id, newScore: p.score });
            }
        });
        powerOrbs.forEach(o => {
            if (Math.hypot(p.x - o.x, p.y - o.y) < 80) {
                o.x = Math.random() * WORLD_SIZE; o.y = Math.random() * WORLD_SIZE;
                io.emit('updatePowerOrbs', powerOrbs);
                io.to(p.id).emit('refillBoost');
            }
        });
    });
    io.emit('state', players);
}, 33);

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => console.log('SERVER ONLINE'));
