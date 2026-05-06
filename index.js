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
const META_LEARNING_FILE = 'meta_learning.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };
let dataCache = { hu: null, md5: null, lastFetch: { hu: 0, md5: 0 } };
const CACHE_TTL = 5000;

// ==================== META LEARNING ENGINE ====================
class MetaLearner {
  constructor() {
    this.algorithmWeights = {
      monteCarlo: 1.0,
      lstm: 1.0,
      fuzzyLogic: 1.0,
      bayesian: 1.0,
      patternMatch: 1.0,
      anomalyBreak: 1.0,
      timeWindow: 1.0,
      trendReversal: 1.0,
      markovChain: 1.0,
      neuralNet: 1.0
    };
    this.performanceHistory = {};
    this.adaptationRate = 0.05;
    this.loadMetaData();
  }

  loadMetaData() {
    try {
      if (fs.existsSync(META_LEARNING_FILE)) {
        const data = JSON.parse(fs.readFileSync(META_LEARNING_FILE, 'utf8'));
        this.algorithmWeights = data.algorithmWeights || this.algorithmWeights;
        this.performanceHistory = data.performanceHistory || {};
        console.log('[Meta] Loaded meta-learning data');
      }
    } catch (e) {}
  }

  saveMetaData() {
    fs.writeFileSync(META_LEARNING_FILE, JSON.stringify({
      algorithmWeights: this.algorithmWeights,
      performanceHistory: this.performanceHistory,
      lastUpdated: new Date().toISOString()
    }, null, 2));
  }

  updateWeights(algorithm, success, confidence) {
    if (!this.performanceHistory[algorithm]) {
      this.performanceHistory[algorithm] = { wins: 0, total: 0, recent: [] };
    }
    this.performanceHistory[algorithm].total++;
    if (success) this.performanceHistory[algorithm].wins++;
    this.performanceHistory[algorithm].recent.push(success ? 1 : 0);
    if (this.performanceHistory[algorithm].recent.length > 20) this.performanceHistory[algorithm].recent.shift();
    
    const recentAccuracy = this.performanceHistory[algorithm].recent.reduce((a,b) => a + b, 0) / this.performanceHistory[algorithm].recent.length;
    const targetWeight = 0.5 + recentAccuracy * 0.8;
    this.algorithmWeights[algorithm] = this.algorithmWeights[algorithm] * (1 - this.adaptationRate) + targetWeight * this.adaptationRate;
    this.algorithmWeights[algorithm] = Math.max(0.3, Math.min(2.0, this.algorithmWeights[algorithm]));
    
    this.saveMetaData();
  }

  getWeight(algorithm) {
    return this.algorithmWeights[algorithm] || 1.0;
  }
}

// ==================== LSTM PATTERN RECOGNITION ====================
class LSTMPatternRecognizer {
  constructor(sequenceLength = 8) {
    this.sequenceLength = sequenceLength;
    this.patternLibrary = [];
    this.embeddingSize = 4;
    this.loadPatternLibrary();
  }

  loadPatternLibrary() {
    try {
      if (fs.existsSync('lstm_patterns.json')) {
        this.patternLibrary = JSON.parse(fs.readFileSync('lstm_patterns.json', 'utf8'));
        console.log(`[LSTM] Loaded ${this.patternLibrary.length} patterns`);
      }
    } catch (e) {}
  }

  encodeSequence(sequence) {
    const mapping = { 'Tài': [1,0,0,0], 'Xỉu': [0,1,0,0] };
    return sequence.map(s => mapping[s] || [0,0,1,0]).flat();
  }

  findSimilarPatterns(recentResults, maxMatches = 30) {
    const currentSeq = recentResults.slice(0, this.sequenceLength);
    const currentEncoded = this.encodeSequence(currentSeq);
    const matches = [];
    
    for (const pattern of this.patternLibrary) {
      let similarity = 0;
      for (let i = 0; i < currentEncoded.length; i++) {
        if (Math.abs(currentEncoded[i] - pattern.encoded[i]) < 0.5) similarity++;
      }
      similarity = similarity / currentEncoded.length;
      if (similarity > 0.6) {
        matches.push({
          similarity,
          nextResult: pattern.nextResult,
          confidence: pattern.confidence,
          timestamp: pattern.timestamp
        });
      }
    }
    
    matches.sort((a,b) => b.similarity - a.similarity);
    return matches.slice(0, maxMatches);
  }

  predict(recentResults) {
    if (recentResults.length < this.sequenceLength || this.patternLibrary.length < 10) return null;
    
    const similar = this.findSimilarPatterns(recentResults, 20);
    if (similar.length < 3) return null;
    
    let taiConfidence = 0;
    let xiuConfidence = 0;
    let totalWeight = 0;
    
    for (const pattern of similar) {
      const weight = pattern.similarity * 2;
      totalWeight += weight;
      if (pattern.nextResult === 'Tài') taiConfidence += weight;
      else xiuConfidence += weight;
    }
    
    const taiProb = taiConfidence / totalWeight;
    return {
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      confidence: 50 + Math.abs(taiProb - 0.5) * 80,
      probability: taiProb
    };
  }

  learn(pattern, nextResult, success) {
    const encoded = this.encodeSequence(pattern);
    this.patternLibrary.unshift({
      pattern: pattern.slice(),
      encoded: encoded,
      nextResult: nextResult,
      confidence: success ? 1 : 0.3,
      timestamp: new Date().toISOString()
    });
    if (this.patternLibrary.length > 200) this.patternLibrary.pop();
    
    fs.writeFileSync('lstm_patterns.json', JSON.stringify(this.patternLibrary.slice(0, 200), null, 2));
  }
}

// ==================== FUZZY LOGIC ENGINE ====================
class FuzzyLogicEngine {
  constructor() {
    this.rules = [];
    this.initRules();
  }

  initRules() {
    this.rules = [
      { condition: (streak, alt, vol) => streak >= 4 && alt < 3, output: 'break', strength: 0.7 },
      { condition: (streak, alt, vol) => alt >= 6 && streak < 3, output: 'alternating', strength: 0.8 },
      { condition: (streak, alt, vol) => vol > 5 && streak < 3, output: 'random', strength: 0.6 },
      { condition: (streak, alt, vol) => streak >= 6 && alt < 2, output: 'strong_break', strength: 0.85 },
      { condition: (streak, alt, vol) => alt >= 8 && vol < 3, output: 'continue_alternating', strength: 0.75 },
      { condition: (streak, alt, vol) => vol < 2 && streak < 2 && alt < 3, output: 'stable', strength: 0.65 }
    ];
  }

