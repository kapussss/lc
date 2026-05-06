const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'learning_data.json';
const HISTORY_FILE = 'prediction_history.json';
const ANOMALY_FILE = 'anomaly_patterns.json';
const SIMULATION_FILE = 'simulation_data.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== SIMULATION THẬT 10 PHIÊN GẦN NHẤT ====================
class RealSimulationEngine {
  constructor() {
    this.simulationResults = [];
    this.simulationHistory = [];
  }

  loadSimulationData() {
    try {
      if (fs.existsSync(SIMULATION_FILE)) {
        const data = fs.readFileSync(SIMULATION_FILE, 'utf8');
        const parsed = JSON.parse(data);
        this.simulationResults = parsed.simulationResults || [];
        this.simulationHistory = parsed.simulationHistory || [];
        console.log(`[Simulation] Loaded ${this.simulationResults.length} simulation records`);
      }
    } catch (error) {
      console.error('[Simulation] Load error:', error.message);
    }
  }

  saveSimulationData() {
    try {
      fs.writeFileSync(SIMULATION_FILE, JSON.stringify({
        simulationResults: this.simulationResults.slice(-500),
        simulationHistory: this.simulationHistory.slice(-1000),
        lastSaved: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      console.error('[Simulation] Save error:', error.message);
    }
  }

  // Chạy simulation dựa trên 10 phiên thực tế gần nhất
  runRealSimulation(actualData, numberOfSimulations = 10000) {
    if (!actualData || actualData.length < 10) {
      return {
        taiProbability: 0.5,
        xiuProbability: 0.5,
        confidence: 50,
        prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu',
        simulationCount: 0,
        realPhienUsed: actualData?.length || 0
      };
    }

    // Lấy 10 phiên thực tế gần nhất để làm mẫu
    const last10Real = actualData.slice(0, Math.min(10, actualData.length));
    
    // Phân tích các mẫu từ 10 phiên thực tế
    const patternAnalysis = this.analyzeRealPatterns(last10Real);
    
    let taiWins = 0;
    let xiuWins = 0;
    
    // Chạy simulation dựa trên dữ liệu thực
    for (let sim = 0; sim < numberOfSimulations; sim++) {
      let simulatedResult;
      
      // Phương pháp 1: Bootstrap từ 10 phiên thực
      if (sim < numberOfSimulations * 0.6) {
        const randomRealIndex = Math.floor(Math.random() * last10Real.length);
        simulatedResult = last10Real[randomRealIndex].Ket_qua;
      } 
      // Phương pháp 2: Dựa trên pattern đã phát hiện
      else if (sim < numberOfSimulations * 0.85) {
        simulatedResult = this.simulateByPattern(last10Real, patternAnalysis);
      }
      // Phương pháp 3: Markov chain dựa trên chuỗi thực
      else {
        simulatedResult = this.simulateByMarkovChain(last10Real);
      }
      
      if (simulatedResult === 'Tài') taiWins++;
      else xiuWins++;
    }
    
    const taiProbability = taiWins / numberOfSimulations;
    const deviation = Math.abs(taiProbability - 0.5);
    const confidence = 50 + Math.min(35, deviation * 70);
    
    // Ghi nhận kết quả simulation
    this.simulationResults.unshift({
      timestamp: new Date().toISOString(),
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: (1 - taiProbability).toFixed(4),
      confidence: Math.round(confidence),
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      actualPattern: patternAnalysis.dominantPattern,
      realDataUsed: last10Real.length
    });
    
    if (this.simulationResults.length > 200) {
      this.simulationResults = this.simulationResults.slice(0, 200);
    }
    
    this.saveSimulationData();
    
    return {
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: (1 - taiProbability).toFixed(4),
      confidence: Math.min(85, Math.max(55, Math.round(confidence))),
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      simulationCount: numberOfSimulations,
      realPhienUsed: last10Real.length,
      patternAnalysis: patternAnalysis
    };
  }

  analyzeRealPatterns(realData) {
    const results = realData.map(d => d.Ket_qua);
    const sums = realData.map(d => d.Tong);
    
    // Đếm tần suất
    const taiCount = results.filter(r => r === 'Tài').length;
    const xiuCount = results.length - taiCount;
    
    // Phát hiện chuỗi
    let currentStreak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) currentStreak++;
      else break;
    }
    
    // Phát hiện pattern alternating
    let isAlternating = true;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[i-1]) {
        isAlternating = false;
        break;
      }
    }
    
    // Xác định pattern chính
    let dominantPattern = 'balanced';
    const taiRatio = taiCount / results.length;
    
    if (taiRatio >= 0.7) dominantPattern = 'tai_dominant';
    else if (taiRatio <= 0.3) dominantPattern = 'xiu_dominant';
    else if (currentStreak >= 3) dominantPattern = 'streak';
    else if (isAlternating && results.length >= 4) dominantPattern = 'alternating';
    
