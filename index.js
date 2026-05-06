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
const MODEL_WEIGHTS_FILE = 'model_weights.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };

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
    adaptiveThresholds: {},
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
    adaptiveThresholds: {},
    recentAccuracy: []
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.0, 'cau_dao_11': 1.0, 'cau_22': 1.0, 'cau_33': 1.0,
  'cau_121': 1.0, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.0, 'cau_3van1': 1.0, 'cau_be_cau': 1.0, 'cau_chu_ky': 1.0,
  'distribution': 1.0, 'dice_pattern': 1.0, 'sum_trend': 1.0, 'edge_cases': 1.0,
  'momentum': 1.0, 'cau_tu_nhien': 1.0, 'dice_trend_line': 1.0, 'dice_trend_line_md5': 1.0,
  'break_pattern_hu': 1.0, 'break_pattern_md5': 1.0, 'fibonacci': 1.0,
  'resistance_support': 1.0, 'wave': 1.0, 'golden_ratio': 1.0, 'day_gay': 1.0,
  'day_gay_md5': 1.0, 'cau_44': 1.0, 'cau_55': 1.0, 'cau_212': 1.0,
  'cau_1221': 1.0, 'cau_2112': 1.0, 'cau_gap': 1.0, 'cau_ziczac': 1.0,
  'cau_doi': 1.0, 'cau_rong': 1.0, 'smart_bet': 1.0, 'break_pattern_advanced': 1.0,
  'break_streak': 1.0, 'alternating_break': 1.0, 'double_pair_break': 1.0, 'triple_pattern': 1.0
};

// ==================== AI COMPONENTS ====================

// 1. NEURAL PATTERN RECOGNIZER
class NeuralPatternRecognizer {
  constructor() {
    this.patternMemory = [];
    this.longTermMemory = [];
    this.shortTermMemory = [];
  }

  updateMemory(result) {
    this.shortTermMemory.unshift(result);
    if (this.shortTermMemory.length > 20) this.shortTermMemory.pop();
    this.longTermMemory.unshift(result);
    if (this.longTermMemory.length > 500) this.longTermMemory.pop();
  }

  findSimilarSequences(currentSeq, maxMatches = 50) {
    if (this.longTermMemory.length < currentSeq.length + 1) return [];
    const matches = [];
    
    for (let i = 0; i <= this.longTermMemory.length - currentSeq.length - 1; i++) {
      let similarity = 0;
      for (let j = 0; j < currentSeq.length; j++) {
        if (currentSeq[j] === this.longTermMemory[i + j]) similarity++;
      }
      const similarityRate = similarity / currentSeq.length;
      if (similarityRate >= 0.6) {
        matches.push({
          similarity: similarityRate,
          nextResult: this.longTermMemory[i + currentSeq.length],
          position: i
        });
      }
    }
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, maxMatches);
  }

  predict(results) {
    if (results.length < 3) return null;
    const seqLength = Math.min(8, results.length);
    const currentSeq = results.slice(0, seqLength);
    const matches = this.findSimilarSequences(currentSeq, 30);
    if (matches.length === 0) return null;
    
    let taiCount = 0, xiuCount = 0, totalWeight = 0;
    matches.forEach(m => {
      totalWeight += m.similarity;
      if (m.nextResult === 'Tài') taiCount += m.similarity;
      else xiuCount += m.similarity;
    });
    const taiProb = taiCount / totalWeight;
    return {
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      confidence: 50 + Math.abs(taiProb - 0.5) * 70,
      taiProb: taiProb,
      matchesFound: matches.length
    };
  }
}

// 2. TRANSITION MATRIX ANALYZER
class TransitionMatrixAnalyzer {
  constructor() {
    this.matrix = { Tài: { Tài: 0, Xỉu: 0 }, Xỉu: { Tài: 0, Xỉu: 0 } };
    this.history = [];
  }

  update(lastResult, currentResult) {
    if (lastResult && currentResult) {
      this.matrix[lastResult][currentResult]++;
      this.history.push({ from: lastResult, to: currentResult });
      if (this.history.length > 200) this.history.shift();
    }
  }

  predict(lastResult) {
    if (!lastResult) return null;
    const total = this.matrix[lastResult].Tài + this.matrix[lastResult].Xỉu;
    if (total < 5) return null;
    
    const taiProb = this.matrix[lastResult].Tài / total;
    return {
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      confidence: 50 + Math.abs(taiProb - 0.5) * 60,
      taiProb: taiProb,
      sampleSize: total
    };
  }
}

// 3. BREAK POINT DETECTOR
class BreakPointDetector {
  constructor() {
    this.breakHistory = [];
  }

  detect(results) {
    if (results.length < 5) return null;
    
    let streakLength = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streakLength++;
      else break;
    }
    
    if (streakLength >= 4) {
      const breakProb = Math.min(0.8, 0.3 + (streakLength - 3) * 0.1);
      if (breakProb > 0.55) {
        this.breakHistory.push({ streakLength, result: results[0], timestamp: Date.now() });
        return {
          prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
          confidence: 55 + streakLength * 3,
          reason: `Break streak of ${streakLength}`,
          breakProb
        };
      }
    }
    
    let alternatingLength = 1;
    for (let i = 1; i < Math.min(results.length, 12); i++) {
      if (results[i] !== results[i-1]) alternatingLength++;
      else break;
    }
    if (alternatingLength >= 7) {
      return {
        prediction: results[0],
        confidence: 60 + Math.min(15, alternatingLength),
        reason: `Long alternating (${alternatingLength})`,
        breakProb: 0.6
      };
    }
    return null;
  }
}

// 4. TREND ANALYZER
class TrendAnalyzer {
  analyze(results) {
    if (results.length < 10) return null;
    
    const windows = [5, 10, 15];
    const trends = {};
    
    windows.forEach(size => {
      const window = results.slice(0, size);
      const taiCount = window.filter(r => r === 'Tài').length;
      const ratio = taiCount / size;
      trends[`w${size}`] = { taiRatio: ratio, dominant: ratio > 0.55 ? 'Tài' : (ratio < 0.45 ? 'Xỉu' : 'Balanced'), strength: Math.abs(ratio - 0.5) * 2 };
    });
    
    if (trends.w5 && trends.w15) {
      if (trends.w5.taiRatio > 0.6 && trends.w15.taiRatio < 0.5) {
        return { prediction: 'Xỉu', confidence: 65, name: 'Trend Reversal (Tai→Xiu)' };
      }
      if (trends.w5.taiRatio < 0.4 && trends.w15.taiRatio > 0.5) {
        return { prediction: 'Tài', confidence: 65, name: 'Trend Reversal (Xiu→Tai)' };
      }
      if (trends.w5.dominant === trends.w15.dominant && trends.w5.strength > 0.3) {
        return { prediction: trends.w5.dominant, confidence: 55 + trends.w5.strength * 15, name: 'Trend Continuation' };
      }
    }
    return null;
  }

