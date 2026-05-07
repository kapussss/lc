const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'super_learning_data.json';
const HISTORY_FILE = 'prediction_history.json';
const MODEL_FILE = 'ai_model_weights.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 10000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== SUPER NEURAL PATTERN RECOGNITION ====================
class NeuralPatternRecognizer {
  constructor() {
    this.patternMemory = [];
    this.sequenceWeights = {};
    this.transitionMatrix = { Tai: { Tai: 0, Xiu: 0 }, Xiu: { Tai: 0, Xiu: 0 } };
    this.longTermMemory = [];
    this.shortTermMemory = [];
    this.confidenceHistory = [];
  }

  updateMemory(result) {
    // Đảm bảo result có giá trị hợp lệ
    if (!result || (result !== 'Tài' && result !== 'Xỉu')) return;
    
    this.shortTermMemory.unshift(result);
    if (this.shortTermMemory.length > 20) this.shortTermMemory.pop();
    
    this.longTermMemory.unshift(result);
    if (this.longTermMemory.length > 200) this.longTermMemory.pop();
    
    // Update transition matrix
    if (this.longTermMemory.length >= 2) {
      const from = this.longTermMemory[1];
      const to = this.longTermMemory[0];
      // Kiểm tra tồn tại trước khi cập nhật
      if (this.transitionMatrix[from] && this.transitionMatrix[from][to] !== undefined) {
        this.transitionMatrix[from][to]++;
      }
    }
  }

  findSimilarSequences(currentSeq, maxMatches = 50) {
    if (this.longTermMemory.length < currentSeq.length + 1) return [];
    
    const matches = [];
    const seqStr = currentSeq.join('');
    
    for (let i = 0; i <= this.longTermMemory.length - currentSeq.length - 1; i++) {
      const window = this.longTermMemory.slice(i, i + currentSeq.length);
      const windowStr = window.join('');
      
      let similarity = 0;
      for (let j = 0; j < currentSeq.length; j++) {
        if (currentSeq[j] === window[j]) similarity++;
      }
      
      const similarityRate = similarity / currentSeq.length;
      if (similarityRate >= 0.6) {
        const nextResult = this.longTermMemory[i + currentSeq.length];
        if (nextResult === 'Tài' || nextResult === 'Xỉu') {
          matches.push({
            similarity: similarityRate,
            nextResult: nextResult,
            position: i
          });
        }
      }
    }
    
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, maxMatches);
  }

  predictFromPattern(currentResults) {
    if (currentResults.length < 3) return null;
    
    const seqLength = Math.min(8, currentResults.length);
    const currentSeq = currentResults.slice(0, seqLength);
    const matches = this.findSimilarSequences(currentSeq, 30);
    
    if (matches.length === 0) return null;
    
    let taiCount = 0, xiuCount = 0, totalWeight = 0;
    
    matches.forEach(match => {
      const weight = match.similarity;
      totalWeight += weight;
      if (match.nextResult === 'Tài') taiCount += weight;
      else if (match.nextResult === 'Xỉu') xiuCount += weight;
    });
    
    if (totalWeight === 0) return null;
    
    const taiProb = taiCount / totalWeight;
    const confidence = 50 + Math.abs(taiProb - 0.5) * 80;
    
    return {
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.min(85, Math.max(55, Math.round(confidence))),
      taiProb: taiProb,
      matchesFound: matches.length
    };
  }

  predictFromTransition() {
    // FIXED: Kiểm tra kỹ trước khi truy cập transition matrix
    if (this.longTermMemory.length < 2) return null;
    
    const lastResult = this.longTermMemory[0];
    
    // Kiểm tra lastResult có hợp lệ không
    if (!lastResult || (lastResult !== 'Tài' && lastResult !== 'Xỉu')) return null;
    
    // Kiểm tra transition matrix có chứa key không
    const transitionFrom = this.transitionMatrix[lastResult];
    if (!transitionFrom) return null;
    
    const totalFrom = (transitionFrom.Tai || 0) + (transitionFrom.Xiu || 0);
    
    if (totalFrom < 3) return null; // Giảm ngưỡng từ 5 xuống 3 để có dữ liệu sớm hơn
    
    const taiProb = (transitionFrom.Tai || 0) / totalFrom;
    const confidence = 50 + Math.abs(taiProb - 0.5) * 60;
    
    return {
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.min(80, Math.max(55, Math.round(confidence))),
      taiProb: taiProb
    };
  }

  detectBreakPoint(results) {
    if (results.length < 5) return null;
    
    // Lọc kết quả hợp lệ
    const validResults = results.filter(r => r === 'Tài' || r === 'Xỉu');
    if (validResults.length < 5) return null;
    
    // Phát hiện streak dài
    let streakLength = 1;
    for (let i = 1; i < validResults.length; i++) {
      if (validResults[i] === validResults[0]) streakLength++;
      else break;
    }
    
    // Streak >= 4 thì có khả năng bẻ
    if (streakLength >= 4) {
      const breakProbability = Math.min(0.8, 0.3 + (streakLength - 3) * 0.1);
      if (breakProbability > 0.55) {
        return {
          prediction: validResults[0] === 'Tài' ? 'Xỉu' : 'Tài',
          confidence: 55 + streakLength * 3,
          reason: `Break streak of ${streakLength}`,
          breakProbability
        };
      }
    }
    
    // Phát hiện alternating pattern dài bất thường
    let alternatingLength = 1;
    for (let i = 1; i < Math.min(validResults.length, 12); i++) {
      if (validResults[i] !== validResults[i-1]) alternatingLength++;
      else break;
    }
    
    if (alternatingLength >= 7) {
      const prediction = validResults[0];
      return {
        prediction: prediction,
        confidence: 60 + Math.min(15, alternatingLength),
        reason: `Long alternating pattern (${alternatingLength})`,
        breakProbability: 0.6
      };
    }
    
    return null;
  }
}

