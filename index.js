const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const DATA_FILE = 'ai_vip_ultimate.json';

// ==================== CẤU HÌNH NÂNG CẤP ====================
const AI_CONFIG = {
  version: 'ULTRA-AI-v2.0',
  targetAccuracy: 0.72,
  minConfidence: 62,
  maxConfidence: 90,
  analysisDepth: 120,
  riskThreshold: 0.8,
  learningRate: 0.05,
  patternWeights: {
    dice_trendline: 1.35,
    probability_advanced: 1.3,
    neural_network: 1.4,
    quantum_math: 1.45,
    cheat_detection: 1.5,
    ensemble_voting: 1.6
  }
};

// ==================== CẤU TRÚC DỮ LIỆU NÂNG CẤP ====================
let aiSystem = {
  system: {
    version: AI_CONFIG.version,
    startupTime: new Date().toISOString(),
    totalPredictions: 0,
    averageAccuracy: 0
  },
  
  history: {
    hu: [],
    md5: []
  },
  
  stats: {
    hu: {
      total: 0, correct: 0, streak: 0, bestStreak: 0,
      daily: { wins: 0, losses: 0, accuracy: 0 },
      patternAccuracy: {},
      confidenceCalibration: { over: 0, under: 0, perfect: 0 }
    },
    md5: {
      total: 0, correct: 0, streak: 0, bestStreak: 0,
      daily: { wins: 0, losses: 0, accuracy: 0 },
      patternAccuracy: {},
      confidenceCalibration: { over: 0, under: 0, perfect: 0 }
    }
  },
  
  models: {
    mathAnalysis: {
      fibonacci: { accuracy: 0.5, weight: 1.2 },
      goldenRatio: { accuracy: 0.5, weight: 1.2 },
      probability: { accuracy: 0.5, weight: 1.3 },
      statistical: { accuracy: 0.5, weight: 1.25 }
    },
    
    patternDetection: {
      diceTrend: { accuracy: 0.5, weight: 1.35 },
      resistanceSupport: { accuracy: 0.5, weight: 1.3 },
      cycleDetection: { accuracy: 0.5, weight: 1.2 },
      clusterAnalysis: { accuracy: 0.5, weight: 1.25 }
    },
    
    cheatDetection: {
      anomalyScore: 0,
      lastDetection: null,
      warningLevel: 0
    }
  }
};

// ==================== HỆ THỐNG TOÁN HỌC NÂNG CAO ====================
class AdvancedMathAnalyzer {
  constructor() {
    this.mathModels = {
      fibonacci: this.analyzeFibonacciAdvanced.bind(this),
      goldenRatio: this.analyzeGoldenRatioAdvanced.bind(this),
      probability: this.analyzeProbabilityAdvanced.bind(this),
      statistical: this.analyzeStatisticalAdvanced.bind(this),
      quantum: this.analyzeQuantumMath.bind(this),
      bayesian: this.analyzeBayesianInference.bind(this)
    };
  }

  // 1. FIBONACCI NÂNG CAO VỚI MULTI-SEQUENCE
  analyzeFibonacciAdvanced(data) {
    if (data.length < 55) return null;
    
    const results = data.slice(0, 55).map(d => d.Ket_qua);
    const sequences = [
      [1, 2, 3, 5, 8, 13, 21, 34, 55],  // Basic Fibonacci
      [2, 3, 5, 8, 13, 21, 34],         // Lucas-like
      [1, 3, 4, 7, 11, 18, 29, 47],     // Fibonacci variant
      [3, 6, 9, 15, 24, 39]             // 3-based sequence
    ];
    
    let sequenceScores = [];
    
    sequences.forEach(seq => {
      let taiCount = 0, xiuCount = 0;
      seq.forEach(pos => {
        if (pos <= results.length) {
          if (results[pos - 1] === 'Tài') taiCount++;
          else xiuCount++;
        }
      });
      
      const score = Math.abs(taiCount - xiuCount) / seq.length;
      const prediction = taiCount > xiuCount ? 'Xỉu' : 'Tài';
      
      if (score > 0.25) {
        sequenceScores.push({
          sequence: seq.join('-'),
          score,
          prediction,
          ratio: `${taiCount}:${xiuCount}`,
          confidence: Math.min(75, 60 + (score * 40))
        });
      }
    });
    
    if (sequenceScores.length > 0) {
      // Chọn sequence tốt nhất
      const bestSeq = sequenceScores.sort((a, b) => b.score - a.score)[0];
      
      return {
        method: 'FIBONACCI_ADVANCED',
        prediction: bestSeq.prediction,
        confidence: Math.round(bestSeq.confidence),
        sequences: sequenceScores,
        selectedSequence: bestSeq.sequence,
        reason: `Fibonacci ${bestSeq.sequence} (${bestSeq.ratio}) → ${bestSeq.prediction}`
      };
    }
    
    return null;
  }

  // 2. GOLDEN RATIO VỚI PHI ĐỘNG
  analyzeGoldenRatioAdvanced(data) {
    if (data.length < 89) return null; // Fibonacci 11th number
    
    const goldenRatio = 1.6180339887;
    const results = data.slice(0, 89).map(d => d.Ket_qua);
    
    // Các vị trí golden ratio động
    const positions = [];
    let current = 1;
    while (current <= results.length) {
      positions.push(Math.floor(current));
      current *= goldenRatio;
    }
    
    let taiAtGolden = 0, xiuAtGolden = 0;
    positions.forEach(pos => {
      if (pos <= results.length) {
        if (results[pos - 1] === 'Tài') taiAtGolden++;
        else xiuAtGolden++;
      }
    });
    
    // Tính tỷ lệ thực tế
    const actualRatio = Math.max(taiAtGolden, xiuAtGolden) / 
                       Math.min(taiAtGolden, xiuAtGolden) || 1;
    
    // Độ lệch so với golden ratio
    const deviation = Math.abs(actualRatio - goldenRatio) / goldenRatio;
    
    if (deviation < 0.15) { // Trong phạm vi 15%
      const dominant = taiAtGolden > xiuAtGolden ? 'Tài' : 'Xỉu';
      const prediction = dominant;
      const confidence = 70 + Math.round((0.15 - deviation) * 50);
      
      return {
        method: 'GOLDEN_RATIO_ADVANCED',
        prediction,
        confidence: Math.min(85, confidence),
        actualRatio: actualRatio.toFixed(3),
        goldenRatio: goldenRatio.toFixed(3),
        deviation: (deviation * 100).toFixed(1) + '%',
        reason: `Golden Ratio detected (deviation: ${(deviation*100).toFixed(1)}%) → ${prediction}`
      };
    }
    
    // Phiên bản đảo ngược (reverse golden ratio)
    const reversePositions = positions.map(p => results.length - p + 1).filter(p => p > 0);
    let reverseTai = 0, reverseXiu = 0;
    
    reversePositions.forEach(pos => {
      if (pos <= results.length) {
        if (results[pos - 1] === 'Tài') reverseTai++;
        else reverseXiu++;
      }
    });
    
    const reverseRatio = Math.max(reverseTai, reverseXiu) / 
                        Math.min(reverseTai, reverseXiu) || 1;
    
    if (Math.abs(reverseRatio - (1/goldenRatio)) < 0.2) {
      const reverseDominant = reverseTai > reverseXiu ? 'Tài' : 'Xỉu';
      const prediction = reverseDominant === 'Tài' ? 'Xỉu' : 'Tài'; // Đảo ngược
      
      return {
        method: 'GOLDEN_RATIO_REVERSE',
        prediction,
        confidence: 68,
        reverseRatio: reverseRatio.toFixed(3),
        expectedRatio: (1/goldenRatio).toFixed(3),
        reason: 'Reverse Golden Ratio pattern → ' + prediction
      };
    }
    
    return null;
  }

  // 3. XÁC SUẤT NÂNG CAO VỚI MARKOV CHAIN & BAYES
  analyzeProbabilityAdvanced(data) {
    if (data.length < 100) return null;
    
    const results = data.slice(0, 100).map(d => d.Ket_qua);
    const sums = data.slice(0, 50).map(d => d.Tong);
    
    // 1. Markov Chain bậc 2
    const markovMatrix = this.buildMarkovChain(results, 2);
    const recentPattern = results.slice(0, 2).join('');
    const nextStateProb = markovMatrix[recentPattern] || { 'Tài': 0.5, 'Xỉu': 0.5 };
    
    // 2. Bayesian Inference với multiple evidence
    const evidence = {
      recentTrend: this.calculateTrendEvidence(results.slice(0, 10)),
      sumDistribution: this.calculateSumEvidence(sums),
      streakPattern: this.calculateStreakEvidence(results.slice(0, 20))
    };
    
    const prior = { tai: 0.5, xiu: 0.5 }; // Prior probability
    
    // Bayesian update
    let posteriorTai = prior.tai;
    let posteriorXiu = prior.xiu;
    
    Object.values(evidence).forEach(ev => {
      posteriorTai *= ev.taiLikelihood;
      posteriorXiu *= ev.xiuLikelihood;
    });
    
    // Normalize
    const total = posteriorTai + posteriorXiu;
    posteriorTai /= total;
    posteriorXiu /= total;
    
    // 3. Kết hợp Markov và Bayesian
    const combinedTai = (nextStateProb['Tài'] * 0.4) + (posteriorTai * 0.6);
    const combinedXiu = (nextStateProb['Xỉu'] * 0.4) + (posteriorXiu * 0.6);
    
    const prediction = combinedTai >= combinedXiu ? 'Tài' : 'Xỉu';
    const confidence = 65 + Math.min(20, Math.abs(combinedTai - combinedXiu) * 100);
    
    return {
      method: 'PROBABILITY_ADVANCED',
      prediction,
      confidence: Math.round(confidence),
      probabilities: {
        markov: nextStateProb,
        bayesian: { tai: posteriorTai, xiu: posteriorXiu },
        combined: { tai: combinedTai, xiu: combinedXiu }
      },
      reason: `Xác suất nâng cao: Markov ${(nextStateProb['Tài']*100).toFixed(0)}% | Bayes ${(posteriorTai*100).toFixed(0)}%`
    };
  }

