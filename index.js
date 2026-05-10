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
const ML_MODEL_FILE = 'ml_models.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000;
const BACKTEST_INTERVAL = 300000;
const CLEANUP_INTERVAL = 21600000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== FEATURE EXTRACTOR ====================
class FeatureExtractor {
  static extractFeaturesAndLabel(history) {
    if (!history || history.length < 10) return null;
    const recent = history.slice(1);
    const results = recent.map(d => d.Ket_qua === 'Tài' ? 1 : 0);
    const sums = recent.map(d => d.Tong);
    const n = results.length;
    if (n < 10) return null;

    let feat = [];
    for (let i = 0; i < 6; i++) feat.push(i < n ? results[i] : 0.5);
    feat.push(results.slice(0, 10).reduce((a, b) => a + b, 0) / 10);
    feat.push(results.slice(0, 20).reduce((a, b) => a + b, 0) / 20);
    feat.push(results.slice(0, 30).reduce((a, b) => a + b, 0) / 30);
    
    let streak = 0;
    for (let i = 0; i < n; i++) {
      if (results[i] === results[0]) streak = (results[0] ? 1 : -1) * (i + 1);
      else break;
    }
    feat.push(streak / 10);
    
    let oppStreak = 0;
    const absStreak = Math.abs(streak);
    if (n > absStreak) {
      for (let i = absStreak; i < n; i++) {
        if (results[i] !== results[0]) oppStreak++;
        else break;
      }
    }
    feat.push(oppStreak / 10);
    
    const last10Sums = sums.slice(0, 10);
    const mean10 = last10Sums.reduce((a, b) => a + b, 0) / 10;
    feat.push((mean10 - 10.5) / 3.5);
    let variance10 = last10Sums.reduce((a, b) => a + Math.pow(b - mean10, 2), 0) / 10;
    feat.push(Math.sqrt(Math.max(0, variance10)) / 3);
    
    const last5Sums = sums.slice(0, 5);
    feat.push((last5Sums.reduce((a, b) => a + b, 0) / 5 - 10.5) / 3.5);
    
    const prev5Sums = sums.slice(5, 10);
    if (prev5Sums.length === 5) {
      const prevMean = prev5Sums.reduce((a, b) => a + b, 0) / 5;
      feat.push(((last5Sums.reduce((a, b) => a + b, 0) / 5) - prevMean) / 3);
    } else feat.push(0);
    
    let alternations = 0;
    for (let i = 1; i < Math.min(10, n); i++) if (results[i] !== results[i - 1]) alternations++;
    feat.push(alternations / 9);
    
    feat.push(results.slice(0, Math.min(50, n)).reduce((a, b) => a + b, 0) / Math.min(50, n));
    
    let taiAfterTai = 0, xiuAfterXiu = 0;
    const checkLen = Math.min(20, n - 1);
    for (let i = 0; i < checkLen; i++) {
      if (results[i] === 1 && results[i + 1] === 1) taiAfterTai++;
      if (results[i] === 0 && results[i + 1] === 0) xiuAfterXiu++;
    }
    feat.push(checkLen > 0 ? taiAfterTai / checkLen : 0);
    feat.push(checkLen > 0 ? xiuAfterXiu / checkLen : 0);

    return feat;
  }
}

// ==================== LOGISTIC REGRESSION ====================
class LogisticRegression {
  constructor(dim, learningRate = 0.05, lambda = 0.1) {
    this.dim = dim;
    this.lr = learningRate;
    this.lambda = lambda;
    this.weights = new Array(dim).fill(0).map(() => (Math.random() - 0.5) * 0.02);
    this.bias = 0;
    this.totalUpdates = 0;
  }

  sigmoid(z) {
    if (z > 20) return 1;
    if (z < -20) return 0;
    return 1 / (1 + Math.exp(-z));
  }

  predict(features) {
    let z = this.bias;
    for (let i = 0; i < this.dim; i++) z += this.weights[i] * (features[i] || 0);
    return this.sigmoid(z);
  }

  update(features, label) {
    const prob = this.predict(features);
    const error = prob - label;
    const decayLR = this.lr / (1 + this.totalUpdates * 0.0001);
    for (let i = 0; i < this.dim; i++) {
      this.weights[i] -= decayLR * (error * (features[i] || 0) + this.lambda * this.weights[i]);
    }
    this.bias -= decayLR * error;
    this.totalUpdates++;
  }

