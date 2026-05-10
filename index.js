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

// ==================== CONFIGURATION ====================
const CONFIG = {
  MIN_CONFIDENCE: 58,          // Don't predict below this confidence
  MAX_CONFIDENCE: 82,          // Cap maximum confidence
  MIN_EDGE: 0.03,              // Minimum edge required (Kelly criterion)
  MIN_PATTERNS: 12,            // Minimum patterns for MC to be reliable
  ENSEMBLE_MIN_AGREEMENT: 2,   // Minimum number of methods that must agree
  SMOOTHING_WINDOW: 3,         // Temporal smoothing window
  MAX_HISTORY: 300,
  AUTO_SAVE_INTERVAL: 15000,
  BACKTEST_INTERVAL: 600000,   // 10 minutes
  CLEANUP_INTERVAL: 21600000,  // 6 hours
  META_LEARNING_RATE: 0.02,
  META_UPDATE_INTERVAL: 50,    // Update meta-model every 50 verified predictions
  REGIME_WINDOW: 20,           // Window for regime detection
};

let metaModelUpdated = 0;

// ==================== IMPROVED ANOMALY DETECTION ====================
class AnomalyDetector {
  constructor() {
    this.anomalyPatterns = [];
    this.breakPoints = [];
    this.timeWindowStats = {};
    this.reinforcementMemory = { tai: 0, xiu: 0, lastAdjustment: null };
    this.confidenceHistory = { mc: {}, simple: {}, ensemble: {}, dice: {} };
    this.seasonalPatterns = {};
    this.featureWeights = { 
      trend: 30, balance: 25, entropy: 15, streak: 15, sumTrend: 15, momentum: 10 
    };
    this.featureLearningRate = 0.015;
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
        this.confidenceHistory = parsed.confidenceHistory || this.confidenceHistory;
        this.reinforcementMemory = parsed.reinforcementMemory || this.reinforcementMemory;
        console.log(`[Anomaly] Loaded ${this.anomalyPatterns.length} patterns, ${this.breakPoints.length} breaks`);
      }
    } catch (error) {
      console.error('[Anomaly] Load error:', error.message);
    }
  }

  saveAnomalyData() {
    try {
      fs.writeFileSync(ANOMALY_FILE, JSON.stringify({
        anomalyPatterns: this.anomalyPatterns.slice(-300),
        breakPoints: this.breakPoints.slice(-300),
        timeWindowStats: this.timeWindowStats,
        seasonalPatterns: this.seasonalPatterns,
        reinforcementMemory: this.reinforcementMemory,
        featureWeights: this.featureWeights,
        confidenceHistory: this.confidenceHistory,
        lastSaved: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      console.error('[Anomaly] Save error:', error.message);
    }
  }

  detectAnomaly(results, sums = [], windowSize = 10) {
    if (results.length < windowSize) return { isAnomaly: false, score: 0 };
    
    const recent = results.slice(0, windowSize);
    const recentSums = sums.slice(0, windowSize);
    const taiCount = recent.filter(r => r === 'Tài').length;
    const xiuCount = windowSize - taiCount;
    
    // Enhanced statistical detection
    const expectedMean = windowSize * 0.5;
    const expectedStd = Math.sqrt(windowSize * 0.5 * 0.5);
    const zScore = expectedStd > 0 ? Math.abs((taiCount - expectedMean) / expectedStd) : 0;
    
    // Adaptive threshold based on volatility
    const adaptiveThreshold = this.getAdaptiveThreshold(recent.map(r => r === 'Tài' ? 1 : 0));
    const isStatisticalAnomaly = zScore > adaptiveThreshold;
    
    // Runs test
    const runs = this.calculateRuns(recent);
    const expectedRuns = 1 + (2 * windowSize * taiCount * xiuCount) / Math.max(taiCount + xiuCount, 1);
    const runsVariance = (2 * taiCount * xiuCount * (2 * taiCount * xiuCount - taiCount - xiuCount)) / 
                         Math.max(Math.pow(taiCount + xiuCount, 2) * (taiCount + xiuCount - 1), 1);
    const runsZScore = Math.sqrt(runsVariance) > 0 ? Math.abs((runs - expectedRuns) / Math.sqrt(runsVariance)) : 0;
    const isRunsAnomaly = runsZScore > adaptiveThreshold;
    
    // Sum-based anomaly detection
    let sumAnomaly = false;
    let sumDirection = null;
    if (recentSums.length >= 5) {
      const avgSum = recentSums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      const sumStd = this.calculateVolatility(recentSums.slice(0, 10));
      const sumZ = sumStd > 0 ? Math.abs((avgSum - 10.5) / (sumStd / Math.sqrt(5))) : 0;
      if (sumZ > 2.0) {
        sumAnomaly = true;
        sumDirection = avgSum > 10.5 ? 'Xỉu' : 'Tài';
      }
    }
    
    const deviation = Math.abs(taiCount / windowSize - 0.5);
    const anomalyScore = Math.min(100, Math.max(0, (zScore / 3) * 100));
    
    // Advanced break detection
    let breakDetected = false;
    let breakDirection = null;
    let isAlternatingAnomaly = false;
    
    if (results.length >= 7) {
      breakDetected = this.detectBreakPatternAdvanced(results);
      if (breakDetected) {
        breakDirection = results[5] !== results[0] ? results[5] : 
                        (results[0] === 'Tài' ? 'Xỉu' : 'Tài');
      }
    }
    
    const alternatingLength = this.getAlternatingLength(results);
    isAlternatingAnomaly = alternatingLength >= 9;
    
    return {
      isAnomaly: isStatisticalAnomaly || isRunsAnomaly || sumAnomaly || breakDetected || isAlternatingAnomaly,
      score: anomalyScore,
      deviation: deviation.toFixed(3),
      taiRatio: (taiCount / windowSize * 100).toFixed(1),
      breakDetected,
      breakDirection,
      alternatingLength,
      isAlternatingAnomaly,
      zScore: zScore.toFixed(2),
      runsZScore: runsZScore.toFixed(2),
      adaptiveThreshold: adaptiveThreshold.toFixed(2),
      sumAnomaly,
      sumDirection
    };
  }

  getAdaptiveThreshold(values) {
    const volatility = this.calculateVolatility(values);
    return Math.max(1.8, Math.min(2.5, 2.2 - volatility * 1.5));
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
    if (results.length < 7) return false;
    
    // Check for significant streak break
    const streak = this.getCurrentStreak(results);
    if (streak >= 4 && results[streak] !== results[0]) return true;
    
    // 3-3-1 pattern (strong reversal)
    if (results.length >= 7) {
      const first3 = results.slice(0, 3);
      const middle3 = results.slice(3, 6);
      if (first3.every(r => r === first3[0]) && 
          middle3.every(r => r !== first3[0]) && 
          results[6] === first3[0]) {
        return true;
      }
    }
    
    // Double-top/bottom pattern
    if (results.length >= 8) {
      if (results[0] === results[2] && results[1] !== results[0] && 
          results[3] === results[1] && results[4] !== results[1]) {
        return true;
      }
    }
    
    return false;
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

  predictBreakProbability(currentStreak, currentStreakType, currentHour) {
    const base = 0.12;
    const streakFactor = Math.min(0.35, currentStreak / 12 * 0.7);
    
    let timeBonus = 0;
    if (this.breakPoints.length > 15) {
      const hourBreaks = this.breakPoints.filter(b => 
        new Date(b.timestamp).getHours() === currentHour
      );
      timeBonus = Math.min(0.15, hourBreaks.length / this.breakPoints.length * 0.6);
    }
    
    const sameTypeBreaks = this.breakPoints.filter(b => b.from === currentStreakType);
    const typeBonus = sameTypeBreaks.length > 3 ? 
      Math.min(0.12, sameTypeBreaks.length / this.breakPoints.length * 0.4) : 0;
    
    return Math.min(0.65, base + streakFactor + timeBonus + typeBonus);
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
  }

  learnFromResult(prediction, actual, confidence, featuresUsed = null) {
    const isCorrect = prediction === actual;
    const learningRate = 0.06;
    
    // Update reinforcement memory
    if (isCorrect) {
      if (prediction === 'Tài') {
        this.reinforcementMemory.tai += learningRate;
        this.reinforcementMemory.xiu -= learningRate * 0.3;
      } else {
        this.reinforcementMemory.xiu += learningRate;
        this.reinforcementMemory.tai -= learningRate * 0.3;
      }
    } else {
      if (prediction === 'Tài') {
        this.reinforcementMemory.tai -= learningRate * 1.2;
        this.reinforcementMemory.xiu += learningRate * 0.5;
      } else {
        this.reinforcementMemory.xiu -= learningRate * 1.2;
        this.reinforcementMemory.tai += learningRate * 0.5;
      }
    }
    
    this.reinforcementMemory.tai = Math.max(-2, Math.min(2, this.reinforcementMemory.tai));
    this.reinforcementMemory.xiu = Math.max(-2, Math.min(2, this.reinforcementMemory.xiu));
    
    // Update confidence calibration
    const confidenceBucket = Math.floor(confidence / 5) * 5;
    if (!this.confidenceHistory.ensemble[confidenceBucket]) {
      this.confidenceHistory.ensemble[confidenceBucket] = { correct: 0, total: 0 };
    }
    this.confidenceHistory.ensemble[confidenceBucket].total++;
    if (isCorrect) this.confidenceHistory.ensemble[confidenceBucket].correct++;
    
    // Update feature weights
    if (featuresUsed) {
      const error = isCorrect ? 1 : -1;
      for (const feat of featuresUsed) {
        if (this.featureWeights[feat] !== undefined) {
          this.featureWeights[feat] = Math.max(5, Math.min(50, 
            this.featureWeights[feat] + error * this.featureLearningRate * this.featureWeights[feat]
          ));
        }
      }
    }
    
    this.saveAnomalyData();
  }

  calibrateConfidence(rawConfidence, method) {
    if (!this.confidenceHistory[method]) return rawConfidence;
    
    const sorted = Object.entries(this.confidenceHistory[method])
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    
    if (sorted.length < 5) return rawConfidence;
    
    const raw = parseFloat(rawConfidence) / 100;
    let lower = null, upper = null;
    
    for (let i = 0; i < sorted.length; i++) {
      const [key, stats] = sorted[i];
      const bucketMid = parseInt(key) / 100;
      
      if (bucketMid <= raw) {
        lower = { 
          mid: bucketMid, 
          acc: stats.total > 0 ? stats.correct / stats.total : bucketMid 
        };
      }
      if (bucketMid >= raw && !upper) {
        upper = { 
          mid: bucketMid, 
          acc: stats.total > 0 ? stats.correct / stats.total : bucketMid 
        };
      }
    }
    
    if (!lower || !upper) return rawConfidence;
    
    let calibratedAcc = lower.acc;
    if (upper.mid - lower.mid > 0) {
      calibratedAcc = lower.acc + (upper.acc - lower.acc) * 
                     ((raw - lower.mid) / (upper.mid - lower.mid));
    }
    
    return Math.min(82, Math.max(50, Math.round(calibratedAcc * 100)));
  }

  getBiasCorrection() {
    const taiScore = this.reinforcementMemory.tai || 0;
    const xiuScore = this.reinforcementMemory.xiu || 0;
    const total = Math.abs(taiScore) + Math.abs(xiuScore);
    
    if (total < 0.3) return 0;
    
    const diff = taiScore - xiuScore;
    return Math.max(-0.12, Math.min(0.12, diff * 0.04));
  }

  updateTimeWindowStats(result, timestamp) {
    const hour = timestamp.getHours();
    const minute = Math.floor(timestamp.getMinutes() / 15) * 15;
    const dayOfWeek = timestamp.getDay();
    const windowKey = `${hour}:${String(minute).padStart(2, '0')}`;
    
    if (!this.timeWindowStats[windowKey]) {
      this.timeWindowStats[windowKey] = { 
        tai: 0, xiu: 0, total: 0,
        lastUpdate: timestamp.toISOString(),
        dayOfWeek: {}
      };
    }
    
    if (result === 'Tài') {
      this.timeWindowStats[windowKey].tai++;
    } else {
      this.timeWindowStats[windowKey].xiu++;
    }
    this.timeWindowStats[windowKey].total++;
    this.timeWindowStats[windowKey].lastUpdate = timestamp.toISOString();
    
    if (!this.timeWindowStats[windowKey].dayOfWeek[dayOfWeek]) {
      this.timeWindowStats[windowKey].dayOfWeek[dayOfWeek] = { tai: 0, xiu: 0, total: 0 };
    }
    if (result === 'Tài') {
      this.timeWindowStats[windowKey].dayOfWeek[dayOfWeek].tai++;
    } else {
      this.timeWindowStats[windowKey].dayOfWeek[dayOfWeek].xiu++;
    }
    this.timeWindowStats[windowKey].dayOfWeek[dayOfWeek].total++;
  }

  predictByTimeWindow(currentTimestamp) {
    const hour = currentTimestamp.getHours();
    const minute = Math.floor(currentTimestamp.getMinutes() / 15) * 15;
    const dayOfWeek = currentTimestamp.getDay();
    const windowKey = `${hour}:${String(minute).padStart(2, '0')}`;
    
    const stats = this.timeWindowStats[windowKey];
    if (!stats || stats.total < 8) return null;
    
    const dayStats = stats.dayOfWeek[dayOfWeek];
    let taiRatio = stats.tai / stats.total;
    
    if (dayStats && dayStats.total >= 5) {
      const dayTaiRatio = dayStats.tai / dayStats.total;
      taiRatio = (dayTaiRatio * 0.6 + taiRatio * 0.4);
    }
    
    if (taiRatio > 0.60) return { prediction: 'Tài', confidence: 50 + Math.round(taiRatio * 25) };
    if (taiRatio < 0.40) return { prediction: 'Xỉu', confidence: 50 + Math.round((1 - taiRatio) * 25) };
    
    return null;
  }

  optimizeParameters(backtestResults) {
    if (!backtestResults || backtestResults.length < 50) return;
    
    const thresholdValues = [1.8, 2.0, 2.2, 2.4, 2.6];
    let bestParams = { threshold: 2.0, accuracy: 0 };
    
    for (const threshold of thresholdValues) {
      const accuracy = this.calculateBacktestAccuracy(backtestResults, threshold);
      if (accuracy > bestParams.accuracy) {
        bestParams = { threshold, accuracy };
      }
    }
    
    this.cachedParams = bestParams;
    this.lastParamsUpdate = new Date().toISOString();
    console.log(`[Optimize] Best threshold: ${bestParams.threshold} (${(bestParams.accuracy * 100).toFixed(1)}% accuracy)`);
  }

  calculateBacktestAccuracy(results, threshold) {
    let correct = 0;
    let total = 0;
    
    for (const result of results) {
      const anomaly = this.detectAnomaly(result.historicalResults, [], 10);
      if (anomaly.zScore > threshold) {
        total++;
        const prediction = result.historicalResults[0] === 'Tài' ? 'Xỉu' : 'Tài';
        if (prediction === result.actual) correct++;
      }
    }
    
    return total > 0 ? correct / total : 0;
  }
}

// ==================== ENHANCED META ENSEMBLE ====================
class MetaEnsemble {
  constructor(numFeatures = 10) {
    this.weights = new Array(numFeatures).fill(0);
    this.bias = 0;
    this.l2Lambda = 0.001; // L2 regularization
    this.momentum = new Array(numFeatures).fill(0);
    this.momentumBeta = 0.9;
  }

  predict(featureVector) {
    const score = featureVector.reduce((s, x, i) => s + x * this.weights[i], this.bias);
    return 1 / (1 + Math.exp(-score));
  }

  update(featureVector, actualTai, learningRate = 0.02) {
    const y = actualTai ? 1 : 0;
    const p = this.predict(featureVector);
    const error = p - y;
    
    // Mini-batch SGD with momentum
    for (let i = 0; i < this.weights.length; i++) {
      const grad = error * featureVector[i] + this.l2Lambda * this.weights[i];
      this.momentum[i] = this.momentumBeta * this.momentum[i] - learningRate * grad;
      this.weights[i] += this.momentum[i];
    }
    this.bias -= learningRate * error;
  }

  extractFeatures(subModels, anomaly) {
    // Convert sub-model outputs to feature vector
    const features = [];
    
    // Method predictions as binary features
    for (const [method, data] of Object.entries(subModels)) {
      if (data.prediction === 'Tài') features.push(1);
      else if (data.prediction === 'Xỉu') features.push(-1);
      else features.push(0);
      
      features.push(data.confidence ? data.confidence / 100 : 0);
    }
    
    // Anomaly features
    features.push(anomaly ? anomaly.zScore / 3 : 0);
    features.push(anomaly ? anomaly.isAlternatingAnomaly ? 1 : 0 : 0);
    
    // Normalize to fixed length
    while (features.length < this.weights.length) {
      features.push(0);
    }
    
    return features.slice(0, this.weights.length);
  }

  save() {
    try {
      fs.writeFileSync(META_MODEL_FILE, JSON.stringify({
        weights: this.weights,
        bias: this.bias,
        momentum: this.momentum,
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      console.error('[Meta] Save error:', error.message);
    }
  }

  load() {
    try {
      if (fs.existsSync(META_MODEL_FILE)) {
        const data = JSON.parse(fs.readFileSync(META_MODEL_FILE, 'utf8'));
        this.weights = data.weights || this.weights;
        this.bias = data.bias || 0;
        this.momentum = data.momentum || new Array(this.weights.length).fill(0);
        console.log('[Meta] Model loaded');
      }
    } catch (error) {
      console.error('[Meta] Load error:', error.message);
    }
  }
}

// ==================== IMPROVED MONTE CARLO ====================
class BalancedMonteCarlo {
  constructor(historicalData, windowSize = 50) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.numSimulations = 10000;
    this.minPatterns = CONFIG.MIN_PATTERNS;
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
      last5Results: last5,
      last5TaiCount: last5Tai,
      last5Trend: this.categorizeTrend(last5),
      balanceRatio: parseFloat(balanceRatio.toFixed(3)),
      currentStreak,
      sumTrend,
      momentum: parseFloat(momentum.toFixed(3)),
      ma5: parseFloat(ma5.toFixed(1)),
      ma10: parseFloat(ma10.toFixed(1)),
      ma20: parseFloat(ma20.toFixed(1)),
      recentVolatility: this.calculateVolatility(sums.slice(0, 10)),
      entropy: parseFloat(entropy.toFixed(3)),
      timestamp: data[0]?.timestamp || new Date().toISOString()
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

  calculateVolatility(sums) {
    if (sums.length < 2) return 0;
    const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
    const variance = sums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / sums.length;
    return Math.sqrt(variance);
  }

  findBalancedPatterns(currentFeatures, maxMatches = 100, anomalyDetector = null) {
    if (Date.now() - this.lastCacheClear > 600000) {
      this.patternCache.clear();
      this.lastCacheClear = Date.now();
    }
    
    const cacheKey = JSON.stringify(currentFeatures);
    if (this.patternCache.has(cacheKey)) {
      return this.patternCache.get(cacheKey);
    }
    
    const matches = [];
    const weights = anomalyDetector ? anomalyDetector.featureWeights : this.getDefaultWeights();
    
    for (let i = 0; i <= this.historicalData.length - this.windowSize - 1; i++) {
      const windowData = this.historicalData.slice(i, i + this.windowSize);
      const windowFeatures = this.extractBalancedFeatures(windowData);
      
      if (!windowFeatures) continue;
      
      let similarity = 0;
      
      if (windowFeatures.last5Trend === currentFeatures.last5Trend) {
        similarity += weights.trend * 1.2;
      } else if (
        (windowFeatures.last5Trend.includes('tai') && currentFeatures.last5Trend.includes('tai')) ||
        (windowFeatures.last5Trend.includes('xiu') && currentFeatures.last5Trend.includes('xiu'))
      ) {
        similarity += weights.trend * 0.4;
      }
      
      const balanceDiff = Math.abs(windowFeatures.balanceRatio - currentFeatures.balanceRatio);
      similarity += Math.max(0, weights.balance - balanceDiff * 50);
      
      const entropyDiff = Math.abs(windowFeatures.entropy - currentFeatures.entropy);
      similarity += Math.max(0, weights.entropy - entropyDiff * 25);
      
      const streakDiff = Math.abs(windowFeatures.currentStreak - currentFeatures.currentStreak);
      similarity += Math.max(0, weights.streak - streakDiff * 3);
      
      if (windowFeatures.sumTrend === currentFeatures.sumTrend) {
        similarity += weights.sumTrend * 1.1;
      }
      
      const momentumDiff = Math.abs((windowFeatures.momentum || 0) - (currentFeatures.momentum || 0));
      similarity += Math.max(0, weights.momentum - momentumDiff * 35);
      
      const recencyBonus = 12 * Math.exp(-i / (this.historicalData.length * 0.2));
      similarity += recencyBonus;
      
      if (similarity > 25) {
        matches.push({
          similarity,
          index: i,
          nextResult: this.historicalData[i + this.windowSize]?.Ket_qua,
          nextSum: this.historicalData[i + this.windowSize]?.Tong,
          windowFeatures,
          recency: i / this.historicalData.length
        });
      }
    }
    
    matches.sort((a, b) => b.similarity - a.similarity);
    const topMatches = matches.slice(0, maxMatches);
    
    this.patternCache.set(cacheKey, topMatches);
    
    return topMatches;
  }

  getDefaultWeights() {
    return { trend: 30, balance: 25, entropy: 15, streak: 15, sumTrend: 15, momentum: 10 };
  }

  weightedRandomSelect(patterns) {
    if (patterns.length === 0) return patterns[0];
    const totalWeight = patterns.reduce((sum, p) => sum + p.similarity, 0);
    let random = Math.random() * totalWeight;
    for (const pattern of patterns) {
      random -= pattern.similarity;
      if (random <= 0) return pattern;
    }
    return patterns[patterns.length - 1];
  }

  runBalancedSimulation(data, anomalyDetector, currentHour) {
    const currentFeatures = this.extractBalancedFeatures(data, true);
    
    if (!currentFeatures || this.historicalData.length < 50) {
      return null; // Don't predict if insufficient data
    }
    
    const similarPatterns = this.findBalancedPatterns(currentFeatures, 100, anomalyDetector);
    
    if (similarPatterns.length < this.minPatterns) {
      return null; // Not enough similar patterns
    }
    
    let taiWins = 0;
    let xiuWins = 0;
    let totalWeight = 0;
    const usedPatterns = new Set();
    
    const adaptiveSimCount = Math.floor(this.numSimulations * (0.3 + similarPatterns.length / 100));
    
    for (let sim = 0; sim < adaptiveSimCount; sim++) {
      let selectedPattern;
      
      if (sim < similarPatterns.length * 0.3 && !usedPatterns.has(sim)) {
        selectedPattern = similarPatterns[sim];
        usedPatterns.add(sim);
      } else {
        selectedPattern = this.weightedRandomSelect(similarPatterns);
      }
      
      let weight = Math.pow(selectedPattern.similarity / 100, 1.3);
      
      if (selectedPattern.recency !== undefined) {
        weight *= (1 - selectedPattern.recency * 0.5);
      }
      
      totalWeight += weight;
      
      if (selectedPattern.nextResult === 'Tài') {
        taiWins += weight;
      } else if (selectedPattern.nextResult === 'Xỉu') {
        xiuWins += weight;
      }
    }
    
    if (totalWeight === 0) return null;
    
    let taiProbability = taiWins / totalWeight;
    
    // Apply bias correction
    const biasCorrection = anomalyDetector.getBiasCorrection();
    taiProbability += biasCorrection * 0.2;
    taiProbability = Math.max(0.30, Math.min(0.70, taiProbability));
    
    // Check if edge is significant
    if (Math.abs(taiProbability - 0.5) < 0.04) {
      return null; // Not enough edge
    }
    
    const rawConfidence = 45 + Math.abs(taiProbability - 0.5) * 95;
    const calibratedConfidence = anomalyDetector.calibrateConfidence(rawConfidence, 'mc');
    const finalConfidence = Math.min(CONFIG.MAX_CONFIDENCE, Math.round(calibratedConfidence));
    
    return {
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: (1 - taiProbability).toFixed(4),
      confidence: finalConfidence,
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      similarPatternsCount: similarPatterns.length,
      balanceRatio: currentFeatures.balanceRatio.toFixed(2),
      method: 'balanced_monte_carlo'
    };
  }
}

// ==================== IMPROVED REINFORCEMENT LEARNER ====================
class ReinforcementLearner {
  constructor() {
    this.qTable = {};
    this.learningRate = 0.06;
    this.discountFactor = 0.93;
    this.epsilon = 0.10;
    this.visitCounts = {};
    this.stateTransitions = {};
  }

  getStateKey(results) {
    if (!results || results.length < 3) return 'default';
    
    const last3 = results.slice(0, 3).join('');
    const streak = Math.min(this.getStreakLength(results), 5);
    
    return `${last3}_${streak}`;
  }

  getStreakLength(results) {
    if (results.length === 0) return 0;
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    return Math.min(streak, 8);
  }

  getAction(state, possibleActions = ['Tài', 'Xỉu']) {
    if (!this.qTable[state]) {
      this.qTable[state] = { Tài: 0.5, Xỉu: 0.5 };
      this.visitCounts[state] = 0;
      this.stateTransitions[state] = { Tài: 0, Xỉu: 0 };
    }
    
    const adaptiveEpsilon = Math.max(0.02, 
      this.epsilon / (1 + Math.log(this.visitCounts[state] + 1) * 0.15)
    );
    
    if (Math.random() < adaptiveEpsilon) {
      const action = possibleActions[Math.floor(Math.random() * possibleActions.length)];
      this.stateTransitions[state][action]++;
      return action;
    }
    
    this.visitCounts[state]++;
    
    const qDiff = (this.qTable[state].Tài || 0.5) - (this.qTable[state].Xỉu || 0.5);
    if (Math.abs(qDiff) < 0.06) {
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
    const maxNextQ = Math.max(
      this.qTable[nextState].Tài || 0.5,
      this.qTable[nextState].Xỉu || 0.5
    );
    
    const visitCount = this.visitCounts[state] || 0;
    const adaptiveLR = this.learningRate / (1 + Math.sqrt(visitCount) * 0.02);
    
    const recency = Math.exp(-visitCount / 30);
    const scaledReward = reward * (1 + recency * 0.5);
    
    const newQ = currentQ + adaptiveLR * (scaledReward + this.discountFactor * maxNextQ - currentQ);
    
    this.qTable[state][action] = Math.max(0.1, Math.min(0.9, newQ));
  }

  getQLearningPrediction(state) {
    if (!this.qTable[state]) return null;
    
    const taiValue = this.qTable[state].Tài || 0.5;
    const xiuValue = this.qTable[state].Xỉu || 0.5;
    const diff = taiValue - xiuValue;
    
    if (Math.abs(diff) < 0.10) return null;
    
    const visits = this.visitCounts[state] || 0;
    if (visits < 5) return null;
    
    return diff > 0 ? 'Tài' : 'Xỉu';
  }
}

// ==================== DICE MEAN REVERSION MODEL ====================
function predictDiceMeanReversion(sums) {
  if (!sums || sums.length < 10) return null;
  
  const recentSums = sums.slice(0, 10);
  const avgSum = recentSums.reduce((a, b) => a + b, 0) / 10;
  const stdDev = 2.9; // Known standard deviation of dice total
  const se = stdDev / Math.sqrt(10);
  const z = (avgSum - 10.5) / se;
  
  if (Math.abs(z) < 1.0) return null;
  
  const confidence = 48 + Math.min(22, Math.abs(z) * 5);
  const prediction = z > 0 ? 'Xỉu' : 'Tài';
  
  return {
    prediction,
    confidence: Math.round(confidence),
    zScore: z.toFixed(2),
    avgSum: avgSum.toFixed(1),
    method: 'dice_mean_reversion'
  };
}

// ==================== REGIME DETECTION ====================
class RegimeDetector {
  constructor() {
    this.regime = 'unknown';
    this.confidence = 0;
  }

  detectRegime(learningData) {
    if (!learningData || !learningData.recentAccuracy || learningData.recentAccuracy.length < CONFIG.REGIME_WINDOW) {
      return { regime: 'unknown', confidence: 0 };
    }
    
    const recentResults = learningData.recentAccuracy.slice(-CONFIG.REGIME_WINDOW);
    const trendWinRate = learningData.trendStrategyResults?.slice(-CONFIG.REGIME_WINDOW) || [];
    const fadeWinRate = learningData.fadeStrategyResults?.slice(-CONFIG.REGIME_WINDOW) || [];
    
    // Simple strategy: if streak prediction works >60% → trending
    if (trendWinRate.length >= 10) {
      const trendRate = trendWinRate.reduce((a, b) => a + b, 0) / trendWinRate.length;
      const fadeRate = fadeWinRate.reduce((a, b) => a + b, 0) / fadeWinRate.length;
      
      if (trendRate > 0.55) {
        this.regime = 'trending';
        this.confidence = trendRate;
      } else if (fadeRate > 0.55) {
        this.regime = 'mean_reverting';
        this.confidence = fadeRate;
      } else {
        this.regime = 'mixed';
        this.confidence = 0.5;
      }
    } else {
      // Fallback: use overall recent accuracy
      const overallRate = recentResults.reduce((a, b) => a + b, 0) / recentResults.length;
      this.regime = overallRate > 0.52 ? 'trending' : 'mixed';
      this.confidence = overallRate;
    }
    
    return { regime: this.regime, confidence: this.confidence };
  }
}

// ==================== BACKTESTING ENGINE (IMPROVED) ====================
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

  async runBacktest(type, historicalData, windowSize = 150) {
    console.log(`[Backtest] Running backtest for ${type}...`);
    
    const results = [];
    let correct = 0;
    let total = 0;
    
    // Test different configurations
    const configs = [
      { name: 'ensemble', useMC: true, useAnomaly: true, useRL: true, useTime: true, useDice: true },
      { name: 'mc_dice', useMC: true, useAnomaly: false, useRL: false, useTime: false, useDice: true },
      { name: 'mc_only', useMC: true, useAnomaly: false, useRL: false, useTime: false, useDice: false },
      { name: 'dice_only', useMC: false, useAnomaly: false, useRL: false, useTime: false, useDice: true },
    ];
    
    const configPerformance = {};
    
    for (const config of configs) {
      let configCorrect = 0;
      let configTotal = 0;
      
      for (let i = 0; i < historicalData.length - windowSize - 1; i++) {
        const window = historicalData.slice(i + 1, i + windowSize + 1);
        const actual = historicalData[i + windowSize]?.Ket_qua;
        
        if (!actual || window.length < 30) continue;
        
        const prediction = this.getBacktestPrediction(window, config);
        
        if (prediction) {
          configTotal++;
          if (prediction === actual) configCorrect++;
          
          if (config.name === 'ensemble') {
            total++;
            if (prediction === actual) correct++;
          }
        }
      }
      
      configPerformance[config.name] = {
        correct: configCorrect,
        total: configTotal,
        accuracy: configTotal > 0 ? configCorrect / configTotal : 0,
        skipRate: (historicalData.length - configTotal) / historicalData.length
      };
    }
    
    let bestConfig = null;
    let bestAccuracy = 0;
    
    for (const [name, perf] of Object.entries(configPerformance)) {
      if (perf.accuracy > bestAccuracy) {
        bestAccuracy = perf.accuracy;
        bestConfig = name;
      }
    }
    
    const backtestResult = {
      type,
      timestamp: new Date().toISOString(),
      overallAccuracy: total > 0 ? correct / total : 0,
      total,
      correct,
      configPerformance,
      bestConfig,
      bestAccuracy
    };
    
    this.results[type].push(backtestResult);
    
    if (this.results[type].length > 100) {
      this.results[type] = this.results[type].slice(-100);
    }
    
    this.bestParams[type] = {
      config: bestConfig,
      accuracy: bestAccuracy,
      updated: new Date().toISOString()
    };
    
    this.lastBacktest = new Date().toISOString();
    this.saveResults();
    
    console.log(`[Backtest] ${type}: Best config = ${bestConfig} (${(bestAccuracy * 100).toFixed(1)}%)`);
    
    return backtestResult;
  }

  getBacktestPrediction(window, config) {
    const results = window.map(d => d.Ket_qua);
    const sums = window.map(d => d.Tong);
    
    let predictions = [];
    
    if (config.useMC) {
      const last20 = results.slice(0, 20);
      const taiCount = last20.filter(r => r === 'Tài').length;
      const confidence = 45 + Math.abs(taiCount / last20.length - 0.5) * 70;
      if (confidence >= CONFIG.MIN_CONFIDENCE) {
        predictions.push({
          prediction: taiCount > last20.length / 2 ? 'Tài' : 'Xỉu',
          weight: 0.4,
          confidence
        });
      }
    }
    
    if (config.useAnomaly) {
      const streak = window.length > 0 ? 
        (function(arr) { let s = 1; for (let i = 1; i < arr.length && arr[i] === arr[0]; i++) s++; return s; })(results) : 0;
      if (streak >= 4) {
        predictions.push({
          prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
          weight: 0.3,
          confidence: 55 + streak * 3
        });
      }
    }
    
    if (config.useDice && sums.length >= 10) {
      const dicePredict = predictDiceMeanReversion(sums);
      if (dicePredict && dicePredict.confidence >= CONFIG.MIN_CONFIDENCE) {
        predictions.push({
          prediction: dicePredict.prediction,
          weight: 0.25,
          confidence: dicePredict.confidence
        });
      }
    }
    
    if (predictions.length === 0) return null; // Skip prediction
    
    let taiWeight = 0, xiuWeight = 0;
    for (const p of predictions) {
      if (p.prediction === 'Tài') taiWeight += p.weight * p.confidence;
      else xiuWeight += p.weight * p.confidence;
    }
    
    return taiWeight >= xiuWeight ? 'Tài' : 'Xỉu';
  }

  getOptimalConfig(type) {
    if (this.bestParams[type] && this.bestParams[type].config) {
      const config = {
        useMC: this.bestParams[type].config.includes('mc'),
        useAnomaly: this.bestParams[type].config.includes('anomaly'),
        useRL: this.bestParams[type].config.includes('rl'),
        useTime: this.bestParams[type].config.includes('time'),
        useDice: this.bestParams[type].config.includes('dice')
      };
      return config;
    }
    return { useMC: true, useAnomaly: true, useRL: true, useTime: true, useDice: true };
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
    recentAccuracy: [],
    trendStrategyResults: [],
    fadeStrategyResults: [],
    methodPerformance: {
      simple: { correct: 0, total: 0 },
      monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 },
      dice: { correct: 0, total: 0 },
      ensemble: { correct: 0, total: 0 }
    },
    mistakePatterns: {},
    sessionTimes: {},
    pendingSamples: []
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    trendStrategyResults: [],
    fadeStrategyResults: [],
    methodPerformance: {
      simple: { correct: 0, total: 0 },
      monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 },
      dice: { correct: 0, total: 0 },
      ensemble: { correct: 0, total: 0 }
    },
    mistakePatterns: {},
    sessionTimes: {},
    pendingSamples: []
  }
};

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let monteCarloSimulators = { hu: null, md5: null };
let anomalyDetector = new AnomalyDetector();
let rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
let backtestEngine = new BacktestEngine();
let metaEnsemble = { hu: new MetaEnsemble(10), md5: new MetaEnsemble(10) };
let regimeDetector = { hu: new RegimeDetector(), md5: new RegimeDetector() };

// ==================== HELPER FUNCTIONS ====================
function updateMonteCarloSimulators(type, data) {
  if (data && data.length >= 50) {
    monteCarloSimulators[type] = new BalancedMonteCarlo(data, 50);
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

function savePredictionToHistory(type, phien, prediction, confidence, skipped = false) {
  const record = {
    phien_hien_tai: phien.toString(),
    du_doan: skipped ? 'SKIP' : normalizeResult(prediction),
    ti_le: skipped ? '0%' : `${confidence}%`,
    id: 'kapub',
    timestamp: new Date().toISOString(),
    skipped
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > CONFIG.MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, CONFIG.MAX_HISTORY);
  }
  return record;
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
      
      for (const type of ['hu', 'md5']) {
        if (parsed[type]) {
          parsed[type].methodPerformance = parsed[type].methodPerformance || {
            simple: { correct: 0, total: 0 },
            monteCarlo: { correct: 0, total: 0 },
            anomaly: { correct: 0, total: 0 },
            dice: { correct: 0, total: 0 },
            ensemble: { correct: 0, total: 0 }
          };
          parsed[type].pendingSamples = parsed[type].pendingSamples || [];
          parsed[type].trendStrategyResults = parsed[type].trendStrategyResults || [];
          parsed[type].fadeStrategyResults = parsed[type].fadeStrategyResults || [];
        }
      }
      
      learningData = { ...learningData, ...parsed };
      console.log('[Data] Learning data loaded');
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
        
        const mistakeKey = `${currentData.slice(0, 5).map(d => d.Ket_qua).join('')}`;
        if (!learningData[type].mistakePatterns[mistakeKey]) {
          learningData[type].mistakePatterns[mistakeKey] = { count: 0, lastSeen: null };
        }
        learningData[type].mistakePatterns[mistakeKey].count++;
        learningData[type].mistakePatterns[mistakeKey].lastSeen = new Date().toISOString();
      }
      
      // Track trend/fade strategy results
      const lastResult = currentData[1]?.Ket_qua;
      const currentResult = actualResult.Ket_qua;
      if (lastResult) {
        learningData[type].trendStrategyResults.push(lastResult === currentResult ? 1 : 0);
        learningData[type].fadeStrategyResults.push(lastResult !== currentResult ? 1 : 0);
        if (learningData[type].trendStrategyResults.length > 200) {
          learningData[type].trendStrategyResults = learningData[type].trendStrategyResults.slice(-200);
          learningData[type].fadeStrategyResults = learningData[type].fadeStrategyResults.slice(-200);
        }
      }
      
      // Add to pending samples for delayed learning
      if (pred.methods) {
        learningData[type].pendingSamples.push({
          methods: pred.methods,
          correct: pred.isCorrect,
          timestamp: now,
          confidence: pred.confidence,
          prediction: pred.prediction,
          actual: pred.actual
        });
        
        if (learningData[type].pendingSamples.length > 100) {
          learningData[type].pendingSamples = learningData[type].pendingSamples.slice(-100);
        }
      }
      
      // Update method performance after delay
      const delayThreshold = now - 300000; // 5 min delay
      while (learningData[type].pendingSamples.length > 0 && 
             learningData[type].pendingSamples[0].timestamp < delayThreshold) {
        const sample = learningData[type].pendingSamples.shift();
        if (sample.methods) {
          for (const [method, used] of Object.entries(sample.methods)) {
            if (used && learningData[type].methodPerformance[method]) {
              learningData[type].methodPerformance[method].total++;
              if (sample.correct) learningData[type].methodPerformance[method].correct++;
            }
          }
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 200) {
        learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-200);
      }
      
      // Update RL
      const stateKey = rlLearner[type].getStateKey(currentData.slice(0, 10).map(d => d.Ket_qua));
      const reward = pred.isCorrect ? 0.8 : -0.4;
      rlLearner[type].updateQValue(stateKey, pred.prediction, reward, stateKey);
      
      // Update anomaly detector
      anomalyDetector.learnFromResult(
        pred.prediction, 
        pred.actual, 
        pred.confidence,
        pred.factors ? Object.keys(pred.factors) : null
      );
      anomalyDetector.updateTimeWindowStats(pred.actual, new Date(pred.timestamp));
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
    anomalyDetector.saveAnomalyData();
    
    // Update meta model periodically
    if (learningData[type].predictions.filter(p => p.verified).length % CONFIG.META_UPDATE_INTERVAL < 10) {
      updateMetaModel(type);
    }
  }
}

function updateMetaModel(type) {
  const verifiedPreds = learningData[type].predictions.filter(p => p.verified && p.isCorrect !== null);
  if (verifiedPreds.length < 30) return;
  
  const recent = verifiedPreds.slice(0, 100);
  for (const pred of recent) {
    if (pred.subModelOutput) {
      const features = pred.subModelOutput;
      const actualTai = pred.actual === 'Tài';
      metaEnsemble[type].update(features, actualTai, CONFIG.META_LEARNING_RATE);
    }
  }
  
  metaEnsemble[type].save();
  metaModelUpdated++;
}

// ==================== MAIN PREDICTION FUNCTION ====================
function calculateSuperPrediction(data, type) {
  const results = data.slice(0, 30).map(d => d.Ket_qua);
  const sums = data.slice(0, 30).map(d => d.Tong);
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  
  let predictions = [];
  let factors = [];
  let methodsUsed = {};
  let subModelOutputs = {};
  
  const regime = regimeDetector[type].detectRegime(learningData[type]);
  factors.push(`Regime: ${regime.regime} (${(regime.confidence * 100).toFixed(0)}%)`);
  
  // 1. Simple Pattern Analysis
  const simplePattern = analyzeSimplePattern(results, type, regime);
  if (simplePattern.confidence >= CONFIG.MIN_CONFIDENCE) {
    predictions.push({
      prediction: simplePattern.prediction,
      confidence: simplePattern.confidence,
      weight: regime.regime === 'trending' ? 0.4 : 0.25,
      name: simplePattern.name,
      method: 'simple'
    });
    methodsUsed.simple = true;
    subModelOutputs.simple = { prediction: simplePattern.prediction, confidence: simplePattern.confidence };
  }
  
  // 2. Anomaly Detection
  const anomaly = anomalyDetector.detectAnomaly(results, sums, 10);
  if (anomaly.isAnomaly && anomaly.zScore >= 2.0) {
    factors.push(`⚠️ Anomaly (${anomaly.taiRatio}% Tài, z=${anomaly.zScore})`);
    
    // Only use anomaly break with strong signal and support
    if (anomaly.breakDetected && anomaly.breakDirection && anomaly.zScore >= 2.2) {
      const supportCount = predictions.filter(p => p.prediction === anomaly.breakDirection).length;
      if (supportCount >= 1 || anomaly.zScore >= 2.8) {
        predictions.push({
          prediction: anomaly.breakDirection,
          confidence: Math.min(75, 60 + anomaly.zScore * 3),
          weight: 0.30,
          name: 'Anomaly Break',
          method: 'anomaly'
        });
        methodsUsed.anomaly = true;
        subModelOutputs.anomaly = { 
          prediction: anomaly.breakDirection, 
          confidence: Math.min(75, 60 + anomaly.zScore * 3) 
        };
      }
    }
    
    // Sum-based anomaly
    if (anomaly.sumAnomaly && anomaly.sumDirection) {
      predictions.push({
        prediction: anomaly.sumDirection,
        confidence: 65,
        weight: 0.20,
        name: 'Sum Anomaly',
        method: 'anomaly'
      });
      methodsUsed.anomaly = true;
    }
  }
  
  // 3. Monte Carlo Simulation (only if confident)
  if (monteCarloSimulators[type]) {
    const mcResult = monteCarloSimulators[type].runBalancedSimulation(data, anomalyDetector, currentHour);
    if (mcResult && mcResult.confidence >= CONFIG.MIN_CONFIDENCE) {
      predictions.push({
        prediction: mcResult.prediction,
        confidence: mcResult.confidence,
        weight: regime.regime === 'trending' ? 0.3 : 0.4,
        name: `Monte Carlo (${mcResult.similarPatternsCount} patterns)`,
        method: 'monteCarlo'
      });
      methodsUsed.monteCarlo = true;
      subModelOutputs.monteCarlo = { prediction: mcResult.prediction, confidence: mcResult.confidence };
      factors.push(`MC: ${(parseFloat(mcResult.taiProbability) * 100).toFixed(0)}% Tài`);
    }
  }
  
  // 4. Dice Mean Reversion
  const dicePredict = predictDiceMeanReversion(sums);
  if (dicePredict && dicePredict.confidence >= CONFIG.MIN_CONFIDENCE) {
    predictions.push({
      prediction: dicePredict.prediction,
      confidence: dicePredict.confidence,
      weight: 0.20,
      name: `Dice Reversion (z=${dicePredict.zScore})`,
      method: 'dice'
    });
    methodsUsed.dice = true;
    subModelOutputs.dice = { prediction: dicePredict.prediction, confidence: dicePredict.confidence };
    factors.push(`Dice: avg=${dicePredict.avgSum}, z=${dicePredict.zScore}`);
  }
  
  // 5. Time Window Prediction
  const timePrediction = anomalyDetector.predictByTimeWindow(currentTime);
  if (timePrediction && timePrediction.confidence >= CONFIG.MIN_CONFIDENCE) {
    predictions.push({
      prediction: timePrediction.prediction,
      confidence: timePrediction.confidence,
      weight: 0.15,
      name: 'Time Window',
      method: 'timeWindow'
    });
    methodsUsed.timeWindow = true;
    subModelOutputs.timeWindow = { prediction: timePrediction.prediction, confidence: timePrediction.confidence };
  }
  
  // 6. Q-Learning Prediction
  const stateKey = rlLearner[type].getStateKey(results);
  const qPrediction = rlLearner[type].getQLearningPrediction(stateKey);
  if (qPrediction) {
    const qConfidence = 60;
    if (qConfidence >= CONFIG.MIN_CONFIDENCE) {
      predictions.push({
        prediction: qPrediction,
        confidence: qConfidence,
        weight: 0.15,
        name: 'Q-Learning',
        method: 'rl'
      });
      methodsUsed.rl = true;
      subModelOutputs.rl = { prediction: qPrediction, confidence: qConfidence };
    }
  }
  
  // Check if we have enough predictions with sufficient agreement
  if (predictions.length < CONFIG.ENSEMBLE_MIN_AGREEMENT) {
    return { 
      skip: true, 
      prediction: null, 
      confidence: 0, 
      factors: ['Insufficient signals'], 
      methodsUsed 
    };
  }
  
  // Meta-ensemble if model is trained
  let metaPrediction = null;
  if (metaModelUpdated > 5) {
    try {
      const featureVector = metaEnsemble[type].extractFeatures(subModelOutputs, anomaly);
      const metaProb = metaEnsemble[type].predict(featureVector);
      if (Math.abs(metaProb - 0.5) > 0.06) {
        metaPrediction = {
          prediction: metaProb > 0.5 ? 'Tài' : 'Xỉu',
          confidence: Math.round(50 + Math.abs(metaProb - 0.5) * 80),
          weight: 0.35
        };
        predictions.push({ ...metaPrediction, method: 'meta', name: 'Meta Ensemble' });
        methodsUsed.meta = true;
      }
    } catch (error) {
      // Meta model not ready, continue with standard ensemble
    }
  }
  
  // Weighted ensemble calculation
  let taiScore = 0, xiuScore = 0, totalWeight = 0;
  
  predictions.forEach(p => {
    const w = p.weight * (p.confidence / 100);
    if (p.prediction === 'Tài') taiScore += w;
    else if (p.prediction === 'Xỉu') xiuScore += w;
    totalWeight += w;
  });
  
  if (totalWeight === 0) {
    return { skip: true, prediction: null, confidence: 0, factors: ['No clear signal'], methodsUsed };
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // Temporal smoothing
  const margin = Math.abs(taiScore - xiuScore) / totalWeight;
  if (margin < 0.04) {
    return { skip: true, prediction: null, confidence: 0, factors: ['Low confidence margin'], methodsUsed };
  }
  
  // Calculate final confidence
  let finalConfidence = Math.round((Math.max(taiScore, xiuScore) / totalWeight) * 100);
  
  // Check agreement bonus
  const predictionsAgree = predictions.filter(p => p.prediction === finalPrediction).length;
  const agreementRatio = predictionsAgree / predictions.length;
  
  if (agreementRatio < 0.5) {
    return { skip: true, prediction: null, confidence: 0, factors: ['Methods disagree'], methodsUsed };
  }
  
  // Calibrate and apply edge check  finalConfidence = Math.round(anomalyDetector.calibrateConfidence(finalConfidence, 'ensemble'));
  finalConfidence = Math.min(CONFIG.MAX_CONFIDENCE, finalConfidence);
  
  // Edge check (Kelly criterion)
  const edge = (finalConfidence / 100 - 0.5);
  if (edge < CONFIG.MIN_EDGE) {
    return { skip: true, prediction: null, confidence: 0, factors: ['Edge too small'], methodsUsed };
  }
  
  return {
    skip: false,
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPredictions: predictions,
    methodsUsed,
    subModelOutputs
  };
}

function analyzeSimplePattern(results, type, regime) {
  if (results.length < 3) return { prediction: results[0] || 'Tài', confidence: 50, name: 'default' };
  
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  
  // Check mistake patterns
  if (learningData[type]) {
    const patternKey = results.slice(0, 5).join('');
    const mistakeCount = learningData[type].mistakePatterns[patternKey]?.count || 0;
    
    if (mistakeCount >= 4) {
      return {
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: 52,
        name: `Mistake Pattern (${mistakeCount})`
      };
    }
  }
  
  if (regime.regime === 'trending' && streak >= 3) {
    return {
      prediction: results[0],
      confidence: 58 + Math.min(15, streak * 3),
      name: `Trend Continue ${streak}`
    };
  }
  
  if (regime.regime === 'mean_reverting' && streak >= 3) {
    return {
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 58 + Math.min(15, streak * 3),
      name: `Fade Streak ${streak}`
    };
  }
  
  if (streak >= 5) {
    return {
      prediction: results[0],
      confidence: 60 + Math.min(15, streak * 2),
      name: `Strong Streak ${streak}`
    };
  }
  
  // Check alternating pattern
  let alternating = true;
  for (let i = 1; i < Math.min(results.length, 8); i++) {
    if (results[i] === results[i-1]) {
      alternating = false;
      break;
    }
  }
  
  if (alternating && results.length >= 6) {
    return {
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 55,
      name: 'Alternating Pattern'
    };
  }
  
  return {
    prediction: results[0],
    confidence: 50,
    name: 'Follow Last'
  };
}

// ==================== AUTO PROCESS ====================
async function autoProcessPredictions() {
  try {
    // Process HU
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      updateMonteCarloSimulators('hu', dataHu);
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateSuperPrediction(dataHu, 'hu');
        
        if (result.skip) {
          savePredictionToHistory('hu', nextHuPhien, null, 0, true);
          console.log(`[Hu #${nextHuPhien}] SKIP - ${result.factors.join(' | ')}`);
        } else {
          savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
          recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, 
            result.factors, result.methodsUsed, result.subModelOutputs);
          console.log(`[Hu #${nextHuPhien}] ${result.prediction} (${result.confidence}%) | ${result.factors.slice(0,3).join(' | ')}`);
        }
        
        lastProcessedPhien.hu = nextHuPhien;
      }
    }
    
    // Process MD5
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      updateMonteCarloSimulators('md5', dataMd5);
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateSuperPrediction(dataMd5, 'md5');
        
        if (result.skip) {
          savePredictionToHistory('md5', nextMd5Phien, null, 0, true);
          console.log(`[MD5 #${nextMd5Phien}] SKIP - ${result.factors.join(' | ')}`);
        } else {
          savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
          recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, 
            result.factors, result.methodsUsed, result.subModelOutputs);
          console.log(`[MD5 #${nextMd5Phien}] ${result.prediction} (${result.confidence}%) | ${result.factors.slice(0,3).join(' | ')}`);
        }
        
        lastProcessedPhien.md5 = nextMd5Phien;
      }
    }
    
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

