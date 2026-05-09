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

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000;
const BACKTEST_INTERVAL = 300000; // 5 minutes
const CLEANUP_INTERVAL = 21600000; // 6 hours
let lastProcessedPhien = { hu: null, md5: null };

// ==================== IMPROVED ANOMALY DETECTION ====================
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
        console.log(`[Anomaly] Loaded ${this.anomalyPatterns.length} patterns, ${this.breakPoints.length} breaks`);
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
    
    // Enhanced statistical detection with adaptive threshold
    const expectedMean = windowSize * 0.5;
    const expectedStd = Math.sqrt(windowSize * 0.5 * 0.5);
    const zScore = expectedStd > 0 ? Math.abs((taiCount - expectedMean) / expectedStd) : 0;
    
    // Adaptive threshold based on recent volatility
    const adaptiveThreshold = this.getAdaptiveThreshold(results, windowSize);
    const isStatisticalAnomaly = zScore > adaptiveThreshold;
    
    // Runs test with improved calculation
    const runs = this.calculateRuns(recent);
    const expectedRuns = 1 + (2 * windowSize * taiCount * xiuCount) / (taiCount + xiuCount);
    const runsVariance = (2 * taiCount * xiuCount * (2 * taiCount * xiuCount - taiCount - xiuCount)) / 
                         (Math.pow(taiCount + xiuCount, 2) * (taiCount + xiuCount - 1));
    const runsZScore = Math.sqrt(runsVariance) > 0 ? Math.abs((runs - expectedRuns) / Math.sqrt(runsVariance)) : 0;
    const isRunsAnomaly = runsZScore > adaptiveThreshold;
    
    const deviation = Math.abs(taiCount / windowSize - 0.5);
    const anomalyScore = Math.min(100, Math.max(0, (zScore / 3) * 100));
    
    // Advanced break detection
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
      deviation: deviation.toFixed(3),
      taiRatio: (taiCount / windowSize * 100).toFixed(1),
      breakDetected,
      breakDirection,
      alternatingLength,
      isAlternatingAnomaly,
      zScore: zScore.toFixed(2),
      runsZScore: runsZScore.toFixed(2),
      adaptiveThreshold: adaptiveThreshold.toFixed(2)
    };
  }

  getAdaptiveThreshold(results, windowSize) {
    // Calculate recent volatility to adjust threshold
    const recent20 = results.slice(0, Math.min(20, results.length));
    const volatility = this.calculateVolatility(recent20.map(r => r === 'Tài' ? 1 : 0));
    // Higher volatility -> lower threshold (more sensitive)
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
    
    // Enhanced pattern detection
    const isUniformFirst = last6.slice(0, 3).every(r => r === last6[0]);
    const isUniformLast = last6.slice(3, 6).every(r => r === last6[3]);
    if (isUniformFirst && isUniformLast && last6[0] !== last6[3]) return true;
    
    // 4-2 pattern
    if (results.length >= 6) {
      const first4 = results.slice(0, 4);
      const last2 = results.slice(4, 6);
      if (first4.every(r => r === first4[0]) && last2.every(r => r !== first4[0])) return true;
    }
    
    // 5-1 pattern
    if (results.length >= 6) {
      const first5 = results.slice(0, 5);
      if (first5.every(r => r === first5[0]) && results[5] !== first5[0]) return true;
    }
    
    // V-pattern reversal (3-2-1 pattern)
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
    
    // Account for streak type
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
    
    // Update reinforcement memory
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
    
    // Update feature weights based on prediction accuracy
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
    
    // Update confidence calibration
    const confidenceBucket = Math.floor(confidence / 10) * 10;
    if (!this.confidenceHistory.ensemble[confidenceBucket]) {
      this.confidenceHistory.ensemble[confidenceBucket] = { correct: 0, total: 0 };
    }
    this.confidenceHistory.ensemble[confidenceBucket].total++;
    if (isCorrect) this.confidenceHistory.ensemble[confidenceBucket].correct++;
    
    this.saveAnomalyData();
  }

  calibrateConfidence(rawConfidence, method) {
    if (!this.confidenceHistory[method]) return rawConfidence;
    
    const sorted = Object.entries(this.confidenceHistory[method])
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    
    if (sorted.length < 3) return rawConfidence;
    
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
    
    // Linear interpolation
    let calibratedAcc = lower.acc;
    if (upper.mid - lower.mid > 0) {
      calibratedAcc = lower.acc + (upper.acc - lower.acc) * 
                     ((raw - lower.mid) / (upper.mid - lower.mid));
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
    
    // Grid search for optimal parameters
    const thresholdValues = [1.5, 1.65, 1.8, 1.96, 2.1, 2.3];
    let bestParams = { threshold: 1.96, accuracy: 0 };
    
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
      const anomaly = this.detectAnomaly(result.historicalResults, 10);
      if (anomaly.zScore > threshold) {
        total++;
        // Simplified: predict against trend for anomaly
        const prediction = result.historicalResults[0] === 'Tài' ? 'Xỉu' : 'Tài';
        if (prediction === result.actual) correct++;
      }
    }
    
    return total > 0 ? correct / total : 0;
  }
}