  trainBatch(featureMatrix, labels, epochs = 5) {
    for (let e = 0; e < epochs; e++) {
      const indices = featureMatrix.map((_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      for (const idx of indices) {
        this.update(featureMatrix[idx], labels[idx]);
      }
    }
    if (this.totalUpdates > 1000) this.lr *= 0.995;
  }

  toJSON() {
    return { dim: this.dim, weights: this.weights, bias: this.bias, lr: this.lr, totalUpdates: this.totalUpdates };
  }

  static fromJSON(json) {
    const model = new LogisticRegression(json.dim, json.lr);
    model.weights = json.weights;
    model.bias = json.bias;
    model.totalUpdates = json.totalUpdates || 0;
    return model;
  }
}

// ==================== PERFORMANCE TRACKER ====================
class PerformanceTracker {
  constructor() {
    this.history = { simple: [], monteCarlo: [], anomaly: [], rl: [], timeWindow: [], ml: [] };
  }

  record(method, correct) {
    if (this.history[method]) {
      this.history[method].push(correct ? 1 : 0);
      if (this.history[method].length > 150) this.history[method].shift();
    }
  }

  getWeight(method, baselineWeight) {
    const arr = this.history[method];
    if (!arr || arr.length < 15) return baselineWeight;
    const acc = arr.reduce((a, b) => a + b, 0) / arr.length;
    const factor = Math.max(0, (acc - 0.45) * 5);
    return baselineWeight * Math.min(1.5, factor);
  }

  toJSON() {
    return { history: this.history };
  }

  static fromJSON(json) {
    const tracker = new PerformanceTracker();
    tracker.history = json.history || tracker.history;
    return tracker;
  }
}

// ==================== ANOMALY DETECTOR ====================
class AnomalyDetector {
  constructor() {
    this.anomalyPatterns = [];
    this.breakPoints = [];
    this.timeWindowStats = {};
    this.reinforcementMemory = { tai: 0, xiu: 0, lastAdjustment: null };
    this.confidenceHistory = { mc: {}, simple: {}, ensemble: {} };
    this.seasonalPatterns = {};
    this.featureWeights = { 
      trend: 30, balance: 25, entropy: 15, streak: 15, sumTrend: 15, momentum: 10 
    };
    this.featureLearningRate = 0.01;
    this.cachedParams = null;
    this.lastParamsUpdate = null;
  }

  loadAnomalyData() {
    try {
      if (fs.existsSync(ANOMALY_FILE)) {
        const data = fs.readFileSync(ANOMALY_FILE, 'utf8');
        const parsed = JSON.parse(data);
        this.anomalyPatterns = parsed.anomalyPatterns || [];
        this.breakPoints = parsed.breakPoints || [];
        this.timeWindowStats = parsed.timeWindowStats || {};
        this.seasonalPatterns = parsed.seasonalPatterns || {};
        this.featureWeights = parsed.featureWeights || this.featureWeights;
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
        seasonalPatterns: this.seasonalPatterns,
        reinforcementMemory: this.reinforcementMemory,
        featureWeights: this.featureWeights,
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
    
    const expectedMean = windowSize * 0.5;
    const expectedStd = Math.sqrt(windowSize * 0.5 * 0.5);
    const zScore = expectedStd > 0 ? Math.abs((taiCount - expectedMean) / expectedStd) : 0;
    
    const adaptiveThreshold = this.getAdaptiveThreshold(results, windowSize);
    const isStatisticalAnomaly = zScore > adaptiveThreshold;
    
    const runs = this.calculateRuns(recent);
    const total = taiCount + xiuCount;
    const expectedRuns = 1 + (2 * windowSize * taiCount * xiuCount) / (total * total);
    const runsVariance = total > 1 ? (2 * taiCount * xiuCount * (2 * taiCount * xiuCount - total)) / (total * total * (total - 1)) : 0;
    const runsZScore = Math.sqrt(runsVariance) > 0 ? Math.abs((runs - expectedRuns) / Math.sqrt(runsVariance)) : 0;
    const isRunsAnomaly = runsZScore > adaptiveThreshold;
    
    const anomalyScore = Math.min(100, Math.max(0, (zScore / 3) * 100));
    
    let breakDetected = false;
    let breakDirection = null;
    let isAlternatingAnomaly = false;
    
    if (results.length >= 6) {
      breakDetected = this.detectBreakPatternAdvanced(results);
      if (breakDetected) {
        breakDirection = results[5] !== results[0] ? results[5] : 
                        (results[0] === 'Tài' ? 'Xỉu' : 'Tài');
      }
    }
    
    const alternatingLength = this.getAlternatingLength(results);
    isAlternatingAnomaly = alternatingLength >= 8;
    
    return {
      isAnomaly: isStatisticalAnomaly || isRunsAnomaly || breakDetected || isAlternatingAnomaly,
      score: anomalyScore,
      deviation: (Math.abs(taiCount / windowSize - 0.5)).toFixed(3),
      taiRatio: (taiCount / windowSize * 100).toFixed(1),
      breakDetected,
      breakDirection,
      alternatingLength,
      isAlternatingAnomaly,
      zScore: zScore.toFixed(2),
      runsZScore: runsZScore.toFixed(2)
    };
  }

  getAdaptiveThreshold(results, windowSize) {
    const recent20 = results.slice(0, Math.min(20, results.length));
    const volatility = this.calculateVolatility(recent20.map(r => r === 'Tài' ? 1 : 0));
    return Math.max(1.5, Math.min(2.5, 2.0 - volatility * 2));
  }

  calculateVolatility(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  calculateRuns(results) {
    let runs = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] !== results[i-1]) runs++;
    }
    return runs;
  }

  getAlternatingLength(results) {
    let length = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] !== results[i-1]) length++;
      else break;
    }
    return length;
  }

  detectBreakPatternAdvanced(results) {
    if (results.length < 6) return false;
    const last6 = results.slice(0, 6);
    
    const isUniformFirst = last6.slice(0, 3).every(r => r === last6[0]);
    const isUniformLast = last6.slice(3, 6).every(r => r === last6[3]);
    if (isUniformFirst && isUniformLast && last6[0] !== last6[3]) return true;
    
    if (results.length >= 6) {
      const first4 = results.slice(0, 4);
      const last2 = results.slice(4, 6);
      if (first4.every(r => r === first4[0]) && last2.every(r => r !== first4[0])) return true;
    }
    
    if (results.length >= 6) {
      const first5 = results.slice(0, 5);
      if (first5.every(r => r === first5[0]) && results[5] !== first5[0]) return true;
    }
    
    if (results.length >= 6) {
      const a = results.slice(0, 3);
      const b = results.slice(3, 6);
      if (a.every(r => r === a[0]) && b[0] !== a[0] && b[1] !== a[0] && b[2] === a[0]) return true;
    }
    
    return false;
  }

  predictBreakProbability(currentStreak, currentStreakType, currentHour) {
    const base = 0.12;
    const streakFactor = Math.min(0.45, currentStreak / 10 * 0.8);
    
    let timeBonus = 0;
    if (this.breakPoints.length > 10) {
      const hourBreaks = this.breakPoints.filter(b => 
        new Date(b.timestamp).getHours() === currentHour
      );
      timeBonus = Math.min(0.2, hourBreaks.length / this.breakPoints.length);
    }
    
    const sameTypeBreaks = this.breakPoints.filter(b => b.from === currentStreakType);
    const typeBonus = sameTypeBreaks.length > 5 ? 
      Math.min(0.15, sameTypeBreaks.length / this.breakPoints.length * 0.3) : 0;
    
    return Math.min(0.75, base + streakFactor + timeBonus + typeBonus);
  }

  recordBreakPoint(fromType, toType, timestamp) {
    this.breakPoints.push({
      from: fromType,
      to: toType,
      timestamp: timestamp.toISOString(),
      hour: timestamp.getHours(),
      minute: timestamp.getMinutes(),
      dayOfWeek: timestamp.getDay()
    });
    
    if (this.breakPoints.length > 500) {
      this.breakPoints = this.breakPoints.slice(-500);
    }
    this.saveAnomalyData();
  }

  learnFromResult(prediction, actual, confidence, featuresUsed = null) {
    const isCorrect = prediction === actual;
    const learningRate = 0.08;
    
    if (isCorrect) {
      if (prediction === 'Tài') {
        this.reinforcementMemory.tai += learningRate;
        this.reinforcementMemory.xiu -= learningRate * 0.5;
      } else {
        this.reinforcementMemory.xiu += learningRate;
        this.reinforcementMemory.tai -= learningRate * 0.5;
      }
    } else {
      if (prediction === 'Tài') {
        this.reinforcementMemory.tai -= learningRate * 1.5;
        this.reinforcementMemory.xiu += learningRate;
      } else {
        this.reinforcementMemory.xiu -= learningRate * 1.5;
        this.reinforcementMemory.tai += learningRate;
      }
    }
    
    this.reinforcementMemory.tai = Math.max(-3, Math.min(3, this.reinforcementMemory.tai));
    this.reinforcementMemory.xiu = Math.max(-3, Math.min(3, this.reinforcementMemory.xiu));
    
    if (featuresUsed) {
      const error = isCorrect ? 1 : -1;
      for (const [feat, weight] of Object.entries(this.featureWeights)) {
        if (featuresUsed.includes(feat)) {
          this.featureWeights[feat] = Math.max(5, Math.min(50, 
            weight + error * this.featureLearningRate * weight
          ));
        }
      }
    }
    
    const confidenceBucket = Math.floor(confidence / 10) * 10;
    if (!this.confidenceHistory.ensemble[confidenceBucket]) {
      this.confidenceHistory.ensemble[confidenceBucket] = { correct: 0, total: 0 };
    }
    this.confidenceHistory.ensemble[confidenceBucket].total++;
    if (isCorrect) this.confidenceHistory.ensemble[confidenceBucket].correct++;
    
    this.saveAnomalyData();
  }

  calibrateConfidence(rawConfidence, method) {
    if (!this.confidenceHistory[method] || typeof rawConfidence !== 'number') return rawConfidence;
    
    const sorted = Object.entries(this.confidenceHistory[method])
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    
    if (sorted.length < 3) return rawConfidence;
    
    const raw = parseFloat(rawConfidence) / 100;
    let lower = null, upper = null;
    
    for (let i = 0; i < sorted.length; i++) {
      const [key, stats] = sorted[i];
      const bucketMid = parseInt(key) / 100;
      if (bucketMid <= raw) {
        lower = { mid: bucketMid, acc: stats.total > 0 ? stats.correct / stats.total : bucketMid };
      }
      if (bucketMid >= raw && !upper) {
        upper = { mid: bucketMid, acc: stats.total > 0 ? stats.correct / stats.total : bucketMid };
      }
    }
    
    if (!lower || !upper) return rawConfidence;
    
    let calibratedAcc = lower.acc;
    if (upper.mid - lower.mid > 0) {
      calibratedAcc = lower.acc + (upper.acc - lower.acc) * ((raw - lower.mid) / (upper.mid - lower.mid));
    }
    
    return Math.min(78, Math.max(50, Math.round(calibratedAcc * 100)));
  }

  getBiasCorrection() {
    const taiScore = this.reinforcementMemory.tai || 0;
    const xiuScore = this.reinforcementMemory.xiu || 0;
    const total = Math.abs(taiScore) + Math.abs(xiuScore);
    if (total < 0.5) return 0;
    const diff = taiScore - xiuScore;
    return Math.max(-0.15, Math.min(0.15, diff * 0.05));
  }

  updateTimeWindowStats(result, timestamp) {
    const hour = timestamp.getHours();
    const minute = Math.floor(timestamp.getMinutes() / 15) * 15;
    const dayOfWeek = timestamp.getDay();
    const windowKey = `${hour}:${String(minute).padStart(2, '0')}`;
    
    if (!this.timeWindowStats[windowKey]) {
      this.timeWindowStats[windowKey] = { tai: 0, xiu: 0, total: 0, lastUpdate: timestamp.toISOString(), dayOfWeek: {} };
    }
    
    if (result === 'Tài') this.timeWindowStats[windowKey].tai++;
    else this.timeWindowStats[windowKey].xiu++;
    this.timeWindowStats[windowKey].total++;
    this.timeWindowStats[windowKey].lastUpdate = timestamp.toISOString();
    
    if (!this.timeWindowStats[windowKey].dayOfWeek[dayOfWeek]) {
      this.timeWindowStats[windowKey].dayOfWeek[dayOfWeek] = { tai: 0, xiu: 0, total: 0 };
    }
    if (result === 'Tài') this.timeWindowStats[windowKey].dayOfWeek[dayOfWeek].tai++;
    else this.timeWindowStats[windowKey].dayOfWeek[dayOfWeek].xiu++;
    this.timeWindowStats[windowKey].dayOfWeek[dayOfWeek].total++;
    
    this.saveAnomalyData();
  }

  predictByTimeWindow(currentTimestamp) {
    const hour = currentTimestamp.getHours();
    const minute = Math.floor(currentTimestamp.getMinutes() / 15) * 15;
    const dayOfWeek = currentTimestamp.getDay();
    const windowKey = `${hour}:${String(minute).padStart(2, '0')}`;
    
    const stats = this.timeWindowStats[windowKey];
    if (!stats || stats.total < 5) return null;
    
    const dayStats = stats.dayOfWeek[dayOfWeek];
    let taiRatio = stats.tai / stats.total;
    
    if (dayStats && dayStats.total >= 3) {
      const dayTaiRatio = dayStats.tai / dayStats.total;
      taiRatio = (dayTaiRatio * 0.6 + taiRatio * 0.4);
    }
    
    if (taiRatio > 0.58) return { prediction: 'Tài', confidence: 50 + Math.round(taiRatio * 25) };
    if (taiRatio < 0.42) return { prediction: 'Xỉu', confidence: 50 + Math.round((1 - taiRatio) * 25) };
    
    return null;
  }

  optimizeParameters(backtestResults) {
    if (!backtestResults || backtestResults.length < 50) return;
    const thresholdValues = [1.5, 1.65, 1.8, 1.96, 2.1, 2.3];
    let bestParams = { threshold: 1.96, accuracy: 0 };
    for (const threshold of thresholdValues) {
      const accuracy = this.calculateBacktestAccuracy(backtestResults, threshold);
      if (accuracy > bestParams.accuracy) bestParams = { threshold, accuracy };
    }
    this.cachedParams = bestParams;
    this.lastParamsUpdate = new Date().toISOString();
  }

  calculateBacktestAccuracy(results, threshold) {
    let correct = 0;
    let total = 0;
    for (const result of results) {
      const anomaly = this.detectAnomaly(result.historicalResults, 10);
      if (anomaly.zScore > threshold) {
        total++;
        const prediction = result.historicalResults[0] === 'Tài' ? 'Xỉu' : 'Tài';
        if (prediction === result.actual) correct++;
      }
    }
    return total > 0 ? correct / total : 0;
  }
}

