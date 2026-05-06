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
const SIMULATION_CACHE_FILE = 'simulation_cache.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== FULL HISTORY SIMULATION ENGINE ====================
class FullHistorySimulation {
  constructor() {
    this.simulationCache = { hu: {}, md5: {} };
    this.historicalPatternDB = { hu: [], md5: [] };
    this.markovChains = { hu: {}, md5: {} };
    this.similarityCache = new Map();
  }

  loadSimulationCache() {
    try {
      if (fs.existsSync(SIMULATION_CACHE_FILE)) {
        const data = fs.readFileSync(SIMULATION_CACHE_FILE, 'utf8');
        const parsed = JSON.parse(data);
        this.simulationCache = parsed.simulationCache || { hu: {}, md5: {} };
        this.historicalPatternDB = parsed.historicalPatternDB || { hu: [], md5: [] };
        console.log(`[Simulation] Loaded cache: Hu=${Object.keys(this.simulationCache.hu).length}, MD5=${Object.keys(this.simulationCache.md5).length}`);
      }
    } catch (error) {
      console.error('[Simulation] Load error:', error.message);
    }
  }

  saveSimulationCache() {
    try {
      fs.writeFileSync(SIMULATION_CACHE_FILE, JSON.stringify({
        simulationCache: this.simulationCache,
        historicalPatternDB: this.historicalPatternDB,
        lastSaved: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      console.error('[Simulation] Save error:', error.message);
    }
  }

  buildHistoricalPatternDB(type, historicalData) {
    if (!historicalData || historicalData.length < 20) return;
    
    const patterns = [];
    const results = historicalData.map(d => d.Ket_qua);
    const sums = historicalData.map(d => d.Tong);
    const diceData = historicalData.map(d => [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3]);
    
    for (let windowSize = 5; windowSize <= 15; windowSize++) {
      for (let i = 0; i <= results.length - windowSize - 1; i++) {
        const patternKey = results.slice(i, i + windowSize).join('');
        const nextResult = results[i + windowSize];
        const nextSum = sums[i + windowSize];
        const nextDice = diceData[i + windowSize];
        
        if (!patterns[patternKey]) {
          patterns[patternKey] = { tai: 0, xiu: 0, sums: [], dicePatterns: [] };
        }
        
        if (nextResult === 'Tài') patterns[patternKey].tai++;
        else patterns[patternKey].xiu++;
        
        patterns[patternKey].sums.push(nextSum);
        patterns[patternKey].dicePatterns.push(nextDice);
        
        if (patterns[patternKey].sums.length > 50) patterns[patternKey].sums.shift();
        if (patterns[patternKey].dicePatterns.length > 50) patterns[patternKey].dicePatterns.shift();
      }
    }
    
    this.historicalPatternDB[type] = patterns;
    this.saveSimulationCache();
  }

  buildMarkovChain(type, historicalData, order = 3) {
    if (!historicalData || historicalData.length < 100) return;
    
    const results = historicalData.map(d => d.Ket_qua);
    const chain = {};
    
    for (let i = 0; i <= results.length - order - 1; i++) {
      const state = results.slice(i, i + order).join('');
      const next = results[i + order];
      
      if (!chain[state]) {
        chain[state] = { tai: 0, xiu: 0, total: 0 };
      }
      
      if (next === 'Tài') chain[state].tai++;
      else chain[state].xiu++;
      chain[state].total++;
    }
    
    this.markovChains[type][order] = chain;
    this.saveSimulationCache();
  }

  findSimilarHistoricalPatterns(currentResults, type, maxMatches = 200) {
    const currentPattern = currentResults.slice(0, 10).join('');
    const currentKey = currentPattern + '_' + type;
    
    if (this.similarityCache.has(currentKey)) {
      return this.similarityCache.get(currentKey);
    }
    
    const matches = [];
    const patterns = this.historicalPatternDB[type];
    
    if (!patterns) return [];
    
    for (const [patternKey, stats] of Object.entries(patterns)) {
      if (patternKey.length < 5) continue;
      
      let similarity = 0;
      const minLen = Math.min(currentPattern.length, patternKey.length);
      
      for (let i = 0; i < minLen; i++) {
        if (currentPattern[i] === patternKey[i]) similarity++;
      }
      
      similarity = similarity / minLen;
      similarity += Math.min(0.2, patternKey.length / 100);
      
      if (similarity > 0.5) {
        const totalOccurrences = stats.tai + stats.xiu;
        const taiProb = totalOccurrences > 0 ? stats.tai / totalOccurrences : 0.5;
        
        matches.push({
          pattern: patternKey,
          similarity,
          taiProb,
          totalOccurrences,
          avgSum: stats.sums.reduce((a, b) => a + b, 0) / (stats.sums.length || 1),
          dicePatterns: stats.dicePatterns
        });
      }
    }
    
    matches.sort((a, b) => b.similarity - a.similarity);
    const topMatches = matches.slice(0, maxMatches);
    
    this.similarityCache.set(currentKey, topMatches);
    
    if (this.similarityCache.size > 1000) {
      const firstKey = this.similarityCache.keys().next().value;
      this.similarityCache.delete(firstKey);
    }
    
    return topMatches;
  }

  runFullHistorySimulation(currentData, type, numSimulations = 20000) {
    const results = currentData.slice(0, 20).map(d => d.Ket_qua);
    const sums = currentData.slice(0, 20).map(d => d.Tong);
    
    if (currentData.length < 30) {
      return this.runSimpleSimulation(currentData, numSimulations);
    }
    
    const similarPatterns = this.findSimilarHistoricalPatterns(results, type);
    const markovChain = this.markovChains[type][3];
    const recentTrend = this.analyzeRecentTrend(results, sums);
    
    let taiWins = 0;
    let xiuWins = 0;
    let weights = [];
    
    for (let sim = 0; sim < numSimulations; sim++) {
      let prediction;
      let weight = 1;
      
      const methodRand = Math.random();
      
      if (methodRand < 0.4 && similarPatterns.length > 0) {
        const randomPattern = similarPatterns[Math.floor(Math.random() * similarPatterns.length)];
        const randomValue = Math.random();
        prediction = randomValue < randomPattern.taiProb ? 'Tài' : 'Xỉu';
        weight = randomPattern.similarity * (randomPattern.totalOccurrences / 100);
      }
      else if (methodRand < 0.65 && markovChain) {
        const state = results.slice(0, 3).join('');
        const stateData = markovChain[state];
        if (stateData && stateData.total > 0) {
          const taiProb = stateData.tai / stateData.total;
          prediction = Math.random() < taiProb ? 'Tài' : 'Xỉu';
          weight = 0.8 + (stateData.total / 200);
        } else {
          prediction = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
          weight = 0.5;
        }
      }
      else if (methodRand < 0.85) {
        prediction = this.simulateByTrend(recentTrend);
        weight = recentTrend.confidence / 100;
      }
      else {
        prediction = this.simulateByBootstrap(currentData);
        weight = 0.7;
      }
      
      if (prediction === 'Tài') taiWins += weight;
      else xiuWins += weight;
    }
    
    const taiProbability = taiWins / (taiWins + xiuWins);
    const confidence = 50 + Math.abs(taiProbability - 0.5) * 70;
    const finalConfidence = Math.min(88, Math.max(55, Math.round(confidence)));
    
    return {
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: (1 - taiProbability).toFixed(4),
      confidence: finalConfidence,
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      simulationCount: numSimulations,
      similarPatternsFound: similarPatterns.length,
      markovAvailable: !!markovChain,
      methodUsed: 'full_history_simulation'
    };
  }

  analyzeRecentTrend(results, sums) {
    if (results.length < 10) return { confidence: 50 };
    
    const taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
    const taiRatio = taiCount / 10;
    
    const sumTrend = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const sumPrev = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
    
    let trend = 'neutral';
    let confidence = 50;
    
    if (taiRatio > 0.7) {
      trend = 'tai_dominant';
      confidence = 60 + (taiRatio - 0.7) * 100;
    } else if (taiRatio < 0.3) {
      trend = 'xiu_dominant';
      confidence = 60 + (0.3 - taiRatio) * 100;
    }
    
    if (Math.abs(sumTrend - sumPrev) > 2) {
      trend = sumTrend > sumPrev ? 'sum_increasing' : 'sum_decreasing';
      confidence = Math.min(75, confidence + 10);
    }
    
    return { trend, confidence, taiRatio };
  }

  simulateByTrend(trendAnalysis) {
    if (trendAnalysis.trend === 'tai_dominant') {
      return Math.random() < 0.65 ? 'Tài' : 'Xỉu';
    } else if (trendAnalysis.trend === 'xiu_dominant') {
      return Math.random() < 0.65 ? 'Xỉu' : 'Tài';
    } else if (trendAnalysis.trend === 'sum_increasing') {
      return Math.random() < 0.6 ? 'Xỉu' : 'Tài';
    } else if (trendAnalysis.trend === 'sum_decreasing') {
      return Math.random() < 0.6 ? 'Tài' : 'Xỉu';
    }
    return Math.random() < 0.5 ? 'Tài' : 'Xỉu';
  }

  simulateByBootstrap(currentData) {
    if (currentData.length < 20) return Math.random() < 0.5 ? 'Tài' : 'Xỉu';
    const randomIndex = Math.floor(Math.random() * (currentData.length - 1));
    return currentData[randomIndex].Ket_qua;
  }

  runSimpleSimulation(currentData, numSimulations) {
    const results = currentData.slice(0, 20).map(d => d.Ket_qua);
    const taiCount = results.filter(r => r === 'Tài').length;
    const baseProb = taiCount / results.length;
    
    let taiWins = 0;
    for (let i = 0; i < numSimulations; i++) {
      if (Math.random() < baseProb) taiWins++;
    }
    
    const taiProbability = taiWins / numSimulations;
    const confidence = 50 + Math.abs(taiProbability - 0.5) * 40;
    
    return {
      taiProbability: taiProbability.toFixed(4),
      xiuProbability: (1 - taiProbability).toFixed(4),
      confidence: Math.min(85, Math.max(55, Math.round(confidence))),
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      simulationCount: numSimulations,
      methodUsed: 'simple_simulation'
    };
  }

  updateFromVerification(type, phien, actualResult, predictedResult) {
    if (!this.simulationCache[type][phien]) {
      this.simulationCache[type][phien] = {
        predicted: predictedResult,
        actual: actualResult,
        isCorrect: actualResult === predictedResult,
        timestamp: new Date().toISOString()
      };
    }
    
    const cacheKeys = Object.keys(this.simulationCache[type]);
    if (cacheKeys.length > 1000) {
      const oldestKey = cacheKeys.sort()[0];
      delete this.simulationCache[type][oldestKey];
    }
    
    this.saveSimulationCache();
  }
}

// ==================== CÁC THUẬT TOÁN CŨ (GIỮ NGUYÊN) ====================

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
    
    let shouldBreak = streakLength >= 6;
    
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

function analyzeCau44(results, type) {
  if (results.length < 8) return { detected: false };
  
  let quadCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 3) {
    if (results[i] === results[i + 1] && 
        results[i + 1] === results[i + 2] && 
        results[i + 2] === results[i + 3]) {
      pattern.push(results[i]);
      quadCount++;
      i += 4;
    } else {
      break;
    }
  }
  
  if (quadCount >= 1) {
    const currentPosition = (results.length - (quadCount * 4));
    const lastQuadType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_44');
    
    let prediction;
    if (currentPosition >= 3) {
      prediction = lastQuadType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastQuadType;
    }
    
    return { 
      detected: true, 
      quadCount,
      prediction,
      confidence: Math.round(Math.min(14, quadCount * 4 + 6) * weight),
      name: `Cầu 4-4 (${quadCount} bộ bốn)`,
      patternId: 'cau_44'
    };
  }
  
  return { detected: false };
}

function analyzeCau55(results, type) {
  if (results.length < 10) return { detected: false };
  
  let quintCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 4) {
    if (results[i] === results[i + 1] && 
        results[i + 1] === results[i + 2] && 
        results[i + 2] === results[i + 3] &&
        results[i + 3] === results[i + 4]) {
      pattern.push(results[i]);
      quintCount++;
      i += 5;
    } else {
      break;
    }
  }
  
  if (quintCount >= 1) {
    const currentPosition = (results.length - (quintCount * 5));
    const lastQuintType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_55');
    
    let prediction;
    if (currentPosition >= 4) {
      prediction = lastQuintType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastQuintType;
    }
    
    return { 
      detected: true, 
      quintCount,
      prediction,
      confidence: Math.round(Math.min(15, quintCount * 5 + 7) * weight),
      name: `Cầu 5-5 (${quintCount} bộ năm)`,
      patternId: 'cau_55'
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

function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      const weight = getPatternWeight(type, 'cau_123');
      return { 
        detected: true, 
        pattern: '1-2-3',
        prediction: first,
        confidence: Math.round(11 * weight),
        name: 'Cầu 1-2-3',
        patternId: 'cau_123'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    const weight = getPatternWeight(type, 'cau_321');
    return { 
      detected: true, 
      pattern: '3-2-1',
      prediction: next2[0],
      confidence: Math.round(12 * weight),
      name: 'Cầu 3-2-1',
      patternId: 'cau_321'
    };
  }
  
  return { detected: false };
}

function analyzeCau212(results, type) {
  if (results.length < 5) return { detected: false };
  
  const pattern = results.slice(0, 5);
  const weight = getPatternWeight(type, 'cau_212');
  
  if (pattern[0] === pattern[1] && 
      pattern[1] !== pattern[2] &&
      pattern[2] === pattern[3] && pattern[3] === pattern[4] &&
      pattern[0] !== pattern[2]) {
    return { 
      detected: true, 
      pattern: '2-1-2',
      prediction: pattern[0],
      confidence: Math.round(11 * weight),
      name: 'Cầu 2-1-2',
      patternId: 'cau_212'
    };
  }
  
  if (pattern[0] !== pattern[1] && pattern[1] !== pattern[2] &&
      pattern[0] === pattern[2] &&
      pattern[2] !== pattern[3] &&
      pattern[3] === pattern[4]) {
    return { 
      detected: true, 
      pattern: '2-1-2 (đảo)',
      prediction: pattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(10 * weight),
      name: 'Cầu 2-1-2 Đảo',
      patternId: 'cau_212'
    };
  }
  
  return { detected: false };
}

function analyzeCau1221(results, type) {
  if (results.length < 6) return { detected: false };
  
  const pattern = results.slice(0, 6);
  const weight = getPatternWeight(type, 'cau_1221');
  
  if (pattern[0] !== pattern[1] &&
      pattern[1] === pattern[2] &&
      pattern[2] === pattern[3] &&
      pattern[3] !== pattern[4] &&
      pattern[4] === pattern[5] &&
      pattern[0] !== pattern[1]) {
    return { 
      detected: true, 
      pattern: '1-2-2-1',
      prediction: pattern[0],
      confidence: Math.round(12 * weight),
      name: 'Cầu 1-2-2-1',
      patternId: 'cau_1221'
    };
  }
  
  if (pattern[0] !== pattern[1] &&
      pattern[1] === pattern[2] &&
      pattern[2] !== pattern[3] &&
      pattern[3] === pattern[4] &&
      pattern[4] !== pattern[5]) {
    return { 
      detected: true, 
      pattern: '1-2-1-2-1',
      prediction: pattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(11 * weight),
      name: 'Cầu 1-2-1-2-1',
      patternId: 'cau_1221'
    };
  }
  
  return { detected: false };
}

function analyzeCau2112(results, type) {
  if (results.length < 6) return { detected: false };
  
  const pattern = results.slice(0, 6);
  const weight = getPatternWeight(type, 'cau_2112');
  
  if (pattern[0] === pattern[1] &&
      pattern[1] !== pattern[2] &&
      pattern[2] === pattern[3] &&
      pattern[3] !== pattern[4] &&
      pattern[4] === pattern[5] &&
      pattern[0] !== pattern[2]) {
    return { 
      detected: true, 
      pattern: '2-1-1-2',
      prediction: pattern[0],
      confidence: Math.round(11 * weight),
      name: 'Cầu 2-1-1-2',
      patternId: 'cau_2112'
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

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_nhip_nghieng');
  
  if (taiCount5 >= 4) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      ratio: `${taiCount5}/5 Tài`,
      prediction: 'Tài',
      confidence: Math.round(9 * weight),
      name: `Cầu Nhịp Nghiêng 5 (${taiCount5} Tài)`,
      patternId: 'cau_nhip_nghieng'
    };
  } else if (taiCount5 <= 1) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      ratio: `${5 - taiCount5}/5 Xỉu`,
      prediction: 'Xỉu',
      confidence: Math.round(9 * weight),
      name: `Cầu Nhịp Nghiêng 5 (${5 - taiCount5} Xỉu)`,
      patternId: 'cau_nhip_nghieng'
    };
  }
  
  if (results.length >= 7) {
    const last7 = results.slice(0, 7);
    const taiCount7 = last7.filter(r => r === 'Tài').length;
    
    if (taiCount7 >= 5) {
      return { 
        detected: true, 
        type: 'nghieng_7',
        ratio: `${taiCount7}/7 Tài`,
        prediction: 'Tài',
        confidence: Math.round(10 * weight),
        name: `Cầu Nhịp Nghiêng 7 (${taiCount7} Tài)`,
        patternId: 'cau_nhip_nghieng'
      };
    } else if (taiCount7 <= 2) {
      return { 
        detected: true, 
        type: 'nghieng_7',
        ratio: `${7 - taiCount7}/7 Xỉu`,
        prediction: 'Xỉu',
        confidence: Math.round(10 * weight),
        name: `Cầu Nhịp Nghiêng 7 (${7 - taiCount7} Xỉu)`,
        patternId: 'cau_nhip_nghieng'
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

function analyzeCauGap(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_gap');
  
  for (let gapSize = 2; gapSize <= 3; gapSize++) {
    let patternFound = true;
    const referenceType = results[0];
    
    for (let i = 0; i < Math.min(results.length, 12); i += (gapSize + 1)) {
      if (results[i] !== referenceType) {
        patternFound = false;
        break;
      }
    }
    
    if (patternFound) {
      return { 
        detected: true, 
        gapSize,
        prediction: referenceType,
        confidence: Math.round(9 * weight),
        name: `Cầu Gấp ${gapSize + 1} (mỗi ${gapSize + 1} phiên)`,
        patternId: 'cau_gap'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauZiczac(results, type) {
  if (results.length < 8) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_ziczac');
  
  let zigzagCount = 0;
  for (let i = 0; i < results.length - 2; i++) {
    if (results[i] !== results[i + 1] && results[i + 1] !== results[i + 2] && results[i] === results[i + 2]) {
      zigzagCount++;
    } else {
      break;
    }
  }
  
  if (zigzagCount >= 3) {
    return { 
      detected: true, 
      zigzagCount,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(13, zigzagCount * 2 + 5) * weight),
      name: `Cầu Ziczac (${zigzagCount} lần)`,
      patternId: 'cau_ziczac'
    };
  }
  
  return { detected: false };
}

function analyzeCauDoi(results, type) {
  if (results.length < 4) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_doi');
  
  let pairChanges = 0;
  let i = 0;
  
  while (i < results.length - 1) {
    if (results[i] === results[i + 1]) {
      pairChanges++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairChanges >= 2) {
    const isAlternatingPairs = results[0] !== results[2];
    if (isAlternatingPairs) {
      return { 
        detected: true, 
        pairChanges,
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(12, pairChanges * 3 + 4) * weight),
        name: `Cầu Đôi Đảo (${pairChanges} cặp)`,
        patternId: 'cau_doi'
      };
    } else {
      return { 
        detected: true, 
        pairChanges,
        prediction: results[0],
        confidence: Math.round(Math.min(11, pairChanges * 2 + 5) * weight),
        name: `Cầu Đôi Bệt (${pairChanges} cặp)`,
        patternId: 'cau_doi'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_rong');
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 6) {
    return { 
      detected: true, 
      streakLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(16, streakLength + 8) * weight),
      name: `Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`,
      patternId: 'cau_rong'
    };
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

function analyzeDiceTrendLineHu(data, type) {
  if (data.length < 3) return { detected: false };
  
  const current = data[0];
  const previous = data[1];
  
  const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
  const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
  
  const directions = [];
  for (let i = 0; i < 3; i++) {
    if (currentDices[i] > previousDices[i]) {
      directions.push('up');
    } else if (currentDices[i] < previousDices[i]) {
      directions.push('down');
    } else {
      directions.push('same');
    }
  }
  
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;
  const sameCount = directions.filter(d => d === 'same').length;
  
  const previousResult = previous.Ket_qua;
  const weight = getPatternWeight(type, 'dice_trend_line');
  
  const allSameDice = currentDices[0] === currentDices[1] && currentDices[1] === currentDices[2];
  if (allSameDice) {
    const prediction = currentDices[0] >= 4 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'same_dice',
      prediction,
      confidence: Math.round(13 * weight),
      name: `Biểu Đồ Đường (3 xúc xắc giống ${currentDices[0]})`,
      patternId: 'dice_trend_line'
    };
  }
  
  const twoSameDice = (currentDices[0] === currentDices[1]) || 
                       (currentDices[1] === currentDices[2]) || 
                       (currentDices[0] === currentDices[2]);
  if (twoSameDice) {
    const prediction = previousResult === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'two_same_dice',
      prediction,
      confidence: Math.round(11 * weight),
      name: `Biểu Đồ Đường (2 xúc xắc giống - Bẻ ${previousResult})`,
      patternId: 'dice_trend_line'
    };
  }
  
  if (upCount === 1 && downCount === 2) {
    return {
      detected: true,
      type: 'trend_1up_2down',
      prediction: 'Tài',
      confidence: Math.round(12 * weight),
      name: `Biểu Đồ Đường (1 lên 2 xuống → Tài)`,
      patternId: 'dice_trend_line'
    };
  }
  
  if (upCount === 2 && downCount === 1) {
    return {
      detected: true,
      type: 'trend_2up_1down',
      prediction: 'Xỉu',
      confidence: Math.round(12 * weight),
      name: `Biểu Đồ Đường (2 lên 1 xuống → Xỉu)`,
      patternId: 'dice_trend_line'
    };
  }
  
  return { detected: false };
}

function analyzeDiceTrendLineMd5(data, type) {
  if (data.length < 3) return { detected: false };
  
  const current = data[0];
  const previous = data[1];
  const beforePrevious = data[2];
  
  const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
  const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
  const beforePrevDices = [beforePrevious.Xuc_xac_1, beforePrevious.Xuc_xac_2, beforePrevious.Xuc_xac_3];
  
  const directions = [];
  for (let i = 0; i < 3; i++) {
    if (currentDices[i] > previousDices[i]) {
      directions.push('up');
    } else if (currentDices[i] < previousDices[i]) {
      directions.push('down');
    } else {
      directions.push('same');
    }
  }
  
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;
  const sameCount = directions.filter(d => d === 'same').length;
  
  const previousResult = previous.Ket_qua;
  const weight = getPatternWeight(type, 'dice_trend_line_md5');
  
  const sortedDices = [...currentDices].sort((a, b) => b - a);
  if (sortedDices[0] === sortedDices[1] && sortedDices[0] >= 5) {
    const prediction = 'Xỉu';
    return {
      detected: true,
      type: 'double_high',
      prediction,
      confidence: Math.round(13 * weight),
      name: `MD5 Biểu Đồ (2 xúc xắc cao ${sortedDices[0]}-${sortedDices[1]} → Xỉu)`,
      patternId: 'dice_trend_line_md5'
    };
  }
  
  if (sortedDices[1] === sortedDices[2] && sortedDices[1] <= 2) {
    const prediction = 'Tài';
    return {
      detected: true,
      type: 'double_low',
      prediction,
      confidence: Math.round(13 * weight),
      name: `MD5 Biểu Đồ (2 xúc xắc thấp ${sortedDices[1]}-${sortedDices[2]} → Tài)`,
      patternId: 'dice_trend_line_md5'
    };
  }
  
  const sumCurrent = currentDices.reduce((a, b) => a + b, 0);
  const sumPrevious = previousDices.reduce((a, b) => a + b, 0);
  const sumBeforePrev = beforePrevDices.reduce((a, b) => a + b, 0);
  
  const sumTrendUp = sumCurrent > sumPrevious && sumPrevious > sumBeforePrev;
  const sumTrendDown = sumCurrent < sumPrevious && sumPrevious < sumBeforePrev;
  
  if (sumTrendUp || sumTrendDown) {
    const prediction = sumTrendUp ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'sum_trend_break',
      prediction,
      confidence: Math.round(12 * weight),
      name: `MD5 Biểu Đồ (Tổng ${sumTrendUp ? 'tăng' : 'giảm'} liên tục → Bẻ)`,
      patternId: 'dice_trend_line_md5'
    };
  }
  
  if (upCount === 1 && downCount === 2) {
    return {
      detected: true,
      type: 'trend_1up_2down',
      prediction: 'Tài',
      confidence: Math.round(11 * weight),
      name: `MD5 Biểu Đồ (1 lên 2 xuống → Tài)`,
      patternId: 'dice_trend_line_md5'
    };
  }
  
  if (upCount === 2 && downCount === 1) {
    return {
      detected: true,
      type: 'trend_2up_1down',
      prediction: 'Xỉu',
      confidence: Math.round(11 * weight),
      name: `MD5 Biểu Đồ (2 lên 1 xuống → Xỉu)`,
      patternId: 'dice_trend_line_md5'
    };
  }
  
  return { detected: false };
}

function analyzeDayGayHu(data, type) {
  if (data.length < 3) return { detected: false };
  
  const current = data[0];
  const previous = data[1];
  
  const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
  const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
  
  const directions = [];
  for (let i = 0; i < 3; i++) {
    if (currentDices[i] > previousDices[i]) {
      directions.push('up');
    } else if (currentDices[i] < previousDices[i]) {
      directions.push('down');
    } else {
      directions.push('same');
    }
  }
  
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;
  const sameCount = directions.filter(d => d === 'same').length;
  
  const weight = getPatternWeight(type, 'day_gay');
  
  if (sameCount === 2 && upCount === 1) {
    const sameIndices = directions.map((d, i) => d === 'same' ? i : -1).filter(i => i !== -1);
    const sameDiceValues = sameIndices.map(i => currentDices[i]);
    
    if (sameDiceValues[0] === sameDiceValues[1]) {
      return {
        detected: true,
        type: 'day_gay_2thang_1len',
        prediction: 'Xỉu',
        confidence: Math.round(14 * weight),
        name: `Dây Gãy (2 dây thẳng ${sameDiceValues[0]}-${sameDiceValues[1]} + 1 lên → Xỉu)`,
        patternId: 'day_gay'
      };
    }
  }
  
  if (sameCount === 2 && downCount === 1) {
    const sameIndices = directions.map((d, i) => d === 'same' ? i : -1).filter(i => i !== -1);
    const sameDiceValues = sameIndices.map(i => currentDices[i]);
    
    if (sameDiceValues[0] === sameDiceValues[1]) {
      return {
        detected: true,
        type: 'day_gay_2thang_1xuong',
        prediction: 'Tài',
        confidence: Math.round(14 * weight),
        name: `Dây Gãy (2 dây thẳng ${sameDiceValues[0]}-${sameDiceValues[1]} + 1 xuống → Tài)`,
        patternId: 'day_gay'
      };
    }
  }
  
  return { detected: false };
}

function analyzeDayGayMd5(data, type) {
  if (data.length < 3) return { detected: false };
  
  const current = data[0];
  const previous = data[1];
  
  const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
  const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
  
  const directions = [];
  for (let i = 0; i < 3; i++) {
    if (currentDices[i] > previousDices[i]) {
      directions.push('up');
    } else if (currentDices[i] < previousDices[i]) {
      directions.push('down');
    } else {
      directions.push('same');
    }
  }
  
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;
  const sameCount = directions.filter(d => d === 'same').length;
  
  const weight = getPatternWeight(type, 'day_gay_md5');
  
  if (sameCount === 2 && upCount === 1) {
    const sameIndices = directions.map((d, i) => d === 'same' ? i : -1).filter(i => i !== -1);
    const sameDiceValues = sameIndices.map(i => currentDices[i]);
    
    if (sameDiceValues[0] === sameDiceValues[1]) {
      return {
        detected: true,
        type: 'day_gay_2thang_1len',
        prediction: 'Xỉu',
        confidence: Math.round(14 * weight),
        name: `MD5 Dây Gãy (2 dây thẳng ${sameDiceValues[0]}-${sameDiceValues[1]} + 1 lên → Xỉu)`,
        patternId: 'day_gay_md5'
      };
    }
  }
  
  if (sameCount === 2 && downCount === 1) {
    const sameIndices = directions.map((d, i) => d === 'same' ? i : -1).filter(i => i !== -1);
    const sameDiceValues = sameIndices.map(i => currentDices[i]);
    
    if (sameDiceValues[0] === sameDiceValues[1]) {
      return {
        detected: true,
        type: 'day_gay_2thang_1xuong',
        prediction: 'Tài',
        confidence: Math.round(14 * weight),
        name: `MD5 Dây Gãy (2 dây thẳng ${sameDiceValues[0]}-${sameDiceValues[1]} + 1 xuống → Tài)`,
        patternId: 'day_gay_md5'
      };
    }
  }
  
  return { detected: false };
}

function analyzeBreakPatternHu(results, data, type) {
  if (results.length < 4) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_pattern_hu');
  
  const is1212 = results[0] !== results[1] && 
                  results[1] !== results[2] && 
                  results[2] !== results[3] &&
                  results[0] === results[2] &&
                  results[1] === results[3];
  
  if (is1212) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'pattern_1212',
      prediction,
      confidence: Math.round(14 * weight),
      name: `Cầu Liên Tục 1-2-1-2 (Bẻ → ${prediction})`,
      patternId: 'break_pattern_hu'
    };
  }
  
  const allSame = results.slice(0, 4).every(r => r === results[0]);
  if (allSame) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'pattern_1111',
      prediction,
      confidence: Math.round(13 * weight),
      name: `Cầu Liên Tục 1-1-1-1 (Bẻ → ${prediction})`,
      patternId: 'break_pattern_hu'
    };
  }
  
  return { detected: false };
}

function analyzeBreakPatternMd5(results, data, type) {
  if (results.length < 4) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_pattern_md5');
  
  const is1212 = results[0] !== results[1] && 
                  results[1] !== results[2] && 
                  results[2] !== results[3] &&
                  results[0] === results[2] &&
                  results[1] === results[3];
  
  if (is1212) {
    const prediction = results[0];
    return {
      detected: true,
      type: 'pattern_1212',
      prediction,
      confidence: Math.round(13 * weight),
      name: `MD5 Cầu 1-2-1-2 (Theo → ${prediction})`,
      patternId: 'break_pattern_md5'
    };
  }
  
  const allSame = results.slice(0, 4).every(r => r === results[0]);
  if (allSame) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'pattern_1111',
      prediction,
      confidence: Math.round(14 * weight),
      name: `MD5 Cầu 1-1-1-1 (Bẻ → ${prediction})`,
      patternId: 'break_pattern_md5'
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
  
  const velocityChange = (sums[0] - sums[1]) - (sums[1] - sums[2]);
  if (Math.abs(velocityChange) > 4) {
    const prediction = velocityChange > 0 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'momentum_reversal',
      prediction,
      confidence: Math.round(12 * weight),
      name: `Momentum Đảo Chiều (${velocityChange > 0 ? '+' : ''}${velocityChange} → ${prediction})`,
      patternId: 'momentum'
    };
  }
  
  return { detected: false };
}

function analyzeWavePattern(data, type) {
  if (data.length < 12) return { detected: false };
  
  const weight = getPatternWeight(type, 'wave');
  const results = data.slice(0, 12).map(d => d.Ket_qua);
  
  let waves = [];
  let currentWave = { type: results[0], count: 1 };
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === currentWave.type) {
      currentWave.count++;
    } else {
      waves.push(currentWave);
      currentWave = { type: results[i], count: 1 };
    }
  }
  waves.push(currentWave);
  
  if (waves.length >= 4) {
    const waveLengths = waves.slice(0, 4).map(w => w.count);
    const isIncreasing = waveLengths.every((v, i, a) => i === 0 || v >= a[i - 1]);
    const isDecreasing = waveLengths.every((v, i, a) => i === 0 || v <= a[i - 1]);
    
    if (isIncreasing && waveLengths[0] < waveLengths[3]) {
      const prediction = waves[0].type === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        type: 'wave_expanding',
        prediction,
        confidence: Math.round(12 * weight),
        name: `Sóng Mở Rộng (${waveLengths.join('-')} → Bẻ ${prediction})`,
        patternId: 'wave'
      };
    }
    
    if (isDecreasing && waveLengths[0] > waveLengths[3]) {
      const prediction = waves[0].type;
      return {
        detected: true,
        type: 'wave_contracting',
        prediction,
        confidence: Math.round(11 * weight),
        name: `Sóng Thu Hẹp (${waveLengths.join('-')} → Theo ${prediction})`,
        patternId: 'wave'
      };
    }
  }
  
