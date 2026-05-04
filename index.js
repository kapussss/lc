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

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };

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

// ==================== BALANCED MONTE CARLO ====================
class BalancedMonteCarlo {
  constructor(historicalData, windowSize = 40) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.numSimulations = 8000;
    this.recentWeights = [];
  }

  extractBalancedFeatures(data) {
    if (!data || data.length < 8) return null;
    
    const results = data.slice(0, this.windowSize).map(d => d.Ket_qua);
    const sums = data.slice(0, this.windowSize).map(d => d.Tong);
    
    const taiCount = results.filter(r => r === 'Tài').length;
    const xiuCount = results.length - taiCount;
    const balanceRatio = Math.min(taiCount, xiuCount) / Math.max(taiCount, xiuCount);
    
    const last5 = results.slice(0, 5);
    const last5Tai = last5.filter(r => r === 'Tài').length;
    const last5Trend = last5Tai >= 4 ? 'strong_tai' : (last5Tai <= 1 ? 'strong_xiu' : 'balanced');
    
    const ma5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const ma10 = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const sumTrend = ma5 > ma10 + 1 ? 'up' : (ma5 < ma10 - 1 ? 'down' : 'stable');
    
    let currentStreak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) currentStreak++;
      else break;
    }
    
    return {
      last5Results: last5,
      last5TaiCount: last5Tai,
      last5Trend,
      balanceRatio,
      currentStreak,
      sumTrend,
      ma5, ma10,
      recentVolatility: this.calculateVolatility(sums.slice(0, 10))
    };
  }

  calculateVolatility(sums) {
    if (sums.length < 2) return 0;
    const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
    const variance = sums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / sums.length;
    return Math.sqrt(variance);
  }

  findBalancedPatterns(currentFeatures, maxMatches = 80) {
    const matches = [];
    
    for (let i = 0; i <= this.historicalData.length - this.windowSize - 1; i++) {
      const windowData = this.historicalData.slice(i, i + this.windowSize);
      const windowFeatures = this.extractBalancedFeatures(windowData);
      
      if (!windowFeatures) continue;
      
      let similarity = 0;
      
      if (windowFeatures.last5Trend === currentFeatures.last5Trend) {
        similarity += 25;
      }
      
      const balanceDiff = Math.abs(windowFeatures.balanceRatio - currentFeatures.balanceRatio);
      similarity += Math.max(0, 20 - balanceDiff * 30);
      
      if (windowFeatures.balanceRatio > 0.4) {
        similarity += 10;
      }
      
      const streakDiff = Math.abs(windowFeatures.currentStreak - currentFeatures.currentStreak);
      similarity += Math.max(0, 15 - streakDiff * 2);
      
      if (windowFeatures.sumTrend === currentFeatures.sumTrend) {
        similarity += 15;
      }
      
      if (similarity > 15) {
        matches.push({
          similarity,
          index: i,
          nextResult: this.historicalData[i + this.windowSize]?.Ket_qua,
          nextSum: this.historicalData[i + this.windowSize]?.Tong,
          windowFeatures
        });
      }
    }
    
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, maxMatches);
  }

  runBalancedSimulation(currentData, anomalyDetector, currentHour) {
    const currentFeatures = this.extractBalancedFeatures(currentData);
    
    if (!currentFeatures || this.historicalData.length < 50) {
      const last20Results = currentData.slice(0, 20).map(d => d.Ket_qua);
      const taiCount = last20Results.filter(r => r === 'Tài').length;
      const taiProb = taiCount / 20;
      return {
        taiProbability: taiProb.toFixed(4),
        xiuProbability: (1 - taiProb).toFixed(4),
        confidence: 50 + Math.abs(taiProb - 0.5) * 40,
        prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
        similarPatternsCount: 0,
        breakProbability: 0.3,
        balanceRatio: 0.5
      };
    }
    
    const similarPatterns = this.findBalancedPatterns(currentFeatures, 100);
    
    if (similarPatterns.length < 5) {
      const last20Results = currentData.slice(0, 20).map(d => d.Ket_qua);
      const taiCount = last20Results.filter(r => r === 'Tài').length;
      const taiProb = taiCount / 20;
      return {
        taiProbability: taiProb.toFixed(4),
        xiuProbability: (1 - taiProb).toFixed(4),
        confidence: 50 + Math.abs(taiProb - 0.5) * 40,
        prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
        similarPatternsCount: similarPatterns.length,
        breakProbability: 0.3,
        balanceRatio: currentFeatures.balanceRatio.toFixed(2)
      };
    }
    
    let taiWins = 0;
    let xiuWins = 0;
    let totalWeight = 0;
    
    for (let sim = 0; sim < this.numSimulations; sim++) {
      let selectedPattern;
      if (sim < similarPatterns.length) {
        selectedPattern = similarPatterns[sim];
      } else {
        const randomIndex = Math.floor(Math.random() * similarPatterns.length);
        selectedPattern = similarPatterns[randomIndex];
      }
      
      let weight = selectedPattern.similarity / 100;
      
      if (selectedPattern.windowFeatures && selectedPattern.windowFeatures.balanceRatio > 0.45) {
        weight *= 1.2;
      }
      
      totalWeight += weight;
      
      if (selectedPattern.nextResult === 'Tài') {
        taiWins += weight;
      } else {
        xiuWins += weight;
      }
    }
    
    let taiProbability = taiWins / totalWeight;
    
    const biasCorrection = anomalyDetector.getBiasCorrection();
    taiProbability += biasCorrection;
    taiProbability = Math.max(0.3, Math.min(0.7, taiProbability));
    
    const currentStreakType = currentData[0]?.Ket_qua;
    const breakProb = anomalyDetector.predictBreakProbability(
      currentFeatures.currentStreak, 
      currentStreakType, 
      currentHour
    );
    
    if (breakProb > 0.6 && currentFeatures.currentStreak >= 3) {
      taiProbability = 1 - taiProbability;
    }
    
    const confidence = 50 + Math.abs(taiProbability - 0.5) * 80;
    const finalConfidence = Math.min(85, Math.max(55, Math.round(confidence)));
    
    return {
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: (1 - taiProbability).toFixed(4),
      confidence: finalConfidence,
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      similarPatternsCount: similarPatterns.length,
      breakProbability: breakProb.toFixed(2),
      balanceRatio: currentFeatures.balanceRatio.toFixed(2)
    };
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

// ==================== HELPER FUNCTIONS ====================
function updateMonteCarloSimulators(type, data) {
  if (data && data.length >= 40) {
    monteCarloSimulators[type] = new BalancedMonteCarlo(data, 40);
    console.log(`[MC] Balanced simulator initialized for ${type}`);
  }
}

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
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  
  let predictions = [];
  let factors = [];
  
  const simplePattern = analyzeSimplePattern(results);
  predictions.push({ prediction: simplePattern.prediction, confidence: simplePattern.confidence, priority: 5, name: simplePattern.name });
  factors.push(`Pattern: ${simplePattern.name}`);
  
  const breakPattern = detectBreakPattern(results, type);
  if (breakPattern) {
    predictions.push({ prediction: breakPattern.prediction, confidence: breakPattern.confidence, priority: 8, name: breakPattern.name });
    factors.push(`Break: ${breakPattern.name}`);
  }
  
  const trendReversal = detectTrendReversal(results, type);
  if (trendReversal) {
    predictions.push({ prediction: trendReversal.prediction, confidence: trendReversal.confidence, priority: 7, name: trendReversal.name });
    factors.push(`Reversal: ${trendReversal.name}`);
  }
  
  if (monteCarloSimulators[type]) {
    const mcResult = monteCarloSimulators[type].runBalancedSimulation(data, anomalyDetector, currentHour);
    if (mcResult && mcResult.prediction) {
      predictions.push({ 
        prediction: mcResult.prediction, 
        confidence: mcResult.confidence, 
        priority: 9, 
        name: `Monte Carlo (${mcResult.taiProbability})` 
      });
      factors.push(`MC: ${(parseFloat(mcResult.taiProbability) * 100).toFixed(0)}% Tài, Break: ${(parseFloat(mcResult.breakProbability) * 100).toFixed(0)}%`);
    }
  }
  
  const timePrediction = anomalyDetector.predictByTimeWindow(currentTime);
  if (timePrediction) {
    predictions.push({ prediction: timePrediction.prediction, confidence: timePrediction.confidence, priority: 6, name: 'Time Window' });
    factors.push(`Time: ${timePrediction.prediction} ${timePrediction.confidence}%`);
  }
  
  const anomaly = anomalyDetector.detectAnomaly(results, 10);
  if (anomaly.isAnomaly) {
    factors.push(`⚠️ Anomaly detected (${anomaly.taiRatio}% Tài, break:${anomaly.breakDetected})`);
    if (anomaly.breakDetected && anomaly.breakDirection) {
      predictions.push({ 
        prediction: anomaly.breakDirection, 
        confidence: 70, 
        priority: 10, 
        name: 'Anomaly Break' 
      });
    }
    if (anomaly.isAlternatingAnomaly) {
      const altPrediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      predictions.push({ prediction: altPrediction, confidence: 68, priority: 9, name: 'Alternating Anomaly' });
    }
  }
  
  const stateKey = rlLearner[type].getStateKey(results, []);
  const qPrediction = rlLearner[type].getQLearningPrediction(stateKey);
  if (qPrediction) {
    predictions.push({ prediction: qPrediction, confidence: 62, priority: 6, name: 'Q-Learning' });
    factors.push(`RL: ${qPrediction}`);
  }
  
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  let taiScore = 0, xiuScore = 0;
  predictions.forEach(p => {
    const weight = p.priority;
    if (p.prediction === 'Tài') taiScore += p.confidence * weight;
    else xiuScore += p.confidence * weight;
  });
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  const biasCorrection = anomalyDetector.getBiasCorrection();
  if (biasCorrection > 0.1 && finalPrediction === 'Xỉu') {
    finalPrediction = 'Tài';
    factors.push(`Bias correction: +Tài`);
  } else if (biasCorrection < -0.1 && finalPrediction === 'Tài') {
    finalPrediction = 'Xỉu';
    factors.push(`Bias correction: +Xỉu`);
  }
  
  const totalScore = taiScore + xiuScore;
  let finalConfidence = totalScore > 0 ? Math.round(Math.max(taiScore, xiuScore) / totalScore * 100) : 55;
  finalConfidence = Math.max(55, Math.min(88, finalConfidence));
  
  return { prediction: finalPrediction, confidence: finalConfidence, factors, allPredictions: predictions };
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
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | Factors: ${result.factors.slice(0,2).join(', ')}`);
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
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | Factors: ${result.factors.slice(0,2).join(', ')}`);
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
    updateMonteCarloSimulators('hu', data);
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
    updateMonteCarloSimulators('hu', data);
    await verifyPredictions('hu', data);
    const result = calculateSuperPrediction(data, 'hu');
    res.json({ prediction: normalizeResult(result.prediction), confidence: result.confidence, factors: result.factors });
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
    res.json({ prediction: normalizeResult(result.prediction), confidence: result.confidence, factors: result.factors });
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
    lastUpdate: stats.lastUpdate
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] }
  };
  monteCarloSimulators = { hu: null, md5: null };
  anomalyDetector = new AnomalyDetector();
  rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
  saveLearningData();
  res.json({ message: 'All learning data and anomaly patterns reset' });
});