// ==================== MONTE CARLO SIMULATOR ====================
class BalancedMonteCarlo {
  constructor(historicalData, windowSize = 40) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.numSimulations = 5000;
    this.minPatterns = 15;
    this.patternCache = new Map();
    this.lastCacheClear = Date.now();
  }

  extractBalancedFeatures(data, skipLatest = false) {
    if (!data || data.length < 9) return null;
    const analysisData = skipLatest ? data.slice(1) : data;
    if (analysisData.length < this.windowSize) return null;
    
    const windowData = analysisData.slice(0, this.windowSize);
    const results = windowData.map(d => d.Ket_qua);
    const sums = windowData.map(d => d.Tong);
    
    if (sums.some(s => s < 3 || s > 18)) return null;
    
    const taiCount = results.filter(r => r === 'Tài').length;
    const xiuCount = results.length - taiCount;
    const balanceRatio = Math.min(taiCount, xiuCount) / Math.max(Math.max(taiCount, xiuCount), 1);
    
    const total = taiCount + xiuCount;
    const pTai = total > 0 ? taiCount / total : 0.5;
    const pXiu = total > 0 ? xiuCount / total : 0.5;
    const entropy = -(pTai * Math.log2(Math.max(pTai, 0.001)) + 
                     pXiu * Math.log2(Math.max(pXiu, 0.001)));
    
    const last5 = results.slice(0, 5);
    const last5Tai = last5.filter(r => r === 'Tài').length;
    
    const ma5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = sums.length >= 10 ? sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10 : ma5;
    const ma20 = sums.length >= 20 ? sums.slice(0, 20).reduce((a, b) => a + b, 0) / 20 : ma10;
    
    const sumTrend = ma5 > ma10 ? 'up' : (ma5 < ma10 ? 'down' : 'stable');
    const momentum = ma10 > 0 ? (ma5 - ma20) / ma10 : 0;
    
    let currentStreak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) currentStreak++;
      else break;
    }
    currentStreak = Math.min(currentStreak, 15);
    
    return {
      last5Trend: this.categorizeTrend(last5),
      balanceRatio: parseFloat(balanceRatio.toFixed(3)),
      currentStreak,
      sumTrend,
      momentum: parseFloat(momentum.toFixed(3)),
      entropy: parseFloat(entropy.toFixed(3))
    };
  }

  categorizeTrend(last5) {
    const taiCount = last5.filter(r => r === 'Tài').length;
    if (taiCount >= 4) return 'strong_tai';
    if (taiCount <= 1) return 'strong_xiu';
    if (taiCount === 2) return 'slight_xiu';
    if (taiCount === 3) return 'slight_tai';
    return 'balanced';
  }

  findBalancedPatterns(currentFeatures, maxMatches = 80, anomalyDetector = null) {
    if (Date.now() - this.lastCacheClear > 300000) {
      this.patternCache.clear();
      this.lastCacheClear = Date.now();
    }
    
    const cacheKey = JSON.stringify(currentFeatures);
    if (this.patternCache.has(cacheKey)) return this.patternCache.get(cacheKey);
    
    const matches = [];
    const weights = anomalyDetector ? anomalyDetector.featureWeights : { trend: 30, balance: 25, entropy: 15, streak: 15, sumTrend: 15, momentum: 10 };
    
    for (let i = 0; i <= this.historicalData.length - this.windowSize - 1; i++) {
      const windowData = this.historicalData.slice(i, i + this.windowSize);
      const windowFeatures = this.extractBalancedFeatures(windowData);
      if (!windowFeatures) continue;
      
      let similarity = 0;
      if (windowFeatures.last5Trend === currentFeatures.last5Trend) similarity += weights.trend * 1.0;
      else if ((windowFeatures.last5Trend.includes('tai') && currentFeatures.last5Trend.includes('tai')) ||
               (windowFeatures.last5Trend.includes('xiu') && currentFeatures.last5Trend.includes('xiu'))) {
        similarity += weights.trend * 0.5;
      }
      
      const balanceDiff = Math.abs(windowFeatures.balanceRatio - currentFeatures.balanceRatio);
      similarity += Math.max(0, weights.balance - balanceDiff * 40);
      
      const entropyDiff = Math.abs(windowFeatures.entropy - currentFeatures.entropy);
      similarity += Math.max(0, weights.entropy - entropyDiff * 20);
      
      const streakDiff = Math.abs(windowFeatures.currentStreak - currentFeatures.currentStreak);
      similarity += Math.max(0, weights.streak - streakDiff * 2);
      
      if (windowFeatures.sumTrend === currentFeatures.sumTrend) similarity += weights.sumTrend;
      
      const momentumDiff = Math.abs((windowFeatures.momentum || 0) - (currentFeatures.momentum || 0));
      similarity += Math.max(0, weights.momentum - momentumDiff * 30);
      
      const recencyBonus = 10 * Math.exp(-i / (this.historicalData.length * 0.3));
      similarity += recencyBonus;
      
      if (similarity > 20) {
        matches.push({
          similarity,
          index: i,
          nextResult: this.historicalData[i + this.windowSize]?.Ket_qua,
          nextSum: this.historicalData[i + this.windowSize]?.Tong
        });
      }
    }
    
    matches.sort((a, b) => b.similarity - a.similarity);
    const topMatches = matches.slice(0, maxMatches);
    this.patternCache.set(cacheKey, topMatches);
    return topMatches;
  }

  weightedRandomSelect(patterns) {
    if (patterns.length === 0) return null;
    const totalWeight = patterns.reduce((sum, p) => sum + p.similarity, 0);
    let random = Math.random() * totalWeight;
    for (const pattern of patterns) {
      random -= pattern.similarity;
      if (random <= 0) return pattern;
    }
    return patterns[patterns.length - 1];
  }

  calculatePatternQuality(patterns) {
    if (patterns.length === 0) return 0;
    const avgSimilarity = patterns.reduce((sum, p) => sum + p.similarity, 0) / patterns.length;
    const diversity = new Set(patterns.map(p => p.nextResult)).size;
    return (avgSimilarity / 100) * (diversity / 2) * Math.min(1, patterns.length / 50);
  }

  runBalancedSimulation(data, anomalyDetector, currentHour) {
    const currentFeatures = this.extractBalancedFeatures(data, true);
    if (!currentFeatures || this.historicalData.length < 50) return null;
    
    const similarPatterns = this.findBalancedPatterns(currentFeatures, 100, anomalyDetector);
    if (similarPatterns.length < this.minPatterns) return null;
    
    const patternQuality = this.calculatePatternQuality(similarPatterns);
    const adaptiveSimCount = Math.floor(this.numSimulations * (0.5 + patternQuality * 0.5));
    
    let taiWins = 0;
    let xiuWins = 0;
    let totalWeight = 0;
    const usedPatterns = new Set();
    
    for (let sim = 0; sim < adaptiveSimCount; sim++) {
      let selectedPattern;
      if (sim < similarPatterns.length * 0.5 && !usedPatterns.has(sim)) {
        selectedPattern = similarPatterns[sim];
        usedPatterns.add(sim);
      } else {
        selectedPattern = this.weightedRandomSelect(similarPatterns);
      }
      if (!selectedPattern) continue;
      
      let weight = Math.pow(selectedPattern.similarity / 100, 1.5);
      totalWeight += weight;
      
      if (selectedPattern.nextResult === 'Tài') taiWins += weight;
      else if (selectedPattern.nextResult === 'Xỉu') xiuWins += weight;
    }
    
    if (totalWeight === 0) return null;
    
    let taiProbability = taiWins / totalWeight;
    const biasCorrection = anomalyDetector.getBiasCorrection();
    taiProbability += biasCorrection * 0.3;
    taiProbability = Math.max(0.35, Math.min(0.65, taiProbability));
    
    const currentData = data.slice(1);
    const currentStreakType = currentData[0]?.Ket_qua;
    const breakProb = anomalyDetector.predictBreakProbability(currentFeatures.currentStreak, currentStreakType, currentHour);
    
    if (breakProb > 0.65 && currentFeatures.currentStreak >= 3) taiProbability = 1 - taiProbability;
    
    const rawConfidence = 45 + Math.abs(taiProbability - 0.5) * 90;
    const calibratedConfidence = anomalyDetector.calibrateConfidence(rawConfidence, 'mc');
    const finalConfidence = Math.min(70, Math.max(52, Math.round(calibratedConfidence * 0.9)));
    
    return {
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: (1 - taiProbability).toFixed(4),
      confidence: finalConfidence,
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      similarPatternsCount: similarPatterns.length,
      breakProbability: breakProb.toFixed(2),
      method: 'balanced_monte_carlo'
    };
  }
}

