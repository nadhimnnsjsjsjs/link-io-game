const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path'); // Add this

// 1. Tell the server where your files are
app.use(express.static(path.join(__dirname, './')));

// 2. Explicitly serve index.html when someone visits the main link
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

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
            x: Math.random() * WORLD_SIZE, 
            y: Math.random() * WORLD_SIZE,
            trail: [], 
            color: getUniqueColor(socket.id), 
            score: 200 
        };
        socket.emit('init', { players, orbs, powerOrbs, myId: socket.id, worldSize: WORLD_SIZE });
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    socket.on('update', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].trail = data.trail;
            players[socket.id].score = data.score;
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    socket.on('eatOrb', (orbId) => {
        if (orbs[orbId] && players[socket.id]) {
            orbs[orbId].x = Math.random() * WORLD_SIZE;
            orbs[orbId].y = Math.random() * WORLD_SIZE;
            players[socket.id].score += 50;
            io.emit('updateOrbs', orbs);
            io.emit('syncScore', { playerId: socket.id, newScore: players[socket.id].score });
        }
    });

    socket.on('eatPowerOrb', (id) => {
        if (powerOrbs[id]) {
            powerOrbs[id].x = Math.random() * WORLD_SIZE;
            powerOrbs[id].y = Math.random() * WORLD_SIZE;
            io.emit('updatePowerOrbs', powerOrbs);
        }
    });

    socket.on('slicePlayer', (data) => {
        const victim = players[data.victimId];
        const attacker = players[socket.id];
        if (victim && attacker && victim.trail.length > 0) {
            let sliceIndex = data.sliceIndex;
            let slicePercent = (sliceIndex + 1) / victim.trail.length;
            let stolen = Math.floor(victim.score * slicePercent);
            if (slicePercent > 0.6 || (victim.score - stolen) < 100) {
                io.emit('explosion', { x: victim.x, y: victim.y, color: victim.color });
                io.emit('killMessage', { killer: attacker.name, victim: victim.name });
                attacker.score += victim.score;
                victim.score = 200;
                victim.trail = [];
                io.emit('syncScore', { playerId: victim.id, newScore: 200 });
                io.emit('syncScore', { playerId: attacker.id, newScore: attacker.score });
                io.to(victim.id).emit('forceDeath');
            } else {
                victim.score -= stolen;
                attacker.score += stolen;
                io.emit('syncScore', { playerId: victim.id, newScore: victim.score });
                io.emit('syncScore', { playerId: attacker.id, newScore: attacker.score });
                let pos = victim.trail[sliceIndex];
                io.emit('doSlice', { victimId: data.victimId, sliceIndex: sliceIndex, x: pos.x, y: pos.y, stolen: stolen });
            }
        }
    });

    socket.on('playerDied', (killerId) => {
        if (players[socket.id]) {
            let p = players[socket.id];
            io.emit('explosion', { x: p.x, y: p.y, color: p.color });
            p.score = 200; p.trail = [];
            io.emit('syncScore', { playerId: socket.id, newScore: 200 });
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('removePlayer', socket.id);
    });
});

// IMPORTANT: Render uses process.env.PORT
const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
