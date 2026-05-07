const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'learning_data_v6.json';
const HISTORY_FILE = 'prediction_history_v6.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 300;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== CẢI TIẾN 1: BỘ NHỚ XU HƯỚNG ĐỘNG ====================
class TrendMemory {
    constructor() {
        this.trendWindow = []; // lưu 20 phiên gần nhất
        this.streakCount = 0;
        this.streakType = null;
        this.breakResistance = 0; // kháng cự bẻ cầu (càng cao càng khó bẻ)
    }
    
    updateTrend(result) {
        this.trendWindow.unshift(result);
        if (this.trendWindow.length > 20) this.trendWindow.pop();
        
        // Cập nhật streak hiện tại
        if (this.streakType === result) {
            this.streakCount++;
            this.breakResistance = Math.min(85, this.breakResistance + 12); // bệt càng dài càng khó bẻ
        } else {
            this.streakType = result;
            this.streakCount = 1;
            this.breakResistance = Math.max(15, this.breakResistance - 25);
        }
        
        return this.getTrendSignal();
    }
    
    getTrendSignal() {
        if (this.trendWindow.length < 10) return { hasTrend: false };
        
        const taiCount = this.trendWindow.filter(r => r === 'Tài').length;
        const ratio = taiCount / this.trendWindow.length;
        
        if (ratio >= 0.7) return { hasTrend: true, direction: 'Tài', strength: (ratio - 0.5) * 2 };
        if (ratio <= 0.3) return { hasTrend: true, direction: 'Xỉu', strength: (0.5 - ratio) * 2 };
        
        // Phát hiện xu hướng đan xen có quy luật
        let alternatingScore = 0;
        for (let i = 0; i < this.trendWindow.length - 1; i++) {
            if (this.trendWindow[i] !== this.trendWindow[i+1]) alternatingScore++;
        }
        if (alternatingScore >= 14) {
            return { hasTrend: true, direction: 'alternating', strength: alternatingScore / 20 };
        }
        
        return { hasTrend: false };
    }
    
    shouldBreak() {
        // Cầu bệt càng dài, càng KHÔNG NÊN bẻ sớm
        if (this.streakCount >= 5) {
            const breakProbability = Math.max(10, 35 - (this.streakCount - 4) * 8);
            return Math.random() * 100 < breakProbability ? 'follow' : this.streakType;
        }
        return null;
    }
}

// ==================== CẢI TIẾN 2: BỘ DỰ ĐOÁN LƯỢNG TỬ HÓA ====================
class QuantumPredictor {
    constructor() {
        this.weights = {
            trend: 0.25,
            pattern: 0.20,
            psychology: 0.15,
            dicePhysics: 0.15,
            antiMartingale: 0.10,
            noiseFilter: 0.15
        };
        this.adaptiveWeights = { ...this.weights };
        this.performanceHistory = [];
    }
    
    // Lọc nhiễu - tránh overfitting cầu ảo
    noiseFilter(results) {
        if (results.length < 6) return results;
        
        const filtered = [];
        let noiseCount = 0;
        
        for (let i = 0; i < results.length; i++) {
            if (i >= 2 && results[i] === results[i-1] && results[i-1] === results[i-2]) {
                filtered.push(results[i]);
                noiseCount = 0;
            } else if (i >= 1 && results[i] !== results[i-1] && noiseCount < 2) {
                filtered.push(results[i]);
                noiseCount++;
            } else if (noiseCount >= 2) {
                // Nếu đảo quá 2 lần liên tiếp, đây có thể là nhiễu → theo xu hướng chính
                const mainTrend = this.getMainTrend(results.slice(0, i));
                filtered.push(mainTrend);
                noiseCount = 0;
            } else {
                filtered.push(results[i]);
            }
        }
        return filtered;
    }
    
    getMainTrend(results) {
        const taiCount = results.filter(r => r === 'Tài').length;
        return taiCount >= results.length / 2 ? 'Tài' : 'Xỉu';
    }
    