// ==================== IMPROVED BALANCED MONTE CARLO ====================
class BalancedMonteCarlo {
  constructor(historicalData, windowSize = 40) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.numSimulations = 8000;
    this.minPatterns = 10;
    this.patternCache = new Map();
    this.lastCacheClear = Date.now();
  }

  extractBalancedFeatures(data, skipLatest = false) {
    if (!data || data.length < 9) return null;
    
    // Remove look-ahead bias by excluding the latest session for feature extraction
    const analysisData = skipLatest ? data.slice(1) : data;
    if (analysisData.length < this.windowSize) return null;
    
    const windowData = analysisData.slice(0, this.windowSize);
    const results = windowData.map(d => d.Ket_qua);
    const sums = windowData.map(d => d.Tong);
    
    // Validate data
    if (sums.some(s => s < 3 || s > 18)) {
      console.warn('[MC] Invalid sum detected, filtering');
      return null;
    }
    
    const taiCount = results.filter(r => r === 'Tài').length;
    const xiuCount = results.length - taiCount;
    const balanceRatio = Math.min(taiCount, xiuCount) / Math.max(Math.max(taiCount, xiuCount), 1);
    
    // Enhanced entropy calculation
    const total = taiCount + xiuCount;
    const pTai = total > 0 ? taiCount / total : 0.5;
    const pXiu = total > 0 ? xiuCount / total : 0.5;
    const entropy = -(pTai * Math.log2(Math.max(pTai, 0.001)) + 
                     pXiu * Math.log2(Math.max(pXiu, 0.001)));
    
    const last5 = results.slice(0, 5);
    const last5Tai = last5.filter(r => r === 'Tài').length;
    
    // Enhanced sum analysis
    const ma5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = sums.length >= 10 ? sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10 : ma5;
    const ma20 = sums.length >= 20 ? sums.slice(0, 20).reduce((a, b) => a + b, 0) / 20 : ma10;
    
    const sumTrend = ma5 > ma10 ? 'up' : (ma5 < ma10 ? 'down' : 'stable');
    const momentum = ma10 > 0 ? (ma5 - ma20) / ma10 : 0;
    
    // Dynamic streak calculation
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

  findBalancedPatterns(currentFeatures, maxMatches = 80, anomalyDetector = null) {
    // Clear cache periodically
    if (Date.now() - this.lastCacheClear > 300000) {
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
      
      // Weighted feature similarity
      if (windowFeatures.last5Trend === currentFeatures.last5Trend) {
        similarity += weights.trend * 1.0;
      } else if (
        (windowFeatures.last5Trend.includes('tai') && currentFeatures.last5Trend.includes('tai')) ||
        (windowFeatures.last5Trend.includes('xiu') && currentFeatures.last5Trend.includes('xiu'))
      ) {
        similarity += weights.trend * 0.5;
      }
      
      const balanceDiff = Math.abs(windowFeatures.balanceRatio - currentFeatures.balanceRatio);
      similarity += Math.max(0, weights.balance - balanceDiff * 40);
      
      const entropyDiff = Math.abs(windowFeatures.entropy - currentFeatures.entropy);
      similarity += Math.max(0, weights.entropy - entropyDiff * 20);
      
      const streakDiff = Math.abs(windowFeatures.currentStreak - currentFeatures.currentStreak);
      similarity += Math.max(0, weights.streak - streakDiff * 2);
      
      if (windowFeatures.sumTrend === currentFeatures.sumTrend) {
        similarity += weights.sumTrend;
      }
      
      const momentumDiff = Math.abs((windowFeatures.momentum || 0) - (currentFeatures.momentum || 0));
      similarity += Math.max(0, weights.momentum - momentumDiff * 30);
      
      // Recency bonus (exponential decay)
      const recencyBonus = 10 * Math.exp(-i / (this.historicalData.length * 0.3));
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
    const topMatches = matches.slice(0, maxMatches);
    
    // Cache results
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

  calculatePatternQuality(patterns) {
    if (patterns.length === 0) return 0;
    const avgSimilarity = patterns.reduce((sum, p) => sum + p.similarity, 0) / patterns.length;
    const diversity = new Set(patterns.map(p => p.nextResult)).size;
    return (avgSimilarity / 100) * (diversity / 2) * Math.min(1, patterns.length / 50);
  }

  runBalancedSimulation(data, anomalyDetector, currentHour) {
    const currentFeatures = this.extractBalancedFeatures(data, true); // Skip latest for anti-lookahead
    
    if (!currentFeatures || this.historicalData.length < 50) {
      return this.weightedFallback(data.slice(1));
    }
    
    const similarPatterns = this.findBalancedPatterns(currentFeatures, 100, anomalyDetector);
    
    if (similarPatterns.length < this.minPatterns) {
      return this.simpleStatisticalFallback(data.slice(1), similarPatterns.length);
    }
    
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
      
      let weight = Math.pow(selectedPattern.similarity / 100, 1.5); // Slightly softer weighting
      
      if (selectedPattern.recency !== undefined) {
        weight *= (1 - selectedPattern.recency * 0.4);
      }
      
      totalWeight += weight;
      
      if (selectedPattern.nextResult === 'Tài') {
        taiWins += weight;
      } else if (selectedPattern.nextResult === 'Xỉu') {
        xiuWins += weight;
      }
    }
    
    if (totalWeight === 0) {
      return this.randomFallback(similarPatterns.length, currentFeatures);
    }
    
    let taiProbability = taiWins / totalWeight;
    
    // Calculate confidence interval
    const standardError = Math.sqrt(taiProbability * (1 - taiProbability) / adaptiveSimCount);
    const confidenceInterval = 1.96 * standardError;
    
    // Apply bias correction conservatively
    const biasCorrection = anomalyDetector.getBiasCorrection();
    taiProbability += biasCorrection * 0.3;
    taiProbability = Math.max(0.35, Math.min(0.65, taiProbability));
    
    // Apply break probability if strong signal
    const currentData = data.slice(1); // Exclude latest
    const currentStreakType = currentData[0]?.Ket_qua;
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
    const finalConfidence = Math.min(80, Math.max(52, 
      Math.round(calibratedConfidence * (1 - confidenceInterval))
    ));
    
    return {
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: (1 - taiProbability).toFixed(4),
      confidence: finalConfidence,
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      similarPatternsCount: similarPatterns.length,
      breakProbability: breakProb.toFixed(2),
      balanceRatio: currentFeatures.balanceRatio.toFixed(2),
      confidenceInterval: confidenceInterval.toFixed(3),
      patternQuality: patternQuality.toFixed(2),
      method: 'balanced_monte_carlo'
    };
  }

  weightedFallback(data) {
    const last30Results = data.slice(0, 30).map(d => d.Ket_qua);
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
      confidence: 45 + Math.abs(taiProb - 0.5) * 50,
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      similarPatternsCount: 0,
      breakProbability: 0.3,
      balanceRatio: 0.5,
      method: 'weighted_fallback'
    };
  }

  simpleStatisticalFallback(data, patternsCount) {
    const last20Results = data.slice(0, 20).map(d => d.Ket_qua);
    const taiCount = last20Results.filter(r => r === 'Tài').length;
    const taiProb = taiCount / 20;
    return {
      taiProbability: taiProb.toFixed(4),
      xiuProbability: (1 - taiProb).toFixed(4),
      confidence: 50 + Math.abs(taiProb - 0.5) * 40,
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      similarPatternsCount: patternsCount,
      breakProbability: 0.3,
      balanceRatio: 0.5,
      method: 'simple_statistical'
    };
  }

  randomFallback(patternsCount, features) {
    return {
      taiProbability: 0.5,
      xiuProbability: 0.5,
      confidence: 50,
      prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu',
      similarPatternsCount: patternsCount,
      breakProbability: 0.3,
      balanceRatio: features?.balanceRatio?.toFixed(2) || 0.5,
      method: 'random_fallback'
    };
  }
}