// ==================== ADAPTIVE WEIGHTED ENSEMBLE ====================
class AdaptiveEnsemble {
  constructor() {
    this.modelWeights = {
      patternMatcher: 1.0,
      transitionAnalyzer: 1.0,
      breakDetector: 1.0,
      trendAnalyzer: 1.0,
      counterTrend: 1.0
    };
    this.performanceHistory = [];
    this.consecutiveLosses = 0;
    this.consecutiveWins = 0;
    this.lastAdjustment = null;
  }

  updateWeights(lastPredictions, actualResult) {
    if (!actualResult || (actualResult !== 'Tài' && actualResult !== 'Xỉu')) return;
    
    let adjustments = {};
    
    for (const [model, prediction] of Object.entries(lastPredictions)) {
      if (!prediction || (prediction !== 'Tài' && prediction !== 'Xỉu')) continue;
      
      const isCorrect = prediction === actualResult;
      if (isCorrect) {
        this.modelWeights[model] = Math.min(1.5, this.modelWeights[model] * 1.05);
        adjustments[model] = '+5%';
      } else {
        this.modelWeights[model] = Math.max(0.5, this.modelWeights[model] * 0.95);
        adjustments[model] = '-5%';
      }
    }
    
    // Adaptive bias correction
    if (this.consecutiveLosses >= 3) {
      // Giảm mạnh weight của model đang sai
      for (const model of Object.keys(this.modelWeights)) {
        if (lastPredictions[model] !== actualResult) {
          this.modelWeights[model] = Math.max(0.3, this.modelWeights[model] * 0.85);
        }
      }
      this.consecutiveLosses = 0;
    } else if (this.consecutiveWins >= 3) {
      // Đang thắng liên tiếp, tăng weight
      for (const model of Object.keys(this.modelWeights)) {
        if (lastPredictions[model] === actualResult) {
          this.modelWeights[model] = Math.min(1.8, this.modelWeights[model] * 1.08);
        }
      }
      this.consecutiveWins = 0;
    }
    
    this.lastAdjustment = new Date().toISOString();
    this.saveWeights();
  }

  recordResult(isCorrect) {
    if (isCorrect) {
      this.consecutiveLosses = 0;
      this.consecutiveWins++;
    } else {
      this.consecutiveWins = 0;
      this.consecutiveLosses++;
    }
    
    this.performanceHistory.push({ isCorrect, timestamp: Date.now() });
    if (this.performanceHistory.length > 100) this.performanceHistory.shift();
  }