  // 4. PHÂN TÍCH THỐNG KÊ NÂNG CAO
  analyzeStatisticalAdvanced(data) {
    if (data.length < 80) return null;
    
    const results = data.slice(0, 80).map(d => d.Ket_qua);
    const sums = data.slice(0, 60).map(d => d.Tong);
    
    // Các test thống kê
    const tests = {
      chiSquare: this.chiSquareTest(results),
      runsTest: this.runsTest(results),
      autocorrelation: this.autocorrelationTest(results),
      distributionTest: this.distributionTest(sums)
    };
    
    // Tính điểm bất thường
    let anomalyScore = 0;
    let warnings = [];
    
    if (tests.chiSquare.pValue < 0.05) {
      anomalyScore += 0.3;
      warnings.push(`Chi-square test failed (p=${tests.chiSquare.pValue.toFixed(3)})`);
    }
    
    if (tests.runsTest.pValue < 0.05) {
      anomalyScore += 0.3;
      warnings.push(`Runs test indicates non-randomness`);
    }
    
    if (tests.autocorrelation.significant) {
      anomalyScore += 0.25;
      warnings.push(`Autocorrelation detected at lag ${tests.autocorrelation.lag}`);
    }
    
    if (tests.distributionTest.anomaly) {
      anomalyScore += 0.15;
      warnings.push(`Sum distribution anomaly`);
    }
    
    // Dự đoán dựa trên phân phối
    const recentTaiCount = results.slice(0, 20).filter(r => r === 'Tài').length;
    const expectedTaiCount = 10; // Expected for random
    
    let prediction, reason;
    if (recentTaiCount > expectedTaiCount + 3) {
      prediction = 'Xỉu';
      reason = `Regression to mean: ${recentTaiCount}T in 20 phiên (expected 10)`;
    } else if (recentTaiCount < expectedTaiCount - 3) {
      prediction = 'Tài';
      reason = `Regression to mean: ${20-recentTaiCount}X in 20 phiên (expected 10)`;
    } else {
      prediction = tests.chiSquare.expected;
      reason = `Statistical equilibrium → ${prediction}`;
    }
    
    const confidence = anomalyScore > 0.5 ? 
      Math.max(60, 75 - (anomalyScore * 20)) : 
      70 + Math.min(10, Math.abs(recentTaiCount - expectedTaiCount) * 2);
    
    return {
      method: 'STATISTICAL_ADVANCED',
      prediction,
      confidence: Math.round(confidence),
      anomalyScore,
      warnings: warnings.length > 0 ? warnings : null,
      recentTaiRatio: (recentTaiCount / 20).toFixed(2),
      reason
    };
  }

  // 5. TOÁN HỌC LƯỢNG TỬ (QUANTUM MATH)
  analyzeQuantumMath(data) {
    if (data.length < 40) return null;
    
    const recent = data.slice(0, 40);
    const results = recent.map(d => d.Ket_qua);
    
    // Mô phỏng nguyên lý chồng chập (Superposition)
    const superpositionStates = [];
    
    for (let i = 0; i < results.length - 1; i++) {
      // Tính "spin" lượng tử giữa các trạng thái
      const state1 = results[i] === 'Tài' ? 1 : -1;
      const state2 = results[i + 1] === 'Tài' ? 1 : -1;
      const entanglement = state1 * state2; // 1: cùng hướng, -1: ngược hướng
      
      superpositionStates.push({
        position: i,
        spin: entanglement,
        amplitude: Math.abs(entanglement) / Math.sqrt(2) // Biên độ sóng
      });
    }
    
    // Tính toán hàm sóng
    const waveFunction = superpositionStates.reduce(
      (acc, state) => acc + state.spin * state.amplitude, 0
    ) / superpositionStates.length;
    
    // Xác suất lượng tử
    const probabilityTai = (1 + waveFunction) / 2;
    const probabilityXiu = 1 - probabilityTai;
    
    const prediction = probabilityTai >= 0.5 ? 'Tài' : 'Xỉu';
    const confidence = 65 + Math.min(20, Math.abs(probabilityTai - 0.5) * 40);
    
    // Kiểm tra sự sụp đổ hàm sóng (wave function collapse)
    const variance = superpositionStates.reduce(
      (acc, state) => acc + Math.pow(state.amplitude - 0.5, 2), 0
    ) / superpositionStates.length;
    
    let quantumState = 'stable';
    if (variance > 0.1) quantumState = 'coherent';
    if (variance > 0.2) quantumState = 'entangled';
    
    return {
      method: 'QUANTUM_MATH',
      prediction,
      confidence: Math.round(confidence),
      quantumProbabilities: {
        tai: probabilityTai,
        xiu: probabilityXiu,
        waveFunction: waveFunction.toFixed(3),
        quantumState
      },
      reason: `Quantum analysis: ${(probabilityTai*100).toFixed(1)}% Tài | State: ${quantumState}`
    };
  }

  // 6. BAYESIAN INFERENCE NÂNG CAO
  analyzeBayesianInference(data) {
    if (data.length < 70) return null;
    
    const results = data.slice(0, 70).map(d => d.Ket_qua);
    const sums = data.slice(0, 50).map(d => d.Tong);
    
    // Multiple priors
    const priors = {
      uniform: { tai: 0.5, xiu: 0.5 },
      historical: this.calculateHistoricalPrior(results),
      trendBased: this.calculateTrendPrior(results.slice(0, 20))
    };
    
    // Multiple likelihood models
    const likelihoods = {
      streakModel: this.calculateStreakLikelihood(results),
      sumModel: this.calculateSumLikelihood(sums),
      patternModel: this.calculatePatternLikelihood(results)
    };
    
    // Bayesian Model Averaging
    let posteriorSum = { tai: 0, xiu: 0 };
    let modelWeights = { streakModel: 0.4, sumModel: 0.35, patternModel: 0.25 };
    
    Object.entries(likelihoods).forEach(([model, likelihood]) => {
      // Kết hợp với mỗi prior
      Object.values(priors).forEach(prior => {
        const posteriorTai = (likelihood.tai * prior.tai) / 
                           (likelihood.tai * prior.tai + likelihood.xiu * prior.xiu);
        const posteriorXiu = 1 - posteriorTai;
        
        posteriorSum.tai += posteriorTai * modelWeights[model] / 3; // Chia cho số priors
        posteriorSum.xiu += posteriorXiu * modelWeights[model] / 3;
      });
    });
    
    const prediction = posteriorSum.tai >= posteriorSum.xiu ? 'Tài' : 'Xỉu';
    const confidence = 68 + Math.min(17, Math.abs(posteriorSum.tai - posteriorSum.xiu) * 34);
    
    return {
      method: 'BAYESIAN_INFERENCE_ADVANCED',
      prediction,
      confidence: Math.round(confidence),
      posteriorProbabilities: {
        tai: posteriorSum.tai.toFixed(3),
        xiu: posteriorSum.xiu.toFixed(3)
      },
      modelWeights,
      reason: `Bayesian Model Averaging: ${(posteriorSum.tai*100).toFixed(1)}% Tài`
    };
  }

  // ==================== HELPER METHODS ====================
  buildMarkovChain(results, order) {
    const chain = {};
    
    for (let i = 0; i < results.length - order; i++) {
      const state = results.slice(i, i + order).join('');
      const nextState = results[i + order];
      
      if (!chain[state]) {
        chain[state] = { 'Tài': 0, 'Xỉu': 0, total: 0 };
      }
      
      chain[state][nextState]++;
      chain[state].total++;
    }
    
    // Convert to probabilities
    Object.keys(chain).forEach(state => {
      chain[state]['Tài'] = chain[state]['Tài'] / chain[state].total;
      chain[state]['Xỉu'] = chain[state]['Xỉu'] / chain[state].total;
    });
    
    return chain;
  }

