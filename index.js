// server_ultimate_v12.js - Dice Algorithms Master Edition
// Giữ nguyên các thuật toán cầu + THÊM thuật toán dice cao cấp

const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;
const AUTH_KEY = "kapub";
const USER_ID = "@Kapubb";
const ALGO_NAME = "DiceMASTER";

// ================= CONFIG =================
const GAME_CONFIG = {
    "lc79_tx": {
        game_key: "LC79_TX",
        api_url: "https://wtx.tele68.com/v1/tx/sessions",
        name: "LC79 Tài Xỉu",
        type: "legacy"
    },
    "lc79_md5": {
        game_key: "LC79_MD5",
        api_url: "https://wtxmd52.tele68.com/v1/txmd5/sessions",
        name: "LC79 MD5",
        type: "legacy"
    },
    "betvip_tx": {
        game_key: "BETVIP_TX",
        api_url: "https://wtx.macminim6.online/v1/tx/sessions",
        name: "BETVIP Tài Xỉu",
        type: "legacy"
    },
    "betvip_md5": {
        game_key: "BETVIP_MD5",
        api_url: "https://wtxmd52.macminim6.online/v1/txmd5/sessions",
        name: "BETVIP MD5",
        type: "legacy"
    }
};

// ================= DICE ALGORITHMS ENGINE =================

class DiceAlgorithms {
    constructor() {
        // 1. Face analysis
        this.faceFrequency = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        this.faceByPosition = { d1: {}, d2: {}, d3: {} };
        this.faceGaps = {}; // Khoảng cách giữa các lần xuất hiện của mỗi mặt
        this.lastFacePosition = {};
        
        // 2. Transition matrices
        this.faceTransition = {}; // Mặt trước -> mặt sau
        this.positionTransition = { d1: {}, d2: {}, d3: {} };
        this.cumulativeTransition = {};
        
        // 3. Sum analysis
        this.sumFrequency = {};
        this.sumTransition = {};
        this.sumTrend = [];
        
        // 4. Pair & Triple analysis
        this.pairFrequency = {}; // Cặp (d1,d2), (d2,d3), (d1,d3)
        this.tripleFrequency = {}; // Bộ ba (d1,d2,d3)
        this.doubleFrequency = { 0: 0, 1: 0, 2: 0, 3: 0 }; // Số mặt trùng nhau
        
        // 5. Sequence analysis
        this.diceSequence = [];
        this.sequencePatterns = {};
        
        // 6. Statistical metrics
        this.meanDice = { d1: 0, d2: 0, d3: 0, total: 0 };
        this.varianceDice = { d1: 0, d2: 0, d3: 0, total: 0 };
        this.hotFaces = []; // Mặt đang "nóng"
        this.coldFaces = []; // Mặt đang "lạnh"
        
        // 7. Machine learning models
        this.naiveBayes = {}; // Xác suất mặt dựa trên các mặt trước
        this.hmmStates = []; // Hidden Markov Model states
    }

    // ========== 1. FACE DISTRIBUTION ANALYZER ==========
    updateFaceDistribution(d1, d2, d3) {
        // Tần suất từng mặt
        this.faceFrequency[d1]++;
        this.faceFrequency[d2]++;
        this.faceFrequency[d3]++;
        
        // Tần suất theo vị trí
        this.faceByPosition.d1[d1] = (this.faceByPosition.d1[d1] || 0) + 1;
        this.faceByPosition.d2[d2] = (this.faceByPosition.d2[d2] || 0) + 1;
        this.faceByPosition.d3[d3] = (this.faceByPosition.d3[d3] || 0) + 1;
        
        // Gap analysis
        const now = Date.now();
        [d1, d2, d3].forEach(face => {
            if (this.lastFacePosition[face]) {
                const gap = this.diceSequence.length - this.lastFacePosition[face];
                if (!this.faceGaps[face]) this.faceGaps[face] = [];
                this.faceGaps[face].push(gap);
                if (this.faceGaps[face].length > 50) this.faceGaps[face].shift();
            }
            this.lastFacePosition[face] = this.diceSequence.length;
        });
        
        // Hot/Cold faces (dựa trên tần suất gần đây)
        this.updateHotColdFaces();
    }
    
    updateHotColdFaces() {
        const total = this.diceSequence.length * 3 || 1;
        const expectedFreq = total / 6;
        
        const faces = [1,2,3,4,5,6];
        this.hotFaces = [];
        this.coldFaces = [];
        
        faces.forEach(face => {
            const actualFreq = this.faceFrequency[face] || 0;
            const ratio = actualFreq / expectedFreq;
            if (ratio > 1.2) this.hotFaces.push(face);
            if (ratio < 0.8) this.coldFaces.push(face);
        });
    }
    
