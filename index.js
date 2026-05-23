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
const BACKTEST_FILE = 'backtest_results.json';
const META_MODEL_FILE = 'meta_model.json';
const ONLINE_WEIGHTS_FILE = 'online_weights.json';
const NEURAL_FILE = 'neural_models.json';
const ATTENTION_FILE = 'attention_models.json';

// ==================== CONFIGURATION ====================
const CONFIG = {
  MAX_CONFIDENCE: 80,
  MIN_PATTERNS: 5,
  ENSEMBLE_MIN_AGREEMENT: 1,
  SMOOTHING_WINDOW: 5,
  MAX_HISTORY: 300,
  AUTO_SAVE_INTERVAL: 15000,
  BACKTEST_INTERVAL: 600000,
  CLEANUP_INTERVAL: 21600000,
  META_LEARNING_RATE: 0.02,
  META_UPDATE_INTERVAL: 25,
  REGIME_WINDOW: 20,
  FALLBACK_CONFIDENCE: 52,
  RESET_THRESHOLD_ACC: 0.45,
  MARKOV_ORDER: 2,
};

let metaModelUpdated = 0;
let predictionProbBuffer = { hu: [0.5, 0.5, 0.5, 0.5, 0.5], md5: [0.5, 0.5, 0.5, 0.5, 0.5] };

// ==================== AI ALGORITHM 1: NEURAL NETWORK ====================
class NeuralNetwork {
  constructor(inputSize = 10, hiddenSize1 = 12, hiddenSize2 = 8) {
    this.inputSize = inputSize;
    this.hiddenSize1 = hiddenSize1;
    this.hiddenSize2 = hiddenSize2;
    
    this.W1 = Array.from({ length: hiddenSize1 }, () => Array(inputSize).fill(0).map(() => Math.random() * 0.2 - 0.1));
    this.b1 = Array(hiddenSize1).fill(0);
    this.W2 = Array.from({ length: hiddenSize2 }, () => Array(hiddenSize1).fill(0).map(() => Math.random() * 0.2 - 0.1));
    this.b2 = Array(hiddenSize2).fill(0);
    this.W3 = Array(2).fill().map(() => Array(hiddenSize2).fill(0).map(() => Math.random() * 0.2 - 0.1));
    this.b3 = [0, 0];
    this.lr = 0.01;
    this.momentumW1 = null; this.momentumW2 = null; this.momentumW3 = null;
    this.momentumB1 = null; this.momentumB2 = null; this.momentumB3 = null;
    this.initMomentum();
  }

  initMomentum() {
    this.momentumW1 = this.W1.map(row => row.map(() => 0));
    this.momentumW2 = this.W2.map(row => row.map(() => 0));
    this.momentumW3 = this.W3.map(row => row.map(() => 0));
    this.momentumB1 = this.b1.map(() => 0);
    this.momentumB2 = this.b2.map(() => 0);
    this.momentumB3 = this.b3.map(() => 0);
  }

  relu(x) { return Math.max(0, x); }
  reluDeriv(x) { return x > 0 ? 1 : 0; }
  
  softmax(x) {
    const exp = x.map(v => Math.exp(v - Math.max(...x)));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  }

  forward(x) {
    let z1 = this.b1.map((b, i) => b + this.W1[i].reduce((sum, w, j) => sum + w * x[j], 0));
    let a1 = z1.map(this.relu);
    let z2 = this.b2.map((b, i) => b + this.W2[i].reduce((sum, w, j) => sum + w * a1[j], 0));
    let a2 = z2.map(this.relu);
    let z3 = this.b3.map((b, i) => b + this.W3[i].reduce((sum, w, j) => sum + w * a2[j], 0));
    let a3 = this.softmax(z3);
    return { z1, a1, z2, a2, z3, a3 };
  }

  backward(x, y_true, cache) {
    const { a1, a2, a3, z1, z2 } = cache;
    const grad3 = a3.map((p, i) => p - (i === y_true ? 1 : 0));
    
    const dW3 = this.W3.map((row, i) => row.map((_, j) => grad3[i] * a2[j]));
    const db3 = grad3;
    
    const grad2 = this.W3.reduce((grad, row, i) => {
      row.forEach((w, j) => grad[j] = (grad[j] || 0) + grad3[i] * w);
      return grad;
    }, new Array(this.hiddenSize2).fill(0));
    const grad2_act = grad2.map((g, i) => g * this.reluDeriv(z2[i]));
    const dW2 = this.W2.map((row, i) => row.map((_, j) => grad2_act[i] * a1[j]));
    const db2 = grad2_act;
    
    const grad1 = this.W2.reduce((grad, row, i) => {
      row.forEach((w, j) => grad[j] = (grad[j] || 0) + grad2_act[i] * w);
      return grad;
    }, new Array(this.hiddenSize1).fill(0));
    const grad1_act = grad1.map((g, i) => g * this.reluDeriv(z1[i]));
    const dW1 = this.W1.map((row, i) => row.map((_, j) => grad1_act[i] * x[j]));
    const db1 = grad1_act;
    
    const momentum = 0.9;
    for (let i = 0; i < this.W1.length; i++) {
      for (let j = 0; j < this.W1[i].length; j++) {
        this.momentumW1[i][j] = momentum * this.momentumW1[i][j] - this.lr * dW1[i][j];
        this.W1[i][j] += this.momentumW1[i][j];
      }
    }
    for (let i = 0; i < this.b1.length; i++) {
      this.momentumB1[i] = momentum * this.momentumB1[i] - this.lr * db1[i];
      this.b1[i] += this.momentumB1[i];
    }
    for (let i = 0; i < this.W2.length; i++) {
      for (let j = 0; j < this.W2[i].length; j++) {
        this.momentumW2[i][j] = momentum * this.momentumW2[i][j] - this.lr * dW2[i][j];
        this.W2[i][j] += this.momentumW2[i][j];
      }
    }
    for (let i = 0; i < this.b2.length; i++) {
      this.momentumB2[i] = momentum * this.momentumB2[i] - this.lr * db2[i];
      this.b2[i] += this.momentumB2[i];
    }
    for (let i = 0; i < this.W3.length; i++) {
      for (let j = 0; j < this.W3[i].length; j++) {
        this.momentumW3[i][j] = momentum * this.momentumW3[i][j] - this.lr * dW3[i][j];
        this.W3[i][j] += this.momentumW3[i][j];
      }
    }
    for (let i = 0; i < this.b3.length; i++) {
      this.momentumB3[i] = momentum * this.momentumB3[i] - this.lr * db3[i];
      this.b3[i] += this.momentumB3[i];
    }
  }

