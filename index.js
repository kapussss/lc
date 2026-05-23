// server.js - Ultimate Tai Xiu Prediction API v10.0 (AI Self-Learning)
// Chỉ hỗ trợ 4 game: LC79(TX/MD5), BETVIP(TX/MD5)

const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;
const AUTH_KEY = "kapub";
const USER_ID = "@Kapubb";
const ALGO_NAME = "PatternMASTER";

// ================= CONFIG - CHỈ GIỮ 4 GAME =================
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

// ================= CACHE =================
let gameCache = {};
let gameHistory = {};
let predictionHistory = {};
let pendingPredictions = {};
let lastProcessedSession = {};

// ================= HÀM TIỆN ÍCH =================
function movingAverage(data, window) {
    if (data.length < window) return data.reduce((a, b) => a + b, 0) / data.length;
    const slice = data.slice(-window);
    return slice.reduce((a, b) => a + b, 0) / window;
}

function standardDeviation(data, mean = null) {
    if (data.length === 0) return 0;
    if (mean === null) mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / data.length;
    return Math.sqrt(variance);
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

async function fetchAndCache(gameId) {
    const config = GAME_CONFIG[gameId];
    if (!config) return null;
    const data = await fetchData(config.api_url);
    if (data) {
        gameCache[gameId] = { data, ts: new Date().toISOString() };
    }
    return data;
}

async function getCachedData(gameId) {
    if (gameCache[gameId]) return gameCache[gameId].data;
    return await fetchAndCache(gameId);
}

function parseSession(item, gameType) {
    let result = null, point = 0, dices = [0, 0, 0], sessionId = null;
    
    if (gameType === "legacy") {
        const resultRaw = (item.resultTruyenThong || "").toUpperCase();
        result = resultRaw.includes("TAI") ? "T" : resultRaw.includes("XIU") ? "X" : null;
        point = item.point || 0;
        dices = item.dices || [0, 0, 0];
        sessionId = item.id;
    }
    return { result, point, dices, sessionId };
}

// ================= THUẬT TOÁN ULTIMATE SYSTEM =================

let totalPredictions = 0;
let totalCorrect = 0;

let cauMemoryBank = {
    biet: { Tai: {}, Xiu: {}, stats: { maxTai: 0, maxXiu: 0, avgTai: 0, avgXiu: 0, totalBietTai: 0, totalBietXiu: 0 } },
    c11: { patterns: {}, stats: { total: 0 } },
    c22: { patterns: {}, stats: { total: 0 } }
};

let diceMemoryBank = {
    x1: {1:0,2:0,3:0,4:0,5:0,6:0, stats: {}},
    x2: {1:0,2:0,3:0,4:0,5:0,6:0, stats: {}},
    x3: {1:0,2:0,3:0,4:0,5:0,6:0, stats: {}},
    tong: {3:0,4:0,5:0,6:0,7:0,8:0,9:0,10:0,11:0,12:0,13:0,14:0,15:0,16:0,17:0,18:0, stats: {}},
    triple: { matrix: {}, stats: { total: 0, uniqueTriples: 0 } },
    highLow: { HHH:0, HHL:0, HLH:0, HLL:0, LHH:0, LHL:0, LLH:0, LLL:0 },
    oddEven: { CCC:0, CCL:0, CLC:0, CLL:0, LCC:0, LCL:0, LLC:0, LLL:0 },
    transition: {
        x1: Array.from({ length: 7 }, (_, i) => i === 0 ? null : { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }),
        x2: Array.from({ length: 7 }, (_, i) => i === 0 ? null : { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }),
        x3: Array.from({ length: 7 }, (_, i) => i === 0 ? null : { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 })
    },
    tripleTransition: {}
};

let patternMemoryBank = {
    patternNext: {}
};

let scoreMemoryBank = {
    afterScore: {},
    afterScoreResult: {},
    movingAvg: { MA5: [], MA10: [], MA20: [] }
};

// Khởi tạo history cho từng game
function initGameHistory(gameId) {
    if (!gameHistory[gameId]) {
        gameHistory[gameId] = [];
    }
    if (!predictionHistory[gameId]) {
        predictionHistory[gameId] = [];
    }
    if (!lastProcessedSession[gameId]) {
        lastProcessedSession[gameId] = null;
    }
}

function addSession(gameId, session, result, totalScore, d1, d2, d3) {
    if (!gameHistory[gameId]) {
        gameHistory[gameId] = [];
    }
    
    gameHistory[gameId].push({ session, result, totalScore, d1, d2, d3, timestamp: Date.now() });
    
    // Giới hạn history
    if (gameHistory[gameId].length > 500) {
        gameHistory[gameId] = gameHistory[gameId].slice(-400);
    }
    
    updateDiceMemory(gameId, d1, d2, d3, totalScore);
    updateScoreMemory(gameId, totalScore, result);
    updateCauMemory(gameId, result);
    updatePatternMemory(gameId, result);
}

function updateDiceMemory(gameId, d1, d2, d3, total) {
    diceMemoryBank.x1[d1]++;
    diceMemoryBank.x2[d2]++;
    diceMemoryBank.x3[d3]++;
    diceMemoryBank.tong[total]++;
    
    let triple = d1 + '' + d2 + '' + d3;
    diceMemoryBank.triple.matrix[triple] = (diceMemoryBank.triple.matrix[triple] || 0) + 1;
    diceMemoryBank.triple.stats.total++;
    diceMemoryBank.triple.stats.uniqueTriples = Object.keys(diceMemoryBank.triple.matrix).length;
    
    let hl = (d1 >= 4 ? 'H' : 'L') + (d2 >= 4 ? 'H' : 'L') + (d3 >= 4 ? 'H' : 'L');
    diceMemoryBank.highLow[hl] = (diceMemoryBank.highLow[hl] || 0) + 1;
    
    let oe = (d1 % 2 === 0 ? 'C' : 'L') + (d2 % 2 === 0 ? 'C' : 'L') + (d3 % 2 === 0 ? 'C' : 'L');
    diceMemoryBank.oddEven[oe] = (diceMemoryBank.oddEven[oe] || 0) + 1;
    
    let n = gameHistory[gameId] ? gameHistory[gameId].length : 0;
    if (n >= 2) {
        let prev = gameHistory[gameId][n - 2];
        if (diceMemoryBank.transition.x1[prev.d1]) diceMemoryBank.transition.x1[prev.d1][d1]++;
        if (diceMemoryBank.transition.x2[prev.d2]) diceMemoryBank.transition.x2[prev.d2][d2]++;
        if (diceMemoryBank.transition.x3[prev.d3]) diceMemoryBank.transition.x3[prev.d3][d3]++;
        
        let prevTriple = prev.d1 + '' + prev.d2 + '' + prev.d3;
        let key = prevTriple + '_to_' + triple;
        diceMemoryBank.tripleTransition[key] = (diceMemoryBank.tripleTransition[key] || 0) + 1;
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
    
    if (n >= 5) {
        let avg5 = gameHistory[gameId].slice(-5).map(h => h.totalScore).reduce((a, b) => a + b, 0) / 5;
        scoreMemoryBank.movingAvg.MA5.push(avg5);
        if (scoreMemoryBank.movingAvg.MA5.length > 100) scoreMemoryBank.movingAvg.MA5.shift();
    }
}

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
    
    if (n >= 6) {
        let last6 = results.slice(-6);
        let is11 = true;
        for (let i = 1; i < 6; i++) {
            if (last6[i] === last6[i - 1]) { is11 = false; break; }
        }
        if (is11) {
            cauMemoryBank.c11.stats.total++;
        }
    }
    
    if (n >= 8) {
        let last8 = results.slice(-8);
        let is22 = true;
        for (let i = 0; i < 8; i += 2) {
            if (last8[i] !== last8[i + 1]) { is22 = false; break; }
        }
        if (is22 && last8[0] !== last8[2]) {
            cauMemoryBank.c22.stats.total++;
        }
    }
}

function updatePatternMemory(gameId, result) {
    let n = gameHistory[gameId] ? gameHistory[gameId].length : 0;
    if (n < 3) return;
    
    let r = result === 'Tài' ? 'T' : 'X';
    let results = gameHistory[gameId].map(h => h.result === 'Tài' ? 'T' : 'X');
    
    for (let len of [3, 4, 5, 6, 7, 8, 9, 10]) {
        if (n > len) {
            let pattern = results.slice(-len - 1, -1).join('');
            let nextKey = pattern + '->' + r;
            patternMemoryBank.patternNext[nextKey] = (patternMemoryBank.patternNext[nextKey] || 0) + 1;
        }
    }
}

function predictSuper(gameId) {
    let n = gameHistory[gameId] ? gameHistory[gameId].length : 0;
    
    // Chưa đủ dữ liệu
    if (n < 5) {
        return { prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu', confidence: 50, reason: 'Chưa đủ dữ liệu' };
    }
    
    let predictions = [];
    let results = gameHistory[gameId].map(h => h.result === 'Tài' ? 'T' : 'X');
    let lastResult = gameHistory[gameId][n - 1].result;
    let lastD1 = gameHistory[gameId][n - 1].d1;
    let lastD2 = gameHistory[gameId][n - 1].d2;
    let lastD3 = gameHistory[gameId][n - 1].d3;
    let lastTriple = lastD1 + '' + lastD2 + '' + lastD3;
    let lastScore = gameHistory[gameId][n - 1].totalScore;
    
    // Pattern prediction
    for (let len of [3, 4, 5, 6, 7, 8, 9, 10]) {
        if (n >= len) {
            let pattern = results.slice(-len).join('');
            let nextT = patternMemoryBank.patternNext[pattern + '->T'] || 0;
            let nextX = patternMemoryBank.patternNext[pattern + '->X'] || 0;
            let total = nextT + nextX;
            if (total >= 3) {
                let probT = nextT / total;
                predictions.push({
                    predict: probT > 0.5 ? 'Tài' : 'Xỉu',
                    confidence: Math.abs(probT - 0.5) * 2,
                    source: 'p' + len,
                    weight: 0.02 * len
                });
            }
        }
    }
    
    // Bệt prediction
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
            predictions.push({
                predict: probContinue > 0.5 ? lastResult : (lastResult === 'Tài' ? 'Xỉu' : 'Tài'),
                confidence: Math.abs(probContinue - 0.5) * 2 + 0.3,
                source: 'biet',
                weight: 0.15
            });
        }
    }
    
    // Score prediction
    if (n >= 2 && scoreMemoryBank.afterScore[lastScore]) {
        let after = scoreMemoryBank.afterScore[lastScore];
        let totalAfter = 0, taiAfter = 0;
        for (let s = 3; s <= 18; s++) {
            totalAfter += after[s] || 0;
            if (s >= 11) taiAfter += after[s] || 0;
        }
        if (totalAfter >= 3) {
            let probT = taiAfter / totalAfter;
            predictions.push({
                predict: probT > 0.5 ? 'Tài' : 'Xỉu',
                confidence: Math.abs(probT - 0.5) + 0.3,
                source: 'score',
                weight: 0.1
            });
        }
    }
    
    // Triple transition prediction
    let afterTriples = {};
    for (let key in diceMemoryBank.tripleTransition) {
        if (key.startsWith(lastTriple + '_to_')) {
            let nextT = key.split('_to_')[1];
            afterTriples[nextT] = diceMemoryBank.tripleTransition[key];
        }
    }
    if (Object.keys(afterTriples).length > 0) {
        let totalAfter = Object.values(afterTriples).reduce((a, b) => a + b, 0);
        let taiAfter = 0;
        for (let triple in afterTriples) {
            let sum = triple.split('').map(Number).reduce((a, b) => a + b, 0);
            if (sum >= 11) taiAfter += afterTriples[triple];
        }
        if (totalAfter >= 2) {
            let probT = taiAfter / totalAfter;
            predictions.push({
                predict: probT > 0.5 ? 'Tài' : 'Xỉu',
                confidence: Math.abs(probT - 0.5) + 0.4,
                source: 'dice_triple',
                weight: 0.08
            });
        }
    }
    
    // Dice transition prediction
    let trans1 = diceMemoryBank.transition.x1[lastD1] || {};
    let trans2 = diceMemoryBank.transition.x2[lastD2] || {};
    let trans3 = diceMemoryBank.transition.x3[lastD3] || {};
    let maxD1 = 1, maxD2 = 1, maxD3 = 1, maxC1 = 0, maxC2 = 0, maxC3 = 0;
    for (let f = 1; f <= 6; f++) {
        if ((trans1[f] || 0) > maxC1) { maxC1 = trans1[f] || 0; maxD1 = f; }
        if ((trans2[f] || 0) > maxC2) { maxC2 = trans2[f] || 0; maxD2 = f; }
        if ((trans3[f] || 0) > maxC3) { maxC3 = trans3[f] || 0; maxD3 = f; }
    }
    let predTotal = maxD1 + maxD2 + maxD3;
    predictions.push({
        predict: predTotal >= 11 ? 'Tài' : 'Xỉu',
        confidence: 0.55,
        source: 'dice_trans',
        weight: 0.06
    });
    
    // High/Low prediction
    let currentHL = (lastD1 >= 4 ? 'H' : 'L') + (lastD2 >= 4 ? 'H' : 'L') + (lastD3 >= 4 ? 'H' : 'L');
    let hlKeys = Object.keys(diceMemoryBank.highLow);
    let hlIdx = hlKeys.indexOf(currentHL);
    let nextHLIdx = (hlIdx + 1) % hlKeys.length;
    let nextHL = hlKeys[nextHLIdx];
    let hlFreq = diceMemoryBank.highLow[nextHL] || 0;
    let hlTotal = Object.values(diceMemoryBank.highLow).reduce((a, b) => a + b, 0);
    if (hlTotal > 0 && hlFreq / hlTotal > 0.1) {
        let hCount = (nextHL.match(/H/g) || []).length;
        predictions.push({
            predict: hCount >= 2 ? 'Tài' : 'Xỉu',
            confidence: 0.5 + hlFreq / hlTotal,
            source: 'dice_hl',
            weight: 0.04
        });
    }
    
    // Odd/Even prediction
    let currentOE = (lastD1 % 2 === 0 ? 'C' : 'L') + (lastD2 % 2 === 0 ? 'C' : 'L') + (lastD3 % 2 === 0 ? 'C' : 'L');
    let oeKeys = Object.keys(diceMemoryBank.oddEven);
    let oeIdx = oeKeys.indexOf(currentOE);
    let nextOEIdx = (oeIdx + 1) % oeKeys.length;
    let nextOE = oeKeys[nextOEIdx];
    let oeFreq = diceMemoryBank.oddEven[nextOE] || 0;
    let oeTotal = Object.values(diceMemoryBank.oddEven).reduce((a, b) => a + b, 0);
    if (oeTotal > 0 && oeFreq / oeTotal > 0.1) {
        let cCount = (nextOE.match(/C/g) || []).length;
        predictions.push({
            predict: cCount >= 2 ? 'Xỉu' : 'Tài',
            confidence: 0.5 + oeFreq / oeTotal,
            source: 'dice_oe',
            weight: 0.04
        });
    }
    
    // Bẻ cầu khi bệt quá dài
    if (streak >= 7) {
        predictions.push({
            predict: lastResult === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: 0.7 + Math.min(0.2, (streak - 7) * 0.03),
            source: 'be_cau',
            weight: 0.12
        });
    }
    
    // MA5 prediction
    if (scoreMemoryBank.movingAvg.MA5.length >= 2) {
        let lastMA5 = scoreMemoryBank.movingAvg.MA5[scoreMemoryBank.movingAvg.MA5.length - 1];
        if (lastMA5 > 13) predictions.push({ predict: 'Xỉu', confidence: 0.6, source: 'ma5_high', weight: 0.05 });
        if (lastMA5 < 7) predictions.push({ predict: 'Tài', confidence: 0.6, source: 'ma5_low', weight: 0.05 });
    }
    
    // Tổng hợp dự đoán
    let weightedTai = 0, weightedXiu = 0, totalWeight = 0;
    for (let pred of predictions) {
        let w = pred.weight * pred.confidence;
        if (pred.predict === 'Tài') weightedTai += w;
        else if (pred.predict === 'Xỉu') weightedXiu += w;
        totalWeight += w;
    }
    
    if (totalWeight === 0) {
        return { prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu', confidence: 50, reason: 'Không đủ tín hiệu' };
    }
    
    let probTai = weightedTai / totalWeight;
    
    // Nếu tín hiệu quá yếu -> CHO (không dự đoán)
    if (Math.abs(probTai - 0.5) < 0.04) {
        return { prediction: 'CHO', confidence: 0, reason: 'Tín hiệu quá yếu' };
    }
    
    let finalPrediction = probTai > 0.5 ? 'Tài' : 'Xỉu';
    let confidence = Math.round(Math.abs(probTai - 0.5) * 2 * 100);
    confidence = Math.max(55, Math.min(95, confidence));
    
    let topSources = predictions.sort((a, b) => b.weight * b.confidence - a.weight * a.confidence).slice(0, 3);
    let reason = topSources.map(s => s.source).join(', ');
    
    return { prediction: finalPrediction, confidence, reason, totalSources: predictions.length };
}

// ================= AUTO PING =================
async function pingAllApis() {
    while (true) {
        for (const gameId of Object.keys(GAME_CONFIG)) {
            try {
                await fetchAndCache(gameId);
            } catch (e) {
                // Silent error
            }
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

// ================= CREATE ENDPOINTS =================
function createEndpoint(gameId) {
    return async (req, res) => {
        const key = req.query.key;
        if (key !== AUTH_KEY) {
            return res.status(403).json({ error: "Truy cập bị từ chối." });
        }
        
        const config = GAME_CONFIG[gameId];
        if (!config) {
            return res.status(400).json({ error: "Game không hợp lệ." });
        }
        
        // Khởi tạo history cho game
        initGameHistory(gameId);
        
        let data = await getCachedData(gameId);
        if (!data) {
            data = await fetchData(config.api_url);
            if (!data) {
                return res.status(500).json({ error: "Không thể lấy dữ liệu." });
            }
        }
        
        const items = data.list || data;
        const currentItem = items[0];
        const { result, point, dices, sessionId } = parseSession(currentItem, config.type);
        
        if (!result) {
            return res.status(500).json({ error: "Không có lịch sử." });
        }
        
        const resultText = result === 'T' ? 'Tài' : 'Xỉu';
        
        // KIỂM TRA: Nếu đã xử lý phiên này rồi thì không xử lý lại
        if (lastProcessedSession[gameId] === sessionId) {
            // Đã xử lý rồi, chỉ trả về dự đoán hiện tại
            const currentPred = pendingPredictions[gameId] || { prediction: 'Tài', confidence: 50 };
            const taiPercent = currentPred.prediction === 'Tài' ? currentPred.confidence : 100 - currentPred.confidence;
            const xiuPercent = 100 - taiPercent;
            
            return res.json({
                phien: sessionId,
                xuc_xac: dices,
                tong: point,
                ket_qua: resultText,
                phien_hien_tai: sessionId ? sessionId + 1 : "?",
                du_doan: currentPred.prediction,
                do_tin_cay: `${taiPercent}%-${xiuPercent}%`,
                id: USER_ID,
                ai_model: ALGO_NAME,
                self_learning: "Active",
                lich_su_du_doan: predictionHistory[gameId].slice(0, 10)
            });
        }
        
        // KIỂM TRA: Nếu có dự đoán đang chờ, so sánh với kết quả thực tế
        if (pendingPredictions[gameId] && lastProcessedSession[gameId] !== sessionId) {
            const lastPred = pendingPredictions[gameId];
            
            // CHỈ LƯU NẾU KHÔNG PHẢI DỰ ĐOÁN "CHO"
            if (lastPred.prediction !== 'CHO') {
                const isCorrect = (lastPred.prediction === 'Tài' && result === 'T') ||
                                 (lastPred.prediction === 'Xỉu' && result === 'X');
                
                // Kiểm tra xem phiên này đã được lưu chưa (tránh lặp)
                const alreadySaved = predictionHistory[gameId].some(h => h.sessionId === sessionId);
                
                if (!alreadySaved) {
                    predictionHistory[gameId].unshift({
                        sessionId: sessionId,
                        prediction: lastPred.prediction,
                        actual: resultText,
                        isCorrect: isCorrect,
                        icon: isCorrect ? '✅' : '❌',
                        confidence: lastPred.confidence,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Cập nhật thống kê
                    totalPredictions++;
                    if (isCorrect) totalCorrect++;
                }
            }
            
            // Giới hạn lịch sử 50 phiên
            if (predictionHistory[gameId].length > 50) {
                predictionHistory[gameId] = predictionHistory[gameId].slice(0, 50);
            }
        }
        
        // Cập nhật session đã xử lý TRƯỚC KHI thêm vào gameHistory
        lastProcessedSession[gameId] = sessionId;
        
        // Thêm phiên mới vào lịch sử để học
        addSession(gameId, sessionId, resultText, point, dices[0], dices[1], dices[2]);
        
        // Dự đoán cho phiên tiếp theo
        const predResult = predictSuper(gameId);
        
        // Lưu dự đoán đang chờ (kể cả CHO cũng lưu tạm nhưng không vào lịch sử)
        pendingPredictions[gameId] = {
            prediction: predResult.prediction,
            confidence: predResult.confidence,
            reason: predResult.reason,
            timestamp: Date.now()
        };
        
        const taiPercent = predResult.prediction === 'Tài' ? predResult.confidence : 100 - predResult.confidence;
        const xiuPercent = 100 - taiPercent;
        
        const response = {
            phien: sessionId,
            xuc_xac: dices,
            tong: point,
            ket_qua: resultText,
            phien_hien_tai: sessionId ? sessionId + 1 : "?",
            du_doan: predResult.prediction,
            do_tin_cay: predResult.prediction === 'CHO' ? "0%-0%" : `${taiPercent}%-${xiuPercent}%`,
            id: USER_ID,
            ai_model: ALGO_NAME,
            self_learning: "Active",
            reason: predResult.reason,
            lich_su_du_doan: predictionHistory[gameId].slice(0, 10)
        };
        
        res.json(response);
    };
}

// Endpoint lấy lịch sử dự đoán
app.get('/api/history/:gameId', (req, res) => {
    const key = req.query.key;
    if (key !== AUTH_KEY) {
        return res.status(403).json({ error: "Truy cập bị từ chối." });
    }
    
    const gameId = req.params.gameId;
    const history = predictionHistory[gameId] || [];
    const total = history.length;
    const correct = history.filter(h => h.isCorrect).length;
    
    res.json({
        game: gameId,
        total_predictions: total,
        accuracy: total > 0 ? ((correct / total) * 100).toFixed(2) + '%' : '0%',
        history: history
    });
});

// Endpoint lấy thống kê
app.get('/api/stats', (req, res) => {
    const key = req.query.key;
    if (key !== AUTH_KEY) {
        return res.status(403).json({ error: "Truy cập bị từ chối." });
    }
    
    res.json({
        total_predictions: totalPredictions,
        total_correct: totalCorrect,
        accuracy: totalPredictions > 0 ? ((totalCorrect / totalPredictions) * 100).toFixed(2) + '%' : '0%',
        games: Object.keys(predictionHistory).map(gameId => ({
            game: gameId,
            predictions: predictionHistory[gameId]?.length || 0
        }))
    });
});

// ================= START SERVER =================
app.use(express.json());

for (const gameId of Object.keys(GAME_CONFIG)) {
    app.get(`/api/${gameId}`, createEndpoint(gameId));
}

app.get('/api/health', (req, res) => {
    res.json({ status: "healthy", games: Object.keys(GAME_CONFIG).length });
});

app.get('/', (req, res) => {
    res.json({
        service: ALGO_NAME,
        endpoints: Object.keys(GAME_CONFIG).map(id => `/api/${id}`),
        auth: "?key=???"
    });
});

// Start auto ping
pingAllApis();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server ULTIMATE v10.0 đang chạy...`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`🔑 Auth Key: ${AUTH_KEY}`);
    console.log(`🎮 Games: LC79_TX, LC79_MD5, BETVIP_TX, BETVIP_MD5`);
    console.log(`=========================================`);
    console.log(`📊 Lịch sử dự đoán: Mỗi phiên chỉ lưu 1 lần`);
    console.log(`⚠️ Dự đoán "CHO" sẽ không được tính vào lịch sử`);
});