  analyzeCounter(results) {
    if (results.length < 8) return null;
    const last8 = results.slice(0, 8);
    const taiCount = last8.filter(r => r === 'Tài').length;
    
    if (taiCount >= 6) return { prediction: 'Xỉu', confidence: 60 + (taiCount - 5) * 5, name: 'Counter-Trend (Tai extreme)' };
    if (taiCount <= 2) return { prediction: 'Tài', confidence: 60 + (3 - taiCount) * 5, name: 'Counter-Trend (Xiu extreme)' };
    
    let zigzagCount = 0;
    for (let i = 2; i < Math.min(results.length, 10); i++) {
      if (results[i-2] !== results[i-1] && results[i-1] !== results[i] && results[i-2] === results[i]) zigzagCount++;
    }
    if (zigzagCount >= 3) {
      return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 62, name: 'Zigzag Pattern' };
    }
    return null;
  }
}

// 5. ADAPTIVE WEIGHTED ENSEMBLE
class AdaptiveWeightedEnsemble {
  constructor() {
    this.modelWeights = {
      neural: 1.0, transition: 1.0, breakPoint: 1.0, trend: 1.0, counterTrend: 1.0,
      cauBet: 1.0, cauDao11: 1.0, cau22: 1.0, cau33: 1.0, cau121: 1.0,
      cauNhayCoc: 1.0, cau3Van1: 1.0, cauBeCau: 1.0, cyclePattern: 1.0,
      smartBet: 1.0, momentum: 1.0, edgeCases: 1.0, distribution: 1.0,
      dicePattern: 1.0, sumTrend: 1.0, monteCarlo: 1.0
    };
    this.performanceHistory = [];
    this.consecutiveLosses = 0;
    this.biasCorrection = { tai: 0, xiu: 0 };
  }

  updateWeights(modelPredictions, actualResult) {
    for (const [model, prediction] of Object.entries(modelPredictions)) {
      if (this.modelWeights[model] !== undefined) {
        const isCorrect = prediction === actualResult;
        if (isCorrect) this.modelWeights[model] = Math.min(1.5, this.modelWeights[model] * 1.03);
        else this.modelWeights[model] = Math.max(0.4, this.modelWeights[model] * 0.97);
      }
    }
    this.saveWeights();
  }

  recordResult(isCorrect, prediction, actual) {
    if (isCorrect) {
      if (this.consecutiveLosses > 0) this.consecutiveLosses = 0;
      this.consecutiveLosses--;
      if (this.biasCorrection[prediction === 'Tài' ? 'tai' : 'xiu'] > 0) {
        this.biasCorrection[prediction === 'Tài' ? 'tai' : 'xiu'] = Math.max(0, this.biasCorrection[prediction === 'Tài' ? 'tai' : 'xiu'] - 0.05);
      }
    } else {
      if (this.consecutiveLosses < 0) this.consecutiveLosses = 0;
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= 3) {
        this.biasCorrection[actual === 'Tài' ? 'tai' : 'xiu'] += 0.1;
        this.biasCorrection[actual === 'Tài' ? 'xiu' : 'tai'] = Math.max(0, this.biasCorrection[actual === 'Tài' ? 'xiu' : 'tai'] - 0.05);
      }
    }
    this.performanceHistory.push({ isCorrect, timestamp: Date.now() });
    if (this.performanceHistory.length > 200) this.performanceHistory.shift();
  }

  getRecentAccuracy() {
    if (this.performanceHistory.length < 20) return 0.5;
    const recent = this.performanceHistory.slice(-30);
    const correctCount = recent.filter(p => p.isCorrect).length;
    return correctCount / recent.length;
  }

  getBiasAdjustedPrediction(prediction) {
    if (this.biasCorrection.tai > 0.15 && prediction === 'Xỉu') return 'Tài';
    if (this.biasCorrection.xiu > 0.15 && prediction === 'Tài') return 'Xỉu';
    return prediction;
  }

  saveWeights() {
    try { fs.writeFileSync(MODEL_WEIGHTS_FILE, JSON.stringify(this.modelWeights, null, 2)); } catch(e) {}
  }

  loadWeights() {
    try {
      if (fs.existsSync(MODEL_WEIGHTS_FILE)) {
        const loaded = JSON.parse(fs.readFileSync(MODEL_WEIGHTS_FILE, 'utf8'));
        this.modelWeights = { ...this.modelWeights, ...loaded };
      }
    } catch(e) {}
  }
}

// 6. FIXED MONTE CARLO SIMULATOR
class FixedMonteCarloSimulator {
  constructor(historicalData, windowSize = 30) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.numSimulations = 5000;
    this.diceProbabilities = this.calculateDiceProbabilities(historicalData);
  }

  calculateDiceProbabilities(data) {
    const diceCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    let total = 0;
    for (const item of data) {
      [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3].forEach(dice => { diceCounts[dice]++; total++; });
    }
    const probs = {};
    for (let i = 1; i <= 6; i++) probs[i] = total > 0 ? diceCounts[i] / total : 1/6;
    return probs;
  }

  simulateDiceRoll() {
    const rand = Math.random();
    let cumulative = 0;
    for (let i = 1; i <= 6; i++) {
      cumulative += this.diceProbabilities[i];
      if (rand < cumulative) return i;
    }
    return Math.floor(Math.random() * 6) + 1;
  }

  simulateSession() {
    const d1 = this.simulateDiceRoll(), d2 = this.simulateDiceRoll(), d3 = this.simulateDiceRoll();
    const sum = d1 + d2 + d3;
    return { result: sum >= 11 ? 'Tài' : 'Xỉu', sum };
  }

  findSimilarWindows(currentWindow) {
    const currentResults = currentWindow.map(d => d.Ket_qua);
    const matches = [];
    for (let i = 0; i <= this.historicalData.length - this.windowSize - 1; i++) {
      const histWindow = this.historicalData.slice(i, i + this.windowSize);
      const histResults = histWindow.map(d => d.Ket_qua);
      let similarity = 0;
      for (let j = 0; j < this.windowSize; j++) {
        if (currentResults[j] === histResults[j]) similarity++;
      }
      const similarityRate = similarity / this.windowSize;
      if (similarityRate > 0.55) {
        matches.push({ similarity: similarityRate, nextResult: this.historicalData[i + this.windowSize]?.Ket_qua });
      }
    }
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, 100);
  }

  runSimulation(currentData) {
    if (this.historicalData.length < this.windowSize + 5) {
      let taiCount = 0;
      for (let i = 0; i < this.numSimulations; i++) {
        if (this.simulateSession().result === 'Tài') taiCount++;
      }
      const taiProb = taiCount / this.numSimulations;
      return { prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu', confidence: 50 + Math.abs(taiProb - 0.5) * 60, taiProbability: taiProb, method: 'pure_dice' };
    }
    
    const currentWindow = currentData.slice(0, this.windowSize);
    const similarWindows = this.findSimilarWindows(currentWindow);
    let taiCount = 0, xiuCount = 0;
    
    for (let sim = 0; sim < this.numSimulations * 0.6; sim++) {
      if (similarWindows.length === 0) break;
      const randomMatch = similarWindows[Math.floor(Math.random() * similarWindows.length)];
      if (randomMatch.nextResult === 'Tài') taiCount++; else xiuCount++;
    }
    for (let sim = 0; sim < this.numSimulations * 0.4; sim++) {
      if (this.simulateSession().result === 'Tài') taiCount++; else xiuCount++;
    }
    
    const total = taiCount + xiuCount;
    const taiProb = taiCount / total;
    return {
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      confidence: 50 + Math.abs(taiProb - 0.5) * 75,
      taiProbability: taiProb,
      method: 'hybrid',
      similarCount: similarWindows.length,
      simulations: total
    };
  }
}