  train(features, targetTai) {
    const x = features.slice(0, this.inputSize);
    const y = targetTai ? 0 : 1;
    const cache = this.forward(x);
    this.backward(x, y, cache);
  }

  predict(features) {
    const x = features.slice(0, this.inputSize);
    const { a3 } = this.forward(x);
    const taiProb = a3[0];
    const prediction = taiProb > 0.5 ? 'Tài' : 'Xỉu';
    const confidence = 50 + Math.abs(taiProb - 0.5) * 60;
    return { prediction, confidence: Math.min(80, Math.round(confidence)) };
  }

  save() {
    return { W1: this.W1, b1: this.b1, W2: this.W2, b2: this.b2, W3: this.W3, b3: this.b3, lr: this.lr };
  }

  load(data) {
    if (data) {
      this.W1 = data.W1; this.b1 = data.b1; this.W2 = data.W2; this.b2 = data.b2;
      this.W3 = data.W3; this.b3 = data.b3; this.lr = data.lr || 0.01;
      this.initMomentum();
    }
  }
}

// ==================== AI ALGORITHM 2: ATTENTION MECHANISM ====================
class AttentionModel {
  constructor(windowSize = 20) {
    this.windowSize = windowSize;
    this.attentionWeights = Array(windowSize).fill(1 / windowSize);
    this.keyHistory = [];
    this.query = null;
    this.lr = 0.01;
  }

  embedResult(result, sumValue = 10) {
    return [result === 'Tài' ? 1 : 0, (sumValue - 10.5) / 4];
  }

  update(results, sums) {
    const seq = results.slice(0, this.windowSize);
    const sumSeq = sums.slice(0, this.windowSize);
    this.keyHistory = seq.map((r, i) => this.embedResult(r, sumSeq[i] || 10));
    if (seq.length > 0) {
      this.query = this.embedResult(seq[0], sumSeq[0] || 10);
    }
  }

  dotProduct(a, b) { return a[0] * b[0] + a[1] * b[1]; }

  train(actualNextResult, actualNextSum) {
    if (!this.query || this.keyHistory.length === 0) return;
    const targetEmb = this.embedResult(actualNextResult, actualNextSum);
    let scores = this.keyHistory.map(k => this.dotProduct(this.query, k));
    const sumScores = scores.reduce((a, b) => a + b, 0) + 1e-8;
    const attn = scores.map(s => s / sumScores);
    let predEmb = [0, 0];
    for (let i = 0; i < attn.length; i++) {
      predEmb[0] += attn[i] * this.keyHistory[i][0];
      predEmb[1] += attn[i] * this.keyHistory[i][1];
    }
    const error0 = targetEmb[0] - predEmb[0];
    const error1 = targetEmb[1] - predEmb[1];
    for (let i = 0; i < this.attentionWeights.length; i++) {
      const grad = error0 * this.keyHistory[i][0] + error1 * this.keyHistory[i][1];
      this.attentionWeights[i] += this.lr * grad;
    }
    const total = this.attentionWeights.reduce((a, b) => a + b, 0);
    if (total > 0) this.attentionWeights = this.attentionWeights.map(w => w / total);
  }

  predict() {
    if (!this.query || this.keyHistory.length === 0) return null;
    let scores = this.keyHistory.map(k => this.dotProduct(this.query, k));
    const sumScores = scores.reduce((a, b) => a + b, 0) + 1e-8;
    const attn = scores.map(s => s / sumScores);
    const weightedAttn = attn.map((a, i) => a * this.attentionWeights[i]);
    const total = weightedAttn.reduce((a, b) => a + b, 0);
    const finalAttn = total > 0 ? weightedAttn.map(w => w / total) : attn;
    let predEmb = [0, 0];
    for (let i = 0; i < finalAttn.length; i++) {
      predEmb[0] += finalAttn[i] * this.keyHistory[i][0];
      predEmb[1] += finalAttn[i] * this.keyHistory[i][1];
    }
    const probTai = predEmb[0];
    const confidence = 50 + Math.abs(probTai - 0.5) * 70;
    return {
      prediction: probTai > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.min(80, Math.round(confidence))
    };
  }
}

// ==================== MARKOV CHAIN ====================
class MarkovChain {
  constructor(order = 2) {
    this.order = order;
    this.transitions = {};
  }

  train(data) {
    if (!data || data.length < this.order + 1) return;
    for (let i = 0; i <= data.length - this.order - 1; i++) {
      const state = data.slice(i, i + this.order).join('');
      const next = data[i + this.order];
      if (!this.transitions[state]) this.transitions[state] = { T: 0, X: 0, total: 0 };
      this.transitions[state][next]++;
      this.transitions[state].total++;
    }
  }

  predict(lastN) {
    if (!lastN || lastN.length < this.order) return null;
    const state = lastN.slice(0, this.order).join('');
    const trans = this.transitions[state];
    if (!trans || trans.total < 3) return null;
    const probT = trans.T / trans.total;
    if (probT > 0.55) return { prediction: 'Tài', confidence: Math.round(50 + probT * 30) };
    if (probT < 0.45) return { prediction: 'Xỉu', confidence: Math.round(50 + (1 - probT) * 30) };
    return null;
  }

  save(filePath) {
    try { fs.writeFileSync(filePath, JSON.stringify({ order: this.order, transitions: this.transitions })); } catch (e) {}
  }

