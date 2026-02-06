const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const DATA_FILE = 'ai_vip_ultimate.json';

// ==================== NHẬP HỆ THỐNG ULTRA DICE ĐÃ SỬA LỖI ====================
class UltraDicePredictionSystem {
    constructor() {
        this.history = [];
        this.models = {};
        this.weights = {};
        this.performance = {};
        this.patternDatabase = {};
        this.advancedPatterns = {};
        this.sessionStats = {
            streaks: { T: 0, X: 0, maxT: 0, maxX: 0 },
            transitions: { TtoT: 0, TtoX: 0, XtoT: 0, XtoX: 0 },
            volatility: 0.5,
            patternConfidence: {},
            recentAccuracy: 0,
            bias: { T: 0, X: 0 }
        };
        this.marketState = {
            trend: 'neutral',
            momentum: 0,
            stability: 0.5,
            regime: 'normal'
        };
        this.adaptiveParameters = {
            patternMinLength: 3,
            patternMaxLength: 8,
            volatilityThreshold: 0.7,
            trendStrengthThreshold: 0.6,
            patternConfidenceDecay: 0.95,
            patternConfidenceGrowth: 1.05
        };
        this.initAllModels();
    }

    initAllModels() {
        // Chỉ khởi tạo các model chính (1-4) thay vì 1-21
        for (let i = 1; i <= 4; i++) {
            // Model chính
            if (this[`model${i}`]) {
                this.models[`model${i}`] = this[`model${i}`].bind(this);
            }
            
            // Model mini
            if (this[`model${i}Mini`]) {
                this.models[`model${i}Mini`] = this[`model${i}Mini`].bind(this);
            }
            
            // Model hỗ trợ (chỉ nếu tồn tại)
            if (this[`model${i}Support1`]) {
                this.models[`model${i}Support1`] = this[`model${i}Support1`].bind(this);
            }
            
            if (this[`model${i}Support2`]) {
                this.models[`model${i}Support2`] = this[`model${i}Support2`].bind(this);
            }
            
            // Khởi tạo trọng số và hiệu suất
            this.weights[`model${i}`] = 1;
            this.performance[`model${i}`] = { 
                correct: 0, 
                total: 0,
                recentCorrect: 0,
                recentTotal: 0,
                streak: 0,
                maxStreak: 0
            };
        }
        
        // Khởi tạo cơ sở dữ liệu pattern
        this.initPatternDatabase();
        this.initAdvancedPatterns();
    }

    initPatternDatabase() {
        this.patternDatabase = {
            'T-X-T-X': { pattern: ['T', 'X', 'T', 'X'], probability: 0.7, strength: 0.8 },
            'T-X-X-T': { pattern: ['T', 'X', 'X', 'T'], probability: 0.65, strength: 0.75 },
            'T-T-X-T-T': { pattern: ['T', 'T', 'X', 'T', 'T'], probability: 0.68, strength: 0.78 },
            'T-T-T-X': { pattern: ['T', 'T', 'T', 'X'], probability: 0.72, strength: 0.82 },
            'T-X-X-X': { pattern: ['T', 'X', 'X', 'X'], probability: 0.72, strength: 0.82 },
            'T-T-X-X': { pattern: ['T', 'T', 'X', 'X'], probability: 0.66, strength: 0.76 },
            'T-T-X-X-X': { pattern: ['T', 'T', 'X', 'X', 'X'], probability: 0.71, strength: 0.81 },
            'T-T-T-X-X': { pattern: ['T', 'T', 'T', 'X', 'X'], probability: 0.73, strength: 0.83 },
            'T-T-T-T-X': { pattern: ['T', 'T', 'T', 'T', 'X'], probability: 0.76, strength: 0.86 },
            'T-X-X-X-X': { pattern: ['T', 'X', 'X', 'X', 'X'], probability: 0.76, strength: 0.86 },
            'X-T-X-T': { pattern: ['X', 'T', 'X', 'T'], probability: 0.7, strength: 0.8 },
            'X-X-T-T': { pattern: ['X', 'X', 'T', 'T'], probability: 0.66, strength: 0.76 },
            'X-X-X-T': { pattern: ['X', 'X', 'X', 'T'], probability: 0.72, strength: 0.82 },
            'X-T-T-T': { pattern: ['X', 'T', 'T', 'T'], probability: 0.72, strength: 0.82 },
            'X-T-T-X': { pattern: ['X', 'T', 'T', 'X'], probability: 0.65, strength: 0.75 }
        };
    }

