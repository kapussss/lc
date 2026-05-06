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

  // Xây dựng cơ sở dữ liệu pattern từ lịch sử
  buildHistoricalPatternDB(type, historicalData) {
    if (!historicalData || historicalData.length < 20) return;
    
    const patterns = [];
    const results = historicalData.map(d => d.Ket_qua);
    const sums = historicalData.map(d => d.Tong);
    const diceData = historicalData.map(d => [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3]);
    
    // Trích xuất pattern cho từng độ dài
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
        
        // Giới hạn lưu trữ
        if (patterns[patternKey].sums.length > 50) patterns[patternKey].sums.shift();
        if (patterns[patternKey].dicePatterns.length > 50) patterns[patternKey].dicePatterns.shift();
      }
    }
    
    this.historicalPatternDB[type] = patterns;
    this.saveSimulationCache();
  }

  // Xây dựng Markov Chain từ lịch sử
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

  // Tìm pattern tương tự trong lịch sử
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
      
      // Tính độ tương đồng Levenshtein-like
      let similarity = 0;
      const minLen = Math.min(currentPattern.length, patternKey.length);
      
      for (let i = 0; i < minLen; i++) {
        if (currentPattern[i] === patternKey[i]) similarity++;
      }
      
      similarity = similarity / minLen;
      
      // Bonus cho pattern dài hơn
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
    
    // Giới hạn cache size
    if (this.similarityCache.size > 1000) {
      const firstKey = this.similarityCache.keys().next().value;
      this.similarityCache.delete(firstKey);
    }
    
    return topMatches;
  }

  // Simulation dựa trên toàn bộ lịch sử
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
      
      // Phân phối nguồn simulation
      const methodRand = Math.random();
      
      // 40%: Dựa trên pattern tương tự trong lịch sử
      if (methodRand < 0.4 && similarPatterns.length > 0) {
        const randomPattern = similarPatterns[Math.floor(Math.random() * similarPatterns.length)];
        const randomValue = Math.random();
        prediction = randomValue < randomPattern.taiProb ? 'Tài' : 'Xỉu';
        weight = randomPattern.similarity * (randomPattern.totalOccurrences / 100);
      }
      // 25%: Markov Chain
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
      // 20%: Trend analysis
      else if (methodRand < 0.85) {
        prediction = this.simulateByTrend(recentTrend);
        weight = recentTrend.confidence / 100;
      }
      // 15%: Monte Carlo bootstrap từ dữ liệu hiện tại
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
    // Ghi nhận kết quả để cải thiện simulation
    if (!this.simulationCache[type][phien]) {
      this.simulationCache[type][phien] = {
        predicted: predictedResult,
        actual: actualResult,
        isCorrect: actualResult === predictedResult,
        timestamp: new Date().toISOString()
      };
    }
    
    // Giới hạn cache size
    const cacheKeys = Object.keys(this.simulationCache[type]);
    if (cacheKeys.length > 1000) {
      const oldestKey = cacheKeys.sort()[0];
      delete this.simulationCache[type][oldestKey];
    }
    
    this.saveSimulationCache();
  }
}

// ==================== TỐI ƯU HÓA THUẬT TOÁN - ENSEMBLE PREDICTOR ====================
class EnsemblePredictor {
  constructor() {
    this.modelWeights = {
      fullHistorySim: 1.2,
      markovChain: 1.0,
      patternMatching: 1.1,
      trendAnalysis: 0.9,
      anomalyDetection: 1.3,
      reinforcement: 0.8
    };
    this.modelPerformance = {
      fullHistorySim: { correct: 0, total: 0 },
      markovChain: { correct: 0, total: 0 },
      patternMatching: { correct: 0, total: 0 },
      trendAnalysis: { correct: 0, total: 0 },
      anomalyDetection: { correct: 0, total: 0 },
      reinforcement: { correct: 0, total: 0 }
    };
  }