  load(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        this.order = data.order || 2;
        this.transitions = data.transitions || {};
      }
    } catch (e) {}
  }
}

// ==================== ANOMALY DETECTOR ====================
class AnomalyDetector {
  constructor() {
    this.anomalyPatterns = [];
    this.breakPoints = [];
    this.timeWindowStats = {};
    this.reinforcementMemory = { tai: 0, xiu: 0, lastAdjustment: null };
    this.confidenceHistory = { ensemble: {} };
    this.featureWeights = { trend: 30, balance: 25, entropy: 15, streak: 15, sumTrend: 15, momentum: 10 };
  }

  loadAnomalyData() {
    try {
      if (fs.existsSync(ANOMALY_FILE)) {
        const data = JSON.parse(fs.readFileSync(ANOMALY_FILE, 'utf8'));
        this.anomalyPatterns = data.anomalyPatterns || [];
        this.breakPoints = data.breakPoints || [];
        this.timeWindowStats = data.timeWindowStats || {};
        this.featureWeights = data.featureWeights || this.featureWeights;
        this.confidenceHistory = data.confidenceHistory || { ensemble: {} };
        this.reinforcementMemory = data.reinforcementMemory || { tai: 0, xiu: 0 };
      }
    } catch (error) {}
  }

  saveAnomalyData() {
    try {
      fs.writeFileSync(ANOMALY_FILE, JSON.stringify({
        anomalyPatterns: this.anomalyPatterns.slice(-300),
        breakPoints: this.breakPoints.slice(-300),
        timeWindowStats: this.timeWindowStats,
        featureWeights: this.featureWeights,
        confidenceHistory: this.confidenceHistory,
        reinforcementMemory: this.reinforcementMemory
      }, null, 2));
    } catch (error) {}
  }

  detectAnomaly(results, sums = [], windowSize = 10) {
    if (results.length < windowSize) return { isAnomaly: false, score: 0 };
    const recent = results.slice(0, windowSize);
    const taiCount = recent.filter(r => r === 'Tài').length;
    const expectedMean = windowSize * 0.5;
    const expectedStd = Math.sqrt(windowSize * 0.5 * 0.5);
    const zScore = expectedStd > 0 ? Math.abs((taiCount - expectedMean) / expectedStd) : 0;
    const isStatisticalAnomaly = zScore > 1.8;
    let breakDetected = false;
    let breakDirection = null;
    if (results.length >= 7) {
      const streak = this.getCurrentStreak(results);
      if (streak >= 4 && results[streak] !== results[0]) {
        breakDetected = true;
        breakDirection = results[streak];
      }
    }
    return {
      isAnomaly: isStatisticalAnomaly || breakDetected,
      score: Math.min(100, (zScore / 3) * 100),
      zScore: zScore.toFixed(2),
      breakDetected,
      breakDirection
    };
  }

  getCurrentStreak(results) {
    if (results.length === 0) return 0;
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    return streak;
  }

  getAlternatingLength(results) {
    let length = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] !== results[i - 1]) length++;
      else break;
    }
    return length;
  }

  recordBreakPoint(fromType, toType, timestamp) {
    this.breakPoints.push({ from: fromType, to: toType, timestamp: timestamp.toISOString() });
    if (this.breakPoints.length > 500) this.breakPoints = this.breakPoints.slice(-500);
  }

  learnFromResult(prediction, actual, confidence, featuresUsed = null) {
    const isCorrect = prediction === actual;
    if (isCorrect) {
      if (prediction === 'Tài') this.reinforcementMemory.tai += 0.06;
      else this.reinforcementMemory.xiu += 0.06;
    } else {
      if (prediction === 'Tài') this.reinforcementMemory.tai -= 0.07;
      else this.reinforcementMemory.xiu -= 0.07;
    }
    this.reinforcementMemory.tai = Math.max(-2, Math.min(2, this.reinforcementMemory.tai));
    this.reinforcementMemory.xiu = Math.max(-2, Math.min(2, this.reinforcementMemory.xiu));
    const bucket = Math.floor(confidence / 5) * 5;
    if (!this.confidenceHistory.ensemble[bucket]) this.confidenceHistory.ensemble[bucket] = { correct: 0, total: 0 };
    this.confidenceHistory.ensemble[bucket].total++;
    if (isCorrect) this.confidenceHistory.ensemble[bucket].correct++;
    this.saveAnomalyData();
  }

  calibrateConfidence(rawConfidence, method) {
    if (!this.confidenceHistory[method]) return rawConfidence;
    const sorted = Object.entries(this.confidenceHistory[method]).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    if (sorted.length < 3) return rawConfidence;
    const raw = rawConfidence / 100;
    let lower = null, upper = null;
    for (let i = 0; i < sorted.length; i++) {
      const [key, stats] = sorted[i];
      const bucketMid = parseInt(key) / 100;
      if (bucketMid <= raw) lower = { mid: bucketMid, acc: stats.total > 0 ? stats.correct / stats.total : bucketMid };
      if (bucketMid >= raw && !upper) upper = { mid: bucketMid, acc: stats.total > 0 ? stats.correct / stats.total : bucketMid };
    }
    if (!lower || !upper) return rawConfidence;
    let calibrated = lower.acc;
    if (upper.mid - lower.mid > 0) {
      calibrated = lower.acc + (upper.acc - lower.acc) * ((raw - lower.mid) / (upper.mid - lower.mid));
    }
    return Math.min(80, Math.max(52, Math.round(calibrated * 100)));
  }

  getBiasCorrection() {
    const diff = (this.reinforcementMemory.tai || 0) - (this.reinforcementMemory.xiu || 0);
    return Math.max(-0.12, Math.min(0.12, diff * 0.04));
  }

  updateTimeWindowStats(result, timestamp) {
    const hour = timestamp.getHours();
    const minute = Math.floor(timestamp.getMinutes() / 15) * 15;
    const windowKey = `${hour}:${String(minute).padStart(2, '0')}`;
    if (!this.timeWindowStats[windowKey]) this.timeWindowStats[windowKey] = { tai: 0, xiu: 0, total: 0 };
    if (result === 'Tài') this.timeWindowStats[windowKey].tai++;
    else this.timeWindowStats[windowKey].xiu++;
    this.timeWindowStats[windowKey].total++;
  }

  predictByTimeWindow(currentTimestamp) {
    const hour = currentTimestamp.getHours();
    const minute = Math.floor(currentTimestamp.getMinutes() / 15) * 15;
    const windowKey = `${hour}:${String(minute).padStart(2, '0')}`;
    const stats = this.timeWindowStats[windowKey];
    if (!stats || stats.total < 5) return null;
    const taiRatio = stats.tai / stats.total;
    if (taiRatio > 0.58) return { prediction: 'Tài', confidence: 50 + Math.round(taiRatio * 25) };
    if (taiRatio < 0.42) return { prediction: 'Xỉu', confidence: 50 + Math.round((1 - taiRatio) * 25) };
    return null;
  }
}