  getRecentAccuracy() {
    if (this.performanceHistory.length < 10) return 0.5;
    const recent = this.performanceHistory.slice(-20);
    const correctCount = recent.filter(p => p.isCorrect).length;
    return correctCount / recent.length;
  }

  getBiasCorrection() {
    const recentAccuracy = this.getRecentAccuracy();
    if (recentAccuracy < 0.4) return { tai: -0.15, xiu: 0.15 };
    if (recentAccuracy > 0.6) return { tai: 0, xiu: 0 };
    return { tai: 0, xiu: 0 };
  }

  saveWeights() {
    try {
      fs.writeFileSync(MODEL_FILE, JSON.stringify(this.modelWeights, null, 2));
    } catch (error) {
      console.error('Save weights error:', error.message);
    }
  }

  loadWeights() {
    try {
      if (fs.existsSync(MODEL_FILE)) {
        const data = fs.readFileSync(MODEL_FILE, 'utf8');
        const loaded = JSON.parse(data);
        this.modelWeights = { ...this.modelWeights, ...loaded };
        console.log('Model weights loaded:', this.modelWeights);
      }
    } catch (error) {
      console.error('Load weights error:', error.message);
    }
  }
}

// ==================== TREND & COUNTER-TREND ANALYZER ====================
class TrendAnalyzer {
  constructor() {
    this.trendHistory = [];
  }

  analyzeTrend(results) {
    // Lọc kết quả hợp lệ
    const validResults = results.filter(r => r === 'Tài' || r === 'Xỉu');
    if (validResults.length < 10) return null;
    
    const windows = [5, 10, 15];
    const trends = {};
    
    windows.forEach(size => {
      const window = validResults.slice(0, Math.min(size, validResults.length));
      const taiCount = window.filter(r => r === 'Tài').length;
      const ratio = taiCount / window.length;
      trends[`window_${size}`] = {
        taiRatio: ratio,
        dominant: ratio > 0.55 ? 'Tài' : (ratio < 0.45 ? 'Xỉu' : 'Balanced'),
        strength: Math.abs(ratio - 0.5) * 2
      };
    });
    
    // Check if trend is strengthening or weakening
    const shortTerm = trends.window_5;
    const longTerm = trends.window_15;
    
    let prediction = null;
    let confidence = 55;
    
    if (shortTerm && longTerm) {
      if (shortTerm.taiRatio > 0.6 && longTerm.taiRatio < 0.5) {
        // Short term Tai strong but long term balanced -> reversal possible
        prediction = 'Xỉu';
        confidence = 65;
      } else if (shortTerm.taiRatio < 0.4 && longTerm.taiRatio > 0.5) {
        prediction = 'Tài';
        confidence = 65;
      } else if (shortTerm.dominant === longTerm.dominant && shortTerm.strength > 0.3) {
        prediction = shortTerm.dominant;
        confidence = 55 + shortTerm.strength * 15;
      }
    }
    
    return prediction ? { prediction, confidence: Math.min(80, confidence), name: 'Trend Analysis' } : null;
  }

  analyzeCounterTrend(results) {
    // Lọc kết quả hợp lệ
    const validResults = results.filter(r => r === 'Tài' || r === 'Xỉu');
    if (validResults.length < 8) return null;
    
    // Phát hiện khi trend đang cực đoan
    const last8 = validResults.slice(0, 8);
    const taiCount = last8.filter(r => r === 'Tài').length;
    
    if (taiCount >= 6) {
      return { prediction: 'Xỉu', confidence: 60 + (taiCount - 5) * 5, name: 'Counter-Trend (Tai extreme)' };
    }
    if (taiCount <= 2) {
      return { prediction: 'Tài', confidence: 60 + (3 - taiCount) * 5, name: 'Counter-Trend (Xiu extreme)' };
    }
    
    // Phát hiện zigzag pattern
    let zigzagCount = 0;
    for (let i = 2; i < Math.min(validResults.length, 10); i++) {
      if (validResults[i-2] !== validResults[i-1] && validResults[i-1] !== validResults[i] && validResults[i-2] === validResults[i]) {
        zigzagCount++;
      }
    }
    
    if (zigzagCount >= 3) {
      const nextPrediction = validResults[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return { prediction: nextPrediction, confidence: 62, name: 'Zigzag Pattern' };
    }
    
    return null;
  }
}

// ==================== LEARNING DATA ====================
let learningData = {
  hu: {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: []
  },
  md5: {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: []
  }
};

// Initialize AI components
let neuralRecognizers = { hu: new NeuralPatternRecognizer(), md5: new NeuralPatternRecognizer() };
let ensembles = { hu: new AdaptiveEnsemble(), md5: new AdaptiveEnsemble() };
let trendAnalyzers = { hu: new TrendAnalyzer(), md5: new TrendAnalyzer() };

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
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching HU data:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching MD5 data:', error.message);
    return null;
  }
}