    return {
      taiRatio: (taiCount / results.length * 100).toFixed(1),
      xiuRatio: (xiuCount / results.length * 100).toFixed(1),
      currentStreak,
      isAlternating,
      dominantPattern,
      avgSum: sums.reduce((a, b) => a + b, 0) / sums.length
    };
  }

  simulateByPattern(realData, patternAnalysis) {
    const results = realData.map(d => d.Ket_qua);
    
    switch(patternAnalysis.dominantPattern) {
      case 'tai_dominant':
        return Math.random() < 0.7 ? 'Tài' : 'Xỉu';
      case 'xiu_dominant':
        return Math.random() < 0.7 ? 'Xỉu' : 'Tài';
      case 'streak':
        // Tiếp tục chuỗi với xác suất giảm dần
        const streakContinueProb = Math.max(0.3, 0.7 - (patternAnalysis.currentStreak - 2) * 0.1);
        return Math.random() < streakContinueProb ? results[0] : (results[0] === 'Tài' ? 'Xỉu' : 'Tài');
      case 'alternating':
        // Luân phiên
        const lastResult = results[0];
        return lastResult === 'Tài' ? 'Xỉu' : 'Tài';
      default:
        // Balanced: dựa trên tỷ lệ thực tế
        const taiProb = parseFloat(patternAnalysis.taiRatio) / 100;
        return Math.random() < taiProb ? 'Tài' : 'Xỉu';
    }
  }

  simulateByMarkovChain(realData) {
    const results = realData.map(d => d.Ket_qua);
    
    // Xây dựng ma trận chuyển tiếp đơn giản
    let taiToTai = 0, taiToXiu = 0, xiuToTai = 0, xiuToXiu = 0;
    
    for (let i = 0; i < results.length - 1; i++) {
      if (results[i] === 'Tài') {
        if (results[i+1] === 'Tài') taiToTai++;
        else taiToXiu++;
      } else {
        if (results[i+1] === 'Tài') xiuToTai++;
        else xiuToXiu++;
      }
    }
    
    const lastResult = results[0];
    if (lastResult === 'Tài') {
      const taiProb = taiToTai / Math.max(1, taiToTai + taiToXiu);
      return Math.random() < taiProb ? 'Tài' : 'Xỉu';
    } else {
      const xiuProb = xiuToXiu / Math.max(1, xiuToXiu + xiuToTai);
      return Math.random() < xiuProb ? 'Xỉu' : 'Tài';
    }
  }

  getLastSimulationAccuracy(actualResult, predictedResult) {
    const isCorrect = actualResult === predictedResult;
    
    if (this.simulationResults.length > 0) {
      const lastSim = this.simulationResults[0];
      lastSim.wasCorrect = isCorrect;
      lastSim.actualResult = actualResult;
      this.simulationResults[0] = lastSim;
      this.saveSimulationData();
    }
    
    return isCorrect;
  }
}

// ==================== SIÊU AI HỌC ADAPTIVE ====================
class AdaptiveSuperAI {
  constructor() {
    this.adaptiveWeights = {
      simulation: 1.0,
      pattern: 1.0,
      anomaly: 1.0,
      trend: 1.0,
      qlearning: 0.8
    };
    this.performanceHistory = [];
    this.contextMemory = [];
    this.deceptionDetector = new DeceptionDetector();
    this.metaLearner = new MetaLearner();
  }

  adaptWeights(lastResults, context) {
    // Phân tích hiệu suất gần đây để điều chỉnh trọng số
    const recentPerformance = this.performanceHistory.slice(0, 20);
    if (recentPerformance.length < 10) return;
    
    // Tính accuracy từng phương pháp trong 10 phiên gần nhất
    const methodAccuracy = {
      simulation: { correct: 0, total: 0 },
      pattern: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 },
      trend: { correct: 0, total: 0 },
      qlearning: { correct: 0, total: 0 }
    };
    
    for (const perf of recentPerformance) {
      if (perf.method && perf.isCorrect !== undefined) {
        methodAccuracy[perf.method].total++;
        if (perf.isCorrect) methodAccuracy[perf.method].correct++;
      }
    }
    
    // Cập nhật trọng số dựa trên accuracy
    for (const method in methodAccuracy) {
      const stats = methodAccuracy[method];
      if (stats.total >= 5) {
        const accuracy = stats.correct / stats.total;
        // Tăng trọng số nếu accuracy cao, giảm nếu thấp
        let adjustment = (accuracy - 0.5) * 0.5;
        adjustment = Math.max(-0.2, Math.min(0.3, adjustment));
        this.adaptiveWeights[method] = Math.max(0.3, Math.min(1.5, this.adaptiveWeights[method] + adjustment));
      }
    }
    
    // Phát hiện deception (bịp)
    const deceptionScore = this.deceptionDetector.detect(lastResults, context);
    if (deceptionScore > 0.6) {
      // Khi nghi ngờ bịp, tăng trọng số anomaly detection
      this.adaptiveWeights.anomaly = Math.min(1.8, this.adaptiveWeights.anomaly + 0.3);
      this.adaptiveWeights.simulation = Math.max(0.5, this.adaptiveWeights.simulation - 0.2);
    }
    