    // Chống bẻ cầu theo lý thuyết Martingale ngược
    antiMartingaleSignal(results) {
        if (results.length < 4) return null;
        
        let lossStreak = 0;
        let currentBet = results[0];
        
        for (let i = 0; i < Math.min(results.length, 8); i++) {
            if (results[i] !== currentBet) {
                lossStreak++;
                currentBet = results[i];
            } else {
                lossStreak = 0;
            }
        }
        
        if (lossStreak >= 3) {
            // Chuỗi thua liên tiếp → đảo chiều mạnh
            return {
                prediction: currentBet === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 55 + lossStreak * 5,
                reason: `Anti-Martingale: ${lossStreak} phiên thua liên tiếp`
            };
        }
        return null;
    }
    
    // Phân tích vật lý xúc xắc nâng cao
    dicePhysicsAnalysis(data) {
        if (data.length < 8) return null;
        
        const last8 = data.slice(0, 8);
        let sumTrend = 0;
        let diceStability = 0;
        
        for (let i = 0; i < last8.length - 1; i++) {
            sumTrend += (last8[i].Tong - last8[i+1].Tong);
            const diceChange = Math.abs(last8[i].Xuc_xac_1 - last8[i+1].Xuc_xac_1) +
                               Math.abs(last8[i].Xuc_xac_2 - last8[i+1].Xuc_xac_2) +
                               Math.abs(last8[i].Xuc_xac_3 - last8[i+1].Xuc_xac_3);
            diceStability += diceChange;
        }
        
        const avgTrend = sumTrend / (last8.length - 1);
        const avgStability = diceStability / (last8.length - 1);
        
        if (Math.abs(avgTrend) > 1.5 && avgStability < 2.5) {
            // Xu hướng tổng rõ ràng, xúc xắc ổn định → theo trend
            return {
                prediction: avgTrend > 0 ? 'Tài' : 'Xỉu',
                confidence: 60 + Math.min(15, Math.abs(avgTrend) * 3),
                reason: `Dice physics: trend ${avgTrend > 0 ? 'Tài' : 'Xỉu'} (${avgTrend.toFixed(1)})`
            };
        }
        return null;
    }
}

// ==================== CẢI TIẾN 3: BỘ NHẬN DIỆN CẦU BẪY ====================
class TrapDetector {
    constructor() {
        this.trapMemory = [];
    }
    
    detectFakeBreak(results) {
        // Phát hiện bẻ cầu giả (fake break)
        if (results.length < 5) return null;
        
        // Pattern bẻ giả: 1 phiên khác rồi quay lại cũ
        if (results[0] !== results[1] && results[1] === results[2] && results[2] !== results[3] && results[3] === results[0]) {
            return {
                detected: true,
                type: 'fake_break',
                message: 'Bẻ cầu giả - quay lại cũ',
                prediction: results[0],
                confidence: 68
            };
        }
        
        // Pattern tích lũy năng lượng trước khi bẻ thật
        if (results.length >= 8) {
            const last8 = results.slice(0, 8);
            let energyAcc = 0;
            for (let i = 0; i < 7; i++) {
                if (last8[i] === last8[i+1]) energyAcc++;
                else energyAcc = Math.max(0, energyAcc - 1);
            }
            
            if (energyAcc >= 5 && results[0] !== results[1]) {
                return {
                    detected: true,
                    type: 'real_break',
                    message: 'Tích lũy đủ năng lượng - bẻ thật',
                    prediction: results[0],
                    confidence: 72
                };
            }
        }
        
        return null;
    }
    
    detectLongStreakTrap(streakCount, streakType) {
        // Cầu bệt dài - KHÔNG BẺ SỚM (đây là lỗi chính của code cũ)
        if (streakCount >= 5) {
            // Xác suất bẻ giảm dần khi streak càng dài
            const breakProbability = Math.max(5, 30 - (streakCount - 4) * 6);
            const willBreak = Math.random() * 100 < breakProbability;
            
            return {
                detected: true,
                streakType,
                streakCount,
                prediction: willBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
                confidence: willBreak ? 55 : 75 + Math.min(10, streakCount),
                reason: willBreak ? `Bẻ cầu bệt ${streakCount} (xác suất thấp)` : `Theo cầu bệt ${streakCount} (xác suất cao)`
            };
        }
        return null;
    }
}

