const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// ==================== API ENDPOINTS ====================
const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

// ==================== FILE PATHS ====================
const FILES = {
  LEARNING: 'learning_data_v13.json',
  HISTORY: 'prediction_history_v13.json',
  ANOMALY: 'anomaly_patterns_v13.json',
  NEURAL: 'neural_models_v13.json',
  ATTENTION: 'attention_models_v13.json',
  MARKOV: 'markov_models_v13.json',
  ENSEMBLE: 'ensemble_weights_v13.json'
};

// ==================== CONFIGURATION ====================
const CONFIG = {
  MAX_CONFIDENCE: 88,
  MIN_CONFIDENCE: 48,
  MIN_PATTERNS: 3,
  ENSEMBLE_MIN_AGREEMENT: 2,
  SMOOTHING_WINDOW: 5,
  MAX_HISTORY: 500,
  AUTO_SAVE_INTERVAL: 10000,
  CLEANUP_INTERVAL: 3600000,
  REGIME_WINDOW: 20,
  MARKOV_ORDER: 2,
  DROPOUT_RATE: 0.2,
  LEARNING_RATE: 0.01
};

// ==================== LOGGER ====================
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ${new Date().toISOString()} - ${msg}`)
};

// ==================== UTILITY FUNCTIONS ====================
function sigmoid(x) {
  return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
}

function tanh(x) {
  return Math.tanh(x);
}

function relu(x) {
  return Math.max(0, x);
}

function softmax(arr) {
  if (!arr || arr.length === 0) return [0.5, 0.5];
  const max = Math.max(...arr);
  const exp = arr.map(v => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return sum > 0 ? exp.map(v => v / sum) : [0.5, 0.5];
}

// ==================== SIMPLIFIED NEURAL NETWORK ====================
class SimpleNeuralNetwork {
  constructor(inputSize = 12, hiddenSize = 16) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    
    this.W1 = Array(hiddenSize).fill().map(() => 
      Array(inputSize).fill().map(() => (Math.random() - 0.5) * 0.2)
    );
    this.b1 = Array(hiddenSize).fill(0);
    this.W2 = Array(2).fill().map(() => 
      Array(hiddenSize).fill().map(() => (Math.random() - 0.5) * 0.2)
    );
    this.b2 = [0, 0];
    this.lr = CONFIG.LEARNING_RATE;
  }
  
  forward(x) {
    // Hidden layer
    const z1 = this.b1.map((b, i) => 
      b + this.W1[i].reduce((sum, w, j) => sum + w * (x[j] || 0), 0)
    );
    const a1 = z1.map(relu);
    
    // Output layer
    const z2 = this.b2.map((b, i) => 
      b + this.W2[i].reduce((sum, w, j) => sum + w * a1[j], 0)
    );
    const a2 = softmax(z2);
    
    return { a1, a2 };
  }
  
  backward(x, target, cache) {
    const { a1, a2 } = cache;
    
    // Output gradient
    const grad2 = a2.map((p, i) => p - (i === target ? 1 : 0));
    
    // Update output layer
    for (let i = 0; i < this.W2.length; i++) {
      for (let j = 0; j < this.W2[i].length; j++) {
        this.W2[i][j] -= this.lr * grad2[i] * a1[j];
      }
    }
    for (let i = 0; i < this.b2.length; i++) {
      this.b2[i] -= this.lr * grad2[i];
    }
    
    // Hidden gradient
    const grad1 = Array(a1.length).fill(0);
    for (let i = 0; i < this.W2.length; i++) {
      for (let j = 0; j < this.W2[i].length; j++) {
        grad1[j] += grad2[i] * this.W2[i][j];
      }
    }
    
    // Update hidden layer
    for (let i = 0; i < this.W1.length; i++) {
      for (let j = 0; j < this.W1[i].length; j++) {
        this.W1[i][j] -= this.lr * grad1[i] * (x[j] || 0);
      }
    }
    for (let i = 0; i < this.b1.length; i++) {
      this.b1[i] -= this.lr * grad1[i];
    }
  }
  
  train(features, targetTai) {
    if (!features || features.length < this.inputSize) return;
    const x = features.slice(0, this.inputSize);
    const target = targetTai ? 0 : 1;
    const cache = this.forward(x);
    this.backward(x, target, cache);
  }
  
  predict(features) {
    if (!features || features.length < this.inputSize) {
      return { prediction: 'Tài', confidence: 50 };
    }
    const x = features.slice(0, this.inputSize);
    const { a2 } = this.forward(x);
    const prediction = (a2[0] || 0.5) > (a2[1] || 0.5) ? 'Tài' : 'Xỉu';
    const confidence = 50 + Math.abs((a2[0] || 0.5) - 0.5) * 70;
    return { prediction, confidence: Math.min(CONFIG.MAX_CONFIDENCE, Math.round(confidence)) };
  }
  
  save() {
    return { W1: this.W1, b1: this.b1, W2: this.W2, b2: this.b2 };
  }
  
  load(data) {
    if (data) {
      this.W1 = data.W1;
      this.b1 = data.b1;
      this.W2 = data.W2;
      this.b2 = data.b2;
    }
  }
}

// ==================== SIMPLIFIED ATTENTION MODEL ====================
class SimpleAttentionModel {
  constructor(windowSize = 20) {
    this.windowSize = windowSize;
    this.attentionWeights = Array(windowSize).fill(1 / windowSize);
    this.history = [];
    this.lr = 0.01;
  }
  
  update(results, sums) {
    const seq = results.slice(0, this.windowSize);
    this.history = seq.map((r, i) => ({
      result: r === 'Tài' ? 1 : 0,
      sum: (sums[i] || 10.5) - 10.5,
      weight: this.attentionWeights[i]
    }));
  }
  
  train(actualNextResult, actualNextSum) {
    if (this.history.length === 0) return;
    
    const target = actualNextResult === 'Tài' ? 1 : 0;
    let prediction = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < this.history.length; i++) {
      const h = this.history[i];
      const similarity = 1 - Math.abs(h.result - target) * 0.5;
      const weight = h.weight * similarity;
      prediction += weight * h.result;
      totalWeight += weight;
    }
    
    if (totalWeight > 0) prediction /= totalWeight;
    
    const error = target - prediction;
    
    for (let i = 0; i < this.attentionWeights.length && i < this.history.length; i++) {
      this.attentionWeights[i] += this.lr * error * Math.abs(this.history[i].result);
    }
    
    const sum = this.attentionWeights.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (let i = 0; i < this.attentionWeights.length; i++) {
        this.attentionWeights[i] /= sum;
      }
    }
  }
  
  predict() {
    if (this.history.length === 0) return null;
    
    let prediction = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < this.history.length; i++) {
      const h = this.history[i];
      prediction += h.weight * h.result;
      totalWeight += h.weight;
    }
    
    if (totalWeight === 0) return null;
    
    prediction /= totalWeight;
    const probTai = sigmoid(prediction * 2);
    const confidence = 50 + Math.abs(probTai - 0.5) * 70;
    
    return {
      prediction: probTai > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.min(CONFIG.MAX_CONFIDENCE, Math.round(confidence))
    };
  }
  
  save() {
    return { attentionWeights: this.attentionWeights, windowSize: this.windowSize };
  }
  
  load(data) {
    if (data) {
      this.attentionWeights = data.attentionWeights;
      this.windowSize = data.windowSize;
    }
  }
}

// ==================== SIMPLE MARKOV CHAIN ====================
class SimpleMarkovChain {
  constructor(order = 2) {
    this.order = order;
    this.transitions = {};
  }
  
  train(data) {
    if (!data || data.length < this.order + 1) return;
    
    for (let i = 0; i <= data.length - this.order - 1; i++) {
      const state = data.slice(i, i + this.order).join('');
      const next = data[i + this.order];
      
      if (!this.transitions[state]) {
        this.transitions[state] = { T: 0, X: 0, total: 0 };
      }
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
    
    if (Math.abs(probT - 0.5) < 0.08) return null;
    
    const confidence = 50 + Math.abs(probT - 0.5) * 50;
    
    return {
      prediction: probT > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.min(CONFIG.MAX_CONFIDENCE, Math.round(confidence))
    };
  }
  
  save() {
    return { order: this.order, transitions: this.transitions };
  }
  
  load(data) {
    if (data) {
      this.order = data.order;
      this.transitions = data.transitions;
    }
  }
}

// ==================== ANOMALY DETECTOR ====================
class AnomalyDetector {
  constructor() {
    this.anomalyPatterns = [];
    this.timeWindowStats = {};
    this.reinforcementMemory = { tai: 0, xiu: 0 };
    this.confidenceHistory = {};
  }
  
  detectAnomaly(results, sums = [], windowSize = 10) {
    if (results.length < windowSize) {
      return { isAnomaly: false, score: 0 };
    }
    
    const recent = results.slice(0, windowSize);
    const taiCount = recent.filter(r => r === 'Tài').length;
    const expectedMean = windowSize * 0.5;
    const expectedStd = Math.sqrt(windowSize * 0.5 * 0.5);
    const zScore = expectedStd > 0 ? (taiCount - expectedMean) / expectedStd : 0;
    
    let breakDetected = false;
    let breakDirection = null;
    
    if (results.length >= 6) {
      let streak = 1;
      for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++;
        else break;
      }
      if (streak >= 4 && results.length > streak && results[streak] !== results[0]) {
        breakDetected = true;
        breakDirection = results[streak];
      }
    }
    
    return {
      isAnomaly: Math.abs(zScore) > 1.5 || breakDetected,
      score: Math.min(100, (Math.abs(zScore) / 3) * 100),
      zScore: zScore.toFixed(2),
      breakDetected,
      breakDirection
    };
  }
  
  learnFromResult(prediction, actual, confidence) {
    const isCorrect = prediction === actual;
    
    if (isCorrect) {
      if (prediction === 'Tài') this.reinforcementMemory.tai += 0.05;
      else this.reinforcementMemory.xiu += 0.05;
    } else {
      if (prediction === 'Tài') this.reinforcementMemory.tai -= 0.08;
      else this.reinforcementMemory.xiu -= 0.08;
    }
    
    this.reinforcementMemory.tai = Math.max(-2, Math.min(2, this.reinforcementMemory.tai));
    this.reinforcementMemory.xiu = Math.max(-2, Math.min(2, this.reinforcementMemory.xiu));
    
    const bucket = Math.floor(confidence / 10) * 10;
    if (!this.confidenceHistory[bucket]) {
      this.confidenceHistory[bucket] = { correct: 0, total: 0 };
    }
    this.confidenceHistory[bucket].total++;
    if (isCorrect) this.confidenceHistory[bucket].correct++;
  }
  
  calibrateConfidence(rawConfidence, method) {
    const bucket = Math.floor(rawConfidence / 10) * 10;
    const stats = this.confidenceHistory[bucket];
    
    if (stats && stats.total > 5) {
      const actualAccuracy = stats.correct / stats.total;
      const calibration = (actualAccuracy * 100) - bucket;
      rawConfidence += calibration * 0.3;
    }
    
    const bias = this.getBiasCorrection();
    rawConfidence += bias * 20;
    
    return Math.min(CONFIG.MAX_CONFIDENCE, Math.max(CONFIG.MIN_CONFIDENCE, Math.round(rawConfidence)));
  }
  
  getBiasCorrection() {
    const diff = (this.reinforcementMemory.tai || 0) - (this.reinforcementMemory.xiu || 0);
    return Math.max(-0.2, Math.min(0.2, diff * 0.05));
  }
  
  updateTimeWindowStats(result, timestamp) {
    const hour = timestamp.getHours();
    const minute = Math.floor(timestamp.getMinutes() / 15) * 15;
    const windowKey = `${hour}:${String(minute).padStart(2, '0')}`;
    
    if (!this.timeWindowStats[windowKey]) {
      this.timeWindowStats[windowKey] = { tai: 0, xiu: 0, total: 0 };
    }
    
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
    
    if (taiRatio > 0.6) {
      return { prediction: 'Tài', confidence: 55 + Math.round(taiRatio * 20) };
    }
    if (taiRatio < 0.4) {
      return { prediction: 'Xỉu', confidence: 55 + Math.round((1 - taiRatio) * 20) };
    }
    return null;
  }
  
  save() {
    try {
      fs.writeFileSync(FILES.ANOMALY, JSON.stringify({
        timeWindowStats: this.timeWindowStats,
        confidenceHistory: this.confidenceHistory,
        reinforcementMemory: this.reinforcementMemory
      }, null, 2));
    } catch (error) {
      logger.error(`Failed to save anomaly data: ${error.message}`);
    }
  }
  
  load() {
    try {
      if (fs.existsSync(FILES.ANOMALY)) {
        const data = JSON.parse(fs.readFileSync(FILES.ANOMALY, 'utf8'));
        this.timeWindowStats = data.timeWindowStats || {};
        this.confidenceHistory = data.confidenceHistory || {};
        this.reinforcementMemory = data.reinforcementMemory || { tai: 0, xiu: 0 };
        logger.info('Anomaly detector data loaded');
      }
    } catch (error) {
      logger.error(`Failed to load anomaly data: ${error.message}`);
    }
  }
}

// ==================== MONTE CARLO SIMULATOR ====================
class MonteCarloSimulator {
  constructor(historicalData, windowSize = 50) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.minPatterns = CONFIG.MIN_PATTERNS;
  }
  
  findSimilarPatterns(currentResults, maxMatches = 100) {
    const matches = [];
    
    for (let i = 0; i <= this.historicalData.length - this.windowSize - 1; i++) {
      const windowData = this.historicalData.slice(i, i + this.windowSize);
      const windowResults = windowData.map(d => d.Ket_qua);
      
      let similarity = 0;
      for (let j = 0; j < Math.min(10, currentResults.length, windowResults.length); j++) {
        if (currentResults[j] === windowResults[j]) similarity += 10;
      }
      
      const streak1 = this.getStreak(currentResults);
      const streak2 = this.getStreak(windowResults);
      similarity += Math.max(0, 15 - Math.abs(streak1 - streak2) * 3);
      
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
  
  getStreak(results) {
    if (results.length === 0) return 0;
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    return streak;
  }
  
  predict(data) {
    if (!data || data.length < this.windowSize || !this.historicalData || this.historicalData.length < 50) {
      return null;
    }
    
    const currentResults = data.slice(0, this.windowSize).map(d => d.Ket_qua);
    const similarPatterns = this.findSimilarPatterns(currentResults, 100);
    
    if (similarPatterns.length < this.minPatterns) return null;
    
    let taiWeight = 0, xiuWeight = 0, totalWeight = 0;
    
    for (const pattern of similarPatterns) {
      let weight = pattern.similarity / 100;
      weight *= (1 - pattern.recency * 0.3);
      totalWeight += weight;
      
      if (pattern.nextResult === 'Tài') taiWeight += weight;
      else if (pattern.nextResult === 'Xỉu') xiuWeight += weight;
    }
    
    if (totalWeight === 0) return null;
    
    const taiProbability = taiWeight / totalWeight;
    const confidence = 50 + Math.abs(taiProbability - 0.5) * 70;
    
    return {
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.min(CONFIG.MAX_CONFIDENCE, Math.round(confidence))
    };
  }
}

// ==================== REGIME DETECTOR ====================
class RegimeDetector {
  detectRegime(learningData) {
    if (!learningData.recentAccuracy || learningData.recentAccuracy.length < CONFIG.REGIME_WINDOW) {
      return { regime: 'mixed', confidence: 0.5 };
    }
    
    const recent = learningData.recentAccuracy.slice(-CONFIG.REGIME_WINDOW);
    const overallRate = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    let regime = 'mixed';
    if (overallRate > 0.52) regime = 'trending';
    if (overallRate < 0.48) regime = 'volatile';
    
    return { regime, confidence: overallRate };
  }
}

// ==================== ENSEMBLE WEIGHT OPTIMIZER ====================
class EnsembleWeightOptimizer {
  constructor() {
    this.weights = {
      neuralnet: 0.15,
      attention: 0.15,
      markov: 0.12,
      monteCarlo: 0.12,
      anomaly: 0.1,
      dice: 0.1,
      time: 0.1,
      balance: 0.08,
      simple: 0.08
    };
  }
  
  updateWeights(methodPerformances) {
    let totalPerformance = 0;
    const performance = {};
    
    for (const [method, perf] of Object.entries(methodPerformances)) {
      if (perf && perf.total > 10) {
        const accuracy = perf.correct / perf.total;
        performance[method] = accuracy;
        totalPerformance += accuracy;
      }
    }
    
    if (totalPerformance === 0) return;
    
    for (const [method, accuracy] of Object.entries(performance)) {
      if (this.weights[method] !== undefined) {
        const targetWeight = accuracy / totalPerformance;
        this.weights[method] += 0.02 * (targetWeight - this.weights[method]);
        this.weights[method] = Math.max(0.05, Math.min(0.25, this.weights[method]));
      }
    }
    
    const sum = Object.values(this.weights).reduce((a, b) => a + b, 0);
    for (const method in this.weights) {
      this.weights[method] /= sum;
    }
  }
  
  getWeights() {
    return { ...this.weights };
  }
  
  save() {
    try {
      fs.writeFileSync(FILES.ENSEMBLE, JSON.stringify({ weights: this.weights }, null, 2));
    } catch (error) {
      logger.error(`Failed to save ensemble weights: ${error.message}`);
    }
  }
  
  load() {
    try {
      if (fs.existsSync(FILES.ENSEMBLE)) {
        const data = JSON.parse(fs.readFileSync(FILES.ENSEMBLE, 'utf8'));
        this.weights = data.weights;
        logger.info('Ensemble weights loaded');
      }
    } catch (error) {
      logger.error(`Failed to load ensemble weights: ${error.message}`);
    }
  }
}

// ==================== DATA STRUCTURES ====================
let learningData = {
  hu: {
    predictions: [], totalPredictions: 0, correctPredictions: 0,
    streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    methodPerformance: {
      neuralnet: { correct: 0, total: 0 }, attention: { correct: 0, total: 0 },
      markov: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
      time: { correct: 0, total: 0 }, balance: { correct: 0, total: 0 },
      simple: { correct: 0, total: 0 }
    },
    lastUpdate: null
  },
  md5: {
    predictions: [], totalPredictions: 0, correctPredictions: 0,
    streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    methodPerformance: {
      neuralnet: { correct: 0, total: 0 }, attention: { correct: 0, total: 0 },
      markov: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
      time: { correct: 0, total: 0 }, balance: { correct: 0, total: 0 },
      simple: { correct: 0, total: 0 }
    },
    lastUpdate: null
  }
};

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let predictionProbBuffer = { hu: [0.5], md5: [0.5] };

// Initialize models
let neuralNetworks = { hu: new SimpleNeuralNetwork(), md5: new SimpleNeuralNetwork() };
let attentionModels = { hu: new SimpleAttentionModel(), md5: new SimpleAttentionModel() };
let markovChains = { hu: new SimpleMarkovChain(CONFIG.MARKOV_ORDER), md5: new SimpleMarkovChain(CONFIG.MARKOV_ORDER) };
let monteCarloSimulators = { hu: null, md5: null };
let anomalyDetector = new AnomalyDetector();
let regimeDetectors = { hu: new RegimeDetector(), md5: new RegimeDetector() };
let ensembleOptimizer = new EnsembleWeightOptimizer();

// ==================== HELPER FUNCTIONS ====================
function normalizeResult(result) {
  if (result === 'Tài' || result === 'tài') return 'tai';
  if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
  return result.toLowerCase();
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

async function fetchData(url) {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    logger.error(`Failed to fetch data from ${url}: ${error.message}`);
    return null;
  }
}

function extractFeatures(results, sums, hour, biasCorrection) {
  const features = [];
  
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  features.push(taiCount5 / 5);
  
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  features.push(streak / 10);
  
  let alternations = 0;
  for (let i = 1; i < Math.min(results.length, 8); i++) {
    if (results[i] !== results[i-1]) alternations++;
  }
  features.push(alternations / 7);
  
  const sumMean = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const sumStd = Math.sqrt(sums.slice(0, 10).reduce((a, b) => a + Math.pow(b - sumMean, 2), 0) / 10);
  features.push((sumMean - 10.5) / 4);
  features.push(sumStd / 3);
  
  features.push(hour / 24);
  
  features.push(results[0] === 'Tài' ? 1 : 0);
  features.push(results.length > 1 && results[1] === 'Tài' ? 1 : 0);
  features.push(results.length > 2 && results[2] === 'Tài' ? 1 : 0);
  
  features.push(biasCorrection);
  
  while (features.length < 12) features.push(0);
  
  return features.slice(0, 12);
}

function predictSimple(results, regime) {
  if (results.length < 3) return { prediction: results[0] || 'Tài', confidence: 52 };
  
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  
  if (regime.regime === 'trending' && streak >= 2) {
    const confidence = 55 + Math.min(12, streak * 2);
    return { prediction: results[0], confidence: Math.min(75, confidence) };
  }
  
  if (streak >= 4) {
    const confidence = 58 + Math.min(10, streak * 1.5);
    return { prediction: results[0], confidence: Math.min(75, confidence) };
  }
  
  let alternating = true;
  for (let i = 1; i < Math.min(results.length, 6); i++) {
    if (results[i] === results[i-1]) {
      alternating = false;
      break;
    }
  }
  if (alternating && results.length >= 5) {
    return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 56 };
  }
  
  const last10 = results.slice(0, 10);
  const taiCount10 = last10.filter(r => r === 'Tài').length;
  if (taiCount10 >= 7) return { prediction: 'Xỉu', confidence: 58 };
  if (taiCount10 <= 3) return { prediction: 'Tài', confidence: 58 };
  
  return { prediction: results[0], confidence: 52 };
}

function predictDiceMeanReversion(sums) {
  if (!sums || sums.length < 10) return null;
  
  const recentSums = sums.slice(0, 10);
  const avgSum = recentSums.reduce((a, b) => a + b, 0) / 10;
  const zScore = (avgSum - 10.5) / 2.9;
  
  if (Math.abs(zScore) < 0.6) return null;
  
  const confidence = 50 + Math.min(20, Math.abs(zScore) * 6);
  
  return {
    prediction: zScore > 0 ? 'Xỉu' : 'Tài',
    confidence: Math.min(CONFIG.MAX_CONFIDENCE, Math.round(confidence))
  };
}

function predictBalance(results) {
  if (results.length < 20) return null;
  
  const last20 = results.slice(0, 20);
  const taiCount20 = last20.filter(r => r === 'Tài').length;
  const taiRatio = taiCount20 / 20;
  
  if (Math.abs(taiRatio - 0.5) < 0.1) return null;
  
  const confidence = 50 + Math.abs(taiRatio - 0.5) * 60;
  
  return {
    prediction: taiRatio > 0.5 ? 'Xỉu' : 'Tài',
    confidence: Math.min(CONFIG.MAX_CONFIDENCE, Math.round(confidence))
  };
}

// ==================== SUPER PREDICTION ENGINE ====================
function calculateSuperPrediction(data, type) {
  try {
    const results = data.slice(0, 40).map(d => d.Ket_qua);
    const sums = data.slice(0, 40).map(d => d.Tong);
    const currentTime = new Date();
    const currentHour = currentTime.getHours();
    const biasCorrection = anomalyDetector.getBiasCorrection();
    const regime = regimeDetectors[type].detectRegime(learningData[type]);
    const weights = ensembleOptimizer.getWeights();
    
    const predictions = [];
    
    // 1. Neural Network
    try {
      const features = extractFeatures(results, sums, currentHour, biasCorrection);
      const nnPred = neuralNetworks[type].predict(features);
      predictions.push({ ...nnPred, name: 'neuralnet', weight: weights.neuralnet });
    } catch (e) { logger.error(`NeuralNet error: ${e.message}`); }
    
    // 2. Attention Model
    try {
      attentionModels[type].update(results, sums);
      const attPred = attentionModels[type].predict();
      if (attPred) predictions.push({ ...attPred, name: 'attention', weight: weights.attention });
    } catch (e) { logger.error(`Attention error: ${e.message}`); }
    
    // 3. Markov Chain
    try {
      const resultsForMarkov = results.map(r => r === 'Tài' ? 'T' : 'X');
      const markovPred = markovChains[type].predict(resultsForMarkov);
      if (markovPred) predictions.push({ ...markovPred, name: 'markov', weight: weights.markov });
    } catch (e) { logger.error(`Markov error: ${e.message}`); }
    
    // 4. Monte Carlo
    try {
      if (monteCarloSimulators[type]) {
        const mcPred = monteCarloSimulators[type].predict(data);
        if (mcPred) predictions.push({ ...mcPred, name: 'monteCarlo', weight: weights.monteCarlo });
      }
    } catch (e) { logger.error(`MonteCarlo error: ${e.message}`); }
    
    // 5. Anomaly Detection
    try {
      const anomaly = anomalyDetector.detectAnomaly(results, sums, 10);
      if (anomaly.isAnomaly && anomaly.breakDirection) {
        predictions.push({
          prediction: anomaly.breakDirection,
          confidence: Math.min(70, 55 + anomaly.score * 0.15),
          name: 'anomaly',
          weight: weights.anomaly
        });
      }
    } catch (e) { logger.error(`Anomaly error: ${e.message}`); }
    
    // 6. Dice Mean Reversion
    try {
      const dicePred = predictDiceMeanReversion(sums);
      if (dicePred) predictions.push({ ...dicePred, name: 'dice', weight: weights.dice });
    } catch (e) { logger.error(`Dice error: ${e.message}`); }
    
    // 7. Time Window Pattern
    try {
      const timePred = anomalyDetector.predictByTimeWindow(currentTime);
      if (timePred) predictions.push({ ...timePred, name: 'time', weight: weights.time });
    } catch (e) { logger.error(`Time error: ${e.message}`); }
    
    // 8. Balance Strategy
    try {
      const balancePred = predictBalance(results);
      if (balancePred) predictions.push({ ...balancePred, name: 'balance', weight: weights.balance });
    } catch (e) { logger.error(`Balance error: ${e.message}`); }
    
    // 9. Simple Pattern
    try {
      const simplePred = predictSimple(results, regime);
      predictions.push({ ...simplePred, name: 'simple', weight: weights.simple });
    } catch (e) { logger.error(`Simple error: ${e.message}`); }
    
    if (predictions.length === 0) {
      return { prediction: 'Tài', confidence: 50, factors: ['Fallback'], methodsUsed: {} };
    }
    
    // Weighted voting
    let taiWeight = 0, xiuWeight = 0, totalWeight = 0;
    let totalConfidence = 0;
    
    for (const pred of predictions) {
      const weight = pred.weight || 0.1;
      totalWeight += weight;
      totalConfidence += pred.confidence * weight;
      
      if (pred.prediction === 'Tài') taiWeight += weight;
      else xiuWeight += weight;
    }
    
    const finalPrediction = taiWeight > xiuWeight ? 'Tài' : 'Xỉu';
    let finalConfidence = totalWeight > 0 ? totalConfidence / totalWeight : 50;
    
    // Apply regime adjustment
    if (regime.regime === 'trending') finalConfidence += 3;
    if (regime.regime === 'volatile') finalConfidence -= 3;
    
    // Apply bias correction
    finalConfidence += biasCorrection * 15;
    
    // Calibrate confidence
    finalConfidence = anomalyDetector.calibrateConfidence(finalConfidence, 'ensemble');
    
    // Smooth predictions
    const taiProb = finalPrediction === 'Tài' ? finalConfidence / 100 : 1 - finalConfidence / 100;
    predictionProbBuffer[type].push(taiProb);
    if (predictionProbBuffer[type].length > CONFIG.SMOOTHING_WINDOW) {
      predictionProbBuffer[type].shift();
    }
    const smoothedProb = predictionProbBuffer[type].reduce((a, b) => a + b, 0) / predictionProbBuffer[type].length;
    const smoothedPrediction = smoothedProb > 0.5 ? 'Tài' : 'Xỉu';
    
    const factors = predictions.slice(0, 5).map(p => `${p.name}:${p.prediction}(${Math.round(p.confidence)}%)`);
    const methodsUsed = Object.fromEntries(predictions.map(p => [p.name, true]));
    
    return {
      prediction: smoothedPrediction,
      confidence: Math.round(finalConfidence),
      factors,
      methodsUsed,
      regime: regime.regime
    };
  } catch (error) {
    logger.error(`Super prediction error: ${error.message}`);
    return { prediction: 'Tài', confidence: 50, factors: ['Error fallback'], methodsUsed: {} };
  }
}

// ==================== DATA MANAGEMENT ====================
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
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 500) {
        learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-500);
      }
      
      // Update method performance
      if (pred.methodsUsed) {
        for (const method of Object.keys(pred.methodsUsed)) {
          if (learningData[type].methodPerformance[method]) {
            learningData[type].methodPerformance[method].total++;
            if (pred.isCorrect) learningData[type].methodPerformance[method].correct++;
          }
        }
      }
      
      // Update ensemble weights periodically
      if (learningData[type].totalPredictions % 10 === 0) {
        ensembleOptimizer.updateWeights(learningData[type].methodPerformance);
      }
      
      anomalyDetector.learnFromResult(pred.prediction, pred.actual, pred.confidence);
      anomalyDetector.updateTimeWindowStats(pred.actual, new Date(pred.timestamp));
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
  }
}

function savePredictionToHistory(type, phien, prediction, confidence) {
  const record = {
    phien_hien_tai: phien.toString(),
    du_doan: normalizeResult(prediction),
    ti_le: `${confidence}%`,
    id: 'kapub_v13',
    timestamp: new Date().toISOString(),
    ket_qua_thuc_te: null,
    status: '⏳'
  };
  
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > CONFIG.MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, CONFIG.MAX_HISTORY);
  }
}

function recordPrediction(type, phien, result) {
  const record = {
    phien: phien.toString(),
    prediction: result.prediction,
    confidence: result.confidence,
    factors: result.factors,
    methodsUsed: result.methodsUsed,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  
  if (learningData[type].predictions.length > 2000) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 2000);
  }
}

async function autoProcessPredictions() {
  try {
    const [dataHu, dataMd5] = await Promise.all([
      fetchData(API_URL_HU),
      fetchData(API_URL_MD5)
    ]);
    
    for (const [type, data] of [['hu', dataHu], ['md5', dataMd5]]) {
      if (!data || data.length === 0) continue;
      
      // Update Monte Carlo simulator
      if (data.length >= 50) {
        monteCarloSimulators[type] = new MonteCarloSimulator(data, 50);
      }
      
      // Train models
      const results = data.slice(0, 30).map(d => d.Ket_qua);
      const sums = data.slice(0, 30).map(d => d.Tong);
      const resultsForMarkov = results.map(r => r === 'Tài' ? 'T' : 'X');
      
      markovChains[type].train(resultsForMarkov);
      
      const features = extractFeatures(results, sums, new Date().getHours(), anomalyDetector.getBiasCorrection());
      const lastResult = results[0] === 'Tài';
      
      neuralNetworks[type].train(features, lastResult);
      attentionModels[type].update(results, sums);
      
      if (results.length > 1) {
        attentionModels[type].train(results[0], sums[0]);
      }
      
      await verifyPredictions(type, data);
      
      const latestPhien = data[0].Phien;
      const nextPhien = latestPhien + 1;
      
      if (lastProcessedPhien[type] !== nextPhien) {
        const result = calculateSuperPrediction(data, type);
        savePredictionToHistory(type, nextPhien, result.prediction, result.confidence);
        recordPrediction(type, nextPhien, result);
        lastProcessedPhien[type] = nextPhien;
        
        logger.info(`[${type.toUpperCase()} #${nextPhien}] ${result.prediction} (${result.confidence}%) | Regime: ${result.regime || 'mixed'}`);
      }
    }
    
    saveAllData();
  } catch (error) {
    logger.error(`Auto-process error: ${error.message}`);
  }
}

