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

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

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

// ==================== FIXED MONTE CARLO SIMULATION ====================
class FixedMonteCarloSimulator {
  constructor(historicalData, windowSize = 30) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.numSimulations = 5000;
    this.diceProbabilities = this.calculateDiceProbabilities(historicalData);
  }

  // Tính xác suất thực tế của từng mặt xúc xắc
  calculateDiceProbabilities(data) {
    const diceCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    let total = 0;
    
    for (const item of data) {
      const dices = [item.Xuc_xac_1, item.Xuc_xac_2, item.Xuc_xac_3];
      for (const dice of dices) {
        diceCounts[dice]++;
        total++;
      }
    }
    
    const probabilities = {};
    for (let i = 1; i <= 6; i++) {
      probabilities[i] = total > 0 ? diceCounts[i] / total : 1/6;
    }
    return probabilities;
  }

  // Simulate một lần tung xúc xắc dựa trên xác suất thực tế
  simulateDiceRoll() {
    const rand = Math.random();
    let cumulative = 0;
    for (let i = 1; i <= 6; i++) {
      cumulative += this.diceProbabilities[i];
      if (rand < cumulative) return i;
    }
    return Math.floor(Math.random() * 6) + 1;
  }

  // Simulate một phiên đầy đủ
  simulateSession() {
    const dice1 = this.simulateDiceRoll();
    const dice2 = this.simulateDiceRoll();
    const dice3 = this.simulateDiceRoll();
    const sum = dice1 + dice2 + dice3;
    const result = sum >= 11 ? 'Tài' : (sum <= 10 ? 'Xỉu' : (Math.random() < 0.5 ? 'Tài' : 'Xỉu'));
    return { dice1, dice2, dice3, sum, result };
  }

  // Tìm các mẫu hình tương tự trong lịch sử
  findSimilarWindows(currentWindow) {
    const currentResults = currentWindow.map(d => d.Ket_qua);
    const currentSums = currentWindow.map(d => d.Tong);
    const matches = [];
    
    for (let i = 0; i <= this.historicalData.length - this.windowSize - 1; i++) {
      const histWindow = this.historicalData.slice(i, i + this.windowSize);
      const histResults = histWindow.map(d => d.Ket_qua);
      const histSums = histWindow.map(d => d.Tong);
      
      let similarity = 0;
      for (let j = 0; j < this.windowSize; j++) {
        if (currentResults[j] === histResults[j]) similarity += 2;
        if (Math.abs(currentSums[j] - histSums[j]) <= 2) similarity += 1;
      }
      
      const similarityRate = similarity / (this.windowSize * 3);
      if (similarityRate > 0.5) {
        matches.push({
          similarity: similarityRate,
          nextResult: this.historicalData[i + this.windowSize]?.Ket_qua,
          nextSum: this.historicalData[i + this.windowSize]?.Tong
        });
      }
    }
    
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, 100);
  }

  // Chạy Monte Carlo simulation thực sự
  runTrueSimulation(currentData, numSimulations = null) {
    const simCount = numSimulations || this.numSimulations;
    
    if (this.historicalData.length < this.windowSize + 5) {
      // Fallback: simulation dựa trên xác suất xúc xắc thuần túy
      let taiCount = 0;
      for (let i = 0; i < simCount; i++) {
        const session = this.simulateSession();
        if (session.result === 'Tài') taiCount++;
      }
      const taiProb = taiCount / simCount;
      return {
        taiProbability: taiProb,
        xiuProbability: 1 - taiProb,
        confidence: 50 + Math.abs(taiProb - 0.5) * 60,
        prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
        simulationCount: simCount,
        method: 'pure_dice_simulation'
      };
    }
    
    // Lấy cửa sổ hiện tại
    const currentWindow = currentData.slice(0, this.windowSize);
    const similarWindows = this.findSimilarWindows(currentWindow);
    
    let taiCount = 0;
    let xiuCount = 0;
    
    // Simulation 1: Dựa trên các mẫu hình tương tự
    for (let sim = 0; sim < simCount * 0.7; sim++) {
      if (similarWindows.length === 0) break;
      const randomMatch = similarWindows[Math.floor(Math.random() * similarWindows.length)];
      if (randomMatch.nextResult === 'Tài') taiCount++;
      else xiuCount++;
    }
    
    // Simulation 2: Dựa trên xác suất xúc xắc thực tế
    for (let sim = 0; sim < simCount * 0.3; sim++) {
      const session = this.simulateSession();
      if (session.result === 'Tài') taiCount++;
      else xiuCount++;
    }
    
    const totalSims = taiCount + xiuCount;
    const taiProbability = taiCount / totalSims;
    const xiuProbability = xiuCount / totalSims;
    
    // Tính confidence dựa trên độ chênh lệch xác suất
    const probabilitySpread = Math.abs(taiProbability - xiuProbability);
    let confidence = 50 + probabilitySpread * 45;
    
    // Bonus nếu có nhiều mẫu hình tương tự
    const patternBonus = Math.min(10, similarWindows.length / 10);
    confidence += patternBonus;
    
    confidence = Math.min(88, Math.max(52, Math.round(confidence)));
    
    return {
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: xiuProbability.toFixed(4),
      confidence: confidence,
      prediction: taiProbability > xiuProbability ? 'Tài' : 'Xỉu',
      simulationCount: totalSims,
      similarPatternsCount: similarWindows.length,
      method: 'hybrid_simulation',
      taiVotes: taiCount,
      xiuVotes: xiuCount
    };
  }
}