// ==================== REINFORCEMENT LEARNER ====================
class ReinforcementLearner {
  constructor() {
    this.qTable = {};
    this.learningRate = 0.08;
    this.discountFactor = 0.92;
    this.epsilon = 0.12;
    this.visitCounts = {};
    this.stateTransitions = {};
  }

  getStateKey(results, sums = null) {
    if (!results || results.length < 5) return 'default';
    const last4 = results.slice(0, 4).join('');
    const streak = Math.min(this.getStreakLength(results), 12);
    let avgSumBucket = 'mid';
    if (sums && sums.length >= 5) {
      const avgSum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      if (avgSum < 8) avgSumBucket = 'low';
      else if (avgSum > 13) avgSumBucket = 'high';
    }
    const recentTrend = results.slice(0, 6).filter(r => r === 'Tài').length;
    return `${last4}_${streak}_${recentTrend}_${avgSumBucket}`;
  }

  getStreakLength(results) {
    if (results.length === 0) return 0;
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    return Math.min(streak, 12);
  }

  getAction(state, possibleActions = ['Tài', 'Xỉu']) {
    if (!this.qTable[state]) {
      this.qTable[state] = { Tài: 0.5, Xỉu: 0.5 };
      this.visitCounts[state] = 0;
      this.stateTransitions[state] = { Tài: 0, Xỉu: 0 };
    }
    
    const adaptiveEpsilon = Math.max(0.03, this.epsilon / (1 + Math.log(this.visitCounts[state] + 1) * 0.1));
    
    if (Math.random() < adaptiveEpsilon) {
      const action = possibleActions[Math.floor(Math.random() * possibleActions.length)];
      this.stateTransitions[state][action]++;
      return action;
    }
    
    this.visitCounts[state]++;
    const qDiff = (this.qTable[state].Tài || 0.5) - (this.qTable[state].Xỉu || 0.5);
    if (Math.abs(qDiff) < 0.05) {
      const action = Math.random() > 0.5 ? 'Tài' : 'Xỉu';
      this.stateTransitions[state][action]++;
      return action;
    }
    
    const action = this.qTable[state].Tài > this.qTable[state].Xỉu ? 'Tài' : 'Xỉu';
    this.stateTransitions[state][action]++;
    return action;
  }