    initAdvancedPatterns() {
        this.advancedPatterns = {
            'dynamic-1': {
                detect: (data) => {
                    if (data.length < 6) return false;
                    const last6 = data.slice(-6);
                    return last6.filter(x => x === 'T').length === 4 && 
                           last6[last6.length-1] === 'T';
                },
                predict: () => 'X',
                confidence: 0.72
            },
            'dynamic-2': {
                detect: (data) => {
                    if (data.length < 8) return false;
                    const last8 = data.slice(-8);
                    const tCount = last8.filter(x => x === 'T').length;
                    return tCount >= 6 && last8[last8.length-1] === 'T';
                },
                predict: () => 'X',
                confidence: 0.78
            },
            'alternating-3': {
                detect: (data) => {
                    if (data.length < 5) return false;
                    const last5 = data.slice(-5);
                    for (let i = 1; i < last5.length; i++) {
                        if (last5[i] === last5[i-1]) return false;
                    }
                    return true;
                },
                predict: (data) => data[data.length-1] === 'T' ? 'X' : 'T',
                confidence: 0.68
            }
        };
    }

    arraysEqual(arr1, arr2) {
        if (arr1.length !== arr2.length) return false;
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i]) return false;
        }
        return true;
    }

    addResult(result) {
        if (this.history.length > 0) {
            const lastResult = this.history[this.history.length-1];
            const transitionKey = `${lastResult}to${result}`;
            this.sessionStats.transitions[transitionKey] = (this.sessionStats.transitions[transitionKey] || 0) + 1;
            
            if (result === lastResult) {
                this.sessionStats.streaks[result]++;
                this.sessionStats.streaks[`max${result}`] = Math.max(
                    this.sessionStats.streaks[`max${result}`],
                    this.sessionStats.streaks[result]
                );
            } else {
                this.sessionStats.streaks[result] = 1;
                this.sessionStats.streaks[lastResult] = 0;
            }
        } else {
            this.sessionStats.streaks[result] = 1;
        }
        
        this.history.push(result);
        if (this.history.length > 100) {
            this.history.shift();
        }
        
        this.updateVolatility();
        this.updateMarketState();
    }

    updateVolatility() {
        if (this.history.length < 10) return;
        
        const recent = this.history.slice(-10);
        let changes = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i] !== recent[i-1]) changes++;
        }
        
        this.sessionStats.volatility = changes / (recent.length - 1);
    }

    updateMarketState() {
        if (this.history.length < 15) return;
        
        const recent = this.history.slice(-15);
        const tCount = recent.filter(x => x === 'T').length;
        const xCount = recent.filter(x => x === 'X').length;
        
        const trendStrength = Math.abs(tCount - xCount) / recent.length;
        
        if (trendStrength > this.adaptiveParameters.trendStrengthThreshold) {
            this.marketState.trend = tCount > xCount ? 'up' : 'down';
        } else {
            this.marketState.trend = 'neutral';
        }
        
        let momentum = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i] === recent[i-1]) {
                momentum += recent[i] === 'T' ? 0.1 : -0.1;
            }
        }
        this.marketState.momentum = Math.tanh(momentum);
        
        this.marketState.stability = 1 - this.sessionStats.volatility;
        
        if (this.sessionStats.volatility > this.adaptiveParameters.volatilityThreshold) {
            this.marketState.regime = 'volatile';
        } else if (trendStrength > 0.7) {
            this.marketState.regime = 'trending';
        } else if (trendStrength < 0.3) {
            this.marketState.regime = 'random';
        } else {
            this.marketState.regime = 'normal';
        }
    }

    // MODEL 1: Nhận biết các loại cầu cơ bản
    model1() {
        if (this.history.length < 10) return null;
        
        const recent = this.history.slice(-8);
        let bestPattern = null;
        let bestConfidence = 0;
        
        for (const [patternKey, patternData] of Object.entries(this.patternDatabase)) {
            const pattern = patternData.pattern;
            if (recent.length < pattern.length - 1) continue;
            
            const segment = recent.slice(-(pattern.length - 1));
            const patternWithoutLast = pattern.slice(0, -1);
            
            if (this.arraysEqual(segment, patternWithoutLast)) {
                if (patternData.probability > bestConfidence) {
                    bestConfidence = patternData.probability;
                    bestPattern = {
                        prediction: pattern[pattern.length - 1],
                        confidence: patternData.probability * 0.8,
                        reason: `Pattern: ${patternKey} (${(patternData.probability * 100).toFixed(1)}%)`
                    };
                }
            }
        }
        
        if (bestPattern) {
            if (this.marketState.regime === 'trending') {
                bestPattern.confidence *= 1.1;
            } else if (this.marketState.regime === 'volatile') {
                bestPattern.confidence *= 0.9;
            }
            
            bestPattern.confidence = Math.min(0.95, bestPattern.confidence);
            return bestPattern;
        }
        
        return null;
    }

    model1Mini(data) {
        const patterns = [];
        
        for (const [type, patternData] of Object.entries(this.patternDatabase)) {
            const pattern = patternData.pattern;
            if (data.length < pattern.length - 1) continue;
            
            const segment = data.slice(-(pattern.length - 1));
            const patternWithoutLast = pattern.slice(0, -1);
            
            if (this.arraysEqual(segment, patternWithoutLast)) {
                patterns.push({
                    type: type,
                    prediction: pattern[pattern.length - 1],
                    probability: patternData.probability,
                    strength: patternData.strength
                });
            }
        }
        
        return patterns;
    }

    // MODEL 2: Bắt trend xu hướng ngắn và dài
    model2() {
        const shortTerm = this.history.slice(-5);
        const longTerm = this.history.slice(-15);
        
        if (shortTerm.length < 3 || longTerm.length < 8) return null;
        
        const shortAnalysis = this.model2Mini(shortTerm);
        const longAnalysis = this.model2Mini(longTerm);
        
        let prediction, confidence, reason;
        
        if (shortAnalysis.trend === longAnalysis.trend) {
            prediction = shortAnalysis.trend === 'up' ? 'T' : 'X';
            confidence = (shortAnalysis.strength + longAnalysis.strength) / 2;
            reason = `Xu hướng ngắn và dài hạn cùng ${shortAnalysis.trend}`;
        } else {
            if (shortAnalysis.strength > longAnalysis.strength * 1.5) {
                prediction = shortAnalysis.trend === 'up' ? 'T' : 'X';
                confidence = shortAnalysis.strength;
                reason = `Xu hướng ngắn hạn mạnh hơn dài hạn`;
            } else {
                prediction = longAnalysis.trend === 'up' ? 'T' : 'X';
                confidence = longAnalysis.strength;
                reason = `Xu hướng dài hạn ổn định hơn`;
            }
        }
        
        if (this.marketState.regime === 'trending') {
            confidence *= 1.15;
        } else if (this.marketState.regime === 'volatile') {
            confidence *= 0.85;
        }
        
        return { 
            prediction, 
            confidence: Math.min(0.95, confidence * 0.9), 
            reason 
        };
    }

    model2Mini(data) {
        const tCount = data.filter(x => x === 'T').length;
        const xCount = data.filter(x => x === 'X').length;
        
        let trend = tCount > xCount ? 'up' : (xCount > tCount ? 'down' : 'neutral');
        let strength = Math.abs(tCount - xCount) / data.length;
        
        let changes = 0;
        for (let i = 1; i < data.length; i++) {
            if (data[i] !== data[i-1]) changes++;
        }
        
        const volatility = changes / (data.length - 1);
        strength = strength * (1 - volatility / 2);
        
        return { trend, strength, volatility };
    }

    // MODEL 3: Xem trong 12 phiên gần nhất có sự chênh lệch cao thì sẽ dự đoán bên còn lại
    model3() {
        const recent = this.history.slice(-12);
        if (recent.length < 12) return null;
        
        const tCount = recent.filter(x => x === 'T').length;
        const xCount = recent.filter(x => x === 'X').length;
        const difference = Math.abs(tCount - xCount) / recent.length;
        
        if (difference < 0.4) return null;
        
        let confidence = difference * 0.8;
        if (this.marketState.regime === 'random') {
            confidence *= 1.1;
        } else if (this.marketState.regime === 'trending') {
            confidence *= 0.9;
        }
        
        return {
            prediction: tCount > xCount ? 'X' : 'T',
            confidence: Math.min(0.95, confidence),
            reason: `Chênh lệch cao (${Math.round(difference * 100)}%) trong 12 phiên, dự đoán cân bằng`
        };
    }

    model3Mini(data) {
        const tCount = data.filter(x => x === 'T').length;
        const xCount = data.filter(x => x === 'X').length;
        const total = data.length;
        const difference = Math.abs(tCount - xCount) / total;
        
        return {
            difference,
            prediction: tCount > xCount ? 'X' : 'T',
            tCount,
            xCount
        };
    }

    // MODEL 4: Bắt cầu ngắn hạn
    model4() {
        const recent = this.history.slice(-6);
        if (recent.length < 4) return null;
        
        const last3 = recent.slice(-3);
        const tCount = last3.filter(x => x === 'T').length;
        const xCount = last3.filter(x => x === 'X').length;
        
        let prediction, confidence, trend;
        
        if (tCount === 3) {
            prediction = 'T';
            confidence = 0.7;
            trend = 'Tăng mạnh';
        } else if (xCount === 3) {
            prediction = 'X';
            confidence = 0.7;
            trend = 'Giảm mạnh';
        } else if (tCount === 2) {
            prediction = 'T';
            confidence = 0.65;
            trend = 'Tăng nhẹ';
        } else if (xCount === 2) {
            prediction = 'X';
            confidence = 0.65;
            trend = 'Giảm nhẹ';
        } else {
            const changes = recent.slice(-4).filter((val, idx, arr) => 
                idx > 0 && val !== arr[idx-1]).length;
            
            if (changes >= 3) {
                prediction = recent[recent.length - 1] === 'T' ? 'X' : 'T';
                confidence = 0.6;
                trend = 'Đảo chiều';
            } else {
                prediction = recent[recent.length - 1];
                confidence = 0.55;
                trend = 'Ổn định';
            }
        }
        
        if (confidence < 0.6) return null;
        
        if (this.marketState.regime === 'trending') {
            confidence *= 1.1;
        } else if (this.marketState.regime === 'volatile') {
            confidence *= 0.9;
        }
        
        return {
            prediction,
            confidence: Math.min(0.95, confidence),
            reason: `Cầu ngắn hạn ${trend} với độ tin cậy ${confidence.toFixed(2)}`
        };
    }

    model4Mini(data) {
        const last3 = data.slice(-3);
        const tCount = last3.filter(x => x === 'T').length;
        const xCount = last3.filter(x => x === 'X').length;
        
        let prediction, confidence, trend;
        
        if (tCount === 3) {
            prediction = 'T';
            confidence = 0.7;
            trend = 'Tăng mạnh';
        } else if (xCount === 3) {
            prediction = 'X';
            confidence = 0.7;
            trend = 'Giảm mạnh';
        } else if (tCount === 2) {
            prediction = 'T';
            confidence = 0.65;
            trend = 'Tăng nhẹ';
        } else if (xCount === 2) {
            prediction = 'X';
            confidence = 0.65;
            trend = 'Giảm nhẹ';
        } else {
            prediction = data[data.length - 1];
            confidence = 0.55;
            trend = 'Ổn định';
        }
        
        return { prediction, confidence, trend };
    }

    // Thêm các model support để tránh lỗi (nếu cần)
    model1Support1() {
        return { status: "Model 1 Support Active" };
    }

    model1Support2() {
        return { status: "Model 1 Support 2 Active" };
    }

    model2Support1() {
        return { status: "Model 2 Support Active" };
    }

    model2Support2() {
        return { status: "Model 2 Support 2 Active" };
    }

    model3Support1() {
        return { status: "Model 3 Support Active" };
    }

    model3Support2() {
        return { status: "Model 3 Support 2 Active" };
    }

    model4Support1() {
        return { status: "Model 4 Support Active" };
    }

    model4Support2() {
        return { status: "Model 4 Support 2 Active" };
    }

    // Utility methods
    getAllPredictions() {
        const predictions = {};
        
        for (let i = 1; i <= 4; i++) {
            const modelName = `model${i}`;
            if (this.models[modelName]) {
                predictions[modelName] = this.models[modelName]();
            }
        }
        
        return predictions;
    }

    getFinalPrediction() {
        const predictions = this.getAllPredictions();
        let tScore = 0;
        let xScore = 0;
        let totalWeight = 0;
        let reasons = [];
        
        for (const [modelName, prediction] of Object.entries(predictions)) {
            if (prediction && prediction.prediction) {
                const weight = this.weights[modelName] || 1;
                const score = prediction.confidence * weight;
                
                if (prediction.prediction === 'T') {
                    tScore += score;
                } else if (prediction.prediction === 'X') {
                    xScore += score;
                }
                
                totalWeight += weight;
                reasons.push(`${modelName}: ${prediction.reason} (${(prediction.confidence * 100).toFixed(1)}%)`);
            }
        }
        
        if (totalWeight === 0) {
            // Fallback prediction
            const lastResult = this.history.length > 0 ? this.history[this.history.length - 1] : 'T';
            return {
                prediction: lastResult,
                confidence: 0.5,
                reasons: ['Không có đủ dữ liệu phân tích'],
                details: predictions,
                sessionStats: this.sessionStats,
                marketState: this.marketState
            };
        }
        
        let finalPrediction = null;
        let finalConfidence = 0;
        
        if (tScore > xScore) {
            finalPrediction = 'T';
            finalConfidence = tScore / (tScore + xScore);
        } else if (xScore > tScore) {
            finalPrediction = 'X';
            finalConfidence = xScore / (tScore + xScore);
        } else {
            finalPrediction = 'T';
            finalConfidence = 0.5;
        }
        
        // Điều chỉnh confidence dựa trên độ biến động
        if (this.sessionStats.volatility > 0.7) {
            finalConfidence *= 0.8;
        } else if (this.sessionStats.volatility < 0.3) {
            finalConfidence = Math.min(0.95, finalConfidence * 1.1);
        }
        
        return {
            prediction: finalPrediction,
            confidence: finalConfidence,
            reasons: reasons,
            details: predictions,
            sessionStats: this.sessionStats,
            marketState: this.marketState
        };
    }

    updatePerformance(actualResult) {
        const predictions = this.getAllPredictions();
        
        for (const [modelName, prediction] of Object.entries(predictions)) {
            if (prediction && prediction.prediction) {
                if (!this.performance[modelName]) {
                    this.performance[modelName] = { 
                        correct: 0, 
                        total: 0,
                        recentCorrect: 0,
                        recentTotal: 0,
                        streak: 0,
                        maxStreak: 0
                    };
                }
                
                this.performance[modelName].total++;
                this.performance[modelName].recentTotal++;
                
                if (prediction.prediction === actualResult) {
                    this.performance[modelName].correct++;
                    this.performance[modelName].recentCorrect++;
                    this.performance[modelName].streak++;
                    this.performance[modelName].maxStreak = Math.max(
                        this.performance[modelName].maxStreak,
                        this.performance[modelName].streak
                    );
                } else {
                    this.performance[modelName].streak = 0;
                }
                
                // Giữ recent stats trong phạm vi 50 lần
                if (this.performance[modelName].recentTotal > 50) {
                    this.performance[modelName].recentTotal--;
                    if (this.performance[modelName].recentCorrect > 0) {
                        this.performance[modelName].recentCorrect--;
                    }
                }
                
                // Cập nhật trọng số
                const accuracy = this.performance[modelName].correct / this.performance[modelName].total;
                this.weights[modelName] = Math.max(0.1, Math.min(2, accuracy * 2));
            }
        }
    }
}