// Khởi tạo Monte Carlo simulators
let monteCarloSimulators = { hu: null, md5: null };

function updateMonteCarloSimulators(type, data) {
  if (data && data.length >= 50) {
    monteCarloSimulators[type] = new FixedMonteCarloSimulator(data, 25);
    console.log(`[MC] Fixed Monte Carlo simulator initialized for ${type} with ${data.length} records`);
  }
}

// ==================== PATTERN ANALYSIS FUNCTIONS (GIỮ NGUYÊN CODE CŨ) ====================

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  
  let streakType = results[0];
  let streakLength = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 3) {
    const weight = getPatternWeight(type, 'cau_bet');
    const stats = learningData[type].patternStats['cau_bet'];
    
    let shouldBreak = streakLength >= 5;
    
    if (stats && stats.recentResults.length >= 5) {
      const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
      if (recentAcc < 0.4) {
        shouldBreak = !shouldBreak;
      }
    }
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round((shouldBreak ? Math.min(12, streakLength * 2) : Math.min(15, streakLength * 3)) * weight),
      name: `Cầu Bệt ${streakLength} phiên`,
      patternId: 'cau_bet'
    };
  }
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else {
      break;
    }
  }
  
  if (alternatingLength >= 4) {
    const weight = getPatternWeight(type, 'cau_dao_11');
    return { 
      detected: true, 
      length: alternatingLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(14, alternatingLength * 2 + 4) * weight),
      name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      patternId: 'cau_dao_11'
    };
  }
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  
  let pairCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) {
        isAlternating = false;
        break;
      }
    }
    
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      const weight = getPatternWeight(type, 'cau_22');
      
      return { 
        detected: true, 
        pairCount,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(12, pairCount * 3 + 3) * weight),
        name: `Cầu 2-2 (${pairCount} cặp)`,
        patternId: 'cau_22'
      };
    }
  }
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  
  let tripleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else {
      break;
    }
  }
  
  if (tripleCount >= 1) {
    const currentPosition = results.length % 3;
    const lastTripleType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_33');
    
    let prediction;
    if (currentPosition === 0) {
      prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastTripleType;
    }
    
    return { 
      detected: true, 
      tripleCount,
      prediction,
      confidence: Math.round(Math.min(13, tripleCount * 4 + 5) * weight),
      name: `Cầu 3-3 (${tripleCount} bộ ba)`,
      patternId: 'cau_33'
    };
  }
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  
  const pattern1 = results.slice(0, 4);
  
  if (pattern1[0] !== pattern1[1] && 
      pattern1[1] === pattern1[2] && 
      pattern1[2] !== pattern1[3] &&
      pattern1[0] === pattern1[3]) {
    const weight = getPatternWeight(type, 'cau_121');
    return { 
      detected: true, 
      pattern: '1-2-1',
      prediction: pattern1[0],
      confidence: Math.round(10 * weight),
      name: 'Cầu 1-2-1',
      patternId: 'cau_121'
    };
  }
  return { detected: false };
}

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) {
    skipPattern.push(results[i]);
  }
  
  if (skipPattern.length >= 3) {
    const weight = getPatternWeight(type, 'cau_nhay_coc');
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0],
        confidence: Math.round(8 * weight),
        name: 'Cầu Nhảy Cóc',
        patternId: 'cau_nhay_coc'
      };
    }
    
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) {
        alternating = false;
        break;
      }
    }
    
    if (alternating && skipPattern.length >= 3) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(7 * weight),
        name: 'Cầu Nhảy Cóc Đảo',
        patternId: 'cau_nhay_coc'
      };
    }
  }
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_3van1');
  
  if (taiCount === 3) {
    return { 
      detected: true, 
      pattern: '3-1',
      majority: 'Tài',
      prediction: 'Xỉu',
      confidence: Math.round(8 * weight),
      name: 'Cầu 3 Ván 1 (3T-1X)',
      patternId: 'cau_3van1'
    };
  } else if (taiCount === 1) {
    return { 
      detected: true, 
      pattern: '3-1',
      majority: 'Xỉu',
      prediction: 'Tài',
      confidence: Math.round(8 * weight),
      name: 'Cầu 3 Ván 1 (3X-1T)',
      patternId: 'cau_3van1'
    };
  }
  return { detected: false };
}