function saveAllData() {
  try {
    fs.writeFileSync(FILES.LEARNING, JSON.stringify(learningData, null, 2));
    fs.writeFileSync(FILES.HISTORY, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
    fs.writeFileSync(FILES.NEURAL, JSON.stringify({
      hu: neuralNetworks.hu.save(),
      md5: neuralNetworks.md5.save()
    }, null, 2));
    fs.writeFileSync(FILES.ATTENTION, JSON.stringify({
      hu: attentionModels.hu.save(),
      md5: attentionModels.md5.save()
    }, null, 2));
    fs.writeFileSync(FILES.MARKOV, JSON.stringify({
      hu: markovChains.hu.save(),
      md5: markovChains.md5.save()
    }, null, 2));
    
    ensembleOptimizer.save();
    anomalyDetector.save();
  } catch (error) {
    logger.error(`Failed to save data: ${error.message}`);
  }
}

function loadAllData() {
  try {
    if (fs.existsSync(FILES.LEARNING)) {
      const data = JSON.parse(fs.readFileSync(FILES.LEARNING, 'utf8'));
      learningData = { ...learningData, ...data };
    }
    
    if (fs.existsSync(FILES.HISTORY)) {
      const data = JSON.parse(fs.readFileSync(FILES.HISTORY, 'utf8'));
      predictionHistory = data.history || { hu: [], md5: [] };
      lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
    }
    
    if (fs.existsSync(FILES.NEURAL)) {
      const data = JSON.parse(fs.readFileSync(FILES.NEURAL, 'utf8'));
      if (data.hu) neuralNetworks.hu.load(data.hu);
      if (data.md5) neuralNetworks.md5.load(data.md5);
    }
    
    if (fs.existsSync(FILES.ATTENTION)) {
      const data = JSON.parse(fs.readFileSync(FILES.ATTENTION, 'utf8'));
      if (data.hu) attentionModels.hu.load(data.hu);
      if (data.md5) attentionModels.md5.load(data.md5);
    }
    
    if (fs.existsSync(FILES.MARKOV)) {
      const data = JSON.parse(fs.readFileSync(FILES.MARKOV, 'utf8'));
      if (data.hu) markovChains.hu.load(data.hu);
      if (data.md5) markovChains.md5.load(data.md5);
    }
    
    ensembleOptimizer.load();
    anomalyDetector.load();
    
    logger.success('All AI models loaded successfully');
  } catch (error) {
    logger.error(`Failed to load data: ${error.message}`);
  }
}

function cleanupOldData() {
  for (const type of ['hu', 'md5']) {
    if (learningData[type].predictions.length > 2000) {
      learningData[type].predictions = learningData[type].predictions.slice(0, 2000);
    }
    if (learningData[type].recentAccuracy.length > 500) {
      learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-500);
    }
    if (predictionHistory[type].length > CONFIG.MAX_HISTORY) {
      predictionHistory[type] = predictionHistory[type].slice(0, CONFIG.MAX_HISTORY);
    }
  }
  saveAllData();
}