    predictByFaceDistribution() {
        // Dựa vào mặt nào đang hot/cold
        let taiScore = 0, xiuScore = 0;
        
        this.hotFaces.forEach(face => {
            if (face >= 4) taiScore += 0.15;
            else xiuScore += 0.15;
        });
        
        this.coldFaces.forEach(face => {
            if (face >= 4) xiuScore += 0.08; // Cold face cao sẽ khó ra -> Xỉu
            else taiScore += 0.08;
        });
        
        return { taiScore, xiuScore, weight: 0.12 };
    }
    
    // ========== 2. FACE TRANSITION MATRIX ==========
    updateFaceTransition(prevD1, prevD2, prevD3, currD1, currD2, currD3) {
        // Chuyển tiếp mặt (không phân biệt vị trí)
        [prevD1, prevD2, prevD3].forEach(prev => {
            [currD1, currD2, currD3].forEach(curr => {
                const key = `${prev}->${curr}`;
                this.faceTransition[key] = (this.faceTransition[key] || 0) + 1;
            });
        });
        
        // Cumulative transition matrix 6x6
        if (!this.cumulativeTransition[prevD1]) this.cumulativeTransition[prevD1] = {};
        this.cumulativeTransition[prevD1][currD1] = (this.cumulativeTransition[prevD1][currD1] || 0) + 1;
        
        if (!this.cumulativeTransition[prevD2]) this.cumulativeTransition[prevD2] = {};
        this.cumulativeTransition[prevD2][currD2] = (this.cumulativeTransition[prevD2][currD2] || 0) + 1;
        
        if (!this.cumulativeTransition[prevD3]) this.cumulativeTransition[prevD3] = {};
        this.cumulativeTransition[prevD3][currD3] = (this.cumulativeTransition[prevD3][currD3] || 0) + 1;
        
        // Theo vị trí
        const posKey1 = `${prevD1}->${currD1}`;
        const posKey2 = `${prevD2}->${currD2}`;
        const posKey3 = `${prevD3}->${currD3}`;
        this.positionTransition.d1[posKey1] = (this.positionTransition.d1[posKey1] || 0) + 1;
        this.positionTransition.d2[posKey2] = (this.positionTransition.d2[posKey2] || 0) + 1;
        this.positionTransition.d3[posKey3] = (this.positionTransition.d3[posKey3] || 0) + 1;
    }
    
    predictByFaceTransition(lastD1, lastD2, lastD3) {
        let taiScore = 0, xiuScore = 0;
        let weight = 0;
        
        // Dự đoán từng mặt dựa trên transition
        [lastD1, lastD2, lastD3].forEach((last, idx) => {
            const transitions = this.cumulativeTransition[last];
            if (transitions) {
                let total = 0, sumHigh = 0;
                for (let face = 1; face <= 6; face++) {
                    const count = transitions[face] || 0;
                    total += count;
                    if (face >= 4) sumHigh += count;
                }
                if (total > 0) {
                    const probHigh = sumHigh / total;
                    if (probHigh > 0.55) taiScore += probHigh;
                    else if (probHigh < 0.45) xiuScore += (1 - probHigh);
                    weight += 0.05;
                }
            }
        });
        
        return { taiScore, xiuScore, weight: weight * 0.8 };
    }
    
    // ========== 3. SUM PROBABILITY & TREND ==========
    updateSumAnalysis(total) {
        this.sumFrequency[total] = (this.sumFrequency[total] || 0) + 1;
        this.sumTrend.push(total);
        if (this.sumTrend.length > 100) this.sumTrend.shift();
    }
    
    updateSumTransition(prevTotal, currTotal) {
        const key = `${prevTotal}->${currTotal}`;
        this.sumTransition[key] = (this.sumTransition[key] || 0) + 1;
    }
    
    predictBySumAnalysis(lastTotal) {
        let taiScore = 0, xiuScore = 0;
        let weight = 0;
        
        // Từ sum transition
        const transitions = {};
        for (let key in this.sumTransition) {
            if (key.startsWith(`${lastTotal}->`)) {
                const next = parseInt(key.split('->')[1]);
                transitions[next] = this.sumTransition[key];
            }
        }
        
        if (Object.keys(transitions).length > 0) {
            let total = 0, sumHigh = 0;
            for (let s in transitions) {
                total += transitions[s];
                if (parseInt(s) >= 11) sumHigh += transitions[s];
            }
            if (total > 0) {
                const probTai = sumHigh / total;
                if (probTai > 0.55) taiScore += probTai;
                else if (probTai < 0.45) xiuScore += (1 - probTai);
                weight += 0.1;
            }
        }
        
        // Trend analysis (moving average)
        if (this.sumTrend.length >= 10) {
            const ma5 = this.sumTrend.slice(-5).reduce((a,b) => a+b, 0) / 5;
            const ma10 = this.sumTrend.slice(-10).reduce((a,b) => a+b, 0) / 10;
            const momentum = ma5 - ma10;
            
            if (momentum > 1.5) taiScore += 0.08;
            if (momentum < -1.5) xiuScore += 0.08;
            weight += 0.05;
        }
        
        return { taiScore, xiuScore, weight };
    }
    