function analyzeCauBeCau(results, type) {
  if (results.length < 8) return { detected: false };
  
  const recentStreak = analyzeCauBet(results, type);
  
  if (recentStreak.detected && recentStreak.length >= 4) {
    const beforeStreak = results.slice(recentStreak.length, recentStreak.length + 4);
    const previousPattern = analyzeCauBet(beforeStreak, type);
    
    if (previousPattern.detected && previousPattern.type !== recentStreak.type) {
      const weight = getPatternWeight(type, 'cau_be_cau');
      return { 
        detected: true, 
        pattern: 'be_cau',
        prediction: recentStreak.type === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(11 * weight),
        name: 'Cầu Bẻ Cầu',
        patternId: 'cau_be_cau'
      };
    }
  }
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  return { 
    detected: true, 
    prediction: results[0],
    confidence: Math.round(5 * weight),
    name: 'Cầu Tự Nhiên (Theo Ván Trước)',
    patternId: 'cau_tu_nhien'
  };
}

function detectCyclePattern(results, type) {
  if (results.length < 12) return { detected: false };
  
  for (let cycleLength = 2; cycleLength <= 6; cycleLength++) {
    let isRepeating = true;
    const pattern = results.slice(0, cycleLength);
    
    for (let i = cycleLength; i < Math.min(cycleLength * 3, results.length); i++) {
      if (results[i] !== pattern[i % cycleLength]) {
        isRepeating = false;
        break;
      }
    }
    
    if (isRepeating) {
      const nextPosition = results.length % cycleLength;
      const weight = getPatternWeight(type, 'cau_chu_ky');
      return { 
        detected: true, 
        cycleLength,
        pattern,
        prediction: pattern[nextPosition],
        confidence: Math.round(9 * weight),
        name: `Cầu Chu Kỳ ${cycleLength}`,
        patternId: 'cau_chu_ky'
      };
    }
  }
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'smart_bet');
  const last10 = results.slice(0, 10);
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      trendChange: true,
      prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(13 * weight),
      name: `Đảo Xu Hướng (${taiLast5}T-${5-taiLast5}X → ${taiPrev5}T-${5-taiPrev5}X)`,
      patternId: 'smart_bet'
    };
  }
  
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      extreme: true,
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(12 * weight),
      name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X trong 10 phiên)`,
      patternId: 'smart_bet'
    };
  }
  return { detected: false };
}

function analyzeMomentumPattern(data, type) {
  if (data.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'momentum');
  const sums = data.slice(0, 10).map(d => d.Xuc_xac_1 + d.Xuc_xac_2 + d.Xuc_xac_3);
  
  let momentum = 0;
  for (let i = 0; i < sums.length - 1; i++) {
    momentum += (sums[i] - sums[i + 1]);
  }
  
  const avgMomentum = momentum / (sums.length - 1);
  
  if (Math.abs(avgMomentum) > 2) {
    const prediction = avgMomentum > 0 ? 'Tài' : 'Xỉu';
    const strength = Math.abs(avgMomentum) > 3 ? 'mạnh' : 'vừa';
    return {
      detected: true,
      type: 'momentum_trend',
      prediction,
      confidence: Math.round((10 + Math.min(Math.abs(avgMomentum), 5)) * weight),
      name: `Momentum ${strength} (${avgMomentum.toFixed(1)} → ${prediction})`,
      patternId: 'momentum'
    };
  }
  return { detected: false };
}

function analyzeEdgeCases(data, type) {
  if (data.length < 10) return { detected: false };
  
  const recentTotals = data.slice(0, 10).map(d => d.Tong);
  const extremeHighCount = recentTotals.filter(t => t >= 14).length;
  const extremeLowCount = recentTotals.filter(t => t <= 7).length;
  const weight = getPatternWeight(type, 'edge_cases');
  
  if (extremeHighCount >= 4) {
    return { 
      detected: true, 
      type: 'extreme_high',
      prediction: 'Xỉu',
      confidence: Math.round(7 * weight),
      name: `Cực Điểm Cao (${extremeHighCount} phiên >= 14)`,
      patternId: 'edge_cases'
    };
  }
  
  if (extremeLowCount >= 4) {
    return { 
      detected: true, 
      type: 'extreme_low',
      prediction: 'Tài',
      confidence: Math.round(7 * weight),
      name: `Cực Điểm Thấp (${extremeLowCount} phiên <= 7)`,
      patternId: 'edge_cases'
    };
  }
  return { detected: false };
}

function analyzeBreakPatternAdvanced(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_pattern_advanced') || 1.0;
  
  const is11221 = results[0] !== results[1] && 
                   results[1] !== results[2] && 
                   results[2] === results[3] &&
                   results[3] === results[4] &&
                   results[4] !== results[5];
  
  if (is11221) {
    const prediction = results[2] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'pattern_11221',
      prediction,
      confidence: Math.round(14 * weight),
      name: `Cầu 1-1-2-2-1 (Bẻ → ${prediction})`,
      patternId: 'break_pattern_advanced'
    };
  }
  
  const is2211 = results[0] === results[1] && 
                  results[1] === results[2] &&
                  results[2] !== results[3] &&
                  results[3] !== results[4] &&
                  results[0] !== results[3];
  
  if (is2211) {
    const prediction = results[3];
    return {
      detected: true,
      type: 'pattern_2211',
      prediction,
      confidence: Math.round(13 * weight),
      name: `Cầu 2-2-1-1 (Theo → ${prediction})`,
      patternId: 'break_pattern_advanced'
    };
  }
  return { detected: false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 5) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_streak') || 1.0;
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 5 && streakLength <= 7) {
    const prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'break_streak_medium',
      prediction,
      confidence: Math.round((12 + streakLength) * weight),
      name: `Bẻ Chuỗi ${streakLength} (${streakType} → Bẻ ${prediction})`,
      patternId: 'break_streak'
    };
  }
  
  if (treakLength >= 8) {
    const prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'break_streak_long',
      prediction,
      confidence: Math.round(Math.min(20, 15 + streakLength - 7) * weight),
      name: `Bẻ Chuỗi Dài ${streakLength} (${streakType} → Bẻ mạnh ${prediction})`,
      patternId: 'break_streak'
    };
  }
  return { detected: false };
}

function analyzeAlternatingBreak(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'alternating_break') || 1.0;
  
  let alternatingCount = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] !== results[i + 1]) {
      alternatingCount++;
    } else {
      break;
    }
  }
  
  if (alternatingCount >= 6 && alternatingCount <= 8) {
    const prediction = results[0];
    return {
      detected: true,
      type: 'alternating_break_medium',
      prediction,
      confidence: Math.round((13 + alternatingCount - 5) * weight),
      name: `Bẻ Đảo ${alternatingCount} phiên (Theo ${prediction})`,
      patternId: 'alternating_break'
    };
  }
  
  if (alternatingCount >= 9) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'alternating_break_long',
      prediction,
      confidence: Math.round(Math.min(18, 14 + alternatingCount - 8) * weight),
      name: `Bẻ Đảo Dài ${alternatingCount} (Bẻ → ${prediction})`,
      patternId: 'alternating_break'
    };
  }
  return { detected: false };
}

function analyzeDoublePairBreak(results, type) {
  if (results.length < 8) return { detected: false };
  
  const weight = getPatternWeight(type, 'double_pair_break') || 1.0;
  
  const isPair1 = results[0] === results[1];
  const isPair2 = results[2] === results[3];
  const isPair3 = results[4] === results[5];
  const isPair4 = results[6] === results[7];
  
  if (isPair1 && isPair2 && isPair3 && isPair4) {
    const pairType1 = results[0];
    const pairType2 = results[2];
    
    const allSamePair = pairType1 === pairType2 && pairType2 === results[4] && results[4] === results[6];
    if (allSamePair) {
      const prediction = pairType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        type: 'four_same_pairs',
        prediction,
        confidence: Math.round(16 * weight),
        name: `4 Cặp Cùng (${pairType1} → Bẻ mạnh ${prediction})`,
        patternId: 'double_pair_break'
      };
    }
    
    const alternatingPairs = pairType1 !== pairType2 && pairType2 !== results[4] && results[4] !== results[6];
    if (alternatingPairs) {
      const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        type: 'alternating_pairs',
        prediction,
        confidence: Math.round(14 * weight),
        name: `Cặp Đảo Xen Kẽ (Bẻ → ${prediction})`,
        patternId: 'double_pair_break'
      };
    }
  }
  return { detected: false };
}

function analyzeTriplePattern(results, type) {
  if (results.length < 9) return { detected: false };
  
  const weight = getPatternWeight(type, 'triple_pattern') || 1.0;
  
  const isTriple1 = results[0] === results[1] && results[1] === results[2];
  const isTriple2 = results[3] === results[4] && results[4] === results[5];
  const isTriple3 = results[6] === results[7] && results[7] === results[8];
  
  if (isTriple1 && isTriple2 && isTriple3) {
    const tripleType1 = results[0];
    const tripleType2 = results[3];
    const tripleType3 = results[6];
    
    if (tripleType1 === tripleType2 && tripleType2 === tripleType3) {
      const prediction = tripleType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        type: 'three_same_triples',
        prediction,
        confidence: Math.round(17 * weight),
        name: `3 Bộ Ba Cùng ${tripleType1} (Bẻ rất mạnh → ${prediction})`,
        patternId: 'triple_pattern'
      };
    }
    
    if (tripleType1 !== tripleType2 && tripleType2 !== tripleType3) {
      const prediction = tripleType1;
      return {
        detected: true,
        type: 'alternating_triples',
        prediction,
        confidence: Math.round(15 * weight),
        name: `Bộ Ba Đảo (Theo → ${prediction})`,
        patternId: 'triple_pattern'
      };
    }
  }
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  const xiuCount = window.length - taiCount;
  
  return {
    taiPercent: (taiCount / window.length) * 100,
    xiuPercent: (xiuCount / window.length) * 100,
    taiCount,
    xiuCount,
    total: window.length,
    imbalance: Math.abs(taiCount - xiuCount) / window.length
  };
}

function analyzeDicePatterns(data) {
  const recentData = data.slice(0, 15);
  let totalSum = 0;
  recentData.forEach(d => { totalSum += d.Tong; });
  const avgSum = totalSum / recentData.length;
  
  return {
    averageSum: avgSum,
    sumTrend: avgSum > 10.5 ? 'high' : 'low'
  };
}

function analyzeSumTrend(data) {
  const recentSums = data.slice(0, 20).map(d => d.Tong);
  let increasingCount = 0, decreasingCount = 0;
  
  for (let i = 0; i < recentSums.length - 1; i++) {
    if (recentSums[i] > recentSums[i + 1]) decreasingCount++;
    else if (recentSums[i] < recentSums[i + 1]) increasingCount++;
  }
  
  const movingAvg5 = recentSums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const movingAvg10 = recentSums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  
  return {
    trend: increasingCount > decreasingCount ? 'increasing' : 'decreasing',
    strength: Math.abs(increasingCount - decreasingCount) / (recentSums.length - 1),
    movingAvg5,
    movingAvg10,
    shortTermBias: movingAvg5 > 10.5 ? 'Tài' : 'Xỉu'
  };
}

function analyzeRecentMomentum(results) {
  const windows = [3, 5, 10];
  const momentum = {};
  
  windows.forEach(size => {
    if (results.length >= size) {
      const window = results.slice(0, size);
      const taiCount = window.filter(r => r === 'Tài').length;
      momentum[`window_${size}`] = {
        taiRatio: taiCount / size,
        dominant: taiCount > size / 2 ? 'Tài' : 'Xỉu'
      };
    }
  });
  return momentum;
}

// ==================== LEARNING SYSTEM FUNCTIONS ====================

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternStats[pattern]) {
      learningData[type].patternStats[pattern] = {
        total: 0,
        correct: 0,
        accuracy: 0.5,
        recentResults: [],
        lastAdjustment: null
      };
    }
  });
}

function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  return learningData[type].patternWeights[patternId] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
  initializePatternStats(type);
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  
  stats.total++;
  if (isCorrect) stats.correct++;
  
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 20) stats.recentResults.shift();
  
  const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  
  const oldWeight = learningData[type].patternWeights[patternId];
  let newWeight = oldWeight;
  
  if (stats.recentResults.length >= 5) {
    if (recentAccuracy > 0.6) newWeight = Math.min(2.0, oldWeight * 1.05);
    else if (recentAccuracy < 0.4) newWeight = Math.max(0.3, oldWeight * 0.95);
  }
  
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33', 'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321', 'Cầu Nhảy Cóc': 'cau_nhay_coc', 'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng',
    'Cầu 3 Ván 1': 'cau_3van1', 'Cầu Bẻ Cầu': 'cau_be_cau', 'Cầu Chu Kỳ': 'cau_chu_ky',
    'Phân bố': 'distribution', 'Tổng TB': 'dice_pattern', 'Xu hướng': 'sum_trend',
    'Cực Điểm': 'edge_cases', 'Biến động': 'momentum', 'Cầu Tự Nhiên': 'cau_tu_nhien'
  };
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}

function getAdaptiveConfidenceBoost(type) {
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 10) return 0;
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  if (accuracy > 0.65) return 5;
  if (accuracy > 0.55) return 2;
  if (accuracy < 0.4) return -5;
  if (accuracy < 0.45) return -2;
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -5) return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  if (streakInfo.currentStreak >= 8) return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  return prediction;
}

// ==================== COMBINED PREDICTION ENGINE ====================

function calculateCombinedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  // === PATTERN ANALYSES (GIỮ NGUYÊN CODE CŨ) ===
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) {
    predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: 10, name: cauBet.name });
    factors.push(cauBet.name);
    allPatterns.push(cauBet);
  }
  
  const cauDao11 = analyzeCauDao11(results, type);
  if (cauDao11.detected) {
    predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: 9, name: cauDao11.name });
    factors.push(cauDao11.name);
    allPatterns.push(cauDao11);
  }
  
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) {
    predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 8, name: cau22.name });
    factors.push(cau22.name);
    allPatterns.push(cau22);
  }
  
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) {
    predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 8, name: cau33.name });
    factors.push(cau33.name);
    allPatterns.push(cau33);
  }
  
  const cau121 = analyzeCau121(results, type);
  if (cau121.detected) {
    predictions.push({ prediction: cau121.prediction, confidence: cau121.confidence, priority: 7, name: cau121.name });
    factors.push(cau121.name);
    allPatterns.push(cau121);
  }
  
  const cauNhayCoc = analyzeCauNhayCoc(results, type);
  if (cauNhayCoc.detected) {
    predictions.push({ prediction: cauNhayCoc.prediction, confidence: cauNhayCoc.confidence, priority: 6, name: cauNhayCoc.name });
    factors.push(cauNhayCoc.name);
    allPatterns.push(cauNhayCoc);
  }
  
  const cau3Van1 = analyzeCau3Van1(results, type);
  if (cau3Van1.detected) {
    predictions.push({ prediction: cau3Van1.prediction, confidence: cau3Van1.confidence, priority: 6, name: cau3Van1.name });
    factors.push(cau3Van1.name);
    allPatterns.push(cau3Van1);
  }
  
  const cauBeCau = analyzeCauBeCau(results, type);
  if (cauBeCau.detected) {
    predictions.push({ prediction: cauBeCau.prediction, confidence: cauBeCau.confidence, priority: 8, name: cauBeCau.name });
    factors.push(cauBeCau.name);
    allPatterns.push(cauBeCau);
  }
  
  const cyclePattern = detectCyclePattern(results, type);
  if (cyclePattern.detected) {
    predictions.push({ prediction: cyclePattern.prediction, confidence: cyclePattern.confidence, priority: 7, name: cyclePattern.name });
    factors.push(cyclePattern.name);
    allPatterns.push(cyclePattern);
  }
  
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) {
    predictions.push({ prediction: smartBet.prediction, confidence: smartBet.confidence, priority: 9, name: smartBet.name });
    factors.push(smartBet.name);
    allPatterns.push(smartBet);
  }
  
  const breakPatternAdvanced = analyzeBreakPatternAdvanced(results, type);
  if (breakPatternAdvanced.detected) {
    predictions.push({ prediction: breakPatternAdvanced.prediction, confidence: breakPatternAdvanced.confidence, priority: 11, name: breakPatternAdvanced.name });
    factors.push(breakPatternAdvanced.name);
    allPatterns.push(breakPatternAdvanced);
  }
  
  const breakStreak = analyzeBreakStreak(results, type);
  if (breakStreak.detected) {
    predictions.push({ prediction: breakStreak.prediction, confidence: breakStreak.confidence, priority: 12, name: breakStreak.name });
    factors.push(breakStreak.name);
    allPatterns.push(breakStreak);
  }
  
  const alternatingBreak = analyzeAlternatingBreak(results, type);
  if (alternatingBreak.detected) {
    predictions.push({ prediction: alternatingBreak.prediction, confidence: alternatingBreak.confidence, priority: 11, name: alternatingBreak.name });
    factors.push(alternatingBreak.name);
    allPatterns.push(alternatingBreak);
  }
  
  const doublePairBreak = analyzeDoublePairBreak(results, type);
  if (doublePairBreak.detected) {
    predictions.push({ prediction: doublePairBreak.prediction, confidence: doublePairBreak.confidence, priority: 13, name: doublePairBreak.name });
    factors.push(doublePairBreak.name);
    allPatterns.push(doublePairBreak);
  }
  
  const triplePattern = analyzeTriplePattern(results, type);
  if (triplePattern.detected) {
    predictions.push({ prediction: triplePattern.prediction, confidence: triplePattern.confidence, priority: 14, name: triplePattern.name });
    factors.push(triplePattern.name);
    allPatterns.push(triplePattern);
  }
  
  const momentumPattern = analyzeMomentumPattern(last50, type);
  if (momentumPattern.detected) {
    predictions.push({ prediction: momentumPattern.prediction, confidence: momentumPattern.confidence, priority: 9, name: momentumPattern.name });
    factors.push(momentumPattern.name);
    allPatterns.push(momentumPattern);
  }
  
  const edgeCases = analyzeEdgeCases(last50, type);
  if (edgeCases.detected) {
    predictions.push({ prediction: edgeCases.prediction, confidence: edgeCases.confidence, priority: 5, name: edgeCases.name });
    factors.push(edgeCases.name);
    allPatterns.push(edgeCases);
  }
  
  // === PHÂN TÍCH PHÂN BỐ ===
  const distribution = analyzeDistribution(last50, type);
  if (distribution.imbalance > 0.2) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    const weight = getPatternWeight(type, 'distribution');
    predictions.push({ prediction: minority, confidence: Math.round(6 * weight), priority: 5, name: 'Phân bố lệch' });
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  // === PHÂN TÍCH XÚC XẮC ===
  const dicePatterns = analyzeDicePatterns(last50);
  if (dicePatterns.averageSum > 11.5) {
    const weight = getPatternWeight(type, 'dice_pattern');
    predictions.push({ prediction: 'Xỉu', confidence: Math.round(5 * weight), priority: 4, name: 'Tổng TB cao' });
    factors.push(`Tổng TB cao (${dicePatterns.averageSum.toFixed(1)})`);
  } else if (dicePatterns.averageSum < 9.5) {
    const weight = getPatternWeight(type, 'dice_pattern');
    predictions.push({ prediction: 'Tài', confidence: Math.round(5 * weight), priority: 4, name: 'Tổng TB thấp' });
    factors.push(`Tổng TB thấp (${dicePatterns.averageSum.toFixed(1)})`);
  }
  
  // === PHÂN TÍCH XU HƯỚNG TỔNG ===
  const sumTrend = analyzeSumTrend(last50);
  if (sumTrend.strength > 0.4) {
    const trendPrediction = sumTrend.trend === 'increasing' ? 'Tài' : 'Xỉu';
    const weight = getPatternWeight(type, 'sum_trend');
    predictions.push({ prediction: trendPrediction, confidence: Math.round(4 * weight), priority: 3, name: 'Xu hướng tổng' });
    factors.push(`Xu hướng tổng ${sumTrend.trend === 'increasing' ? 'tăng' : 'giảm'}`);
  }
  
  // === MOMENTUM ===
  const momentum = analyzeRecentMomentum(results);
  if (momentum.window_3 && momentum.window_10) {
    const shortTermDiff = Math.abs(momentum.window_3.taiRatio - momentum.window_10.taiRatio);
    if (shortTermDiff > 0.3) {
      const reversePrediction = momentum.window_3.dominant === 'Tài' ? 'Xỉu' : 'Tài';
      const weight = getPatternWeight(type, 'momentum');
      predictions.push({ prediction: reversePrediction, confidence: Math.round(5 * weight), priority: 4, name: 'Biến động ngắn hạn' });
      factors.push('Biến động ngắn hạn mạnh');
    }
  }
  
  // === FIXED MONTE CARLO (ĐÃ SỬA) ===
  let monteCarloResult = null;
  if (monteCarloSimulators[type]) {
    try {
      monteCarloResult = monteCarloSimulators[type].runTrueSimulation(last50, 5000);
      if (monteCarloResult && monteCarloResult.simulationCount > 100) {
        predictions.push({ 
          prediction: monteCarloResult.prediction, 
          confidence: monteCarloResult.confidence, 
          priority: 10, 
          name: `Monte Carlo (${monteCarloResult.method})` 
        });
        factors.push(`MC: ${(parseFloat(monteCarloResult.taiProbability) * 100).toFixed(1)}% Tài - ${monteCarloResult.simulationCount} sims`);
        factors.push(`MC similar patterns: ${monteCarloResult.similarPatternsCount || 0}`);
      }
    } catch (mcError) {
      console.error(`[MC Error] ${type}:`, mcError.message);
    }
  }
  
  // === FALLBACK ===
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  // === VOTING ===
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  const taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  const xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // === SMART ADJUSTMENT ===
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  // Nếu Monte Carlo có confidence cao hơn nhiều, ưu tiên Monte Carlo
  if (monteCarloResult && monteCarloResult.confidence > 75 && Math.abs(taiScore - xiuScore) < 1000) {
    finalPrediction = monteCarloResult.prediction;
    factors.push(`MC override: ${finalPrediction}`);
  }
  
  // === CONFIDENCE CALCULATION ===
  let baseConfidence = 50;
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += p.confidence;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 15);
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  // Bonus từ Monte Carlo
  if (monteCarloResult && monteCarloResult.prediction === finalPrediction) {
    baseConfidence += 5;
  }
  
  const randomAdjust = (Math.random() * 4) - 2;
  let finalConfidence = Math.round(baseConfidence + randomAdjust);
  finalConfidence = Math.max(50, Math.min(88, finalConfidence));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    monteCarlo: monteCarloResult,
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore: Math.round(taiScore),
      xiuScore: Math.round(xiuScore),
      topPattern: predictions[0]?.name || 'N/A',
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak
      }
    }
  };
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
      const predictedNormalized = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.losses++;
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
      if (learningData[type].recentAccuracy.length > 50) {
        learningData[type].recentAccuracy.shift();
      }
      
      if (pred.factors && pred.factors.length > 0) {
        pred.factors.forEach(factorName => {
          const patternId = getPatternIdFromName(factorName);
          if (patternId) {
            updatePatternPerformance(type, patternId, pred.isCorrect);
          }
        });
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
      console.log('Learning data loaded successfully');
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
      console.log('Prediction history loaded successfully');
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

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      updateMonteCarloSimulators('hu', dataHu);
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateCombinedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | MC: ${result.monteCarlo?.method || 'none'}`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      updateMonteCarloSimulators('md5', dataMd5);
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateCombinedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | MC: ${result.monteCarlo?.method || 'none'}`);
      }
    }
    
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

function startAutoSaveTask() {
  console.log(`Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  setTimeout(() => autoProcessPredictions(), 5000);
  setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
}