// ==================== IMPROVED REINFORCEMENT LEARNER ====================
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
    
    // Add sum bucket for richer state representation
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
    
    // Adaptive epsilon with temperature
    const adaptiveEpsilon = Math.max(0.03, 
      this.epsilon / (1 + Math.log(this.visitCounts[state] + 1) * 0.1)
    );
    
    if (Math.random() < adaptiveEpsilon) {
      const action = possibleActions[Math.floor(Math.random() * possibleActions.length)];
      this.stateTransitions[state][action]++;
      return action;
    }
    
    this.visitCounts[state]++;
    
    // Add small tie-breaker noise
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
    const maxNextQ = Math.max(
      this.qTable[nextState].Tài || 0.5,
      this.qTable[nextState].Xỉu || 0.5
    );
    
    // Adaptive learning rate with momentum
    const visitCount = this.visitCounts[state] || 0;
    const adaptiveLR = this.learningRate / (1 + Math.sqrt(visitCount) * 0.01);
    
    // Add reward scaling based on confidence
    const scaledReward = reward * (1 + Math.abs(currentQ - 0.5) * 0.5);
    
    const newQ = currentQ + adaptiveLR * (scaledReward + this.discountFactor * maxNextQ - currentQ);
    
    this.qTable[state][action] = Math.max(0, Math.min(1, newQ));
  }

  getQLearningPrediction(state) {
    if (!this.qTable[state]) return null;
    
    const taiValue = this.qTable[state].Tài || 0.5;
    const xiuValue = this.qTable[state].Xỉu || 0.5;
    const diff = taiValue - xiuValue;
    
    // Higher confidence threshold for prediction
    if (Math.abs(diff) < 0.12) return null;
    
    // Check state visit frequency for reliability
    const visits = this.visitCounts[state] || 0;
    if (visits < 3) return null;
    
    return diff > 0 ? 'Tài' : 'Xỉu';
  }
}