// ==================== BALANCED MONTE CARLO ====================
class BalancedMonteCarlo {
  constructor(historicalData, windowSize = 50) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.numSimulations = 8000;
    this.minPatterns = CONFIG.MIN_PATTERNS;
  }

  extractBalancedFeatures(data, skipLatest = false) {
    if (!data || data.length < 9) return null;
    const analysisData = skipLatest ? data.slice(1) : data;
    if (analysisData.length < this.windowSize) return null;
    const windowData = analysisData.slice(0, this.windowSize);
    const results = windowData.map(d => d.Ket_qua);
    const sums = windowData.map(d => d.Tong);
    const taiCount = results.filter(r => r === 'Tài').length;
    const balanceRatio = Math.min(taiCount, results.length - taiCount) / Math.max(Math.max(taiCount, results.length - taiCount), 1);
    const last5 = results.slice(0, 5);
    const last5Tai = last5.filter(r => r === 'Tài').length;
    const ma5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = sums.length >= 10 ? sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10 : ma5;
    let currentStreak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) currentStreak++;
      else break;
    }
    return { last5TaiCount: last5Tai, balanceRatio, currentStreak: Math.min(currentStreak, 15), ma5, ma10 };
  }

  findBalancedPatterns(currentFeatures, maxMatches = 100) {
    const matches = [];
    for (let i = 0; i <= this.historicalData.length - this.windowSize - 1; i++) {
      const windowData = this.historicalData.slice(i, i + this.windowSize);
      const windowFeatures = this.extractBalancedFeatures(windowData);
      if (!windowFeatures) continue;
      let similarity = 0;
      const streakDiff = Math.abs(windowFeatures.currentStreak - currentFeatures.currentStreak);
      similarity += Math.max(0, 25 - streakDiff * 3);
      const balanceDiff = Math.abs(windowFeatures.balanceRatio - currentFeatures.balanceRatio);
      similarity += Math.max(0, 25 - balanceDiff * 50);
      if (similarity > 15) {
        matches.push({
          similarity,
          nextResult: this.historicalData[i + this.windowSize]?.Ket_qua,
          recency: i / this.historicalData.length
        });
      }
    }
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, maxMatches);
  }

  runBalancedSimulation(data, anomalyDetector, currentHour) {
    const currentFeatures = this.extractBalancedFeatures(data, true);
    if (!currentFeatures || this.historicalData.length < 30) {
      return this.weightedFallback(data.slice(1));
    }
    const similarPatterns = this.findBalancedPatterns(currentFeatures, 100);
    if (similarPatterns.length < this.minPatterns) {
      return this.weightedFallback(data.slice(1));
    }
    let taiWins = 0, xiuWins = 0, totalWeight = 0;
    for (const pattern of similarPatterns) {
      let weight = Math.pow(pattern.similarity / 100, 1.3);
      weight *= (1 - pattern.recency * 0.5);
      totalWeight += weight;
      if (pattern.nextResult === 'Tài') taiWins += weight;
      else if (pattern.nextResult === 'Xỉu') xiuWins += weight;
    }
    if (totalWeight === 0) return this.weightedFallback(data.slice(1));
    const taiProbability = taiWins / totalWeight;
    const rawConfidence = 45 + Math.abs(taiProbability - 0.5) * 90;
    const finalConfidence = Math.min(CONFIG.MAX_CONFIDENCE, Math.max(CONFIG.FALLBACK_CONFIDENCE, Math.round(rawConfidence)));
    return {
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      confidence: finalConfidence,
      similarPatternsCount: similarPatterns.length,
      method: 'balanced_monte_carlo'
    };
  }

  weightedFallback(data) {
    const last20Results = data.slice(0, 20).map(d => d.Ket_qua);
    const weightedResults = last20Results.map((r, i) => ({ result: r, weight: Math.exp(-i / 10) }));
    const weightedTaiCount = weightedResults.reduce((sum, item) => sum + (item.result === 'Tài' ? item.weight : 0), 0);
    const weightedTotal = weightedResults.reduce((sum, item) => sum + item.weight, 0);
    const taiProb = weightedTotal > 0 ? weightedTaiCount / weightedTotal : 0.5;
    return {
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.max(CONFIG.FALLBACK_CONFIDENCE, 45 + Math.abs(taiProb - 0.5) * 50),
      method: 'weighted_fallback'
    };
  }
}

// ==================== REGIME DETECTOR ====================
class RegimeDetector {
  detectRegime(learningData) {
    if (!learningData.recentAccuracy || learningData.recentAccuracy.length < CONFIG.REGIME_WINDOW) {
      return { regime: 'unknown', confidence: 0 };
    }
    const recent = learningData.recentAccuracy.slice(-CONFIG.REGIME_WINDOW);
    const overallRate = recent.reduce((a, b) => a + b, 0) / recent.length;
    return { regime: overallRate > 0.52 ? 'trending' : 'mixed', confidence: overallRate };
  }
}