  updateQValue(state, action, reward, nextState) {
    if (!this.qTable[state]) {
      this.qTable[state] = { Tài: 0.5, Xỉu: 0.5 };
      this.visitCounts[state] = 0;
      this.stateTransitions[state] = { Tài: 0, Xỉu: 0 };
    }
    if (!this.qTable[nextState]) {
      this.qTable[nextState] = { Tài: 0.5, Xỉu: 0.5 };
      this.visitCounts[nextState] = 0;
      this.stateTransitions[nextState] = { Tài: 0, Xỉu: 0 };
    }
    
    const currentQ = this.qTable[state][action] || 0.5;
    const maxNextQ = Math.max(this.qTable[nextState].Tài || 0.5, this.qTable[nextState].Xỉu || 0.5);
    const visitCount = this.visitCounts[state] || 0;
    const adaptiveLR = this.learningRate / (1 + Math.sqrt(visitCount) * 0.01);
    const scaledReward = reward * (1 + Math.abs(currentQ - 0.5) * 0.5);
    const newQ = currentQ + adaptiveLR * (scaledReward + this.discountFactor * maxNextQ - currentQ);
    this.qTable[state][action] = Math.max(0, Math.min(1, newQ));
  }

  getQLearningPrediction(state) {
    if (!this.qTable[state]) return null;
    const taiValue = this.qTable[state].Tài || 0.5;
    const xiuValue = this.qTable[state].Xỉu || 0.5;
    const diff = taiValue - xiuValue;
    if (Math.abs(diff) < 0.12) return null;
    const visits = this.visitCounts[state] || 0;
    if (visits < 5) return null;
    return diff > 0 ? 'Tài' : 'Xỉu';
  }
}

// ==================== BACKTEST ENGINE ====================
class BacktestEngine {
  constructor() {
    this.results = { hu: [], md5: [] };
    this.bestParams = { hu: {}, md5: {} };
    this.lastBacktest = null;
  }

  loadResults() {
    try {
      if (fs.existsSync(BACKTEST_FILE)) {
        const data = fs.readFileSync(BACKTEST_FILE, 'utf8');
        const parsed = JSON.parse(data);
        this.results = parsed.results || { hu: [], md5: [] };
        this.bestParams = parsed.bestParams || { hu: {}, md5: {} };
        this.lastBacktest = parsed.lastBacktest;
      }
    } catch (error) {
      console.error('[Backtest] Load error:', error.message);
    }
  }

  saveResults() {
    try {
      fs.writeFileSync(BACKTEST_FILE, JSON.stringify({
        results: this.results,
        bestParams: this.bestParams,
        lastBacktest: this.lastBacktest,
        timestamp: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      console.error('[Backtest] Save error:', error.message);
    }
  }

  getOptimalConfig(type) {
    if (this.bestParams[type] && this.bestParams[type].config) {
      const config = {
        useMC: this.bestParams[type].config.includes('mc'),
        useAnomaly: this.bestParams[type].config.includes('anomaly'),
        useRL: this.bestParams[type].config.includes('rl'),
        useTime: this.bestParams[type].config.includes('time')
      };
      return config;
    }
    return { useMC: true, useAnomaly: true, useRL: true, useTime: true };
  }
}

// ==================== DATA STORAGE ====================
let learningData = {
  hu: {
    predictions: [], totalPredictions: 0, correctPredictions: 0,
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    methodPerformance: {
      simple: { correct: 0, total: 0 },
      monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 },
      ensemble: { correct: 0, total: 0 },
      ml: { correct: 0, total: 0 }
    },
    mistakePatterns: {},
    sessionTimes: {}
  },
  md5: {
    predictions: [], totalPredictions: 0, correctPredictions: 0,
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    methodPerformance: {
      simple: { correct: 0, total: 0 },
      monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 },
      ensemble: { correct: 0, total: 0 },
      ml: { correct: 0, total: 0 }
    },
    mistakePatterns: {},
    sessionTimes: {}
  }
};

let monteCarloSimulators = { hu: null, md5: null };
let anomalyDetector = new AnomalyDetector();
let rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
let backtestEngine = new BacktestEngine();
let mlModels = { hu: new LogisticRegression(21), md5: new LogisticRegression(21) };
let performanceTracker = { hu: new PerformanceTracker(), md5: new PerformanceTracker() };

// ==================== HELPER FUNCTIONS ====================
function updateMonteCarloSimulators(type, data) {
  if (data && data.length >= 200) {
    monteCarloSimulators[type] = new BalancedMonteCarlo(data, 40);
  }
}

function preprocessData(rawData) {
  if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return null;
  const processed = rawData.map(d => ({ ...d }));
  for (let i = 0; i < processed.length; i++) {
    if (processed[i].Tong < 3 || processed[i].Tong > 18) {
      if (i > 0 && i < processed.length - 1) {
        processed[i].Tong = Math.round((processed[i-1].Tong + processed[i+1].Tong) / 2);
        processed[i].Tong = Math.max(3, Math.min(18, processed[i].Tong));
      } else {
        processed[i].Tong = 10;
      }
    }
  }
  return processed;
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
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  return record;
}

function recordPrediction(type, phien, prediction, confidence, factors, methods) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    factors,
    methods,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 1000) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 1000);
  }
  saveLearningData();
}