  return { detected: false };
}

// ==================== ENSEMBLE PREDICTOR ====================
class EnsemblePredictor {
  constructor() {
    this.modelWeights = {
      fullHistorySim: 1.2,
      patternMatching: 1.1,
      anomalyDetection: 1.3,
      reinforcement: 0.8
    };
    this.modelPerformance = {
      fullHistorySim: { correct: 0, total: 0 },
      patternMatching: { correct: 0, total: 0 },
      anomalyDetection: { correct: 0, total: 0 },
      reinforcement: { correct: 0, total: 0 }
    };
  }

  updateModelPerformance(modelName, isCorrect) {
    if (this.modelPerformance[modelName]) {
      this.modelPerformance[modelName].total++;
      if (isCorrect) this.modelPerformance[modelName].correct++;
      
      if (this.modelPerformance[modelName].total >= 10) {
        const accuracy = this.modelPerformance[modelName].correct / this.modelPerformance[modelName].total;
        this.modelWeights[modelName] = 0.5 + accuracy;
        this.modelWeights[modelName] = Math.min(1.5, Math.max(0.5, this.modelWeights[modelName]));
      }
    }
  }

  getAdaptiveWeights() {
    return { ...this.modelWeights };
  }
}

// ==================== REINFORCEMENT LEARNING ====================
class ReinforcementLearner {
  constructor() {
    this.qTable = {};
    this.learningRate = 0.15;
    this.discountFactor = 0.92;
    this.epsilon = 0.15;
  }