    // Meta-learning: học từ các pattern thay đổi
    this.metaLearner.learn(lastResults, context);
  }

  recordPerformance(method, isCorrect, confidence, context) {
    this.performanceHistory.unshift({
      method,
      isCorrect,
      confidence,
      context,
      timestamp: new Date().toISOString()
    });
    
    if (this.performanceHistory.length > 200) {
      this.performanceHistory = this.performanceHistory.slice(0, 200);
    }
  }

  getAdaptiveWeights() {
    return { ...this.adaptiveWeights };
  }
}

// ==================== PHÁT HIỆN BỊP (DECEPTION DETECTOR) ====================
class DeceptionDetector {
  constructor() {
    this.deceptionPatterns = [];
    this.suspiciousMarkers = [];
  }

  detect(results, context) {
    if (!results || results.length < 15) return 0;
    
    let deceptionScore = 0;
    
    // Dấu hiệu 1: Chuỗi bất thường quá dài hoặc quá ngắn
    let streak = 1;
    for (let i = 1; i < Math.min(results.length, 20); i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    
    if (streak >= 7) deceptionScore += 0.3;
    if (streak >= 10) deceptionScore += 0.3;
    
    // Dấu hiệu 2: Alternating quá hoàn hảo
    let alternatingLength = 1;
    for (let i = 1; i < Math.min(results.length, 15); i++) {
      if (results[i] !== results[i-1]) alternatingLength++;
      else break;
    }
    
    if (alternatingLength >= 8 && alternatingLength <= 12) deceptionScore += 0.25;
    if (alternatingLength >= 12) deceptionScore += 0.35;
    
    // Dấu hiệu 3: Tỷ lệ Tài/Xỉu quá lệch
    const taiCount = results.slice(0, 20).filter(r => r === 'Tài').length;
    const ratio = taiCount / 20;
    
    if (ratio >= 0.8 || ratio <= 0.2) deceptionScore += 0.3;
    if (ratio >= 0.9 || ratio <= 0.1) deceptionScore += 0.2;
    
    // Dấu hiệu 4: Đột biến điểm số
    if (context && context.sums) {
      const sumVolatility = this.calculateVolatility(context.sums);
      if (sumVolatility > 5) deceptionScore += 0.2;
      if (sumVolatility > 8) deceptionScore += 0.25;
    }
    
    return Math.min(0.95, deceptionScore);
  }

  calculateVolatility(sums) {
    if (!sums || sums.length < 5) return 0;
    const recent = sums.slice(0, 10);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
    return Math.sqrt(variance);
  }
}

// ==================== META-LEARNER ====================
class MetaLearner {
  constructor() {
    this.patternLibrary = [];
    this.transitionMatrix = {};
  }

  learn(results, context) {
    if (results.length < 5) return;
    
    // Học pattern mới
    const patternKey = results.slice(0, 5).join('');
    if (!this.transitionMatrix[patternKey]) {
      this.transitionMatrix[patternKey] = { Tai: 0, Xiu: 0 };
    }
    
    if (results.length >= 6) {
      const nextResult = results[5];
      if (nextResult === 'Tài') this.transitionMatrix[patternKey].Tai++;
      else this.transitionMatrix[patternKey].Xiu++;
    }
    
    // Lưu pattern library
    this.patternLibrary.unshift({
      pattern: results.slice(0, 8),
      timestamp: new Date().toISOString(),
      context
    });
    
    if (this.patternLibrary.length > 500) {
      this.patternLibrary = this.patternLibrary.slice(0, 500);
    }
  }

  predictFromPattern(results) {
    if (results.length < 5) return null;
    
    const patternKey = results.slice(0, 5).join('');
    const stats = this.transitionMatrix[patternKey];
    
    if (!stats || (stats.Tai + stats.Xiu) < 3) return null;
    
    const taiProb = stats.Tai / (stats.Tai + stats.Xiu);
    if (taiProb > 0.65) return { prediction: 'Tài', confidence: 55 + Math.round(taiProb * 20) };
    if (taiProb < 0.35) return { prediction: 'Xỉu', confidence: 55 + Math.round((1 - taiProb) * 20) };
    
    return null;
  }
}

// ==================== ANOMALY DETECTION ENGINE ====================
class AnomalyDetector {
  constructor() {
    this.anomalyPatterns = [];
    this.breakPoints = [];
    this.timeWindowStats = {};
    this.reinforcementMemory = { tai: 0, xiu: 0, lastAdjustment: null };
  }

  loadAnomalyData() {
    try {
      if (fs.existsSync(ANOMALY_FILE)) {
        const data = fs.readFileSync(ANOMALY_FILE, 'utf8');
        const parsed = JSON.parse(data);
        this.anomalyPatterns = parsed.anomalyPatterns || [];
        this.breakPoints = parsed.breakPoints || [];
        this.timeWindowStats = parsed.timeWindowStats || {};
        console.log(`[Anomaly] Loaded ${this.anomalyPatterns.length} anomaly patterns, ${this.breakPoints.length} break points`);
      }
    } catch (error) {
      console.error('[Anomaly] Load error:', error.message);
    }
  }