  calculateTrendEvidence(results) {
    const taiCount = results.filter(r => r === 'Tài').length;
    const trendStrength = Math.abs(taiCount - results.length/2) / (results.length/2);
    
    return {
      taiLikelihood: taiCount > results.length/2 ? 0.7 : 0.3,
      xiuLikelihood: taiCount < results.length/2 ? 0.7 : 0.3,
      trendStrength
    };
  }

  calculateSumEvidence(sums) {
    const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
    
    return {
      taiLikelihood: avgSum < 10.5 ? 0.65 : 0.35,
      xiuLikelihood: avgSum > 10.5 ? 0.65 : 0.35,
      avgSum
    };
  }

  calculateStreakEvidence(results) {
    let currentStreak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) currentStreak++;
      else break;
    }
    
    const breakProbability = Math.min(0.8, currentStreak * 0.15);
    
    return {
      taiLikelihood: results[0] === 'Tài' ? 1 - breakProbability : breakProbability,
      xiuLikelihood: results[0] === 'Xỉu' ? 1 - breakProbability : breakProbability,
      currentStreak
    };
  }

  chiSquareTest(results) {
    const taiCount = results.filter(r => r === 'Tài').length;
    const xiuCount = results.length - taiCount;
    const expected = results.length / 2;
    
    const chiSquare = Math.pow(taiCount - expected, 2) / expected + 
                     Math.pow(xiuCount - expected, 2) / expected;
    
    // Simplified p-value calculation
    const pValue = Math.exp(-chiSquare / 2);
    const expectedResult = chiSquare > 3.841 ? (taiCount > expected ? 'Xỉu' : 'Tài') : null;
    
    return { chiSquare, pValue, expected: expectedResult };
  }

  runsTest(results) {
    let runs = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] !== results[i-1]) runs++;
    }
    
    const expectedRuns = (2 * results.length - 1) / 3;
    const variance = (16 * results.length - 29) / 90;
    const zScore = (runs - expectedRuns) / Math.sqrt(variance);
    
    const pValue = 2 * (1 - this.normalCDF(Math.abs(zScore)));
    
    return { runs, expectedRuns, zScore: zScore.toFixed(2), pValue };
  }

  autocorrelationTest(results, maxLag = 10) {
    const numericResults = results.map(r => r === 'Tài' ? 1 : -1);
    let maxCorrelation = 0;
    let significantLag = null;
    
    for (let lag = 1; lag <= maxLag; lag++) {
      let correlation = 0;
      for (let i = 0; i < numericResults.length - lag; i++) {
        correlation += numericResults[i] * numericResults[i + lag];
      }
      correlation /= (numericResults.length - lag);
      
      if (Math.abs(correlation) > Math.abs(maxCorrelation)) {
        maxCorrelation = correlation;
        significantLag = lag;
      }
    }
    
    return {
      significant: Math.abs(maxCorrelation) > 0.3,
      maxCorrelation: maxCorrelation.toFixed(3),
      lag: significantLag
    };
  }

  distributionTest(sums) {
    const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
    const variance = sums.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / sums.length;
    const stdDev = Math.sqrt(variance);
    
    // Check for normality (simplified)
    const skewness = this.calculateSkewness(sums);
    const kurtosis = this.calculateKurtosis(sums);
    
    const anomaly = Math.abs(skewness) > 1 || Math.abs(kurtosis - 3) > 2;
    
    return {
      mean: mean.toFixed(2),
      stdDev: stdDev.toFixed(2),
      skewness: skewness.toFixed(2),
      kurtosis: kurtosis.toFixed(2),
      anomaly
    };
  }

  calculateSkewness(values) {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    
    const cubedDiffs = values.map(v => Math.pow(v - mean, 3));
    const sumCubedDiffs = cubedDiffs.reduce((a, b) => a + b, 0);
    const stdDev = Math.sqrt(values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / n);
    
    return (sumCubedDiffs / n) / Math.pow(stdDev, 3);
  }

  calculateKurtosis(values) {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    
    const fourthDiffs = values.map(v => Math.pow(v - mean, 4));
    const sumFourthDiffs = fourthDiffs.reduce((a, b) => a + b, 0);
    const variance = values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / n;
    
    return (sumFourthDiffs / n) / Math.pow(variance, 2);
  }

  normalCDF(x) {
    // Approximation of normal CDF
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    let probability = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    
    if (x > 0) probability = 1 - probability;
    return probability;
  }

  calculateHistoricalPrior(results) {
    const taiCount = results.filter(r => r === 'Tài').length;
    return {
      tai: taiCount / results.length,
      xiu: 1 - (taiCount / results.length)
    };
  }

  calculateTrendPrior(results) {
    const recentTrend = results.slice(0, 5);
    const taiCount = recentTrend.filter(r => r === 'Tài').length;
    
    return {
      tai: taiCount >= 3 ? 0.7 : 0.3,
      xiu: taiCount <= 2 ? 0.7 : 0.3
    };
  }

  calculateStreakLikelihood(results) {
    const current = results[0];
    let streakLength = 1;
    
    for (let i = 1; i < results.length; i++) {
      if (results[i] === current) streakLength++;
      else break;
    }
    
    const breakProb = Math.min(0.8, 0.1 + (streakLength * 0.08));
    
    return {
      tai: current === 'Tài' ? 1 - breakProb : breakProb,
      xiu: current === 'Xỉu' ? 1 - breakProb : breakProb
    };
  }

  calculateSumLikelihood(sums) {
    const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
    const taiProb = 1 / (1 + Math.exp((avgSum - 10.5) / 2));
    
    return {
      tai: taiProb,
      xiu: 1 - taiProb
    };
  }

  calculatePatternLikelihood(results) {
    if (results.length < 6) return { tai: 0.5, xiu: 0.5 };
    
    const patterns = [
      { pattern: ['Tài', 'Xỉu', 'Tài', 'Xỉu'], likelihood: { tai: 0.7, xiu: 0.3 } },
      { pattern: ['Xỉu', 'Tài', 'Xỉu', 'Tài'], likelihood: { tai: 0.3, xiu: 0.7 } },
      { pattern: ['Tài', 'Tài', 'Xỉu', 'Xỉu'], likelihood: { tai: 0.4, xiu: 0.6 } },
      { pattern: ['Xỉu', 'Xỉu', 'Tài', 'Tài'], likelihood: { tai: 0.6, xiu: 0.4 } }
    ];
    
    const recentPattern = results.slice(0, 4);
    
    for (const p of patterns) {
      if (JSON.stringify(recentPattern) === JSON.stringify(p.pattern)) {
        return p.likelihood;
      }
    }
    
    return { tai: 0.5, xiu: 0.5 };
  }
}

// ==================== HỆ THỐNG PHÂN TÍCH PATTERN ====================
class PatternDetectionSystem {
  constructor() {
    this.patterns = {
      diceTrend: this.analyzeDiceTrendAdvanced.bind(this),
      resistance: this.analyzeResistanceSupportAdvanced.bind(this),
      cycles: this.analyzeCycleDetection.bind(this),
      clusters: this.analyzeClusterPatterns.bind(this)
    };
  }

  analyzeDiceTrendAdvanced(data) {
    if (data.length < 15) return null;
    
    const recent = data.slice(0, 15);
    const trends = [];
    
    // Phân tích trend 3D
    for (let i = 0; i < recent.length - 1; i++) {
      const current = recent[i];
      const next = recent[i + 1];
      
      // Vector movement analysis
      const vector = [
        next.Xuc_xac_1 - current.Xuc_xac_1,
        next.Xuc_xac_2 - current.Xuc_xac_2,
        next.Xuc_xac_3 - current.Xuc_xac_3
      ];
      
      const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      const direction = vector.map(v => v > 0 ? 1 : (v < 0 ? -1 : 0));
      
      trends.push({
        magnitude,
        direction,
        resultChange: current.Ket_qua !== next.Ket_qua
      });
    }
    
    // Trend prediction
    const recentTrend = trends.slice(0, 5);
    const avgMagnitude = recentTrend.reduce((sum, t) => sum + t.magnitude, 0) / recentTrend.length;
    const directionSum = recentTrend.reduce((sum, t) => {
      return sum + t.direction.reduce((s, d) => s + d, 0);
    }, 0);
    
    let prediction, reason;
    if (avgMagnitude > 2.5) {
      prediction = directionSum > 0 ? 'Tài' : 'Xỉu';
      reason = `Mạnh trend (magnitude: ${avgMagnitude.toFixed(1)}) → ${prediction}`;
    } else {
      // Mean reversion khi trend yếu
      prediction = recent[0].Ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
      reason = `Weak trend → Mean reversion to ${prediction}`;
    }
    
    const confidence = 65 + Math.min(15, avgMagnitude * 3);
    
    return {
      method: 'DICE_TREND_ADVANCED',
      prediction,
      confidence: Math.round(confidence),
      trendMetrics: {
        avgMagnitude: avgMagnitude.toFixed(2),
        directionBias: directionSum,
        volatility: this.calculateTrendVolatility(trends)
      },
      reason
    };
  }