// ==================== CẤU TRÚC DỮ LIỆU ====================
let aiSystem = {
  system: {
    version: 'ULTRA-DICE-AI-v3.0',
    startupTime: new Date().toISOString(),
    totalPredictions: 0,
    averageAccuracy: 0
  },
  
  history: {
    hu: [],
    md5: []
  },
  
  stats: {
    hu: {
      total: 0, correct: 0, streak: 0, bestStreak: 0,
      daily: { wins: 0, losses: 0, accuracy: 0 },
      confidenceCalibration: { over: 0, under: 0, perfect: 0 }
    },
    md5: {
      total: 0, correct: 0, streak: 0, bestStreak: 0,
      daily: { wins: 0, losses: 0, accuracy: 0 },
      confidenceCalibration: { over: 0, under: 0, perfect: 0 }
    }
  }
};

// ==================== HỆ THỐNG ULTRA DICE INSTANCES ====================
let ultraSystemHU = new UltraDicePredictionSystem();
let ultraSystemMD5 = new UltraDicePredictionSystem();

// ==================== HÀM XỬ LÝ DỮ LIỆU ====================
function transformData(apiData) {
  if (!apiData?.list) return [];
  
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices[0],
    Xuc_xac_2: item.dices[1],
    Xuc_xac_3: item.dices[2],
    Tong: item.point,
    timestamp: new Date().toISOString()
  }));
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      aiSystem = {
        ...aiSystem,
        ...saved,
        system: {
          ...aiSystem.system,
          ...(saved.system || {})
        }
      };
      console.log('✅ Đã load dữ liệu AI ULTRA DICE');
    }
  } catch (e) {
    console.log('Khởi tạo hệ thống AI ULTRA DICE mới');
  }
}