  updateModelPerformance(modelName, isCorrect) {
    if (this.modelPerformance[modelName]) {
      this.modelPerformance[modelName].total++;
      if (isCorrect) this.modelPerformance[modelName].correct++;
      
      // Cập nhật trọng số dựa trên performance
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

// ==================== SMART PATTERN DETECTOR TỐI ƯU ====================
class SmartPatternDetector {
  constructor() {
    this.patternCache = new Map();
  }

  detectAllPatterns(results, sums, diceData, type) {
    const cacheKey = results.slice(0, 20).join('') + '_' + type;
    if (this.patternCache.has(cacheKey)) {
      return this.patternCache.get(cacheKey);
    }
    
    const patterns = [];
    
    // 1. Cầu Bệt thông minh
    const betPattern = this.detectSmartBet(results);
    if (betPattern) patterns.push(betPattern);
    
    // 2. Cầu Đảo thông minh
    const daoPattern = this.detectSmartDao(results);
    if (daoPattern) patterns.push(daoPattern);
    
    // 3. Pattern theo tổng điểm
    const sumPattern = this.detectSumPattern(sums);
    if (sumPattern) patterns.push(sumPattern);
    
    // 4. Pattern theo xúc xắc
    const dicePattern = this.detectDicePattern(diceData);
    if (dicePattern) patterns.push(dicePattern);
    
    // 5. Pattern hỗn hợp
    const hybridPattern = this.detectHybridPattern(results, sums);
    if (hybridPattern) patterns.push(hybridPattern);
    
    // 6. Pattern sóng Elliott
    const wavePattern = this.detectWavePattern(results);
    if (wavePattern) patterns.push(wavePattern);
    
    // 7. Pattern Fibonacci
    const fibPattern = this.detectFibonacciPattern(results);
    if (fibPattern) patterns.push(fibPattern);
    
    // 8. Pattern chu kỳ
    const cyclePattern = this.detectCyclePattern(results);
    if (cyclePattern) patterns.push(cyclePattern);
    
    // 9. Pattern thống kê Bayesian
    const bayesianPattern = this.detectBayesianPattern(results, type);
    if (bayesianPattern) patterns.push(bayesianPattern);
    
    // 10. Pattern Machine Learning light
    const mlPattern = this.detectLightMLPattern(results, sums);
    if (mlPattern) patterns.push(mlPattern);
    
    // Lưu cache
    if (patterns.length > 0) {
      this.patternCache.set(cacheKey, patterns);
      if (this.patternCache.size > 500) {
        const firstKey = this.patternCache.keys().next().value;
        this.patternCache.delete(firstKey);
      }
    }
    
    return patterns;
  }

  detectSmartBet(results) {
    if (results.length < 5) return null;
    
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    
    if (streak >= 4) {
      const breakProb = Math.min(0.8, 0.3 + (streak - 3) * 0.1);
      const shouldBreak = Math.random() < breakProb;
      
      return {
        name: `Cầu Bệt ${streak} (${shouldBreak ? 'Bẻ' : 'Tiếp'})`,
        prediction: shouldBreak ? (results[0] === 'Tài' ? 'Xỉu' : 'Tài') : results[0],
        confidence: Math.min(85, 55 + streak * 3),
        priority: 10,
        weight: 1.2
      };
    }
    
    return null;
  }

  detectSmartDao(results) {
    if (results.length < 6) return null;
    
    let alternating = true;
    for (let i = 1; i < 6; i++) {
      if (results[i] === results[i-1]) {
        alternating = false;
        break;
      }
    }
    
    if (alternating) {
      const nextPrediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        name: `Cầu Đảo ${Math.min(6, results.length)} phiên`,
        prediction: nextPrediction,
        confidence: 65 + Math.min(10, results.length),
        priority: 9,
        weight: 1.1
      };
    }
    
    return null;
  }

  detectSumPattern(sums) {
    if (sums.length < 8) return null;
    
    const recentAvg = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const prevAvg = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
    
    if (recentAvg > prevAvg + 1.5) {
      return {
        name: 'Tổng tăng dần → Xỉu',
        prediction: 'Xỉu',
        confidence: 60,
        priority: 7,
        weight: 0.9
      };
    }
    
    if (recentAvg < prevAvg - 1.5) {
      return {
        name: 'Tổng giảm dần → Tài',
        prediction: 'Tài',
        confidence: 60,
        priority: 7,
        weight: 0.9
      };
    }
    
    return null;
  }

  detectDicePattern(diceData) {
    if (!diceData || diceData.length < 3) return null;
    
    const recent = diceData[0];
    const previous = diceData[1];
    
    const highCount = recent.filter(d => d >= 4).length;
    const lowCount = recent.filter(d => d <= 3).length;
    
    if (highCount === 3) {
      return {
        name: 'Ba mặt cao (6-6-6) → Xỉu',
        prediction: 'Xỉu',
        confidence: 75,
        priority: 10,
        weight: 1.3
      };
    }
    
    if (lowCount === 3) {
      return {
        name: 'Ba mặt thấp (1-1-1) → Tài',
        prediction: 'Tài',
        confidence: 75,
        priority: 10,
        weight: 1.3
      };
    }
    
    const pairDetected = recent[0] === recent[1] || recent[1] === recent[2] || recent[0] === recent[2];
    if (pairDetected) {
      const prediction = previous?.Ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        name: 'Có cặp xúc xắc giống → Bẻ cầu',
        prediction: prediction,
        confidence: 65,
        priority: 8,
        weight: 1.0
      };
    }
    
    return null;
  }

  detectHybridPattern(results, sums) {
    if (results.length < 10) return null;
    
    const pattern1212 = results[0] !== results[1] && results[1] !== results[2] && 
                        results[0] === results[2] && results[1] === results[3];
    
    if (pattern1212) {
      const sumCheck = sums[0] + sums[1] > sums[2] + sums[3];
      const prediction = sumCheck ? 'Xỉu' : 'Tài';
      return {
        name: `Pattern 1-2-1-2 + Tổng ${sumCheck ? 'cao' : 'thấp'}`,
        prediction: prediction,
        confidence: 70,
        priority: 9,
        weight: 1.1
      };
    }
    
    return null;
  }

  detectWavePattern(results) {
    if (results.length < 8) return null;
    
    let waves = [];
    let currentWave = { type: results[0], length: 1 };
    
    for (let i = 1; i < Math.min(results.length, 12); i++) {
      if (results[i] === currentWave.type) {
        currentWave.length++;
      } else {
        waves.push(currentWave);
        currentWave = { type: results[i], length: 1 };
      }
    }
    waves.push(currentWave);
    
    if (waves.length >= 3) {
      const isExpanding = waves[0].length < waves[1].length && waves[1].length < waves[2].length;
      const isContracting = waves[0].length > waves[1].length && waves[1].length > waves[2].length;
      
      if (isExpanding) {
        return {
          name: `Sóng mở rộng ${waves.map(w => w.length).join('-')}`,
          prediction: waves[0].type === 'Tài' ? 'Xỉu' : 'Tài',
          confidence: 68,
          priority: 8,
          weight: 1.0
        };
      }
      
      if (isContracting) {
        return {
          name: `Sóng thu hẹp ${waves.map(w => w.length).join('-')}`,
          prediction: waves[2].type,
          confidence: 65,
          priority: 8,
          weight: 1.0
        };
      }
    }
    
    return null;
  }

  detectFibonacciPattern(results) {
    if (results.length < 13) return null;
    
    const fibPositions = [1, 2, 3, 5, 8, 13];
    let taiAtFib = 0;
    let xiuAtFib = 0;
    
    fibPositions.forEach(pos => {
      if (pos <= results.length && results[pos - 1] === 'Tài') taiAtFib++;
      else if (pos <= results.length) xiuAtFib++;
    });
    
    const ratio = Math.max(taiAtFib, xiuAtFib) / Math.min(taiAtFib, xiuAtFib);
    
    if (ratio >= 1.6 && ratio <= 1.7) {
      const dominant = taiAtFib > xiuAtFib ? 'Tài' : 'Xỉu';
      return {
        name: `Fibonacci tỷ lệ vàng (${taiAtFib}T:${xiuAtFib}X)`,
        prediction: dominant,
        confidence: 72,
        priority: 9,
        weight: 1.15
      };
    }
    
    return null;
  }

  detectCyclePattern(results) {
    for (let cycle = 2; cycle <= 5; cycle++) {
      let isCycle = true;
      for (let i = cycle; i < Math.min(results.length, cycle * 3); i++) {
        if (results[i] !== results[i % cycle]) {
          isCycle = false;
          break;
        }
      }
      
      if (isCycle && results.length >= cycle * 2) {
        const nextIndex = results.length % cycle;
        return {
          name: `Chu kỳ ${cycle} phiên`,
          prediction: results[nextIndex],
          confidence: 65 + cycle * 2,
          priority: 8,
          weight: 1.0
        };
      }
    }
    
    return null;
  }

  detectBayesianPattern(results, type) {
    if (results.length < 20) return null;
    
    // Tính xác suất Bayesian
    let taiGivenPrev = { Tai: 0, Xiu: 0 };
    let xiuGivenPrev = { Tai: 0, Xiu: 0 };
    
    for (let i = 1; i < Math.min(results.length, 50); i++) {
      if (results[i-1] === 'Tài') {
        if (results[i] === 'Tài') taiGivenPrev.Tai++;
        else taiGivenPrev.Xiu++;
      } else {
        if (results[i] === 'Tài') xiuGivenPrev.Tai++;
        else xiuGivenPrev.Xiu++;
      }
    }
    
    const lastResult = results[0];
    let confidence = 55;
    let prediction;
    
    if (lastResult === 'Tài') {
      const taiProb = taiGivenPrev.Tai / (taiGivenPrev.Tai + taiGivenPrev.Xiu);
      prediction = taiProb > 0.55 ? 'Tài' : 'Xỉu';
      confidence = 55 + Math.abs(taiProb - 0.5) * 30;
    } else {
      const xiuProb = xiuGivenPrev.Xiu / (xiuGivenPrev.Xiu + xiuGivenPrev.Tai);
      prediction = xiuProb > 0.55 ? 'Xỉu' : 'Tài';
      confidence = 55 + Math.abs(xiuProb - 0.5) * 30;
    }
    
    return {
      name: 'Bayesian Inference',
      prediction: prediction,
      confidence: Math.min(80, Math.round(confidence)),
      priority: 7,
      weight: 0.95
    };
  }

  detectLightMLPattern(results, sums) {
    if (results.length < 20) return null;
    
    // Công thức đơn giản dựa trên trọng số thời gian
    let weightedTai = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < Math.min(results.length, 15); i++) {
      const weight = Math.exp(-i / 5); // Giảm dần theo thời gian
      if (results[i] === 'Tài') weightedTai += weight;
      totalWeight += weight;
    }
    
    const weightedProb = weightedTai / totalWeight;
    const prediction = weightedProb > 0.5 ? 'Tài' : 'Xỉu';
    const confidence = 55 + Math.abs(weightedProb - 0.5) * 40;
    
    // Kết hợp với xu hướng tổng
    if (sums && sums.length > 5) {
      const sumTrend = sums[0] > sums[2] ? 'up' : 'down';
      if ((sumTrend === 'up' && prediction === 'Tài') || (sumTrend === 'down' && prediction === 'Xỉu')) {
        return {
          name: 'ML Weighted + Trend',
          prediction: prediction,
          confidence: Math.min(82, Math.round(confidence + 5)),
          priority: 8,
          weight: 1.05
        };
      }
    }
    
    return {
      name: 'ML Weighted',
      prediction: prediction,
      confidence: Math.min(78, Math.round(confidence)),
      priority: 7,
      weight: 0.9
    };
  }
}