// ==================== DICE MEAN REVERSION ====================
function predictDiceMeanReversion(sums) {
  if (!sums || sums.length < 10) return null;
  const recentSums = sums.slice(0, 10);
  const avgSum = recentSums.reduce((a, b) => a + b, 0) / 10;
  const z = (avgSum - 10.5) / 2.9;
  if (Math.abs(z) < 0.8) return null;
  const confidence = 48 + Math.min(20, Math.abs(z) * 4);
  return {
    prediction: z > 0 ? 'Xỉu' : 'Tài',
    confidence: Math.round(Math.max(CONFIG.FALLBACK_CONFIDENCE, confidence)),
    zScore: z.toFixed(2),
    method: 'dice_mean_reversion'
  };
}

// ==================== LEARNING DATA STRUCTURE ====================
let learningData = {
  hu: {
    predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
    patternWeights: {}, lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [], trendStrategyResults: [], fadeStrategyResults: [],
    methodPerformance: {
      simple: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
      ensemble: { correct: 0, total: 0 }, markov: { correct: 0, total: 0 },
      balance: { correct: 0, total: 0 }, neuralnet: { correct: 0, total: 0 },
      attention: { correct: 0, total: 0 }
    },
    mistakePatterns: {}, sessionTimes: {}, pendingSamples: []
  },
  md5: {
    predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
    patternWeights: {}, lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [], trendStrategyResults: [], fadeStrategyResults: [],
    methodPerformance: {
      simple: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
      ensemble: { correct: 0, total: 0 }, markov: { correct: 0, total: 0 },
      balance: { correct: 0, total: 0 }, neuralnet: { correct: 0, total: 0 },
      attention: { correct: 0, total: 0 }
    },
    mistakePatterns: {}, sessionTimes: {}, pendingSamples: []
  }
};

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let monteCarloSimulators = { hu: null, md5: null };
let anomalyDetector = new AnomalyDetector();
let backtestEngine = { results: { hu: [], md5: [] }, bestParams: { hu: {}, md5: {} }, loadResults: () => {}, saveResults: () => {} };
let regimeDetector = { hu: new RegimeDetector(), md5: new RegimeDetector() };
let markovChain = { hu: new MarkovChain(CONFIG.MARKOV_ORDER), md5: new MarkovChain(CONFIG.MARKOV_ORDER) };
let neuralNetworks = { hu: new NeuralNetwork(), md5: new NeuralNetwork() };
let attentionModels = { hu: new AttentionModel(), md5: new AttentionModel() };

// ==================== HELPER FUNCTIONS ====================
function updateMonteCarloSimulators(type, data) {
  if (data && data.length >= 50) {
    monteCarloSimulators[type] = new BalancedMonteCarlo(data, 50);
  }
}

function preprocessData(rawData) {
  if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return null;
  return rawData.map(d => ({ ...d }));
}

function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
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

async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    const rawData = transformApiData(response.data);
    return preprocessData(rawData);
  } catch (error) {
    console.error('Error fetching HU data:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    const rawData = transformApiData(response.data);
    return preprocessData(rawData);
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
    timestamp: new Date().toISOString(),
    ket_qua_thuc_te: null,
    status: '⏳'
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > CONFIG.MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, CONFIG.MAX_HISTORY);
  }
  return record;
}

function extractNeuralFeatures(results, sums, hour, biasCorrection) {
  const features = [];
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  features.push(taiCount5 / 5);
  const streak = anomalyDetector.getCurrentStreak(results);
  features.push(streak / 10);
  const sumMean = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const sumStd = Math.sqrt(sums.slice(0, 10).reduce((a, b) => a + (b - sumMean) ** 2, 0) / 10);
  features.push((sumMean - 10.5) / 4);
  features.push(sumStd / 3);
  features.push(hour / 24);
  features.push(results[0] === 'Tài' ? 1 : 0);
  features.push(results.length > 1 && results[1] === 'Tài' ? 1 : 0);
  features.push(results.length > 2 && results[2] === 'Tài' ? 1 : 0);
  features.push(biasCorrection);
  while (features.length < 10) features.push(0);
  return features.slice(0, 10);
}

function saveLearningData() {
  try { fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2)); } catch (error) {}
}

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      for (const type of ['hu', 'md5']) {
        if (parsed[type]) {
          parsed[type].methodPerformance = parsed[type].methodPerformance || {
            simple: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
            anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
            ensemble: { correct: 0, total: 0 }, markov: { correct: 0, total: 0 },
            balance: { correct: 0, total: 0 }, neuralnet: { correct: 0, total: 0 },
            attention: { correct: 0, total: 0 }
          };
          parsed[type].pendingSamples = parsed[type].pendingSamples || [];
        }
      }
      learningData = { ...learningData, ...parsed };
      console.log('[Data] Learning data loaded');
    }
  } catch (error) {}
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
    }
  } catch (error) {}
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (error) {}
}

function saveNeuralModels() {
  try {
    fs.writeFileSync(NEURAL_FILE, JSON.stringify({
      hu: neuralNetworks.hu.save(),
      md5: neuralNetworks.md5.save(),
      timestamp: new Date().toISOString()
    }));
  } catch (error) {}
}