function recordPrediction(type, phien, prediction, confidence, factors, methods, subModelOutputs) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    factors,
    methods,
    subModelOutputs,
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

async function runBacktests() {
  try {
    console.log('[Backtest] Starting periodic backtesting...');
    
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length >= 150) {
      await backtestEngine.runBacktest('hu', dataHu);
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length >= 150) {
      await backtestEngine.runBacktest('md5', dataMd5);
    }
    
    console.log('[Backtest] Cycle completed');
  } catch (error) {
    console.error('[Backtest] Error:', error.message);
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
    
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    for (const [pattern, data] of Object.entries(learningData[type].mistakePatterns)) {
      if (data.lastSeen && data.lastSeen < oneDayAgo) {
        delete learningData[type].mistakePatterns[pattern];
      }
    }
    
    if (predictionHistory[type].length > CONFIG.MAX_HISTORY) {
      predictionHistory[type] = predictionHistory[type].slice(0, CONFIG.MAX_HISTORY);
    }
  }
  
  saveLearningData();
  savePredictionHistory();
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
    
    if (result.skip) {
      savePredictionToHistory('hu', nextPhien, null, 0, true);
      res.json({
        skip: true,
        message: result.factors.join(', '),
        phien_hien_tai: nextPhien.toString(),
        id: 'kapub'
      });
    } else {
      savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
      recordPrediction('hu', nextPhien, result.prediction, result.confidence, 
        result.factors, result.methodsUsed, result.subModelOutputs);
      res.json({
        phien_hien_tai: nextPhien.toString(),
        du_doan: normalizeResult(result.prediction),
        ti_le: `${result.confidence}%`,
        id: 'kapub'
      });
    }
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
    
    if (result.skip) {
      savePredictionToHistory('md5', nextPhien, null, 0, true);
      res.json({
        skip: true,
        message: result.factors.join(', '),
        phien_hien_tai: nextPhien.toString(),
        id: 'kapub'
      });
    } else {
      savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
      recordPrediction('md5', nextPhien, result.prediction, result.confidence, 
        result.factors, result.methodsUsed, result.subModelOutputs);
      res.json({
        phien_hien_tai: nextPhien.toString(),
        du_doan: normalizeResult(result.prediction),
        ti_le: `${result.confidence}%`,
        id: 'kapub'
      });
    }
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
        status: record.skipped ? '⏭️' : 
                (prediction?.isCorrect === true ? '✅' : 
                 (prediction?.isCorrect === false ? '❌' : '⏳'))
      };
    });
    
    res.json({ 
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ', 
      history: historyWithStatus, 
      total: historyWithStatus.length 
    });
  } catch (error) {
    res.json({ 
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ', 
      history: predictionHistory.hu, 
      total: predictionHistory.hu.length 
    });
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
        status: record.skipped ? '⏭️' : 
                (prediction?.isCorrect === true ? '✅' : 
                 (prediction?.isCorrect === false ? '❌' : '⏳'))
      };
    });
    
    res.json({ 
      type: 'Lẩu Cua 79 - Tài Xỉu MD5', 
      history: historyWithStatus, 
      total: historyWithStatus.length 
    });
  } catch (error) {
    res.json({ 
      type: 'Lẩu Cua 79 - Tài Xỉu MD5', 
      history: predictionHistory.md5, 
      total: predictionHistory.md5.length 
    });
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
      skip: result.skip,
      prediction: result.skip ? null : normalizeResult(result.prediction),
      confidence: result.skip ? 0 : result.confidence,
      factors: result.factors,
      methods: result.methodsUsed,
      details: result.allPredictions?.map(p => ({
        method: p.method,
        prediction: p.prediction,
        confidence: p.confidence,
        weight: p.weight
      }))
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
      skip: result.skip,
      prediction: result.skip ? null : normalizeResult(result.prediction),
      confidence: result.skip ? 0 : result.confidence,
      factors: result.factors,
      methods: result.methodsUsed,
      details: result.allPredictions?.map(p => ({
        method: p.method,
        prediction: p.prediction,
        confidence: p.confidence,
        weight: p.weight
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/stats', (req, res) => {
  const stats = learningData.hu;
  const overallAccuracy = stats.totalPredictions > 0
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
  
  const regime = regimeDetector.hu.detectRegime(stats);
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${overallAccuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    regime,
    methodPerformance: methodAccuracies,
    mistakedPatterns: Object.keys(stats.mistakePatterns).length,
    skippedRate: stats.predictions.filter(p => p.confidence === 0).length / stats.totalPredictions * 100,
    lastUpdate: stats.lastUpdate
  });
});

app.get('/lc79-md5/stats', (req, res) => {
  const stats = learningData.md5;
  const overallAccuracy = stats.totalPredictions > 0
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
  
  const regime = regimeDetector.md5.detectRegime(stats);
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${overallAccuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    regime,
    methodPerformance: methodAccuracies,
    mistakedPatterns: Object.keys(stats.mistakePatterns).length,
    skippedRate: stats.predictions.filter(p => p.confidence === 0).length / stats.totalPredictions * 100,
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
      predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
      patternWeights: {}, lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [], trendStrategyResults: [], fadeStrategyResults: [],
      methodPerformance: {
        simple: { correct: 0, total: 0 },
        monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 },
        dice: { correct: 0, total: 0 },
        ensemble: { correct: 0, total: 0 }
      },
      mistakePatterns: {}, sessionTimes: {}, pendingSamples: []
    },
    md5: {
      predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
      patternWeights: {}, lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [], trendStrategyResults: [], fadeStrategyResults: [],
      methodPerformance: {
        simple: { correct: 0, total: 0 },
        monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 },
        dice: { correct: 0, total: 0 },
        ensemble: { correct: 0, total: 0 }
      },
      mistakePatterns: {}, sessionTimes: {}, pendingSamples: []
    }
  };
  
  monteCarloSimulators = { hu: null, md5: null };
  anomalyDetector = new AnomalyDetector();
  rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  backtestEngine = new BacktestEngine();
  metaEnsemble = { hu: new MetaEnsemble(10), md5: new MetaEnsemble(10) };
  regimeDetector = { hu: new RegimeDetector(), md5: new RegimeDetector() };
  metaModelUpdated = 0;
  
  saveLearningData();
  savePredictionHistory();
  anomalyDetector.saveAnomalyData();
  
  res.json({ message: 'All data reset successfully' });
});