function resetAllData() {
  learningData = {
    hu: {
      predictions: [], totalPredictions: 0, correctPredictions: 0,
      streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [],
      methodPerformance: {
        neuralnet: { correct: 0, total: 0 }, attention: { correct: 0, total: 0 },
        markov: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
        time: { correct: 0, total: 0 }, balance: { correct: 0, total: 0 },
        simple: { correct: 0, total: 0 }
      },
      lastUpdate: null
    },
    md5: {
      predictions: [], totalPredictions: 0, correctPredictions: 0,
      streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [],
      methodPerformance: {
        neuralnet: { correct: 0, total: 0 }, attention: { correct: 0, total: 0 },
        markov: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
        time: { correct: 0, total: 0 }, balance: { correct: 0, total: 0 },
        simple: { correct: 0, total: 0 }
      },
      lastUpdate: null
    }
  };
  
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  predictionProbBuffer = { hu: [0.5], md5: [0.5] };
  
  neuralNetworks = { hu: new SimpleNeuralNetwork(), md5: new SimpleNeuralNetwork() };
  attentionModels = { hu: new SimpleAttentionModel(), md5: new SimpleAttentionModel() };
  markovChains = { hu: new SimpleMarkovChain(CONFIG.MARKOV_ORDER), md5: new SimpleMarkovChain(CONFIG.MARKOV_ORDER) };
  monteCarloSimulators = { hu: null, md5: null };
  anomalyDetector = new AnomalyDetector();
  regimeDetectors = { hu: new RegimeDetector(), md5: new RegimeDetector() };
  ensembleOptimizer = new EnsembleWeightOptimizer();
  
  saveAllData();
  logger.success('All data has been reset');
}