function trainMLModel(type, dataUpToNow) {
  if (dataUpToNow.length < 100) return;
  const featuresMatrix = [];
  const labels = [];
  for (let i = dataUpToNow.length - 1; i >= 50; i--) {
    if (i + 1 >= dataUpToNow.length) continue;
    const historyBefore = dataUpToNow.slice(i + 1);
    const feat = FeatureExtractor.extractFeaturesAndLabel([dataUpToNow[i], ...historyBefore]);
    if (feat) {
      const label = dataUpToNow[i].Ket_qua === 'Tài' ? 1 : 0;
      featuresMatrix.push(feat);
      labels.push(label);
    }
  }
  if (featuresMatrix.length > 0) {
    mlModels[type].trainBatch(featuresMatrix, labels, 3);
    saveMLModels();
  }
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
      const predictedNormalized = pred.prediction === 'Tài' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      if (pred.methods) {
        for (const [method, used] of Object.entries(pred.methods)) {
          if (used && learningData[type].methodPerformance[method]) {
            learningData[type].methodPerformance[method].total++;
            if (pred.isCorrect) learningData[type].methodPerformance[method].correct++;
          }
          if (used) {
            performanceTracker[type].record(method, pred.isCorrect);
          }
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 100) {
        learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-100);
      }
      
      const stateKey = rlLearner[type].getStateKey(
        currentData.slice(0, 10).map(d => d.Ket_qua),
        currentData.slice(0, 10).map(d => d.Tong)
      );
      const reward = pred.isCorrect ? 1 : -0.5;
      const nextStateKey = rlLearner[type].getStateKey(
        currentData.slice(0, 10).map(d => d.Ket_qua),
        currentData.slice(0, 10).map(d => d.Tong)
      );
      rlLearner[type].updateQValue(stateKey, pred.prediction, reward, nextStateKey);
      
      anomalyDetector.learnFromResult(pred.prediction, pred.actual, pred.confidence);
      anomalyDetector.updateTimeWindowStats(pred.actual, new Date(pred.timestamp));
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
    anomalyDetector.saveAnomalyData();
    if (currentData.length > 100) trainMLModel(type, currentData);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Error saving learning data:', error.message);
  }
}

function saveMLModels() {
  try {
    fs.writeFileSync(ML_MODEL_FILE, JSON.stringify({
      hu: mlModels.hu.toJSON(),
      md5: mlModels.md5.toJSON(),
      performance: {
        hu: performanceTracker.hu.toJSON(),
        md5: performanceTracker.md5.toJSON()
      }
    }, null, 2));
  } catch (error) {
    console.error('Error saving ML models:', error.message);
  }
}

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      if (learningData.hu) {
        learningData.hu.methodPerformance = learningData.hu.methodPerformance || { simple: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 }, anomaly: { correct: 0, total: 0 }, ensemble: { correct: 0, total: 0 }, ml: { correct: 0, total: 0 } };
      }
      if (learningData.md5) {
        learningData.md5.methodPerformance = learningData.md5.methodPerformance || { simple: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 }, anomaly: { correct: 0, total: 0 }, ensemble: { correct: 0, total: 0 }, ml: { correct: 0, total: 0 } };
      }
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
    }
  } catch (error) {
    console.error('Error loading prediction history:', error.message);
  }
}

function loadMLModels() {
  try {
    if (fs.existsSync(ML_MODEL_FILE)) {
      const data = fs.readFileSync(ML_MODEL_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.hu) mlModels.hu = LogisticRegression.fromJSON(parsed.hu);
      if (parsed.md5) mlModels.md5 = LogisticRegression.fromJSON(parsed.md5);
      if (parsed.performance) {
        if (parsed.performance.hu) performanceTracker.hu = PerformanceTracker.fromJSON(parsed.performance.hu);
        if (parsed.performance.md5) performanceTracker.md5 = PerformanceTracker.fromJSON(parsed.performance.md5);
      }
    }
  } catch (error) {
    console.error('Error loading ML models:', error.message);
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

// ==================== PATTERN ANALYSIS ====================
function analyzeSimplePattern(results, learningType = null) {
  if (results.length < 3) return { prediction: results[0] || 'Tài', confidence: 50 };
  
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  
  if (learningType && learningData[learningType]) {
    const patternKey = results.slice(0, 5).join('');
    const mistakeCount = learningData[learningType].mistakePatterns[patternKey]?.count || 0;
    if (mistakeCount >= 3) {
      return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 48, name: `Mistake Reversal` };
    }
  }
  
  if (streak >= 4) {
    return { prediction: results[0], confidence: 55 + Math.min(20, streak * 3), name: `Streak ${streak}` };
  }
  
  let alternating = true;
  for (let i = 1; i < Math.min(results.length, 7); i++) {
    if (results[i] === results[i-1]) { alternating = false; break; }
  }
  if (alternating && results.length >= 5) {
    return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 60, name: 'Alternating' };
  }
  
  const last6 = results.slice(0, 6);
  const taiCount = last6.filter(r => r === 'Tài').length;
  if (taiCount >= 5) return { prediction: 'Tài', confidence: 56, name: 'Strong Tai' };
  if (taiCount <= 1) return { prediction: 'Xỉu', confidence: 56, name: 'Strong Xiu' };
  
  return { prediction: results[0], confidence: 52, name: 'Follow' };
}

// ==================== ENSEMBLE WEIGHTS ====================
function calculateEnsembleWeights(type) {
  const stats = learningData[type];
  const optimalConfig = backtestEngine.getOptimalConfig(type);
  
  const baseWeights = {
    simple: 0.30,
    monteCarlo: optimalConfig.useMC ? 0.20 : 0.0,
    anomaly: 0.10,
    rl: 0.05,
    timeWindow: 0.05,
    ml: 0.30
  };
  
  if (stats.totalPredictions < 50) return baseWeights;
  
  const weights = { ...baseWeights };
  for (const [method, perf] of Object.entries(stats.methodPerformance)) {
    if (perf && perf.total >= 10 && weights[method] !== undefined) {
      const accuracy = perf.correct / perf.total;
      weights[method] = Math.max(0.05, Math.min(0.50, accuracy * 0.8));
    }
  }
  
  const recentAcc = stats.recentAccuracy.length > 0
    ? stats.recentAccuracy.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, stats.recentAccuracy.length)
    : 0.5;
  
  if (recentAcc < 0.45) {
    for (const method in weights) {
      if (weights[method]) weights[method] *= 0.7;
    }
    weights.simple = Math.max(weights.simple || 0.3, 0.5);
  }
  
  return weights;
}