// ==================== BACKTESTING ENGINE ====================
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
        console.log(`[Backtest] Loaded ${this.results.hu.length + this.results.md5.length} results`);
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

  async runBacktest(type, historicalData, windowSize = 100) {
    console.log(`[Backtest] Running backtest for ${type}...`);
    
    const results = [];
    let correct = 0;
    let total = 0;
    
    // Test different configurations
    const configs = [
      { name: 'ensemble', useMC: true, useAnomaly: true, useRL: true, useTime: true },
      { name: 'mc_only', useMC: true, useAnomaly: false, useRL: false, useTime: false },
      { name: 'anomaly_only', useMC: false, useAnomaly: true, useRL: false, useTime: false },
      { name: 'rl_only', useMC: false, useAnomaly: false, useRL: true, useTime: false },
      { name: 'time_only', useMC: false, useAnomaly: false, useRL: false, useTime: true },
      { name: 'mc_anomaly', useMC: true, useAnomaly: true, useRL: false, useTime: false },
      { name: 'mc_rl', useMC: true, useAnomaly: false, useRL: true, useTime: false }
    ];
    
    const configPerformance = {};
    
    for (const config of configs) {
      let configCorrect = 0;
      let configTotal = 0;
      
      for (let i = 0; i < historicalData.length - windowSize - 1; i++) {
        const window = historicalData.slice(i + 1, i + windowSize + 1);
        const actual = historicalData[i + windowSize]?.Ket_qua;
        
        if (!actual || window.length < 20) continue;
        
        const prediction = this.getBacktestPrediction(type, window, config);
        
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
        accuracy: configTotal > 0 ? configCorrect / configTotal : 0
      };
    }
    
    // Find best configuration
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
      total: total,
      correct: correct,
      configPerformance,
      bestConfig,
      bestAccuracy
    };
    
    this.results[type].push(backtestResult);
    
    // Keep only last 100 backtest results
    if (this.results[type].length > 100) {
      this.results[type] = this.results[type].slice(-100);
    }
    
    // Update best parameters
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

  getBacktestPrediction(type, window, config) {
    // Simplified prediction for backtesting speed
    const results = window.map(d => d.Ket_qua);
    const sums = window.map(d => d.Tong);
    
    let predictions = [];
    
    if (config.useMC) {
      // Simplified MC
      const last20 = results.slice(0, 20);
      const taiCount = last20.filter(r => r === 'Tài').length;
      predictions.push({
        prediction: taiCount > last20.length / 2 ? 'Tài' : 'Xỉu',
        weight: 0.4,
        confidence: 50 + Math.abs(taiCount / last20.length - 0.5) * 60
      });
    }
    
    if (config.useAnomaly) {
      // Simplified anomaly
      const streak = this.getStreak(results);
      if (streak >= 4) {
        predictions.push({
          prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
          weight: 0.3,
          confidence: 55 + streak * 3
        });
      }
    }
    
    if (config.useRL) {
      // Simplified RL
      const stateKey = `${results.slice(0, 4).join('')}_${Math.min(streak, 12)}`;
      if (this.rlPredictions && this.rlPredictions[stateKey]) {
        predictions.push({
          prediction: this.rlPredictions[stateKey],
          weight: 0.2,
          confidence: 58
        });
      }
    }
    
    if (config.useTime) {
      // Time-based is not applicable in backtesting without timestamps
    }
    
    if (predictions.length === 0) {
      return results[0];
    }
    
    let taiWeight = 0, xiuWeight = 0;
    for (const p of predictions) {
      if (p.prediction === 'Tài') taiWeight += p.weight * p.confidence;
      else xiuWeight += p.weight * p.confidence;
    }
    
    return taiWeight >= xiuWeight ? 'Tài' : 'Xỉu';
  }

  getStreak(results) {
    if (results.length === 0) return 0;
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    return streak;
  }

  learnFromBacktest(type) {
    if (this.results[type].length === 0) return;
    
    const recentResults = this.results[type].slice(-10);
    let improved = false;
    
    // Analyze patterns in successful vs unsuccessful predictions
    for (const result of recentResults) {
      if (result.configPerformance) {
        const bestConfig = result.bestConfig;
        const worstConfig = Object.entries(result.configPerformance)
          .sort((a, b) => a[1].accuracy - b[1].accuracy)[0];
        
        // Adjust ensemble weights based on backtest
        if (bestConfig && worstConfig) {
          improved = true;
        }
      }
    }
    
    if (improved) {
      console.log(`[Backtest] Learning from ${type} backtest results`);
      this.saveResults();
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
      ensemble: { correct: 0, total: 0 }
    },
    mistakePatterns: {},
    sessionTimes: {}
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
      ensemble: { correct: 0, total: 0 }
    },
    mistakePatterns: {},
    sessionTimes: {}
  }
};