  getState(results) {
    if (results.length < 5) return 'initial';
    const last5 = results.slice(0, 5).map(r => r === 'Tài' ? 'T' : 'X').join('');
    const streak = this.getStreak(results);
    const pattern = this.detectPatternType(results);
    return `${last5}_${streak}_${pattern}`;
  }

  getStreak(results) {
    if (results.length === 0) return 0;
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    return Math.min(streak, 5);
  }

  detectPatternType(results) {
    if (results.length < 4) return 'unknown';
    const isAlternating = results[0] !== results[1] && results[1] !== results[2];
    const isBet = results[0] === results[1] && results[1] === results[2];
    
    if (isBet) return 'bet';
    if (isAlternating) return 'alternating';
    return 'mixed';
  }

  getAction(state) {
    if (!this.qTable[state]) {
      this.qTable[state] = { Tai: 0.5, Xiu: 0.5 };
    }
    
    if (Math.random() < this.epsilon) {
      return Math.random() < 0.5 ? 'Tài' : 'Xỉu';
    }
    
    return this.qTable[state].Tai > this.qTable[state].Xiu ? 'Tài' : 'Xỉu';
  }

  update(state, action, reward, nextState) {
    if (!this.qTable[state]) this.qTable[state] = { Tai: 0.5, Xiu: 0.5 };
    if (!this.qTable[nextState]) this.qTable[nextState] = { Tai: 0.5, Xiu: 0.5 };
    
    const currentQ = this.qTable[state][action === 'Tài' ? 'Tai' : 'Xiu'];
    const maxNextQ = Math.max(this.qTable[nextState].Tai, this.qTable[nextState].Xiu);
    const newQ = currentQ + this.learningRate * (reward + this.discountFactor * maxNextQ - currentQ);
    
    this.qTable[state][action === 'Tài' ? 'Tai' : 'Xiu'] = Math.max(0, Math.min(1, newQ));
  }