  saveAnomalyData() {
    try {
      fs.writeFileSync(ANOMALY_FILE, JSON.stringify({
        anomalyPatterns: this.anomalyPatterns.slice(-200),
        breakPoints: this.breakPoints.slice(-200),
        timeWindowStats: this.timeWindowStats,
        lastSaved: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      console.error('[Anomaly] Save error:', error.message);
    }
  }

  detectAnomaly(results, windowSize = 10) {
    if (results.length < windowSize) return { isAnomaly: false, score: 0 };
    
    const recent = results.slice(0, windowSize);
    const taiCount = recent.filter(r => r === 'Tài').length;
    const xiuCount = windowSize - taiCount;
    
    const expectedRatio = 0.5;
    const actualRatio = taiCount / windowSize;
    const deviation = Math.abs(actualRatio - expectedRatio);
    
    const isAnomaly = deviation > 0.3;
    const anomalyScore = Math.min(100, deviation * 200);
    
    let breakDetected = false;
    let breakDirection = null;
    
    if (results.length >= 6) {
      const first5 = results.slice(0, 5);
      const sixth = results[5];
      const allSame = first5.every(r => r === first5[0]);
      if (allSame && sixth !== first5[0]) {
        breakDetected = true;
        breakDirection = sixth;
        this.recordBreakPoint(first5[0], sixth, new Date());
      }
    }
    
    let alternatingLength = 1;
    for (let i = 1; i < Math.min(results.length, 15); i++) {
      if (results[i] !== results[i-1]) alternatingLength++;
      else break;
    }
    const isAlternatingAnomaly = alternatingLength >= 8;
    
    return {
      isAnomaly: isAnomaly || breakDetected || isAlternatingAnomaly,
      score: anomalyScore,
      deviation: deviation.toFixed(3),
      taiRatio: (taiCount / windowSize * 100).toFixed(1),
      breakDetected,
      breakDirection,
      alternatingLength,
      isAlternatingAnomaly
    };
  }

  recordBreakPoint(fromType, toType, timestamp) {
    this.breakPoints.push({
      from: fromType,
      to: toType,
      timestamp: timestamp.toISOString(),
      hour: timestamp.getHours(),
      minute: timestamp.getMinutes()
    });
    
    if (this.breakPoints.length > 200) {
      this.breakPoints = this.breakPoints.slice(-200);
    }
    this.saveAnomalyData();
  }

  predictBreakProbability(currentStreak, currentStreakType, currentHour) {
    if (this.breakPoints.length < 10) return 0.3;
    
    const sameHourBreaks = this.breakPoints.filter(b => {
      const hour = new Date(b.timestamp).getHours();
      return hour === currentHour;
    });
    
    const sameTypeBreaks = this.breakPoints.filter(b => b.from === currentStreakType);
    
    let probability = 0.3;
    
    if (sameHourBreaks.length > 0) {
      const hourBreakRate = sameHourBreaks.length / Math.max(1, this.breakPoints.length);
      probability += hourBreakRate * 0.3;
    }
    
    if (sameTypeBreaks.length > 0) {
      const typeBreakRate = sameTypeBreaks.length / Math.max(1, this.breakPoints.filter(b => b.from === currentStreakType).length + 1);
      probability += typeBreakRate * 0.2;
    }
    
    probability += Math.min(0.4, currentStreak / 15);
    
    return Math.min(0.85, probability);
  }

  learnFromResult(prediction, actual, confidence) {
    const isCorrect = prediction === actual;
    
    if (isCorrect) {
      this.reinforcementMemory[prediction === 'Tài' ? 'tai' : 'xiu'] += 1;
      this.reinforcementMemory.lastAdjustment = new Date().toISOString();
    } else {
      const wrongSide = prediction === 'Tài' ? 'tai' : 'xiu';
      this.reinforcementMemory[wrongSide] = Math.max(0, this.reinforcementMemory[wrongSide] - 0.5);
    }
    
    this.reinforcementMemory.tai = Math.min(10, Math.max(-5, this.reinforcementMemory.tai));
    this.reinforcementMemory.xiu = Math.min(10, Math.max(-5, this.reinforcementMemory.xiu));
    
    this.saveAnomalyData();
  }

  getBiasCorrection() {
    const taiScore = this.reinforcementMemory.tai || 0;
    const xiuScore = this.reinforcementMemory.xiu || 0;
    const total = Math.abs(taiScore) + Math.abs(xiuScore);
    
    if (total < 0.5) return 0;
    
    if (taiScore > xiuScore + 1) return 0.15;
    if (xiuScore > taiScore + 1) return -0.15;
    
    return 0;
  }

  updateTimeWindowStats(result, timestamp) {
    const hour = timestamp.getHours();
    const minute = Math.floor(timestamp.getMinutes() / 15) * 15;
    const windowKey = `${hour}:${minute}`;
    
    if (!this.timeWindowStats[windowKey]) {
      this.timeWindowStats[windowKey] = { tai: 0, xiu: 0, total: 0, lastUpdate: timestamp.toISOString() };
    }
    
    if (result === 'Tài') {
      this.timeWindowStats[windowKey].tai++;
    } else {
      this.timeWindowStats[windowKey].xiu++;
    }
    this.timeWindowStats[windowKey].total++;
    this.timeWindowStats[windowKey].lastUpdate = timestamp.toISOString();
    
    this.saveAnomalyData();
  }

  predictByTimeWindow(currentTimestamp) {
    const hour = currentTimestamp.getHours();
    const minute = Math.floor(currentTimestamp.getMinutes() / 15) * 15;
    const windowKey = `${hour}:${minute}`;
    
    const stats = this.timeWindowStats[windowKey];
    if (!stats || stats.total < 5) return null;
    
    const taiRatio = stats.tai / stats.total;
    if (taiRatio > 0.6) return { prediction: 'Tài', confidence: 55 + Math.round(taiRatio * 20) };
    if (taiRatio < 0.4) return { prediction: 'Xỉu', confidence: 55 + Math.round((1 - taiRatio) * 20) };
    
    return null;
  }
}

// ==================== REINFORCEMENT LEARNING ENGINE ====================
class ReinforcementLearner {
  constructor() {
    this.qTable = {};
    this.learningRate = 0.1;
    this.discountFactor = 0.95;
    this.epsilon = 0.2;
  }

  getStateKey(results, patterns) {
    if (!results || results.length === 0) return 'default';
    const last3 = results.slice(0, 3).join('');
    const streak = this.getStreakLength(results);
    const recentTrend = results.slice(0, 5).filter(r => r === 'Tài').length;
    return `${last3}_${streak}_${recentTrend}`;
  }

  getStreakLength(results) {
    if (results.length === 0) return 0;
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    return Math.min(streak, 10);
  }

  getAction(state, possibleActions = ['Tài', 'Xỉu']) {
    if (!this.qTable[state]) {
      this.qTable[state] = { Tài: 0.5, Xỉu: 0.5 };
    }
    
    if (Math.random() < this.epsilon) {
      return possibleActions[Math.floor(Math.random() * possibleActions.length)];
    }
    
    return this.qTable[state].Tài > this.qTable[state].Xỉu ? 'Tài' : 'Xỉu';
  }

  updateQValue(state, action, reward, nextState) {
    if (!this.qTable[state]) {
      this.qTable[state] = { Tài: 0.5, Xỉu: 0.5 };
    }
    if (!this.qTable[nextState]) {
      this.qTable[nextState] = { Tài: 0.5, Xỉu: 0.5 };
    }
    
    const currentQ = this.qTable[state][action];
    const maxNextQ = Math.max(this.qTable[nextState].Tài, this.qTable[nextState].Xỉu);
    const newQ = currentQ + this.learningRate * (reward + this.discountFactor * maxNextQ - currentQ);
    
    this.qTable[state][action] = newQ;
    this.qTable[state][action] = Math.max(0, Math.min(1, this.qTable[state][action]));
  }

  getQLearningPrediction(state) {
    if (!this.qTable[state]) return null;
    if (this.qTable[state].Tài > this.qTable[state].Xỉu + 0.1) return 'Tài';
    if (this.qTable[state].Xỉu > this.qTable[state].Tài + 0.1) return 'Xỉu';
    return null;
  }
}

// ==================== LEARNING DATA STRUCTURE ====================
let learningData = {
  hu: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: []
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: []
  }
};

let simulationEngine = new RealSimulationEngine();
let anomalyDetector = new AnomalyDetector();
let rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
let adaptiveAI = { hu: new AdaptiveSuperAI(), md5: new AdaptiveSuperAI() };
let metaLearner = { hu: new MetaLearner(), md5: new MetaLearner() };

// ==================== HELPER FUNCTIONS ====================
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

function recordPrediction(type, phien, prediction, confidence, factors) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    factors,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
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
      const predictedNormalized = pred.prediction === 'Tài' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        if (learningData[type].streakAnalysis.currentStreak >= 0) learningData[type].streakAnalysis.currentStreak++;
        else learningData[type].streakAnalysis.currentStreak = 1;
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        if (learningData[type].streakAnalysis.currentStreak <= 0) learningData[type].streakAnalysis.currentStreak--;
        else learningData[type].streakAnalysis.currentStreak = -1;
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) learningData[type].recentAccuracy.shift();
      