  fuzzify(value, type) {
    const ranges = {
      streak: { low: [0,2], medium: [1,4], high: [3,10] },
      alternating: { low: [0,3], medium: [2,6], high: [5,12] },
      volatility: { low: [0,2], medium: [1,4], high: [3,8] }
    };
    const r = ranges[type];
    if (!r) return { low: 1, medium: 0, high: 0 };
    if (value <= r.low[1]) return { low: 1, medium: Math.max(0, (value - r.low[0])/(r.low[1] - r.low[0])), high: 0 };
    if (value <= r.medium[1]) return { low: Math.max(0, (r.medium[1] - value)/(r.medium[1] - r.medium[0])), medium: 1, high: Math.max(0, (value - r.medium[0])/(r.medium[1] - r.medium[0])) };
    return { low: 0, medium: Math.max(0, (r.high[1] - value)/(r.high[1] - r.high[0])), high: 1 };
  }

  evaluate(streak, alternating, volatility) {
    const f_streak = this.fuzzify(streak, 'streak');
    const f_alt = this.fuzzify(alternating, 'alternating');
    const f_vol = this.fuzzify(volatility, 'volatility');
    
    let breakScore = 0;
    let continueScore = 0;
    let randomScore = 0;
    
    for (const rule of this.rules) {
      let fireStrength = 1;
      if (rule.condition.toString().includes('streak')) fireStrength *= f_streak.high;
      if (rule.condition.toString().includes('alt')) fireStrength *= f_alt.high;
      if (rule.condition.toString().includes('vol')) fireStrength *= f_vol.medium;
      fireStrength = Math.max(0.1, Math.min(0.9, fireStrength));
      
      if (rule.output.includes('break')) breakScore += fireStrength * rule.strength;
      else if (rule.output.includes('alternating')) continueScore += fireStrength * rule.strength;
      else if (rule.output.includes('random')) randomScore += fireStrength * rule.strength;
      else if (rule.output.includes('stable')) continueScore += fireStrength * rule.strength * 0.5;
    }
    
    const total = breakScore + continueScore + randomScore;
    if (total === 0) return { decision: 'neutral', confidence: 50, scores: { break: 0, continue: 0, random: 0 } };
    
    let decision = 'continue';
    let confidence = (continueScore / total) * 100;
    if (breakScore > continueScore && breakScore > randomScore) {
      decision = 'break';
      confidence = (breakScore / total) * 100;
    } else if (randomScore > continueScore && randomScore > breakScore) {
      decision = 'random';
      confidence = (randomScore / total) * 100;
    }
    
    return { decision, confidence: Math.min(85, 50 + confidence/2), scores: { break: breakScore, continue: continueScore, random: randomScore } };
  }
}

// ==================== BAYESIAN INFERENCE ====================
class BayesianInference {
  constructor() {
    this.priors = { Tai: 0.5, Xiu: 0.5 };
    this.likelihoods = {};
    this.updateHistory = [];
  }

  updateLikelihood(observation, result) {
    if (!this.likelihoods[observation]) {
      this.likelihoods[observation] = { Tai: 1, Xiu: 1 };
    }
    this.likelihoods[observation][result]++;
    this.updateHistory.push({ observation, result, time: Date.now() });
    if (this.updateHistory.length > 500) this.updateHistory.shift();
  }

  predict(observations) {
    let postTai = Math.log(this.priors.Tai);
    let postXiu = Math.log(this.priors.Xiu);
    
    for (const obs of observations) {
      if (this.likelihoods[obs]) {
        postTai += Math.log(this.likelihoods[obs].Tai / (this.likelihoods[obs].Tai + this.likelihoods[obs].Xiu));
        postXiu += Math.log(this.likelihoods[obs].Xiu / (this.likelihoods[obs].Tai + this.likelihoods[obs].Xiu));
      }
    }
    
    const probTai = Math.exp(postTai) / (Math.exp(postTai) + Math.exp(postXiu));
    return {
      prediction: probTai > 0.5 ? 'Tài' : 'Xỉu',
      confidence: 50 + Math.abs(probTai - 0.5) * 80,
      probability: probTai
    };
  }

  getObservationKey(results) {
    if (results.length < 3) return 'default';
    return results.slice(0, 5).join('_');
  }
}

// ==================== GENETIC ALGORITHM ADAPTATION ====================
class GeneticAdaptor {
  constructor() {
    this.population = this.initializePopulation(20);
    this.generation = 0;
    this.bestFitness = 0;
    this.loadGenes();
  }

  initializePopulation(size) {
    const population = [];
    for (let i = 0; i < size; i++) {
      population.push({
        weights: {
          momentum: 0.3 + Math.random() * 0.5,
          streak: 0.2 + Math.random() * 0.6,
          pattern: 0.3 + Math.random() * 0.5,
          anomaly: 0.1 + Math.random() * 0.4,
          lstm: 0.2 + Math.random() * 0.5,
          fuzzy: 0.1 + Math.random() * 0.4,
          bayesian: 0.1 + Math.random() * 0.4
        },
        fitness: 0,
        threshold: 0.4 + Math.random() * 0.3
      });
    }
    return population;
  }

  loadGenes() {
    try {
      if (fs.existsSync('genetic_weights.json')) {
        const data = JSON.parse(fs.readFileSync('genetic_weights.json', 'utf8'));
        if (data.bestGenes) {
          this.population[0] = data.bestGenes;
          console.log('[Genetic] Loaded optimized genes');
        }
      }
    } catch (e) {}
  }

  saveGenes() {
    const best = this.population.reduce((a,b) => a.fitness > b.fitness ? a : b, this.population[0]);
    fs.writeFileSync('genetic_weights.json', JSON.stringify({ bestGenes: best, generation: this.generation }, null, 2));
  }