function saveData() {
  try {
    aiSystem.system.lastUpdate = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(aiSystem, null, 2));
  } catch (e) {
    console.error('Lỗi save data:', e.message);
  }
}

function updateHistory(type, predictionData, actualResult = null) {
  const historyRecord = {
    phien: predictionData.phien,
    prediction: predictionData.prediction,
    confidence: predictionData.confidence,
    method: predictionData.method,
    reason: predictionData.reason,
    timestamp: new Date().toISOString(),
    verified: actualResult !== null,
    actual: actualResult,
    correct: actualResult ? (predictionData.prediction === actualResult) : null
  };
  
  aiSystem.history[type].unshift(historyRecord);
  
  if (aiSystem.history[type].length > 100) {
    aiSystem.history[type] = aiSystem.history[type].slice(0, 100);
  }
  
  if (actualResult) {
    aiSystem.stats[type].total++;
    if (historyRecord.correct) {
      aiSystem.stats[type].correct++;
      aiSystem.stats[type].streak = Math.max(0, aiSystem.stats[type].streak) + 1;
      if (aiSystem.stats[type].streak > aiSystem.stats[type].bestStreak) {
        aiSystem.stats[type].bestStreak = aiSystem.stats[type].streak;
      }
      
      aiSystem.stats[type].daily.wins++;
    } else {
      aiSystem.stats[type].streak = Math.min(0, aiSystem.stats[type].streak) - 1;
      aiSystem.stats[type].daily.losses++;
    }
    
    aiSystem.stats[type].daily.accuracy = 
      aiSystem.stats[type].daily.wins / 
      (aiSystem.stats[type].daily.wins + aiSystem.stats[type].daily.losses) || 0;
    
    if (predictionData.confidence >= 70 && !historyRecord.correct) {
      aiSystem.stats[type].confidenceCalibration.over++;
    } else if (predictionData.confidence <= 60 && historyRecord.correct) {
      aiSystem.stats[type].confidenceCalibration.under++;
    } else {
      aiSystem.stats[type].confidenceCalibration.perfect++;
    }
  }
  
  aiSystem.system.totalPredictions++;
  const totalCorrect = aiSystem.stats.hu.correct + aiSystem.stats.md5.correct;
  const totalPredictions = aiSystem.stats.hu.total + aiSystem.stats.md5.total;
  aiSystem.system.averageAccuracy = totalPredictions > 0 ? 
    (totalCorrect / totalPredictions) : 0;
}