      const stateKey = rlLearner[type].getStateKey(
        currentData.slice(0, 10).map(d => d.Ket_qua), []
      );
      const reward = pred.isCorrect ? 1 : -1;
      const nextState = stateKey;
      rlLearner[type].updateQValue(stateKey, pred.prediction, reward, nextState);
      
      anomalyDetector.learnFromResult(pred.prediction, pred.actual, pred.confidence);
      anomalyDetector.updateTimeWindowStats(pred.actual, new Date(pred.timestamp));
      
      // Ghi nhận cho adaptive AI
      adaptiveAI[type].recordPerformance('general', pred.isCorrect, pred.confidence, {});
      
      updated = true;
    }
  }
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
    anomalyDetector.saveAnomalyData();
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Error saving learning data:', error.message);
  }
}

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('Learning data loaded');
    }
  } catch (error) {
    console.error('Error loading learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('Prediction history loaded');
    }
  } catch (error) {
    console.error('Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (error) {
    console.error('Error saving prediction history:', error.message);
  }
}

// ==================== PATTERN ANALYSIS FUNCTIONS ====================
function detectBreakPattern(results, type) {
  if (results.length < 6) return null;
  
  const pattern = results.slice(0, 8);
  let breakDetected = false;
  let prediction = null;
  let confidence = 55;
  
  if (pattern[0] === pattern[1] && pattern[2] === pattern[3] && pattern[0] !== pattern[2]) {
    if (pattern[4] === pattern[5] && pattern[4] !== pattern[2]) {
      breakDetected = true;
      prediction = pattern[4];
      confidence = 70;
    }
  }
  
  if (pattern[0] === pattern[1] && pattern[1] === pattern[2] && pattern[3] !== pattern[0]) {
    breakDetected = true;
    prediction = pattern[3] === 'Tài' ? 'Xỉu' : 'Tài';
    confidence = 75;
  }
  
  let alternatingCount = 1;
  for (let i = 1; i < Math.min(results.length, 12); i++) {
    if (results[i] !== results[i-1]) alternatingCount++;
    else break;
  }
  if (alternatingCount >= 6 && alternatingCount <= 9) {
    breakDetected = true;
    prediction = results[0];
    confidence = 68;
  }
  if (alternatingCount >= 10) {
    breakDetected = true;
    prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    confidence = 72;
  }
  
  return breakDetected ? { prediction, confidence, name: 'Break Pattern' } : null;
}