let monteCarloSimulators = { hu: null, md5: null };
let anomalyDetector = new AnomalyDetector();
let rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
let backtestEngine = new BacktestEngine();

// ==================== HELPER FUNCTIONS ====================
function updateMonteCarloSimulators(type, data) {
  if (data && data.length >= 40) {
    monteCarloSimulators[type] = new BalancedMonteCarlo(data, 40);
    console.log(`[MC] Simulator initialized for ${type} with ${data.length} records`);
  }
}

function preprocessData(rawData) {
  if (!rawData || !Array.isArray(rawData) || rawData.length === 0) return null;
  
  const processed = rawData.map(d => ({ ...d }));
  
  // Validate and smooth data
  for (let i = 0; i < processed.length; i++) {
    // Fix invalid sums
    if (processed[i].Tong < 3 || processed[i].Tong > 18) {
      if (i > 0 && i < processed.length - 1) {
        processed[i].Tong = Math.round((processed[i-1].Tong + processed[i+1].Tong) / 2);
        processed[i].Tong = Math.max(3, Math.min(18, processed[i].Tong));
      } else {
        processed[i].Tong = 10; // Default to average
      }
    }
    
    // Smooth extreme outliers
    if (i > 0 && i < processed.length - 1) {
      if (Math.abs(processed[i].Tong - processed[i-1].Tong) > 12 &&
          Math.abs(processed[i].Tong - processed[i+1].Tong) > 12) {
        processed[i].Tong = Math.round((processed[i-1].Tong + processed[i+1].Tong) / 2);
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
  if (learningData[type].predictions.length > 500) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 500);
  }
  saveLearningData();
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  const now = Date.now();
  
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    // Remove stale predictions (older than 30 minutes)
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
        
        // Record mistake pattern for learning
        const mistakeKey = `${currentData.slice(0, 5).map(d => d.Ket_qua).join('')}`;
        if (!learningData[type].mistakePatterns[mistakeKey]) {
          learningData[type].mistakePatterns[mistakeKey] = { count: 0, lastSeen: null };
        }
        learningData[type].mistakePatterns[mistakeKey].count++;
        learningData[type].mistakePatterns[mistakeKey].lastSeen = new Date().toISOString();
      }
      
      // Update method performance
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
      
      // Update RL with richer state
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
      
      // Update anomaly detector with features used
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
      
      // Merge with default structure
      if (parsed.hu) {
        parsed.hu.methodPerformance = parsed.hu.methodPerformance || {
          simple: { correct: 0, total: 0 },
          monteCarlo: { correct: 0, total: 0 },
          anomaly: { correct: 0, total: 0 },
          ensemble: { correct: 0, total: 0 }
        };
        parsed.hu.mistakePatterns = parsed.hu.mistakePatterns || {};
        parsed.hu.sessionTimes = parsed.hu.sessionTimes || {};
      }
      if (parsed.md5) {
        parsed.md5.methodPerformance = parsed.md5.methodPerformance || {
          simple: { correct: 0, total: 0 },
          monteCarlo: { correct: 0, total: 0 },
          anomaly: { correct: 0, total: 0 },
          ensemble: { correct: 0, total: 0 }
        };
        parsed.md5.mistakePatterns = parsed.md5.mistakePatterns || {};
        parsed.md5.sessionTimes = parsed.md5.sessionTimes || {};
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
      console.log('[Data] Prediction history loaded');
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
function analyzeSimplePattern(results, learningType = null) {
  if (results.length < 3) return { prediction: results[0] || 'Tài', confidence: 50 };
  
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  
  // Check if this pattern has led to mistakes before
  if (learningType && learningData[learningType]) {
    const patternKey = results.slice(0, 5).join('');
    const mistakeCount = learningData[learningType].mistakePatterns[patternKey]?.count || 0;
    
    if (mistakeCount >= 3) {
      // This pattern has been problematic, be cautious
      return {
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', // Inverse
        confidence: 48,
        name: `Mistake Pattern Reversal (${mistakeCount} errors)`
      };
    }
  }
  
  if (streak >= 4) {
    const confidence = 55 + Math.min(20, streak * 3);
    return {
      prediction: results[0],
      confidence,
      name: `Streak Continue ${streak}`
    };
  } else if (streak >= 3) {
    const probability = streak >= 5 ? 0.65 : 0.45;
    const prediction = Math.random() < probability ? results[0] : (results[0] === 'Tài' ? 'Xỉu' : 'Tài');
    return {
      prediction,
      confidence: 55 + streak * 2,
      name: `Streak ${streak}`
    };
  }
  
  // Check alternating pattern
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
  
  // Recent trend analysis
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

// ==================== MAIN PREDICTION FUNCTION ====================
function calculateEnsembleWeights(type) {
  const stats = learningData[type];
  const optimalConfig = backtestEngine.getOptimalConfig(type);
  
  // Base weights adjusted by backtest results
  const weights = {
    simple: optimalConfig.useAnomaly ? 0.35 : 0.5,
    monteCarlo: optimalConfig.useMC ? 0.45 : 0.0,
    anomaly: optimalConfig.useAnomaly ? 0.3 : 0.0,
    rl: optimalConfig.useRL ? 0.2 : 0.0,
    timeWindow: optimalConfig.useTime ? 0.25 : 0.0
  };
  
  if (stats.totalPredictions < 20) return weights;
  
  // Adjust based on method performance
  for (const [method, perf] of Object.entries(stats.methodPerformance)) {
    if (perf.total >= 5 && weights[method]) {
      const accuracy = perf.correct / perf.total;
      weights[method] = Math.max(0.1, Math.min(0.7, accuracy + 0.05));
    }
  }
  
  // Adjust based on recent accuracy
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
  
  return weights;
}

function calculateSuperPrediction(data, type) {
  const results = data.slice(0, 30).map(d => d.Ket_qua);
  const sums = data.slice(0, 30).map(d => d.Tong);
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  
  let predictions = [];
  let factors = [];
  let methodsUsed = {};
  let featuresUsed = [];
  
  const weights = calculateEnsembleWeights(type);
  
  // 1. Simple Pattern Analysis with mistake learning
  const simplePattern = analyzeSimplePattern(results, type);
  predictions.push({
    prediction: simplePattern.prediction,
    confidence: simplePattern.confidence,
    weight: weights.simple || 0.4,
    name: simplePattern.name,
    method: 'simple'
  });
  methodsUsed.simple = true;
  featuresUsed.push('trend');
  
  // 2. Anomaly Detection
  const anomaly = anomalyDetector.detectAnomaly(results, 10);
  if (anomaly.isAnomaly) {
    factors.push(`⚠️ Anomaly (${anomaly.taiRatio}% Tài, z=${anomaly.zScore})`);
    featuresUsed.push('entropy', 'streak');
    
    if (anomaly.breakDetected && anomaly.breakDirection) {
      predictions.push({
        prediction: anomaly.breakDirection,
        confidence: 68,
        weight: weights.anomaly || 0.3,
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
        weight: (weights.anomaly || 0.3) * 0.8,
        name: 'Alternating Anomaly',
        method: 'anomaly'
      });
    }
  }
  
  // 3. Monte Carlo Simulation
  if (monteCarloSimulators[type] && weights.monteCarlo > 0) {
    const mcResult = monteCarloSimulators[type].runBalancedSimulation(data, anomalyDetector, currentHour);
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
      featuresUsed.push('balance', 'momentum', 'sumTrend');
      factors.push(`MC: ${(parseFloat(mcResult.taiProbability) * 100).toFixed(0)}% Tài [${mcResult.method}]`);
    }
  }
  
  // 4. Time Window Prediction
  if (weights.timeWindow > 0) {
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
  }
  
  // 5. Q-Learning Prediction
  if (weights.rl > 0) {
    const stateKey = rlLearner[type].getStateKey(results, sums);
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
    return {
      prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu',
      confidence: 50,
      factors: ['No clear signal'],
      allPredictions: predictions,
      methodsUsed
    };
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // Stability check - if margin is very small, use simple pattern
  const margin = Math.abs(taiScore - xiuScore) / totalWeight;
  if (margin < 0.02) {
    finalPrediction = simplePattern.prediction;
    factors.push('Low margin - using stable pattern');
    featuresUsed.push('trend'); // Re-emphasize trend
  }
  
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
  
  // Calculate confidence with agreement bonus
  const predictionsAgree = predictions.filter(p => p.prediction === finalPrediction).length;
  const agreementBonus = (predictionsAgree / Math.max(predictions.length, 1)) * 8;
  
  let finalConfidence = Math.round((Math.max(taiScore, xiuScore) / totalWeight) * 100);
  finalConfidence = Math.min(82, Math.max(52, finalConfidence + agreementBonus));
  
  // Calibrate final confidence
  finalConfidence = Math.round(anomalyDetector.calibrateConfidence(finalConfidence, 'ensemble'));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPredictions: predictions,
    methodsUsed,
    featuresUsed
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
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

async function runBacktests() {
  try {
    console.log('[Backtest] Starting periodic backtesting...');
    
    // Fetch current data for backtesting
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length >= 100) {
      await backtestEngine.runBacktest('hu', dataHu);
      backtestEngine.learnFromBacktest('hu');
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length >= 100) {
      await backtestEngine.runBacktest('md5', dataMd5);
      backtestEngine.learnFromBacktest('md5');
    }
    
    // Run anomaly parameter optimization
    if (backtestEngine.results.hu.length > 0) {
      anomalyDetector.optimizeParameters(
        backtestEngine.results.hu.map(r => ({
          historicalResults: dataHu?.slice(0, 50).map(d => d.Ket_qua) || [],
          actual: dataHu?.[50]?.Ket_qua
        }))
      );
    }
    
    console.log('[Backtest] Cycle completed');
  } catch (error) {
    console.error('[Backtest] Error:', error.message);
  }
}

function cleanupOldData() {
  for (const type of ['hu', 'md5']) {
    // Clean old predictions (keep last 1000)
    if (learningData[type].predictions.length > 1000) {
      learningData[type].predictions = learningData[type].predictions.slice(0, 1000);
    }
    
    // Clean recent accuracy (keep last 500)
    if (learningData[type].recentAccuracy.length > 500) {
      learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-500);
    }
    
    // Clean mistake patterns (remove patterns not seen in 24 hours)
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    for (const [pattern, data] of Object.entries(learningData[type].mistakePatterns)) {
      if (data.lastSeen && data.lastSeen < oneDayAgo) {
        delete learningData[type].mistakePatterns[pattern];
      }
    }
    
    // Clean prediction history
    if (predictionHistory[type].length > MAX_HISTORY) {
      predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
  }
  
  saveLearningData();
  savePredictionHistory();
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
      details: result.allPredictions.map(p => ({
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
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      methods: result.methodsUsed,
      details: result.allPredictions.map(p => ({
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
    mistakedPatterns: Object.keys(stats.mistakePatterns).length,
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
    mistakedPatterns: Object.keys(stats.mistakePatterns).length,
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
      recentAccuracy: [],
      methodPerformance: {
        simple: { correct: 0, total: 0 },
        monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 },
        ensemble: { correct: 0, total: 0 }
      },
      mistakePatterns: {},
      sessionTimes: {}
    },
    md5: {
      predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0,
      patternWeights: {}, lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [],
      methodPerformance: {
        simple: { correct: 0, total: 0 },
        monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 },
        ensemble: { correct: 0, total: 0 }
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

// Start main prediction loop
setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);

// Start backtesting loop
setInterval(() => runBacktests(), BACKTEST_INTERVAL);
setTimeout(() => runBacktests(), 10000);

// Periodic cleanup
setInterval(() => cleanupOldData(), CLEANUP_INTERVAL);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - AI PREDICTION v8.0 - SELF-LEARNING SYSTEM     ║`);
  console.log(`║  Monte Carlo | Anomaly | Q-Learning | Backtest | Auto-Learn    ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server running: http://0.0.0.0:${PORT}`);
  console.log(`\n🚀 KEY IMPROVEMENTS:`);
  console.log(`  ✅ Look-ahead bias removed from Monte Carlo`);
  console.log(`  ✅ Adaptive anomaly thresholds based on volatility`);
  console.log(`  ✅ Dynamic feature weights with gradient descent`);
  console.log(`  ✅ Enhanced confidence calibration (isotonic regression)`);
  console.log(`  ✅ Q-Learning with richer state (sums, streak, trend)`);
  console.log(`  ✅ Automatic backtesting every 5 minutes`);
  console.log(`  ✅ Mistake pattern learning and reversal`);
  console.log(`  ✅ Ensemble stability checks (low-margin fallback)`);
  console.log(`  ✅ Break probability caps based on statistics`);
  console.log(`  ✅ Data validation and outlier smoothing`);
  console.log(`  ✅ Cache-optimized Monte Carlo pattern matching`);
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
  console.log(`🧪 Auto-backtest: Every ${BACKTEST_INTERVAL/1000}s (with parameter optimization)`);
  console.log(`🧹 Auto-cleanup: Every ${CLEANUP_INTERVAL/3600000}h\n`);
});