// ==================== SERVER STARTUP ====================
loadLearningData();
loadPredictionHistory();
anomalyDetector.loadAnomalyData();
backtestEngine.loadResults();
metaEnsemble.hu.load();
metaEnsemble.md5.load();

// Start main prediction loop
setInterval(() => autoProcessPredictions(), CONFIG.AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);

// Start backtesting loop
setInterval(() => runBacktests(), CONFIG.BACKTEST_INTERVAL);
setTimeout(() => runBacktests(), 10000);

// Periodic cleanup
setInterval(() => cleanupOldData(), CONFIG.CLEANUP_INTERVAL);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - AI PREDICTION v9.0 - META-LEARNING SYSTEM     ║`);
  console.log(`║  Monte Carlo | Anomaly | Q-Learning | Dice | Meta | Regime      ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server running: http://0.0.0.0:${PORT}`);
  console.log(`\n🚀 KEY FEATURES:`);
  console.log(`  ✅ Confidence gating (min ${CONFIG.MIN_CONFIDENCE}%)`);
  console.log(`  ✅ Meta-ensemble with logistic regression`);
  console.log(`  ✅ Dice mean reversion model`);
  console.log(`  ✅ Regime detection (trending/fading/mixed)`);
  console.log(`  ✅ Temporal smoothing`);
  console.log(`  ✅ Kelly criterion edge validation`);
  console.log(`  ✅ Delayed method performance update (anti-overfitting)`);
  console.log(`  ✅ Adaptive anomaly detection`);
  console.log(`  ✅ Mistake pattern learning`);
  console.log(`  ✅ Automatic backtesting & parameter optimization`);
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
  
  console.log(`⚡ Auto-prediction: Every ${CONFIG.AUTO_SAVE_INTERVAL/1000}s`);
  console.log(`🧪 Auto-backtest: Every ${CONFIG.BACKTEST_INTERVAL/1000}s`);
  console.log(`🧹 Auto-cleanup: Every ${CONFIG.CLEANUP_INTERVAL/3600000}h`);
  console.log(`🎯 Min Confidence: ${CONFIG.MIN_CONFIDENCE}% | Min Edge: ${(CONFIG.MIN_EDGE*100).toFixed(1)}%`);
  console.log(`📊 Meta Model Updates: Every ${CONFIG.META_UPDATE_INTERVAL} predictions\n`);
});