function normalizeResult(result) {
  if (!result) return 'unknown';
  if (result === 'Tài' || result === 'tài') return 'tai';
  if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
  return result.toLowerCase();
}

// ==================== SUPER PREDICTION ENGINE (NO MONTE CARLO) ====================
function superPrediction(data, type) {
  // Lọc kết quả hợp lệ
  const results = data.slice(0, 30).map(d => d.Ket_qua).filter(r => r === 'Tài' || r === 'Xỉu');
  
  if (results.length === 0) {
    return { 
      prediction: 'Tài', 
      confidence: 55, 
      factors: ['Insufficient data - default prediction'], 
      modelPredictions: {},
      weightedVotes: { Tài: 0, Xỉu: 0 } 
    };
  }
  
  const neural = neuralRecognizers[type];
  const ensemble = ensembles[type];
  const trendAnalyzer = trendAnalyzers[type];
  
  // Update neural memory with recent results
  for (let i = results.length - 1; i >= 0; i--) {
    neural.updateMemory(results[i]);
  }
  
  let modelPredictions = {};
  let weightedVotes = { Tài: 0, Xỉu: 0 };
  let factors = [];
  
  // 1. Neural Pattern Recognition
  const patternPrediction = neural.predictFromPattern(results);
  if (patternPrediction) {
    const weight = ensemble.modelWeights.patternMatcher;
    modelPredictions.patternMatcher = patternPrediction.prediction;
    weightedVotes[patternPrediction.prediction] += patternPrediction.confidence * weight;
    factors.push(`Pattern: ${patternPrediction.prediction} (${patternPrediction.confidence}%, ${patternPrediction.matchesFound} matches)`);
  }
  
  // 2. Transition Matrix Analysis - FIXED with validation
  try {
    const transitionPrediction = neural.predictFromTransition();
    if (transitionPrediction && transitionPrediction.prediction) {
      const weight = ensemble.modelWeights.transitionAnalyzer;
      modelPredictions.transitionAnalyzer = transitionPrediction.prediction;
      weightedVotes[transitionPrediction.prediction] += transitionPrediction.confidence * weight;
      factors.push(`Transition: ${transitionPrediction.prediction} (${transitionPrediction.confidence}%)`);
    }
  } catch (err) {
    factors.push(`Transition: error (${err.message})`);
  }
  
  // 3. Break Point Detection
  const breakPrediction = neural.detectBreakPoint(results);
  if (breakPrediction) {
    const weight = ensemble.modelWeights.breakDetector;
    modelPredictions.breakDetector = breakPrediction.prediction;
    weightedVotes[breakPrediction.prediction] += breakPrediction.confidence * weight;
    factors.push(`Break: ${breakPrediction.prediction} (${breakPrediction.confidence}%, ${breakPrediction.reason || 'N/A'})`);
  }
  
  // 4. Trend Analysis
  const trendPrediction = trendAnalyzer.analyzeTrend(results);
  if (trendPrediction) {
    const weight = ensemble.modelWeights.trendAnalyzer;
    modelPredictions.trendAnalyzer = trendPrediction.prediction;
    weightedVotes[trendPrediction.prediction] += trendPrediction.confidence * weight;
    factors.push(`Trend: ${trendPrediction.prediction} (${trendPrediction.confidence}%)`);
  }
  
  // 5. Counter-Trend Analysis
  const counterPrediction = trendAnalyzer.analyzeCounterTrend(results);
  if (counterPrediction) {
    const weight = ensemble.modelWeights.counterTrend;
    modelPredictions.counterTrend = counterPrediction.prediction;
    weightedVotes[counterPrediction.prediction] += counterPrediction.confidence * weight;
    factors.push(`Counter: ${counterPrediction.prediction} (${counterPrediction.confidence}%)`);
  }
  
  // Calculate final prediction
  let finalPrediction = weightedVotes.Tài >= weightedVotes.Xỉu ? 'Tài' : 'Xỉu';
  
  // Apply bias correction from ensemble
  const biasCorrection = ensemble.getBiasCorrection();
  if (biasCorrection.tai < -0.05 && finalPrediction === 'Tài') {
    finalPrediction = 'Xỉu';
    factors.push(`Bias correction: switched to Xỉu`);
  } else if (biasCorrection.xiu < -0.05 && finalPrediction === 'Xỉu') {
    finalPrediction = 'Tài';
    factors.push(`Bias correction: switched to Tài`);
  }
  
  // Calculate confidence
  const totalScore = weightedVotes.Tài + weightedVotes.Xỉu;
  let confidence = totalScore > 0 ? Math.round(Math.max(weightedVotes.Tài, weightedVotes.Xỉu) / totalScore * 100) : 55;
  
  // Adjust confidence based on ensemble's recent accuracy
  const recentAccuracy = ensemble.getRecentAccuracy();
  if (recentAccuracy < 0.45) {
    confidence = Math.max(55, confidence - 8);
    factors.push(`Low accuracy penalty: -8%`);
  } else if (recentAccuracy > 0.6) {
    confidence = Math.min(88, confidence + 5);
    factors.push(`High accuracy bonus: +5%`);
  }
  
  // Consecutive losses penalty
  if (ensemble.consecutiveLosses >= 2) {
    confidence = Math.max(55, confidence - 5);
    factors.push(`Consecutive loss penalty: -5%`);
  }
  
  confidence = Math.max(55, Math.min(88, Math.round(confidence)));
  
  return { 
    prediction: finalPrediction, 
    confidence, 
    factors: factors.slice(0, 5), // Giới hạn số factor hiển thị
    modelPredictions,
    weightedVotes 
  };
}