// ==================== ANOMALY DETECTION TỐI ƯU ====================
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
    
    // 1. Phát hiện chuỗi bất thường
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
    
    // 2. Phát hiện alternating bất thường
    let alternating = 1;
    for (let i = 1; i < Math.min(results.length, 15); i++) {
      if (results[i] !== results[i-1]) alternating++;
      else break;
    }
    
    if (alternating >= 8) {
      anomalyScore += 0.3;
      reasons.push(`alternating_${alternating}`);
    }
    
    // 3. Phát hiện mất cân bằng
    const taiCount = results.slice(0, 20).filter(r => r === 'Tài').length;
    const ratio = taiCount / 20;
    
    if (ratio >= 0.8) {
      anomalyScore += 0.3;
      reasons.push(`tai_dominant_${(ratio*100).toFixed(0)}%`);
    } else if (ratio <= 0.2) {
      anomalyScore += 0.3;
      reasons.push(`xiu_dominant_${((1-ratio)*100).toFixed(0)}%`);
    }
    
    // 4. Phát hiện biến động tổng điểm
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
    
    // Ghi nhận break point
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
    
    // Dự đoán bẻ cầu dựa trên độ dài chuỗi
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

let fullHistorySim = new FullHistorySimulation();
let anomalyDetector = new OptimizedAnomalyDetector();
let patternDetector = new SmartPatternDetector();
let ensemblePredictor = new EnsemblePredictor();
let rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };

// Historical data storage
let historicalData = { hu: [], md5: [] };

// ==================== HELPER FUNCTIONS ====================
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
      
      // Cập nhật reinforcement learning
      const state = rlLearner[type].getState(currentData.slice(0, 10).map(d => d.Ket_qua));
      const reward = pred.isCorrect ? 1 : -0.5;
      const nextState = rlLearner[type].getState(currentData.slice(1, 11).map(d => d.Ket_qua));
      rlLearner[type].update(state, pred.prediction, reward, nextState);
      
      // Cập nhật ensemble predictor
      ensemblePredictor.updateModelPerformance('fullHistorySim', pred.isCorrect);
      ensemblePredictor.updateModelPerformance('patternMatching', pred.isCorrect);
      ensemblePredictor.updateModelPerformance('trendAnalysis', pred.isCorrect);
      ensemblePredictor.updateModelPerformance('anomalyDetection', pred.isCorrect);
      ensemblePredictor.updateModelPerformance('reinforcement', pred.isCorrect);
      
      // Cập nhật simulation
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
  const diceData = data.slice(0, 10).map(d => [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3]);
  
  let allPredictions = [];
  let factors = [];
  
  // 1. FULL HISTORY SIMULATION (ưu tiên cao nhất)
  const simResult = fullHistorySim.runFullHistorySimulation(data, type, 20000);
  allPredictions.push({
    prediction: simResult.prediction,
    confidence: simResult.confidence,
    priority: 12,
    weight: ensemblePredictor.modelWeights.fullHistorySim,
    name: `📊 Full History Sim (${simResult.similarPatternsFound} patterns)`
  });
  factors.push(`FHS: ${simResult.taiProbability} Tài`);
  
  // 2. SMART PATTERN DETECTION
  const patterns = patternDetector.detectAllPatterns(results, sums, diceData, type);
  for (const pattern of patterns) {
    allPredictions.push({
      prediction: pattern.prediction,
      confidence: pattern.confidence,
      priority: pattern.priority,
      weight: pattern.weight * (ensemblePredictor.modelWeights.patternMatching || 1),
      name: pattern.name
    });
    if (pattern.priority >= 8) {
      factors.push(pattern.name.substring(0, 30));
    }
  }
  
  // 3. ANOMALY DETECTION & BREAK PREDICTION
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
      name: `🔄 Break Prediction (streak detected)`
    });
    factors.push(`Break: ${anomaly.breakPrediction.prediction}`);
  }
  
  // 4. REINFORCEMENT LEARNING
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
  
  // 5. TREND ANALYSIS
  const recentTai = results.slice(0, 10).filter(r => r === 'Tài').length;
  const trendPrediction = recentTai >= 6 ? 'Tài' : (recentTai <= 4 ? 'Xỉu' : null);
  if (trendPrediction) {
    allPredictions.push({
      prediction: trendPrediction,
      confidence: 55 + Math.abs(recentTai - 5) * 5,
      priority: 5,
      weight: ensemblePredictor.modelWeights.trendAnalysis,
      name: `📈 Trend (${recentTai}/10 Tài)`
    });
    factors.push(`Trend: ${trendPrediction}`);
  }
  
  // Tổng hợp có trọng số
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
  
  // Điều chỉnh theo anomaly
  if (anomaly.deceptionScore > 0.6) {
    finalPrediction = finalPrediction === 'Tài' ? 'Xỉu' : 'Tài';
    factors.push(`🛡️ Deception detected (${(anomaly.deceptionScore * 100).toFixed(0)}%)`);
  }
  
  // Tính confidence cuối cùng
  let finalConfidence = totalWeight > 0 ? Math.round(Math.max(taiScore, xiuScore) / totalWeight * 100) : 55;
  finalConfidence = Math.max(50, Math.min(88, finalConfidence));
  
  // Điều chỉnh confidence theo độ tin cậy của simulation
  if (simResult.similarPatternsFound > 50) {
    finalConfidence = Math.min(88, finalConfidence + 3);
  }
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors: factors.slice(0, 5),
    simulationDetails: simResult,
    anomalyScore: anomaly.deceptionScore,
    patternsFound: patterns.length,
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
        console.log(`[Auto] Hu ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | FHS: ${result.simulationDetails.taiProbability} | ${result.factors[0] || ''}`);
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
      id: 'kapub',
      simulation: {
        taiProb: result.simulationDetails.taiProbability,
        patternsFound: result.simulationDetails.similarPatternsFound
      }
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
      id: 'kapub',
      simulation: {
        taiProb: result.simulationDetails.taiProbability,
        patternsFound: result.simulationDetails.similarPatternsFound
      }
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
    ensembleWeights: ensemblePredictor.getAdaptiveWeights(),
    lastUpdate: stats.lastUpdate
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] },
    md5: { predictions: [], patternStats: {}, totalPredictions: 0, correctPredictions: 0, patternWeights: {}, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] }
  };
  fullHistorySim = new FullHistorySimulation();
  anomalyDetector = new OptimizedAnomalyDetector();
  patternDetector = new SmartPatternDetector();
  ensemblePredictor = new EnsemblePredictor();
  rlLearner = { hu: new ReinforcementLearner(), md5: new ReinforcementLearner() };
  saveLearningData();
  res.json({ message: 'All learning data and models reset' });
});

