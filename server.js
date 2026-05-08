const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { 
    cors: { origin: "*" },
    transports: ['websocket'] 
});
const path = require('path');

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let players = {};
let orbs = [];
let powerOrbs = []; 
const WORLD_SIZE = 4000;

// Initialize World Orbs
for (let i = 0; i < 85; i++) orbs.push({ id: i, x: Math.random() * WORLD_SIZE, y: Math.random() * WORLD_SIZE });
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
            // Note: Score is managed by server to prevent tail growth bugs
        }
    });

    // --- PRECISION SLICING & LETHAL KILL LOGIC ---
    socket.on('slicePlayer', (data) => {
        const victim = players[data.victimId];
        const attacker = players[socket.id];
        
        if (victim && attacker && victim.trail.length > 5) {
            // Must be stronger to slice
            if (attacker.score <= victim.score) return;

            let sliceIndex = data.sliceIndex;
            let totalSegs = victim.trail.length;
            let slicePercent = (sliceIndex + 1) / totalSegs;
            
            // Calculate proportional stolen score
            let stolen = Math.floor(victim.score * slicePercent);
            
            // LETHAL THRESHOLD: Cut > 60% or Victim becomes too small
            if (slicePercent > 0.6 || (victim.score - stolen) < 150) {
                io.emit('explosion', { x: victim.x, y: victim.y, color: victim.color });
                io.emit('killMessage', { killer: attacker.name, victim: victim.name });
                
                attacker.score += victim.score;
                victim.score = 200;
                victim.trail = []; // Clear server-side trail
                
                io.emit('syncScore', { playerId: victim.id, newScore: 200 });
                io.emit('syncScore', { playerId: attacker.id, newScore: attacker.score });
                io.to(victim.id).emit('forceDeath'); // Forces local client reset
            } else {
                // SUCCESSFUL NON-LETHAL SLICE
                victim.score -= stolen;
                attacker.score += stolen;
                
                // Update Server-side tail to match the slice
                victim.trail = victim.trail.slice(sliceIndex + 1);

                io.emit('syncScore', { playerId: victim.id, newScore: victim.score });
                io.emit('syncScore', { playerId: attacker.id, newScore: attacker.score });
                
                // Tell EVERYONE to cut the tail visually
                io.emit('doSlice', { 
                    victimId: data.victimId, 
                    sliceIndex: sliceIndex, 
                    x: data.x, 
                    y: data.y, 
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

// --- SERVER HEARTBEAT (30 FPS) ---
setInterval(() => {
    Object.values(players).forEach(p => {
        // Authoritative Orb Eating
        for (let i = 0; i < orbs.length; i++) {
            let o = orbs[i];
            if (Math.hypot(p.x - o.x, p.y - o.y) < 60) {
                o.x = Math.random() * WORLD_SIZE;
                o.y = Math.random() * WORLD_SIZE;
                p.score += 50;
                io.emit('updateOrbs', orbs);
                io.emit('syncScore', { playerId: p.id, newScore: p.score });
                io.to(p.id).emit('triggerSound', 'eat');
            }
        }
        // Power Orb Heartbeat
        for (let i = 0; i < powerOrbs.length; i++) {
            let o = powerOrbs[i];
            if (Math.hypot(p.x - o.x, p.y - o.y) < 80) {
                o.x = Math.random() * WORLD_SIZE;
                o.y = Math.random() * WORLD_SIZE;
                io.emit('updatePowerOrbs', powerOrbs);
                io.to(p.id).emit('refillBoost');
            }
        }
    });
    // Broadcast state to all clients
    io.emit('state', players);
}, 33);

const PORT = process.env.PORT || 3000;
http.listen(PORT, '0.0.0.0', () => console.log('ULTIMATE MASTER SERVER ONLINE ON PORT ' + PORT));