  predict(state) {
    if (!this.qTable[state]) return null;
    const diff = this.qTable[state].Tai - this.qTable[state].Xiu;
    if (Math.abs(diff) < 0.1) return null;
    return diff > 0 ? 'Tài' : 'Xỉu';
  }
}

// ==================== ANOMALY DETECTION ====================
class OptimizedAnomalyDetector {
  constructor() {
    this.anomalyHistory = [];
    this.breakPoints = [];
    this.deceptionScore = 0;
  }

  detect(results, sums) {
    let anomalyScore = 0;
    let reasons = [];
    
    if (results.length < 10) return { isAnomaly: false, score: 0, reasons: [] };
    
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    
    if (streak >= 6) {
      anomalyScore += 0.25;
      reasons.push(`streak_${streak}`);
    }
    if (streak >= 8) {
      anomalyScore += 0.25;
      reasons.push(`long_streak_${streak}`);
    }
    
    let alternating = 1;
    for (let i = 1; i < Math.min(results.length, 15); i++) {
      if (results[i] !== results[i-1]) alternating++;
      else break;
    }
    
    if (alternating >= 8) {
      anomalyScore += 0.3;
      reasons.push(`alternating_${alternating}`);
    }
    
    const taiCount = results.slice(0, 20).filter(r => r === 'Tài').length;
    const ratio = taiCount / 20;
    
    if (ratio >= 0.8) {
      anomalyScore += 0.3;
      reasons.push(`tai_dominant_${(ratio*100).toFixed(0)}%`);
    } else if (ratio <= 0.2) {
      anomalyScore += 0.3;
      reasons.push(`xiu_dominant_${((1-ratio)*100).toFixed(0)}%`);
    }
    
    if (sums && sums.length >= 10) {
      const recentSums = sums.slice(0, 5);
      const prevSums = sums.slice(5, 10);
      const recentAvg = recentSums.reduce((a, b) => a + b, 0) / 5;
      const prevAvg = prevSums.reduce((a, b) => a + b, 0) / 5;
      
      if (Math.abs(recentAvg - prevAvg) > 3) {
        anomalyScore += 0.2;
        reasons.push(`sum_volatility_${Math.abs(recentAvg - prevAvg).toFixed(1)}`);
      }
    }
    
    const isAnomaly = anomalyScore > 0.4;
    this.deceptionScore = Math.min(0.95, anomalyScore);
    
    if (streak >= 4 && results[streak] !== results[0]) {
      this.breakPoints.push({
        from: results[0],
        to: results[streak],
        streakLength: streak,
        timestamp: new Date().toISOString()
      });
      
      if (this.breakPoints.length > 100) this.breakPoints.shift();
    }
    
    return {
      isAnomaly,
      score: anomalyScore,
      deceptionScore: this.deceptionScore,
      reasons,
      breakPrediction: this.predictBreak(results)
    };
  }