// ==================== AI CHÍNH V6.0 ====================
class TaiXiuAI {
    constructor() {
        this.trendMemory = new TrendMemory();
        this.quantumPredictor = new QuantumPredictor();
        this.trapDetector = new TrapDetector();
        this.adaptationRate = 0.05;
    }
    
    predict(data, type) {
        const results = data.slice(0, 50).map(d => d.Ket_qua);
        const rawResults = [...results];
        
        // Bước 1: Lọc nhiễu
        const filteredResults = this.quantumPredictor.noiseFilter(results);
        
        // Bước 2: Cập nhật xu hướng động
        const currentResult = results[0];
        const trendSignal = this.trendMemory.updateTrend(currentResult);
        const streakType = this.trendMemory.streakType;
        const streakCount = this.trendMemory.streakCount;
        
        // Bước 3: Thu thập các tín hiệu dự đoán
        let predictions = [];
        
        // 3.1: Xu hướng động
        if (trendSignal.hasTrend && trendSignal.direction !== 'alternating') {
            predictions.push({
                prediction: trendSignal.direction,
                confidence: 60 + trendSignal.strength * 15,
                weight: this.quantumPredictor.adaptiveWeights.trend,
                reason: `Trend: ${trendSignal.direction} (sức mạnh ${(trendSignal.strength*100).toFixed(0)}%)`
            });
        }
        
        // 3.2: Xử lý cầu bệt thông minh (KHÔNG BẺ SỚM)
        const longStreakSignal = this.trapDetector.detectLongStreakTrap(streakCount, streakType);
        if (longStreakSignal) {
            predictions.push({
                prediction: longStreakSignal.prediction,
                confidence: longStreakSignal.confidence,
                weight: this.quantumPredictor.adaptiveWeights.pattern * 1.5,
                reason: longStreakSignal.reason
            });
        }
        
        // 3.3: Bẻ cầu giả / thật
        const fakeBreakSignal = this.trapDetector.detectFakeBreak(filteredResults);
        if (fakeBreakSignal) {
            predictions.push({
                prediction: fakeBreakSignal.prediction,
                confidence: fakeBreakSignal.confidence,
                weight: this.quantumPredictor.adaptiveWeights.psychology,
                reason: fakeBreakSignal.message
            });
        }
        
        // 3.4: Anti-Martingale (chống chuỗi thua)
        const antiSignal = this.quantumPredictor.antiMartingaleSignal(results);
        if (antiSignal) {
            predictions.push({
                prediction: antiSignal.prediction,
                confidence: antiSignal.confidence,
                weight: this.quantumPredictor.adaptiveWeights.antiMartingale,
                reason: antiSignal.reason
            });
        }
        
        // 3.5: Vật lý xúc xắc
        const diceSignal = this.quantumPredictor.dicePhysicsAnalysis(data);
        if (diceSignal) {
            predictions.push({
                prediction: diceSignal.prediction,
                confidence: diceSignal.confidence,
                weight: this.quantumPredictor.adaptiveWeights.dicePhysics,
                reason: diceSignal.reason
            });
        }
        
        // 3.6: Pattern cầu truyền thống (đã cân chỉnh)
        const patternSignals = this.analyzePatternsBalanced(results);
        predictions.push(...patternSignals);
        
        // Bước 4: Tổng hợp có trọng số
        let taiScore = 0, xiuScore = 0;
        let totalWeight = 0;
        
        for (const pred of predictions) {
            const weight = pred.weight || 0.1;
            totalWeight += weight;
            if (pred.prediction === 'Tài') {
                taiScore += (pred.confidence / 100) * weight;
            } else {
                xiuScore += (pred.confidence / 100) * weight;
            }
        }
        
        if (totalWeight === 0) {
            return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 55, reasons: ['Fallback'] };
        }
        