// ==================== START SERVER ====================
loadLearningData();
loadPredictionHistory();
anomalyDetector.loadAnomalyData();

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║   LẨU CUA 79 - SUPER AI PREDICTION v6.0 - FULL CODE        ║`);
  console.log(`║   Monte Carlo Balanced | Anomaly Detection | Q-Learning    ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server: http://0.0.0.0:${PORT}`);
  console.log(`\n🔥 CẢI TIẾN CHÍNH:`);
  console.log(`   • Monte Carlo CÂN BẰNG - không bias về Xỉu`);
  console.log(`   • Anomaly Detection - phát hiện điểm bất thường`);
  console.log(`   • Break Pattern Learning - học chính xác thời điểm bẻ cầu`);
  console.log(`   • Time Window stats - học theo khung giờ`);
  console.log(`   • Q-Learning (Reinforcement) - thưởng/phạt thông minh`);
  console.log(`   • Bias Correction tự động - sửa lệch dự đoán\n`);
  console.log(`📋 ENDPOINTS:`);
  console.log(`   GET /lc79-hu        - Dự đoán Tài Xỉu Hũ`);
  console.log(`   GET /lc79-md5       - Dự đoán Tài Xỉu MD5`);
  console.log(`   GET /lc79-hu/lichsu - Lịch sử dự đoán Hũ`);
  console.log(`   GET /lc79-md5/lichsu- Lịch sử dự đoán MD5`);
  console.log(`   GET /reset-learning - Reset dữ liệu học\n`);
});