  analyzeResistanceSupportAdvanced(data) {
    if (data.length < 50) return null;
    
    const sums = data.slice(0, 50).map(d => d.Tong);
    const results = data.slice(0, 30).map(d => d.Ket_qua);
    
    // Tìm multiple resistance/support levels
    const levels = this.findMultipleLevels(sums);
    const currentSum = sums[0];
    
    // Kiểm tra các levels
    let closestLevel = null;
    let minDistance = Infinity;
    
    levels.forEach(level => {
      const distance = Math.abs(currentSum - level.price);
      if (distance < minDistance && distance <= level.strength) {
        minDistance = distance;
        closestLevel = level;
      }
    });
    
    if (closestLevel) {
      let prediction, reason;
      const strength = closestLevel.strength;
      
      if (closestLevel.type === 'resistance') {
        prediction = 'Xỉu';
        reason = `Resistance tại ${closestLevel.price} (strength: ${strength})`;
      } else {
        prediction = 'Tài';
        reason = `Support tại ${closestLevel.price} (strength: ${strength})`;
      }
      
      const confidence = 70 + Math.min(15, strength * 3);
      
      return {
        method: 'RESISTANCE_SUPPORT_ADVANCED',
        prediction,
        confidence: Math.round(confidence),
        level: closestLevel,
        distance: minDistance.toFixed(1),
        reason
      };
    }
    
    // Price action analysis
    const priceAction = this.analyzePriceAction(sums.slice(0, 10), results.slice(0, 10));
    
    if (priceAction.signal) {
      return {
        method: 'PRICE_ACTION',
        prediction: priceAction.prediction,
        confidence: 68,
        pattern: priceAction.pattern,
        reason: `Price action: ${priceAction.pattern} → ${priceAction.prediction}`
      };
    }
    
    return null;
  }

  analyzeCycleDetection(data) {
    if (data.length < 40) return null;
    
    const results = data.slice(0, 40).map(d => d.Ket_qua);
    
    // Tìm cycles từ 2 đến 8
    for (let cycleLength = 2; cycleLength <= 8; cycleLength++) {
      if (this.isValidCycle(results, cycleLength)) {
        const nextPos = results.length % cycleLength;
        const cyclePattern = results.slice(0, cycleLength);
        const prediction = cyclePattern[nextPos];
        
        return {
          method: 'CYCLE_DETECTION',
          prediction,
          confidence: 72,
          cycleLength,
          cyclePattern,
          position: nextPos + 1,
          reason: `Cycle ${cycleLength} detected → Position ${nextPos + 1}: ${prediction}`
        };
      }
    }
    
    // Tìm harmonic cycles
    const harmonicCycle = this.findHarmonicCycle(results);
    if (harmonicCycle) {
      return {
        method: 'HARMONIC_CYCLE',
        prediction: harmonicCycle.prediction,
        confidence: 70,
        harmonicPattern: harmonicCycle.pattern,
        reason: `Harmonic cycle: ${harmonicCycle.pattern} → ${harmonicCycle.prediction}`
      };
    }
    
    return null;
  }

  analyzeClusterPatterns(data) {
    if (data.length < 35) return null;
    
    const results = data.slice(0, 35).map(d => d.Ket_qua);
    const sums = data.slice(0, 25).map(d => d.Tong);
    
    // Cluster analysis using k-means (simplified)
    const clusters = this.simpleKMeans(sums, 2);
    
    if (clusters.wellSeparated) {
      const currentCluster = this.assignToCluster(sums[0], clusters.centroids);
      const clusterResults = [];
      
      for (let i = 0; i < sums.length; i++) {
        if (this.assignToCluster(sums[i], clusters.centroids) === currentCluster) {
          clusterResults.push(results[i]);
        }
      }
      
      const taiInCluster = clusterResults.filter(r => r === 'Tài').length;
      const prediction = taiInCluster >= clusterResults.length / 2 ? 'Tài' : 'Xỉu';
      
      return {
        method: 'CLUSTER_ANALYSIS',
        prediction,
        confidence: 68,
        clusterInfo: {
          centroids: clusters.centroids,
          currentCluster,
          taiRatio: (taiInCluster / clusterResults.length).toFixed(2)
        },
        reason: `Cluster ${currentCluster} (Tài ratio: ${(taiInCluster/clusterResults.length*100).toFixed(0)}%) → ${prediction}`
      };
    }
    
    return null;
  }

  // ==================== HELPER METHODS ====================
  calculateTrendVolatility(trends) {
    const magnitudes = trends.map(t => t.magnitude);
    const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
    const variance = magnitudes.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / magnitudes.length;
    return Math.sqrt(variance);
  }

  findMultipleLevels(sums) {
    const levels = [];
    const window = 5;
    
    // Tìm local maxima (resistance)
    for (let i = window; i < sums.length - window; i++) {
      let isMaxima = true;
      for (let j = i - window; j <= i + window; j++) {
        if (j !== i && sums[j] >= sums[i]) {
          isMaxima = false;
          break;
        }
      }
      
      if (isMaxima) {
        // Tính strength của resistance
        let strength = 0;
        for (let j = i - window; j <= i + window; j++) {
          if (j !== i) strength += sums[i] - sums[j];
        }
        strength /= (window * 2);
        
        levels.push({
          type: 'resistance',
          price: sums[i],
          strength: Math.min(5, strength / 2)
        });
      }
    }
    
    // Tìm local minima (support)
    for (let i = window; i < sums.length - window; i++) {
      let isMinima = true;
      for (let j = i - window; j <= i + window; j++) {
        if (j !== i && sums[j] <= sums[i]) {
          isMinima = false;
          break;
        }
      }
      
      if (isMinima) {
        let strength = 0;
        for (let j = i - window; j <= i + window; j++) {
          if (j !== i) strength += sums[j] - sums[i];
        }
        strength /= (window * 2);
        
        levels.push({
          type: 'support',
          price: sums[i],
          strength: Math.min(5, strength / 2)
        });
      }
    }
    
    return levels;
  }

  analyzePriceAction(sums, results) {
    // Simple price action patterns
    const patterns = {
      higherHighs: this.checkHigherHighs(sums),
      lowerLows: this.checkLowerLows(sums),
      insideBar: this.checkInsideBar(sums.slice(0, 3)),
      outsideBar: this.checkOutsideBar(sums.slice(0, 3))
    };
    
    for (const [pattern, detected] of Object.entries(patterns)) {
      if (detected) {
        let prediction;
        switch(pattern) {
          case 'higherHighs':
            prediction = results[0] === 'Tài' ? 'Tài' : 'Xỉu';
            break;
          case 'lowerLows':
            prediction = results[0] === 'Xỉu' ? 'Xỉu' : 'Tài';
            break;
          case 'insideBar':
            prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
            break;
          case 'outsideBar':
            prediction = results[0] === 'Tài' ? 'Tài' : 'Xỉu';
            break;
          default:
            prediction = 'Tài';
        }
        
        return {
          signal: true,
          pattern,
          prediction,
          description: `${pattern} pattern detected`
        };
      }
    }
    
    return { signal: false };
  }

  checkHigherHighs(sums) {
    if (sums.length < 4) return false;
    for (let i = 1; i < 4; i++) {
      if (sums[i] <= sums[i-1]) return false;
    }
    return true;
  }

  checkLowerLows(sums) {
    if (sums.length < 4) return false;
    for (let i = 1; i < 4; i++) {
      if (sums[i] >= sums[i-1]) return false;
    }
    return true;
  }

  checkInsideBar(sums) {
    if (sums.length < 3) return false;
    return sums[1] > Math.min(sums[0], sums[2]) && sums[1] < Math.max(sums[0], sums[2]);
  }

  checkOutsideBar(sums) {
    if (sums.length < 3) return false;
    return sums[1] < Math.min(sums[0], sums[2]) || sums[1] > Math.max(sums[0], sums[2]);
  }

  isValidCycle(results, length) {
    if (results.length < length * 3) return false;
    
    for (let i = 0; i < length * 2; i++) {
      if (results[i] !== results[i % length]) return false;
    }
    return true;
  }