  evaluateFitness(predictions, actuals) {
    for (const individual of this.population) {
      let correct = 0;
      for (let i = 0; i < Math.min(predictions.length, actuals.length); i++) {
        if (predictions[i] === actuals[i]) correct++;
      }
      individual.fitness = correct / Math.max(1, Math.min(predictions.length, actuals.length));
    }
    
    const best = this.population.reduce((a,b) => a.fitness > b.fitness ? a : b, this.population[0]);
    if (best.fitness > this.bestFitness) {
      this.bestFitness = best.fitness;
      this.saveGenes();
    }
  }

  evolve() {
    this.population.sort((a,b) => b.fitness - a.fitness);
    const newPopulation = this.population.slice(0, 4);
    
    while (newPopulation.length < 20) {
      const parent1 = this.population[Math.floor(Math.random() * 8)];
      const parent2 = this.population[Math.floor(Math.random() * 8)];
      const child = this.crossover(parent1, parent2);
      this.mutate(child);
      newPopulation.push(child);
    }
    
    this.population = newPopulation;
    this.generation++;
  }

  crossover(p1, p2) {
    const child = {
      weights: {},
      fitness: 0,
      threshold: Math.random() > 0.5 ? p1.threshold : p2.threshold
    };
    for (const key in p1.weights) {
      child.weights[key] = Math.random() > 0.5 ? p1.weights[key] : p2.weights[key];
    }
    return child;
  }

  mutate(individual) {
    if (Math.random() < 0.2) {
      const keys = Object.keys(individual.weights);
      const key = keys[Math.floor(Math.random() * keys.length)];
      individual.weights[key] += (Math.random() - 0.5) * 0.1;
      individual.weights[key] = Math.max(0.05, Math.min(0.95, individual.weights[key]));
    }
    if (Math.random() < 0.1) {
      individual.threshold += (Math.random() - 0.5) * 0.1;
      individual.threshold = Math.max(0.3, Math.min(0.7, individual.threshold));
    }
  }

  getOptimalWeights() {
    const best = this.population.reduce((a,b) => a.fitness > b.fitness ? a : b, this.population[0]);
    return best.weights;
  }
}

// ==================== IMPROVED MONTE CARLO (CHỈ 10 PHIÊN GẦN NHẤT) ====================
class ImprovedMonteCarlo {
  constructor(historicalData, windowSize = 10) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.numSimulations = 8000;
    this.timeDecay = 0.95;
  }

  extractRecentFeatures(data) {
    if (!data || data.length < 5) return null;
    
    const results = data.slice(0, this.windowSize).map(d => d.Ket_qua);
    const sums = data.slice(0, this.windowSize).map(d => d.Tong);
    
    const taiCount = results.filter(r => r === 'Tài').length;
    const xiuCount = results.length - taiCount;
    
    const last3 = results.slice(0, 3);
    const last5 = results.slice(0, 5);
    const last3Tai = last3.filter(r => r === 'Tài').length;
    const last5Tai = last5.filter(r => r === 'Tài').length;
    
    let currentStreak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) currentStreak++;
      else break;
    }
    
    let alternatingLength = 1;
    for (let i = 1; i < Math.min(results.length, 15); i++) {
      if (results[i] !== results[i-1]) alternatingLength++;
      else break;
    }
    
    const recentVolatility = this.calculateVolatility(sums.slice(0, 5));
    
    return {
      results,
      sums,
      taiRatio: taiCount / results.length,
      last3Tai,
      last5Tai,
      currentStreak,
      alternatingLength,
      recentVolatility,
      lastResult: results[0],
      sumTrend: sums[0] > sums[1] ? 'down' : (sums[0] < sums[1] ? 'up' : 'stable')
    };
  }

  calculateVolatility(sums) {
    if (sums.length < 2) return 0;
    const mean = sums.reduce((a,b) => a+b, 0) / sums.length;
    const variance = sums.reduce((a,b) => a + Math.pow(b - mean, 2), 0) / sums.length;
    return Math.sqrt(variance);
  }

  findRecentPatterns(currentFeatures, maxMatches = 60) {
    const matches = [];
    const dataLength = this.historicalData.length;
    
    for (let i = 0; i <= dataLength - this.windowSize - 1; i++) {
      const windowData = this.historicalData.slice(i, i + this.windowSize);
      const windowResults = windowData.map(d => d.Ket_qua);
      const windowSums = windowData.map(d => d.Tong);
      
      const windowTaiCount = windowResults.filter(r => r === 'Tài').length;
      let windowTaiRatio = windowTaiCount / this.windowSize;
      
      let similarity = 0;
      
      const taiDiff = Math.abs(windowTaiRatio - currentFeatures.taiRatio);
      similarity += Math.max(0, 30 - taiDiff * 50);
      
      const streakDiff = Math.abs(this.getStreakLength(windowResults) - currentFeatures.currentStreak);
      similarity += Math.max(0, 20 - streakDiff * 3);
      
      const windowLast3Tai = windowResults.slice(0,3).filter(r => r === 'Tài').length;
      if (windowLast3Tai === currentFeatures.last3Tai) similarity += 15;
      
      const windowLast5Tai = windowResults.slice(0,5).filter(r => r === 'Tài').length;
      if (Math.abs(windowLast5Tai - currentFeatures.last5Tai) <= 1) similarity += 10;
      
      const timeWeight = Math.pow(this.timeDecay, i / 10);
      similarity *= (0.8 + timeWeight * 0.4);
      
      if (similarity > 20) {
        matches.push({
          similarity,
          index: i,
          nextResult: this.historicalData[i + this.windowSize]?.Ket_qua,
          nextSum: this.historicalData[i + this.windowSize]?.Tong,
          timeWeight
        });
      }
    }
    
    matches.sort((a,b) => b.similarity - a.similarity);
    return matches.slice(0, maxMatches);
  }

  getStreakLength(results) {
    if (results.length === 0) return 0;
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    return streak;
  }

  runSimulation(currentData, anomalyDetector, currentHour) {
    const currentFeatures = this.extractRecentFeatures(currentData);
    
    if (!currentFeatures || this.historicalData.length < 20) {
      const last10Results = currentData.slice(0, 10).map(d => d.Ket_qua);
      const taiCount = last10Results.filter(r => r === 'Tài').length;
      const taiProb = taiCount / 10;
      return {
        taiProbability: taiProb.toFixed(4),
        xiuProbability: (1 - taiProb).toFixed(4),
        confidence: 50 + Math.abs(taiProb - 0.5) * 50,
        prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
        similarPatternsCount: 0
      };
    }
    
    const similarPatterns = this.findRecentPatterns(currentFeatures, 80);
    
    if (similarPatterns.length < 3) {
      const last5Results = currentData.slice(0, 5).map(d => d.Ket_qua);
      const taiCount = last5Results.filter(r => r === 'Tài').length;
      const taiProb = taiCount / 5;
      return {
        taiProbability: taiProb.toFixed(4),
        xiuProbability: (1 - taiProb).toFixed(4),
        confidence: 55,
        prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
        similarPatternsCount: similarPatterns.length
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
      if (selectedPattern.timeWeight > 0.8) weight *= 1.3;
      
      totalWeight += weight;
      
      if (selectedPattern.nextResult === 'Tài') {
        taiWins += weight;
      } else {
        xiuWins += weight;
      }
    }
    
    let taiProbability = taiWins / totalWeight;
    
    const biasCorrection = anomalyDetector.getBiasCorrection();
    taiProbability += biasCorrection * 0.5;
    taiProbability = Math.max(0.35, Math.min(0.65, taiProbability));
    
    if (currentFeatures.alternatingLength >= 6 && currentFeatures.alternatingLength <= 9) {
      taiProbability = currentFeatures.lastResult === 'Tài' ? 0.45 : 0.55;
    }
    
    if (currentFeatures.currentStreak >= 4) {
      const breakProb = Math.min(0.7, currentFeatures.currentStreak / 10);
      taiProbability = 1 - (currentFeatures.lastResult === 'Tài' ? breakProb : 1 - breakProb);
    }
    
    const confidence = 50 + Math.abs(taiProbability - 0.5) * 90;
    const finalConfidence = Math.min(88, Math.max(58, Math.round(confidence)));
    
    return {
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: (1 - taiProbability).toFixed(4),
      confidence: finalConfidence,
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      similarPatternsCount: similarPatterns.length,
      currentStreak: currentFeatures.currentStreak,
      alternatingLength: currentFeatures.alternatingLength
    };
  }
}