function loadNeuralModels() {
  try {
    if (fs.existsSync(NEURAL_FILE)) {
      const data = JSON.parse(fs.readFileSync(NEURAL_FILE, 'utf8'));
      if (data.hu) neuralNetworks.hu.load(data.hu);
      if (data.md5) neuralNetworks.md5.load(data.md5);
      console.log('[Neural] Models loaded');
    }
  } catch (error) {}
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  const now = Date.now();

  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;

    const predTime = new Date(pred.timestamp).getTime();
    if (now - predTime > 1800000) {
      pred.verified = true;
      pred.isCorrect = false;
      pred.actual = 'TIMEOUT';
      continue;
    }

    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult) {
      pred.verified = true;
      pred.actual = actualResult.Ket_qua;
      pred.isCorrect = pred.prediction === pred.actual;

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
      if (learningData[type].recentAccuracy.length > 200) {
        learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-200);
      }

      const resultsForMarkov = currentData.slice(0, 50).map(d => d.Ket_qua === 'Tài' ? 'T' : 'X');
      markovChain[type].train(resultsForMarkov);

      anomalyDetector.learnFromResult(pred.prediction, pred.actual, pred.confidence, null);
      anomalyDetector.updateTimeWindowStats(pred.actual, new Date(pred.timestamp));

      if (pred.methods) {
        for (const [method, used] of Object.entries(pred.methods)) {
          if (used && learningData[type].methodPerformance[method]) {
            learningData[type].methodPerformance[method].total++;
            if (pred.isCorrect) learningData[type].methodPerformance[method].correct++;
          }
        }
      }

      const nnFeatures = extractNeuralFeatures(
        currentData.slice(0, 20).map(d => d.Ket_qua),
        currentData.slice(0, 20).map(d => d.Tong),
        new Date(pred.timestamp).getHours(),
        anomalyDetector.getBiasCorrection()
      );
      neuralNetworks[type].train(nnFeatures, pred.actual === 'Tài');

      const attnResults = currentData.slice(0, 20).map(d => d.Ket_qua);
      const attnSums = currentData.slice(0, 20).map(d => d.Tong);
      attentionModels[type].update(attnResults, attnSums);
      attentionModels[type].train(pred.actual, actualResult.Tong);

      updated = true;
    }
  }

  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
    anomalyDetector.saveAnomalyData();
    saveNeuralModels();
  }
}

function analyzeSimplePattern(results, type, regime) {
  if (results.length < 3) return { prediction: results[0] || 'Tài', confidence: 52 };

  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }

  if (learningData[type]) {
    const patternKey = results.slice(0, 5).join('');
    const mistakeCount = learningData[type].mistakePatterns[patternKey]?.count || 0;
    if (mistakeCount >= 4) {
      return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 55 };
    }
  }

  if (regime.regime === 'trending' && streak >= 2) {
    return { prediction: results[0], confidence: 55 + Math.min(15, streak * 3) };
  }

  if (streak >= 4) {
    return { prediction: results[0], confidence: 58 + Math.min(12, streak * 2) };
  }

  let alternating = true;
  for (let i = 1; i < Math.min(results.length, 7); i++) {
    if (results[i] === results[i - 1]) { alternating = false; break; }
  }
  if (alternating && results.length >= 5) {
    return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 56 };
  }

  const last6 = results.slice(0, 6);
  const taiCount = last6.filter(r => r === 'Tài').length;
  if (taiCount >= 5) return { prediction: 'Tài', confidence: 56 };
  if (taiCount <= 1) return { prediction: 'Xỉu', confidence: 56 };

  return { prediction: results[0], confidence: 52 };
}

function calculateSuperPrediction(data, type) {
  const results = data.slice(0, 40).map(d => d.Ket_qua);
  const sums = data.slice(0, 40).map(d => d.Tong);
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  const biasCorrection = anomalyDetector.getBiasCorrection();

  const subModels = [];
  const factors = [];

  const regime = regimeDetector[type].detectRegime(learningData[type]);
  const simple = analyzeSimplePattern(results, type, regime);
  subModels.push({ prediction: simple.prediction, confidence: simple.confidence, name: 'simple' });
  factors.push(`Simple: ${simple.prediction}(${simple.confidence}%)`);

  const last20 = results.slice(0, 20);
  const tai20 = last20.filter(r => r === 'Tài').length / 20;
  if (Math.abs(tai20 - 0.5) > 0.05) {
    const balancePred = tai20 > 0.5 ? 'Tài' : 'Xỉu';
    const balanceConf = Math.round(50 + Math.abs(tai20 - 0.5) * 40);
    subModels.push({ prediction: balancePred, confidence: balanceConf, name: 'balance' });
    factors.push(`Balance: ${balancePred}(${balanceConf}%)`);
  }

  const anomaly = anomalyDetector.detectAnomaly(results, sums, 10);
  if (anomaly.isAnomaly) {
    factors.push(`⚠️ Anomaly (z=${anomaly.zScore})`);
    if (anomaly.breakDetected && anomaly.breakDirection) {
      subModels.push({ prediction: anomaly.breakDirection, confidence: Math.min(70, 58 + parseFloat(anomaly.zScore) * 2), name: 'anomaly' });
    }
  }

  if (monteCarloSimulators[type]) {
    const mc = monteCarloSimulators[type].runBalancedSimulation(data, anomalyDetector, currentHour);
    if (mc && mc.prediction) {
      subModels.push({ prediction: mc.prediction, confidence: mc.confidence, name: 'monteCarlo' });
      factors.push(`MC: ${mc.prediction}(${mc.confidence}%)`);
    }
  }

  const dice = predictDiceMeanReversion(sums);
  if (dice) {
    subModels.push({ prediction: dice.prediction, confidence: dice.confidence, name: 'dice' });
    factors.push(`Dice: ${dice.prediction}(z=${dice.zScore})`);
  }

  const timePred = anomalyDetector.predictByTimeWindow(currentTime);
  if (timePred) {
    subModels.push({ prediction: timePred.prediction, confidence: timePred.confidence, name: 'time' });
    factors.push(`Time: ${timePred.prediction}(${timePred.confidence}%)`);
  }

  const resultsForMarkov = results.map(r => r === 'Tài' ? 'T' : 'X');
  const markovPred = markovChain[type].predict(resultsForMarkov);
  if (markovPred) {
    subModels.push({ prediction: markovPred.prediction, confidence: markovPred.confidence, name: 'markov' });
    factors.push(`Markov: ${markovPred.prediction}(${markovPred.confidence}%)`);
  }

  const nnFeatures = extractNeuralFeatures(results, sums, currentHour, biasCorrection);
  const nnPred = neuralNetworks[type].predict(nnFeatures);
  subModels.push({ prediction: nnPred.prediction, confidence: nnPred.confidence, name: 'neuralnet' });
  factors.push(`NN: ${nnPred.prediction}(${nnPred.confidence}%)`);

  attentionModels[type].update(results, sums);
  const attPred = attentionModels[type].predict();
  if (attPred) {
    subModels.push({ prediction: attPred.prediction, confidence: attPred.confidence, name: 'attention' });
    factors.push(`Attn: ${attPred.prediction}(${attPred.confidence}%)`);
  }

  let finalPrediction = 'Tài';
  let totalWeight = 0;
  const weightedVotes = { Tài: 0, Xỉu: 0 };
  for (const model of subModels) {
    const weight = model.confidence / 100;
    weightedVotes[model.prediction] += weight;
    totalWeight += weight;
  }
  if (totalWeight > 0) {
    finalPrediction = weightedVotes.Tài > weightedVotes.Xỉu ? 'Tài' : 'Xỉu';
  } else {
    finalPrediction = results[0] || 'Tài';
  }

  const agreeCount = subModels.filter(m => m.prediction === finalPrediction).length;
  const avgConfidence = subModels.reduce((sum, m) => sum + m.confidence, 0) / subModels.length;
  let rawConf = avgConfidence;
  const agreementBonus = (agreeCount / subModels.length) * 5;
  rawConf += agreementBonus;

  const taiProb = finalPrediction === 'Tài' ? rawConf / 100 : 1 - rawConf / 100;
  predictionProbBuffer[type].push(taiProb);
  if (predictionProbBuffer[type].length > CONFIG.SMOOTHING_WINDOW) predictionProbBuffer[type].shift();
  const smoothedProb = predictionProbBuffer[type].reduce((a, b) => a + b, 0) / predictionProbBuffer[type].length;
  const finalSmoothedPred = smoothedProb > 0.5 ? 'Tài' : 'Xỉu';

  let finalConfidence = Math.round(rawConf);
  finalConfidence = anomalyDetector.calibrateConfidence(finalConfidence, 'ensemble');
  finalConfidence = Math.min(CONFIG.MAX_CONFIDENCE, Math.max(CONFIG.FALLBACK_CONFIDENCE, finalConfidence));

  return {
    prediction: finalSmoothedPred,
    confidence: finalConfidence,
    factors,
    allPredictions: subModels,
    methodsUsed: Object.fromEntries(subModels.map(m => [m.name, true])),
    subModelOutputs: subModels.map(m => ({ prediction: m.prediction, confidence: m.confidence })),
    features: nnFeatures
  };
}