// ==================== EXPRESS ROUTES ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('LẨU CUA 79 - AI PREDICTION v13.0');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchData(API_URL_HU);
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Cannot fetch data' });
    }
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateSuperPrediction(data, 'hu');
    
    savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
    recordPrediction('hu', nextPhien, result);
    
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: 'kapub_v13'
    });
  } catch (error) {
    logger.error(`HU prediction error: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchData(API_URL_MD5);
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Cannot fetch data' });
    }
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateSuperPrediction(data, 'md5');
    
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
    recordPrediction('md5', nextPhien, result);
    
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: 'kapub_v13'
    });
  } catch (error) {
    logger.error(`MD5 prediction error: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    const data = await fetchData(API_URL_HU);
    if (data && data.length > 0) {
      await verifyPredictions('hu', data);
    }
    
    const historyWithStatus = predictionHistory.hu.map(record => {
      const pred = learningData.hu.predictions.find(p => p.phien === record.phien_hien_tai);
      return {
        ...record,
        ket_qua_thuc_te: pred?.actual || null,
        status: pred?.isCorrect === true ? '✅' : (pred?.isCorrect === false ? '❌' : '⏳')
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
    const data = await fetchData(API_URL_MD5);
    if (data && data.length > 0) {
      await verifyPredictions('md5', data);
    }
    
    const historyWithStatus = predictionHistory.md5.map(record => {
      const pred = learningData.md5.predictions.find(p => p.phien === record.phien_hien_tai);
      return {
        ...record,
        ket_qua_thuc_te: pred?.actual || null,
        status: pred?.isCorrect === true ? '✅' : (pred?.isCorrect === false ? '❌' : '⏳')
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
    const data = await fetchData(API_URL_HU);
    if (!data) {
      return res.status(500).json({ error: 'Cannot fetch data' });
    }
    
    const result = calculateSuperPrediction(data, 'hu');
    const stats = learningData.hu;
    const overallAccuracy = stats.totalPredictions > 0 ? 
      (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
    
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      confidence_level: result.confidence > 70 ? 'HIGH' : (result.confidence > 55 ? 'MEDIUM' : 'LOW'),
      factors: result.factors,
      methods_used: Object.keys(result.methodsUsed),
      overall_accuracy: `${overallAccuracy}%`,
      recommendation: result.confidence > 65 ? 'Consider betting' : 'Wait for better opportunity'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchData(API_URL_MD5);
    if (!data) {
      return res.status(500).json({ error: 'Cannot fetch data' });
    }
    
    const result = calculateSuperPrediction(data, 'md5');
    const stats = learningData.md5;
    const overallAccuracy = stats.totalPredictions > 0 ? 
      (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
    
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      confidence_level: result.confidence > 70 ? 'HIGH' : (result.confidence > 55 ? 'MEDIUM' : 'LOW'),
      factors: result.factors,
      methods_used: Object.keys(result.methodsUsed),
      overall_accuracy: `${overallAccuracy}%`,
      recommendation: result.confidence > 65 ? 'Consider betting' : 'Wait for better opportunity'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/stats', (req, res) => {
  const stats = learningData.hu;
  const overallAccuracy = stats.totalPredictions > 0 ? 
    (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? 
    (stats.recentAccuracy.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, stats.recentAccuracy.length) * 100).toFixed(2) : 0;
  
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
  
  const regime = regimeDetectors.hu.detectRegime(stats);
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${overallAccuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    regime,
    methodPerformance: methodAccuracies,
    lastUpdate: stats.lastUpdate
  });
});

app.get('/lc79-md5/stats', (req, res) => {
  const stats = learningData.md5;
  const overallAccuracy = stats.totalPredictions > 0 ? 
    (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? 
    (stats.recentAccuracy.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, stats.recentAccuracy.length) * 100).toFixed(2) : 0;
  
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
  
  const regime = regimeDetectors.md5.detectRegime(stats);
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${overallAccuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    regime,
    methodPerformance: methodAccuracies,
    lastUpdate: stats.lastUpdate
  });
});

app.get('/reset', (req, res) => {
  resetAllData();
  res.json({ message: 'All data and AI models have been reset successfully', version: 'v13.0' });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '13.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ==================== SERVER STARTUP ====================
loadAllData();

setInterval(() => autoProcessPredictions(), CONFIG.AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 5000);
setInterval(() => cleanupOldData(), CONFIG.CLEANUP_INTERVAL);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, saving data...');
  saveAllData();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, saving data...');
  saveAllData();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         LẨU CUA 79 - AI PREDICTION v13.0 FIXED               ║');
  console.log('║                    STABLE PRODUCTION VERSION                  ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  AI ALGORITHMS:                                               ║');
  console.log('║    ✅ Neural Network (12 inputs, 16 hidden)                   ║');
  console.log('║    ✅ Attention Model (window size 20)                        ║');
  console.log('║    ✅ Markov Chain (order 2)                                  ║');
  console.log('║    ✅ Monte Carlo Simulation (pattern matching)               ║');
  console.log('║    ✅ Anomaly Detection (z-score, break points)               ║');
  console.log('║    ✅ Ensemble Weight Optimizer                               ║');
  console.log('║    ✅ Regime Detector (trending/volatile/mixed)               ║');
  console.log('║    ✅ Time Window Pattern Analysis                            ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  ENDPOINTS:                                                   ║');
  console.log('║    GET /lc79-hu          - Prediction Hũ                      ║');
  console.log('║    GET /lc79-md5         - Prediction MD5                     ║');
  console.log('║    GET /lc79-hu/lichsu   - History Hũ                         ║');
  console.log('║    GET /lc79-md5/lichsu  - History MD5                        ║');
  console.log('║    GET /lc79-hu/analysis - Analysis Hũ                        ║');
  console.log('║    GET /lc79-md5/analysis- Analysis MD5                       ║');
  console.log('║    GET /lc79-hu/stats    - Statistics Hũ                      ║');
  console.log('║    GET /lc79-md5/stats   - Statistics MD5                     ║');
  console.log('║    GET /reset            - Reset all data                     ║');
  console.log('║    GET /health           - Health check                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\n🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Total predictions so far: ${learningData.hu.totalPredictions + learningData.md5.totalPredictions}\n`);
});
