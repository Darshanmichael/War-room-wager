const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 10000;

app.use(express.static(__dirname));
app.get('/', (req, res) => { 
    res.sendFile(path.join(__dirname, 'index.html')); 
});

const rooms = {};

const quizQuestions = [
    { id: 1, topic: "Derivatives & Risk", question: "Second-order Greek tracking how option delta shifts for every one-rupee/dollar move. Highest at-the-money close to expiry. What am I?", answer: "Gamma" },
    { id: 2, topic: "Financial Crises & Policy", question: "Fed-brokered fire sale in March, Lehman collapse in September, \$700B asset purchase program in October. Name it.", answer: "TARP" },
    { id: 3, topic: "Valuation", question: "P/E Multiple, EV/EBITDA, P/B Ratio, Dividend Discount Model. Which one stands apart as an Intrinsic valuation method?", answer: "Dividend Discount Model" },
    { id: 4, topic: "Monetary Policy", question: "Interest rate at which central bank lends short-term funds to commercial banks against government securities collateral. Name it.", answer: "Repo Rate" },
    { id: 5, topic: "Corporate Finance — WACC", question: "60% equity (12% cost), 40% debt (10% pre-tax cost), corporate tax rate 30%. Calculate the WACC percentage.", answer: "10%" },
    { id: 6, topic: "Asset Pricing Models", question: "CAPM relies on systematic risk factor. Fama-French extended this model to add which two primary market anomalies/factors?", answer: "Size and Value" },
    { id: 7, topic: "Corporate Finance", question: "What four-letter acronym central to discounted cash flow (DCF) valuations is illustrated by a scale, cash, and bank?", answer: "WACC" },
    { id: 8, topic: "Behavioral Economics", question: "Psychologist who won the 2002 Nobel Prize in Economics, summarizing System 1 and System 2 fast/slow thinking modes. Who is he?", answer: "Daniel Kahneman" },
    { id: 9, topic: "Mergers & Acquisitions", question: "Defensive board tactic diluting hostile acquirer stakes when crossing thresholds by letting others buy discounted stock. Name it.", answer: "Poison Pill" },
    { id: 10, topic: "Technical Analysis", question: "Chart continuation pattern with a sharp vertical move upward followed by a tight converging triangle consolidation. Name it.", answer: "Pennant" }
];

io.on('connection', (socket) => {
    socket.on('createRoom', () => {
        const roomCode = Math.floor(100000 + Math.random() * 900000).toString();
        rooms[roomCode] = { hostId: socket.id, currentQuestionIdx: 0, teams: {}, timerInterval: null };
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, questions: quizQuestions });
    });

    socket.on('joinRoom', ({ roomCode, teamName }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('joinError', 'Invalid Code!');
        if (room.teams[teamName]) return socket.emit('joinError', 'Taken name.');
        room.teams[teamName] = { socketId: socket.id, score: 0, wagersUsed: [], currentWager: null, currentAnswer: "", submittedAns: false };
        socket.join(roomCode);
        socket.emit('joinSuccess', { roomCode, teamName });
        io.to(room.hostId).emit('updateTeamsList', Object.keys(room.teams).map(n => ({ name: n, score: room.teams[n].score })));
    });

    socket.on('nextRound', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        clearInterval(room.timerInterval);
        if (room.currentQuestionIdx >= quizQuestions.length) return io.to(roomCode).emit('gameOver', room.teams);
        Object.keys(room.teams).forEach(n => { room.teams[n].currentWager = null; room.teams[n].currentAnswer = ""; room.teams[n].submittedAns = false; });
        io.to(roomCode).emit('roundStarted', { questionNumber: room.currentQuestionIdx + 1, topic: quizQuestions[room.currentQuestionIdx].topic });
        let t = 20;
        io.to(roomCode).emit('timerUpdate', { duration: 20, remaining: t, stage: "Wagering" });
        room.timerInterval = setInterval(() => {
            t--; io.to(roomCode).emit('timerUpdate', { duration: 20, remaining: t, stage: "Wagering" });
            if (t <= 0) { clearInterval(room.timerInterval); io.to(room.hostId).emit('wagerTimerExpired'); }
        }, 1000);
    });

    socket.on('submitWager', ({ roomCode, teamName, wager }) => {
        const room = rooms[roomCode];
        if (!room || !room.teams[teamName]) return;
        room.teams[teamName].currentWager = wager;
        room.teams[teamName].wagersUsed.push(wager);
        io.to(room.hostId).emit('teamWageredUpdate', { teamName, wager });
    });

    socket.on('revealQuestion', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        clearInterval(room.timerInterval);
        Object.keys(room.teams).forEach(n => {
            if (room.teams[n].currentWager === null) {
                let f = 1; while (room.teams[n].wagersUsed.includes(f)) { f++; }
                room.teams[n].currentWager = f; room.teams[n].wagersUsed.push(f);
                io.to(room.hostId).emit('teamWageredUpdate', { teamName: n, wager: f });
                io.to(room.teams[n].socketId).emit('forcedWager', { wager: f });
            }
        });
        io.to(roomCode).emit('questionRevealed', { question: quizQuestions[room.currentQuestionIdx].question });
        let t = 60; io.to(roomCode).emit('timerUpdate', { duration: 60, remaining: t, stage: "Answering" });
        room.timerInterval = setInterval(() => {
            t--; io.to(roomCode).emit('timerUpdate', { duration: 60, remaining: t, stage: "Answering" });
            if (t <= 0) { clearInterval(room.timerInterval); io.to(roomCode).emit('answerTimerExpired'); }
        }, 1000);
    });

    socket.on('submitAnswer', ({ roomCode, teamName, answer }) => {
        const room = rooms[roomCode];
        if (!room || !room.teams[teamName] || room.teams[teamName].submittedAns) return;
        room.teams[teamName].currentAnswer = answer; room.teams[teamName].submittedAns = true;
        io.to(room.hostId).emit('teamAnswerSubmitted', { teamName, wager: room.teams[teamName].currentWager, answer });
    });

    socket.on('evaluateTeam', ({ roomCode, teamName, isCorrect }) => {
        const room = rooms[roomCode];
        if (!room || !room.teams[teamName]) return;
        if (isCorrect) room.teams[teamName].score += room.teams[teamName].currentWager;
        io.to(room.hostId).emit('updateTeamsList', Object.keys(room.teams).map(n => ({ name: n, score: room.teams[n].score })));
    });

    socket.on('advanceQuestionIndex', ({ roomCode }) => {
        const room = rooms[roomCode]; if (room) { clearInterval(room.timerInterval); room.currentQuestionIdx++; }
    });
});

server.listen(PORT, '0.0.0.0', () => { console.log(`Active on ${PORT}`); });