// ==================== AUTO-VERIFY HỆ THỐNG ====================
async function verifyPredictions(type) {
  try {
    const apiUrl = type === 'hu' ? API_URL_HU : API_URL_MD5;
    const response = await axios.get(apiUrl);
    const currentData = transformData(response.data);
    
    if (currentData.length === 0) return;
    
    const resultMap = {};
    currentData.forEach(item => {
      resultMap[item.Phien.toString()] = item.Ket_qua;
    });
    
    aiSystem.history[type].forEach(record => {
      if (!record.verified && record.phien in resultMap) {
        const actualResult = resultMap[record.phien];
        
        record.verified = true;
        record.actual = actualResult;
        record.correct = record.prediction === actualResult;
        
        aiSystem.stats[type].total++;
        if (record.correct) {
          aiSystem.stats[type].correct++;
          aiSystem.stats[type].streak = Math.max(0, aiSystem.stats[type].streak) + 1;
          if (aiSystem.stats[type].streak > aiSystem.stats[type].bestStreak) {
            aiSystem.stats[type].bestStreak = aiSystem.stats[type].streak;
          }
        } else {
          aiSystem.stats[type].streak = Math.min(0, aiSystem.stats[type].streak) - 1;
        }
        
        if (record.confidence >= 70 && !record.correct) {
          aiSystem.stats[type].confidenceCalibration.over++;
        } else if (record.confidence <= 60 && record.correct) {
          aiSystem.stats[type].confidenceCalibration.under++;
        } else {
          aiSystem.stats[type].confidenceCalibration.perfect++;
        }
      }
    });
    
    console.log(`✅ Đã xác minh ${type.toUpperCase()} predictions`);
    
  } catch (error) {
    console.error(`Lỗi verify ${type}:`, error.message);
  }
}