  findHarmonicCycle(results) {
    const patterns = [
      { pattern: [1, 1, 2, 3, 5], prediction: results[3] }, // Fibonacci cycle
      { pattern: [1, 2, 3, 2, 1], prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài' },
      { pattern: [1, 3, 2, 3, 1], prediction: results[2] }
    ];
    
    for (const p of patterns) {
      if (this.checkHarmonicPattern(results, p.pattern)) {
        return p;
      }
    }
    
    return null;
  }

  checkHarmonicPattern(results, pattern) {
    if (results.length < pattern.length * 2) return false;
    
    // Check if pattern repeats
    for (let i = 0; i < pattern.length; i++) {
      const expectedPos = pattern[i] - 1;
      if (results[i] !== results[expectedPos]) return false;
    }
    
    return true;
  }

  simpleKMeans(data, k) {
    // Simplified k-means clustering
    const sorted = [...data].sort((a, b) => a - b);
    const centroids = [];
    
    for (let i = 0; i < k; i++) {
      centroids.push(sorted[Math.floor((i * sorted.length) / k)]);
    }
    
    let changed = true;
    let iterations = 0;
    
    while (changed && iterations < 10) {
      changed = false;
      const clusters = new Array(k).fill().map(() => []);
      
      data.forEach(value => {
        let minDist = Infinity;
        let clusterIndex = 0;
        
        centroids.forEach((centroid, idx) => {
          const dist = Math.abs(value - centroid);
          if (dist < minDist) {
            minDist = dist;
            clusterIndex = idx;
          }
        });
        
        clusters[clusterIndex].push(value);
      });
      
      // Update centroids
      clusters.forEach((cluster, idx) => {
        if (cluster.length > 0) {
          const newCentroid = cluster.reduce((a, b) => a + b, 0) / cluster.length;
          if (Math.abs(newCentroid - centroids[idx]) > 0.1) {
            centroids[idx] = newCentroid;
            changed = true;
          }
        }
      });
      
      iterations++;
    }
    
    // Check separation
    const wellSeparated = centroids[1] - centroids[0] > 2;
    
    return { centroids, wellSeparated };
  }

  assignToCluster(value, centroids) {
    let minDist = Infinity;
    let cluster = 0;
    
    centroids.forEach((centroid, idx) => {
      const dist = Math.abs(value - centroid);
      if (dist < minDist) {
        minDist = dist;
        cluster = idx;
      }
    });
    
    return cluster;
  }
}

// ==================== HỆ THỐNG PHÁT HIỆN CẦU BỊP NÂNG CAO ====================
class AdvancedCheatDetection {
  constructor() {
    this.warningThresholds = {
      statistical: 0.7,
      pattern: 0.8,
      streak: 0.9,
      distribution: 0.75
    };
    
    this.cheatPatterns = [
      this.detectPerfectPattern.bind(this),
      this.detectStatisticalAnomaly.bind(this),
      this.detectStreakManipulation.bind(this),
      this.detectDistributionAnomaly.bind(this),
      this.detectTimingPattern.bind(this)
    ];
  }

  analyze(data, type) {
    const results = data.slice(0, 100).map(d => d.Ket_qua);
    const sums = data.slice(0, 60).map(d => d.Tong);
    
    const detections = [];
    let totalRiskScore = 0;
    
    this.cheatPatterns.forEach(detector => {
      const detection = detector(results, sums, type);
      if (detection.riskScore > 0.5) {
        detections.push(detection);
        totalRiskScore += detection.riskScore * detection.severity;
      }
    });
    
    const overallRisk = Math.min(1, totalRiskScore / this.cheatPatterns.length);
    
    let warningLevel = 'safe';
    let warningMessage = null;
    let recommendation = 'Bình thường';
    
    if (overallRisk > 0.8) {
      warningLevel = 'danger';
      warningMessage = '⚠️ CẢNH BÁO CAO: Có thể có can thiệp nhà cái!';
      recommendation = 'Không nên đặt cược';
    } else if (overallRisk > 0.6) {
      warningLevel = 'warning';
      warningMessage = '⚠️ Cảnh báo: Dấu hiệu bất thường';
      recommendation = 'Cẩn thận khi đặt cược';
    } else if (overallRisk > 0.4) {
      warningLevel = 'notice';
      warningMessage = '📊 Lưu ý: Một số chỉ số bất thường';
      recommendation = 'Theo dõi thêm';
    }
    
    // Update system cheat detection stats
    aiSystem.models.cheatDetection.anomalyScore = overallRisk;
    aiSystem.models.cheatDetection.lastDetection = new Date().toISOString();
    aiSystem.models.cheatDetection.warningLevel = overallRisk;
    
    return {
      riskScore: overallRisk,
      warningLevel,
      warningMessage,
      recommendation,
      detailedDetections: detections,
      timestamp: new Date().toISOString()
    };
  }

  detectPerfectPattern(results) {
    // Phát hiện pattern hoàn hảo (quá đều)
    let perfectAlternating = true;
    for (let i = 1; i < Math.min(20, results.length); i++) {
      if (results[i] === results[i-1]) {
        perfectAlternating = false;
        break;
      }
    }
    
    let perfectStreak = false;
    if (results.length >= 10) {
      const first = results[0];
      perfectStreak = results.slice(0, 10).every(r => r === first);
    }
    
    const riskScore = perfectAlternating || perfectStreak ? 0.85 : 0;
    
    return {
      pattern: perfectAlternating ? 'perfect_alternating' : (perfectStreak ? 'perfect_streak' : 'none'),
      riskScore,
      severity: 1.0,
      description: perfectAlternating ? '20 phiên đảo chiều hoàn hảo' : 
                   (perfectStreak ? '10 phiên cùng loại liên tiếp' : '')
    };
  }

  detectStatisticalAnomaly(results) {
    // Kiểm tra các test thống kê
    const n = results.length;
    const taiCount = results.filter(r => r === 'Tài').length;
    const expectedTai = n / 2;
    
    // Chi-square test
    const chiSquare = Math.pow(taiCount - expectedTai, 2) / expectedTai + 
                     Math.pow((n - taiCount) - expectedTai, 2) / expectedTai;
    
    // Runs test (đơn giản)
    let runs = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] !== results[i-1]) runs++;
    }
    
    const expectedRuns = (2 * n - 1) / 3;
    const runsZ = Math.abs(runs - expectedRuns) / Math.sqrt((16 * n - 29) / 90);
    
    let riskScore = 0;
    if (chiSquare > 6.635) riskScore += 0.4; // p < 0.01
    if (chiSquare > 3.841) riskScore += 0.3; // p < 0.05
    if (runsZ > 2.58) riskScore += 0.3; // Significant runs test
    
    return {
      pattern: 'statistical_anomaly',
      riskScore: Math.min(1, riskScore),
      severity: 0.9,
      description: `Chi-square: ${chiSquare.toFixed(2)}, Runs Z: ${runsZ.toFixed(2)}`,
      metrics: { chiSquare, runsZ }
    };
  }

  detectStreakManipulation(results) {
    // Phát hiện streak bất thường
    const streakLengths = [];
    let currentStreak = 1;
    
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[i-1]) {
        currentStreak++;
      } else {
        if (currentStreak >= 5) streakLengths.push(currentStreak);
        currentStreak = 1;
      }
    }
    if (currentStreak >= 5) streakLengths.push(currentStreak);
    
    // Nhiều streak dài là dấu hiệu bất thường
    let riskScore = 0;
    if (streakLengths.length >= 3) riskScore += 0.6;
    if (streakLengths.some(s => s >= 8)) riskScore += 0.4;
    
    return {
      pattern: 'streak_manipulation',
      riskScore: Math.min(1, riskScore),
      severity: 0.8,
      description: `Found ${streakLengths.length} long streaks (≥5)`,
      streaks: streakLengths
    };
  }

  detectDistributionAnomaly(sums) {
    if (sums.length < 30) return { pattern: 'none', riskScore: 0, severity: 0, description: '' };
    
    const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
    const variance = sums.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / sums.length;
    const stdDev = Math.sqrt(variance);
    
    // Kiểm tra phân phối chuẩn
    const skewness = this.calculateSkewness(sums);
    const kurtosis = this.calculateKurtosis(sums);
    
    let riskScore = 0;
    if (Math.abs(skewness) > 1.5) riskScore += 0.4; // Skewed distribution
    if (Math.abs(kurtosis - 3) > 3) riskScore += 0.4; // Non-normal kurtosis
    if (stdDev < 2) riskScore += 0.3; // Too little variance
    
    // Kiểm tra outliers
    const outliers = sums.filter(s => Math.abs(s - mean) > 3 * stdDev);
    if (outliers.length > sums.length * 0.1) riskScore += 0.3;
    
    return {
      pattern: 'distribution_anomaly',
      riskScore: Math.min(1, riskScore),
      severity: 0.7,
      description: `Skewness: ${skewness.toFixed(2)}, Kurtosis: ${kurtosis.toFixed(2)}`,
      metrics: { mean: mean.toFixed(2), stdDev: stdDev.toFixed(2) }
    };
  }

  detectTimingPattern(results) {
    // Phát hiện pattern về thời gian (ví dụ: cứ 3 phiên thì đổi)
    if (results.length < 30) return { pattern: 'none', riskScore: 0, severity: 0, description: '' };
    
    let riskScore = 0;
    
    // Kiểm tra cyclic pattern
    for (let cycle = 2; cycle <= 6; cycle++) {
      let match = 0;
      for (let i = 0; i < results.length - cycle; i++) {
        if (results[i] === results[i + cycle]) match++;
      }
      
      const matchRate = match / (results.length - cycle);
      if (matchRate > 0.8) { // Pattern rõ ràng
        riskScore += 0.5;
        break;
      }
    }
    
    return {
      pattern: 'timing_pattern',
      riskScore: Math.min(1, riskScore),
      severity: 0.6,
      description: riskScore > 0 ? 'Detected timing pattern' : 'No timing pattern'
    };
  }

  calculateSkewness(values) {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    
    const cubedDiffs = values.map(v => Math.pow(v - mean, 3));
    const sumCubedDiffs = cubedDiffs.reduce((a, b) => a + b, 0);
    const stdDev = Math.sqrt(values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / n);
    
    return (sumCubedDiffs / n) / Math.pow(stdDev, 3);
  }

  calculateKurtosis(values) {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    
    const fourthDiffs = values.map(v => Math.pow(v - mean, 4));
    const sumFourthDiffs = fourthDiffs.reduce((a, b) => a + b, 0);
    const variance = values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / n;
    
    return (sumFourthDiffs / n) / Math.pow(variance, 2);
  }
}