        let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
        let confidence = Math.min(89, Math.max(55, Math.abs(taiScore - xiuScore) / totalWeight * 100 + 45));
        
        // Bước 5: Điều chỉnh độ tin cậy dựa trên độ khó của cầu
        const difficulty = this.calculateDifficulty(results);
        confidence = confidence * (1 - difficulty * 0.15);
        
        const reasons = predictions.slice(0, 5).map(p => p.reason);
        
        console.log(`[${type.toUpperCase()}] Streak: ${streakCount}x${streakType} | Diff: ${(difficulty*100).toFixed(0)}% | Pred: ${finalPrediction} (${Math.round(confidence)}%) | Signals: ${predictions.length}`);
        
        return {
            prediction: finalPrediction,
            confidence: Math.round(confidence),
            factors: reasons,
            patternCount: predictions.length
        };
    }
    
    analyzePatternsBalanced(results) {
        const signals = [];
        
        // Cầu đan xen - độ tin cậy thấp hơn
        let alternatingCount = 0;
        for (let i = 0; i < Math.min(results.length - 1, 10); i++) {
            if (results[i] !== results[i+1]) alternatingCount++;
            else break;
        }
        if (alternatingCount >= 4) {
            signals.push({
                prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 55,
                weight: 0.08,
                reason: `Cầu đan xen ${alternatingCount + 1} phiên`
            });
        }
        
        // Cầu 2-2, 3-3 - độ tin cậy trung bình
        if (results.length >= 4 && results[0] === results[1] && results[2] === results[3] && results[0] !== results[2]) {
            signals.push({
                prediction: results[0],
                confidence: 62,
                weight: 0.1,
                reason: 'Cầu 2-2'
            });
        }
        
        if (results.length >= 6 && results[0] === results[1] && results[1] === results[2] &&
            results[3] === results[4] && results[4] === results[5] && results[0] !== results[3]) {
            signals.push({
                prediction: results[0],
                confidence: 65,
                weight: 0.1,
                reason: 'Cầu 3-3'
            });
        }
        
        return signals;
    }
    
    calculateDifficulty(results) {
        // Tính độ khó của cầu (càng khó thì confidence càng giảm)
        if (results.length < 10) return 0.3;
        
        let changes = 0;
        for (let i = 0; i < results.length - 1; i++) {
            if (results[i] !== results[i+1]) changes++;
        }
        const changeRate = changes / (results.length - 1);
        
        // Cầu quá đan xen (gần 50-50) hoặc quá bệt đều là khó
        if (changeRate > 0.7) return 0.7; // cầu rối
        if (changeRate < 0.2) return 0.5; // cầu bệt dài
        
        // Đo entropy
        let taiCount = results.filter(r => r === 'Tài').length;
        let p = taiCount / results.length;
        let entropy = - (p * Math.log2(p + 0.001) + (1-p) * Math.log2(1-p + 0.001));
        
        return Math.min(0.65, entropy / 1.5);
    }
}

// ==================== TÍCH HỢP VÀO HỆ THỐNG CŨ ====================
const ai = new TaiXiuAI();

function calculateAdvancedPrediction(data, type) {
    return ai.predict(data, type);
}

// ==================== EXPRESS ROUTES (giữ nguyên như cũ) ====================
function transformApiData(apiData) {
    if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
    return apiData.list.map(item => ({
        Phien: item.id,
        Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
        Xuc_xac_1: item.dices[0],
        Xuc_xac_2: item.dices[1],
        Xuc_xac_3: item.dices[2],
        Tong: item.point
    }));
}

async function fetchDataHu() {
    try {
        const response = await axios.get(API_URL_HU);
        return transformApiData(response.data);
    } catch (error) {
        console.error('Error fetching HU data:', error.message);
        return null;
    }
}