function detectTrendReversal(results, type) {
  if (results.length < 8) return null;
  
  const last8 = results.slice(0, 8);
  const first4 = last8.slice(0, 4);
  const last4 = last8.slice(4, 8);
  
  const first4Tai = first4.filter(r => r === 'Tài').length;
  const last4Tai = last4.filter(r => r === 'Tài').length;
  
  if ((first4Tai >= 3 && last4Tai <= 1) || (first4Tai <= 1 && last4Tai >= 3)) {
    const prediction = last4Tai >= 3 ? 'Tài' : 'Xỉu';
    return { prediction, confidence: 68, name: 'Trend Reversal' };
  }
  
  return null;
}

function analyzeSimplePattern(results) {
  if (results.length < 3) return { prediction: results[0] || 'Tài', confidence: 50 };
  
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  if (streak >= 3) {
    const shouldBreak = streak >= 5;
    return { 
      prediction: shouldBreak ? (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : results[0],
      confidence: 55 + Math.min(15, streak * 2),
      name: `Streak ${streak}`
    };
  }
  
  let alternating = true;
  for (let i = 1; i < Math.min(results.length, 6); i++) {
    if (results[i] === results[i-1]) {
      alternating = false;
      break;
    }
  }
  if (alternating && results.length >= 4) {
    return {
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 60,
      name: 'Alternating'
    };
  }
  
  return {
    prediction: results[0],
    confidence: 50,
    name: 'Follow Previous'
  };
}

// ==================== MAIN PREDICTION FUNCTION ====================
function calculateSuperPrediction(data, type) {
  const results = data.slice(0, 30).map(d => d.Ket_qua);
  const sums = data.slice(0, 30).map(d => d.Tong);
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  
  let predictions = [];
  let factors = [];
  
  // 1. Simulation thật 10 phiên gần nhất (thay thế Monte Carlo)
  const simulationResult = simulationEngine.runRealSimulation(data, 10000);
  predictions.push({ 
    prediction: simulationResult.prediction, 
    confidence: simulationResult.confidence, 
    priority: 10, 
    name: `RealSim(10phiên)` 
  });
  factors.push(`SIM: ${(parseFloat(simulationResult.taiProbability) * 100).toFixed(0)}% Tài`);
  
  // 2. Pattern Analysis
  const simplePattern = analyzeSimplePattern(results);
  predictions.push({ prediction: simplePattern.prediction, confidence: simplePattern.confidence, priority: 7, name: simplePattern.name });
  factors.push(`Pattern: ${simplePattern.name}`);
  
  // 3. Break Pattern
  const breakPattern = detectBreakPattern(results, type);
  if (breakPattern) {
    predictions.push({ prediction: breakPattern.prediction, confidence: breakPattern.confidence, priority: 9, name: breakPattern.name });
    factors.push(`Break: ${breakPattern.name}`);
  }
  
  // 4. Trend Reversal
  const trendReversal = detectTrendReversal(results, type);
  if (trendReversal) {
    predictions.push({ prediction: trendReversal.prediction, confidence: trendReversal.confidence, priority: 8, name: trendReversal.name });
    factors.push(`Reversal: ${trendReversal.name}`);
  }
  
  // 5. Meta-Learning từ pattern library
  const metaPrediction = metaLearner[type].predictFromPattern(results);
  if (metaPrediction) {
    predictions.push({ prediction: metaPrediction.prediction, confidence: metaPrediction.confidence, priority: 8, name: 'Meta-Learning' });
    factors.push(`Meta: ${metaPrediction.prediction}`);
  }
  
  // 6. Time Window stats
  const timePrediction = anomalyDetector.predictByTimeWindow(currentTime);
  if (timePrediction) {
    predictions.push({ prediction: timePrediction.prediction, confidence: timePrediction.confidence, priority: 6, name: 'Time Window' });
    factors.push(`Time: ${timePrediction.prediction} ${timePrediction.confidence}%`);
  }
  
  // 7. Anomaly Detection
  const anomaly = anomalyDetector.detectAnomaly(results, 10);
  if (anomaly.isAnomaly) {
    factors.push(`⚠️ Anomaly (${anomaly.taiRatio}% Tài, break:${anomaly.breakDetected})`);
    if (anomaly.breakDetected && anomaly.breakDirection) {
      predictions.push({ 
        prediction: anomaly.breakDirection, 
        confidence: 70, 
        priority: 9, 
        name: 'Anomaly Break' 
      });
    }
    if (anomaly.isAlternatingAnomaly) {
      const altPrediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      predictions.push({ prediction: altPrediction, confidence: 68, priority: 8, name: 'Alternating Anomaly' });
    }
  }
  
  // 8. Q-Learning Reinforcement
  const stateKey = rlLearner[type].getStateKey(results, []);
  const qPrediction = rlLearner[type].getQLearningPrediction(stateKey);
  if (qPrediction) {
    predictions.push({ prediction: qPrediction, confidence: 62, priority: 6, name: 'Q-Learning' });
    factors.push(`RL: ${qPrediction}`);
  }
  
  // 9. Adaptive Weights từ Super AI
  adaptiveAI[type].adaptWeights(results, { sums });
  const weights = adaptiveAI[type].getAdaptiveWeights();
  
  // Tính tổng hợp có trọng số
  let taiScore = 0, xiuScore = 0;
  predictions.forEach(p => {
    const weight = p.priority * (weights[p.name?.toLowerCase().includes('sim') ? 'simulation' : 
                                   p.name?.toLowerCase().includes('pattern') ? 'pattern' :
                                   p.name?.toLowerCase().includes('anomaly') ? 'anomaly' :
                                   p.name?.toLowerCase().includes('reversal') ? 'trend' : 'qlearning'] || 1.0);
    if (p.prediction === 'Tài') taiScore += p.confidence * weight;
    else xiuScore += p.confidence * weight;
  });
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // Bias correction
  const biasCorrection = anomalyDetector.getBiasCorrection();
  if (biasCorrection > 0.1 && finalPrediction === 'Xỉu') {
    finalPrediction = 'Tài';
    factors.push(`Bias: +Tài`);
  } else if (biasCorrection < -0.1 && finalPrediction === 'Tài') {
    finalPrediction = 'Xỉu';
    factors.push(`Bias: +Xỉu`);
  }
  
  // Phát hiện bịp - điều chỉnh dự đoán
  const deceptionScore = adaptiveAI[type].deceptionDetector.detect(results, { sums });
  if (deceptionScore > 0.7) {
    // Khi bịp nặng, đảo ngược dự đoán với confidence thấp hơn
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    factors.push(`⚠️ DECEPTION DETECTED (${(deceptionScore * 100).toFixed(0)}%) - Reversed`);
  } else if (deceptionScore > 0.5) {
    factors.push(`⚠️ Suspicious (${(deceptionScore * 100).toFixed(0)}%)`);
  }
  
  const totalScore = taiScore + xiuScore;
  let finalConfidence = totalScore > 0 ? Math.round(Math.max(taiScore, xiuScore) / totalScore * 100) : 55;
  finalConfidence = Math.max(50, Math.min(88, finalConfidence));
  
  // Điều chỉnh confidence dựa trên deception
  if (deceptionScore > 0.7) finalConfidence = Math.max(50, finalConfidence - 15);
  else if (deceptionScore > 0.5) finalConfidence = Math.max(50, finalConfidence - 8);
  
  return { 
    prediction: finalPrediction, 
    confidence: finalConfidence, 
    factors, 
    allPredictions: predictions,
    simulationDetails: simulationResult,
    deceptionScore: deceptionScore.toFixed(2)
  };
}

// ==================== AUTO PROCESS ====================
async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateSuperPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | SIM: ${result.simulationDetails.taiProbability} | ${result.factors.slice(0,2).join(', ')}`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateSuperPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | SIM: ${result.simulationDetails.taiProbability} | ${result.factors.slice(0,2).join(', ')}`);
      }
    }
    
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

