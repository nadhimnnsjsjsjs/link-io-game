const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const path = require('path');

// Serve all files in the current folder
app.use(express.static(__dirname));

// Route for the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let players = {};
let orbs = [];
let powerOrbs = [];
const WORLD_SIZE = 4000;

// Setup World
for (let i = 0; i < 70; i++) orbs.push({ id: i, x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE });
for (let i = 0; i < 5; i++) powerOrbs.push({ id: i, x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE });

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
            Object.assign(players[socket.id], data);
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

    socket.on('slicePlayer', (data) => {
        const victim = players[data.victimId];
        const attacker = players[socket.id];
        if (victim && attacker && victim.trail.length > 0) {
            let slicePercent = (data.sliceIndex + 1) / victim.trail.length;
            let stolen = Math.floor(victim.score * slicePercent);
            if (slicePercent > 0.6 || (victim.score - stolen) < 100) {
                io.emit('explosion', { x: victim.x, y: victim.y, color: victim.color });
                attacker.score += victim.score;
                victim.score = 200; victim.trail = [];
                io.emit('syncScore', { playerId: victim.id, newScore: 200 });
                io.emit('syncScore', { playerId: attacker.id, newScore: attacker.score });
                io.to(victim.id).emit('forceDeath');
            } else {
                victim.score -= stolen; attacker.score += stolen;
                io.emit('syncScore', { playerId: victim.id, newScore: victim.score });
                io.emit('syncScore', { playerId: attacker.id, newScore: attacker.score });
                io.emit('doSlice', { victimId: data.victimId, sliceIndex: data.sliceIndex, x: victim.x, y: victim.y, stolen: stolen });
            }
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('removePlayer', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => {
    console.log('Server is live on port ' + PORT);
});