// ==================== HỆ THỐNG ENSEMBLE VOTING NÂNG CAO ====================
class AdvancedEnsembleSystem {
  constructor() {
    this.mathAnalyzer = new AdvancedMathAnalyzer();
    this.patternDetector = new PatternDetectionSystem();
    this.cheatDetector = new AdvancedCheatDetection();
    
    this.modelWeights = {
      fibonacci: 1.2,
      goldenRatio: 1.2,
      probability: 1.3,
      statistical: 1.25,
      quantum: 1.35,
      bayesian: 1.3,
      diceTrend: 1.35,
      resistance: 1.3,
      cycles: 1.2,
      clusters: 1.25,
      cheatAdjusted: 1.5 // Trọng số cao cho điều chỉnh cheat detection
    };
  }

  analyze(data, type) {
    // Chạy tất cả các phân tích
    const mathAnalysis = [
      this.mathAnalyzer.analyzeFibonacciAdvanced(data),
      this.mathAnalyzer.analyzeGoldenRatioAdvanced(data),
      this.mathAnalyzer.analyzeProbabilityAdvanced(data),
      this.mathAnalyzer.analyzeStatisticalAdvanced(data),
      this.mathAnalyzer.analyzeQuantumMath(data),
      this.mathAnalyzer.analyzeBayesianInference(data)
    ].filter(r => r !== null);
    
    const patternAnalysis = [
      this.patternDetector.analyzeDiceTrendAdvanced(data),
      this.patternDetector.analyzeResistanceSupportAdvanced(data),
      this.patternDetector.analyzeCycleDetection(data),
      this.patternDetector.analyzeClusterPatterns(data)
    ].filter(r => r !== null);
    
    // Phát hiện cheat
    const cheatAnalysis = this.cheatDetector.analyze(data, type);
    
    // Kết hợp tất cả phân tích
    const allAnalysis = [...mathAnalysis, ...patternAnalysis];
    
    // Ensemble voting với weighted scores
    const finalPrediction = this.weightedEnsembleVoting(allAnalysis, cheatAnalysis);
    
    // Cập nhật model accuracy
    this.updateModelAccuracy(allAnalysis, type);
    
    return {
      finalPrediction,
      detailedAnalysis: {
        math: mathAnalysis,
        patterns: patternAnalysis,
        cheatDetection: cheatAnalysis
      },
      timestamp: new Date().toISOString()
    };
  }

  weightedEnsembleVoting(analysis, cheatAnalysis) {
    if (analysis.length === 0) {
      return {
        prediction: Math.random() > 0.5 ? 'Tài' : 'Xỉu',
        confidence: 60,
        method: 'FALLBACK_RANDOM',
        reason: 'Không đủ dữ liệu phân tích',
        cheatWarning: cheatAnalysis
      };
    }
    
    // Tính điểm weighted
    let taiScore = 0, xiuScore = 0;
    let totalWeight = 0;
    let reasons = [];
    
    analysis.forEach(item => {
      const weight = this.modelWeights[item.method.toLowerCase().split('_')[0]] || 1.0;
      const score = (item.confidence / 100) * weight;
      
      if (item.prediction === 'Tài') {
        taiScore += score;
        reasons.push(`✅ ${item.method}: ${item.reason}`);
      } else {
        xiuScore += score;
        reasons.push(`✅ ${item.method}: ${item.reason}`);
      }
      totalWeight += weight;
    });
    
    // Normalize scores
    taiScore = totalWeight > 0 ? taiScore / totalWeight : 0;
    xiuScore = totalWeight > 0 ? xiuScore / totalWeight : 0;
    
    // Base prediction
    let prediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
    let baseConfidence = Math.max(taiScore, xiuScore) * 100;
    
    // Điều chỉnh theo cheat detection
    if (cheatAnalysis.riskScore > 0.6) {
      // Giảm confidence khi có cảnh báo cheat
      baseConfidence *= (1 - cheatAnalysis.riskScore * 0.3);
      
      if (cheatAnalysis.warningLevel === 'danger') {
        // Đảo ngược prediction khi risk cao
        prediction = prediction === 'Tài' ? 'Xỉu' : 'Tài';
        reasons.push(`⚠️ ${cheatAnalysis.warningMessage}`);
      }
    }
    
    // Boost confidence nếu nhiều phương pháp đồng thuận
    const agreementCount = analysis.filter(a => a.prediction === prediction).length;
    const agreementBoost = Math.min(12, agreementCount * 1.5);
    
    const finalConfidence = Math.min(
      AI_CONFIG.maxConfidence,
      Math.max(AI_CONFIG.minConfidence, baseConfidence + agreementBoost)
    );
    
    // Chọn lý do chính (từ phương pháp có độ tin cậy cao nhất)
    const topMethod = analysis
      .filter(a => a.prediction === prediction)
      .sort((a, b) => b.confidence - a.confidence)[0];
    
    const mainReason = topMethod ? topMethod.reason : 'Consensus of multiple analyses';
    
    return {
      prediction,
      confidence: Math.round(finalConfidence),
      method: 'ADVANCED_ENSEMBLE',
      reason: mainReason,
      detailedReasons: reasons.slice(0, 5), // Top 5 reasons
      cheatWarning: cheatAnalysis.warningLevel !== 'safe' ? cheatAnalysis : null,
      agreement: `${agreementCount}/${analysis.length} methods agree`,
      scores: { tai: taiScore.toFixed(3), xiu: xiuScore.toFixed(3) }
    };
  }

  updateModelAccuracy(analysis, type) {
    // Đơn giản hóa: cập nhật weights dựa trên số lần xuất hiện
    analysis.forEach(item => {
      const modelKey = item.method.toLowerCase().split('_')[0];
      if (aiSystem.stats[type].patternAccuracy[modelKey] === undefined) {
        aiSystem.stats[type].patternAccuracy[modelKey] = { used: 0, correct: 0 };
      }
      
      aiSystem.stats[type].patternAccuracy[modelKey].used++;
    });
  }
}

// ==================== HÀM XỬ LÝ DỮ LIỆU & LỊCH SỬ ====================
function transformData(apiData) {
  if (!apiData?.list) return [];
  
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

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // Merge với cấu trúc mới
      aiSystem = {
        ...aiSystem,
        ...saved,
        system: {
          ...aiSystem.system,
          ...(saved.system || {})
        }
      };
      console.log('✅ Đã load dữ liệu AI ULTIMATE');
    }
  } catch (e) {
    console.log('Khởi tạo hệ thống AI ULTIMATE mới');
  }
}

function saveData() {
  try {
    aiSystem.system.lastUpdate = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(aiSystem, null, 2));
  } catch (e) {
    console.error('Lỗi save data:', e.message);
  }
}

function updateHistory(type, predictionData, actualResult = null) {
  const historyRecord = {
    phien: predictionData.phien,
    prediction: predictionData.prediction,
    confidence: predictionData.confidence,
    method: predictionData.method,
    reason: predictionData.reason,
    cheatWarning: predictionData.cheatWarning,
    timestamp: new Date().toISOString(),
    verified: actualResult !== null,
    actual: actualResult,
    correct: actualResult ? (predictionData.prediction === actualResult) : null
  };
  
  // Thêm vào lịch sử
  aiSystem.history[type].unshift(historyRecord);
  
  // Giới hạn lịch sử
  if (aiSystem.history[type].length > 150) {
    aiSystem.history[type] = aiSystem.history[type].slice(0, 150);
  }
  
  // Cập nhật stats nếu đã verify
  if (actualResult) {
    aiSystem.stats[type].total++;
    if (historyRecord.correct) {
      aiSystem.stats[type].correct++;
      aiSystem.stats[type].streak = Math.max(0, aiSystem.stats[type].streak) + 1;
      if (aiSystem.stats[type].streak > aiSystem.stats[type].bestStreak) {
        aiSystem.stats[type].bestStreak = aiSystem.stats[type].streak;
      }
      
      // Cập nhật daily stats
      const today = new Date().toDateString();
      aiSystem.stats[type].daily.wins++;
    } else {
      aiSystem.stats[type].streak = Math.min(0, aiSystem.stats[type].streak) - 1;
      aiSystem.stats[type].daily.losses++;
    }
    
    // Cập nhật daily accuracy
    aiSystem.stats[type].daily.accuracy = 
      aiSystem.stats[type].daily.wins / 
      (aiSystem.stats[type].daily.wins + aiSystem.stats[type].daily.losses) || 0;
    
    // Cập nhật confidence calibration
    if (predictionData.confidence >= 70 && !historyRecord.correct) {
      aiSystem.stats[type].confidenceCalibration.over++;
    } else if (predictionData.confidence <= 60 && historyRecord.correct) {
      aiSystem.stats[type].confidenceCalibration.under++;
    } else {
      aiSystem.stats[type].confidenceCalibration.perfect++;
    }
  }
  
  // Cập nhật tổng quan hệ thống
  aiSystem.system.totalPredictions++;
  const totalCorrect = aiSystem.stats.hu.correct + aiSystem.stats.md5.correct;
  const totalPredictions = aiSystem.stats.hu.total + aiSystem.stats.md5.total;
  aiSystem.system.averageAccuracy = totalPredictions > 0 ? 
    (totalCorrect / totalPredictions) : 0;
}