    // ========== 4. PAIR & TRIPLE ANALYSIS ==========
    updatePairTriple(d1, d2, d3) {
        // Cặp
        const pair12 = `${Math.min(d1,d2)}-${Math.max(d1,d2)}`;
        const pair23 = `${Math.min(d2,d3)}-${Math.max(d2,d3)}`;
        const pair13 = `${Math.min(d1,d3)}-${Math.max(d1,d3)}`;
        
        this.pairFrequency[pair12] = (this.pairFrequency[pair12] || 0) + 1;
        this.pairFrequency[pair23] = (this.pairFrequency[pair23] || 0) + 1;
        this.pairFrequency[pair13] = (this.pairFrequency[pair13] || 0) + 1;
        
        // Bộ ba
        const triple = `${d1}${d2}${d3}`;
        this.tripleFrequency[triple] = (this.tripleFrequency[triple] || 0) + 1;
        
        // Số mặt trùng
        const doubles = (d1 === d2 ? 1 : 0) + (d2 === d3 ? 1 : 0) + (d1 === d3 ? 1 : 0);
        this.doubleFrequency[doubles]++;
    }
    
    predictByPairTriple(lastD1, lastD2, lastD3) {
        let taiScore = 0, xiuScore = 0;
        let weight = 0;
        
        // Dựa vào cặp cuối cùng
        const lastPair12 = `${Math.min(lastD1,lastD2)}-${Math.max(lastD1,lastD2)}`;
        const lastPair23 = `${Math.min(lastD2,lastD3)}-${Math.max(lastD2,lastD3)}`;
        
        // Tìm các bộ ba có chứa cặp này
        let sumHigh = 0, sumLow = 0;
        for (let triple in this.tripleFrequency) {
            const d = triple.split('').map(Number);
            const hasPair12 = (Math.min(d[0],d[1]) === Math.min(lastD1,lastD2) && 
                               Math.max(d[0],d[1]) === Math.max(lastD1,lastD2));
            const hasPair23 = (Math.min(d[1],d[2]) === Math.min(lastD2,lastD3) && 
                               Math.max(d[1],d[2]) === Math.max(lastD2,lastD3));
            
            if (hasPair12 || hasPair23) {
                const sum = d[0] + d[1] + d[2];
                if (sum >= 11) sumHigh += this.tripleFrequency[triple];
                else sumLow += this.tripleFrequency[triple];
            }
        }
        
        const total = sumHigh + sumLow;
        if (total > 2) {
            const probTai = sumHigh / total;
            if (probTai > 0.55) taiScore += probTai;
            else if (probTai < 0.45) xiuScore += (1 - probTai);
            weight += 0.08;
        }
        
        return { taiScore, xiuScore, weight };
    }
    
    // ========== 5. SEQUENCE ANALYSIS ==========
    updateSequence(d1, d2, d3) {
        this.diceSequence.push({ d1, d2, d3 });
        if (this.diceSequence.length > 200) this.diceSequence.shift();
        
        // Phát hiện pattern trong sequence (dice pattern, không phải cầu TX)
        if (this.diceSequence.length >= 3) {
            const last3 = this.diceSequence.slice(-3);
            const patternKey = last3.map(s => `${s.d1}${s.d2}${s.d3}`).join('|');
            this.sequencePatterns[patternKey] = (this.sequencePatterns[patternKey] || 0) + 1;
        }
    }
    
    predictBySequence() {
        let taiScore = 0, xiuScore = 0;
        
        // Tìm pattern sequence gần nhất
        if (this.diceSequence.length >= 4) {
            const last2 = this.diceSequence.slice(-2);
            const last2Key = last2.map(s => `${s.d1}${s.d2}${s.d3}`).join('|');
            
            let sumHigh = 0, sumLow = 0;
            for (let pattern in this.sequencePatterns) {
                if (pattern.startsWith(last2Key)) {
                    const nextTriple = pattern.split('|')[2];
                    if (nextTriple) {
                        const sum = nextTriple.split('').map(Number).reduce((a,b) => a+b, 0);
                        if (sum >= 11) sumHigh += this.sequencePatterns[pattern];
                        else sumLow += this.sequencePatterns[pattern];
                    }
                }
            }
            
            const total = sumHigh + sumLow;
            if (total > 1) {
                const probTai = sumHigh / total;
                if (probTai > 0.6) taiScore += probTai;
                else if (probTai < 0.4) xiuScore += (1 - probTai);
                return { taiScore, xiuScore, weight: 0.07 };
            }
        }
        
        return { taiScore, xiuScore, weight: 0.03 };
    }
    