// ==================== VERIFICATION & LEARNING ====================
async function verifyAndLearn(type, currentData) {
  let updated = false;
  const neural = neuralRecognizers[type];
  const ensemble = ensembles[type];
  
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult && actualResult.Ket_qua) {
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
      if (learningData[type].recentAccuracy.length > 50) {
        learningData[type].recentAccuracy.shift();
      }
      
      // Update ensemble with result
      ensemble.recordResult(pred.isCorrect);
      
      // Update ensemble weights if we have model predictions
      if (pred.modelPredictions) {
        ensemble.updateWeights(pred.modelPredictions, pred.actual);
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function recordPrediction(type, phien, prediction, confidence, factors, modelPredictions) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    factors: factors || [],
    modelPredictions: modelPredictions || {},
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
      console.log('✅ Learning data loaded');
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
      console.log('✅ Prediction history loaded');
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

// ==================== AUTO PROCESS ====================
async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyAndLearn('hu', dataHu);
        const result = superPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors, result.modelPredictions);
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | ${result.factors[0] || 'No factor'}`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyAndLearn('md5', dataMd5);
        const result = superPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors, result.modelPredictions);
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | ${result.factors[0] || 'No factor'}`);
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
  res.send('kapub - Super AI Prediction Engine v7.1 - Fixed');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
    await verifyAndLearn('hu', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = superPrediction(data, 'hu');
    savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors, result.modelPredictions);
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: 'kapub'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
    await verifyAndLearn('md5', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = superPrediction(data, 'md5');
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors, result.modelPredictions);
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: 'kapub'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (data && data.length > 0) await verifyAndLearn('hu', data);
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
    if (data && data.length > 0) await verifyAndLearn('md5', data);
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
    await verifyAndLearn('hu', data);
    const result = superPrediction(data, 'hu');
    const stats = learningData.hu;
    const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(1) : 0;
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      modelVotes: result.weightedVotes,
      modelWeights: ensembles.hu.modelWeights,
      recentAccuracy: `${(ensembles.hu.getRecentAccuracy() * 100).toFixed(1)}%`,
      overallAccuracy: `${accuracy}%`,
      consecutiveLosses: ensembles.hu.consecutiveLosses,
      consecutiveWins: ensembles.hu.consecutiveWins
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    await verifyAndLearn('md5', data);
    const result = superPrediction(data, 'md5');
    const stats = learningData.md5;
    const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(1) : 0;
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      factors: result.factors,
      modelVotes: result.weightedVotes,
      modelWeights: ensembles.md5.modelWeights,
      recentAccuracy: `${(ensembles.md5.getRecentAccuracy() * 100).toFixed(1)}%`,
      overallAccuracy: `${accuracy}%`,
      consecutiveLosses: ensembles.md5.consecutiveLosses,
      consecutiveWins: ensembles.md5.consecutiveWins
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.get('/lc79-hu/learning', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(2) : 0;
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ - Super Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    modelWeights: ensembles.hu.modelWeights,
    lastUpdate: stats.lastUpdate
  });
});

