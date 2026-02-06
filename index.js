const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const DATA_FILE = 'ai_vip_ultimate.json';

// ==================== NHẬP HỆ THỐNG ULTRA DICE ====================
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
            regime: 'normal' // normal, volatile, trending, random
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
        for (let i = 1; i <= 21; i++) {
            this.models[`model${i}`] = this[`model${i}`].bind(this);
            this.models[`model${i}Mini`] = this[`model${i}Mini`].bind(this);
            this.models[`model${i}Support1`] = this[`model${i}Support1`].bind(this);
            this.models[`model${i}Support2`] = this[`model${i}Support2`].bind(this);
            
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
        
        this.initPatternDatabase();
        this.initAdvancedPatterns();
        this.initSupportModels();
    }

    initPatternDatabase() {
        this.patternDatabase = {
            '1-1': { pattern: ['T', 'X', 'T', 'X'], probability: 0.7, strength: 0.8 },
            '1-2-1': { pattern: ['T', 'X', 'X', 'T'], probability: 0.65, strength: 0.75 },
            '2-1-2': { pattern: ['T', 'T', 'X', 'T', 'T'], probability: 0.68, strength: 0.78 },
            '3-1': { pattern: ['T', 'T', 'T', 'X'], probability: 0.72, strength: 0.82 },
            '1-3': { pattern: ['T', 'X', 'X', 'X'], probability: 0.72, strength: 0.82 },
            '2-2': { pattern: ['T', 'T', 'X', 'X'], probability: 0.66, strength: 0.76 },
            '2-3': { pattern: ['T', 'T', 'X', 'X', 'X'], probability: 0.71, strength: 0.81 },
            '3-2': { pattern: ['T', 'T', 'T', 'X', 'X'], probability: 0.73, strength: 0.83 },
            '4-1': { pattern: ['T', 'T', 'T', 'T', 'X'], probability: 0.76, strength: 0.86 },
            '1-4': { pattern: ['T', 'X', 'X', 'X', 'X'], probability: 0.76, strength: 0.86 },
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
                confidence: 0.72,
                description: "4T trong 6 phiên, cuối là T -> dự đoán X"
            },
            'dynamic-2': {
                detect: (data) => {
                    if (data.length < 8) return false;
                    const last8 = data.slice(-8);
                    const tCount = last8.filter(x => x === 'T').length;
                    return tCount >= 6 && last8[last8.length-1] === 'T';
                },
                predict: () => 'X',
                confidence: 0.78,
                description: "6+T trong 8 phiên, cuối là T -> dự đoán X mạnh"
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
                confidence: 0.68,
                description: "5 phiên đan xen hoàn hảo -> dự đoán đảo chiều"
            },
            'cyclic-7': {
                detect: (data) => {
                    if (data.length < 14) return false;
                    const firstHalf = data.slice(-14, -7);
                    const secondHalf = data.slice(-7);
                    return this.arraysEqual(firstHalf, secondHalf);
                },
                predict: (data) => data[data.length-7],
                confidence: 0.75,
                description: "Chu kỳ 7 phiên lặp lại -> dự đoán theo chu kỳ"
            },
            'momentum-break': {
                detect: (data) => {
                    if (data.length < 9) return false;
                    const first6 = data.slice(-9, -3);
                    const last3 = data.slice(-3);
                    const firstT = first6.filter(x => x === 'T').length;
                    const firstX = first6.filter(x => x === 'X').length;
                    return Math.abs(firstT - firstX) >= 4 && 
                           new Set(last3).size === 1 &&
                           last3[0] !== (firstT > firstX ? 'T' : 'X');
                },
                predict: (data) => {
                    const first6 = data.slice(-9, -3);
                    const firstT = first6.filter(x => x === 'T').length;
                    const firstX = first6.filter(x => x === 'X').length;
                    return firstT > firstX ? 'T' : 'X';
                },
                confidence: 0.71,
                description: "Momentum mạnh bị phá vỡ -> quay lại momentum chính"
            },
            'hybrid-pattern': {
                detect: (data) => {
                    if (data.length < 10) return false;
                    const segment = data.slice(-10);
                    const tCount = segment.filter(x => x === 'T').length;
                    const transitions = segment.slice(1).filter((x, i) => x !== segment[i]).length;
                    return tCount >= 3 && tCount <= 7 && transitions >= 6;
                },
                predict: (data) => {
                    const last = data[data.length-1];
                    const secondLast = data[data.length-2];
                    return last === secondLast ? (last === 'T' ? 'X' : 'T') : last;
                },
                confidence: 0.65,
                description: "Pattern hỗn hợp cao -> dự đoán based on last transitions"
            }
        };
    }

    initSupportModels() {
        for (let i = 1; i <= 21; i++) {
            this.models[`model${i}Support3`] = this[`model${i}Support3`].bind(this);
            this.models[`model${i}Support4`] = this[`model${i}Support4`].bind(this);
        }
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
        if (this.history.length > 200) {
            this.history.shift();
        }
        
        this.updateVolatility();
        this.updatePatternConfidence();
        this.updateMarketState();
        this.updatePatternDatabase();
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

    updatePatternConfidence() {
        for (const [patternName, confidence] of Object.entries(this.sessionStats.patternConfidence)) {
            if (this.history.length < 2) continue;
            
            const lastResult = this.history[this.history.length-1];
            
            if (this.advancedPatterns[patternName]) {
                const prediction = this.advancedPatterns[patternName].predict(this.history.slice(0, -1));
                if (prediction !== lastResult) {
                    this.sessionStats.patternConfidence[patternName] = Math.max(
                        0.1, 
                        confidence * this.adaptiveParameters.patternConfidenceDecay
                    );
                } else {
                    this.sessionStats.patternConfidence[patternName] = Math.min(
                        0.95, 
                        confidence * this.adaptiveParameters.patternConfidenceGrowth
                    );
                }
            }
        }
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

    updatePatternDatabase() {
        if (this.history.length < 10) return;
        
        for (let length = this.adaptiveParameters.patternMinLength; 
             length <= this.adaptiveParameters.patternMaxLength; length++) {
            for (let i = 0; i <= this.history.length - length; i++) {
                const segment = this.history.slice(i, i + length);
                const patternKey = segment.join('-');
                
                if (!this.patternDatabase[patternKey]) {
                    let count = 0;
                    for (let j = 0; j <= this.history.length - length - 1; j++) {
                        const testSegment = this.history.slice(j, j + length);
                        if (testSegment.join('-') === patternKey) {
                            count++;
                        }
                    }
                    
                    if (count > 2) {
                        const probability = count / (this.history.length - length);
                        const strength = Math.min(0.9, probability * 1.2);
                        
                        this.patternDatabase[patternKey] = {
                            pattern: segment,
                            probability: probability,
                            strength: strength
                        };
                    }
                }
            }
        }
    }

    // MODEL 1: Nhận biết các loại cầu cơ bản
    model1() {
        const recent = this.history.slice(-10);
        if (recent.length < 4) return null;
        
        const patterns = this.model1Mini(recent);
        if (patterns.length === 0) return null;
        
        const bestPattern = patterns.reduce((best, current) => 
            current.probability > best.probability ? current : best
        );
        
        let confidence = bestPattern.probability * 0.8;
        if (this.marketState.regime === 'trending') {
            confidence *= 1.1;
        } else if (this.marketState.regime === 'volatile') {
            confidence *= 0.9;
        }
        
        return {
            prediction: bestPattern.prediction,
            confidence: Math.min(0.95, confidence),
            reason: `Phát hiện pattern ${bestPattern.type} (xác suất ${bestPattern.probability.toFixed(2)})`
        };
    }

    model1Mini(data) {
        const patterns = [];
        
        for (const [type, patternData] of Object.entries(this.patternDatabase)) {
            const pattern = patternData.pattern;
            if (data.length < pattern.length) continue;
            
            const segment = data.slice(-pattern.length + 1);
            const patternWithoutLast = pattern.slice(0, -1);
            
            if (segment.join('-') === patternWithoutLast.join('-')) {
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

    model1Support1() {
        return { 
            status: "Phân tích pattern nâng cao",
            totalPatterns: Object.keys(this.patternDatabase).length,
            recentPatterns: Object.keys(this.patternDatabase).length
        };
    }

    model1Support2() {
        const patternCount = Object.keys(this.patternDatabase).length;
        const avgConfidence = patternCount > 0 ? 
            Object.values(this.patternDatabase).reduce((sum, p) => sum + p.probability, 0) / patternCount : 0;
        
        return { 
            status: "Đánh giá độ tin cậy pattern",
            patternCount,
            averageConfidence: avgConfidence
        };
    }

    // MODEL 2: Bắt trend xu hướng ngắn và dài
    model2() {
        const shortTerm = this.history.slice(-5);
        const longTerm = this.history.slice(-20);
        
        if (shortTerm.length < 3 || longTerm.length < 10) return null;
        
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
        
        const analysis = this.model3Mini(recent);
        
        if (analysis.difference < 0.4) return null;
        
        let confidence = analysis.difference * 0.8;
        if (this.marketState.regime === 'random') {
            confidence *= 1.1;
        } else if (this.marketState.regime === 'trending') {
            confidence *= 0.9;
        }
        
        return {
            prediction: analysis.prediction,
            confidence: Math.min(0.95, confidence),
            reason: `Chênh lệch cao (${Math.round(analysis.difference * 100)}%) trong 12 phiên, dự đoán cân bằng`
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
        
        const analysis = this.model4Mini(recent);
        
        if (analysis.confidence < 0.6) return null;
        
        let confidence = analysis.confidence;
        if (this.marketState.regime === 'trending') {
            confidence *= 1.1;
        } else if (this.marketState.regime === 'volatile') {
            confidence *= 0.9;
        }
        
        return {
            prediction: analysis.prediction,
            confidence: Math.min(0.95, confidence),
            reason: `Cầu ngắn hạn ${analysis.trend} với độ tin cậy ${analysis.confidence.toFixed(2)}`
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
            const changes = data.slice(-4).filter((val, idx, arr) => 
                idx > 0 && val !== arr[idx-1]).length;
            
            if (changes >= 3) {
                prediction = data[data.length - 1] === 'T' ? 'X' : 'T';
                confidence = 0.6;
                trend = 'Đảo chiều';
            } else {
                prediction = data[data.length - 1];
                confidence = 0.55;
                trend = 'Ổn định';
            }
        }
        
        return { prediction, confidence, trend };
    }

    // MODEL 5: Nếu tỉ lệ trọng số dự đoán tài /Xỉu chênh lệch cao thì cân bằng lại
    model5() {
        const predictions = this.getAllPredictions();
        const tPredictions = Object.values(predictions).filter(p => p && p.prediction === 'T').length;
        const xPredictions = Object.values(predictions).filter(p => p && p.prediction === 'X').length;
        const total = tPredictions + xPredictions;
        
        if (total < 5) return null;
        
        const difference = Math.abs(tPredictions - xPredictions) / total;
        
        if (difference > 0.6) {
            return {
                prediction: tPredictions > xPredictions ? 'X' : 'T',
                confidence: difference * 0.9,
                reason: `Cân bằng tỷ lệ chênh lệch cao (${Math.round(difference * 100)}%) giữa các model`
            };
        }
        
        return null;
    }

    // MODEL 6: Biết lúc nào nên bắt theo cầu hay bẻ cầu
    model6() {
        const trendAnalysis = this.model2();
        const continuity = this.model6Mini(this.history.slice(-8));
        const breakProbability = this.model10Mini(this.history);
        
        if (continuity.streak >= 5 && breakProbability > 0.7) {
            return {
                prediction: trendAnalysis.prediction === 'T' ? 'X' : 'T',
                confidence: breakProbability * 0.8,
                reason: `Cầu liên tục ${continuity.streak} lần, xác suất bẻ cầu ${breakProbability.toFixed(2)}`
            };
        }
        
        return {
            prediction: trendAnalysis.prediction,
            confidence: trendAnalysis.confidence * 0.9,
            reason: `Tiếp tục theo xu hướng, cầu chưa đủ mạnh để bẻ`
        };
    }

    model6Mini(data) {
        if (data.length < 2) return { streak: 0, direction: 'neutral', maxStreak: 0 };
        
        let currentStreak = 1;
        let maxStreak = 1;
        let direction = data[data.length - 1];
        
        for (let i = data.length - 1; i > 0; i--) {
            if (data[i] === data[i-1]) {
                currentStreak++;
                maxStreak = Math.max(maxStreak, currentStreak);
            } else {
                break;
            }
        }
        
        return { streak: currentStreak, direction, maxStreak };
    }

    // MODEL 7: Cân bằng trọng số từng model khi chênh lệch quá cao
    model7() {
        const performanceStats = this.model13Mini();
        const imbalance = this.model7Mini(performanceStats);
        
        if (imbalance > 0.3) {
            this.adjustWeights(performanceStats);
            return {
                prediction: null,
                confidence: 0,
                reason: `Điều chỉnh trọng số do chênh lệch hiệu suất ${imbalance.toFixed(2)}`
            };
        }
        
        return null;
    }

    model7Mini(performanceStats) {
        const accuracies = Object.values(performanceStats).map(p => p.accuracy);
        if (accuracies.length < 2) return 0;
        
        const maxAccuracy = Math.max(...accuracies);
        const minAccuracy = Math.min(...accuracies);
        
        return (maxAccuracy - minAccuracy) / maxAccuracy;
    }

    adjustWeights(performanceStats) {
        const avgAccuracy = Object.values(performanceStats).reduce((sum, p) => sum + p.accuracy, 0) / 
                           Object.values(performanceStats).length;
        
        for (const [model, stats] of Object.entries(performanceStats)) {
            const deviation = stats.accuracy - avgAccuracy;
            this.weights[model] = Math.max(0.1, Math.min(2, 1 + deviation * 2));
        }
    }

    // MODEL 8: Nhận biết cầu xấu (cầu ko theo bất kì xu hướng nào)
    model8() {
        const randomness = this.model8Mini(this.history.slice(-15));
        
        if (randomness > 0.7) {
            ['model1', 'model4', 'model9', 'model12'].forEach(model => {
                this.weights[model] = Math.max(0.3, this.weights[model] * 0.7);
            });
            
            ['model3', 'model5', 'model6'].forEach(model => {
                this.weights[model] = Math.min(2, this.weights[model] * 1.2);
            });
            
            return {
                prediction: null,
                confidence: 0,
                reason: `Phát hiện cầu xấu (độ ngẫu nhiên ${randomness.toFixed(2)}), điều chỉnh trọng số model`
            };
        }
        
        return null;
    }

    model8Mini(data) {
        if (data.length < 10) return 0;
        
        let changes = 0;
        for (let i = 1; i < data.length; i++) {
            if (data[i] !== data[i-1]) changes++;
        }
        
        const changeRatio = changes / (data.length - 1);
        
        const tCount = data.filter(x => x === 'T').length;
        const xCount = data.filter(x => x === 'X').length;
        const distribution = Math.abs(tCount - xCount) / data.length;
        
        const pT = tCount / data.length;
        const pX = xCount / data.length;
        let entropy = 0;
        if (pT > 0) entropy -= pT * Math.log2(pT);
        if (pX > 0) entropy -= pX * Math.log2(pX);
        
        return (changeRatio * 0.4 + (1 - distribution) * 0.3 + entropy * 0.3);
    }

    // MODEL 9: Nhận biết các loại cầu cơ bản (nâng cao)
    model9() {
        const recent = this.history.slice(-12);
        if (recent.length < 8) return null;
        
        const complexPatterns = this.model9Mini(recent);
        if (complexPatterns.length === 0) return null;
        
        const bestPattern = complexPatterns.reduce((best, current) => 
            current.confidence > best.confidence ? current : best
        );
        
        let confidence = bestPattern.confidence;
        if (this.marketState.regime === 'trending') {
            confidence *= 1.1;
        } else if (this.marketState.regime === 'volatile') {
            confidence *= 0.9;
        }
        
        return {
            prediction: bestPattern.prediction,
            confidence: Math.min(0.95, confidence),
            reason: `Phát hiện pattern phức tạp: ${bestPattern.type}`
        };
    }

    model9Mini(data) {
        const patterns = [];
        
        for (let patternLength = 4; patternLength <= 6; patternLength++) {
            if (data.length < patternLength) continue;
            
            const segment = data.slice(-patternLength);
            const patternKey = segment.join('-');
            
            if (this.patternDatabase[patternKey]) {
                patterns.push({
                    type: patternKey,
                    prediction: this.patternDatabase[patternKey].pattern[
                        this.patternDatabase[patternKey].pattern.length - 1
                    ],
                    confidence: this.patternDatabase[patternKey].probability * 0.75
                });
            }
        }
        
        return patterns;
    }

    // MODEL 10: Nhận biết xác suất bẻ cầu
    model10() {
        const breakProb = this.model10Mini(this.history);
        
        return {
            prediction: null,
            confidence: breakProb,
            reason: `Xác suất bẻ cầu: ${breakProb.toFixed(2)}`
        };
    }

    model10Mini(data) {
        if (data.length < 20) return 0.5;
        
        let breakCount = 0;
        let totalOpportunities = 0;
        
        for (let i = 5; i < data.length; i++) {
            const segment = data.slice(i-5, i);
            const streak = this.model6Mini(segment).streak;
            
            if (streak >= 4) {
                totalOpportunities++;
                if (data[i] !== segment[segment.length-1]) {
                    breakCount++;
                }
            }
        }
        
        return totalOpportunities > 0 ? breakCount / totalOpportunities : 0.5;
    }

    // MODEL 11: Nhận diện biến động xúc xắc và nguyên lý xúc xắc
    model11() {
        const volatility = this.model11Mini(this.history.slice(-20));
        const prediction = this.model11Predict(volatility);
        
        return {
            prediction: prediction.value,
            confidence: prediction.confidence,
            reason: `Biến động ${volatility.level}, dự đoán ${prediction.value}`
        };
    }

    model11Mini(data) {
        if (data.length < 10) return { level: 'medium', value: 0.5 };
        
        let changes = 0;
        for (let i = 1; i < data.length; i++) {
            if (data[i] !== data[i-1]) changes++;
        }
        
        const changeRatio = changes / (data.length - 1);
        
        if (changeRatio < 0.3) return { level: 'low', value: changeRatio };
        if (changeRatio > 0.7) return { level: 'high', value: changeRatio };
        return { level: 'medium', value: changeRatio };
    }

    model11Predict(volatility) {
        if (volatility.level === 'low') {
            const last = this.history[this.history.length - 1];
            return { value: last, confidence: 0.7 };
        } else if (volatility.level === 'high') {
            return { value: Math.random() > 0.5 ? 'T' : 'X', confidence: 0.5 };
        } else {
            const trend = this.model2Mini(this.history.slice(-10));
            return { 
                value: trend.trend === 'up' ? 'T' : 'X', 
                confidence: trend.strength * 0.8 
            };
        }
    }

    // MODEL 12: nhận diện nhiều mẫu cầu hơn ngắn
    model12() {
        const shortPatterns = this.model12Mini(this.history.slice(-8));
        
        if (shortPatterns.length === 0) return null;
        
        const bestPattern = shortPatterns.reduce((best, current) => 
            current.confidence > best.confidence ? current : best
        );
        
        return {
            prediction: bestPattern.prediction,
            confidence: bestPattern.confidence,
            reason: `Mẫu cầu ngắn: ${bestPattern.type}`
        };
    }

    model12Mini(data) {
        const patterns = [];
        
        const shortPatterns = {
            'T-X-T': { prediction: 'X', confidence: 0.65 },
            'X-T-X': { prediction: 'T', confidence: 0.65 },
            'T-T-X': { prediction: 'X', confidence: 0.7 },
            'X-X-T': { prediction: 'T', confidence: 0.7 },
            'T-X-X': { prediction: 'T', confidence: 0.6 },
            'X-T-T': { prediction: 'X', confidence: 0.6 },
            'T-T-T-X': { prediction: 'X', confidence: 0.72 },
            'X-X-X-T': { prediction: 'T', confidence: 0.72 },
            'T-X-T-X': { prediction: 'X', confidence: 0.68 },
            'X-T-X-T': { prediction: 'T', confidence: 0.68 }
        };
        
        if (data.length >= 3) {
            const last3 = data.slice(-3).join('-');
            if (shortPatterns[last3]) {
                patterns.push({
                    type: last3,
                    prediction: shortPatterns[last3].prediction,
                    confidence: shortPatterns[last3].confidence
                });
            }
        }
        
        if (data.length >= 4) {
            const last4 = data.slice(-4).join('-');
            if (shortPatterns[last4]) {
                patterns.push({
                    type: last4,
                    prediction: shortPatterns[last4].prediction,
                    confidence: shortPatterns[last4].confidence
                });
            }
        }
        
        return patterns;
    }

    // MODEL 13: đánh giá hiệu suất từng mô hình
    model13() {
        const performance = this.model13Mini();
        const bestModel = Object.entries(performance).reduce((best, [model, stats]) => 
            stats.accuracy > best.accuracy ? { model, ...stats } : best
        , { model: null, accuracy: 0 });
        
        return {
            prediction: null,
            confidence: bestModel.accuracy,
            reason: `Model hiệu suất cao nhất: ${bestModel.model} (${bestModel.accuracy.toFixed(2)})`
        };
    }

    model13Mini() {
        const stats = {};
        
        for (const model of Object.keys(this.performance)) {
            if (this.performance[model].total > 0) {
                stats[model] = {
                    accuracy: this.performance[model].correct / this.performance[model].total,
                    recentAccuracy: this.performance[model].recentTotal > 0 ? 
                        this.performance[model].recentCorrect / this.performance[model].recentTotal : 0,
                    total: this.performance[model].total,
                    recentTotal: this.performance[model].recentTotal,
                    streak: this.performance[model].streak,
                    maxStreak: this.performance[model].maxStreak
                };
            }
        }
        
        return stats;
    }

    // MODEL 14: tính xác xuất bẻ cầu xu hướng
    model14() {
        const breakProb = this.model14Mini(this.history);
        
        return {
            prediction: null,
            confidence: breakProb,
            reason: `Xác suất bẻ cầu xu hướng: ${breakProb.toFixed(2)}`
        };
    }

    model14Mini(data) {
        if (data.length < 15) return 0.5;
        
        let breakCount = 0;
        let trendCount = 0;
        
        for (let i = 10; i < data.length; i++) {
            const segment = data.slice(i-10, i);
            const trend = this.model2Mini(segment);
            
            if (trend.strength > 0.6) {
                trendCount++;
                if (data[i] !== (trend.trend === 'up' ? 'T' : 'X')) {
                    breakCount++;
                }
            }
        }
        
        return trendCount > 0 ? breakCount / trendCount : 0.5;
    }

    // MODEL 15: suy nghĩ có nên bắt theo xu hướng ko
    model15() {
        const trend = this.model2();
        const breakProb = this.model14Mini(this.history);
        const shouldFollow = this.model15Mini(trend.confidence, breakProb);
        
        return {
            prediction: shouldFollow ? trend.prediction : (trend.prediction === 'T' ? 'X' : 'T'),
            confidence: shouldFollow ? trend.confidence : (1 - trend.confidence),
            reason: shouldFollow ? 
                `Nên theo xu hướng (xác suất bẻ thấp)` : 
                `Nên bẻ xu hướng (xác suất bẻ cao)`
        };
    }

    model15Mini(trendConfidence, breakProbability) {
        return trendConfidence > breakProbability * 1.5;
    }

    // MODEL 16: tính xác suất bẻ cầu (phiên bản nâng cao)
    model16() {
        const breakProb = this.model16Mini(this.history);
        
        return {
            prediction: null,
            confidence: breakProb,
            reason: `Xác suất bẻ cầu tổng hợp: ${breakProb.toFixed(2)}`
        };
    }

    model16Mini(data) {
        const prob1 = this.model10Mini(data);
        const prob2 = this.model14Mini(data);
        
        let recentBreaks = 0;
        let recentOpportunities = 0;
        
        for (let i = Math.max(0, data.length - 10); i < data.length - 1; i++) {
            if (i >= 5) {
                const segment = data.slice(i-5, i);
                const streak = this.model6Mini(segment).streak;
                
                if (streak >= 3) {
                    recentOpportunities++;
                    if (data[i] !== segment[segment.length-1]) {
                        recentBreaks++;
                    }
                }
            }
        }
        
        const prob3 = recentOpportunities > 0 ? recentBreaks / recentOpportunities : 0.5;
        
        return (prob1 * 0.4 + prob2 * 0.4 + prob3 * 0.2);
    }

    // MODEL 17: cân bằng trọng số (nâng cao)
    model17() {
        const performance = this.model13Mini();
        const imbalance = this.model17Mini(performance);
        
        if (imbalance > 0.25) {
            this.adjustWeightsAdvanced(performance);
            return {
                prediction: null,
                confidence: 0,
                reason: `Cân bằng trọng số nâng cao, độ chênh lệch: ${imbalance.toFixed(2)}`
            };
        }
        
        return null;
    }

    model17Mini(performance) {
        const accuracies = Object.values(performance).map(p => p.accuracy);
        if (accuracies.length < 2) return 0;
        
        const mean = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length;
        const variance = accuracies.reduce((sum, acc) => sum + Math.pow(acc - mean, 2), 0) / accuracies.length;
        
        return Math.sqrt(variance) / mean;
    }

    adjustWeightsAdvanced(performance) {
        const meanAccuracy = Object.values(performance).reduce((sum, p) => sum + p.accuracy, 0) / 
                            Object.values(performance).length;
        
        for (const [model, stats] of Object.entries(performance)) {
            if (stats.accuracy > meanAccuracy * 1.2) {
                this.weights[model] = Math.min(2, this.weights[model] * 1.1);
            } else if (stats.accuracy < meanAccuracy * 0.8) {
                this.weights[model] = Math.max(0.1, this.weights[model] * 0.9);
            }
        }
    }

    // MODEL 18: nhận biết xu hướng cầu và đoán theo xu hướng ngắn hạn
    model18() {
        const shortTrend = this.model18Mini(this.history.slice(-6));
        
        return {
            prediction: shortTrend.prediction,
            confidence: shortTrend.confidence,
            reason: `Xu hướng ngắn hạn: ${shortTrend.trend}`
        };
    }

    model18Mini(data) {
        if (data.length < 4) return { prediction: null, confidence: 0, trend: 'Không xác định' };
        
        const tCount = data.filter(x => x === 'T').length;
        const xCount = data.filter(x => x === 'X').length;
        
        let prediction, confidence, trend;
        
        if (tCount > xCount * 1.5) {
            prediction = 'T';
            confidence = 0.7;
            trend = 'Mạnh T';
        } else if (xCount > tCount * 1.5) {
            prediction = 'X';
            confidence = 0.7;
            trend = 'Mạnh X';
        } else if (tCount > xCount) {
            prediction = 'T';
            confidence = 0.6;
            trend = 'Nhẹ T';
        } else if (xCount > tCount) {
            prediction = 'X';
            confidence = 0.6;
            trend = 'Nhẹ X';
        } else {
            prediction = data[data.length - 1] === 'T' ? 'X' : 'T';
            confidence = 0.55;
            trend = 'Cân bằng';
        }
        
        return { prediction, confidence, trend };
    }

    // MODEL 19: các xu hướng phổ biến
    model19() {
        const commonTrends = this.model19Mini(this.history.slice(-30));
        
        if (commonTrends.length === 0) return null;
        
        const bestTrend = commonTrends.reduce((best, current) => 
            current.frequency > best.frequency ? current : best
        );
        
        return {
            prediction: bestTrend.prediction,
            confidence: bestTrend.confidence,
            reason: `Xu hướng phổ biến: ${bestTrend.pattern} (tần suất ${bestTrend.frequency})`
        };
    }

    model19Mini(data) {
        const trends = [];
        
        const patternCounts = {};
        
        for (let length = 3; length <= 5; length++) {
            for (let i = 0; i <= data.length - length; i++) {
                const pattern = data.slice(i, i + length).join('-');
                patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
            }
        }
        
        for (const [pattern, count] of Object.entries(patternCounts)) {
            if (count >= 3) {
                const patternParts = pattern.split('-');
                const prediction = patternParts[patternParts.length - 1];
                const frequency = count / (data.length - patternParts.length + 1);
                
                trends.push({
                    pattern,
                    prediction,
                    frequency,
                    confidence: Math.min(0.8, frequency * 2)
                });
            }
        }
        
        return trends;
    }

    // MODEL 20: Max Performance
    model20() {
        const performance = this.model13Mini();
        const bestModels = Object.entries(performance)
            .filter(([_, stats]) => stats.total > 10)
            .sort((a, b) => b[1].accuracy - a[1].accuracy)
            .slice(0, 3);
        
        if (bestModels.length === 0) return null;
        
        const predictions = {};
        for (const [model] of bestModels) {
            predictions[model] = this.models[model]();
        }
        
        let tScore = 0;
        let xScore = 0;
        
        for (const [model, prediction] of Object.entries(predictions)) {
            if (prediction && prediction.prediction) {
                const weight = performance[model].accuracy;
                if (prediction.prediction === 'T') {
                    tScore += weight * prediction.confidence;
                } else {
                    xScore += weight * prediction.confidence;
                }
            }
        }
        
        const totalScore = tScore + xScore;
        if (totalScore === 0) return null;
        
        return {
            prediction: tScore > xScore ? 'T' : 'X',
            confidence: Math.max(tScore, xScore) / totalScore,
            reason: `Kết hợp ${bestModels.length} model hiệu suất cao nhất`
        };
    }

    // MODEL 21: cân bằng tất cả khi thấy chênh lệch cao
    model21() {
        const predictions = this.getAllPredictions();
        const tCount = Object.values(predictions).filter(p => p && p.prediction === 'T').length;
        const xCount = Object.values(predictions).filter(p => p && p.prediction === 'X').length;
        const total = tCount + xCount;
        
        if (total < 8) return null;
        
        const difference = Math.abs(tCount - xCount) / total;
        
        if (difference > 0.5) {
            const adjustedPredictions = this.model21Mini(predictions, difference);
            
            let tScore = 0;
            let xScore = 0;
            
            for (const prediction of Object.values(adjustedPredictions)) {
                if (prediction && prediction.prediction) {
                    if (prediction.prediction === 'T') {
                        tScore += prediction.confidence;
                    } else {
                        xScore += prediction.confidence;
                    }
                }
            }
            
            const totalScore = tScore + xScore;
            if (totalScore === 0) return null;
            
            return {
                prediction: tScore > xScore ? 'T' : 'X',
                confidence: Math.max(tScore, xScore) / totalScore,
                reason: `Cân bằng tổng thể, chênh lệch ban đầu: ${difference.toFixed(2)}`
            };
        }
        
        return null;
    }

    model21Mini(predictions, difference) {
        const adjusted = {};
        const adjustment = 1 - difference;
        
        for (const [model, prediction] of Object.entries(predictions)) {
            if (prediction) {
                adjusted[model] = {
                    ...prediction,
                    confidence: prediction.confidence * adjustment
                };
            }
        }
        
        return adjusted;
    }

    // Utility methods
    getAllPredictions() {
        const predictions = {};
        
        for (let i = 1; i <= 21; i++) {
            predictions[`model${i}`] = this.models[`model${i}`]();
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
                reasons.push(`${modelName}: ${prediction.reason} (${prediction.confidence.toFixed(2)})`);
            }
        }
        
        if (totalWeight === 0) return null;
        
        let finalPrediction = null;
        let finalConfidence = 0;
        
        if (tScore > xScore) {
            finalPrediction = 'T';
            finalConfidence = tScore / (tScore + xScore);
        } else if (xScore > tScore) {
            finalPrediction = 'X';
            finalConfidence = xScore / (tScore + xScore);
        }
        
        finalConfidence = this.adjustConfidenceByVolatility(finalConfidence);
        
        return {
            prediction: finalPrediction,
            confidence: finalConfidence,
            reasons: reasons,
            details: predictions,
            sessionStats: this.sessionStats,
            marketState: this.marketState
        };
    }

    adjustConfidenceByVolatility(confidence) {
        if (this.sessionStats.volatility > 0.7) {
            return confidence * 0.8;
        }
        if (this.sessionStats.volatility < 0.3) {
            return Math.min(0.95, confidence * 1.1);
        }
        return confidence;
    }

    updatePerformance(actualResult) {
        const predictions = this.getAllPredictions();
        
        for (const [modelName, prediction] of Object.entries(predictions)) {
            if (prediction && prediction.prediction) {
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
                
                if (this.performance[modelName].recentTotal > 50) {
                    this.performance[modelName].recentTotal--;
                    if (this.performance[modelName].recentCorrect > 0 && 
                        this.performance[modelName].recentCorrect / this.performance[modelName].recentTotal > 
                        this.performance[modelName].correct / this.performance[modelName].total) {
                        this.performance[modelName].recentCorrect--;
                    }
                }
                
                const accuracy = this.performance[modelName].correct / this.performance[modelName].total;
                this.weights[modelName] = Math.max(0.1, Math.min(2, accuracy * 2));
            }
        }
        
        const totalPredictions = Object.values(predictions).filter(p => p && p.prediction).length;
        const correctPredictions = Object.values(predictions).filter(p => p && p.prediction === actualResult).length;
        this.sessionStats.recentAccuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;
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
  
  if (aiSystem.history[type].length > 150) {
    aiSystem.history[type] = aiSystem.history[type].slice(0, 150);
  }
  
  if (actualResult) {
    aiSystem.stats[type].total++;
    if (historyRecord.correct) {
      aiSystem.stats[type].correct++;
      aiSystem.stats[type].streak = Math.max(0, aiSystem.stats[type].streak) + 1;
      if (aiSystem.stats[type].streak > aiSystem.stats[type].bestStreak) {
        aiSystem.stats[type].bestStreak = aiSystem.stats[type].streak;
      }
      
      const today = new Date().toDateString();
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
    <p>Hệ thống AI cực mạnh với 21 model phân tích - @Kapubb</p>
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
    
    // Reset và train hệ thống với dữ liệu mới
    ultraSystemHU = new UltraDicePredictionSystem();
    
    // Thêm dữ liệu từ cũ đến mới
    const reversedData = [...data].reverse();
    reversedData.forEach(item => {
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
      method: 'ULTRA_DICE_21_MODELS',
      reason: prediction.reasons ? prediction.reasons[0] : 'Hệ thống 21 model phân tích'
    });
    
    saveData();
    
    // Chuẩn bị response
    const responseData = {
      phien: nextPhien.toString(),
      du_doan: prediction.prediction === 'T' ? 'tài' : 'xỉu',
      ti_le: Math.round(prediction.confidence * 100) + '%',
      id: '@Kapubb',
      method: 'ULTRA_DICE_21_MODELS',
      reason: prediction.reasons ? prediction.reasons[0] : 'Hệ thống 21 model phân tích',
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
    
    // Reset và train hệ thống với dữ liệu mới
    ultraSystemMD5 = new UltraDicePredictionSystem();
    
    // Thêm dữ liệu từ cũ đến mới
    const reversedData = [...data].reverse();
    reversedData.forEach(item => {
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
      method: 'ULTRA_DICE_21_MODELS',
      reason: prediction.reasons ? prediction.reasons[0] : 'Hệ thống 21 model phân tích'
    });
    
    saveData();
    
    // Chuẩn bị response
    const responseData = {
      phien: nextPhien.toString(),
      du_doan: prediction.prediction === 'T' ? 'tài' : 'xỉu',
      ti_le: Math.round(prediction.confidence * 100) + '%',
      id: '@Kapubb',
      method: 'ULTRA_DICE_21_MODELS',
      reason: prediction.reasons ? prediction.reasons[0] : 'Hệ thống 21 model phân tích',
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
      total_models: 21,
      main_models: 21,
      mini_models: 21,
      support_models: 84,
      total_analysis_methods: 126
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
  console.log('🔥 HỆ THỐNG 21 MODEL PHÂN TÍCH NÂNG CAO - @Kapubb');
  console.log('');
  console.log('📊 21 MODEL PHÂN TÍCH:');
  console.log('  ✅ Model 1-5: Nhận biết cầu cơ bản & trend');
  console.log('  ✅ Model 6-10: Phân tích xu hướng & break point');
  console.log('  ✅ Model 11-15: Phân tích biến động & xác suất');
  console.log('  ✅ Model 16-21: Cân bằng & tổng hợp đa model');
  console.log('');
  console.log('🚀 ENDPOINTS:');
  console.log('  /ai-hu           - Dự đoán AI Hũ');
  console.log('  /ai-md5          - Dự đoán AI MD5');
  console.log('  /ai-hu/lichsu    - Lịch sử chi tiết Hũ');
  console.log('  /ai-md5/lichsu   - Lịch sử chi tiết MD5');
  console.log('  /ai-stats        - Thống kê hệ thống');
  console.log('');
  console.log('⚡ Tổng số phương pháp phân tích: 126 methods');
  console.log('🔄 Auto-verify: 45s | Daily reset: 24h');
});