  predictBreak(results) {
    if (results.length < 5) return null;
    
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    
    if (streak >= 5 && streak <= 7) {
      return {
        willBreak: true,
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: 60 + (streak - 4) * 5
      };
    }
    
    if (streak >= 8) {
      return {
        willBreak: true,
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: 70 + Math.min(15, streak - 7)
      };
    }
    
    return { willBreak: false, confidence: 50 };
  }
}

// ==================== CORE DATA STRUCTURES ====================
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
  'cau_bet': 1.0, 'cau_dao_11': 1.0, 'cau_22': 1.0, 'cau_33': 1.0, 'cau_44': 1.0, 'cau_55': 1.0,
  'cau_121': 1.0, 'cau_123': 1.0, 'cau_321': 1.0, 'cau_212': 1.0, 'cau_1221': 1.0, 'cau_2112': 1.0,
  'cau_nhay_coc': 1.0, 'cau_nhip_nghieng': 1.0, 'cau_3van1': 1.0, 'cau_be_cau': 1.0,
  'cau_tu_nhien': 1.0, 'cau_gap': 1.0, 'cau_ziczac': 1.0, 'cau_doi': 1.0, 'cau_rong': 1.0,
  'smart_bet': 1.0, 'dice_trend_line': 1.0, 'dice_trend_line_md5': 1.0,
  'day_gay': 1.0, 'day_gay_md5': 1.0, 'break_pattern_hu': 1.0, 'break_pattern_md5': 1.0,
  'momentum': 1.0, 'wave': 1.0
};