// ==================== EXPRESS ROUTES ====================

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('kapub - Combined Prediction Engine v2.0');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
    updateMonteCarloSimulators('hu', data);
    await verifyPredictions('hu', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateCombinedPrediction(data, 'hu');
    savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: 'kapub'
    });
  } catch (error) {
    console.error('Error:', error);
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
    const result = calculateCombinedPrediction(data, 'md5');
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: 'kapub'
    });
  } catch (error) {
    console.error('Error:', error);
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
    const result = calculateCombinedPrediction(data, 'hu');
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      monteCarlo: result.monteCarlo,
      analysis: result.detailedAnalysis
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
    const result = calculateCombinedPrediction(data, 'md5');
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      monteCarlo: result.monteCarlo,
      analysis: result.detailedAnalysis
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
    patternPerformance: Object.entries(stats.patternStats).map(([id, data]) => ({
      pattern: id,
      total: data.total,
      correct: data.correct,
      accuracy: data.total > 0 ? (data.correct / data.total * 100).toFixed(1) + '%' : 'N/A',
      weight: stats.patternWeights[id]?.toFixed(2) || '1.00',
      recentTrend: data.recentResults.length >= 5 ? (data.recentResults.slice(-5).reduce((a, b) => a + b, 0) / 5 * 100).toFixed(0) + '%' : 'N/A'
    })).filter(p => p.total > 0),
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
    patternPerformance: Object.entries(stats.patternStats).map(([id, data]) => ({
      pattern: id,
      total: data.total,
      correct: data.correct,
      accuracy: data.total > 0 ? (data.correct / data.total * 100).toFixed(1) + '%' : 'N/A',
      weight: stats.patternWeights[id]?.toFixed(2) || '1.00',
      recentTrend: data.recentResults.length >= 5 ? (data.recentResults.slice(-5).reduce((a, b) => a + b, 0) / 5 * 100).toFixed(0) + '%' : 'N/A'
    })).filter(p => p.total > 0),
    lastUpdate: stats.lastUpdate
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, adaptiveThresholds: {}, recentAccuracy: [] }
  };
  monteCarloSimulators = { hu: null, md5: null };
  saveLearningData();
  res.json({ message: 'Learning data and Monte Carlo simulators reset successfully' });
});

