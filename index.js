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
const METRICS_FILE = 'model_metrics.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== MODEL EVALUATOR ====================
class ModelEvaluator {
  constructor() {
    this.metrics = {
      accuracy: [],
      precision: { Tai: [], Xiu: [] },
      recall: { Tai: [], Xiu: [] },
      f1Score: [],
      brierScore: [],
      logLoss: []
    };
  }

  evaluatePrediction(prediction, actual, confidence) {
    const isCorrect = prediction === actual;
    
    this.metrics.accuracy.push(isCorrect ? 1 : 0);
    if (this.metrics.accuracy.length > 100) this.metrics.accuracy.shift();
    
    const predictedProb = confidence / 100;
    const actualOutcome = actual === 'Tài' ? 1 : 0;
    const brierScore = Math.pow(predictedProb - actualOutcome, 2);
    this.metrics.brierScore.push(brierScore);
    if (this.metrics.brierScore.length > 100) this.metrics.brierScore.shift();
    
    const epsilon = 1e-15;
    const logLoss = -(actualOutcome * Math.log2(Math.max(predictedProb, epsilon)) + 
                      (1 - actualOutcome) * Math.log2(Math.max(1 - predictedProb, epsilon)));
    this.metrics.logLoss.push(logLoss);
    if (this.metrics.logLoss.length > 100) this.metrics.logLoss.shift();
    
    if (prediction === 'Tài') {
      this.metrics.precision.Tai.push(isCorrect ? 1 : 0);
      if (this.metrics.precision.Tai.length > 100) this.metrics.precision.Tai.shift();
    }
    if (prediction === 'Xỉu') {
      this.metrics.precision.Xiu.push(isCorrect ? 1 : 0);
      if (this.metrics.precision.Xiu.length > 100) this.metrics.precision.Xiu.shift();
    }
    if (actual === 'Tài') {
      this.metrics.recall.Tai.push(isCorrect ? 1 : 0);
      if (this.metrics.recall.Tai.length > 100) this.metrics.recall.Tai.shift();
    }
    if (actual === 'Xỉu') {
      this.metrics.recall.Xiu.push(isCorrect ? 1 : 0);
      if (this.metrics.recall.Xiu.length > 100) this.metrics.recall.Xiu.shift();
    }
    
    if (this.metrics.accuracy.length >= 10) {
      const precisionTai = this.calculateAverage(this.metrics.precision.Tai.slice(-50));
      const recallTai = this.calculateAverage(this.metrics.recall.Tai.slice(-50));
      const f1Tai = (precisionTai + recallTai > 0) ? 
        2 * (precisionTai * recallTai) / (precisionTai + recallTai) : 0;
      
      const precisionXiu = this.calculateAverage(this.metrics.precision.Xiu.slice(-50));
      const recallXiu = this.calculateAverage(this.metrics.recall.Xiu.slice(-50));
      const f1Xiu = (precisionXiu + recallXiu > 0) ? 
        2 * (precisionXiu * recallXiu) / (precisionXiu + recallXiu) : 0;
      
      const f1Macro = (f1Tai + f1Xiu) / 2;
      this.metrics.f1Score.push(f1Macro);
      if (this.metrics.f1Score.length > 100) this.metrics.f1Score.shift();
    }
  }