let fullHistorySim = new FullHistorySimulation();
let anomalyDetector = new OptimizedAnomalyDetector();
let ensemblePredictor = new EnsemblePredictor();
let rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
let historicalData = { hu: [], md5: [] };

// ==================== HELPER FUNCTIONS ====================
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
  if (stats.recentResults.length > 20) {
    stats.recentResults.shift();
  }
  
  const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  
  const oldWeight = learningData[type].patternWeights[patternId];
  let newWeight = oldWeight;
  
  if (stats.recentResults.length >= 5) {
    if (recentAccuracy > 0.6) {
      newWeight = Math.min(2.0, oldWeight * 1.05);
    } else if (recentAccuracy < 0.4) {
      newWeight = Math.max(0.3, oldWeight * 0.95);
    }
  }
  
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22', 'Cầu 3-3': 'cau_33',
    'Cầu 4-4': 'cau_44', 'Cầu 5-5': 'cau_55', 'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321', 'Cầu 2-1-2': 'cau_212', 'Cầu 1-2-2-1': 'cau_1221', 'Cầu 2-1-1-2': 'cau_2112',
    'Cầu Nhảy Cóc': 'cau_nhay_coc', 'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng', 'Cầu 3 Ván 1': 'cau_3van1',
    'Cầu Bẻ Cầu': 'cau_be_cau', 'Cầu Tự Nhiên': 'cau_tu_nhien', 'Cầu Gấp': 'cau_gap',
    'Cầu Ziczac': 'cau_ziczac', 'Cầu Đôi': 'cau_doi', 'Cầu Rồng': 'cau_rong', 'Đảo Xu Hướng': 'smart_bet',
    'Biểu Đồ Đường': 'dice_trend_line', 'MD5 Biểu Đồ': 'dice_trend_line_md5',
    'Dây Gãy': 'day_gay', 'MD5 Dây Gãy': 'day_gay_md5', 'Cầu Liên Tục': 'break_pattern_hu',
    'MD5 Cầu': 'break_pattern_md5', 'Momentum': 'momentum', 'Sóng': 'wave'
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
    const data = transformApiData(response.data);
    if (data && data.length > 0) {
      historicalData.hu = data;
      fullHistorySim.buildHistoricalPatternDB('hu', data);
      fullHistorySim.buildMarkovChain('hu', data);
    }
    return data;
  } catch (error) {
    console.error('Error fetching HU data:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5);
    const data = transformApiData(response.data);
    if (data && data.length > 0) {
      historicalData.md5 = data;
      fullHistorySim.buildHistoricalPatternDB('md5', data);
      fullHistorySim.buildMarkovChain('md5', data);
    }
    return data;
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
      
      if (pred.factors && pred.factors.length > 0) {
        for (const factor of pred.factors) {
          const patternId = getPatternIdFromName(factor);
          if (patternId) {
            updatePatternPerformance(type, patternId, pred.isCorrect);
          }
        }
      }
      
      const state = rlLearner[type].getState(currentData.slice(0, 10).map(d => d.Ket_qua));
      const reward = pred.isCorrect ? 1 : -0.5;
      const nextState = rlLearner[type].getState(currentData.slice(1, 11).map(d => d.Ket_qua));
      rlLearner[type].update(state, pred.prediction, reward, nextState);
      
      ensemblePredictor.updateModelPerformance('patternMatching', pred.isCorrect);
      ensemblePredictor.updateModelPerformance('reinforcement', pred.isCorrect);
      
      fullHistorySim.updateFromVerification(type, pred.phien, pred.actual, pred.prediction);
      
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

// ==================== MAIN PREDICTION FUNCTION ====================
function calculateUltimatePrediction(data, type) {
  const results = data.slice(0, 30).map(d => d.Ket_qua);
  const sums = data.slice(0, 30).map(d => d.Tong);
  const diceData = data.slice(0, 10);
  
  initializePatternStats(type);
  
  let allPredictions = [];
  let factors = [];
  let allPatterns = [];
  
  // ========== CÁC THUẬT TOÁN CŨ ==========
  
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) {
    allPredictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: 10, name: cauBet.name });
    factors.push(cauBet.name);
    allPatterns.push(cauBet);
  }
  
  const cauDao11 = analyzeCauDao11(results, type);
  if (cauDao11.detected) {
    allPredictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: 9, name: cauDao11.name });
    factors.push(cauDao11.name);
    allPatterns.push(cauDao11);
  }
  
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) {
    allPredictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 8, name: cau22.name });
    factors.push(cau22.name);
    allPatterns.push(cau22);
  }
  
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) {
    allPredictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 8, name: cau33.name });
    factors.push(cau33.name);
    allPatterns.push(cau33);
  }
  
  const cau44 = analyzeCau44(results, type);
  if (cau44.detected) {
    allPredictions.push({ prediction: cau44.prediction, confidence: cau44.confidence, priority: 9, name: cau44.name });
    factors.push(cau44.name);
    allPatterns.push(cau44);
  }
  
  const cau55 = analyzeCau55(results, type);
  if (cau55.detected) {
    allPredictions.push({ prediction: cau55.prediction, confidence: cau55.confidence, priority: 9, name: cau55.name });
    factors.push(cau55.name);
    allPatterns.push(cau55);
  }
  
  const cau121 = analyzeCau121(results, type);
  if (cau121.detected) {
    allPredictions.push({ prediction: cau121.prediction, confidence: cau121.confidence, priority: 7, name: cau121.name });
    factors.push(cau121.name);
    allPatterns.push(cau121);
  }
  
  const cau123 = analyzeCau123(results, type);
  if (cau123.detected) {
    allPredictions.push({ prediction: cau123.prediction, confidence: cau123.confidence, priority: 7, name: cau123.name });
    factors.push(cau123.name);
    allPatterns.push(cau123);
  }
  
  const cau321 = analyzeCau321(results, type);
  if (cau321.detected) {
    allPredictions.push({ prediction: cau321.prediction, confidence: cau321.confidence, priority: 7, name: cau321.name });
    factors.push(cau321.name);
    allPatterns.push(cau321);
  }
  
  const cau212 = analyzeCau212(results, type);
  if (cau212.detected) {
    allPredictions.push({ prediction: cau212.prediction, confidence: cau212.confidence, priority: 8, name: cau212.name });
    factors.push(cau212.name);
    allPatterns.push(cau212);
  }
  
  const cau1221 = analyzeCau1221(results, type);
  if (cau1221.detected) {
    allPredictions.push({ prediction: cau1221.prediction, confidence: cau1221.confidence, priority: 8, name: cau1221.name });
    factors.push(cau1221.name);
    allPatterns.push(cau1221);
  }
  
  const cau2112 = analyzeCau2112(results, type);
  if (cau2112.detected) {
    allPredictions.push({ prediction: cau2112.prediction, confidence: cau2112.confidence, priority: 8, name: cau2112.name });
    factors.push(cau2112.name);
    allPatterns.push(cau2112);
  }
  
  const cauNhayCoc = analyzeCauNhayCoc(results, type);
  if (cauNhayCoc.detected) {
    allPredictions.push({ prediction: cauNhayCoc.prediction, confidence: cauNhayCoc.confidence, priority: 6, name: cauNhayCoc.name });
    factors.push(cauNhayCoc.name);
    allPatterns.push(cauNhayCoc);
  }
  
  const cauNhipNghieng = analyzeCauNhipNghieng(results, type);
  if (cauNhipNghieng.detected) {
    allPredictions.push({ prediction: cauNhipNghieng.prediction, confidence: cauNhipNghieng.confidence, priority: 7, name: cauNhipNghieng.name });
    factors.push(cauNhipNghieng.name);
    allPatterns.push(cauNhipNghieng);
  }
  
  const cau3Van1 = analyzeCau3Van1(results, type);
  if (cau3Van1.detected) {
    allPredictions.push({ prediction: cau3Van1.prediction, confidence: cau3Van1.confidence, priority: 6, name: cau3Van1.name });
    factors.push(cau3Van1.name);
    allPatterns.push(cau3Van1);
  }
  
  const cauBeCau = analyzeCauBeCau(results, type);
  if (cauBeCau.detected) {
    allPredictions.push({ prediction: cauBeCau.prediction, confidence: cauBeCau.confidence, priority: 8, name: cauBeCau.name });
    factors.push(cauBeCau.name);
    allPatterns.push(cauBeCau);
  }
  
  const cauGap = analyzeCauGap(results, type);
  if (cauGap.detected) {
    allPredictions.push({ prediction: cauGap.prediction, confidence: cauGap.confidence, priority: 7, name: cauGap.name });
    factors.push(cauGap.name);
    allPatterns.push(cauGap);
  }
  
  const cauZiczac = analyzeCauZiczac(results, type);
  if (cauZiczac.detected) {
    allPredictions.push({ prediction: cauZiczac.prediction, confidence: cauZiczac.confidence, priority: 8, name: cauZiczac.name });
    factors.push(cauZiczac.name);
    allPatterns.push(cauZiczac);
  }
  
  const cauDoi = analyzeCauDoi(results, type);
  if (cauDoi.detected) {
    allPredictions.push({ prediction: cauDoi.prediction, confidence: cauDoi.confidence, priority: 8, name: cauDoi.name });
    factors.push(cauDoi.name);
    allPatterns.push(cauDoi);
  }
  
  const cauRong = analyzeCauRong(results, type);
  if (cauRong.detected) {
    allPredictions.push({ prediction: cauRong.prediction, confidence: cauRong.confidence, priority: 10, name: cauRong.name });
    factors.push(cauRong.name);
    allPatterns.push(cauRong);
  }
  
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) {
    allPredictions.push({ prediction: smartBet.prediction, confidence: smartBet.confidence, priority: 9, name: smartBet.name });
    factors.push(smartBet.name);
    allPatterns.push(smartBet);
  }
  
  const momentumPattern = analyzeMomentumPattern(diceData, type);
  if (momentumPattern.detected) {
    allPredictions.push({ prediction: momentumPattern.prediction, confidence: momentumPattern.confidence, priority: 9, name: momentumPattern.name });
    factors.push(momentumPattern.name);
    allPatterns.push(momentumPattern);
  }
  
  const wavePattern = analyzeWavePattern(diceData, type);
  if (wavePattern.detected) {
    allPredictions.push({ prediction: wavePattern.prediction, confidence: wavePattern.confidence, priority: 8, name: wavePattern.name });
    factors.push(wavePattern.name);
    allPatterns.push(wavePattern);
  }
  
  if (type === 'hu') {
    const diceTrendLineHu = analyzeDiceTrendLineHu(diceData, type);
    if (diceTrendLineHu.detected) {
      allPredictions.push({ prediction: diceTrendLineHu.prediction, confidence: diceTrendLineHu.confidence, priority: 11, name: diceTrendLineHu.name });
      factors.push(diceTrendLineHu.name);
      allPatterns.push(diceTrendLineHu);
    }
    
    const breakPatternHu = analyzeBreakPatternHu(results, diceData, type);
    if (breakPatternHu.detected) {
      allPredictions.push({ prediction: breakPatternHu.prediction, confidence: breakPatternHu.confidence, priority: 12, name: breakPatternHu.name });
      factors.push(breakPatternHu.name);
      allPatterns.push(breakPatternHu);
    }
    
    const dayGayHu = analyzeDayGayHu(diceData, type);
    if (dayGayHu.detected) {
      allPredictions.push({ prediction: dayGayHu.prediction, confidence: dayGayHu.confidence, priority: 13, name: dayGayHu.name });
      factors.push(dayGayHu.name);
      allPatterns.push(dayGayHu);
    }
  }
  
  if (type === 'md5') {
    const diceTrendLineMd5 = analyzeDiceTrendLineMd5(diceData, type);
    if (diceTrendLineMd5.detected) {
      allPredictions.push({ prediction: diceTrendLineMd5.prediction, confidence: diceTrendLineMd5.confidence, priority: 11, name: diceTrendLineMd5.name });
      factors.push(diceTrendLineMd5.name);
      allPatterns.push(diceTrendLineMd5);
    }
    
    const breakPatternMd5 = analyzeBreakPatternMd5(results, diceData, type);
    if (breakPatternMd5.detected) {
      allPredictions.push({ prediction: breakPatternMd5.prediction, confidence: breakPatternMd5.confidence, priority: 12, name: breakPatternMd5.name });
      factors.push(breakPatternMd5.name);
      allPatterns.push(breakPatternMd5);
    }
    
    const dayGayMd5 = analyzeDayGayMd5(diceData, type);
    if (dayGayMd5.detected) {
      allPredictions.push({ prediction: dayGayMd5.prediction, confidence: dayGayMd5.confidence, priority: 13, name: dayGayMd5.name });
      factors.push(dayGayMd5.name);
      allPatterns.push(dayGayMd5);
    }
  }
  
  // ========== THUẬT TOÁN MỚI ==========
  
  // 1. FULL HISTORY SIMULATION
  const simResult = fullHistorySim.runFullHistorySimulation(data, type, 20000);
  allPredictions.push({
    prediction: simResult.prediction,
    confidence: simResult.confidence,
    priority: 12,
    weight: ensemblePredictor.modelWeights.fullHistorySim,
    name: `📊 Full History Sim`
  });
  factors.push(`FHS: ${simResult.taiProbability}`);
  
  // 2. ANOMALY DETECTION
  const anomaly = anomalyDetector.detect(results, sums);
  if (anomaly.isAnomaly) {
    factors.push(`⚠️ Anomaly (${anomaly.reasons.join(', ')})`);
  }
  if (anomaly.breakPrediction && anomaly.breakPrediction.willBreak) {
    allPredictions.push({
      prediction: anomaly.breakPrediction.prediction,
      confidence: anomaly.breakPrediction.confidence,
      priority: 11,
      weight: ensemblePredictor.modelWeights.anomalyDetection,
      name: `🔄 Break Prediction`
    });
    factors.push(`Break: ${anomaly.breakPrediction.prediction}`);
  }
  
  // 3. REINFORCEMENT LEARNING
  const rlState = rlLearner[type].getState(results);
  const rlPrediction = rlLearner[type].predict(rlState);
  if (rlPrediction) {
    allPredictions.push({
      prediction: rlPrediction,
      confidence: 62,
      priority: 7,
      weight: ensemblePredictor.modelWeights.reinforcement,
      name: `🧠 Q-Learning`
    });
    factors.push(`RL: ${rlPrediction}`);
  }
  
  // 4. Cầu Tự Nhiên (fallback)
  if (allPredictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    allPredictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
  }
  
  // TỔNG HỢP
  allPredictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  let taiScore = 0, xiuScore = 0, totalWeight = 0;
  
  for (const p of allPredictions) {
    const finalWeight = p.priority * (p.weight || 1);
    totalWeight += finalWeight;
    if (p.prediction === 'Tài') {
      taiScore += p.confidence * finalWeight;
    } else {
      xiuScore += p.confidence * finalWeight;
    }
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  if (anomaly.deceptionScore > 0.6) {
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    factors.push(`🛡️ Deception detected`);
  }
  
  let finalConfidence = totalWeight > 0 ? Math.round(Math.max(taiScore, xiuScore) / totalWeight * 100) : 55;
  finalConfidence = Math.max(50, Math.min(88, finalConfidence));
  finalConfidence += getAdaptiveConfidenceBoost(type);
  finalConfidence = Math.max(50, Math.min(88, finalConfidence));
  
  if (simResult.similarPatternsFound > 50) {
    finalConfidence = Math.min(88, finalConfidence + 3);
  }
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors: factors.slice(0, 5),
    simulationDetails: simResult,
    anomalyScore: anomaly.deceptionScore,
    patternsFound: allPatterns.length,
    ensembleWeights: ensemblePredictor.getAdaptiveWeights()
  };
}