    // ========== 6. STATISTICAL METRICS ==========
    updateStatistics(d1, d2, d3, total) {
        const n = this.diceSequence.length;
        if (n === 0) {
            this.meanDice = { d1, d2, d3, total };
            return;
        }
        
        // Cập nhật mean
        this.meanDice.d1 = (this.meanDice.d1 * (n-1) + d1) / n;
        this.meanDice.d2 = (this.meanDice.d2 * (n-1) + d2) / n;
        this.meanDice.d3 = (this.meanDice.d3 * (n-1) + d3) / n;
        this.meanDice.total = (this.meanDice.total * (n-1) + total) / n;
        
        // Cập nhật variance (online algorithm)
        if (n === 1) {
            this.varianceDice = { d1: 0, d2: 0, d3: 0, total: 0 };
        } else {
            const oldMean = this.meanDice;
            this.varianceDice.d1 = ((n-2) * this.varianceDice.d1 + (d1 - oldMean.d1) * (d1 - this.meanDice.d1)) / (n-1);
            this.varianceDice.d2 = ((n-2) * this.varianceDice.d2 + (d2 - oldMean.d2) * (d2 - this.meanDice.d2)) / (n-1);
            this.varianceDice.d3 = ((n-2) * this.varianceDice.d3 + (d3 - oldMean.d3) * (d3 - this.meanDice.d3)) / (n-1);
            this.varianceDice.total = ((n-2) * this.varianceDice.total + (total - oldMean.total) * (total - this.meanDice.total)) / (n-1);
        }
    }
    
    predictByStatistics() {
        let taiScore = 0, xiuScore = 0;
        let weight = 0.06;
        
        // Mean deviation
        if (this.meanDice.total > 11) {
            taiScore += 0.05;
        } else if (this.meanDice.total < 10) {
            xiuScore += 0.05;
        }
        
        // Variance (độ phân tán)
        if (this.varianceDice.total > 12) {
            // Variance cao -> khó đoán, giảm confidence
            weight *= 0.7;
        }
        
        return { taiScore, xiuScore, weight };
    }
    
    // ========== 7. NAIVE BAYES PREDICTION ==========
    updateNaiveBayes(prevD1, prevD2, prevD3, currD1, currD2, currD3) {
        // P(current | previous)
        const key = `${prevD1},${prevD2},${prevD3}`;
        if (!this.naiveBayes[key]) {
            this.naiveBayes[key] = { counts: {}, total: 0 };
        }
        const nextKey = `${currD1},${currD2},${currD3}`;
        this.naiveBayes[key].counts[nextKey] = (this.naiveBayes[key].counts[nextKey] || 0) + 1;
        this.naiveBayes[key].total++;
    }
    
    predictByNaiveBayes(lastD1, lastD2, lastD3) {
        const key = `${lastD1},${lastD2},${lastD3}`;
        const model = this.naiveBayes[key];
        
        if (!model || model.total < 3) {
            return { taiScore: 0, xiuScore: 0, weight: 0 };
        }
        
        let taiScore = 0, xiuScore = 0;
        for (let next in model.counts) {
            const dice = next.split(',').map(Number);
            const sum = dice[0] + dice[1] + dice[2];
            const prob = model.counts[next] / model.total;
            
            if (sum >= 11) taiScore += prob;
            else xiuScore += prob;
        }
        
        return { taiScore, xiuScore, weight: 0.1 };
    }
    
    // ========== MAIN PREDICTION METHOD ==========
    getAllDicePredictions(lastD1, lastD2, lastD3, lastTotal) {
        const predictions = [];
        
        // 1. Face distribution
        predictions.push(this.predictByFaceDistribution());
        
        // 2. Face transition
        predictions.push(this.predictByFaceTransition(lastD1, lastD2, lastD3));
        
        // 3. Sum analysis
        predictions.push(this.predictBySumAnalysis(lastTotal));
        
        // 4. Pair & Triple
        predictions.push(this.predictByPairTriple(lastD1, lastD2, lastD3));
        
        // 5. Sequence pattern
        predictions.push(this.predictBySequence());
        
        // 6. Statistics
        predictions.push(this.predictByStatistics());
        
        // 7. Naive Bayes
        predictions.push(this.predictByNaiveBayes(lastD1, lastD2, lastD3));
        
        return predictions;
    }
}

// ================= MAIN SERVER =================
let gameCache = {};
let gameHistory = {};
let predictionHistory = {};
let lastProcessedSession = {};
let pendingPredictions = {};
let diceEngines = {}; // Mỗi game có dice engine riêng

// Các biến cho thuật toán cầu (giữ nguyên)
let cauMemoryBank = {
    biet: { Tai: {}, Xiu: {}, stats: { maxTai: 0, maxXiu: 0, avgTai: 0, avgXiu: 0, totalBietTai: 0, totalBietXiu: 0 } },
    c11: { patterns: {}, stats: { total: 0 } },
    c22: { patterns: {}, stats: { total: 0 } }
};

