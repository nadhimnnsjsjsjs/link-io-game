const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { 
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});
const path = require('path');

// --- SERVER CONFIGURATION ---
const WORLD_SIZE = 4000;
const ORB_COUNT = 80;
const POWER_ORB_COUNT = 6;

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let players = {};
let orbs = [];
let powerOrbs = [];

// Initialize World Items
for (let i = 0; i < ORB_COUNT; i++) {
    orbs.push({ id: i, x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE });
}
for (let i = 0; i < POWER_ORB_COUNT; i++) {
    powerOrbs.push({ id: i, x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE });
}

// Unique Color Hashing
function getUniqueColor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash % 360)}, 100%, 60%)`;
}

io.on('connection', (socket) => {
    console.log('User Connected:', socket.id);

    socket.on('join', (userData) => {
        players[socket.id] = {
            id: socket.id,
            name: userData.name || "Guest",
            x: Math.random() * WORLD_SIZE,
            y: Math.random() * WORLD_SIZE,
            trail: [],
            color: getUniqueColor(socket.id),
            score: 200,
            lastUpdate: Date.now()
        };
        socket.emit('init', { players, orbs, powerOrbs, myId: socket.id, worldSize: WORLD_SIZE });
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    socket.on('update', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].trail = data.trail;
            players[socket.id].lastUpdate = Date.now();
        }
    });

    socket.on('slicePlayer', (data) => {
        const victim = players[data.victimId];
        const attacker = players[socket.id];
        
        if (victim && attacker && victim.trail.length > 0) {
            let sliceIndex = data.sliceIndex;
            let totalSegs = victim.trail.length;
            let slicePercent = (sliceIndex + 1) / totalSegs;
            let stolen = Math.floor(victim.score * slicePercent);
            
            // LETHAL CUT: If slice is > 60% of their body or they are too small
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
                // PARTIAL SLICE
                victim.score -= stolen;
                attacker.score += stolen;
                io.emit('syncScore', { playerId: victim.id, newScore: victim.score });
                io.emit('syncScore', { playerId: attacker.id, newScore: attacker.score });
                
                let pos = victim.trail[sliceIndex];
                io.emit('doSlice', { 
                    victimId: data.victimId, 
                    sliceIndex: sliceIndex, 
                    x: pos ? pos.x : victim.x, 
                    y: pos ? pos.y : victim.y, 
                    stolen: stolen 
                });
            }
        }
    });

    socket.on('playerDied', () => {
        if (players[socket.id]) {
            players[socket.id].score = 200;
            players[socket.id].trail = [];
            io.emit('syncScore', { playerId: socket.id, newScore: 200 });
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('removePlayer', socket.id);
    });
});

// --- SERVER-SIDE COLLISION HEARTBEAT ---
// Runs 30 times a second to ensure orbs are always eaten properly
setInterval(() => {
    Object.values(players).forEach(p => {
        // Check Regular Orbs
        for (let i = 0; i < orbs.length; i++) {
            let o = orbs[i];
            let dx = p.x - o.x;
            let dy = p.y - o.y;
            if (Math.sqrt(dx*dx + dy*dy) < 65) { // Generous radius for lag
                o.x = Math.random() * WORLD_SIZE;
                o.y = Math.random() * WORLD_SIZE;
                p.score += 50;
                io.emit('updateOrbs', orbs);
                io.emit('syncScore', { playerId: p.id, newScore: p.score });
            }
        }
        // Check Power Orbs
        for (let i = 0; i < powerOrbs.length; i++) {
            let o = powerOrbs[i];
            let dx = p.x - o.x;
            let dy = p.y - o.y;
            if (Math.sqrt(dx*dx + dy*dy) < 80) {
                o.x = Math.random() * WORLD_SIZE;
                o.y = Math.random() * WORLD_SIZE;
                io.emit('updatePowerOrbs', powerOrbs);
                io.to(p.id).emit('refillBoost');
            }
        }
    });
    // Broadcast state to everyone
    io.emit('state', players);
}, 33);

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => console.log('MASTER SERVER STARTED ON PORT ' + PORT));