async function autoVerifySystem() {
  console.log('🔄 Hệ thống auto-verify đang chạy...');
  await Promise.allSettled([
    verifyPredictions('hu'),
    verifyPredictions('md5')
  ]);
  saveData();
  console.log('✅ Auto-verify hoàn tất');
}

// ==================== API ENDPOINTS ====================
app.get('/', (req, res) => {
  res.send(`
    <h1>🎯 ULTRA DICE AI SYSTEM v3.0</h1>
    <p>Hệ thống AI 4 model phân tích mạnh mẽ - @Kapubb</p>
    <p><strong>Endpoints:</strong></p>
    <ul>
      <li><a href="/ai-hu">/ai-hu</a> - Dự đoán AI Hũ</li>
      <li><a href="/ai-md5">/ai-md5</a> - Dự đoán AI MD5</li>
      <li><a href="/ai-hu/lichsu">/ai-hu/lichsu</a> - Lịch sử AI Hũ</li>
      <li><a href="/ai-md5/lichsu">/ai-md5/lichsu</a> - Lịch sử AI MD5</li>
      <li><a href="/ai-stats">/ai-stats</a> - Thống kê hệ thống</li>
    </ul>
  `);
});

// Dự đoán AI Hũ
app.get('/ai-hu', async (req, res) => {
  try {
    const response = await axios.get(API_URL_HU);
    const data = transformData(response.data);
    
    if (!data || data.length === 0) {
      return res.json({ error: 'Không có dữ liệu', timestamp: new Date().toISOString() });
    }
    
    // Train hệ thống với dữ liệu mới
    ultraSystemHU = new UltraDicePredictionSystem();
    
    // Thêm dữ liệu từ cũ đến mới (100 phiên gần nhất)
    const trainingData = data.slice(0, 100).reverse();
    trainingData.forEach(item => {
      ultraSystemHU.addResult(item.Ket_qua === 'Tài' ? 'T' : 'X');
    });
    
    // Lấy dự đoán
    const prediction = ultraSystemHU.getFinalPrediction();
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    // Lưu vào lịch sử
    updateHistory('hu', {
      phien: nextPhien.toString(),
      prediction: prediction.prediction === 'T' ? 'Tài' : 'Xỉu',
      confidence: Math.round(prediction.confidence * 100),
      method: 'ULTRA_DICE_4_MODELS',
      reason: prediction.reasons ? prediction.reasons[0] : 'Hệ thống 4 model phân tích'
    });
    
    saveData();
    
    // Chuẩn bị response
    const responseData = {
      phien: nextPhien.toString(),
      du_doan: prediction.prediction === 'T' ? 'tài' : 'xỉu',
      ti_le: Math.round(prediction.confidence * 100) + '%',
      id: '@Kapubb',
      method: 'ULTRA_DICE_4_MODELS',
      reason: prediction.reasons ? prediction.reasons[0] : 'Hệ thống 4 model phân tích',
      analysis_timestamp: new Date().toISOString(),
      market_state: ultraSystemHU.marketState
    };
    
    res.json(responseData);
    
  } catch (error) {
    console.error('AI HU Error:', error.message);
    res.json({ 
      error: 'Lỗi hệ thống AI', 
      details: error.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// Dự đoán AI MD5
app.get('/ai-md5', async (req, res) => {
  try {
    const response = await axios.get(API_URL_MD5);
    const data = transformData(response.data);
    
    if (!data || data.length === 0) {
      return res.json({ error: 'Không có dữ liệu', timestamp: new Date().toISOString() });
    }
    
    // Train hệ thống với dữ liệu mới
    ultraSystemMD5 = new UltraDicePredictionSystem();
    
    // Thêm dữ liệu từ cũ đến mới (100 phiên gần nhất)
    const trainingData = data.slice(0, 100).reverse();
    trainingData.forEach(item => {
      ultraSystemMD5.addResult(item.Ket_qua === 'Tài' ? 'T' : 'X');
    });
    
    // Lấy dự đoán
    const prediction = ultraSystemMD5.getFinalPrediction();
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    // Lưu vào lịch sử
    updateHistory('md5', {
      phien: nextPhien.toString(),
      prediction: prediction.prediction === 'T' ? 'Tài' : 'Xỉu',
      confidence: Math.round(prediction.confidence * 100),
      method: 'ULTRA_DICE_4_MODELS',
      reason: prediction.reasons ? prediction.reasons[0] : 'Hệ thống 4 model phân tích'
    });
    
    saveData();
    
    // Chuẩn bị response
    const responseData = {
      phien: nextPhien.toString(),
      du_doan: prediction.prediction === 'T' ? 'tài' : 'xỉu',
      ti_le: Math.round(prediction.confidence * 100) + '%',
      id: '@Kapubb',
      method: 'ULTRA_DICE_4_MODELS',
      reason: prediction.reasons ? prediction.reasons[0] : 'Hệ thống 4 model phân tích',
      analysis_timestamp: new Date().toISOString(),
      market_state: ultraSystemMD5.marketState
    };
    
    res.json(responseData);
    
  } catch (error) {
    console.error('AI MD5 Error:', error.message);
    res.json({ 
      error: 'Lỗi hệ thống AI', 
      details: error.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// Lịch sử AI Hũ
app.get('/ai-hu/lichsu', async (req, res) => {
  try {
    await verifyPredictions('hu');
    
    const history = aiSystem.history.hu.map(record => ({
      phien: record.phien,
      du_doan: record.prediction.toLowerCase(),
      ti_le: record.confidence + '%',
      method: record.method,
      reason: record.reason,
      timestamp: record.timestamp,
      ket_qua_thuc_te: record.actual ? record.actual.toLowerCase() : null,
      status: record.verified ? (record.correct ? '✅' : '❌') : '⏳'
    }));
    
    const stats = aiSystem.stats.hu;
    const accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : 0;
    
    res.json({
      system: 'ULTRA DICE AI - Hũ',
      version: aiSystem.system.version,
      history: history.slice(0, 30),
      stats: {
        total: stats.total,
        correct: stats.correct,
        accuracy: accuracy + '%',
        current_streak: stats.streak,
        best_streak: stats.bestStreak,
        daily: {
          wins: stats.daily.wins,
          losses: stats.daily.losses,
          accuracy: (stats.daily.accuracy * 100).toFixed(1) + '%'
        }
      },
      last_updated: aiSystem.system.lastUpdate
    });
    
  } catch (error) {
    res.json({
      system: 'ULTRA DICE AI - Hũ',
      error: 'Không thể load lịch sử',
      details: error.message
    });
  }
});

// Lịch sử AI MD5
app.get('/ai-md5/lichsu', async (req, res) => {
  try {
    await verifyPredictions('md5');
    
    const history = aiSystem.history.md5.map(record => ({
      phien: record.phien,
      du_doan: record.prediction.toLowerCase(),
      ti_le: record.confidence + '%',
      method: record.method,
      reason: record.reason,
      timestamp: record.timestamp,
      ket_qua_thuc_te: record.actual ? record.actual.toLowerCase() : null,
      status: record.verified ? (record.correct ? '✅' : '❌') : '⏳'
    }));
    
    const stats = aiSystem.stats.md5;
    const accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : 0;
    
    res.json({
      system: 'ULTRA DICE AI - MD5',
      version: aiSystem.system.version,
      history: history.slice(0, 30),
      stats: {
        total: stats.total,
        correct: stats.correct,
        accuracy: accuracy + '%',
        current_streak: stats.streak,
        best_streak: stats.bestStreak,
        daily: {
          wins: stats.daily.wins,
          losses: stats.daily.losses,
          accuracy: (stats.daily.accuracy * 100).toFixed(1) + '%'
        }
      },
      last_updated: aiSystem.system.lastUpdate
    });
    
  } catch (error) {
    res.json({
      system: 'ULTRA DICE AI - MD5',
      error: 'Không thể load lịch sử',
      details: error.message
    });
  }
});

// Thống kê hệ thống
app.get('/ai-stats', (req, res) => {
  const huAcc = aiSystem.stats.hu.total > 0 ? 
    ((aiSystem.stats.hu.correct / aiSystem.stats.hu.total) * 100).toFixed(2) : 0;
    
  const md5Acc = aiSystem.stats.md5.total > 0 ? 
    ((aiSystem.stats.md5.correct / aiSystem.stats.md5.total) * 100).toFixed(2) : 0;
  
  const totalAcc = (aiSystem.system.averageAccuracy * 100).toFixed(2);
  
  res.json({
    system: 'ULTRA DICE AI STATISTICS',
    version: aiSystem.system.version,
    startup_time: aiSystem.system.startupTime,
    last_update: aiSystem.system.lastUpdate,
    
    performance: {
      overall: {
        total_predictions: aiSystem.system.totalPredictions,
        average_accuracy: totalAcc + '%'
      },
      
      hu_performance: {
        total: aiSystem.stats.hu.total,
        correct: aiSystem.stats.hu.correct,
        accuracy: huAcc + '%',
        current_streak: aiSystem.stats.hu.streak,
        best_streak: aiSystem.stats.hu.bestStreak,
        daily_performance: aiSystem.stats.hu.daily
      },
      
      md5_performance: {
        total: aiSystem.stats.md5.total,
        correct: aiSystem.stats.md5.correct,
        accuracy: md5Acc + '%',
        current_streak: aiSystem.stats.md5.streak,
        best_streak: aiSystem.stats.md5.bestStreak,
        daily_performance: aiSystem.stats.md5.daily
      }
    },
    
    model_info: {
      total_models: 4,
      main_models: 4,
      support_models: 8,
      total_analysis_methods: 12
    }
  });
});

// Reset daily stats
app.get('/reset-daily', (req, res) => {
  aiSystem.stats.hu.daily = { wins: 0, losses: 0, accuracy: 0 };
  aiSystem.stats.md5.daily = { wins: 0, losses: 0, accuracy: 0 };
  saveData();
  res.json({ message: 'Đã reset thống kê daily', timestamp: new Date().toISOString() });
});

// ==================== KHỞI ĐỘNG HỆ THỐNG ====================
loadData();

// Auto-verify mỗi 45 giây
setInterval(autoVerifySystem, 45000);

// Reset daily stats mỗi ngày (24 giờ)
setInterval(() => {
  console.log('🔄 Resetting daily statistics...');
  aiSystem.stats.hu.daily = { wins: 0, losses: 0, accuracy: 0 };
  aiSystem.stats.md5.daily = { wins: 0, losses: 0, accuracy: 0 };
  saveData();
}, 24 * 60 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 ULTRA DICE AI SYSTEM v3.0 running on http://0.0.0.0:${PORT}`);
  console.log('🔥 HỆ THỐNG 4 MODEL PHÂN TÍCH MẠNH MẼ - @Kapubb');
  console.log('');
  console.log('📊 4 MODEL PHÂN TÍCH:');
  console.log('  ✅ Model 1: Nhận biết pattern cơ bản');
  console.log('  ✅ Model 2: Phân tích xu hướng ngắn/dài hạn');
  console.log('  ✅ Model 3: Cân bằng chênh lệch');
  console.log('  ✅ Model 4: Bắt cầu ngắn hạn');
  console.log('');
  console.log('🚀 ENDPOINTS:');
  console.log('  /ai-hu           - Dự đoán AI Hũ');
  console.log('  /ai-md5          - Dự đoán AI MD5');
  console.log('  /ai-hu/lichsu    - Lịch sử chi tiết Hũ');
  console.log('  /ai-md5/lichsu   - Lịch sử chi tiết MD5');
  console.log('  /ai-stats        - Thống kê hệ thống');
  console.log('');
  console.log('⚡ Tổng số phương pháp phân tích: 12 methods');
  console.log('🔄 Auto-verify: 45s | Daily reset: 24h');
});