let patternMemoryBank = { patternNext: {} };
let scoreMemoryBank = { afterScore: {}, afterScoreResult: {}, movingAvg: { MA5: [], MA10: [], MA20: [] } };
let totalPredictions = 0, totalCorrect = 0;

// Khởi tạo
function initGame(gameId) {
    if (!gameHistory[gameId]) gameHistory[gameId] = [];
    if (!predictionHistory[gameId]) predictionHistory[gameId] = [];
    if (!lastProcessedSession[gameId]) lastProcessedSession[gameId] = null;
    if (!pendingPredictions[gameId]) pendingPredictions[gameId] = null;
    if (!diceEngines[gameId]) diceEngines[gameId] = new DiceAlgorithms();
}

async function fetchData(url) {
    try {
        const response = await axios.get(url, { timeout: 10000 });
        return response.data;
    } catch (error) {
        console.error(`Lỗi fetch ${url}:`, error.message);
        return null;
    }
}

async function getCachedData(gameId) {
    const config = GAME_CONFIG[gameId];
    if (!config) return null;
    if (gameCache[gameId]) return gameCache[gameId].data;
    
    const data = await fetchData(config.api_url);
    if (data) gameCache[gameId] = { data, ts: Date.now() };
    return data;
}

function parseSession(item, gameType) {
    if (gameType === "legacy") {
        const resultRaw = (item.resultTruyenThong || "").toUpperCase();
        const result = resultRaw.includes("TAI") ? "Tài" : resultRaw.includes("XIU") ? "Xỉu" : null;
        const point = item.point || 0;
        const dices = item.dices || [0, 0, 0];
        const sessionId = item.id;
        return { result, point, dices, sessionId };
    }
    return { result: null, point: 0, dices: [0,0,0], sessionId: null };
}

// Các hàm cầu (giữ nguyên từ code cũ)
function updateCauMemory(gameId, result) {
    let n = gameHistory[gameId] ? gameHistory[gameId].length : 0;
    if (n < 3) return;
    
    let results = gameHistory[gameId].map(h => h.result);
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (results[i] === result) streak++;
        else break;
    }
    if (streak >= 3) {
        if (result === 'Tài') {
            cauMemoryBank.biet.Tai[streak] = (cauMemoryBank.biet.Tai[streak] || 0) + 1;
            cauMemoryBank.biet.stats.totalBietTai++;
            if (streak > cauMemoryBank.biet.stats.maxTai) cauMemoryBank.biet.stats.maxTai = streak;
        } else {
            cauMemoryBank.biet.Xiu[streak] = (cauMemoryBank.biet.Xiu[streak] || 0) + 1;
            cauMemoryBank.biet.stats.totalBietXiu++;
            if (streak > cauMemoryBank.biet.stats.maxXiu) cauMemoryBank.biet.stats.maxXiu = streak;
        }
    }
}

function updatePatternMemory(gameId, result) {
    let n = gameHistory[gameId] ? gameHistory[gameId].length : 0;
    if (n < 3) return;
    
    let r = result === 'Tài' ? 'T' : 'X';
    let results = gameHistory[gameId].map(h => h.result === 'Tài' ? 'T' : 'X');
    
    for (let len of [3, 4, 5, 6, 7, 8]) {
        if (n > len) {
            let pattern = results.slice(-len - 1, -1).join('');
            let nextKey = pattern + '->' + r;
            patternMemoryBank.patternNext[nextKey] = (patternMemoryBank.patternNext[nextKey] || 0) + 1;
        }
    }
}

function updateScoreMemory(gameId, total, result) {
    let n = gameHistory[gameId] ? gameHistory[gameId].length : 0;
    if (n >= 2) {
        let prevScore = gameHistory[gameId][n - 2].totalScore;
        if (!scoreMemoryBank.afterScore[prevScore]) {
            scoreMemoryBank.afterScore[prevScore] = {};
            for (let i = 3; i <= 18; i++) scoreMemoryBank.afterScore[prevScore][i] = 0;
        }
        scoreMemoryBank.afterScore[prevScore][total]++;
        if (!scoreMemoryBank.afterScoreResult[prevScore]) {
            scoreMemoryBank.afterScoreResult[prevScore] = { Tai: 0, Xiu: 0 };
        }
        scoreMemoryBank.afterScoreResult[prevScore][result]++;
    }
}