// ==================== EXPRESS ROUTES ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('kapub');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
    await verifyPredictions('hu', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateSuperPrediction(data, 'hu');
    savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: 'kapub',
      simulation: result.simulationDetails,
      deception_score: result.deceptionScore
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
    await verifyPredictions('md5', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateSuperPrediction(data, 'md5');
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: 'kapub',
      simulation: result.simulationDetails,
      deception_score: result.deceptionScore
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (data && data.length > 0) await verifyPredictions('hu', data);
    const historyWithStatus = predictionHistory.hu.map(record => {
      const prediction = learningData.hu.predictions.find(p => p.phien === record.phien_hien_tai);
      return {
        ...record,
        ket_qua_thuc_te: prediction?.actual || null,
        status: prediction?.isCorrect === true ? '✅' : (prediction?.isCorrect === false ? '❌' : null)
      };
    });
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: historyWithStatus, total: historyWithStatus.length });
  } catch (error) {
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (data && data.length > 0) await verifyPredictions('md5', data);
    const historyWithStatus = predictionHistory.md5.map(record => {
      const prediction = learningData.md5.predictions.find(p => p.phien === record.phien_hien_tai);
      return {
        ...record,
        ket_qua_thuc_te: prediction?.actual || null,
        status: prediction?.isCorrect === true ? '✅' : (prediction?.isCorrect === false ? '❌' : null)
      };
    });
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: historyWithStatus, total: historyWithStatus.length });
  } catch (error) {
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
  }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    await verifyPredictions('hu', data);
    const result = calculateSuperPrediction(data, 'hu');
    res.json({ 
      prediction: normalizeResult(result.prediction), 
      confidence: result.confidence, 
      factors: result.factors,
      simulation: result.simulationDetails,
      weights: adaptiveAI.hu.getAdaptiveWeights()
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
    const result = calculateSuperPrediction(data, 'md5');
    res.json({ 
      prediction: normalizeResult(result.prediction), 
      confidence: result.confidence, 
      factors: result.factors,
      simulation: result.simulationDetails,
      weights: adaptiveAI.md5.getAdaptiveWeights()
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/learning', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(2) : 0;
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    adaptiveWeights: adaptiveAI.hu.getAdaptiveWeights(),
    lastUpdate: stats.lastUpdate
  });
});

