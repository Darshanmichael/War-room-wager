const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const rooms = {};

// EXACT 10 QUESTION BANK
const quizQuestions = [
    { id: 1, topic: "Derivatives & Risk", question: "I am a second-order Greek, which means I don't measure price sensitivity directly — I measure how another sensitivity measure itself changes. Specifically, I track how much an option's delta shifts for every one-rupee or one-dollar move in the price of the underlying asset. I am at my highest when an option is at-the-money and close to expiry... What am I?", answer: "Gamma" },
    { id: 2, topic: "Financial Crises & Policy", question: "In March of a certain year, a storied 85-year-old investment bank avoids collapse only through a Federal Reserve–brokered fire sale to a larger rival... Six months later, in September, a nearly as old investment bank is denied a similar rescue and is allowed to file for the largest bankruptcy in US history... Weeks later, Congress authorizes a \$700 billion program explicitly designed to purchase distressed mortgage-backed assets. Name this October program.", answer: "TARP (Troubled Asset Relief Program)" },
    { id: 3, topic: "Valuation", question: "A student lists four tools he plans to use to value a company before its IPO: P/E Multiple, EV/EBITDA, P/B Ratio, and Dividend Discount Model. Three of these four tools belong to the same broad valuation family; one stands apart because it derives value independently rather than by comparison. Identify the odd one out, and name the approach the other three share.", answer: "Dividend Discount Model is the odd one out (Intrinsic Valuation). The other three are Relative Valuation Multiples." },
    { id: 4, topic: "Monetary Policy", question: "This is the interest rate at which a country's central bank lends short-term funds to commercial banks, against the collateral of government securities, with an agreement that the banks will repurchase those securities at a later date. When a central bank wants to control inflation by making borrowing more expensive, this is typically the first lever it pulls. Which rate is being described?", answer: "Repo Rate" },
    { id: 5, topic: "Corporate Finance — WACC", question: "A firm is capitalized with 60% equity and 40% debt, based on market values. Its cost of equity is 12%. Its pre-tax cost of debt is 10%. The firm operates in a jurisdiction where the corporate tax rate is 30%, and interest payments are tax-deductible. What single weighted metric (WACC) do these combine to produce?", answer: "10% [Calculation: (0.6 * 12%) + (0.4 * 10% * (1 - 0.3)) = 7.2% + 2.8%]" },
    { id: 6, topic: "Asset Pricing Models", question: "In the single-factor world of the Capital Asset Pricing Model, an asset's expected return is explained entirely by its sensitivity to one variable: systematic risk. Decades later, two researchers observed that smaller companies and value companies consistently outperformed predictions. Exactly as CAPM is to Systematic Risk, the model these two researchers built (Fama-French) to correct it is to ___?", answer: "Size and Value factors (SMB — Small Minus Big, and HML — High Minus Low)" },
    { id: 7, topic: "Corporate Finance", question: "A finance student represents a single formula using three symbols: A weighing scale (representing proportion), a stack of currency notes (representing cost), and a bank building (representing capital). ⚖️ + 💵 + 🏦 = ? What four-letter acronym central to DCF valuations is she illustrating?", answer: "WACC (Weighted Average Cost of Capital)" },
    { id: 8, topic: "Behavioral Economics", question: "He was trained as a psychologist, not an economist, yet in 2002 he won the Nobel Memorial Prize in Economic Sciences. His 2011 book summaries research for a general audience and contrasts two modes of human thinking — one fast and intuitive, the other slow and deliberate. Who is he?", answer: "Daniel Kahneman" },
    { id: 9, topic: "Mergers & Acquisitions", question: "This is a defensive tactic a target company's board can adopt under which existing shareholders become entitled to purchase additional shares at a steep discount the moment a hostile acquirer's stake crosses a threshold, diluting their stake. It is colloquially named after a lethal substance. What is it?", answer: "Poison Pill (Shareholder Rights Plan)" },
    { id: 10, topic: "Technical Analysis", question: "A chart pattern displays a sharp, near-vertical price move upward, followed by a small, tightly-converging symmetrical triangle of consolidation, followed by another sharp breakout continuing in the same original direction. Name this classic continuation pattern.", answer: "Pennant (or Flag) Pattern" }
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
        if (!room) return socket.emit('joinError', 'Invalid Room Code!');
        if (room.teams[teamName]) return socket.emit('joinError', 'Team name taken.');

        room.teams[teamName] = { socketId: socket.id, score: 0, wagersUsed: [], currentWager: null, currentAnswer: "", submittedAns: false };
        socket.join(roomCode);
        socket.emit('joinSuccess', { roomCode, teamName });
        io.to(room.hostId).emit('updateTeamsList', Object.keys(room.teams).map(name => ({ name, score: room.teams[name].score })));
    });

    socket.on('nextRound', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        clearInterval(room.timerInterval);
        if (room.currentQuestionIdx >= quizQuestions.length) return io.to(roomCode).emit('gameOver', room.teams);

        Object.keys(room.teams).forEach(name => {
            room.teams[name].currentWager = null;
            room.teams[name].currentAnswer = "";
            room.teams[name].submittedAns = false;
        });

        io.to(roomCode).emit('roundStarted', {
            questionNumber: room.currentQuestionIdx + 1,
            topic: quizQuestions[room.currentQuestionIdx].topic
        });

        // 20 Second Wager Timer Initiation
        let timeLeft = 20;
        io.to(roomCode).emit('timerUpdate', { duration: 20, remaining: timeLeft, stage: "Wagering" });
        
        room.timerInterval = setInterval(() => {
            timeLeft--;
            io.to(roomCode).emit('timerUpdate', { duration: 20, remaining: timeLeft, stage: "Wagering" });
            if (timeLeft <= 0) {
                clearInterval(room.timerInterval);
                io.to(room.hostId).emit('wagerTimerExpired');
            }
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

        // Force fallback wagers for any slacking teams
        Object.keys(room.teams).forEach(name => {
            if (room.teams[name].currentWager === null) {
                let fallback = 1;
                while (room.teams[name].wagersUsed.includes(fallback) && fallback <= 10) { fallback++; }
                room.teams[name].currentWager = fallback;
                room.teams[name].wagersUsed.push(fallback);
                io.to(room.hostId).emit('teamWageredUpdate', { teamName, wager: fallback });
                io.to(room.teams[name].socketId).emit('forcedWager', { wager: fallback });
            }
        });

        io.to(roomCode).emit('questionRevealed', { question: quizQuestions[room.currentQuestionIdx].question });

        // 60 Second Answering Timer Initiation
        let timeLeft = 60;
        io.to(roomCode).emit('timerUpdate', { duration: 60, remaining: timeLeft, stage: "Answering" });

        room.timerInterval = setInterval(() => {
            timeLeft--;
            io.to(roomCode).emit('timerUpdate', { duration: 60, remaining: timeLeft, stage: "Answering" });
            if (timeLeft <= 0) {
                clearInterval(room.timerInterval);
                io.to(roomCode).emit('answerTimerExpired');
            }
        }, 1000);
    });

    socket.on('submitAnswer', ({ roomCode, teamName, answer }) => {
        const room = rooms[roomCode];
        if (!room || !room.teams[teamName] || room.teams[teamName].submittedAns) return;
        
        room.teams[teamName].currentAnswer = answer;
        room.teams[teamName].submittedAns = true;
        io.to(room.hostId).emit('teamAnswerSubmitted', { teamName, wager: room.teams[teamName].currentWager, answer });
    });

    socket.on('evaluateTeam', ({ roomCode, teamName, isCorrect }) => {
        const room = rooms[roomCode];
        if (!room || !room.teams[teamName]) return;
        if (isCorrect) room.teams[teamName].score += room.teams[teamName].currentWager;
        io.to(room.hostId).emit('updateTeamsList', Object.keys(room.teams).map(name => ({ name, score: room.teams[name].score })));
    });

    socket.on('advanceQuestionIndex', ({ roomCode }) => {