function addSession(gameId, session, result, totalScore, d1, d2, d3) {
    if (!gameHistory[gameId]) gameHistory[gameId] = [];
    
    gameHistory[gameId].push({ session, result, totalScore, d1, d2, d3, timestamp: Date.now() });
    if (gameHistory[gameId].length > 500) gameHistory[gameId] = gameHistory[gameId].slice(-400);
    
    // Cập nhật dice engine
    const diceEngine = diceEngines[gameId];
    diceEngine.updateFaceDistribution(d1, d2, d3);
    diceEngine.updateSumAnalysis(totalScore);
    diceEngine.updatePairTriple(d1, d2, d3);
    diceEngine.updateSequence(d1, d2, d3);
    diceEngine.updateStatistics(d1, d2, d3, totalScore);
    
    // Cập nhật transition nếu có đủ dữ liệu
    if (gameHistory[gameId].length >= 2) {
        const prev = gameHistory[gameId][gameHistory[gameId].length - 2];
        diceEngine.updateFaceTransition(prev.d1, prev.d2, prev.d3, d1, d2, d3);
        diceEngine.updateSumTransition(prev.totalScore, totalScore);
        diceEngine.updateNaiveBayes(prev.d1, prev.d2, prev.d3, d1, d2, d3);
    }
    
    // Các thuật toán cầu cũ
    updateCauMemory(gameId, result);
    updatePatternMemory(gameId, result);
    updateScoreMemory(gameId, totalScore, result);
}