// ==================== AUTO PROCESS ====================
async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        const result = calculateUltimatePrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | FHS: ${result.simulationDetails.taiProbability}`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        const result = calculateUltimatePrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | FHS: ${result.simulationDetails.taiProbability}`);
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
    await verifyPredictions('hu', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateUltimatePrediction(data, 'hu');
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
    await verifyPredictions('md5', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateUltimatePrediction(data, 'md5');
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
    await verifyPredictions('hu', data);
    const result = calculateUltimatePrediction(data, 'hu');
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      simulation: result.simulationDetails,
      ensembleWeights: result.ensembleWeights,
      anomalyScore: result.anomalyScore
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    await verifyPredictions('md5', data);
    const result = calculateUltimatePrediction(data, 'md5');
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      simulation: result.simulationDetails,
      ensembleWeights: result.ensembleWeights,
      anomalyScore: result.anomalyScore
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
      weight: stats.patternWeights[id]?.toFixed(2) || '1.00'
    })).filter(p => p.total > 0),
    ensembleWeights: ensemblePredictor.getAdaptiveWeights(),
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
      weight: stats.patternWeights[id]?.toFixed(2) || '1.00'
    })).filter(p => p.total > 0),
    ensembleWeights: ensemblePredictor.getAdaptiveWeights(),
    lastUpdate: stats.lastUpdate
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: { ...DEFAULT_PATTERN_WEIGHTS }, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] }
  };
  fullHistorySim = new FullHistorySimulation();
  anomalyDetector = new OptimizedAnomalyDetector();
  ensemblePredictor = new EnsemblePredictor();
  rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
  saveLearningData();
  res.json({ message: 'All learning data reset' });
});