// ==================== SUPER PREDICTION ====================
function calculateSuperPrediction(data, type) {
  const results = data.slice(0, 30).map(d => d.Ket_qua);
  const sums = data.slice(0, 30).map(d => d.Tong);
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  const currentMinute = currentTime.getMinutes();

  let predictions = [];
  let factors = [];
  let methodsUsed = {};

  const baseWeights = calculateEnsembleWeights(type);

  // 1. Simple pattern
  const simplePattern = analyzeSimplePattern(results, type);
  let wSimple = performanceTracker[type].getWeight('simple', baseWeights.simple || 0.3);
  if (wSimple > 0) {
    predictions.push({ prediction: simplePattern.prediction, confidence: simplePattern.confidence, weight: wSimple, method: 'simple', name: simplePattern.name });
    methodsUsed.simple = true;
  }

  // 2. Monte Carlo
  if (monteCarloSimulators[type] && (baseWeights.monteCarlo || 0) > 0) {
    const mcResult = monteCarloSimulators[type].runBalancedSimulation(data, anomalyDetector, currentHour);
    if (mcResult && mcResult.prediction && mcResult.similarPatternsCount >= 15) {
      let wMC = performanceTracker[type].getWeight('monteCarlo', baseWeights.monteCarlo || 0.2);
      if (wMC > 0) {
        predictions.push({ prediction: mcResult.prediction, confidence: Math.min(70, mcResult.confidence), weight: wMC, method: 'monteCarlo', name: `MC (${mcResult.similarPatternsCount})` });
        methodsUsed.monteCarlo = true;
        factors.push(`MC:${mcResult.similarPatternsCount} patterns`);
      }
    }
  }

  // 3. Anomaly (only strong)
  const anomaly = anomalyDetector.detectAnomaly(results, 10);
  if (anomaly.isAnomaly && anomaly.score > 75) {
    let wAnom = performanceTracker[type].getWeight('anomaly', baseWeights.anomaly || 0.1);
    if (wAnom > 0 && anomaly.breakDetected && anomaly.breakDirection) {
      predictions.push({ prediction: anomaly.breakDirection, confidence: 58, weight: wAnom * 0.6, method: 'anomaly', name: 'Anomaly Break' });
      methodsUsed.anomaly = true;
    }
    if (wAnom > 0 && anomaly.isAlternatingAnomaly) {
      const altPrediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      predictions.push({ prediction: altPrediction, confidence: 56, weight: wAnom * 0.4, method: 'anomaly', name: 'Alt Anomaly' });
    }
  }

  // 4. Time window
  if ((baseWeights.timeWindow || 0) > 0) {
    const timePred = anomalyDetector.predictByTimeWindow(currentTime);
    if (timePred && timePred.confidence >= 55) {
      let wTime = performanceTracker[type].getWeight('timeWindow', baseWeights.timeWindow || 0.05);
      if (wTime > 0) {
        predictions.push({ prediction: timePred.prediction, confidence: timePred.confidence, weight: wTime, method: 'timeWindow', name: 'Time' });
        methodsUsed.timeWindow = true;
      }
    }
  }

  // 5. Q-Learning
  if ((baseWeights.rl || 0) > 0) {
    const stateKey = rlLearner[type].getStateKey(results, sums);
    const visits = rlLearner[type].visitCounts[stateKey] || 0;
    const qPred = rlLearner[type].getQLearningPrediction(stateKey);
    if (qPred && visits >= 5) {
      let wRL = performanceTracker[type].getWeight('rl', baseWeights.rl || 0.05);
      if (wRL > 0) {
        predictions.push({ prediction: qPred, confidence: 55, weight: wRL, method: 'rl', name: `RL (${visits})` });
        methodsUsed.rl = true;
      }
    }
  }

  // 6. ML Logistic Regression
  if ((baseWeights.ml || 0) > 0) {
    let mlFeatures = FeatureExtractor.extractFeaturesAndLabel(data);
    if (mlFeatures) {
      let hourSin = Math.sin(2 * Math.PI * currentHour / 24);
      let hourCos = Math.cos(2 * Math.PI * currentHour / 24);
      let minuteSin = Math.sin(2 * Math.PI * currentMinute / 60);
      let minuteCos = Math.cos(2 * Math.PI * currentMinute / 60);
      mlFeatures.push(hourSin, hourCos, minuteSin, minuteCos);
      
      while (mlFeatures.length < mlModels[type].dim) mlFeatures.push(0);
      mlFeatures = mlFeatures.slice(0, mlModels[type].dim);
      
      const mlProb = mlModels[type].predict(mlFeatures);
      const mlPred = mlProb > 0.5 ? 'Tài' : 'Xỉu';
      let wML = performanceTracker[type].getWeight('ml', baseWeights.ml || 0.3);
      if (wML > 0) {
        const mlConf = 50 + Math.round(Math.abs(mlProb - 0.5) * 80);
        predictions.push({ prediction: mlPred, confidence: Math.min(70, mlConf), weight: wML, method: 'ml', name: `ML (${(mlProb*100).toFixed(0)}%)` });
        methodsUsed.ml = true;
        factors.push(`ML:${(mlProb*100).toFixed(0)}% Tài`);
      }
    }
  }

  // Weighted ensemble
  let taiScore = 0, xiuScore = 0, totalWeight = 0;
  const usedPredictions = [];
  predictions.forEach(p => {
    if (p.weight > 0 && p.confidence >= 50) {
      const w = p.weight * (p.confidence / 100);
      if (p.prediction === 'Tài') taiScore += w;
      else xiuScore += w;
      totalWeight += w;
      usedPredictions.push(p);
    }
  });

  if (totalWeight === 0 || usedPredictions.length < 2) {
    const recent10 = results.slice(0, 10);
    const taiCount = recent10.filter(r => r === 'Tài').length;
    return {
      prediction: taiCount >= 5 ? 'Tài' : 'Xỉu',
      confidence: 50,
      factors: ['Fallback - no reliable signal'],
      allPredictions: usedPredictions,
      methodsUsed: { simple: true }
    };
  }

  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  const margin = Math.abs(taiScore - xiuScore) / totalWeight;
  if (margin < 0.05) {
    finalPrediction = simplePattern.prediction;
    factors.push('Low margin - using simple');
  }

  let finalConfidence = Math.round((Math.max(taiScore, xiuScore) / totalWeight) * 100);
  const agreeCount = usedPredictions.filter(p => p.prediction === finalPrediction).length;
  const agreementRatio = agreeCount / usedPredictions.length;
  
  if (agreementRatio < 0.6) {
    finalConfidence = Math.min(62, finalConfidence);
  } else if (agreementRatio >= 0.8) {
    finalConfidence = Math.min(72, finalConfidence + 5);
  } else {
    finalConfidence = Math.min(68, finalConfidence);
  }
  finalConfidence = Math.max(50, Math.min(72, finalConfidence));

  const biasCorrection = anomalyDetector.getBiasCorrection();
  if (Math.abs(biasCorrection) > 0.15) {
    if (biasCorrection > 0 && finalPrediction === 'Xỉu') {
      finalPrediction = 'Tài';
      factors.push('Strong bias: Tài');
    } else if (biasCorrection < 0 && finalPrediction === 'Tài') {
      finalPrediction = 'Xỉu';
      factors.push('Strong bias: Xỉu');
    }
  }

  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPredictions: usedPredictions.map(p => ({ method: p.method, prediction: p.prediction, confidence: p.confidence, weight: p.weight, name: p.name })),
    methodsUsed
  };
}

// ==================== AUTO PROCESS ====================
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
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors, result.methodsUsed);
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Hu #${nextHuPhien}] ${result.prediction} (${result.confidence}%) | ${result.factors.slice(0,3).join(' | ')}`);
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
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors, result.methodsUsed);
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[MD5 #${nextMd5Phien}] ${result.prediction} (${result.confidence}%) | ${result.factors.slice(0,3).join(' | ')}`);
      }
    }
    
    savePredictionHistory();
    saveLearningData();
    saveMLModels();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