// ==================== TREND REVERSAL DETECTOR ====================
class TrendReversalDetector {
  detect(results) {
    if (results.length < 8) return null;
    
    const last8 = results.slice(0, 8);
    const first4 = last8.slice(0, 4);
    const last4 = last8.slice(4, 8);
    
    const first4Tai = first4.filter(r => r === 'Tài').length;
    const last4Tai = last4.filter(r => r === 'Tài').length;
    
    if ((first4Tai >= 3 && last4Tai <= 1)) {
      return { prediction: 'Xỉu', confidence: 68, reason: 'Strong Tai reversal to Xiu' };
    }
    if ((first4Tai <= 1 && last4Tai >= 3)) {
      return { prediction: 'Tài', confidence: 68, reason: 'Strong Xiu reversal to Tai' };
    }
    
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    if (streak >= 4) {
      return { 
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', 
        confidence: 60 + Math.min(15, streak * 2),
        reason: `Reversal after ${streak} streak`
      };
    }
    return null;
  }
}

// ==================== MARKOV CHAIN PREDICTOR ====================
class MarkovChainPredictor {
  constructor(order = 2) {
    this.order = order;
    this.transitions = {};
  }

  learn(sequence) {
    for (let i = 0; i <= sequence.length - this.order - 1; i++) {
      const state = sequence.slice(i, i + this.order).join('|');
      const next = sequence[i + this.order];
      if (!this.transitions[state]) this.transitions[state] = { Tài: 0, Xỉu: 0 };
      this.transitions[state][next]++;
    }
  }

  predict(lastResults) {
    if (lastResults.length < this.order) return null;
    const state = lastResults.slice(0, this.order).join('|');
    const trans = this.transitions[state];
    if (!trans || (trans.Tài + trans.Xỉu) < 3) return null;
    
    const total = trans.Tài + trans.Xỉu;
    const taiProb = trans.Tài / total;
    return {
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      confidence: 50 + Math.abs(taiProb - 0.5) * 50,
      probability: taiProb
    };
  }
}

// ==================== SIMPLE NEURAL NETWORK ====================
class SimpleNeuralNet {
  constructor() {
    this.weights1 = Array(10).fill().map(() => Array(6).fill().map(() => Math.random() * 0.2 - 0.1));
    this.weights2 = Array(6).fill().map(() => Math.random() * 0.2 - 0.1);
    this.bias1 = Array(6).fill(0);
    this.bias2 = 0;
    this.learningRate = 0.01;
  }

  sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  
  forward(features) {
    let hidden = Array(6).fill(0);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 10; j++) {
        hidden[i] += this.weights1[j][i] * features[j];
      }
      hidden[i] = this.sigmoid(hidden[i] + this.bias1[i]);
    }
    let output = 0;
    for (let i = 0; i < 6; i++) output += this.weights2[i] * hidden[i];
    return this.sigmoid(output + this.bias2);
  }

  extractFeatures(results, sums) {
    const features = Array(10).fill(0);
    features[0] = (results.filter(r => r === 'Tài').length / results.length);
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    features[1] = Math.min(1, streak / 10);
    let alt = 1;
    for (let i = 1; i < Math.min(results.length, 12); i++) {
      if (results[i] !== results[i-1]) alt++;
      else break;
    }
    features[2] = Math.min(1, alt / 12);
    const recentSums = sums.slice(0, 5);
    const avg = recentSums.reduce((a,b) => a+b,0)/recentSums.length;
    features[3] = Math.min(1, avg/13);
    features[4] = results[0] === 'Tài' ? 1 : 0;
    features[5] = results[1] === 'Tài' ? 1 : 0;
    features[6] = results[2] === 'Tài' ? 1 : 0;
    features[7] = results[3] === 'Tài' ? 1 : 0;
    features[8] = results[4] === 'Tài' ? 1 : 0;
    features[9] = alt >= 5 ? 1 : 0;
    return features;
  }

  predict(results, sums) {
    if (results.length < 10) return null;
    const features = this.extractFeatures(results, sums);
    const output = this.forward(features);
    return {
      prediction: output > 0.5 ? 'Tài' : 'Xỉu',
      confidence: 50 + Math.abs(output - 0.5) * 60,
      probability: output
    };
  }
}