function recordPrediction(type, phien, prediction, confidence, factors, methods, subModelOutputs, features) {
  const record = {
    phien: phien.toString(),
    prediction, confidence, factors, methods, subModelOutputs, features,
    timestamp: new Date().toISOString(), verified: false, actual: null, isCorrect: null
  };
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 1000) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 1000);
  }
  saveLearningData();
}

function cleanupOldData() {
  for (const type of ['hu', 'md5']) {
    if (learningData[type].predictions.length > 1000) learningData[type].predictions = learningData[type].predictions.slice(0, 1000);
    if (learningData[type].recentAccuracy.length > 500) learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-500);
    if (predictionHistory[type].length > CONFIG.MAX_HISTORY) predictionHistory[type] = predictionHistory[type].slice(0, CONFIG.MAX_HISTORY);
  }
  saveLearningData();
  savePredictionHistory();
}

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      updateMonteCarloSimulators('hu', dataHu);
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateSuperPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors, result.methodsUsed, result.subModelOutputs, result.features);
        console.log(`[Hu #${nextHuPhien}] ${result.prediction} (${result.confidence}%) | ${result.factors.slice(0, 3).join(' | ')}`);
        lastProcessedPhien.hu = nextHuPhien;
      }
    }

    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      updateMonteCarloSimulators('md5', dataMd5);
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateSuperPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors, result.methodsUsed, result.subModelOutputs, result.features);
        console.log(`[MD5 #${nextMd5Phien}] ${result.prediction} (${result.confidence}%) | ${result.factors.slice(0, 3).join(' | ')}`);
        lastProcessedPhien.md5 = nextMd5Phien;
      }
    }

    savePredictionHistory();
    saveLearningData();
    saveNeuralModels();
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
    updateMonteCarloSimulators('hu', data);
    await verifyPredictions('hu', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateSuperPrediction(data, 'hu');
    savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors, result.methodsUsed, result.subModelOutputs, result.features);
    res.json({ phien_hien_tai: nextPhien.toString(), du_doan: normalizeResult(result.prediction), ti_le: `${result.confidence}%`, id: 'kapub' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
    updateMonteCarloSimulators('md5', data);
    await verifyPredictions('md5', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateSuperPrediction(data, 'md5');
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors, result.methodsUsed, result.subModelOutputs, result.features);
    res.json({ phien_hien_tai: nextPhien.toString(), du_doan: normalizeResult(result.prediction), ti_le: `${result.confidence}%`, id: 'kapub' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (data && data.length > 0) await verifyPredictions('hu', data);
    const historyWithStatus = predictionHistory.hu.map(record => {
      const pred = learningData.hu.predictions.find(p => p.phien === record.phien_hien_tai);
      return { ...record, ket_qua_thuc_te: pred?.actual || null, status: pred?.isCorrect === true ? '✅' : (pred?.isCorrect === false ? '❌' : '⏳') };
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
      const pred = learningData.md5.predictions.find(p => p.phien === record.phien_hien_tai);
      return { ...record, ket_qua_thuc_te: pred?.actual || null, status: pred?.isCorrect === true ? '✅' : (pred?.isCorrect === false ? '❌' : '⏳') };
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
    updateMonteCarloSimulators('hu', data);
    await verifyPredictions('hu', data);
    const result = calculateSuperPrediction(data, 'hu');
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      methods: result.methodsUsed,
      details: result.allPredictions?.map(p => ({ method: p.name, prediction: p.prediction, confidence: p.confidence }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    updateMonteCarloSimulators('md5', data);
    await verifyPredictions('md5', data);
    const result = calculateSuperPrediction(data, 'md5');
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      methods: result.methodsUsed,
      details: result.allPredictions?.map(p => ({ method: p.name, prediction: p.prediction, confidence: p.confidence }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/stats', (req, res) => {
  const stats = learningData.hu;
  const overallAccuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? (stats.recentAccuracy.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, stats.recentAccuracy.length) * 100).toFixed(2) : 0;
  const methodAccuracies = {};
  for (const [method, perf] of Object.entries(stats.methodPerformance)) {
    if (perf.total > 0) methodAccuracies[method] = { accuracy: (perf.correct / perf.total * 100).toFixed(2) + '%', total: perf.total, correct: perf.correct };
  }
  const regime = regimeDetector.hu.detectRegime(stats);
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', totalPredictions: stats.totalPredictions, correctPredictions: stats.correctPredictions, overallAccuracy: `${overallAccuracy}%`, recentAccuracy: `${recentAcc}%`, streakAnalysis: stats.streakAnalysis, regime, methodPerformance: methodAccuracies, lastUpdate: stats.lastUpdate });
});

app.get('/lc79-md5/stats', (req, res) => {
  const stats = learningData.md5;
  const overallAccuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? (stats.recentAccuracy.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, stats.recentAccuracy.length) * 100).toFixed(2) : 0;
  const methodAccuracies = {};
  for (const [method, perf] of Object.entries(stats.methodPerformance)) {
    if (perf.total > 0) methodAccuracies[method] = { accuracy: (perf.correct / perf.total * 100).toFixed(2) + '%', total: perf.total, correct: perf.correct };
  }
  const regime = regimeDetector.md5.detectRegime(stats);
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', totalPredictions: stats.totalPredictions, correctPredictions: stats.correctPredictions, overallAccuracy: `${overallAccuracy}%`, recentAccuracy: `${recentAcc}%`, streakAnalysis: stats.streakAnalysis, regime, methodPerformance: methodAccuracies, lastUpdate: stats.lastUpdate });
});

app.get('/reset', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], trendStrategyResults: [], fadeStrategyResults: [], methodPerformance: { simple: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 }, anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 }, ensemble: { correct: 0, total: 0 }, markov: { correct: 0, total: 0 }, balance: { correct: 0, total: 0 }, neuralnet: { correct: 0, total: 0 }, attention: { correct: 0, total: 0 } }, mistakePatterns: {}, sessionTimes: {}, pendingSamples: [] },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [], trendStrategyResults: [], fadeStrategyResults: [], methodPerformance: { simple: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 }, anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 }, ensemble: { correct: 0, total: 0 }, markov: { correct: 0, total: 0 }, balance: { correct: 0, total: 0 }, neuralnet: { correct: 0, total: 0 }, attention: { correct: 0, total: 0 } }, mistakePatterns: {}, sessionTimes: {}, pendingSamples: [] }
  };
  monteCarloSimulators = { hu: null, md5: null };
  anomalyDetector = new AnomalyDetector();
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  markovChain = { hu: new MarkovChain(CONFIG.MARKOV_ORDER), md5: new MarkovChain(CONFIG.MARKOV_ORDER) };
  neuralNetworks = { hu: new NeuralNetwork(), md5: new NeuralNetwork() };
  attentionModels = { hu: new AttentionModel(), md5: new AttentionModel() };
  predictionProbBuffer = { hu: [0.5, 0.5, 0.5, 0.5, 0.5], md5: [0.5, 0.5, 0.5, 0.5, 0.5] };
  saveLearningData();
  savePredictionHistory();
  saveNeuralModels();
  anomalyDetector.saveAnomalyData();
  res.json({ message: 'All data reset successfully' });
});