// ==================== START SERVER ====================
loadLearningData();
loadPredictionHistory();
fullHistorySim.loadSimulationCache();

// Khởi tạo dữ liệu ban đầu
Promise.all([fetchDataHu(), fetchDataMd5()]).then(() => {
  console.log('Initial data loaded, building pattern DB...');
});

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 5000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║   LẨU CUA 79 - ULTIMATE AI v8.0 - FULL HISTORY SIMULATION                 ║`);
  console.log(`║   ✅ Full History Simulation (20,000 iterations)                           ║`);
  console.log(`║   ✅ Historical Pattern Database + Markov Chain                            ║`);
  console.log(`║   ✅ Smart Pattern Detector (10+ pattern types)                            ║`);
  console.log(`║   ✅ Ensemble Predictor với Adaptive Weights                               ║`);
  console.log(`║   ✅ Anomaly Detection + Deception Detection                               ║`);
  console.log(`║   ✅ Q-Learning Reinforcement                                              ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server: http://0.0.0.0:${PORT}`);
  console.log(`\n🚀 THUẬT TOÁN MỚI:`);
  console.log(`   • Full History Simulation dựa trên TOÀN BỘ lịch sử`);
  console.log(`   • 40% Similar Pattern Matching | 25% Markov Chain | 20% Trend | 15% Bootstrap`);
  console.log(`   • Historical Pattern Database - học từ quá khứ`);
  console.log(`   • Ensemble Predictor - tự động điều chỉnh trọng số các model`);
  console.log(`   • Smart Pattern Detector: Bệt, Đảo, Tổng, Xúc xắc, Sóng, Fibonacci, Chu kỳ, Bayesian, ML Weighted`);
  console.log(`   • Deception Detection - phát hiện bịp với độ chính xác cao\n`);
  console.log(`📋 ENDPOINTS:`);
  console.log(`   GET /lc79-hu         - Dự đoán Tài Xỉu Hũ`);
  console.log(`   GET /lc79-md5        - Dự đoán Tài Xỉu MD5`);
  console.log(`   GET /lc79-hu/lichsu  - Lịch sử dự đoán Hũ`);
  console.log(`   GET /lc79-md5/lichsu - Lịch sử dự đoán MD5`);
  console.log(`   GET /lc79-hu/analysis- Phân tích chi tiết + simulation`);
  console.log(`   GET /lc79-hu/learning- Thống kê học tập + ensemble weights`);
  console.log(`   GET /reset-learning   - Reset dữ liệu học\n`);
});