// ==================== ANOMALY DETECTION ENGINE ====================
class AnomalyDetector {
  constructor() {
    this.anomalyPatterns = [];
    this.breakPoints = [];
    this.timeWindowStats = {};
    this.reinforcementMemory = { tai: 0, xiu: 0, lastAdjustment: null };
    this.loadAnomalyData();
  }

  loadAnomalyData() {
    try {
      if (fs.existsSync(ANOMALY_FILE)) {
        const data = JSON.parse(fs.readFileSync(ANOMALY_FILE, 'utf8'));
        this.anomalyPatterns = data.anomalyPatterns || [];
        this.breakPoints = data.breakPoints || [];
        this.timeWindowStats = data.timeWindowStats || {};
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
        lastSaved: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      console.error('[Anomaly] Save error:', error.message);
    }
  }

  detectAnomaly(results, windowSize = 8) {
    if (results.length < windowSize) return { isAnomaly: false, score: 0 };
    
    const recent = results.slice(0, windowSize);
    const taiCount = recent.filter(r => r === 'Tài').length;
    const xiuCount = windowSize - taiCount;
    const deviation = Math.abs(taiCount / windowSize - 0.5);
    
    const isAnomaly = deviation > 0.35;
    const anomalyScore = Math.min(100, deviation * 250);
    
    let breakDetected = false;
    let breakDirection = null;
    
    if (results.length >= 5) {
      const first4 = results.slice(0, 4);
      const fifth = results[4];
      const allSame = first4.every(r => r === first4[0]);
      if (allSame && fifth !== first4[0]) {
        breakDetected = true;
        breakDirection = fifth;
        this.recordBreakPoint(first4[0], fifth, new Date());
      }
    }
    
    let alternatingLength = 1;
    for (let i = 1; i < Math.min(results.length, 12); i++) {
      if (results[i] !== results[i-1]) alternatingLength++;
      else break;
    }
    const isAlternatingAnomaly = alternatingLength >= 7;
    
    let doublePattern = false;
    if (results.length >= 6) {
      doublePattern = results[0] === results[2] && results[1] === results[3] && results[4] !== results[0];
    }
    
    return {
      isAnomaly: isAnomaly || breakDetected || isAlternatingAnomaly || doublePattern,
      score: anomalyScore,
      deviation: deviation.toFixed(3),
      taiRatio: (taiCount / windowSize * 100).toFixed(1),
      breakDetected,
      breakDirection,
      alternatingLength,
      isAlternatingAnomaly,
      doublePattern
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
    if (this.breakPoints.length > 200) this.breakPoints = this.breakPoints.slice(-200);
    this.saveAnomalyData();
  }

  predictBreakProbability(currentStreak, currentStreakType, currentHour) {
    if (this.breakPoints.length < 10) return 0.3;
    
    const sameHourBreaks = this.breakPoints.filter(b => {
      const hour = new Date(b.timestamp).getHours();
      return hour === currentHour;
    });
    
    const sameTypeBreaks = this.breakPoints.filter(b => b.from === currentStreakType);
    
    let probability = 0.25;
    if (sameHourBreaks.length > 0) {
      probability += (sameHourBreaks.length / Math.max(1, this.breakPoints.length)) * 0.35;
    }
    if (sameTypeBreaks.length > 0) {
      probability += (sameTypeBreaks.length / Math.max(1, this.breakPoints.filter(b => b.from === currentStreakType).length + 1)) * 0.25;
    }
    probability += Math.min(0.45, currentStreak / 12);
    
    return Math.min(0.85, probability);
  }

  learnFromResult(prediction, actual, confidence) {
    const isCorrect = prediction === actual;
    if (isCorrect) {
      this.reinforcementMemory[prediction === 'Tài' ? 'tai' : 'xiu'] += 1;
    } else {
      const wrongSide = prediction === 'Tài' ? 'tai' : 'xiu';
      this.reinforcementMemory[wrongSide] = Math.max(0, this.reinforcementMemory[wrongSide] - 0.6);
    }
    this.reinforcementMemory.tai = Math.min(8, Math.max(-4, this.reinforcementMemory.tai));
    this.reinforcementMemory.xiu = Math.min(8, Math.max(-4, this.reinforcementMemory.xiu));
    this.saveAnomalyData();
  }

  getBiasCorrection() {
    const taiScore = this.reinforcementMemory.tai || 0;
    const xiuScore = this.reinforcementMemory.xiu || 0;
    const diff = taiScore - xiuScore;
    if (Math.abs(diff) < 1.5) return 0;
    return Math.max(-0.15, Math.min(0.15, diff / 20));
  }

  updateTimeWindowStats(result, timestamp) {
    const hour = timestamp.getHours();
    const minute = Math.floor(timestamp.getMinutes() / 15) * 15;
    const windowKey = `${hour}:${minute}`;
    if (!this.timeWindowStats[windowKey]) {
      this.timeWindowStats[windowKey] = { tai: 0, xiu: 0, total: 0 };
    }
    if (result === 'Tài') this.timeWindowStats[windowKey].tai++;
    else this.timeWindowStats[windowKey].xiu++;
    this.timeWindowStats[windowKey].total++;
    this.saveAnomalyData();
  }

  predictByTimeWindow(currentTimestamp) {
    const hour = currentTimestamp.getHours();
    const minute = Math.floor(currentTimestamp.getMinutes() / 15) * 15;
    const windowKey = `${hour}:${minute}`;
    const stats = this.timeWindowStats[windowKey];
    if (!stats || stats.total < 8) return null;
    const taiRatio = stats.tai / stats.total;
    if (taiRatio > 0.65) return { prediction: 'Tài', confidence: 55 + Math.round(taiRatio * 25) };
    if (taiRatio < 0.35) return { prediction: 'Xỉu', confidence: 55 + Math.round((1 - taiRatio) * 25) };
    return null;
  }
}

// ==================== ENSEMBLE VOTING SYSTEM ====================
class EnsembleVoter {
  constructor() {
    this.voters = [];
    this.voterWeights = {};
  }

  addVoter(name, predictFunc, weight = 1.0) {
    this.voters.push({ name, predictFunc, weight });
    this.voterWeights[name] = weight;
  }

  vote(data, context = {}) {
    const votes = [];
    const details = {};
    let taiScore = 0;
    let xiuScore = 0;
    let totalWeight = 0;
    
    for (const voter of this.voters) {
      try {
        const result = voter.predictFunc(data, context);
        if (result && result.prediction) {
          const effectiveWeight = voter.weight * (result.confidence / 100);
          totalWeight += effectiveWeight;
          
          if (result.prediction === 'Tài') taiScore += effectiveWeight;
          else xiuScore += effectiveWeight;
          
          votes.push({
            name: voter.name,
            prediction: result.prediction,
            confidence: result.confidence || 60,
            weight: effectiveWeight
          });
          details[voter.name] = result;
        }
      } catch (e) {
        // Silent fail
      }
    }
    
    if (votes.length === 0) {
      return { prediction: 'Tài', confidence: 55, details: {}, voteCount: 0, totalVoters: this.voters.length, taiScore: 0, xiuScore: 0 };
    }
    
    const finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
    const confidence = totalWeight > 0 ? Math.round(Math.max(taiScore, xiuScore) / totalWeight * 100) : 60;
    
    return {
      prediction: finalPrediction,
      confidence: Math.min(90, Math.max(55, confidence)),
      details,
      voteCount: votes.length,
      totalVoters: this.voters.length,
      taiScore: taiScore.toFixed(3),
      xiuScore: xiuScore.toFixed(3)
    };
  }
}

// ==================== PATTERN DETECTORS ====================
const patternDetectors = {
  cau_bet: (r) => ({ prediction: r[0] || 'Tài', confidence: 55, name: 'cau_bet' }),
  cau_dao_11: (r) => r[0] === r[1] ? null : { prediction: r[0], confidence: 58, name: 'cau_dao_11' },
  cau_22: (r) => {
    if (r.length >= 4 && r[0] === r[1] && r[2] === r[3] && r[0] !== r[2]) {
      return { prediction: r[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 65, name: 'cau_22' };
    }
    return null;
  },
  cau_33: (r) => {
    if (r.length >= 6 && r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[0] !== r[3]) {
      return { prediction: r[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 70, name: 'cau_33' };
    }
    return null;
  },
  cau_nhip_nghieng: (r) => {
    if (r.length < 6) return null;
    const taiCount = r.slice(0,6).filter(x => x === 'Tài').length;
    if (taiCount === 4 || taiCount === 5) return { prediction: 'Xỉu', confidence: 62, name: 'cau_nhip_nghieng_tai' };
    if (taiCount === 1 || taiCount === 2) return { prediction: 'Tài', confidence: 62, name: 'cau_nhip_nghieng_xiu' };
    return null;
  },
  cau_121: (r) => {
    if (r.length >= 3 && r[0] === r[2] && r[0] !== r[1]) {
      return { prediction: r[0], confidence: 60, name: 'cau_121' };
    }
    return null;
  },
  cau_123: (r) => {
    if (r.length >= 3 && r[0] !== r[1] && r[1] !== r[2] && r[0] !== r[2]) {
      return { prediction: r[2] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 58, name: 'cau_123' };
    }
    return null;
  }
};

// ==================== LEARNING DATA STRUCTURE ====================
let learningData = {
  hu: { predictions: [], totalPredictions: 0, correctPredictions: 0, recentAccuracy: [], streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 }, lastUpdate: null },
  md5: { predictions: [], totalPredictions: 0, correctPredictions: 0, recentAccuracy: [], streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 }, lastUpdate: null }
};

// Khởi tạo các engine
let monteCarloSimulators = { hu: null, md5: null };
let anomalyDetector = new AnomalyDetector();
let metaLearner = new MetaLearner();
let lstmRecognizer = new LSTMPatternRecognizer();
let fuzzyEngine = new FuzzyLogicEngine();
let bayesianInference = new BayesianInference();
let geneticAdaptor = new GeneticAdaptor();
let trendReversalDetector = new TrendReversalDetector();
let markovChain = new MarkovChainPredictor(2);
let neuralNet = new SimpleNeuralNet();
let ensembleVoter = new EnsembleVoter();

// ==================== SETUP FULL ENSEMBLE ====================
function setupFullEnsemble() {
  ensembleVoter = new EnsembleVoter();
  
  // 1. MONTE CARLO
  ensembleVoter.addVoter('MonteCarlo', (data, ctx) => {
    if (monteCarloSimulators[ctx.type]) {
      return monteCarloSimulators[ctx.type].runSimulation(data, anomalyDetector, new Date().getHours());
    }
    return null;
  }, metaLearner.getWeight('monteCarlo'));
  
  // 2. LSTM
  ensembleVoter.addVoter('LSTM', (data, ctx) => {
    const results = data.slice(0, 10).map(d => d.Ket_qua);
    return lstmRecognizer.predict(results);
  }, metaLearner.getWeight('lstm'));
  
  // 3. FUZZY LOGIC
  ensembleVoter.addVoter('FuzzyLogic', (data, ctx) => {
    const results = data.slice(0, 10).map(d => d.Ket_qua);
    let streak = 1, alternating = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    for (let i = 1; i < Math.min(results.length, 12); i++) {
      if (results[i] !== results[i-1]) alternating++;
      else break;
    }
    const sums = data.slice(0, 8).map(d => d.Tong);
    let vol = 0;
    if (sums.length > 1) {
      const mean = sums.slice(0,5).reduce((a,b)=>a+b,0)/Math.min(5, sums.length);
      vol = Math.sqrt(sums.slice(0,5).reduce((a,b)=>a+Math.pow(b-mean,2),0)/Math.min(5, sums.length));
    }
    const fuzzy = fuzzyEngine.evaluate(streak, alternating, vol);
    let result = { prediction: results[0], confidence: fuzzy.confidence };
    if (fuzzy.decision === 'break') {
      result.prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    }
    return result;
  }, metaLearner.getWeight('fuzzyLogic'));
  
  // 4. BAYESIAN
  ensembleVoter.addVoter('Bayesian', (data, ctx) => {
    const results = data.slice(0, 8).map(d => d.Ket_qua);
    const obsKey = bayesianInference.getObservationKey(results);
    return bayesianInference.predict([obsKey]);
  }, metaLearner.getWeight('bayesian'));
  
  // 5. PATTERN MATCH
  ensembleVoter.addVoter('PatternMatch', (data, ctx) => {
    const results = data.slice(0, 10).map(d => d.Ket_qua);
    let bestMatch = null;
    let bestConfidence = 0;
    for (const [name, detector] of Object.entries(patternDetectors)) {
      const result = detector(results);
      if (result && result.confidence > bestConfidence) {
        bestMatch = result;
        bestConfidence = result.confidence;
      }
    }
    if (results.length >= 5 && results[0] === results[1] && results[2] === results[3] && results[0] !== results[2]) {
      const altResult = { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 65 };
      if (altResult.confidence > bestConfidence) bestMatch = altResult;
    }
    return bestMatch;
  }, metaLearner.getWeight('patternMatch'));
  
  // 6. ANOMALY BREAK
  ensembleVoter.addVoter('AnomalyBreak', (data, ctx) => {
    const results = data.slice(0, 10).map(d => d.Ket_qua);
    const anomaly = anomalyDetector.detectAnomaly(results, 8);
    if (anomaly.breakDetected && anomaly.breakDirection) {
      return { prediction: anomaly.breakDirection, confidence: 68 };
    }
    if (anomaly.isAlternatingAnomaly) {
      return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 65 };
    }
    return null;
  }, metaLearner.getWeight('anomalyBreak'));
  
  // 7. TIME WINDOW
  ensembleVoter.addVoter('TimeWindow', (data, ctx) => {
    return anomalyDetector.predictByTimeWindow(new Date());
  }, metaLearner.getWeight('timeWindow'));
  
  // 8. TREND REVERSAL
  ensembleVoter.addVoter('TrendReversal', (data, ctx) => {
    const results = data.slice(0, 10).map(d => d.Ket_qua);
    return trendReversalDetector.detect(results);
  }, metaLearner.getWeight('trendReversal'));
  
  // 9. MARKOV CHAIN
  ensembleVoter.addVoter('MarkovChain', (data, ctx) => {
    const results = data.slice(0, 12).map(d => d.Ket_qua);
    if (learningData[ctx.type].predictions.length > 10) {
      const recentActuals = learningData[ctx.type].predictions.filter(p => p.verified).slice(0, 30).map(p => p.actual);
      if (recentActuals.length > 10) markovChain.learn(recentActuals);
    }
    return markovChain.predict(results);
  }, metaLearner.getWeight('markovChain'));
  
  // 10. NEURAL NETWORK
  ensembleVoter.addVoter('NeuralNet', (data, ctx) => {
    const results = data.slice(0, 10).map(d => d.Ket_qua);
    const sums = data.slice(0, 10).map(d => d.Tong);
    return neuralNet.predict(results, sums);
  }, metaLearner.getWeight('neuralNet'));
  
  console.log('\n✅ ENSEMBLE CONFIGURED WITH 10 ALGORITHMS');
  console.log('   1. Monte Carlo    2. LSTM          3. Fuzzy Logic    4. Bayesian       5. Pattern Match');
  console.log('   6. Anomaly Break  7. Time Window   8. Trend Reversal 9. Markov Chain   10. Neural Network\n');
}

// ==================== HELPER FUNCTIONS ====================
function updateMonteCarloSimulators(type, data) {
  if (data && data.length >= 10) {
    monteCarloSimulators[type] = new ImprovedMonteCarlo(data, 10);
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
  const now = Date.now();
  if (dataCache.hu && dataCache.lastFetch.hu && (now - dataCache.lastFetch.hu) < CACHE_TTL) {
    return dataCache.hu;
  }
  try {
    const response = await axios.get(API_URL_HU);
    dataCache.hu = transformApiData(response.data);
    dataCache.lastFetch.hu = now;
    return dataCache.hu;
  } catch (error) {
    console.error('Error fetching HU data:', error.message);
    return dataCache.hu;
  }
}

async function fetchDataMd5() {
  const now = Date.now();
  if (dataCache.md5 && dataCache.lastFetch.md5 && (now - dataCache.lastFetch.md5) < CACHE_TTL) {
    return dataCache.md5;
  }
  try {
    const response = await axios.get(API_URL_MD5);
    dataCache.md5 = transformApiData(response.data);
    dataCache.lastFetch.md5 = now;
    return dataCache.md5;
  } catch (error) {
    console.error('Error fetching MD5 data:', error.message);
    return dataCache.md5;
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
      
      // Update meta learning
      const factors = pred.factors || [];
      for (const factor of factors) {
        if (factor.includes('MonteCarlo')) metaLearner.updateWeights('monteCarlo', pred.isCorrect, pred.confidence);
        if (factor.includes('LSTM')) metaLearner.updateWeights('lstm', pred.isCorrect, pred.confidence);
        if (factor.includes('FuzzyLogic')) metaLearner.updateWeights('fuzzyLogic', pred.isCorrect, pred.confidence);
        if (factor.includes('Bayesian')) metaLearner.updateWeights('bayesian', pred.isCorrect, pred.confidence);
        if (factor.includes('PatternMatch')) metaLearner.updateWeights('patternMatch', pred.isCorrect, pred.confidence);
      }
      
      anomalyDetector.learnFromResult(pred.prediction, pred.actual, pred.confidence);
      anomalyDetector.updateTimeWindowStats(pred.actual, new Date(pred.timestamp));
      bayesianInference.updateLikelihood(bayesianInference.getObservationKey(currentData.slice(0,5).map(d=>d.Ket_qua)), pred.actual);
      lstmRecognizer.learn(currentData.slice(0,8).map(d=>d.Ket_qua), pred.actual, pred.isCorrect);
      
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
      console.log('[Load] Learning data loaded');
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
      console.log('[Load] Prediction history loaded');
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

// ==================== MAIN PREDICTION FUNCTION ====================
function calculateSuperPrediction(data, type) {
  const context = { type };
  const ensembleResult = ensembleVoter.vote(data, context);
  
  const timePrediction = anomalyDetector.predictByTimeWindow(new Date());
  if (timePrediction && timePrediction.confidence > 68) {
    if (ensembleResult.confidence < timePrediction.confidence - 5) {
      ensembleResult.prediction = timePrediction.prediction;
      ensembleResult.confidence = timePrediction.confidence;
    }
  }
  
  const biasCorrection = anomalyDetector.getBiasCorrection();
  if (Math.abs(biasCorrection) > 0.08) {
    if (biasCorrection > 0.08 && ensembleResult.prediction === 'Xỉu') {
      ensembleResult.prediction = 'Tài';
      ensembleResult.confidence = Math.min(88, ensembleResult.confidence + 3);
    } else if (biasCorrection < -0.08 && ensembleResult.prediction === 'Tài') {
      ensembleResult.prediction = 'Xỉu';
      ensembleResult.confidence = Math.min(88, ensembleResult.confidence + 3);
    }
  }
  
  const finalConfidence = Math.max(55, Math.min(88, ensembleResult.confidence));
  
  const factors = [];
  if (ensembleResult.details) {
    for (const [name, detail] of Object.entries(ensembleResult.details)) {
      if (detail && detail.confidence) {
        factors.push(`${name}: ${detail.confidence.toFixed(0)}%`);
      }
    }
  }
  
  return {
    prediction: ensembleResult.prediction,
    confidence: finalConfidence,
    factors: factors.slice(0, 8),
    voteCount: ensembleResult.voteCount || 0,
    totalAlgorithms: ensembleResult.totalVoters || 0
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
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | ${result.voteCount}/${result.totalAlgorithms} algos`);
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
        console.log(`[Auto] MD5 ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | ${result.voteCount}/${result.totalAlgorithms} algos`);
      }
    }
    
    if (Math.random() < 0.05) {
      const predictions = learningData.hu.predictions.filter(p => p.verified).slice(0, 30);
      const actuals = predictions.map(p => p.actual);
      const predValues = predictions.map(p => p.prediction);
      geneticAdaptor.evaluateFitness(predValues, actuals);
      geneticAdaptor.evolve();
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
    res.json({ 
      prediction: normalizeResult(result.prediction), 
      confidence: result.confidence, 
      factors: result.factors,
      voteCount: result.voteCount,
      totalAlgorithms: result.totalAlgorithms
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
      voteCount: result.voteCount,
      totalAlgorithms: result.totalAlgorithms
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
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    algorithmWeights: metaLearner.algorithmWeights,
    geneticGeneration: geneticAdaptor.generation,
    lastUpdate: stats.lastUpdate
  });
});

app.get('/lc79-md5/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(2) : 0;
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    algorithmWeights: metaLearner.algorithmWeights,
    geneticGeneration: geneticAdaptor.generation,
    lastUpdate: stats.lastUpdate
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: { predictions: [], totalPredictions: 0, correctPredictions: 0, recentAccuracy: [], streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 }, lastUpdate: null },
    md5: { predictions: [], totalPredictions: 0, correctPredictions: 0, recentAccuracy: [], streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 }, lastUpdate: null }
  };
  monteCarloSimulators = { hu: null, md5: null };
  anomalyDetector = new AnomalyDetector();
  metaLearner = new MetaLearner();
  lstmRecognizer = new LSTMPatternRecognizer();
  fuzzyEngine = new FuzzyLogicEngine();
  bayesianInference = new BayesianInference();
  geneticAdaptor = new GeneticAdaptor();
  trendReversalDetector = new TrendReversalDetector();
  markovChain = new MarkovChainPredictor(2);
  neuralNet = new SimpleNeuralNet();
  setupFullEnsemble();
  saveLearningData();
  res.json({ message: 'All learning data reset' });
});

// ==================== START SERVER ====================
loadLearningData();
loadPredictionHistory();
anomalyDetector.loadAnomalyData();
setupFullEnsemble();

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - SUPER AI v8.0 - 10 ALGORITHMS FULL         ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`🚀 10 THUẬT TOÁN ĐANG CHẠY:\n`);
  console.log(`   1. 🤖 MONTE CARLO    - Chỉ 10 phiên gần nhất, trọng số thời gian`);
  console.log(`   2. 🧠 LSTM           - Nhận diện pattern chuỗi thời gian`);
  console.log(`   3. 🌫️  FUZZY LOGIC    - Xử lý logic mờ linh hoạt`);
  console.log(`   4. 📈 BAYESIAN       - Suy luận xác suất thông minh`);
  console.log(`   5. 📐 PATTERN MATCH  - 7+ pattern khác nhau (2-2, 3-3, 1-2-1, etc)`);
  console.log(`   6. ⚡ ANOMALY BREAK  - Phát hiện điểm bẻ cầu chính xác`);
  console.log(`   7. ⏰ TIME WINDOW    - Học theo khung giờ đặc thù`);
  console.log(`   8. 🔄 TREND REVERSAL - Phát hiện đảo chiều xu hướng`);
  console.log(`   9. 🔗 MARKOV CHAIN   - Xác suất chuyển trạng thái`);
  console.log(`   10. 🧬 NEURAL NET    - Mạng nơ-ron 2 lớp đơn giản\n`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  console.log(`📡 Server: http://0.0.0.0:${PORT}`);
  console.log(`\n📋 ENDPOINTS:`);
  console.log(`   GET /lc79-hu              - Dự đoán Tài Xỉu Hũ`);
  console.log(`   GET /lc79-md5             - Dự đoán Tài Xỉu MD5`);
  console.log(`   GET /lc79-hu/lichsu       - Lịch sử dự đoán Hũ`);
  console.log(`   GET /lc79-md5/lichsu      - Lịch sử dự đoán MD5`);
  console.log(`   GET /lc79-hu/analysis     - Phân tích chi tiết Hũ (xem từng algos)`);
  console.log(`   GET /lc79-md5/analysis    - Phân tích chi tiết MD5`);
  console.log(`   GET /lc79-hu/learning     - Thống kê học tập Hũ`);
  console.log(`   GET /lc79-md5/learning    - Thống kê học tập MD5`);
  console.log(`   GET /reset-learning       - Reset toàn bộ dữ liệu\n`);
});