function cleanupOldData() {
  for (const type of ['hu', 'md5']) {
    if (learningData[type].predictions.length > 1000) {
      learningData[type].predictions = learningData[type].predictions.slice(0, 1000);
    }
    if (learningData[type].recentAccuracy.length > 500) {
      learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-500);
    }
    if (predictionHistory[type].length > MAX_HISTORY) {
      predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
  }
  saveLearningData();
  savePredictionHistory();
  saveMLModels();
  console.log('[Cleanup] Data cleaned');
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
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors, result.methodsUsed);
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
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
    updateMonteCarloSimulators('md5', data);
    await verifyPredictions('md5', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateSuperPrediction(data, 'md5');
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors, result.methodsUsed);
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
    if (data && data.length > 0) await verifyPredictions('hu', data);
    const historyWithStatus = predictionHistory.hu.map(record => {
      const prediction = learningData.hu.predictions.find(p => p.phien === record.phien_hien_tai);
      return {
        ...record,
        ket_qua_thuc_te: prediction?.actual || null,
        status: prediction?.isCorrect === true ? '✅' : (prediction?.isCorrect === false ? '❌' : '⏳')
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
        status: prediction?.isCorrect === true ? '✅' : (prediction?.isCorrect === false ? '❌' : '⏳')
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
    updateMonteCarloSimulators('hu', data);
    await verifyPredictions('hu', data);
    const result = calculateSuperPrediction(data, 'hu');
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      methods: result.methodsUsed,
      details: result.allPredictions
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
      details: result.allPredictions
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/stats', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  const recentAcc = stats.recentAccuracy.length > 0
    ? (stats.recentAccuracy.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, stats.recentAccuracy.length) * 100).toFixed(2)
    : 0;
  
  const methodAccuracies = {};
  for (const [method, perf] of Object.entries(stats.methodPerformance)) {
    if (perf.total > 0) {
      methodAccuracies[method] = {
        accuracy: (perf.correct / perf.total * 100).toFixed(2) + '%',
        total: perf.total,
        correct: perf.correct
      };
    }
  }
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    methodPerformance: methodAccuracies,
    lastUpdate: stats.lastUpdate
  });
});

app.get('/lc79-md5/stats', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  const recentAcc = stats.recentAccuracy.length > 0
    ? (stats.recentAccuracy.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, stats.recentAccuracy.length) * 100).toFixed(2)
    : 0;
  
  const methodAccuracies = {};
  for (const [method, perf] of Object.entries(stats.methodPerformance)) {
    if (perf.total > 0) {
      methodAccuracies[method] = {
        accuracy: (perf.correct / perf.total * 100).toFixed(2) + '%',
        total: perf.total,
        correct: perf.correct
      };
    }
  }
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    methodPerformance: methodAccuracies,
    lastUpdate: stats.lastUpdate
  });
});

app.get('/backtest/results', (req, res) => {
  res.json({
    hu: backtestEngine.results.hu.slice(-20),
    md5: backtestEngine.results.md5.slice(-20),
    bestParams: backtestEngine.bestParams,
    lastBacktest: backtestEngine.lastBacktest
  });
});

app.get('/reset', (req, res) => {
  learningData = {
    hu: {
      predictions: [], totalPredictions: 0, correctPredictions: 0,
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [],
      methodPerformance: {
        simple: { correct: 0, total: 0 },
        monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 },
        ensemble: { correct: 0, total: 0 },
        ml: { correct: 0, total: 0 }
      },
      mistakePatterns: {},
      sessionTimes: {}
    },
    md5: {
      predictions: [], totalPredictions: 0, correctPredictions: 0,
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [],
      methodPerformance: {
        simple: { correct: 0, total: 0 },
        monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 },
        ensemble: { correct: 0, total: 0 },
        ml: { correct: 0, total: 0 }
      },
      mistakePatterns: {},
      sessionTimes: {}
    }
  };
  monteCarloSimulators = { hu: null, md5: null };
  anomalyDetector = new AnomalyDetector();
  rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  backtestEngine = new BacktestEngine();
  mlModels = { hu: new LogisticRegression(21), md5: new LogisticRegression(21) };
  performanceTracker = { hu: new PerformanceTracker(), md5: new PerformanceTracker() };
  
  saveLearningData();
  savePredictionHistory();
  saveMLModels();
  anomalyDetector.saveAnomalyData();
  
  res.json({ message: 'All data reset successfully' });
});

// ==================== SERVER STARTUP ====================
loadLearningData();
loadPredictionHistory();
loadMLModels();
anomalyDetector.loadAnomalyData();
backtestEngine.loadResults();

// Recreate ML models with correct dimension if loaded from legacy
if (mlModels.hu.dim !== 25) {
  mlModels.hu = new LogisticRegression(25, 0.05, 0.1);
  mlModels.md5 = new LogisticRegression(25, 0.05, 0.1);
}

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);

setInterval(() => cleanupOldData(), CLEANUP_INTERVAL);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║   LẨU CUA 79 - AI PREDICTION v9.0 - MACHINE LEARNING SYSTEM    ║`);
  console.log(`║   Logistic Regression | Monte Carlo | Q-Learning | Performance ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server running: http://0.0.0.0:${PORT}`);
  console.log(`\n🚀 KEY FEATURES:`);
  console.log(`  ✅ Online Logistic Regression with 25 features`);
  console.log(`  ✅ Dynamic method weighting based on recent F1-like performance`);
  console.log(`  ✅ Look-ahead bias completely removed`);
  console.log(`  ✅ Max confidence capped at 72%`);
  console.log(`  ✅ Minimum pattern requirements for MC (15 matches)`);
  console.log(`  ✅ Anomaly only used when score > 75`);
  console.log(`  ✅ Fallback to recent trend when no consensus`);
  console.log(`  ✅ ML model continuously retrained after each verification`);
  console.log(`  ✅ Time features encoded with sin/cos for cyclical patterns`);
  console.log(`\n📋 ENDPOINTS:`);
  console.log(`  GET /lc79-hu              - Prediction Hũ`);
  console.log(`  GET /lc79-md5             - Prediction MD5`);
  console.log(`  GET /lc79-hu/lichsu       - History Hũ`);
  console.log(`  GET /lc79-md5/lichsu      - History MD5`);
  console.log(`  GET /lc79-hu/analysis     - Detailed analysis Hũ`);
  console.log(`  GET /lc79-md5/analysis    - Detailed analysis MD5`);
  console.log(`  GET /lc79-hu/stats        - Performance stats Hũ`);
  console.log(`  GET /lc79-md5/stats       - Performance stats MD5`);
  console.log(`  GET /backtest/results     - Backtest performance`);
  console.log(`  GET /reset                - Reset all data\n`);
  
  console.log(`⚡ Auto-prediction: Every ${AUTO_SAVE_INTERVAL/1000}s`);
  console.log(`🧹 Auto-cleanup: Every ${CLEANUP_INTERVAL/3600000}h\n`);
});