// ==================== START SERVER ====================
loadLearningData();
loadPredictionHistory();
fullHistorySim.loadSimulationCache();

Promise.all([fetchDataHu(), fetchDataMd5()]).then(() => {
  console.log('Initial data loaded');
});

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 5000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║   LẨU CUA 79 - ULTIMATE AI v9.0 - FULL HISTORY SIMULATION                 ║`);
  console.log(`║   ✅ GIỮ NGUYÊN TẤT CẢ THUẬT TOÁN CŨ + BỔ SUNG THUẬT TOÁN MỚI             ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server: http://0.0.0.0:${PORT}`);
  console.log(`\n📊 THUẬT TOÁN CŨ (ĐÃ GIỮ NGUYÊN):`);
  console.log(`  - Cầu Bệt, Đảo 1-1, 2-2, 3-3, 4-4, 5-5`);
  console.log(`  - Cầu 1-2-1, 1-2-3, 3-2-1, 2-1-2, 1-2-2-1, 2-1-1-2`);
  console.log(`  - Cầu Nhảy Cóc, Nhịp Nghiêng, Ziczac`);
  console.log(`  - Cầu 3 Ván 1, Bẻ Cầu, Chu Kỳ`);
  console.log(`  - Cầu Đôi, Cầu Gấp, Cầu Rồng`);
  console.log(`  - Biểu Đồ Đường, Dây Gãy (Hũ & MD5)`);
  console.log(`  - Smart Bet, Momentum, Wave Pattern`);
  console.log(`\n🚀 THUẬT TOÁN MỚI BỔ SUNG:`);
  console.log(`  - Full History Simulation (20,000 iterations)`);
  console.log(`  - Similar Pattern Matching + Markov Chain`);
  console.log(`  - Anomaly Detection & Deception Detection`);
  console.log(`  - Q-Learning Reinforcement`);
  console.log(`  - Ensemble Predictor với Adaptive Weights\n`);
  console.log(`📋 ENDPOINTS:`);
  console.log(`  GET /lc79-hu         - Dự đoán Tài Xỉu Hũ`);
  console.log(`  GET /lc79-md5        - Dự đoán Tài Xỉu MD5`);
  console.log(`  GET /lc79-hu/lichsu  - Lịch sử dự đoán Hũ`);
  console.log(`  GET /lc79-md5/lichsu - Lịch sử dự đoán MD5`);
  console.log(`  GET /lc79-hu/analysis- Phân tích chi tiết`);
  console.log(`  GET /lc79-hu/learning- Thống kê học tập`);
  console.log(`  GET /reset-learning   - Reset dữ liệu học\n`);
});