// ==================== SERVER STARTUP ====================
loadLearningData();
loadPredictionHistory();
loadNeuralModels();
anomalyDetector.loadAnomalyData();

setInterval(() => autoProcessPredictions(), CONFIG.AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);
setInterval(() => cleanupOldData(), CONFIG.CLEANUP_INTERVAL);
setInterval(() => saveNeuralModels(), 300000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - AI PREDICTION v11.0 - FULL AI SYSTEM        ║`);
  console.log(`║  NeuralNet | Attention | Markov | MC | Anomaly | Dice | Time  ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server running: http://0.0.0.0:${PORT}`);
  console.log(`\n🚀 AI ALGORITHMS:`);
  console.log(`  ✅ Neural Network (2 hidden layers, backpropagation)`);
  console.log(`  ✅ Attention Mechanism (learns which past positions matter)`);
  console.log(`  ✅ Markov Chain (order ${CONFIG.MARKOV_ORDER})`);
  console.log(`  ✅ Balanced Monte Carlo Simulation`);
  console.log(`  ✅ Anomaly Detection with Break Points`);
  console.log(`  ✅ Dice Mean Reversion`);
  console.log(`  ✅ Time Window Pattern Analysis`);
  console.log(`  ✅ Smart Ensemble Voting`);
  console.log(`\n📋 ENDPOINTS:`);
  console.log(`  GET /lc79-hu              - Prediction Hũ`);
  console.log(`  GET /lc79-md5             - Prediction MD5`);
  console.log(`  GET /lc79-hu/lichsu       - History Hũ`);
  console.log(`  GET /lc79-md5/lichsu      - History MD5`);
  console.log(`  GET /lc79-hu/analysis     - Detailed analysis Hũ`);
  console.log(`  GET /lc79-md5/analysis    - Detailed analysis MD5`);
  console.log(`  GET /lc79-hu/stats        - Performance stats Hũ`);
  console.log(`  GET /lc79-md5/stats       - Performance stats MD5`);
  console.log(`  GET /reset                - Reset all data\n`);
});