// ==================== AUTO-VERIFY HỆ THỐNG ====================
async function verifyPredictions(type) {
  try {
    const apiUrl = type === 'hu' ? API_URL_HU : API_URL_MD5;
    const response = await axios.get(apiUrl);
    const currentData = transformData(response.data);
    
    if (currentData.length === 0) return;
    
    // Tạo map từ phiên đến kết quả
    const resultMap = {};
    currentData.forEach(item => {
      resultMap[item.Phien.toString()] = item.Ket_qua;
    });
    
    // Xác minh các dự đoán chưa được verify
    aiSystem.history[type].forEach(record => {
      if (!record.verified && record.phien in resultMap) {
        const actualResult = resultMap[record.phien];
        
        // Cập nhật lịch sử
        record.verified = true;
        record.actual = actualResult;
        record.correct = record.prediction === actualResult;
        
        // Cập nhật stats
        aiSystem.stats[type].total++;
        if (record.correct) {
          aiSystem.stats[type].correct++;
          aiSystem.stats[type].streak = Math.max(0, aiSystem.stats[type].streak) + 1;
          if (aiSystem.stats[type].streak > aiSystem.stats[type].bestStreak) {
            aiSystem.stats[type].bestStreak = aiSystem.stats[type].streak;
          }
        } else {
          aiSystem.stats[type].streak = Math.min(0, aiSystem.stats[type].streak) - 1;
        }
        
        // Cập nhật confidence calibration
        if (record.confidence >= 70 && !record.correct) {
          aiSystem.stats[type].confidenceCalibration.over++;
        } else if (record.confidence <= 60 && record.correct) {
          aiSystem.stats[type].confidenceCalibration.under++;
        } else {
          aiSystem.stats[type].confidenceCalibration.perfect++;
        }
      }
    });
    
    console.log(`✅ Đã xác minh ${type.toUpperCase()} predictions`);
    
  } catch (error) {
    console.error(`Lỗi verify ${type}:`, error.message);
  }
}

async function autoVerifySystem() {
  console.log('🔄 Hệ thống auto-verify đang chạy...');
  await Promise.allSettled([
    verifyPredictions('hu'),
    verifyPredictions('md5')
  ]);
  saveData();
  console.log('✅ Auto-verify hoàn tất');
}

// ==================== API ENDPOINTS NÂNG CẤP ====================
const ensembleSystem = new AdvancedEnsembleSystem();

// Trang chủ
app.get('/', (req, res) => {
  res.send(`
    <h1>🎯 AI ULTIMATE Prediction System v2.0</h1>
    <p>Hệ thống AI cực mạnh với phân tích toán học nâng cao - @Kapubb</p>
    <p><strong>Endpoints:</strong></p>
    <ul>
      <li><a href="/ai-hu">/ai-hu</a> - Dự đoán AI Hũ (có cảnh báo)</li>
      <li><a href="/ai-md5">/ai-md5</a> - Dự đoán AI MD5 (có cảnh báo)</li>
      <li><a href="/ai-hu/lichsu">/ai-hu/lichsu</a> - Lịch sử AI Hũ</li>
      <li><a href="/ai-md5/lichsu">/ai-md5/lichsu</a> - Lịch sử AI MD5</li>
      <li><a href="/ai-analysis?type=hu">/ai-analysis?type=hu</a> - Phân tích chi tiết</li>
      <li><a href="/ai-stats">/ai-stats</a> - Thống kê hệ thống</li>
    </ul>
  `);
});