async function fetchDataMd5() {
    try {
        const response = await axios.get(API_URL_MD5);
        return transformApiData(response.data);
    } catch (error) {
        console.error('Error fetching MD5 data:', error.message);
        return null;
    }
}

function normalizeResult(result) {
    if (result === 'Tài' || result === 'tài') return 'tai';
    if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
    return result.toLowerCase();
}

function savePredictionToHistory(type, phien, prediction, confidence) {
    const record = {
        phien_hien_tai: phien.toString(),
        du_doan: normalizeResult(prediction),
        ti_le: `${confidence}%`,
        id: 'kapub',
        timestamp: new Date().toISOString()
    };
    predictionHistory[type].unshift(record);
    if (predictionHistory[type].length > MAX_HISTORY) {
        predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
    return record;
}

let learningData = { hu: { predictions: [], total: 0, correct: 0 }, md5: { predictions: [], total: 0, correct: 0 } };

function loadLearningData() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            const data = JSON.parse(fs.readFileSync(LEARNING_FILE));
            learningData = { ...learningData, ...data };
            console.log('Learning data loaded');
        }
    } catch(e) {}
}

function saveLearningData() {
    try {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
    } catch(e) {}
}

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE));
            predictionHistory = data.history || { hu: [], md5: [] };
            lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
            console.log('Prediction history loaded');
        }
    } catch(e) {}
}

function savePredictionHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({
            history: predictionHistory,
            lastProcessedPhien
        }, null, 2));
    } catch(e) {}
}

function recordPrediction(type, phien, prediction, confidence, factors) {
    learningData[type].predictions.unshift({
        phien: phien.toString(),
        prediction,
        confidence,
        factors,
        timestamp: new Date().toISOString(),
        verified: false
    });
    learningData[type].total++;
    if (learningData[type].predictions.length > 500) {
        learningData[type].predictions = learningData[type].predictions.slice(0, 500);
    }
    saveLearningData();
}

async function verifyPredictions(type, currentData) {
    let updated = false;
    for (const pred of learningData[type].predictions) {
        if (pred.verified) continue;
        const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
        if (actualResult) {
            pred.verified = true;
            pred.actual = actualResult.Ket_qua;
            pred.isCorrect = pred.prediction === pred.actual;
            if (pred.isCorrect) learningData[type].correct++;
            updated = true;
            
            const historyEntry = predictionHistory[type].find(h => h.phien_hien_tai === pred.phien);
            if (historyEntry) {
                historyEntry.ket_qua_thuc_te = pred.actual;
                historyEntry.status = pred.isCorrect ? '✅' : '❌';
            }
        }
    }
    if (updated) {
        saveLearningData();
        savePredictionHistory();
    }
}

async function autoProcessPredictions() {
    try {
        const dataHu = await fetchDataHu();
        if (dataHu && dataHu.length > 0) {
            const latestHuPhien = dataHu[0].Phien;
            const nextHuPhien = latestHuPhien + 1;
            if (lastProcessedPhien.hu !== nextHuPhien) {
                await verifyPredictions('hu', dataHu);
                const result = calculateAdvancedPrediction(dataHu, 'hu');
                savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
                recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
                lastProcessedPhien.hu = nextHuPhien;
                
                const accuracy = learningData.hu.total > 0 ? 
                    (learningData.hu.correct / learningData.hu.total * 100).toFixed(1) : 0;
                console.log(`[HU] ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | Acc: ${accuracy}%`);
            }
        }
        
        const dataMd5 = await fetchDataMd5();
        if (dataMd5 && dataMd5.length > 0) {
            const latestMd5Phien = dataMd5[0].Phien;
            const nextMd5Phien = latestMd5Phien + 1;
            if (lastProcessedPhien.md5 !== nextMd5Phien) {
                await verifyPredictions('md5', dataMd5);
                const result = calculateAdvancedPrediction(dataMd5, 'md5');
                savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
                recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
                lastProcessedPhien.md5 = nextMd5Phien;
                
                const accuracy = learningData.md5.total > 0 ? 
                    (learningData.md5.correct / learningData.md5.total * 100).toFixed(1) : 0;
                console.log(`[MD5] ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | Acc: ${accuracy}%`);
            }
        }
        
        savePredictionHistory();
    } catch (error) {
        console.error('[Auto] Error:', error.message);
    }
}