  calculateAverage(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  getCurrentMetrics() {
    const accArray = this.metrics.accuracy.slice(-50);
    const accuracy = this.calculateAverage(accArray);
    
    return {
      accuracy: (accuracy * 100).toFixed(2),
      precisionTai: (this.calculateAverage(this.metrics.precision.Tai.slice(-50)) * 100).toFixed(2),
      precisionXiu: (this.calculateAverage(this.metrics.precision.Xiu.slice(-50)) * 100).toFixed(2),
      recallTai: (this.calculateAverage(this.metrics.recall.Tai.slice(-50)) * 100).toFixed(2),
      recallXiu: (this.calculateAverage(this.metrics.recall.Xiu.slice(-50)) * 100).toFixed(2),
      f1Score: (this.calculateAverage(this.metrics.f1Score.slice(-50)) * 100).toFixed(2),
      calibration: ((1 - this.calculateAverage(this.metrics.brierScore.slice(-50))) * 100).toFixed(2),
      logLoss: this.calculateAverage(this.metrics.logLoss.slice(-50)).toFixed(4),
      sampleSize: accArray.length
    };
  }

  saveMetrics() {
    try {
      fs.writeFileSync(METRICS_FILE, JSON.stringify({
        metrics: this.metrics,
        summary: this.getCurrentMetrics(),
        lastSaved: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      console.error('[Metrics] Save error:', error.message);
    }
  }

  loadMetrics() {
    try {
      if (fs.existsSync(METRICS_FILE)) {
        const data = fs.readFileSync(METRICS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        if (parsed.metrics) {
          this.metrics = parsed.metrics;
          console.log('[Metrics] Loaded evaluation data');
        }
      }
    } catch (error) {
      console.error('[Metrics] Load error:', error.message);
    }
  }
}

// ==================== ANOMALY DETECTION ENGINE ====================
class AnomalyDetector {
  constructor() {
    this.anomalyPatterns = [];
    this.breakPoints = [];
    this.timeWindowStats = {};
    this.reinforcementMemory = { tai: 0, xiu: 0, lastAdjustment: null };
    this.confidenceHistory = { mc: {}, simple: {}, anomaly: {}, ensemble: {} };
    this.seasonalPatterns = {};
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
        if (parsed.reinforcementMemory) {
          this.reinforcementMemory = parsed.reinforcementMemory;
        }
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
        seasonalPatterns: this.seasonalPatterns,
        reinforcementMemory: this.reinforcementMemory,
        lastSaved: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      console.error('[Anomaly] Save error:', error.message);
    }
  }

  calculateExpectedProbability(results, windowSize = 20) {
    const recent = results.slice(0, Math.min(windowSize, results.length));
    const taiCount = recent.filter(r => r === 'Tài').length;
    const alpha = 1;
    const beta = 1;
    return (taiCount + alpha) / (recent.length + alpha + beta);
  }

  detectRegimeShift(results) {
    if (results.length < 20) return { shifted: false, magnitude: 0, direction: null };
    
    const olderResults = results.slice(10, 20);
    const recentResults = results.slice(0, 10);
    
    const olderTaiRatio = olderResults.filter(r => r === 'Tài').length / 10;
    const recentTaiRatio = recentResults.filter(r => r === 'Tài').length / 10;
    
    const cusum = Math.abs(recentTaiRatio - olderTaiRatio) * 10;
    
    return {
      shifted: cusum > 2.5,
      magnitude: cusum,
      direction: recentTaiRatio > olderTaiRatio ? 'Tài' : 'Xỉu'
    };
  }

  detectAnomaly(results, windowSize = 10) {
    if (results.length < windowSize) return { isAnomaly: false, score: 0 };
    
    const recent = results.slice(0, windowSize);
    const taiCount = recent.filter(r => r === 'Tài').length;
    const xiuCount = windowSize - taiCount;
    
    const expectedMean = windowSize * 0.5;
    const expectedStd = Math.sqrt(windowSize * 0.5 * 0.5);
    const zScore = expectedStd > 0 ? Math.abs((taiCount - expectedMean) / expectedStd) : 0;
    const isStatisticalAnomaly = zScore > 1.96;
    
    const runs = this.calculateRuns(recent);
    const expectedRuns = 1 + (2 * windowSize * 0.5 * 0.5) / 1;
    const runsStd = Math.sqrt((2 * windowSize * 0.5 * 0.5 * (2 * windowSize * 0.5 * 0.5 - windowSize)) / (windowSize * windowSize * (windowSize - 1)));
    const runsZScore = runsStd > 0 ? Math.abs((runs - expectedRuns) / runsStd) : 0;
    const isRunsAnomaly = runsZScore > 1.96;
    
    const regimeShift = this.detectRegimeShift(results);
    
    const deviation = Math.abs(taiCount / windowSize - 0.5);
    const anomalyScore = Math.min(100, Math.max(0, (zScore / 3) * 100));
    
    let breakDetected = false;
    let breakDirection = null;
    let isAlternatingAnomaly = false;
    
    if (results.length >= 6) {
      breakDetected = this.detectBreakPatternAdvanced(results);
      if (breakDetected && results.length >= 6) {
        breakDirection = results[5] !== results[0] ? results[5] : (results[0] === 'Tài' ? 'Xỉu' : 'Tài');
      }
    }
    
    const alternatingLength = this.getAlternatingLength(results);
    isAlternatingAnomaly = alternatingLength >= 8;
    
    return {
      isAnomaly: isStatisticalAnomaly || isRunsAnomaly || regimeShift.shifted || breakDetected || isAlternatingAnomaly,
      score: anomalyScore,
      deviation: deviation.toFixed(3),
      taiRatio: (taiCount / windowSize * 100).toFixed(1),
      breakDetected,
      breakDirection,
      alternatingLength,
      isAlternatingAnomaly,
      zScore: zScore.toFixed(2),
      runsZScore: runsZScore.toFixed(2),
      regimeShift
    };
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

  detectFractalPatterns(results) {
    const patterns = {
      '111': 0, '222': 0, '333': 0, '444': 0,
      '121': 0, '212': 0,
      '122': 0, '211': 0,
      '112': 0, '221': 0
    };
    
    for (let i = 0; i < results.length - 2; i++) {
      const seq = results.slice(i, i + 3)
        .map(r => r === 'Tài' ? '1' : '2')
        .join('');
      if (patterns[seq] !== undefined) {
        patterns[seq]++;
      }
    }
    
    return patterns;
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
      const sixth = results[5];
      if (first5.every(r => r === first5[0]) && sixth !== first5[0]) return true;
    }
    
    return false;
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

  predictBreakProbability(currentStreak, currentStreakType, currentHour) {
    if (this.breakPoints.length < 10) {
      return Math.min(0.85, 0.2 + (currentStreak / 10) * 0.5);
    }
    
    const sameHourBreaks = this.breakPoints.filter(b => {
      const hour = new Date(b.timestamp).getHours();
      return hour === currentHour;
    });
    
    const sameTypeBreaks = this.breakPoints.filter(b => b.from === currentStreakType);
    
    let probability = 0.25;
    
    if (sameHourBreaks.length > 5) {
      const hourBreakRate = sameHourBreaks.length / this.breakPoints.length;
      probability += hourBreakRate * 0.3;
    }
    
    if (sameTypeBreaks.length > 5) {
      const typeBreakRate = sameTypeBreaks.length / this.breakPoints.length;
      probability += typeBreakRate * 0.25;
    }
    
    probability += Math.min(0.4, currentStreak / 12);
    
    return Math.min(0.85, probability);
  }

  learnFromResult(prediction, actual, confidence) {
    const isCorrect = prediction === actual;
    const learningRate = 0.1;
    
    if (isCorrect) {
      if (prediction === 'Tài') {
        this.reinforcementMemory.tai += learningRate;
        this.reinforcementMemory.xiu -= learningRate * 0.5;
      } else {
        this.reinforcementMemory.xiu += learningRate;
        this.reinforcementMemory.tai -= learningRate * 0.5;
      }
      this.reinforcementMemory.lastAdjustment = new Date().toISOString();
    } else {
      if (prediction === 'Tài') {
        this.reinforcementMemory.tai -= learningRate * 1.5;
        this.reinforcementMemory.xiu += learningRate;
      } else {
        this.reinforcementMemory.xiu -= learningRate * 1.5;
        this.reinforcementMemory.tai += learningRate;
      }
    }
    
    const confidenceBucket = Math.floor(confidence / 10) * 10;
    for (const method of ['mc', 'simple', 'anomaly', 'ensemble']) {
      if (!this.confidenceHistory[method]) this.confidenceHistory[method] = {};
      if (!this.confidenceHistory[method][confidenceBucket]) {
        this.confidenceHistory[method][confidenceBucket] = { correct: 0, total: 0 };
      }
    }
    this.confidenceHistory.ensemble[confidenceBucket].total++;
    if (isCorrect) this.confidenceHistory.ensemble[confidenceBucket].correct++;
    
    this.reinforcementMemory.tai = Math.max(-3, Math.min(3, this.reinforcementMemory.tai));
    this.reinforcementMemory.xiu = Math.max(-3, Math.min(3, this.reinforcementMemory.xiu));
    
    this.saveAnomalyData();
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
    const windowKey = `${hour}:${minute}`;
    
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
    
    this.saveAnomalyData();
  }

  predictByTimeWindow(currentTimestamp) {
    const hour = currentTimestamp.getHours();
    const minute = Math.floor(currentTimestamp.getMinutes() / 15) * 15;
    const dayOfWeek = currentTimestamp.getDay();
    const windowKey = `${hour}:${minute}`;
    
    const stats = this.timeWindowStats[windowKey];
    if (!stats || stats.total < 5) return null;
    
    const dayStats = stats.dayOfWeek[dayOfWeek];
    let taiRatio = stats.tai / stats.total;
    
    if (dayStats && dayStats.total >= 3) {
      const dayTaiRatio = dayStats.tai / dayStats.total;
      taiRatio = (dayTaiRatio * 0.6 + taiRatio * 0.4);
    }
    
    if (taiRatio > 0.55) return { prediction: 'Tài', confidence: 50 + Math.round(taiRatio * 25) };
    if (taiRatio < 0.45) return { prediction: 'Xỉu', confidence: 50 + Math.round((1 - taiRatio) * 25) };
    
    return null;
  }

  calibrateConfidence(rawConfidence, method) {
    if (!this.confidenceHistory[method]) return rawConfidence;
    
    const bucket = Math.floor(rawConfidence / 10) * 10;
    const stats = this.confidenceHistory[method][bucket];
    
    if (!stats || stats.total < 5) return rawConfidence;
    
    const actualAccuracy = stats.correct / stats.total;
    const calibrationFactor = actualAccuracy / (bucket / 100);
    
    return Math.min(85, Math.max(50, rawConfidence * calibrationFactor));
  }
}

// ==================== BALANCED MONTE CARLO ====================
class BalancedMonteCarlo {
  constructor(historicalData, windowSize = 40) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.numSimulations = 8000;
    this.minPatterns = 10;
  }

  extractBalancedFeatures(data) {
    if (!data || data.length < 8) return null;
    
    const results = data.slice(0, this.windowSize).map(d => d.Ket_qua);
    const sums = data.slice(0, this.windowSize).map(d => d.Tong);
    
    const taiCount = results.filter(r => r === 'Tài').length;
    const xiuCount = results.length - taiCount;
    const balanceRatio = Math.min(taiCount, xiuCount) / Math.max(taiCount, xiuCount);
    
    const pTai = taiCount / results.length;
    const pXiu = xiuCount / results.length;
    const entropy = -(pTai * Math.log2(Math.max(pTai, 0.001)) + pXiu * Math.log2(Math.max(pXiu, 0.001)));
    
    const last5 = results.slice(0, 5);
    const last5Tai = last5.filter(r => r === 'Tài').length;
    
    const ma5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = sums.length >= 20 ? sums.slice(0, 20).reduce((a, b) => a + b, 0) / 20 : ma10;
    
    const sumTrend = ma5 > ma10 ? 'up' : (ma5 < ma10 ? 'down' : 'stable');
    const momentum = ma10 > 0 ? (ma5 - ma20) / ma10 : 0;
    
    let currentStreak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) currentStreak++;
      else break;
    }
    currentStreak = Math.min(currentStreak, 15);
    
    const fractalPatterns = results.length >= 5 ? this.extractFractalFeatures(results) : {};
    
    return {
      last5Results: last5,
      last5TaiCount: last5Tai,
      last5Trend: this.categorizeTrend(last5),
      balanceRatio,
      currentStreak,
      sumTrend,
      momentum,
      ma5, ma10, ma20,
      recentVolatility: this.calculateVolatility(sums.slice(0, 10)),
      entropy,
      fractalPatterns,
      timestamp: data[0]?.timestamp || new Date().toISOString()
    };
  }

  extractFractalFeatures(results) {
    const sequences = {};
    for (let i = 0; i < results.length - 2; i++) {
      const key = results.slice(i, i + 3).map(r => r === 'Tài' ? 'T' : 'X').join('');
      sequences[key] = (sequences[key] || 0) + 1;
    }
    return sequences;
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

  assessDataQuality(features) {
    let quality = 0.5;
    if (this.historicalData.length > 100) quality += 0.1;
    if (this.historicalData.length > 500) quality += 0.1;
    if (features.balanceRatio > 0.3 && features.balanceRatio < 0.7) quality += 0.1;
    if (features.recentVolatility < 5) quality += 0.1;
    return Math.min(1.0, quality);
  }

  findBalancedPatterns(currentFeatures, maxMatches = 150) {
    const matches = [];
    
    for (let i = 0; i <= this.historicalData.length - this.windowSize - 1; i++) {
      const windowData = this.historicalData.slice(i, i + this.windowSize);
      const windowFeatures = this.extractBalancedFeatures(windowData);
      
      if (!windowFeatures) continue;
      
      let similarity = 0;
      
      if (windowFeatures.last5Trend === currentFeatures.last5Trend) {
        similarity += 30;
      } else if (
        (windowFeatures.last5Trend.includes('tai') && currentFeatures.last5Trend.includes('tai')) ||
        (windowFeatures.last5Trend.includes('xiu') && currentFeatures.last5Trend.includes('xiu'))
      ) {
        similarity += 15;
      }
      
      const balanceDiff = Math.abs(windowFeatures.balanceRatio - currentFeatures.balanceRatio);
      similarity += Math.max(0, 25 - balanceDiff * 40);
      
      const entropyDiff = Math.abs(windowFeatures.entropy - currentFeatures.entropy);
      similarity += Math.max(0, 15 - entropyDiff * 20);
      
      const streakDiff = Math.abs(windowFeatures.currentStreak - currentFeatures.currentStreak);
      similarity += Math.max(0, 15 - streakDiff * 2);
      
      if (windowFeatures.sumTrend === currentFeatures.sumTrend) {
        similarity += 15;
      }
      
      const momentumDiff = Math.abs((windowFeatures.momentum || 0) - (currentFeatures.momentum || 0));
      similarity += Math.max(0, 10 - momentumDiff * 30);
      
      if (currentFeatures.fractalPatterns && windowFeatures.fractalPatterns) {
        const fractalSimilarity = this.calculateFractalSimilarity(
          currentFeatures.fractalPatterns, 
          windowFeatures.fractalPatterns
        );
        similarity += fractalSimilarity * 10;
      }
      
      const recencyBonus = Math.max(0, 10 - (i / this.historicalData.length) * 10);
      similarity += recencyBonus;
      
      if (similarity > 20) {
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
    return matches.slice(0, maxMatches);
  }

  calculateFractalSimilarity(patterns1, patterns2) {
    let similarity = 0;
    let totalKeys = 0;
    
    for (const key in patterns1) {
      totalKeys++;
      if (patterns2[key]) {
        const diff = Math.abs(patterns1[key] - patterns2[key]);
        similarity += Math.max(0, 1 - diff / 5);
      }
    }
    
    return totalKeys > 0 ? similarity / totalKeys : 0;
  }

  categorizePatterns(patterns) {
    const categories = {
      strong_tai: [],
      strong_xiu: [],
      slight_tai: [],
      slight_xiu: [],
      balanced: [],
      alternation: []
    };
    
    for (const pattern of patterns) {
      const trend = pattern.windowFeatures?.last5Trend || 'balanced';
      categories[trend]?.push(pattern);
    }
    
    return categories;
  }

  getCategoryWeight(category, currentFeatures) {
    const weights = {
      strong_tai: 0.2,
      strong_xiu: 0.2,
      slight_tai: 0.2,
      slight_xiu: 0.2,
      balanced: 0.15,
      alternation: 0.05
    };
    
    if (category === currentFeatures.last5Trend) {
      return (weights[category] || 0.15) * 1.5;
    }
    
    return weights[category] || 0.15;
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

  bootstrapSelect(patterns) {
    if (patterns.length === 0) return null;
    const index = Math.floor(Math.random() * patterns.length);
    return patterns[index];
  }

  calculateSimulationWeight(pattern, category, currentFeatures) {
    let weight = Math.pow(pattern.similarity / 100, 2);
    
    if (pattern.recency !== undefined) {
      weight *= (1 - pattern.recency * 0.5);
    }
    
    if (category === currentFeatures?.last5Trend) {
      weight *= 1.3;
    }
    
    return weight;
  }

  runAdaptiveMonteCarlo(currentData, anomalyDetector, currentHour) {
    const currentFeatures = this.extractBalancedFeatures(currentData);
    
    if (!currentFeatures || this.historicalData.length < 50) {
      return this.getFallbackPrediction(currentData);
    }
    
    const dataQuality = this.assessDataQuality(currentFeatures);
    const simCount = Math.floor(this.numSimulations * (0.5 + dataQuality));
    
    const similarPatterns = this.findBalancedPatterns(currentFeatures, 150);
    const categoryPatterns = this.categorizePatterns(similarPatterns);
    
    let taiWins = 0, xiuWins = 0, totalWeight = 0;
    
    for (const [category, patterns] of Object.entries(categoryPatterns)) {
      if (patterns.length === 0) continue;
      
      const categoryWeight = this.getCategoryWeight(category, currentFeatures);
      const categorySims = Math.floor(simCount * categoryWeight);
      
      for (let sim = 0; sim < categorySims; sim++) {
        const selectedPattern = this.bootstrapSelect(patterns);
        if (!selectedPattern) continue;
        
        const weight = this.calculateSimulationWeight(selectedPattern, category, currentFeatures);
        
        totalWeight += weight;
        if (selectedPattern.nextResult === 'Tài') taiWins += weight;
        else if (selectedPattern.nextResult === 'Xỉu') xiuWins += weight;
      }
    }
    
    return this.finalizeSimulationResult(taiWins, xiuWins, totalWeight, currentFeatures, anomalyDetector, currentHour);
  }

  getFallbackPrediction(currentData) {
    const last30Results = currentData.slice(0, 30).map(d => d.Ket_qua);
    const weightedResults = last30Results.map((r, i) => ({ 
      result: r, 
      weight: Math.exp(-i / 10)
    }));
    const weightedTaiCount = weightedResults.reduce((sum, item) => 
      sum + (item.result === 'Tài' ? item.weight : 0), 0);
    const weightedTotal = weightedResults.reduce((sum, item) => sum + item.weight, 0);
    const taiProb = weightedTotal > 0 ? weightedTaiCount / weightedTotal : 0.5;
    
    return {
      taiProbability: taiProb.toFixed(4),
      xiuProbability: (1 - taiProb).toFixed(4),
      confidence: 48,
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      similarPatternsCount: 0,
      breakProbability: 0.3,
      balanceRatio: 0.5,
      method: 'weighted_fallback'
    };
  }

  finalizeSimulationResult(taiWins, xiuWins, totalWeight, currentFeatures, anomalyDetector, currentHour) {
    if (totalWeight === 0) {
      return {
        taiProbability: 0.5,
        xiuProbability: 0.5,
        confidence: 50,
        prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu',
        similarPatternsCount: 0,
        breakProbability: 0.3,
        balanceRatio: currentFeatures.balanceRatio.toFixed(2),
        method: 'random_fallback'
      };
    }
    
    let taiProbability = taiWins / totalWeight;
    
    const standardError = Math.sqrt(taiProbability * (1 - taiProbability) / Math.max(1, totalWeight));
    const confidenceInterval = 1.96 * standardError;
    
    const biasCorrection = anomalyDetector.getBiasCorrection();
    taiProbability += biasCorrection * 0.5;
    taiProbability = Math.max(0.35, Math.min(0.65, taiProbability));
    
    const currentStreakType = currentFeatures.last5Results[0];
    const breakProb = anomalyDetector.predictBreakProbability(
      currentFeatures.currentStreak, 
      currentStreakType, 
      currentHour
    );
    
    if (breakProb > 0.65 && currentFeatures.currentStreak >= 3) {
      taiProbability = 1 - taiProbability;
    }
    
    const rawConfidence = 45 + Math.abs(taiProbability - 0.5) * 90;
    const calibratedConfidence = anomalyDetector.calibrateConfidence(rawConfidence, 'mc');
    const finalConfidence = Math.min(80, Math.max(52, Math.round(calibratedConfidence * (1 - confidenceInterval))));
    
    return {
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: (1 - taiProbability).toFixed(4),
      confidence: finalConfidence,
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      similarPatternsCount: Object.values(this.categorizePatterns(this.findBalancedPatterns(currentFeatures, 150)))
        .reduce((sum, arr) => sum + arr.length, 0),
      breakProbability: breakProb.toFixed(2),
      balanceRatio: currentFeatures.balanceRatio.toFixed(2),
      confidenceInterval: confidenceInterval.toFixed(3),
      method: 'adaptive_monte_carlo'
    };
  }
}

// ==================== REINFORCEMENT LEARNING ENGINE ====================
class ReinforcementLearner {
  constructor() {
    this.qTable = {};
    this.learningRate = 0.1;
    this.discountFactor = 0.95;
    this.epsilon = 0.15;
    this.visitCounts = {};
  }

  getStateKey(results, patterns) {
    if (!results || results.length === 0) return 'default';
    const last4 = results.slice(0, 4).join('');
    const streak = this.getStreakLength(results);
    const recentTrend = results.slice(0, 6).filter(r => r === 'Tài').length;
    return `${last4}_${streak}_${recentTrend}`;
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
    }
    
    const adaptiveEpsilon = Math.max(0.05, this.epsilon / (1 + this.visitCounts[state] * 0.01));
    
    if (Math.random() < adaptiveEpsilon) {
      return possibleActions[Math.floor(Math.random() * possibleActions.length)];
    }
    
    this.visitCounts[state] = (this.visitCounts[state] || 0) + 1;
    return this.qTable[state].Tài > this.qTable[state].Xỉu ? 'Tài' : 'Xỉu';
  }

  updateQValue(state, action, reward, nextState) {
    if (!this.qTable[state]) {
      this.qTable[state] = { Tài: 0.5, Xỉu: 0.5 };
      this.visitCounts[state] = 0;
    }
    if (!this.qTable[nextState]) {
      this.qTable[nextState] = { Tài: 0.5, Xỉu: 0.5 };
      this.visitCounts[nextState] = 0;
    }
    
    const currentQ = this.qTable[state][action];
    const maxNextQ = Math.max(this.qTable[nextState].Tài, this.qTable[nextState].Xỉu);
    
    const adaptiveLR = this.learningRate / (1 + (this.visitCounts[state] || 0) * 0.001);
    
    const newQ = currentQ + adaptiveLR * (reward + this.discountFactor * maxNextQ - currentQ);
    
    this.qTable[state][action] = Math.max(0, Math.min(1, newQ));
  }

  getQLearningPrediction(state) {
    if (!this.qTable[state]) return null;
    
    const taiValue = this.qTable[state].Tài || 0.5;
    const xiuValue = this.qTable[state].Xỉu || 0.5;
    const diff = taiValue - xiuValue;
    
    if (Math.abs(diff) < 0.15) return null;
    return diff > 0 ? 'Tài' : 'Xỉu';
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
    methodPerformance: {
      simple: { correct: 0, total: 0 },
      monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 },
      ensemble: { correct: 0, total: 0 },
      timeWindow: { correct: 0, total: 0 },
      rl: { correct: 0, total: 0 }
    }
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
    methodPerformance: {
      simple: { correct: 0, total: 0 },
      monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 },
      ensemble: { correct: 0, total: 0 },
      timeWindow: { correct: 0, total: 0 },
      rl: { correct: 0, total: 0 }
    }
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.0, 'cau_dao_11': 1.0, 'cau_22': 1.0, 'cau_33': 1.0,
  'cau_121': 1.0, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.0, 'cau_3van1': 1.0, 'cau_be_cau': 1.0, 'cau_chu_ky': 1.0,
  'distribution': 1.0, 'dice_pattern': 1.0, 'sum_trend': 1.0, 'edge_cases': 1.0,
  'momentum': 1.0, 'break_pattern_advanced': 1.0, 'break_streak': 1.0,
  'alternating_break': 1.0, 'double_pair_break': 1.0, 'triple_pattern': 1.0
};

let monteCarloSimulators = { hu: null, md5: null };
let anomalyDetector = new AnomalyDetector();
let rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
let modelEvaluator = new ModelEvaluator();

// ==================== HELPER FUNCTIONS ====================
function updateMonteCarloSimulators(type, data) {
  if (data && data.length >= 40) {
    monteCarloSimulators[type] = new BalancedMonteCarlo(data, 40);
    console.log(`[MC] Balanced simulator initialized for ${type} with ${data.length} records`);
  }
}

function preprocessData(rawData) {
  if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return null;
  
  const processed = rawData.map(d => ({ ...d }));
  
  for (let i = 1; i < processed.length - 1; i++) {
    if (Math.abs(processed[i].Tong - processed[i-1].Tong) > 15 && 
        Math.abs(processed[i].Tong - processed[i+1].Tong) > 15) {
      processed[i].Tong = Math.round((processed[i-1].Tong + processed[i+1].Tong) / 2);
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
      
      // Update model evaluator
      modelEvaluator.evaluatePrediction(pred.prediction, pred.actual, pred.confidence);
      
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
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 100) {
        learningData[type].recentAccuracy.shift();
      }
      
      const stateKey = rlLearner[type].getStateKey(
        currentData.slice(0, 10).map(d => d.Ket_qua), []
      );
      const reward = pred.isCorrect ? 1 : -0.5;
      rlLearner[type].updateQValue(stateKey, pred.prediction, reward, stateKey);
      
      anomalyDetector.learnFromResult(pred.prediction, pred.actual, pred.confidence);
      anomalyDetector.updateTimeWindowStats(pred.actual, new Date(pred.timestamp));
      
      updated = true;
    }
  }
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
    anomalyDetector.saveAnomalyData();
    modelEvaluator.saveMetrics();
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
      
      if (parsed.hu) {
        parsed.hu.methodPerformance = parsed.hu.methodPerformance || {
          simple: { correct: 0, total: 0 },
          monteCarlo: { correct: 0, total: 0 },
          anomaly: { correct: 0, total: 0 },
          ensemble: { correct: 0, total: 0 },
          timeWindow: { correct: 0, total: 0 },
          rl: { correct: 0, total: 0 }
        };
      }
      if (parsed.md5) {
        parsed.md5.methodPerformance = parsed.md5.methodPerformance || {
          simple: { correct: 0, total: 0 },
          monteCarlo: { correct: 0, total: 0 },
          anomaly: { correct: 0, total: 0 },
          ensemble: { correct: 0, total: 0 },
          timeWindow: { correct: 0, total: 0 },
          rl: { correct: 0, total: 0 }
        };
      }
      
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
function analyzeSimplePattern(results) {
  if (results.length < 3) return { prediction: results[0] || 'Tài', confidence: 50 };
  
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  
  if (streak >= 4) {
    const confidence = 55 + Math.min(20, streak * 3);
    return { 
      prediction: results[0], 
      confidence, 
      name: `Streak Continue ${streak}` 
    };
  } else if (streak >= 3) {
    const probability = streak >= 5 ? 0.7 : 0.5;
    const prediction = Math.random() < probability ? results[0] : (results[0] === 'Tài' ? 'Xỉu' : 'Tài');
    return { 
      prediction, 
      confidence: 55 + streak * 2, 
      name: `Streak ${streak}` 
    };
  }
  
  let alternating = true;
  for (let i = 1; i < Math.min(results.length, 7); i++) {
    if (results[i] === results[i-1]) {
      alternating = false;
      break;
    }
  }
  
  if (alternating && results.length >= 5) {
    return {
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 62,
      name: 'Alternating Pattern'
    };
  }
  
  const last6 = results.slice(0, 6);
  const taiCount = last6.filter(r => r === 'Tài').length;
  
  if (taiCount >= 5) return { prediction: 'Tài', confidence: 58, name: 'Strong Tai Trend' };
  if (taiCount <= 1) return { prediction: 'Xỉu', confidence: 58, name: 'Strong Xiu Trend' };
  
  return {
    prediction: results[0],
    confidence: 52,
    name: 'Follow Previous'
  };
}

// ==================== DYNAMIC WEIGHT CALCULATION ====================
function calculateMethodCorrelations(type) {
  const methods = ['simple', 'monteCarlo', 'anomaly', 'rl', 'timeWindow'];
  const correlations = {};
  
  for (const method1 of methods) {
    correlations[method1] = {};
    for (const method2 of methods) {
      if (method1 === method2) {
        correlations[method1][method2] = 1;
      } else {
        const recentPreds = learningData[type].predictions.slice(0, 50);
        let agreement = 0, total = 0;
        
        for (const pred of recentPreds) {
          if (pred.methods?.[method1] && pred.methods?.[method2]) {
            total++;
            // Simple correlation based on both being used
            agreement++;
          }
        }
        
        correlations[method1][method2] = total > 0 ? agreement / total : 0;
      }
    }
  }
  
  return correlations;
}

function calculateEnsembleWeights(type) {
  const stats = learningData[type];
  
  const defaultWeights = {
    simple: 0.4,
    monteCarlo: 0.5,
    anomaly: 0.3,
    rl: 0.2,
    timeWindow: 0.25
  };
  
  if (stats.totalPredictions < 20) return defaultWeights;
  
  const weights = {};
  
  for (const [method, perf] of Object.entries(stats.methodPerformance)) {
    if (perf.total >= 5) {
      const accuracy = perf.correct / perf.total;
      weights[method] = Math.max(0.1, Math.min(0.8, accuracy + 0.1));
    } else {
      weights[method] = defaultWeights[method] || 0.3;
    }
  }
  
  // Dynamic adjustment based on method correlations
  const methodCorrelations = calculateMethodCorrelations(type);
  for (const [method1, correlations] of Object.entries(methodCorrelations)) {
    for (const [method2, correlation] of Object.entries(correlations)) {
      if (method1 !== method2 && correlation > 0.7) {
        if (weights[method1] && weights[method2]) {
          if ((stats.methodPerformance[method1]?.correct / stats.methodPerformance[method1]?.total || 0) > 
              (stats.methodPerformance[method2]?.correct / stats.methodPerformance[method2]?.total || 0)) {
            weights[method2] *= 0.7;
          } else {
            weights[method1] *= 0.7;
          }
        }
      }
    }
  }
  
  const recentAcc = stats.recentAccuracy.length > 0 
    ? stats.recentAccuracy.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, stats.recentAccuracy.length)
    : 0.5;
  
  if (recentAcc > 0.6) {
    for (const method in weights) {
      weights[method] *= 1.15;
    }
  } else if (recentAcc < 0.4) {
    for (const method in weights) {
      weights[method] *= 0.85;
    }
  }
  
  // Normalize weights
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const method in weights) {
    weights[method] = weights[method] / totalWeight;
  }
  
  return weights;
}

// ==================== MAIN PREDICTION FUNCTION ====================
function calculateSuperPrediction(data, type) {
  const results = data.slice(0, 30).map(d => d.Ket_qua);
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  
  let predictions = [];
  let factors = [];
  let methodsUsed = {};
  
  const weights = calculateEnsembleWeights(type);
  
  // 1. Simple Pattern Analysis
  const simplePattern = analyzeSimplePattern(results);
  predictions.push({ 
    prediction: simplePattern.prediction, 
    confidence: simplePattern.confidence, 
    weight: weights.simple || 0.4, 
    name: simplePattern.name,
    method: 'simple'
  });
  methodsUsed.simple = true;
  
  // 2. Anomaly Detection
  const anomaly = anomalyDetector.detectAnomaly(results, 10);
  if (anomaly.isAnomaly) {
    factors.push(`⚠️ Anomaly (${anomaly.taiRatio}% Tài, z=${anomaly.zScore})`);
    
    if (anomaly.regimeShift?.shifted) {
      predictions.push({ 
        prediction: anomaly.regimeShift.direction, 
        confidence: 70, 
        weight: weights.anomaly || 0.3, 
        name: 'Regime Shift',
        method: 'anomaly'
      });
      methodsUsed.anomaly = true;
      factors.push(`Regime shift detected (${anomaly.regimeShift.magnitude.toFixed(2)})`);
    }
    
    if (anomaly.breakDetected && anomaly.breakDirection) {
      predictions.push({ 
        prediction: anomaly.breakDirection, 
        confidence: 68, 
        weight: (weights.anomaly || 0.3) * 0.8, 
        name: 'Anomaly Break',
        method: 'anomaly'
      });
      methodsUsed.anomaly = true;
    }
    
    if (anomaly.isAlternatingAnomaly) {
      const altPrediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      predictions.push({ 
        prediction: altPrediction, 
        confidence: 65, 
        weight: (weights.anomaly || 0.3) * 0.6, 
        name: 'Alternating Anomaly',
        method: 'anomaly'
      });
    }
  }
  
  // 3. Monte Carlo Simulation (using adaptive method)
  if (monteCarloSimulators[type]) {
    const mcResult = monteCarloSimulators[type].runAdaptiveMonteCarlo(data, anomalyDetector, currentHour);
    if (mcResult && mcResult.prediction) {
      const calibratedConf = anomalyDetector.calibrateConfidence(mcResult.confidence, 'mc');
      predictions.push({ 
        prediction: mcResult.prediction, 
        confidence: calibratedConf, 
        weight: weights.monteCarlo || 0.5, 
        name: `Monte Carlo (${mcResult.similarPatternsCount} patterns)`,
        method: 'monteCarlo',
        mcDetails: mcResult
      });
      methodsUsed.monteCarlo = true;
      factors.push(`MC: ${(parseFloat(mcResult.taiProbability) * 100).toFixed(0)}% Tài [${mcResult.method}]`);
    }
  }
  
  // 4. Fractal Pattern Analysis
  const fractalPatterns = anomalyDetector.detectFractalPatterns(results);
  const dominantFractal = Object.entries(fractalPatterns)
    .sort(([,a], [,b]) => b - a)[0];
  if (dominantFractal && dominantFractal[1] >= 3) {
    factors.push(`Fractal: ${dominantFractal[0]} (${dominantFractal[1]}x)`);
  }
  
  // 5. Time Window Prediction
  const timePrediction = anomalyDetector.predictByTimeWindow(currentTime);
  if (timePrediction) {
    predictions.push({ 
      prediction: timePrediction.prediction, 
      confidence: timePrediction.confidence, 
      weight: weights.timeWindow || 0.25, 
      name: 'Time Window',
      method: 'timeWindow'
    });
    methodsUsed.timeWindow = true;
    factors.push(`Time: ${timePrediction.prediction} ${timePrediction.confidence}%`);
  }
  
  // 6. Q-Learning Prediction
  const stateKey = rlLearner[type].getStateKey(results, []);
  const qPrediction = rlLearner[type].getQLearningPrediction(stateKey);
  if (qPrediction) {
    predictions.push({ 
      prediction: qPrediction, 
      confidence: 60, 
      weight: weights.rl || 0.2, 
      name: 'Q-Learning',
      method: 'rl'
    });
    methodsUsed.rl = true;
    factors.push(`RL: ${qPrediction}`);
  }
  
  // 7. Bayesian Ensemble
  const bayesianProb = anomalyDetector.calculateExpectedProbability(results, 20);
  const bayesianPrediction = bayesianProb > 0.5 ? 'Tài' : 'Xỉu';
  const bayesianConfidence = 50 + Math.abs(bayesianProb - 0.5) * 60;
  predictions.push({
    prediction: bayesianPrediction,
    confidence: Math.round(bayesianConfidence),
    weight: 0.15,
    name: 'Bayesian Prior',
    method: 'simple'
  });
  
  // Weighted ensemble calculation
  let taiScore = 0, xiuScore = 0, totalWeight = 0;
  
  predictions.forEach(p => {
    const w = p.weight * (p.confidence / 100);
    if (p.prediction === 'Tài') taiScore += w;
    else if (p.prediction === 'Xỉu') xiuScore += w;
    totalWeight += w;
  });
  
  if (totalWeight === 0) {
    return { 
      prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu', 
      confidence: 50, 
      factors: ['No clear signal'], 
      allPredictions: predictions,
      methodsUsed
    };
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // Apply bias correction
  const biasCorrection = anomalyDetector.getBiasCorrection();
  if (Math.abs(biasCorrection) > 0.08) {
    if (biasCorrection > 0 && finalPrediction === 'Xỉu') {
      finalPrediction = 'Tài';
      factors.push('Bias: Tài');
    } else if (biasCorrection < 0 && finalPrediction === 'Tài') {
      finalPrediction = 'Xỉu';
      factors.push('Bias: Xỉu');
    }
  }
  
  // Calculate confidence with agreement bonus and diversity bonus
  const predictionsAgree = predictions.filter(p => p.prediction === finalPrediction).length;
  const agreementBonus = (predictionsAgree / predictions.length) * 8;
  const diversityBonus = predictions.length >= 3 ? 3 : 0;
  
  let finalConfidence = Math.round((Math.max(taiScore, xiuScore) / totalWeight) * 100);
  finalConfidence = Math.min(82, Math.max(52, finalConfidence + agreementBonus + diversityBonus));
  
  // Calibrate final confidence
  finalConfidence = Math.round(anomalyDetector.calibrateConfidence(finalConfidence, 'ensemble'));
  
  // Check if performance is dropping and adjust
  const currentMetrics = modelEvaluator.getCurrentMetrics();
  if (parseFloat(currentMetrics.accuracy) < 45) {
    finalConfidence = Math.max(50, finalConfidence - 5);
    factors.push('⚠️ Low accuracy period - conservative');
  }
  
  return { 
    prediction: finalPrediction, 
    confidence: finalConfidence, 
    factors, 
    allPredictions: predictions,
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
    modelEvaluator.saveMetrics();
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
      details: result.allPredictions.map(p => ({
        method: p.method,
        prediction: p.prediction,
        confidence: p.confidence,
        weight: p.weight.toFixed(3),
        name: p.name
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
      prediction: normalizeResult(result.prediction), 
      confidence: result.confidence, 
      factors: result.factors,
      methods: result.methodsUsed,
      details: result.allPredictions.map(p => ({
        method: p.method,
        prediction: p.prediction,
        confidence: p.confidence,
        weight: p.weight.toFixed(3),
        name: p.name
      }))
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
    weights: calculateEnsembleWeights('hu'),
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
    weights: calculateEnsembleWeights('md5'),
    lastUpdate: stats.lastUpdate
  });
});

app.get('/model-evaluation', (req, res) => {
  res.json({
    metrics: modelEvaluator.getCurrentMetrics(),
    timestamp: new Date().toISOString()
  });
});

app.get('/fractal-analysis/:type', async (req, res) => {
  try {
    const type = req.params.type;
    if (type !== 'hu' && type !== 'md5') {
      return res.status(400).json({ error: 'Invalid type. Use "hu" or "md5"' });
    }
    
    const data = type === 'hu' ? await fetchDataHu() : await fetchDataMd5();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
    
    const results = data.slice(0, 30).map(d => d.Ket_qua);
    const fractalPatterns = anomalyDetector.detectFractalPatterns(results);
    const regimeShift = anomalyDetector.detectRegimeShift(results);
    
    res.json({
      type: `Lẩu Cua 79 - Tài Xỉu ${type.toUpperCase()}`,
      fractalPatterns,
      regimeShift,
      expectedProbability: anomalyDetector.calculateExpectedProbability(results, 20),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/reset', (req, res) => {
  learningData = {
    hu: { 
      predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, 
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, 
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, 
      recentAccuracy: [],
      methodPerformance: {
        simple: { correct: 0, total: 0 },
        monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 },
        ensemble: { correct: 0, total: 0 },
        timeWindow: { correct: 0, total: 0 },
        rl: { correct: 0, total: 0 }
      }
    },
    md5: { 
      predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, 
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, 
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, 
      recentAccuracy: [],
      methodPerformance: {
        simple: { correct: 0, total: 0 },
        monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 },
        ensemble: { correct: 0, total: 0 },
        timeWindow: { correct: 0, total: 0 },
        rl: { correct: 0, total: 0 }
      }
    }
  };
  monteCarloSimulators = { hu: null, md5: null };
  anomalyDetector = new AnomalyDetector();
  rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
  modelEvaluator = new ModelEvaluator();
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  
  saveLearningData();
  savePredictionHistory();
  modelEvaluator.saveMetrics();
  
  res.json({ message: 'All data reset successfully' });
});

// ==================== START SERVER ====================
loadLearningData();
loadPredictionHistory();
anomalyDetector.loadAnomalyData();
modelEvaluator.loadMetrics();

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);

setInterval(() => {
  for (const type of ['hu', 'md5']) {
    if (learningData[type].predictions.length > 1000) {
      learningData[type].predictions = learningData[type].predictions.slice(0, 1000);
    }
    if (learningData[type].recentAccuracy.length > 500) {
      learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-500);
    }
  }
  saveLearningData();
  modelEvaluator.saveMetrics();
}, 6 * 3600000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - AI PREDICTION v8.0 - ULTIMATE ACCURACY       ║`);
  console.log(`║  Monte Carlo | Anomaly | Q-Learning | Ensemble | Bayesian     ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server running: http://0.0.0.0:${PORT}`);
  console.log(`\n🚀 v8.0 IMPROVEMENTS:`);
  console.log(`  • Bayesian probability estimation with Laplace smoothing`);
  console.log(`  • Regime shift detection (CUSUM algorithm)`);
  console.log(`  • Fractal pattern recognition`);
  console.log(`  • Stratified Monte Carlo sampling`);
  console.log(`  • Dynamic correlation-based weight adjustment`);
  console.log(`  • Model evaluation metrics (Accuracy, Precision, Recall, F1)`);
  console.log(`  • Brier Score & Log Loss for calibration`);
  console.log(`  • Adaptive confidence based on performance`);
  console.log(`  • Bootstrap sampling for variance reduction`);
  console.log(`\n📋 ENDPOINTS:`);
  console.log(`  GET /lc79-hu              - Prediction Hũ`);
  console.log(`  GET /lc79-md5             - Prediction MD5`);
  console.log(`  GET /lc79-hu/lichsu       - History Hũ`);
  console.log(`  GET /lc79-md5/lichsu      - History MD5`);
  console.log(`  GET /lc79-hu/analysis     - Detailed analysis Hũ`);
  console.log(`  GET /lc79-md5/analysis    - Detailed analysis MD5`);
  console.log(`  GET /lc79-hu/stats        - Performance stats Hũ`);
  console.log(`  GET /lc79-md5/stats       - Performance stats MD5`);
  console.log(`  GET /model-evaluation     - Model metrics`);
  console.log(`  GET /fractal-analysis/:type - Fractal & regime analysis`);
  console.log(`  GET /reset                - Reset all data\n`);
});
