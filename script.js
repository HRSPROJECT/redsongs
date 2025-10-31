const game = {
    peer: null,
    isHost: false,
    roomId: null,
    connections: [],
    players: [],
    audioFile: null,
    clickTimes: {},
    gameStarted: false,
    hostName: '',
    audioLoaded: {},
    preloadedAudio: null,

    init() {
        this.loadState();
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');
        
        if (this.isHost && this.roomId) {
            this.reconnectHost();
        } else if (roomId && !this.isHost) {
            document.getElementById('roomInput').value = roomId;
            if (this.hostName) {
                document.getElementById('nameInput').value = this.hostName;
            }
        }
    },

    saveState() {
        const state = {
            isHost: this.isHost,
            roomId: this.roomId,
            hostName: this.hostName,
            players: this.players
        };
        sessionStorage.setItem('gameState', JSON.stringify(state));
    },

    loadState() {
        const saved = sessionStorage.getItem('gameState');
        if (saved) {
            const state = JSON.parse(saved);
            this.isHost = state.isHost;
            this.roomId = state.roomId;
            this.hostName = state.hostName;
            this.players = state.players || [];
        }
    },

    reconnectHost() {
        this.showScreen('hostScreen');
        document.getElementById('hostDisplayName').textContent = this.hostName;
        this.updatePlayerList();
        this.createHost();
    },

    startHost() {
        const name = document.getElementById('hostNameInput').value.trim();
        if (!name) {
            alert('Please enter your name');
            return;
        }
        this.hostName = name;
        this.saveState();
        this.showScreen('hostScreen');
        document.getElementById('hostDisplayName').textContent = name;
    },

    createHost() {
        this.isHost = true;
        this.peer = new Peer(this.roomId || undefined, {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            }
        });
        
        this.peer.on('open', (id) => {
            this.roomId = id;
            this.saveState();
            document.getElementById('roomId').textContent = id;
            
            const baseUrl = window.location.href.split('?')[0];
            const joinUrl = `${baseUrl}?room=${id}`;
            
            const qrDiv = document.getElementById('qrcode');
            qrDiv.innerHTML = '';
            
            new QRCode(qrDiv, {
                text: joinUrl,
                width: 250,
                height: 250,
                colorDark: '#667eea',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        });

        this.peer.on('connection', (conn) => {
            this.handleConnection(conn);
        });

        this.peer.on('error', (err) => {
            console.error('Peer error:', err);
        });

        if (!this.players.find(p => p.id === 'host')) {
            this.players.push({ id: 'host', name: this.hostName });
        }
        this.updatePlayerList();
    },

    showJoinScreen() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');
        if (roomId) {
            document.getElementById('roomInput').value = roomId;
        }
        this.showScreen('joinScreen');
    },

    joinRoom() {
        const roomId = document.getElementById('roomInput').value.trim();
        const playerName = document.getElementById('nameInput').value.trim();
        
        if (!roomId || !playerName) {
            alert('Please enter both Room ID and your name');
            return;
        }

        this.roomId = roomId;
        this.hostName = playerName;
        this.saveState();

        this.peer = new Peer(undefined, {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            }
        });
        
        this.peer.on('open', () => {
            const conn = this.peer.connect(roomId);
            
            conn.on('open', () => {
                conn.send({ type: 'join', name: playerName });
                this.handleConnection(conn);
                this.showScreen('gameScreen');
                document.getElementById('gameStatus').textContent = 'Connected! Waiting for host to start...';
            });

            conn.on('error', (err) => {
                alert('Failed to connect to room. Please check the Room ID.');
                console.error(err);
            });
        });
    },

    handleConnection(conn) {
        this.connections.push(conn);

        conn.on('data', (data) => {
            if (data && data.type) {
                this.handleMessage(data, conn);
            }
        });

        conn.on('close', () => {
            this.connections = this.connections.filter(c => c !== conn);
            if (this.isHost) {
                this.players = this.players.filter(p => p.id !== conn.peer);
                this.updatePlayerList();
                this.saveState();
                this.broadcast({ type: 'players', players: this.players });
            }
        });

        conn.on('error', (err) => {
            console.error('Connection error:', err);
        });
    },

    broadcast(data) {
        this.connections.forEach(conn => {
            if (conn.open) {
                try {
                    conn.send(data);
                } catch (err) {
                    console.error('Send error:', err);
                }
            }
        });
    },

    handleMessage(data, conn) {
        try {
            switch(data.type) {
                case 'join':
                    if (this.isHost) {
                        this.players.push({ id: conn.peer, name: data.name });
                        this.updatePlayerList();
                        this.saveState();
                        
                        this.broadcast({ 
                            type: 'players', 
                            players: this.players 
                        });
                    }
                    break;

                case 'players':
                    this.players = data.players;
                    this.updatePlayerList();
                    break;

                case 'preload':
                    document.getElementById('gameStatus').textContent = 'Loading audio...';
                    this.preloadAudio(data.audioData);
                    break;

                case 'audioReady':
                    if (this.isHost) {
                        this.audioLoaded[data.playerId] = true;
                        this.updateLoadingStatus();
                    }
                    break;

                case 'start':
                    document.getElementById('gameStatus').textContent = 'Get Ready...';
                    this.playAudioSync(this.preloadedAudio, data.stopTime, data.startTimestamp);
                    break;

                case 'click':
                    if (this.isHost) {
                        this.clickTimes[data.playerId] = data.time;
                        this.checkAllClicked();
                    }
                    break;

                case 'result':
                    this.showResult(data.loser, data.rankings);
                    break;

                case 'playAgain':
                    this.resetGame();
                    break;
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    },

    handleAudioUpload(event) {
        const file = event.target.files[0];
        if (file) {
            this.audioFile = file;
            document.getElementById('fileName').textContent = `✓ ${file.name}`;
            document.getElementById('qrSection').classList.remove('hidden');
            document.getElementById('startBtn').classList.remove('hidden');
            
            if (!this.peer) {
                this.createHost();
            }
        }
    },

    updatePlayerList() {
        const list = document.getElementById('playerList');
        if (list) {
            list.innerHTML = this.players.map(p => 
                `<div class="player-item">${p.name}</div>`
            ).join('');
        }
        const count = document.getElementById('playerCount');
        if (count) {
            count.textContent = this.players.length;
        }
    },

    startGame() {
        if (!this.audioFile) {
            alert('Please upload an audio file first');
            return;
        }

        document.getElementById('startBtn').disabled = true;
        document.getElementById('startBtn').textContent = 'Sending Audio...';
        this.audioLoaded = { host: false };

        const reader = new FileReader();
        reader.onload = (e) => {
            const audioData = e.target.result;
            
            this.broadcast({
                type: 'preload',
                audioData: audioData
            });

            this.preloadAudio(audioData);
        };
        reader.readAsDataURL(this.audioFile);
    },

    preloadAudio(audioData) {
        this.preloadedAudio = audioData;
        const audio = document.getElementById('gameAudio');
        audio.src = audioData;
        
        audio.onloadeddata = () => {
            const playerId = this.isHost ? 'host' : this.peer.id;
            this.audioLoaded[playerId] = true;
            
            if (this.isHost) {
                this.updateLoadingStatus();
            } else {
                this.connections[0].send({
                    type: 'audioReady',
                    playerId: this.peer.id
                });
            }
        };
    },

    updateLoadingStatus() {
        const totalPlayers = this.players.length;
        const loadedCount = Object.keys(this.audioLoaded).filter(k => this.audioLoaded[k]).length;
        
        document.getElementById('startBtn').textContent = `Loading... ${loadedCount}/${totalPlayers}`;
        
        if (loadedCount === totalPlayers) {
            document.getElementById('startBtn').textContent = '🎮 Start Game';
            document.getElementById('startBtn').disabled = false;
            document.getElementById('startBtn').onclick = () => this.launchGame();
        }
    },

    launchGame() {
        this.showScreen('gameScreen');
        document.getElementById('gameStatus').textContent = 'Get Ready...';

        const tempAudio = new Audio(this.preloadedAudio);
        tempAudio.addEventListener('loadedmetadata', () => {
            const duration = tempAudio.duration;
            const minStop = 3;
            const maxStop = Math.min(duration - 2, 30);
            const stopTime = Math.random() * (maxStop - minStop) + minStop;
            const startTimestamp = Date.now() + 1500;

            this.broadcast({
                type: 'start',
                stopTime: stopTime,
                startTimestamp: startTimestamp
            });

            this.playAudioSync(this.preloadedAudio, stopTime, startTimestamp);
        });
    },

    playAudioSync(audioData, stopTime, startTimestamp) {
        const audio = document.getElementById('gameAudio');
        audio.currentTime = 0;
        
        const now = Date.now();
        const delay = startTimestamp - now;
        
        setTimeout(() => {
            document.getElementById('gameStatus').textContent = '🎵 Music Playing...';
            audio.play().catch(err => console.log('Play error:', err));
        }, Math.max(0, delay));

        setTimeout(() => {
            audio.pause();
            audio.currentTime = 0;
            this.showClickButton();
        }, Math.max(0, delay) + (stopTime * 1000));
    },

    showClickButton() {
        document.getElementById('gameStatus').textContent = 'CLICK NOW!';
        document.getElementById('clickBtn').classList.remove('hidden');
        this.gameStarted = true;
    },

    playerClick() {
        if (!this.gameStarted) return;
        
        const clickTime = Date.now();
        document.getElementById('clickBtn').classList.add('hidden');
        document.getElementById('gameStatus').textContent = 'Clicked! Waiting for others...';

        if (this.isHost) {
            this.clickTimes['host'] = clickTime;
            this.checkAllClicked();
        } else {
            this.connections[0].send({
                type: 'click',
                playerId: this.peer.id,
                time: clickTime
            });
        }
    },

    checkAllClicked() {
        const clickedCount = Object.keys(this.clickTimes).length;
        
        if (clickedCount === this.players.length) {
            const rankings = this.players.map(p => ({
                id: p.id,
                name: p.name,
                time: this.clickTimes[p.id] || Infinity
            })).sort((a, b) => a.time - b.time);

            const loser = rankings[rankings.length - 1];

            this.broadcast({
                type: 'result',
                loser: loser,
                rankings: rankings
            });

            this.showResult(loser, rankings);
        }
    },

    showResult(loser, rankings) {
        const isLoser = (this.isHost && loser.id === 'host') || 
                       (!this.isHost && loser.id === this.peer.id);

        document.getElementById('gameStatus').textContent = 
            isLoser ? '😢 You Lost!' : '🎉 You Survived!';
        
        let resultHtml = `<h3 style="color: #f5576c;">Loser: ${loser.name}</h3>`;
        resultHtml += '<div style="margin: 20px 0; text-align: left;">';
        rankings.forEach((r, i) => {
            resultHtml += `<div style="padding: 10px; margin: 5px 0; background: ${i === rankings.length - 1 ? '#ffe0e0' : '#e0ffe0'}; border-radius: 8px;">
                ${i + 1}. ${r.name}
            </div>`;
        });
        resultHtml += '</div>';

        document.getElementById('resultText').innerHTML = resultHtml;
        document.getElementById('resultSection').classList.remove('hidden');
    },

    playAgain() {
        if (this.isHost) {
            this.broadcast({ type: 'playAgain' });
        }
        this.resetGame();
    },

    resetGame() {
        this.clickTimes = {};
        this.gameStarted = false;
        this.audioLoaded = {};
        this.preloadedAudio = null;
        
        const audio = document.getElementById('gameAudio');
        audio.pause();
        audio.currentTime = 0;
        audio.src = '';
        
        if (this.isHost) {
            this.showScreen('hostScreen');
            const startBtn = document.getElementById('startBtn');
            startBtn.textContent = '🎮 Start Game';
            startBtn.disabled = false;
            startBtn.onclick = () => this.startGame();
        } else {
            this.showScreen('gameScreen');
            document.getElementById('gameStatus').textContent = 'Waiting for host to start...';
        }
        
        document.getElementById('clickBtn').classList.add('hidden');
        document.getElementById('resultSection').classList.add('hidden');
    },

    backToSetup() {
        this.showScreen('setupScreen');
    },

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.getElementById(screenId).classList.remove('hidden');
    }
};

window.onload = () => {
    game.init();
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('room') && !game.isHost) {
        game.showJoinScreen();
    }
};