// Hàm dự đoán kết hợp CẦU + DICE
function predictSuper(gameId) {
    let n = gameHistory[gameId] ? gameHistory[gameId].length : 0;
    
    if (n < 10) {
        return { prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu', confidence: 50, reason: 'Đang thu thập dữ liệu...' };
    }
    
    const diceEngine = diceEngines[gameId];
    const last = gameHistory[gameId][n - 1];
    const lastResult = last.result;
    const lastTotal = last.totalScore;
    const lastD1 = last.d1, lastD2 = last.d2, lastD3 = last.d3;
    
    let predictions = [];
    let taiScore = 0, xiuScore = 0, totalWeight = 0;
    
    // ========== PHẦN 1: THUẬT TOÁN DICE (MỚI) ==========
    const dicePredictions = diceEngine.getAllDicePredictions(lastD1, lastD2, lastD3, lastTotal);
    
    for (const pred of dicePredictions) {
        if (pred.weight > 0) {
            taiScore += pred.taiScore;
            xiuScore += pred.xiuScore;
            totalWeight += pred.weight;
        }
    }
    
    // ========== PHẦN 2: THUẬT TOÁN CẦU (GIỮ NGUYÊN) ==========
    
    // Pattern prediction từ cầu
    let results = gameHistory[gameId].map(h => h.result === 'Tài' ? 'T' : 'X');
    for (let len of [3, 4, 5, 6]) {
        if (n >= len) {
            let pattern = results.slice(-len).join('');
            let nextT = patternMemoryBank.patternNext[pattern + '->T'] || 0;
            let nextX = patternMemoryBank.patternNext[pattern + '->X'] || 0;
            let total = nextT + nextX;
            if (total >= 2) {
                let probT = nextT / total;
                if (probT > 0.55) {
                    taiScore += probT * 0.1;
                    totalWeight += 0.1;
                } else if (probT < 0.45) {
                    xiuScore += (1 - probT) * 0.1;
                    totalWeight += 0.1;
                }
            }
        }
    }
    
    // Bệt cầu
    let streak = 1;
    for (let i = n - 2; i >= 0; i--) {
        if (gameHistory[gameId][i].result === lastResult) streak++;
        else break;
    }
    if (streak >= 3) {
        let countLonger = 0;
        for (let s = streak + 1; s <= Math.min(50, cauMemoryBank.biet.stats['max' + lastResult] || 50); s++) {
            countLonger += lastResult === 'Tài' ? (cauMemoryBank.biet.Tai[s] || 0) : (cauMemoryBank.biet.Xiu[s] || 0);
        }
        let countThis = lastResult === 'Tài' ? (cauMemoryBank.biet.Tai[streak] || 0) : (cauMemoryBank.biet.Xiu[streak] || 0);
        let total = countThis + countLonger;
        if (total > 0) {
            let probContinue = countLonger / total;
            if (probContinue > 0.5) {
                if (lastResult === 'Tài') taiScore += 0.12;
                else xiuScore += 0.12;
            } else {
                if (lastResult === 'Tài') xiuScore += 0.12;
                else taiScore += 0.12;
            }
            totalWeight += 0.12;
        }
    }
    
    // Bẻ cầu khi bệt quá dài
    if (streak >= 7) {
        if (lastResult === 'Tài') xiuScore += 0.15;
        else taiScore += 0.15;
        totalWeight += 0.1;
    }
    
    // Score prediction
    if (n >= 2 && scoreMemoryBank.afterScore[lastTotal]) {
        let after = scoreMemoryBank.afterScore[lastTotal];
        let totalAfter = 0, taiAfter = 0;
        for (let s = 3; s <= 18; s++) {
            totalAfter += after[s] || 0;
            if (s >= 11) taiAfter += after[s] || 0;
        }
        if (totalAfter >= 3) {
            let probT = taiAfter / totalAfter;
            if (probT > 0.55) taiScore += 0.08;
            else if (probT < 0.45) xiuScore += 0.08;
            totalWeight += 0.08;
        }
    }
    
    // Tổng hợp
    if (totalWeight === 0) {
        return { prediction: 'CHO', confidence: 0, reason: 'Chưa đủ tín hiệu' };
    }
    
    let probTai = taiScore / totalWeight;
    
    if (Math.abs(probTai - 0.5) < 0.04) {
        return { prediction: 'CHO', confidence: 0, reason: 'Tín hiệu quá yếu' };
    }
    
    let finalPrediction = probTai > 0.5 ? 'Tài' : 'Xỉu';
    let confidence = Math.min(95, Math.max(60, Math.round(Math.abs(probTai - 0.5) * 2 * 100)));
    
    // Lấy thông tin dice engine stats để hiển thị
    const diceEngineStats = diceEngines[gameId];
    const hotFaces = diceEngineStats.hotFaces.join(',');
    const coldFaces = diceEngineStats.coldFaces.join(',');
    
    let reason = `Dice: hot[${hotFaces}] cold[${coldFaces}] | Tai:${(probTai*100).toFixed(0)}%`;
    
    return { prediction: finalPrediction, confidence, reason };
}

// ================= CREATE ENDPOINT =================
function createEndpoint(gameId) {
    return async (req, res) => {
        const key = req.query.key;
        if (key !== AUTH_KEY) {
            return res.status(403).json({ error: "Truy cập bị từ chối." });
        }
        
        initGame(gameId);
        const config = GAME_CONFIG[gameId];
        
        let data = await getCachedData(gameId);
        if (!data) {
            data = await fetchData(config.api_url);
            if (!data) return res.status(500).json({ error: "Không thể lấy dữ liệu." });
        }
        
        const items = data.list || data;
        const currentItem = items[0];
        const { result, point, dices, sessionId } = parseSession(currentItem, config.type);
        
        if (!result) {
            return res.status(500).json({ error: "Không có lịch sử." });
        }
        
        // Kiểm tra đã xử lý phiên này chưa
        if (lastProcessedSession[gameId] === sessionId) {
            const currentPred = pendingPredictions[gameId] || { prediction: 'Tài', confidence: 50 };
            const taiPercent = currentPred.prediction === 'Tài' ? currentPred.confidence : 100 - currentPred.confidence;
            
            return res.json({
                phien: sessionId,
                xuc_xac: dices,
                tong: point,
                ket_qua: result,
                du_doan: currentPred.prediction,
                do_tin_cay: `${taiPercent}%-${100-taiPercent}%`,
                id: USER_ID,
                ai_model: `${ALGO_NAME} v12`,
                dice_algorithms: "FaceDist,Transition,Sum,PairTriple,Sequence,NB",
                lich_su_du_doan: predictionHistory[gameId]?.slice(0, 10) || []
            });
        }
        
        // So sánh dự đoán trước với kết quả thực tế
        if (pendingPredictions[gameId] && lastProcessedSession[gameId] !== sessionId) {
            const lastPred = pendingPredictions[gameId];
            if (lastPred.prediction !== 'CHO') {
                const isCorrect = (lastPred.prediction === 'Tài' && result === 'Tài') ||
                                 (lastPred.prediction === 'Xỉu' && result === 'Xỉu');
                
                const alreadySaved = predictionHistory[gameId]?.some(h => h.sessionId === sessionId);
                if (!alreadySaved) {
                    predictionHistory[gameId].unshift({
                        sessionId: sessionId,
                        prediction: lastPred.prediction,
                        actual: result,
                        isCorrect: isCorrect,
                        icon: isCorrect ? '✅' : '❌',
                        confidence: lastPred.confidence,
                        timestamp: new Date().toISOString()
                    });
                    totalPredictions++;
                    if (isCorrect) totalCorrect++;
                }
                if (predictionHistory[gameId].length > 50) predictionHistory[gameId].pop();
            }
        }
        
        lastProcessedSession[gameId] = sessionId;
        
        // Thêm vào lịch sử
        addSession(gameId, sessionId, result, point, dices[0], dices[1], dices[2]);
        
        // Dự đoán
        const predResult = predictSuper(gameId);
        
        pendingPredictions[gameId] = {
            prediction: predResult.prediction,
            confidence: predResult.confidence,
            reason: predResult.reason,
            timestamp: Date.now()
        };
        
        const diceEngine = diceEngines[gameId];
        const taiPercent = predResult.prediction === 'Tài' ? predResult.confidence : 100 - predResult.confidence;
        
        const response = {
            phien: sessionId,
            xuc_xac: dices,
            tong: point,
            ket_qua: result,
            phien_hien_tai: sessionId ? parseInt(sessionId) + 1 : "?",
            du_doan: predResult.prediction,
            do_tin_cay: predResult.prediction === 'CHO' ? "0%-0%" : `${Math.round(taiPercent)}%-${Math.round(100-taiPercent)}%`,
            id: USER_ID,
            ai_model: `${ALGO_NAME} v12`,
            // THÔNG TIN DICE ALGORITHMS
            dice_analysis: {
                hot_faces: diceEngine.hotFaces,
                cold_faces: diceEngine.coldFaces,
                mean_total: diceEngine.meanDice.total.toFixed(2),
                variance_total: diceEngine.varianceDice.total.toFixed(2),
                unique_triples: Object.keys(diceEngine.tripleFrequency).length,
                total_samples: gameHistory[gameId].length
            },
            reason: predResult.reason,
            lich_su_du_doan: predictionHistory[gameId]?.slice(0, 10) || []
        };
        
        res.json(response);
    };
}

// ================= ENDPOINTS =================
app.use(express.json());

for (const gameId of Object.keys(GAME_CONFIG)) {
    app.get(`/api/${gameId}`, createEndpoint(gameId));
}

// Endpoint lấy thống kê dice
app.get('/api/dice-stats/:gameId', (req, res) => {
    const key = req.query.key;
    if (key !== AUTH_KEY) return res.status(403).json({ error: "Access denied" });
    
    const gameId = req.params.gameId;
    const diceEngine = diceEngines[gameId];
    if (!diceEngine) return res.json({ error: "Game not initialized" });
    
    res.json({
        game: gameId,
        face_frequency: diceEngine.faceFrequency,
        face_by_position: diceEngine.faceByPosition,
        hot_faces: diceEngine.hotFaces,
        cold_faces: diceEngine.coldFaces,
        mean_dice: diceEngine.meanDice,
        variance_dice: diceEngine.varianceDice,
        unique_triples: Object.keys(diceEngine.tripleFrequency).length,
        double_frequency: diceEngine.doubleFrequency,
        total_sequences: diceEngine.diceSequence.length,
        algorithms_active: [
            "FaceDistribution",
            "FaceTransition",
            "SumAnalysis",
            "PairTripleAnalysis",
            "SequenceAnalysis",
            "NaiveBayes"
        ]
    });
});

app.get('/api/stats', (req, res) => {
    const key = req.query.key;
    if (key !== AUTH_KEY) return res.status(403).json({ error: "Access denied" });
    
    res.json({
        total_predictions: totalPredictions,
        total_correct: totalCorrect,
        accuracy: totalPredictions > 0 ? ((totalCorrect / totalPredictions) * 100).toFixed(2) + '%' : '0%',
        algorithm_version: "v12 - Dice Algorithms Master",
        dice_algorithms: [
            "Face Distribution Analyzer",
            "Face Transition Matrix",
            "Sum Probability & Trend",
            "Pair & Triple Analysis",
            "Dice Sequence Pattern",
            "Statistical Metrics",
            "Naive Bayes Prediction"
        ]
    });
});

app.get('/', (req, res) => {
    res.json({
        service: ALGO_NAME,
        version: "v12.0",
        description: "Thuật toán dice cao cấp + thuật toán cầu truyền thống",
        endpoints: Object.keys(GAME_CONFIG).map(id => `/api/${id}`),
        dice_algorithms: [
            "🎲 Face Distribution - Phân tích tần suất từng mặt",
            "🔄 Face Transition - Ma trận chuyển tiếp mặt xúc xắc",
            "📊 Sum Probability - Xác suất và xu hướng tổng điểm",
            "🔗 Pair & Triple - Phân tích cặp và bộ ba",
            "📈 Sequence Analysis - Pattern chuỗi dice",
            "📉 Statistical Metrics - Mean, Variance, Hot/Cold",
            "🤖 Naive Bayes - Machine Learning cho dice"
        ]
    });
});

// Auto ping
async function autoPing() {
    while (true) {
        for (const gameId of Object.keys(GAME_CONFIG)) {
            try {
                const config = GAME_CONFIG[gameId];
                const data = await fetchData(config.api_url);
                if (data) gameCache[gameId] = { data, ts: Date.now() };
            } catch(e) {}
        }
        await new Promise(r => setTimeout(r, 5000));
    }
}
autoPing();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎲 ${ALGO_NAME} v12.0 - DICE ALGORITHMS MASTER`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`🔑 Auth Key: ${AUTH_KEY}`);
    console.log(`\n📊 THUẬT TOÁN DICE ĐÃ KÍCH HOẠT:`);
    console.log(`   1. Face Distribution Analyzer`);
    console.log(`   2. Face Transition Matrix`);
    console.log(`   3. Sum Probability & Trend`);
    console.log(`   4. Pair & Triple Analysis`);
    console.log(`   5. Dice Sequence Pattern`);
    console.log(`   6. Statistical Metrics (Hot/Cold faces)`);
    console.log(`   7. Naive Bayes Prediction`);
    console.log(`\n🎮 Games: LC79_TX, LC79_MD5, BETVIP_TX, BETVIP_MD5`);
    console.log(`=========================================\n`);
});