// ==================== ALL PATTERN ANALYSIS FUNCTIONS (FULL) ====================

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  let streakType = results[0], streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 3) {
    const weight = getPatternWeight(type, 'cau_bet');
    const shouldBreak = streakLength >= 5;
    return { detected: true, prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType, confidence: Math.round((shouldBreak ? Math.min(12, streakLength * 2) : Math.min(15, streakLength * 3)) * weight), name: `Cầu Bệt ${streakLength} phiên`, patternId: 'cau_bet' };
  }
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) alternatingLength++;
    else break;
  }
  if (alternatingLength >= 4) {
    const weight = getPatternWeight(type, 'cau_dao_11');
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(Math.min(14, alternatingLength * 2 + 4) * weight), name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`, patternId: 'cau_dao_11' };
  }
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  let pairCount = 0, i = 0, pattern = [];
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) { pattern.push(results[i]); pairCount++; i += 2; }
    else break;
  }
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) { if (pattern[j] === pattern[j - 1]) { isAlternating = false; break; } }
    if (isAlternating) {
      const weight = getPatternWeight(type, 'cau_22');
      return { detected: true, prediction: pattern[pattern.length - 1] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(Math.min(12, pairCount * 3 + 3) * weight), name: `Cầu 2-2 (${pairCount} cặp)`, patternId: 'cau_22' };
    }
  }
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  let tripleCount = 0, i = 0, pattern = [];
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) { pattern.push(results[i]); tripleCount++; i += 3; }
    else break;
  }
  if (tripleCount >= 1) {
    const weight = getPatternWeight(type, 'cau_33');
    const lastTripleType = pattern[pattern.length - 1];
    const prediction = (results.length % 3 === 0) ? (lastTripleType === 'Tài' ? 'Xỉu' : 'Tài') : lastTripleType;
    return { detected: true, prediction, confidence: Math.round(Math.min(13, tripleCount * 4 + 5) * weight), name: `Cầu 3-3 (${tripleCount} bộ ba)`, patternId: 'cau_33' };
  }
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  const p = results.slice(0, 4);
  if (p[0] !== p[1] && p[1] === p[2] && p[2] !== p[3] && p[0] === p[3]) {
    return { detected: true, prediction: p[0], confidence: Math.round(10 * getPatternWeight(type, 'cau_121')), name: 'Cầu 1-2-1', patternId: 'cau_121' };
  }
  return { detected: false };
}

function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  const first = results[5], nextTwo = results.slice(3, 5), lastThree = results.slice(0, 3);
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first && lastThree.every(r => r === lastThree[0]) && lastThree[0] !== nextTwo[0]) {
    return { detected: true, prediction: first, confidence: Math.round(11 * getPatternWeight(type, 'cau_123')), name: 'Cầu 1-2-3', patternId: 'cau_123' };
  }
  return { detected: false };
}

function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  const first3 = results.slice(3, 6), next2 = results.slice(1, 3), last1 = results[0];
  if (first3.every(r => r === first3[0]) && next2.every(r => r === next2[0]) && first3[0] !== next2[0] && last1 !== next2[0]) {
    return { detected: true, prediction: next2[0], confidence: Math.round(12 * getPatternWeight(type, 'cau_321')), name: 'Cầu 3-2-1', patternId: 'cau_321' };
  }
  return { detected: false };
}

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) skipPattern.push(results[i]);
  if (skipPattern.length >= 3) {
    const weight = getPatternWeight(type, 'cau_nhay_coc');
    if (skipPattern.slice(0, 3).every(r => r === skipPattern[0])) {
      return { detected: true, prediction: skipPattern[0], confidence: Math.round(8 * weight), name: 'Cầu Nhảy Cóc', patternId: 'cau_nhay_coc' };
    }
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) { if (skipPattern[i] === skipPattern[i - 1]) { alternating = false; break; } }
    if (alternating) {
      return { detected: true, prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(7 * weight), name: 'Cầu Nhảy Cóc Đảo', patternId: 'cau_nhay_coc' };
    }
  }
  return { detected: false };
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_nhip_nghieng');
  if (taiCount5 >= 4) return { detected: true, prediction: 'Tài', confidence: Math.round(9 * weight), name: `Cầu Nhịp Nghiêng 5 (${taiCount5}/5 Tài)`, patternId: 'cau_nhip_nghieng' };
  if (taiCount5 <= 1) return { detected: true, prediction: 'Xỉu', confidence: Math.round(9 * weight), name: `Cầu Nhịp Nghiêng 5 (${5 - taiCount5}/5 Xỉu)`, patternId: 'cau_nhip_nghieng' };
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_3van1');
  if (taiCount === 3) return { detected: true, prediction: 'Xỉu', confidence: Math.round(8 * weight), name: 'Cầu 3 Ván 1 (3T-1X)', patternId: 'cau_3van1' };
  if (taiCount === 1) return { detected: true, prediction: 'Tài', confidence: Math.round(8 * weight), name: 'Cầu 3 Ván 1 (3X-1T)', patternId: 'cau_3van1' };
  return { detected: false };
}

function analyzeCauBeCau(results, type) {
  if (results.length < 8) return { detected: false };
  const recentStreak = analyzeCauBet(results, type);
  if (recentStreak.detected && recentStreak.length >= 4) {
    const beforeStreak = results.slice(recentStreak.length, recentStreak.length + 4);
    const previousPattern = analyzeCauBet(beforeStreak, type);
    if (previousPattern.detected && previousPattern.type !== recentStreak.type) {
      return { detected: true, prediction: recentStreak.type === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(11 * getPatternWeight(type, 'cau_be_cau')), name: 'Cầu Bẻ Cầu', patternId: 'cau_be_cau' };
    }
  }
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  return { detected: true, prediction: results[0], confidence: Math.round(5 * getPatternWeight(type, 'cau_tu_nhien')), name: 'Cầu Tự Nhiên', patternId: 'cau_tu_nhien' };
}

function detectCyclePattern(results, type) {
  if (results.length < 12) return { detected: false };
  for (let cycleLen = 2; cycleLen <= 6; cycleLen++) {
    let isRepeating = true;
    const pattern = results.slice(0, cycleLen);
    for (let i = cycleLen; i < Math.min(cycleLen * 3, results.length); i++) {
      if (results[i] !== pattern[i % cycleLen]) { isRepeating = false; break; }
    }
    if (isRepeating) {
      return { detected: true, prediction: pattern[results.length % cycleLen], confidence: Math.round(9 * getPatternWeight(type, 'cau_chu_ky')), name: `Cầu Chu Kỳ ${cycleLen}`, patternId: 'cau_chu_ky' };
    }
  }
  return { detected: false };
}

function analyzeCau44(results, type) {
  if (results.length < 8) return { detected: false };
  let quadCount = 0, i = 0, pattern = [];
  while (i < results.length - 3) {
    if (results[i] === results[i+1] && results[i+1] === results[i+2] && results[i+2] === results[i+3]) {
      pattern.push(results[i]); quadCount++; i += 4;
    } else break;
  }
  if (quadCount >= 1) {
    const lastQuadType = pattern[pattern.length - 1];
    const prediction = (results.length - quadCount * 4) >= 3 ? (lastQuadType === 'Tài' ? 'Xỉu' : 'Tài') : lastQuadType;
    return { detected: true, prediction, confidence: Math.round(Math.min(14, quadCount * 4 + 6) * getPatternWeight(type, 'cau_44')), name: `Cầu 4-4 (${quadCount} bộ)`, patternId: 'cau_44' };
  }
  return { detected: false };
}

function analyzeCau55(results, type) {
  if (results.length < 10) return { detected: false };
  let quintCount = 0, i = 0, pattern = [];
  while (i < results.length - 4) {
    if (results[i] === results[i+1] && results[i+1] === results[i+2] && results[i+2] === results[i+3] && results[i+3] === results[i+4]) {
      pattern.push(results[i]); quintCount++; i += 5;
    } else break;
  }
  if (quintCount >= 1) {
    const lastQuintType = pattern[pattern.length - 1];
    const prediction = (results.length - quintCount * 5) >= 4 ? (lastQuintType === 'Tài' ? 'Xỉu' : 'Tài') : lastQuintType;
    return { detected: true, prediction, confidence: Math.round(Math.min(15, quintCount * 5 + 7) * getPatternWeight(type, 'cau_55')), name: `Cầu 5-5 (${quintCount} bộ)`, patternId: 'cau_55' };
  }
  return { detected: false };
}

function analyzeCau212(results, type) {
  if (results.length < 5) return { detected: false };
  const p = results.slice(0, 5);
  if (p[0] === p[1] && p[1] !== p[2] && p[2] === p[3] && p[3] === p[4] && p[0] !== p[2]) {
    return { detected: true, prediction: p[0], confidence: Math.round(11 * getPatternWeight(type, 'cau_212')), name: 'Cầu 2-1-2', patternId: 'cau_212' };
  }
  if (p[0] !== p[1] && p[1] !== p[2] && p[0] === p[2] && p[2] !== p[3] && p[3] === p[4]) {
    return { detected: true, prediction: p[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(10 * getPatternWeight(type, 'cau_212')), name: 'Cầu 2-1-2 Đảo', patternId: 'cau_212' };
  }
  return { detected: false };
}

function analyzeCau1221(results, type) {
  if (results.length < 6) return { detected: false };
  const p = results.slice(0, 6);
  if (p[0] !== p[1] && p[1] === p[2] && p[2] === p[3] && p[3] !== p[4] && p[4] === p[5] && p[0] !== p[1]) {
    return { detected: true, prediction: p[0], confidence: Math.round(12 * getPatternWeight(type, 'cau_1221')), name: 'Cầu 1-2-2-1', patternId: 'cau_1221' };
  }
  if (p[0] !== p[1] && p[1] === p[2] && p[2] !== p[3] && p[3] === p[4] && p[4] !== p[5]) {
    return { detected: true, prediction: p[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(11 * getPatternWeight(type, 'cau_1221')), name: 'Cầu 1-2-1-2-1', patternId: 'cau_1221' };
  }
  return { detected: false };
}

function analyzeCau2112(results, type) {
  if (results.length < 6) return { detected: false };
  const p = results.slice(0, 6);
  if (p[0] === p[1] && p[1] !== p[2] && p[2] === p[3] && p[3] !== p[4] && p[4] === p[5] && p[0] !== p[2]) {
    return { detected: true, prediction: p[0], confidence: Math.round(11 * getPatternWeight(type, 'cau_2112')), name: 'Cầu 2-1-1-2', patternId: 'cau_2112' };
  }
  return { detected: false };
}

function analyzeCauGap(results, type) {
  if (results.length < 6) return { detected: false };
  for (let gap = 2; gap <= 3; gap++) {
    let patternFound = true;
    const refType = results[0];
    for (let i = 0; i < Math.min(results.length, 12); i += (gap + 1)) {
      if (results[i] !== refType) { patternFound = false; break; }
    }
    if (patternFound) {
      return { detected: true, prediction: refType, confidence: Math.round(9 * getPatternWeight(type, 'cau_gap')), name: `Cầu Gấp ${gap + 1}`, patternId: 'cau_gap' };
    }
  }
  return { detected: false };
}

function analyzeCauZiczac(results, type) {
  if (results.length < 8) return { detected: false };
  let zigzagCount = 0;
  for (let i = 0; i < results.length - 2; i++) {
    if (results[i] !== results[i+1] && results[i+1] !== results[i+2] && results[i] === results[i+2]) zigzagCount++;
    else break;
  }
  if (zigzagCount >= 3) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(Math.min(13, zigzagCount * 2 + 5) * getPatternWeight(type, 'cau_ziczac')), name: `Cầu Ziczac (${zigzagCount} lần)`, patternId: 'cau_ziczac' };
  }
  return { detected: false };
}

function analyzeCauDoi(results, type) {
  if (results.length < 4) return { detected: false };
  let pairChanges = 0, i = 0;
  while (i < results.length - 1) {
    if (results[i] === results[i + 1]) { pairChanges++; i += 2; }
    else break;
  }
  if (pairChanges >= 2) {
    const isAlternating = results[0] !== results[2];
    if (isAlternating) {
      return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(Math.min(12, pairChanges * 3 + 4) * getPatternWeight(type, 'cau_doi')), name: `Cầu Đôi Đảo (${pairChanges} cặp)`, patternId: 'cau_doi' };
    } else {
      return { detected: true, prediction: results[0], confidence: Math.round(Math.min(11, pairChanges * 2 + 5) * getPatternWeight(type, 'cau_doi')), name: `Cầu Đôi Bệt (${pairChanges} cặp)`, patternId: 'cau_doi' };
    }
  }
  return { detected: false };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streakLength++;
    else break;
  }
  if (streakLength >= 6) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(Math.min(16, streakLength + 8) * getPatternWeight(type, 'cau_rong')), name: `Cầu Rồng ${streakLength} phiên`, patternId: 'cau_rong' };
  }
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  const last10 = results.slice(0, 10), last5 = results.slice(0, 5), prev5 = results.slice(5, 10);
  const taiLast5 = last5.filter(r => r === 'Tài').length, taiPrev5 = prev5.filter(r => r === 'Tài').length;
  if ((taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4)) {
    return { detected: true, prediction: taiLast5 >= 4 ? 'Xỉu' : 'Tài', confidence: Math.round(13 * getPatternWeight(type, 'smart_bet')), name: `Đảo Xu Hướng`, patternId: 'smart_bet' };
  }
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    return { detected: true, prediction: taiLast10 >= 8 ? 'Xỉu' : 'Tài', confidence: Math.round(12 * getPatternWeight(type, 'smart_bet')), name: `Xu Hướng Cực`, patternId: 'smart_bet' };
  }
  return { detected: false };
}

function analyzeMomentumPattern(data, type) {
  if (data.length < 10) return { detected: false };
  const sums = data.slice(0, 10).map(d => d.Tong);
  let momentum = 0;
  for (let i = 0; i < sums.length - 1; i++) momentum += (sums[i] - sums[i + 1]);
  const avgMomentum = momentum / (sums.length - 1);
  if (Math.abs(avgMomentum) > 2) {
    return { detected: true, prediction: avgMomentum > 0 ? 'Tài' : 'Xỉu', confidence: Math.round((10 + Math.min(Math.abs(avgMomentum), 5)) * getPatternWeight(type, 'momentum')), name: `Momentum ${Math.abs(avgMomentum) > 3 ? 'mạnh' : 'vừa'}`, patternId: 'momentum' };
  }
  return { detected: false };
}

function analyzeEdgeCases(data, type) {
  if (data.length < 10) return { detected: false };
  const recentTotals = data.slice(0, 10).map(d => d.Tong);
  const extremeHigh = recentTotals.filter(t => t >= 14).length;
  const extremeLow = recentTotals.filter(t => t <= 7).length;
  if (extremeHigh >= 4) return { detected: true, prediction: 'Xỉu', confidence: Math.round(7 * getPatternWeight(type, 'edge_cases')), name: `Cực Điểm Cao`, patternId: 'edge_cases' };
  if (extremeLow >= 4) return { detected: true, prediction: 'Tài', confidence: Math.round(7 * getPatternWeight(type, 'edge_cases')), name: `Cực Điểm Thấp`, patternId: 'edge_cases' };
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  return { imbalance: Math.abs(taiCount - (window.length - taiCount)) / window.length, taiPercent: (taiCount / window.length) * 100 };
}

function analyzeDicePatterns(data) {
  const sums = data.slice(0, 15).map(d => d.Tong);
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  return { averageSum: avgSum };
}

function analyzeSumTrend(data) {
  const sums = data.slice(0, 20).map(d => d.Tong);
  let increasing = 0, decreasing = 0;
  for (let i = 0; i < sums.length - 1; i++) {
    if (sums[i] > sums[i+1]) decreasing++;
    else if (sums[i] < sums[i+1]) increasing++;
  }
  return { trend: increasing > decreasing ? 'increasing' : 'decreasing', strength: Math.abs(increasing - decreasing) / (sums.length - 1) };
}

function analyzeBreakPatternAdvanced(results, type) {
  if (results.length < 6) return { detected: false };
  const p = results.slice(0, 6);
  if (p[0] !== p[1] && p[1] !== p[2] && p[2] === p[3] && p[3] === p[4] && p[4] !== p[5]) {
    return { detected: true, prediction: p[2] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(14 * (getPatternWeight(type, 'break_pattern_advanced') || 1)), name: 'Cầu 1-1-2-2-1', patternId: 'break_pattern_advanced' };
  }
  if (p[0] === p[1] && p[1] === p[2] && p[2] !== p[3] && p[3] !== p[4] && p[0] !== p[3]) {
    return { detected: true, prediction: p[3], confidence: Math.round(13 * (getPatternWeight(type, 'break_pattern_advanced') || 1)), name: 'Cầu 2-2-1-1', patternId: 'break_pattern_advanced' };
  }
  return { detected: false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 5) return { detected: false };
  let streakType = results[0], streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 5) {
    return { detected: true, prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round((12 + streakLength) * (getPatternWeight(type, 'break_streak') || 1)), name: `Bẻ Chuỗi ${streakLength}`, patternId: 'break_streak' };
  }
  return { detected: false };
}

function analyzeAlternatingBreak(results, type) {
  if (results.length < 6) return { detected: false };
  let altCount = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] !== results[i+1]) altCount++;
    else break;
  }
  if (altCount >= 6) {
    return { detected: true, prediction: altCount >= 9 ? (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : results[0], confidence: Math.round((13 + altCount - 5) * (getPatternWeight(type, 'alternating_break') || 1)), name: `Bẻ Đảo ${altCount} phiên`, patternId: 'alternating_break' };
  }
  return { detected: false };
}

function analyzeDoublePairBreak(results, type) {
  if (results.length < 8) return { detected: false };
  const pairs = [results[0]===results[1], results[2]===results[3], results[4]===results[5], results[6]===results[7]];
  if (pairs.every(p => p === true)) {
    if (results[0] === results[2] && results[2] === results[4] && results[4] === results[6]) {
      return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(16 * (getPatternWeight(type, 'double_pair_break') || 1)), name: '4 Cặp Cùng', patternId: 'double_pair_break' };
    }
  }
  return { detected: false };
}

function analyzeTriplePattern(results, type) {
  if (results.length < 9) return { detected: false };
  const t1 = results[0]===results[1]&&results[1]===results[2];
  const t2 = results[3]===results[4]&&results[4]===results[5];
  const t3 = results[6]===results[7]&&results[7]===results[8];
  if (t1 && t2 && t3 && results[0] === results[3] && results[3] === results[6]) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: Math.round(17 * (getPatternWeight(type, 'triple_pattern') || 1)), name: '3 Bộ Ba Cùng', patternId: 'triple_pattern' };
  }
  return { detected: false };
}

// ==================== LEARNING SYSTEM FUNCTIONS ====================

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternStats[pattern]) {
      learningData[type].patternStats[pattern] = { total: 0, correct: 0, accuracy: 0.5, recentResults: [], lastAdjustment: null };
    }
  });
}

function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  return learningData[type].patternWeights[patternId] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  stats.total++;
  if (isCorrect) stats.correct++;
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 20) stats.recentResults.shift();
  const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  const oldWeight = learningData[type].patternWeights[patternId];
  let newWeight = oldWeight;
  if (stats.recentResults.length >= 5) {
    if (recentAcc > 0.6) newWeight = Math.min(2.0, oldWeight * 1.05);
    else if (recentAcc < 0.4) newWeight = Math.max(0.3, oldWeight * 0.95);
  }
  learningData[type].patternWeights[patternId] = newWeight;
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22', 'Cầu 3-3': 'cau_33',
    'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123', 'Cầu 3-2-1': 'cau_321', 'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng', 'Cầu 3 Ván 1': 'cau_3van1', 'Cầu Bẻ Cầu': 'cau_be_cau',
    'Cầu Chu Kỳ': 'cau_chu_ky', 'Phân bố': 'distribution', 'Tổng TB': 'dice_pattern', 'Xu hướng': 'sum_trend',
    'Cực Điểm': 'edge_cases', 'Biến động': 'momentum', 'Cầu Tự Nhiên': 'cau_tu_nhien'
  };
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}

// ==================== GLOBAL AI INSTANCES ====================
let neuralRecognizers = { hu: new NeuralPatternRecognizer(), md5: new NeuralPatternRecognizer() };
let transitionAnalyzers = { hu: new TransitionMatrixAnalyzer(), md5: new TransitionMatrixAnalyzer() };
let breakDetectors = { hu: new BreakPointDetector(), md5: new BreakPointDetector() };
let trendAnalyzers = { hu: new TrendAnalyzer(), md5: new TrendAnalyzer() };
let ensembles = { hu: new AdaptiveWeightedEnsemble(), md5: new AdaptiveWeightedEnsemble() };
let monteCarloSimulators = { hu: null, md5: null };

function updateMonteCarloSimulators(type, data) {
  if (data && data.length >= 50) {
    monteCarloSimulators[type] = new FixedMonteCarloSimulator(data, 25);
  }
}

// ==================== COMBINED SUPER PREDICTION ====================

function calculateSuperPrediction(data, type) {
  const results = data.slice(0, 40).map(d => d.Ket_qua);
  const lastResult = results.length > 0 ? results[0] : null;
  
  // Update AI memories
  for (let i = results.length - 1; i >= 0; i--) {
    neuralRecognizers[type].updateMemory(results[i]);
    if (i < results.length - 1) {
      transitionAnalyzers[type].update(results[i+1], results[i]);
    }
  }
  
  const modelPredictions = {};
  const factors = [];
  let allPredictions = [];
  
  // 1. Neural Pattern Recognition
  const neuralPred = neuralRecognizers[type].predict(results);
  if (neuralPred) {
    modelPredictions.neural = neuralPred.prediction;
    allPredictions.push({ prediction: neuralPred.prediction, confidence: neuralPred.confidence, priority: 9, name: 'Neural Pattern', weight: ensembles[type].modelWeights.neural });
    factors.push(`🧠 Neural: ${neuralPred.prediction} (${neuralPred.confidence}%, ${neuralPred.matchesFound} matches)`);
  }
  
  // 2. Transition Matrix Analysis
  const transPred = transitionAnalyzers[type].predict(lastResult);
  if (transPred) {
    modelPredictions.transition = transPred.prediction;
    allPredictions.push({ prediction: transPred.prediction, confidence: transPred.confidence, priority: 8, name: 'Transition Matrix', weight: ensembles[type].modelWeights.transition });
    factors.push(`🔄 Transition: ${transPred.prediction} (${transPred.confidence}%, n=${transPred.sampleSize})`);
  }
  
  // 3. Break Point Detection
  const breakPred = breakDetectors[type].detect(results);
  if (breakPred) {
    modelPredictions.breakPoint = breakPred.prediction;
    allPredictions.push({ prediction: breakPred.prediction, confidence: breakPred.confidence, priority: 10, name: 'Break Point', weight: ensembles[type].modelWeights.breakPoint });
    factors.push(`⚡ Break: ${breakPred.prediction} (${breakPred.reason})`);
  }
  
  // 4. Trend Analysis
  const trendPred = trendAnalyzers[type].analyze(results);
  if (trendPred) {
    modelPredictions.trend = trendPred.prediction;
    allPredictions.push({ prediction: trendPred.prediction, confidence: trendPred.confidence, priority: 7, name: trendPred.name, weight: ensembles[type].modelWeights.trend });
    factors.push(`📈 Trend: ${trendPred.prediction} (${trendPred.confidence}%)`);
  }
  
  // 5. Counter-Trend Analysis
  const counterPred = trendAnalyzers[type].analyzeCounter(results);
  if (counterPred) {
    modelPredictions.counterTrend = counterPred.prediction;
    allPredictions.push({ prediction: counterPred.prediction, confidence: counterPred.confidence, priority: 8, name: counterPred.name, weight: ensembles[type].modelWeights.counterTrend });
    factors.push(`🔄 Counter: ${counterPred.prediction} (${counterPred.confidence}%)`);
  }
  
  // 6-30. ALL PATTERN ANALYSES
  const patterns = [
    { fn: () => analyzeCauBet(results, type), name: 'Cầu Bệt', key: 'cauBet' },
    { fn: () => analyzeCauDao11(results, type), name: 'Cầu Đảo 1-1', key: 'cauDao11' },
    { fn: () => analyzeCau22(results, type), name: 'Cầu 2-2', key: 'cau22' },
    { fn: () => analyzeCau33(results, type), name: 'Cầu 3-3', key: 'cau33' },
    { fn: () => analyzeCau121(results, type), name: 'Cầu 1-2-1', key: 'cau121' },
    { fn: () => analyzeCauNhayCoc(results, type), name: 'Cầu Nhảy Cóc', key: 'cauNhayCoc' },
    { fn: () => analyzeCau3Van1(results, type), name: 'Cầu 3 Ván 1', key: 'cau3Van1' },
    { fn: () => analyzeCauBeCau(results, type), name: 'Cầu Bẻ Cầu', key: 'cauBeCau' },
    { fn: () => detectCyclePattern(results, type), name: 'Cầu Chu Kỳ', key: 'cyclePattern' },
    { fn: () => analyzeCau44(results, type), name: 'Cầu 4-4', key: 'cau44' },
    { fn: () => analyzeCau55(results, type), name: 'Cầu 5-5', key: 'cau55' },
    { fn: () => analyzeCau212(results, type), name: 'Cầu 2-1-2', key: 'cau212' },
    { fn: () => analyzeCau1221(results, type), name: 'Cầu 1-2-2-1', key: 'cau1221' },
    { fn: () => analyzeCau2112(results, type), name: 'Cầu 2-1-1-2', key: 'cau2112' },
    { fn: () => analyzeCauGap(results, type), name: 'Cầu Gấp', key: 'cauGap' },
    { fn: () => analyzeCauZiczac(results, type), name: 'Cầu Ziczac', key: 'cauZiczac' },
    { fn: () => analyzeCauDoi(results, type), name: 'Cầu Đôi', key: 'cauDoi' },
    { fn: () => analyzeCauRong(results, type), name: 'Cầu Rồng', key: 'cauRong' },
    { fn: () => analyzeSmartBet(results, type), name: 'Smart Bet', key: 'smartBet' },
    { fn: () => analyzeMomentumPattern(data, type), name: 'Momentum', key: 'momentum' },
    { fn: () => analyzeEdgeCases(data, type), name: 'Edge Cases', key: 'edgeCases' },
    { fn: () => analyzeBreakPatternAdvanced(results, type), name: 'Break Advanced', key: 'breakAdvanced' },
    { fn: () => analyzeBreakStreak(results, type), name: 'Break Streak', key: 'breakStreak' },
    { fn: () => analyzeAlternatingBreak(results, type), name: 'Alternating Break', key: 'alternatingBreak' },
    { fn: () => analyzeDoublePairBreak(results, type), name: 'Double Pair Break', key: 'doublePairBreak' },
    { fn: () => analyzeTriplePattern(results, type), name: 'Triple Pattern', key: 'triplePattern' }
  ];
  
  for (const pattern of patterns) {
    const result = pattern.fn();
    if (result && result.detected) {
      modelPredictions[pattern.key] = result.prediction;
      allPredictions.push({ prediction: result.prediction, confidence: result.confidence, priority: 7, name: result.name, weight: ensembles[type].modelWeights[pattern.key] || 1.0 });
      factors.push(`📊 ${result.name}: ${result.prediction} (${result.confidence}%)`);
    }
  }
  
  // Distribution, Dice, Sum Trend
  const dist = analyzeDistribution(data, type);
  if (dist.imbalance > 0.2) {
    const minority = dist.taiPercent < 50 ? 'Tài' : 'Xỉu';
    modelPredictions.distribution = minority;
    allPredictions.push({ prediction: minority, confidence: 60, priority: 5, name: 'Phân bố lệch', weight: ensembles[type].modelWeights.distribution });
    factors.push(`📊 Phân bố: ${minority} (T:${dist.taiPercent.toFixed(0)}%)`);
  }
  
  const dice = analyzeDicePatterns(data);
  if (dice.averageSum > 11.5) {
    modelPredictions.dicePattern = 'Xỉu';
    allPredictions.push({ prediction: 'Xỉu', confidence: 58, priority: 4, name: 'Tổng TB cao', weight: ensembles[type].modelWeights.dicePattern });
    factors.push(`🎲 Tổng TB: ${dice.averageSum.toFixed(1)} → Xỉu`);
  } else if (dice.averageSum < 9.5) {
    modelPredictions.dicePattern = 'Tài';
    allPredictions.push({ prediction: 'Tài', confidence: 58, priority: 4, name: 'Tổng TB thấp', weight: ensembles[type].modelWeights.dicePattern });
    factors.push(`🎲 Tổng TB: ${dice.averageSum.toFixed(1)} → Tài`);
  }
  
  const sumTrend = analyzeSumTrend(data);
  if (sumTrend.strength > 0.4) {
    const trendPred = sumTrend.trend === 'increasing' ? 'Tài' : 'Xỉu';
    modelPredictions.sumTrend = trendPred;
    allPredictions.push({ prediction: trendPred, confidence: 55, priority: 3, name: 'Xu hướng tổng', weight: ensembles[type].modelWeights.sumTrend });
    factors.push(`📈 Xu hướng tổng: ${trendPred}`);
  }
  
  // 31. FIXED MONTE CARLO
  if (monteCarloSimulators[type]) {
    const mcResult = monteCarloSimulators[type].runSimulation(data);
    if (mcResult) {
      modelPredictions.monteCarlo = mcResult.prediction;
      allPredictions.push({ prediction: mcResult.prediction, confidence: mcResult.confidence, priority: 9, name: 'Monte Carlo', weight: ensembles[type].modelWeights.monteCarlo });
      factors.push(`🎲 Monte Carlo: ${mcResult.prediction} (${mcResult.confidence}%, ${mcResult.method}, ${mcResult.similarCount || 0} similar)`);
    }
  }
  
  // Fallback
  if (allPredictions.length === 0) {
    const fallback = analyzeCauTuNhien(results, type);
    allPredictions.push({ prediction: fallback.prediction, confidence: fallback.confidence, priority: 1, name: fallback.name, weight: 1.0 });
    factors.push(`🔄 Fallback: ${fallback.prediction}`);
  }
  
  // Weighted voting
  allPredictions.sort((a, b) => b.priority - a.priority);
  let taiScore = 0, xiuScore = 0;
  for (const p of allPredictions) {
    const weight = p.weight || 1.0;
    if (p.prediction === 'Tài') taiScore += p.confidence * weight;
    else xiuScore += p.confidence * weight;
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  finalPrediction = ensembles[type].getBiasAdjustedPrediction(finalPrediction);
  
  // Confidence calculation
  const totalScore = taiScore + xiuScore;
  let confidence = totalScore > 0 ? Math.round(Math.max(taiScore, xiuScore) / totalScore * 100) : 55;
  confidence = Math.max(55, Math.min(88, confidence));
  
  return { prediction: finalPrediction, confidence, factors, modelPredictions, allPredictions };
}

// ==================== API FUNCTIONS ====================

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
  if (predictionHistory[type].length > MAX_HISTORY) predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  return record;
}

function recordPrediction(type, phien, prediction, confidence, factors, modelPredictions) {
  const record = {
    phien: phien.toString(),
    prediction, confidence, factors, modelPredictions,
    timestamp: new Date().toISOString(),
    verified: false, actual: null, isCorrect: null
  };
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  if (learningData[type].predictions.length > 500) learningData[type].predictions = learningData[type].predictions.slice(0, 500);
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
      if (learningData[type].recentAccuracy.length > 50) learningData[type].recentAccuracy.shift();
      
      // Update ensemble with result
      ensembles[type].recordResult(pred.isCorrect, pred.prediction, pred.actual);
      if (pred.modelPredictions) {
        ensembles[type].updateWeights(pred.modelPredictions, pred.actual);
      }
      
      // Update pattern stats
      if (pred.factors) {
        for (const factor of pred.factors) {
          const patternId = getPatternIdFromName(factor.split(':')[0]);
          if (patternId) updatePatternPerformance(type, patternId, pred.isCorrect);
        }
      }
      updated = true;
    }
  }
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function saveLearningData() {
  try { fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2)); } catch(e) {}
}

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
      learningData = { ...learningData, ...parsed };
      console.log('Learning data loaded');
    }
  } catch(e) {}
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('Prediction history loaded');
    }
  } catch(e) {}
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ history: predictionHistory, lastProcessedPhien, lastSaved: new Date().toISOString() }, null, 2));
  } catch(e) {}
}

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      updateMonteCarloSimulators('hu', dataHu);
      const nextHuPhien = dataHu[0].Phien + 1;
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateSuperPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors, result.modelPredictions);
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu ${nextHuPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      updateMonteCarloSimulators('md5', dataMd5);
      const nextMd5Phien = dataMd5[0].Phien + 1;
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateSuperPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors, result.modelPredictions);
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 ${nextMd5Phien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    savePredictionHistory();
    saveLearningData();
  } catch(e) { console.error('[Auto] Error:', e.message); }
}

// ==================== EXPRESS ROUTES ====================

app.get('/', (req, res) => res.setHeader('Content-Type', 'text/plain; charset=utf-8').send('kapub - Super AI v3.0'));

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    updateMonteCarloSimulators('hu', data);
    await verifyPredictions('hu', data);
    const result = calculateSuperPrediction(data, 'hu');
    savePredictionToHistory('hu', data[0].Phien + 1, result.prediction, result.confidence);
    recordPrediction('hu', data[0].Phien + 1, result.prediction, result.confidence, result.factors, result.modelPredictions);
    res.json({ phien_hien_tai: (data[0].Phien + 1).toString(), du_doan: normalizeResult(result.prediction), ti_le: `${result.confidence}%`, id: 'kapub' });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    updateMonteCarloSimulators('md5', data);
    await verifyPredictions('md5', data);
    const result = calculateSuperPrediction(data, 'md5');
    savePredictionToHistory('md5', data[0].Phien + 1, result.prediction, result.confidence);
    recordPrediction('md5', data[0].Phien + 1, result.prediction, result.confidence, result.factors, result.modelPredictions);
    res.json({ phien_hien_tai: (data[0].Phien + 1).toString(), du_doan: normalizeResult(result.prediction), ti_le: `${result.confidence}%`, id: 'kapub' });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (data) await verifyPredictions('hu', data);
    const history = predictionHistory.hu.map(r => {
      const p = learningData.hu.predictions.find(p => p.phien === r.phien_hien_tai);
      return { ...r, ket_qua_thuc_te: p?.actual || null, status: p?.isCorrect === true ? '✅' : (p?.isCorrect === false ? '❌' : null) };
    });
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history, total: history.length });
  } catch(e) { res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length }); }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (data) await verifyPredictions('md5', data);
    const history = predictionHistory.md5.map(r => {
      const p = learningData.md5.predictions.find(p => p.phien === r.phien_hien_tai);
      return { ...r, ket_qua_thuc_te: p?.actual || null, status: p?.isCorrect === true ? '✅' : (p?.isCorrect === false ? '❌' : null) };
    });
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history, total: history.length });
  } catch(e) { res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length }); }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    updateMonteCarloSimulators('hu', data);
    await verifyPredictions('hu', data);
    const result = calculateSuperPrediction(data, 'hu');
    res.json({ prediction: normalizeResult(result.prediction), confidence: result.confidence, factors: result.factors, modelWeights: ensembles.hu.modelWeights, modelPredictions: result.modelPredictions });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    updateMonteCarloSimulators('md5', data);
    await verifyPredictions('md5', data);
    const result = calculateSuperPrediction(data, 'md5');
    res.json({ prediction: normalizeResult(result.prediction), confidence: result.confidence, factors: result.factors, modelWeights: ensembles.md5.modelWeights, modelPredictions: result.modelPredictions });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/lc79-hu/learning', (req, res) => {
  const s = learningData.hu;
  const acc = s.totalPredictions > 0 ? (s.correctPredictions / s.totalPredictions * 100).toFixed(2) : 0;
  const recent = s.recentAccuracy.length > 0 ? (s.recentAccuracy.reduce((a,b)=>a+b,0)/s.recentAccuracy.length*100).toFixed(2) : 0;
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ - Learning', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions, overallAccuracy: `${acc}%`, recentAccuracy: `${recent}%`, streakAnalysis: s.streakAnalysis, modelWeights: ensembles.hu.modelWeights, lastUpdate: s.lastUpdate });
});

app.get('/lc79-md5/learning', (req, res) => {
  const s = learningData.md5;
  const acc = s.totalPredictions > 0 ? (s.correctPredictions / s.totalPredictions * 100).toFixed(2) : 0;
  const recent = s.recentAccuracy.length > 0 ? (s.recentAccuracy.reduce((a,b)=>a+b,0)/s.recentAccuracy.length*100).toFixed(2) : 0;
  res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5 - Learning', totalPredictions: s.totalPredictions, correctPredictions: s.correctPredictions, overallAccuracy: `${acc}%`, recentAccuracy: `${recent}%`, streakAnalysis: s.streakAnalysis, modelWeights: ensembles.md5.modelWeights, lastUpdate: s.lastUpdate });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] }
  };
  neuralRecognizers = { hu: new NeuralPatternRecognizer(), md5: new NeuralPatternRecognizer() };
  transitionAnalyzers = { hu: new TransitionMatrixAnalyzer(), md5: new TransitionMatrixAnalyzer() };
  breakDetectors = { hu: new BreakPointDetector(), md5: new BreakPointDetector() };
  trendAnalyzers = { hu: new TrendAnalyzer(), md5: new TrendAnalyzer() };
  ensembles = { hu: new AdaptiveWeightedEnsemble(), md5: new AdaptiveWeightedEnsemble() };
  monteCarloSimulators = { hu: null, md5: null };
  saveLearningData();
  res.json({ message: 'All AI models, learning data, and Monte Carlo reset' });
});

// ==================== START SERVER ====================

loadLearningData();
loadPredictionHistory();
ensembles.hu.loadWeights();
ensembles.md5.loadWeights();

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 5000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - SUPER AI PREDICTION ENGINE v3.0 - FULL CODE             ║`);
  console.log(`║     GIỮ NGUYÊN CODE CŨ + THÊM AI MỚI + MONTE CARLO ĐÃ SỬA                ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════════╝\n`);
  console.log(`🚀 Server: http://0.0.0.0:${PORT}`);
  console.log(`\n🧠 AI COMPONENTS:`);
  console.log(`   1. Neural Pattern Recognition - Tìm mẫu hình tương tự`);
  console.log(`   2. Transition Matrix Analysis - Xác suất chuyển tiếp Tài↔Xỉu`);
  console.log(`   3. Break Point Detection - Phát hiện điểm bẻ cầu`);
  console.log(`   4. Trend Analysis - Phân tích xu hướng đa khung`);
  console.log(`   5. Counter-Trend Detection - Phát hiện đảo chiều`);
  console.log(`   6. Adaptive Weighted Ensemble - Học từ sai lầm, điều chỉnh trọng số`);
  console.log(`   7. Real-time Bias Correction - Tự động sửa bias Tài/Xỉu`);
  console.log(`   8. Fixed Monte Carlo - Simulation thực sự (hybrid: pattern + dice)`);
  console.log(`   + 30+ Pattern Analyses từ code cũ (cầu bệt, đảo, 2-2, 3-3, 1-2-1, v.v...)\n`);
  console.log(`📊 ENDPOINTS:`);
  console.log(`   GET  /lc79-hu           - Dự đoán Tài Xỉu Hũ`);
  console.log(`   GET  /lc79-md5          - Dự đoán Tài Xỉu MD5`);
  console.log(`   GET  /lc79-hu/lichsu    - Lịch sử dự đoán Hũ`);
  console.log(`   GET  /lc79-md5/lichsu   - Lịch sử dự đoán MD5`);
  console.log(`   GET  /lc79-hu/analysis  - Phân tích chi tiết + AI weights`);
  console.log(`   GET  /lc79-md5/analysis - Phân tích chi tiết + AI weights`);
  console.log(`   GET  /lc79-hu/learning  - Thống kê học tập Hũ`);
  console.log(`   GET  /lc79-md5/learning - Thống kê học tập MD5`);
  console.log(`   GET  /reset-learning    - Reset toàn bộ AI models\n`);
});