// Dự đoán AI Hũ
app.get('/ai-hu', async (req, res) => {
  try {
    const response = await axios.get(API_URL_HU);
    const data = transformData(response.data);
    
    if (!data || data.length === 0) {
      return res.json({ error: 'Không có dữ liệu', timestamp: new Date().toISOString() });
    }
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    // Phân tích AI
    const analysis = ensembleSystem.analyze(data, 'hu');
    const finalResult = analysis.finalPrediction;
    
    // Lưu vào lịch sử
    updateHistory('hu', {
      phien: nextPhien.toString(),
      ...finalResult
    });
    
    saveData();
    
    // Chuẩn bị response
    const responseData = {
      phien: nextPhien.toString(),
      du_doan: finalResult.prediction.toLowerCase(),
      ti_le: finalResult.confidence + '%',
      id: '@Kapubb',
      method: finalResult.method,
      reason: finalResult.reason,
      agreement: finalResult.agreement,
      analysis_timestamp: new Date().toISOString()
    };
    
    // Thêm cảnh báo nếu có
    if (finalResult.cheatWarning) {
      responseData.warning = {
        level: finalResult.cheatWarning.warningLevel,
        message: finalResult.cheatWarning.warningMessage,
        recommendation: finalResult.cheatWarning.recommendation
      };
    }
    
    res.json(responseData);
    
  } catch (error) {
    console.error('AI HU Error:', error.message);
    res.json({ 
      error: 'Lỗi hệ thống AI', 
      details: error.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// Dự đoán AI MD5
app.get('/ai-md5', async (req, res) => {
  try {
    const response = await axios.get(API_URL_MD5);
    const data = transformData(response.data);
    
    if (!data || data.length === 0) {
      return res.json({ error: 'Không có dữ liệu', timestamp: new Date().toISOString() });
    }
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    // Phân tích AI
    const analysis = ensembleSystem.analyze(data, 'md5');
    const finalResult = analysis.finalPrediction;
    
    // Lưu vào lịch sử
    updateHistory('md5', {
      phien: nextPhien.toString(),
      ...finalResult
    });
    
    saveData();
    
    // Chuẩn bị response
    const responseData = {
      phien: nextPhien.toString(),
      du_doan: finalResult.prediction.toLowerCase(),
      ti_le: finalResult.confidence + '%',
      id: '@Kapubb',
      method: finalResult.method,
      reason: finalResult.reason,
      agreement: finalResult.agreement,
      analysis_timestamp: new Date().toISOString()
    };
    
    // Thêm cảnh báo nếu có
    if (finalResult.cheatWarning) {
      responseData.warning = {
        level: finalResult.cheatWarning.warningLevel,
        message: finalResult.cheatWarning.warningMessage,
        recommendation: finalResult.cheatWarning.recommendation
      };
    }
    
    res.json(responseData);
    
  } catch (error) {
    console.error('AI MD5 Error:', error.message);
    res.json({ 
      error: 'Lỗi hệ thống AI', 
      details: error.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// Lịch sử AI Hũ
app.get('/ai-hu/lichsu', async (req, res) => {
  try {
    // Tự động verify trước khi trả lời
    await verifyPredictions('hu');
    
    const history = aiSystem.history.hu.map(record => ({
      phien: record.phien,
      du_doan: record.prediction.toLowerCase(),
      ti_le: record.confidence + '%',
      method: record.method,
      reason: record.reason,
      timestamp: record.timestamp,
      ket_qua_thuc_te: record.actual ? record.actual.toLowerCase() : null,
      status: record.verified ? (record.correct ? '✅' : '❌') : '⏳',
      warning: record.cheatWarning ? {
        level: record.cheatWarning.warningLevel,
        message: record.cheatWarning.warningMessage
      } : null
    }));
    
    const stats = aiSystem.stats.hu;
    const accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : 0;
    
    res.json({
      system: 'AI ULTIMATE - Hũ',
      version: aiSystem.system.version,
      history: history.slice(0, 30), // 30 bản ghi gần nhất
      stats: {
        total: stats.total,
        correct: stats.correct,
        accuracy: accuracy + '%',
        current_streak: stats.streak,
        best_streak: stats.bestStreak,
        daily: {
          wins: stats.daily.wins,
          losses: stats.daily.losses,
          accuracy: (stats.daily.accuracy * 100).toFixed(1) + '%'
        },
        confidence_calibration: {
          over_confident: stats.confidenceCalibration.over,
          under_confident: stats.confidenceCalibration.under,
          well_calibrated: stats.confidenceCalibration.perfect
        }
      },
      last_updated: aiSystem.system.lastUpdate
    });
    
  } catch (error) {
    res.json({
      system: 'AI ULTIMATE - Hũ',
      error: 'Không thể load lịch sử',
      details: error.message
    });
  }
});

// Lịch sử AI MD5
app.get('/ai-md5/lichsu', async (req, res) => {
  try {
    await verifyPredictions('md5');
    
    const history = aiSystem.history.md5.map(record => ({
      phien: record.phien,
      du_doan: record.prediction.toLowerCase(),
      ti_le: record.confidence + '%',
      method: record.method,
      reason: record.reason,
      timestamp: record.timestamp,
      ket_qua_thuc_te: record.actual ? record.actual.toLowerCase() : null,
      status: record.verified ? (record.correct ? '✅' : '❌') : '⏳',
      warning: record.cheatWarning ? {
        level: record.cheatWarning.warningLevel,
        message: record.cheatWarning.warningMessage
      } : null
    }));
    
    const stats = aiSystem.stats.md5;
    const accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : 0;
    
    res.json({
      system: 'AI ULTIMATE - MD5',
      version: aiSystem.system.version,
      history: history.slice(0, 30),
      stats: {
        total: stats.total,
        correct: stats.correct,
        accuracy: accuracy + '%',
        current_streak: stats.streak,
        best_streak: stats.bestStreak,
        daily: {
          wins: stats.daily.wins,
          losses: stats.daily.losses,
          accuracy: (stats.daily.accuracy * 100).toFixed(1) + '%'
        },
        confidence_calibration: {
          over_confident: stats.confidenceCalibration.over,
          under_confident: stats.confidenceCalibration.under,
          well_calibrated: stats.confidenceCalibration.perfect
        }
      },
      last_updated: aiSystem.system.lastUpdate
    });
    
  } catch (error) {
    res.json({
      system: 'AI ULTIMATE - MD5',
      error: 'Không thể load lịch sử',
      details: error.message
    });
  }
});

// Phân tích chi tiết
app.get('/ai-analysis', async (req, res) => {
  try {
    const type = req.query.type || 'hu';
    const apiUrl = type === 'hu' ? API_URL_HU : API_URL_MD5;
    
    const response = await axios.get(apiUrl);
    const data = transformData(response.data);
    
    if (!data || data.length === 0) {
      return res.json({ error: 'Không có dữ liệu' });
    }
    
    const analysis = ensembleSystem.analyze(data, type);
    
    res.json({
      system: `AI ULTIMATE Analysis - ${type.toUpperCase()}`,
      timestamp: new Date().toISOString(),
      data_summary: {
        total_records: data.length,
        recent_results: data.slice(0, 10).map(d => ({
          phien: d.Phien,
          result: d.Ket_qua,
          dice: [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3],
          sum: d.Tong
        })),
        tai_count: data.slice(0, 50).filter(d => d.Ket_qua === 'Tài').length,
        xiu_count: data.slice(0, 50).filter(d => d.Ket_qua === 'Xỉu').length,
        avg_sum: (data.slice(0, 20).reduce((a, b) => a + b.Tong, 0) / 20).toFixed(2)
      },
      final_prediction: analysis.finalPrediction,
      cheat_detection: analysis.detailedAnalysis.cheatDetection,
      detailed_analysis: {
        math_models: analysis.detailedAnalysis.math.map(m => ({
          method: m.method,
          prediction: m.prediction,
          confidence: m.confidence + '%',
          key_metrics: Object.keys(m).filter(k => !['method','prediction','confidence','reason'].includes(k))
        })),
        pattern_analysis: analysis.detailedAnalysis.patterns.map(p => ({
          method: p.method,
          prediction: p.prediction,
          confidence: p.confidence + '%',
          pattern_type: p.method.split('_')[0]
        }))
      },
      system_stats: aiSystem.stats[type]
    });
    
  } catch (error) {
    res.json({
      error: 'Lỗi phân tích',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Thống kê hệ thống
app.get('/ai-stats', (req, res) => {
  const huAcc = aiSystem.stats.hu.total > 0 ? 
    ((aiSystem.stats.hu.correct / aiSystem.stats.hu.total) * 100).toFixed(2) : 0;
    
  const md5Acc = aiSystem.stats.md5.total > 0 ? 
    ((aiSystem.stats.md5.correct / aiSystem.stats.md5.total) * 100).toFixed(2) : 0;
  
  const totalAcc = (aiSystem.system.averageAccuracy * 100).toFixed(2);
  
  res.json({
    system: 'AI ULTIMATE STATISTICS',
    version: aiSystem.system.version,
    startup_time: aiSystem.system.startupTime,
    last_update: aiSystem.system.lastUpdate,
    
    performance: {
      overall: {
        total_predictions: aiSystem.system.totalPredictions,
        average_accuracy: totalAcc + '%',
        target_accuracy: (AI_CONFIG.targetAccuracy * 100) + '%'
      },
      
      hu_performance: {
        total: aiSystem.stats.hu.total,
        correct: aiSystem.stats.hu.correct,
        accuracy: huAcc + '%',
        current_streak: aiSystem.stats.hu.streak,
        best_streak: aiSystem.stats.hu.bestStreak,
        daily_performance: aiSystem.stats.hu.daily
      },
      
      md5_performance: {
        total: aiSystem.stats.md5.total,
        correct: aiSystem.stats.md5.correct,
        accuracy: md5Acc + '%',
        current_streak: aiSystem.stats.md5.streak,
        best_streak: aiSystem.stats.md5.bestStreak,
        daily_performance: aiSystem.stats.md5.daily
      }
    },
    
    cheat_detection: {
      current_score: (aiSystem.models.cheatDetection.anomalyScore * 100).toFixed(1) + '%',
      warning_level: aiSystem.models.cheatDetection.warningLevel,
      last_detection: aiSystem.models.cheatDetection.lastDetection
    },
    
    configuration: {
      target_accuracy: (AI_CONFIG.targetAccuracy * 100) + '%',
      confidence_range: `${AI_CONFIG.minConfidence}-${AI_CONFIG.maxConfidence}%`,
      analysis_depth: AI_CONFIG.analysisDepth + ' records',
      risk_threshold: (AI_CONFIG.riskThreshold * 100) + '%'
    }
  });
});

// Reset daily stats (cron job có thể gọi endpoint này)
app.get('/reset-daily', (req, res) => {
  aiSystem.stats.hu.daily = { wins: 0, losses: 0, accuracy: 0 };
  aiSystem.stats.md5.daily = { wins: 0, losses: 0, accuracy: 0 };
  saveData();
  res.json({ message: 'Đã reset thống kê daily', timestamp: new Date().toISOString() });
});

// ==================== KHỞI ĐỘNG HỆ THỐNG ====================
loadData();

// Auto-verify mỗi 45 giây
setInterval(autoVerifySystem, 45000);

// Reset daily stats mỗi ngày (24 giờ)
setInterval(() => {
  console.log('🔄 Resetting daily statistics...');
  aiSystem.stats.hu.daily = { wins: 0, losses: 0, accuracy: 0 };
  aiSystem.stats.md5.daily = { wins: 0, losses: 0, accuracy: 0 };
  saveData();
}, 24 * 60 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 AI ULTIMATE System v2.0 running on http://0.0.0.0:${PORT}`);
  console.log('🔥 HỆ THỐNG AI NÂNG CAO TOÀN DIỆN - @Kapubb');
  console.log('');
  console.log('📊 HỆ THỐNG TOÁN HỌC NÂNG CAO:');
  console.log('  ✅ Fibonacci Multi-Sequence Analysis');
  console.log('  ✅ Dynamic Golden Ratio with Phi');
  console.log('  ✅ Advanced Probability (Markov + Bayes)');
  console.log('  ✅ Statistical Analysis (Chi-square, Runs test)');
  console.log('  ✅ Quantum Math & Bayesian Inference');
  console.log('');
  console.log('🔍 PHÂN TÍCH PATTERN NÂNG CAO:');
  console.log('  ✅ 3D Dice Trend Analysis');
  console.log('  ✅ Multiple Resistance/Support Levels');
  console.log('  ✅ Cycle & Harmonic Pattern Detection');
  console.log('  ✅ Cluster Analysis (K-means simplified)');
  console.log('');
  console.log('⚠️ HỆ THỐNG PHÁT HIỆN CẦU BỊP:');
  console.log('  ✅ Statistical Anomaly Detection');
  console.log('  ✅ Pattern Manipulation Detection');
  console.log('  ✅ Distribution Analysis');
  console.log('  ✅ Risk Level Assessment');
  console.log('');
  console.log('🚀 ENDPOINTS AI ULTIMATE:');
  console.log('  /ai-hu           - Dự đoán AI Hũ (có cảnh báo)');
  console.log('  /ai-md5          - Dự đoán AI MD5 (có cảnh báo)');
  console.log('  /ai-hu/lichsu    - Lịch sử chi tiết Hũ');
  console.log('  /ai-md5/lichsu   - Lịch sử chi tiết MD5');
  console.log('  /ai-analysis     - Phân tích chi tiết');
  console.log('  /ai-stats        - Thống kê hệ thống');
  console.log('');
  console.log('⚡ Mục tiêu: Accuracy > 72% | Confidence: 62-90%');
  console.log('🔄 Auto-verify: 45s | Daily reset: 24h');
});