app.get('/lc79-md5/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(2) : 0;
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5 - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    adaptiveWeights: adaptiveAI.md5.getAdaptiveWeights(),
    lastUpdate: stats.lastUpdate
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] }
  };
  simulationEngine = new RealSimulationEngine();
  anomalyDetector = new AnomalyDetector();
  rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
  adaptiveAI = { hu: new AdaptiveSuperAI(), md5: new AdaptiveSuperAI() };
  metaLearner = { hu: new MetaLearner(), md5: new MetaLearner() };
  saveLearningData();
  res.json({ message: 'All learning data reset' });
});

// ==================== START SERVER ====================
loadLearningData();
loadPredictionHistory();
anomalyDetector.loadAnomalyData();
simulationEngine.loadSimulationData();

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║   LẨU CUA 79 - SIÊU AI ADAPTIVE v7.0 - REAL SIMULATION 10 PHIÊN GẦN NHẤT   ║`);
  console.log(`║   ✅ Simulation thật 10 phiên gần nhất (thay thế Monte Carlo)              ║`);
  console.log(`║   ✅ Adaptive Super AI với Meta-Learning                                   ║`);
  console.log(`║   ✅ Deception Detection - Phát hiện bịp thông minh                        ║`);
  console.log(`║   ✅ Anomaly Detection + Break Pattern Learning                            ║`);
  console.log(`║   ✅ Q-Learning Reinforcement + Bias Correction                            ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server: http://0.0.0.0:${PORT}`);
  console.log(`\n🔥 THAY ĐỔI CHÍNH:`);
  console.log(`   • REPLACE Monte Carlo → Real Simulation 10 phiên gần nhất`);
  console.log(`   • 60% Bootstrap từ 10 phiên thực tế`);
  console.log(`   • 25% Pattern-based simulation`);
  console.log(`   • 15% Markov Chain simulation`);
  console.log(`   • Meta-Learning từ pattern library`);
  console.log(`   • Deception Detection - phát hiện game bịp`);
  console.log(`   • Adaptive weights tự điều chỉnh theo hiệu suất\n`);
  console.log(`📋 ENDPOINTS:`);
  console.log(`   GET /lc79-hu         - Dự đoán Tài Xỉu Hũ (có simulation)`);
  console.log(`   GET /lc79-md5        - Dự đoán Tài Xỉu MD5`);
  console.log(`   GET /lc79-hu/lichsu  - Lịch sử dự đoán Hũ`);
  console.log(`   GET /lc79-md5/lichsu - Lịch sử dự đoán MD5`);
  console.log(`   GET /lc79-hu/analysis- Phân tích chi tiết + weights`);
  console.log(`   GET /lc79-hu/learning- Thống kê học tập + adaptive weights`);
  console.log(`   GET /reset-learning   - Reset dữ liệu học\n`);
});