// Routes (giữ nguyên)
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('Lau Cua 79 - Tai Xiu Prediction API v6.0 - Fixed Long Streak Issue');
});

app.get('/lc79-hu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        await verifyPredictions('hu', data);
        const latestPhien = data[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = calculateAdvancedPrediction(data, 'hu');
        savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
        res.json({
            phien_hien_tai: nextPhien.toString(),
            du_doan: normalizeResult(result.prediction),
            ti_le: `${result.confidence}%`,
            id: 'kapub'
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        await verifyPredictions('md5', data);
        const latestPhien = data[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = calculateAdvancedPrediction(data, 'md5');
        savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
        recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
        res.json({
            phien_hien_tai: nextPhien.toString(),
            du_doan: normalizeResult(result.prediction),
            ti_le: `${result.confidence}%`,
            id: 'kapub'
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (data) await verifyPredictions('hu', data);
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
    } catch (error) {
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
    }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (data) await verifyPredictions('md5', data);
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
    } catch (error) {
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
    }
});

app.get('/lc79-hu/analysis', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        await verifyPredictions('hu', data);
        const result = calculateAdvancedPrediction(data, 'hu');
        res.json({
            prediction: normalizeResult(result.prediction),
            confidence: result.confidence,
            factors: result.factors,
            patternCount: result.patternCount,
            learningStats: {
                total: learningData.hu.total,
                correct: learningData.hu.correct,
                accuracy: learningData.hu.total > 0 ? (learningData.hu.correct / learningData.hu.total * 100).toFixed(1) + '%' : 'N/A'
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-md5/analysis', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        await verifyPredictions('md5', data);
        const result = calculateAdvancedPrediction(data, 'md5');
        res.json({
            prediction: normalizeResult(result.prediction),
            confidence: result.confidence,
            factors: result.factors,
            patternCount: result.patternCount,
            learningStats: {
                total: learningData.md5.total,
                correct: learningData.md5.correct,
                accuracy: learningData.md5.total > 0 ? (learningData.md5.correct / learningData.md5.total * 100).toFixed(1) + '%' : 'N/A'
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/reset-learning', (req, res) => {
    learningData = { hu: { predictions: [], total: 0, correct: 0 }, md5: { predictions: [], total: 0, correct: 0 } };
    predictionHistory = { hu: [], md5: [] };
    lastProcessedPhien = { hu: null, md5: null };
    saveLearningData();
    savePredictionHistory();
    res.json({ message: 'Reset thành công!' });
});

// ==================== START SERVER ====================
loadLearningData();
loadPredictionHistory();

setInterval(() => autoProcessPredictions(), 15000);
setTimeout(() => autoProcessPredictions(), 3000);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔═══════════════════════════════════════════════════════════════════════╗`);
    console.log(`║     LẨU CUA 79 - TÀI XỈU AI v6.0 - FIXED LONG STREAK             ║`);
    console.log(`╚═══════════════════════════════════════════════════════════════════════╝\n`);
    console.log(`✅ FIX LỖI CHÍNH: Không bẻ cầu bệt sớm (từ phiên thứ 5 trở đi)`);
    console.log(`✅ THÊM BỘ NHỚ XU HƯỚNG ĐỘNG - breakResistance tăng dần theo streak`);
    console.log(`✅ THÊM LỌC NHIỄU - tránh overfitting cầu ảo đan xen`);
    console.log(`✅ THÊM ANTI-MARTINGALE - xử lý chuỗi thua liên tiếp`);
    console.log(`✅ THÊM VẬT LÝ XÚC XẮC - phân tích xu hướng tổng điểm\n`);
    console.log(`📡 Server: http://0.0.0.0:${PORT}\n`);
});