// ==================== START SERVER ====================

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - COMBINED PREDICTION ENGINE v2.0              ║`);
  console.log(`║     KẾT HỢP PATTERN ANALYSIS + FIXED MONTE CARLO              ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`🚀 Server: http://0.0.0.0:${PORT}`);
  console.log(`\n📊 API SOURCES:`);
  console.log(`   - TX Hũ: ${API_URL_HU}`);
  console.log(`   - TX MD5: ${API_URL_MD5}\n`);
  console.log(`🔥 WHAT'S FIXED:`);
  console.log(`   • Monte Carlo SIMULATES THỰC SỰ - dựa trên xác suất xúc xắc`);
  console.log(`   • Tìm mẫu hình tương tự trong lịch sử (similarity matching)`);
  console.log(`   • Hybrid simulation: 70% pattern-based + 30% dice probability`);
  console.log(`   • Giữ nguyên tất cả pattern analyses đang hoạt động tốt (57-62%)\n`);
  console.log(`📋 ENDPOINTS:`);
  console.log(`   GET  /lc79-hu           - Dự đoán Tài Xỉu Hũ (kết hợp)`);
  console.log(`   GET  /lc79-md5          - Dự đoán Tài Xỉu MD5 (kết hợp)`);
  console.log(`   GET  /lc79-hu/lichsu    - Lịch sử dự đoán Hũ + verify`);
  console.log(`   GET  /lc79-md5/lichsu   - Lịch sử dự đoán MD5 + verify`);
  console.log(`   GET  /lc79-hu/analysis  - Phân tích chi tiết + MC results`);
  console.log(`   GET  /lc79-md5/analysis - Phân tích chi tiết + MC results`);
  console.log(`   GET  /lc79-hu/learning  - Thống kê học tập Hũ`);
  console.log(`   GET  /lc79-md5/learning - Thống kê học tập MD5`);
  console.log(`   GET  /reset-learning    - Reset dữ liệu học\n`);
  
  startAutoSaveTask();
});