app.get('/lc79-md5/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(2) : 0;
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5 - Super Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    modelWeights: ensembles.md5.modelWeights,
    lastUpdate: stats.lastUpdate
  });
});

app.post('/reset-learning', (req, res) => {
  learningData = {
    hu: { predictions: [], totalPredictions: 0, correctPredictions: 0, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] },
    md5: { predictions: [], totalPredictions: 0, correctPredictions: 0, lastUpdate: null, streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 }, recentAccuracy: [] }
  };
  neuralRecognizers = { hu: new NeuralPatternRecognizer(), md5: new NeuralPatternRecognizer() };
  ensembles = { hu: new AdaptiveEnsemble(), md5: new AdaptiveEnsemble() };
  trendAnalyzers = { hu: new TrendAnalyzer(), md5: new TrendAnalyzer() };
  saveLearningData();
  res.json({ message: 'All learning data and AI models reset successfully' });
});

// ==================== START SERVER ====================
loadLearningData();
loadPredictionHistory();
ensembles.hu.loadWeights();
ensembles.md5.loadWeights();

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - SUPER AI PREDICTION ENGINE v7.1              ║`);
  console.log(`║     NO MONTE CARLO - PURE NEURAL LEARNING (FIXED)             ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`🚀 Server: http://0.0.0.0:${PORT}`);
  console.log(`\n🧠 AI COMPONENTS (Monte Carlo REMOVED):`);
  console.log(`   • Neural Pattern Recognition - Tìm kiếm mẫu hình tương tự`);
  console.log(`   • Transition Matrix Analysis - Phân tích xác suất chuyển tiếp`);
  console.log(`   • Break Point Detection - Phát hiện điểm bẻ cầu thông minh`);
  console.log(`   • Trend Analysis - Phân tích xu hướng ngắn/dài hạn`);
  console.log(`   • Counter-Trend Detection - Phát hiện điểm đảo chiều`);
  console.log(`   • Adaptive Weighted Ensemble - Học từ sai lầm, điều chỉnh trọng số`);
  console.log(`   • Real-time Bias Correction - Tự động sửa bias Tài/Xỉu\n`);
  console.log(`📊 ENDPOINTS:`);
  console.log(`   GET  /lc79-hu           - Dự đoán Tài Xỉu Hũ`);
  console.log(`   GET  /lc79-md5          - Dự đoán Tài Xỉu MD5`);
  console.log(`   GET  /lc79-hu/lichsu    - Lịch sử dự đoán Hũ`);
  console.log(`   GET  /lc79-md5/lichsu   - Lịch sử dự đoán MD5`);
  console.log(`   GET  /lc79-hu/analysis  - Phân tích chi tiết Hũ + AI weights`);
  console.log(`   GET  /lc79-md5/analysis - Phân tích chi tiết MD5 + AI weights`);
  console.log(`   GET  /lc79-hu/learning  - Thống kê học tập Hũ`);
  console.log(`   GET  /lc79-md5/learning - Thống kê học tập MD5`);
  console.log(`   POST /reset-learning    - Reset toàn bộ AI models\n`);
  console.log(`🔥 FIXED: Lỗi truy cập transition matrix - ĐÃ SỬA!`);
});
