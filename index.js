const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'prediction_history.json';

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };

// ==================== CORE PREDICTION ENGINE ====================

class PredictionEngine {
  constructor() {
    this.results = [];
    this.sums = [];
    this.accuracy = [];
    this.consecutiveCorrect = 0;
    this.consecutiveWrong = 0;
  }

  // Load historical data
  loadHistory(data) {
    if (!data || !data.length) return;
    this.results = data.map(d => d.Ket_qua);
    this.sums = data.map(d => d.Tong);
  }

  // Calculate moving average with different windows
  getMovingAverage(windowSize) {
    if (this.results.length < windowSize) return 0.5;
    const recent = this.results.slice(0, windowSize);
    const taiCount = recent.filter(r => r === 'Tài').length;
    return taiCount / windowSize;
  }

  // Detect patterns using difference analysis
  detectPattern() {
    if (this.results.length < 6) return null;
    
    // Check for repeating patterns of length 2-4
    for (let len = 2; len <= 4; len++) {
      const pattern = this.results.slice(0, len);
      let matches = 0;
      
      for (let i = len; i < Math.min(this.results.length, len * 6); i += len) {
        let match = true;
        for (let j = 0; j < len && i + j < this.results.length; j++) {
          if (this.results[i + j] !== pattern[j]) {
            match = false;
            break;
          }
        }
        if (match) matches++;
      }
      
      if (matches >= 2) {
        // Pattern found, predict next based on historical outcome after pattern
        const nextIndex = len * (matches + 1);
        if (nextIndex < this.results.length) {
          return this.results[nextIndex];
        }
      }
    }
    return null;
  }

  // Calculate regression trend
  getTrend() {
    if (this.results.length < 20) return 0;
    
    let xSum = 0, ySum = 0, xySum = 0, x2Sum = 0;
    const n = Math.min(50, this.results.length);
    
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = this.results[i] === 'Tài' ? 1 : 0;
      xSum += x;
      ySum += y;
      xySum += x * y;
      x2Sum += x * x;
    }
    
    const slope = (n * xySum - xSum * ySum) / (n * x2Sum - xSum * xSum);
    return slope;
  }

  // Detect momentum shifts
  getMomentum() {
    if (this.results.length < 10) return 0;
    
    const recent = this.results.slice(0, 10);
    let momentum = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] === recent[i-1]) momentum += 0.1;
      else momentum -= 0.05;
    }
    return Math.max(-1, Math.min(1, momentum));
  }

  // Analyze sum patterns
  analyzeSumPattern() {
    if (this.sums.length < 15) return null;
    
    // Look for sum clustering
    const recentSums = this.sums.slice(0, 10);
    const avgSum = recentSums.reduce((a, b) => a + b, 0) / recentSums.length;
    
    // Sums tend to regress to mean (10.5)
    const deviation = avgSum - 10.5;
    if (Math.abs(deviation) > 1.5) {
      // If sums have been high, next might be lower (Xiu) and vice versa
      return deviation > 0 ? 'Xỉu' : 'Tài';
    }
    return null;
  }

  // Detect streaks with probability
  getStreakPrediction() {
    if (this.results.length < 2) return null;
    
    let streak = 1;
    const current = this.results[0];
    for (let i = 1; i < this.results.length; i++) {
      if (this.results[i] === current) streak++;
      else break;
    }
    
    // Streak probability based on historical data
    // Longer streaks have higher chance to break
    const breakProbability = Math.min(0.8, streak / 10);
    
    // If streak > 3, likely to break
    if (streak >= 4) {
      return current === 'Tài' ? 'Xỉu' : 'Tài';
    }
    
    // Short streaks might continue
    if (streak <= 2) {
      return current;
    }
    
    return null;
  }

  // Fibonacci retracement analysis
  getFibonacciPrediction() {
    if (this.results.length < 30) return null;
    
    // Find local extremes
    let highs = [], lows = [];
    for (let i = 1; i < Math.min(50, this.results.length - 1); i++) {
      const val = this.results[i] === 'Tài' ? 1 : 0;
      const prev = this.results[i-1] === 'Tài' ? 1 : 0;
      const next = this.results[i+1] === 'Tài' ? 1 : 0;
      
      if (val > prev && val > next) highs.push(val);
      if (val < prev && val < next) lows.push(val);
    }
    
    if (highs.length === 0 || lows.length === 0) return null;
    
    const range = Math.max(...highs) - Math.min(...lows);
    const current = this.results[0] === 'Tài' ? 1 : 0;
    const position = (current - Math.min(...lows)) / range;
    
    // Fibonacci levels: 0.382, 0.5, 0.618
    if (position > 0.618) return 'Xỉu'; // Overbought
    if (position < 0.382) return 'Tài'; // Oversold
    
    return null;
  }

  // Weighted moving average prediction
  getWeightedMABy prediction() {
    if (this.results.length < 15) return null;
    
    let weightedSum = 0;
    let weightSum = 0;
    
    for (let i = 0; i < Math.min(30, this.results.length); i++) {
      const weight = Math.exp(-i / 10); // Exponential decay
      const value = this.results[i] === 'Tài' ? 1 : 0;
      weightedSum += value * weight;
      weightSum += weight;
    }
    
    const wma = weightedSum / weightSum;
    return wma > 0.5 ? 'Tài' : 'Xỉu';
  }

  // Bayesian probability
  getBayesianProbability() {
    if (this.results.length < 50) return 0.5;
    
    // Prior probability
    const totalTai = this.results.filter(r => r === 'Tài').length;
    const prior = totalTai / this.results.length;
    
    // Likelihood based on recent pattern
    const recentPattern = this.results.slice(0, 3).join('');
    let patternCount = 0;
    let patternTaiCount = 0;
    
    for (let i = 0; i < this.results.length - 3; i++) {
      const pattern = this.results.slice(i, i + 3).join('');
      if (pattern === recentPattern) {
        patternCount++;
        if (this.results[i + 3] === 'Tài') patternTaiCount++;
      }
    }
    
    if (patternCount === 0) return prior;
    
    const likelihood = patternTaiCount / patternCount;
    // Bayes: posterior = (likelihood * prior) / evidence
    const posterior = (likelihood * prior) / ((likelihood * prior) + ((1 - likelihood) * (1 - prior)));
    
    return posterior;
  }

  // Main prediction method
  predict() {
    if (this.results.length < 10) {
      return { prediction: null, confidence: 0, reason: 'Insufficient data' };
    }
    
    const predictions = [];
    
    // Get predictions from all methods
    const streakPred = this.getStreakPrediction();
    if (streakPred) predictions.push({ pred: streakPred, weight: 1.2, source: 'streak' });
    
    const patternPred = this.detectPattern();
    if (patternPred) predictions.push({ pred: patternPred, weight: 1.0, source: 'pattern' });
    
    const trend = this.getTrend();
    const trendPred = trend > 0.05 ? 'Tài' : (trend < -0.05 ? 'Xỉu' : null);
    if (trendPred) predictions.push({ pred: trendPred, weight: 0.8, source: 'trend' });
    
    const momentum = this.getMomentum();
    const momentumPred = momentum > 0.2 ? 'Tài' : (momentum < -0.2 ? 'Xỉu' : null);
    if (momentumPred) predictions.push({ pred: momentumPred, weight: 0.9, source: 'momentum' });
    
    const wmaPred = this.getWeightedMABy prediction();
    if (wmaPred) predictions.push({ pred: wmaPred, weight: 1.1, source: 'wma' });
    
    const sumPred = this.analyzeSumPattern();
    if (sumPred) predictions.push({ pred: sumPred, weight: 0.7, source: 'sum' });
    
    const fibPred = this.getFibonacciPrediction();
    if (fibPred) predictions.push({ pred: fibPred, weight: 0.6, source: 'fibonacci' });
    
    const bayesianProb = this.getBayesianProbability();
    const bayesianPred = bayesianProb > 0.55 ? 'Tài' : (bayesianProb < 0.45 ? 'Xỉu' : null);
    if (bayesianPred) predictions.push({ pred: bayesianPred, weight: 1.3, source: 'bayesian' });
    
    if (predictions.length === 0) {
      // Fallback to simple moving average
      const ma = this.getMovingAverage(20);
      const fallbackPred = ma > 0.52 ? 'Tài' : (ma < 0.48 ? 'Xỉu' : null);
      if (fallbackPred) {
        predictions.push({ pred: fallbackPred, weight: 0.5, source: 'ma_fallback' });
      }
    }
    
    // Weighted voting
    let taiScore = 0;
    let xiuScore = 0;
    let totalWeight = 0;
    
    for (const p of predictions) {
      if (p.pred === 'Tài') taiScore += p.weight;
      else xiuScore += p.weight;
      totalWeight += p.weight;
    }
    
    if (totalWeight === 0) {
      return { prediction: null, confidence: 0, reason: 'No consensus', canPredict: false };
    }
    
    const taiProbability = taiScore / (taiScore + xiuScore);
    const confidence = Math.abs(taiProbability - 0.5) * 2 * 100;
    const finalPrediction = taiProbability > 0.5 ? 'Tài' : 'Xỉu';
    
    // Dynamic threshold based on recent accuracy
    let threshold = 55;
    if (this.accuracy.length >= 20) {
      const recentAccuracy = this.accuracy.slice(-20).reduce((a, b) => a + b, 0) / 20;
      if (recentAccuracy > 0.55) threshold = 50;
      else if (recentAccuracy < 0.45) threshold = 60;
    }
    
    // Adjust for consecutive wrong predictions
    if (this.consecutiveWrong >= 3) {
      threshold = Math.max(45, threshold - 10);
    }
    
    const canPredict = confidence >= threshold && predictions.length >= 2;
    const agreement = predictions.filter(p => p.pred === finalPrediction).length / predictions.length;
    
    return {
      prediction: finalPrediction,
      confidence: Math.min(85, Math.max(40, Math.round(confidence))),
      canPredict: canPredict && agreement >= 0.5,
      signalCount: predictions.length,
      agreement: Math.round(agreement * 100),
      reason: canPredict ? 
        `${predictions.length} methods agree (${Math.round(agreement * 100)}%)` : 
        `Confidence ${Math.round(confidence)}% < threshold ${threshold}%`,
      methods: predictions.slice(0, 5).map(p => p.source)
    };
  }
  
  recordOutcome(prediction, actual) {
    const correct = prediction === actual;
    this.accuracy.push(correct ? 1 : 0);
    if (this.accuracy.length > 200) this.accuracy.shift();
    
    if (correct) {
      this.consecutiveCorrect++;
      this.consecutiveWrong = 0;
    } else {
      this.consecutiveWrong++;
      this.consecutiveCorrect = 0;
    }
  }
}

// ==================== GLOBAL STATE ====================
let engineHU = new PredictionEngine();
let engineMD5 = new PredictionEngine();

// ==================== HELPERS ====================
function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices?.[0] || 0,
    Xuc_xac_2: item.dices?.[1] || 0,
    Xuc_xac_3: item.dices?.[2] || 0,
    Tong: item.point || 0,
    timestamp: new Date().toISOString()
  }));
}

async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('[HU] Fetch error:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('[MD5] Fetch error:', error.message);
    return null;
  }
}

function normalizeResult(result) {
  if (!result) return 'unknown';
  return result === 'Tài' ? 'tai' : 'xiu';
}

function savePredictionToHistory(type, phien, result) {
  const record = {
    phien_hien_tai: phien.toString(),
    du_doan: result.prediction ? normalizeResult(result.prediction) : 'unknown',
    ti_le: result.canPredict ? `${result.confidence}%` : '0%',
    can_predict: result.canPredict,
    reason: result.reason || '',
    methods: result.methods || [],
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > 500) {
    predictionHistory[type] = predictionHistory[type].slice(0, 500);
  }
  return record;
}

function saveAll() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    console.error('[Save] Error:', e.message);
  }
}

function loadAll() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
      const data = JSON.parse(raw);
      predictionHistory = data.history || { hu: [], md5: [] };
      lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
      console.log('[Data] History loaded');
    }
  } catch (e) {
    console.error('[Load] Error:', e.message);
  }
}

// ==================== PREDICTION LOGIC ====================
function makePrediction(type, data) {
  const engine = type === 'hu' ? engineHU : engineMD5;
  
  if (!data || data.length < 5) {
    return {
      prediction: null,
      confidence: 0,
      canPredict: false,
      reason: 'Insufficient data',
      methods: []
    };
  }
  
  engine.loadHistory(data);
  const result = engine.predict();
  return result;
}

async function verifyAndUpdate(type, data, phienToVerify, lastPrediction) {
  if (!phienToVerify || !lastPrediction || !lastPrediction.prediction) return;
  
  const actualSession = data.find(d => d && d.Phien && d.Phien.toString() === phienToVerify.toString());
  if (!actualSession || !actualSession.Ket_qua) return;
  
  const engine = type === 'hu' ? engineHU : engineMD5;
  engine.recordOutcome(lastPrediction.prediction, actualSession.Ket_qua);
  
  // Log accuracy
  const recentAccuracy = engine.accuracy.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, engine.accuracy.length);
  console.log(`  📊 ${type.toUpperCase()} accuracy: ${(recentAccuracy * 100).toFixed(1)}% (${engine.accuracy.length} predictions)`);
}

// ==================== AUTO PROCESS ====================
async function autoProcessPredictions() {
  try {
    // Process HU
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      
      if (lastProcessedPhien.hu && lastProcessedPhien.hu !== nextHuPhien) {
        const lastPred = predictionHistory.hu[0];
        if (lastPred && lastPred.du_doan !== 'unknown') {
          await verifyAndUpdate('hu', dataHu, lastProcessedPhien.hu, {
            prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu'
          });
        }
      }
      
      if (lastProcessedPhien.hu !== nextHuPhien) {
        const result = makePrediction('hu', dataHu);
        savePredictionToHistory('hu', nextHuPhien, result);
        lastProcessedPhien.hu = nextHuPhien;
        
        if (result.canPredict) {
          console.log(`🎯 [HU #${nextHuPhien}] ${result.prediction} (${result.confidence}%) - ${result.reason}`);
        } else {
          console.log(`⏸️ [HU #${nextHuPhien}] SKIP - ${result.reason}`);
        }
      }
    }
    
    // Process MD5
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 && lastProcessedPhien.md5 !== nextMd5Phien) {
        const lastPred = predictionHistory.md5[0];
        if (lastPred && lastPred.du_doan !== 'unknown') {
          await verifyAndUpdate('md5', dataMd5, lastProcessedPhien.md5, {
            prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu'
          });
        }
      }
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        const result = makePrediction('md5', dataMd5);
        savePredictionToHistory('md5', nextMd5Phien, result);
        lastProcessedPhien.md5 = nextMd5Phien;
        
        if (result.canPredict) {
          console.log(`🎯 [MD5 #${nextMd5Phien}] ${result.prediction} (${result.confidence}%) - ${result.reason}`);
        } else {
          console.log(`⏸️ [MD5 #${nextMd5Phien}] SKIP - ${result.reason}`);
        }
      }
    }
    
    saveAll();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

// ==================== EXPRESS ROUTES ====================
app.get('/', (req, res) => {
  res.send('🎲 Tài Xỉu Prediction API - Clean & Accurate');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Cannot fetch data' });
    }
    
    const result = makePrediction('hu', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    // Verify previous prediction if exists
    if (lastProcessedPhien.hu && lastProcessedPhien.hu !== nextPhien) {
      const lastPred = predictionHistory.hu[0];
      if (lastPred && lastPred.du_doan !== 'unknown') {
        await verifyAndUpdate('hu', data, lastProcessedPhien.hu, {
          prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu'
        });
      }
    }
    
    savePredictionToHistory('hu', nextPhien, result);
    lastProcessedPhien.hu = nextPhien;
    saveAll();
    
    if (!result.canPredict || !result.prediction) {
      return res.json({
        phien_hien_tai: nextPhien.toString(),
        du_doan: 'unknown',
        ti_le: '0%',
        status: 'waiting',
        reason: result.reason
      });
    }
    
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      methods: result.methods,
      id: 'kapub'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Cannot fetch data' });
    }
    
    const result = makePrediction('md5', data);
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    if (lastProcessedPhien.md5 && lastProcessedPhien.md5 !== nextPhien) {
      const lastPred = predictionHistory.md5[0];
      if (lastPred && lastPred.du_doan !== 'unknown') {
        await verifyAndUpdate('md5', data, lastProcessedPhien.md5, {
          prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu'
        });
      }
    }
    
    savePredictionToHistory('md5', nextPhien, result);
    lastProcessedPhien.md5 = nextPhien;
    saveAll();
    
    if (!result.canPredict || !result.prediction) {
      return res.json({
        phien_hien_tai: nextPhien.toString(),
        du_doan: 'unknown',
        ti_le: '0%',
        status: 'waiting',
        reason: result.reason
      });
    }
    
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      methods: result.methods,
      id: 'kapub'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/lichsu', (req, res) => {
  const historyWithStats = predictionHistory.hu.map(record => {
    const winRate = engineHU.accuracy.length > 0 ? 
      (engineHU.accuracy.reduce((a, b) => a + b, 0) / engineHU.accuracy.length * 100).toFixed(1) : 'N/A';
    return { ...record, overall_accuracy: `${winRate}%` };
  });
  res.json({ 
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ', 
    history: historyWithStats, 
    total: historyWithStats.length,
    accuracy: engineHU.accuracy.length > 0 ? 
      (engineHU.accuracy.reduce((a, b) => a + b, 0) / engineHU.accuracy.length * 100).toFixed(1) + '%' : 
      'N/A'
  });
});

app.get('/lc79-md5/lichsu', (req, res) => {
  const historyWithStats = predictionHistory.md5.map(record => {
    const winRate = engineMD5.accuracy.length > 0 ? 
      (engineMD5.accuracy.reduce((a, b) => a + b, 0) / engineMD5.accuracy.length * 100).toFixed(1) : 'N/A';
    return { ...record, overall_accuracy: `${winRate}%` };
  });
  res.json({ 
    type: 'Lẩu Cua 79 - Tài Xỉu MD5', 
    history: historyWithStats, 
    total: historyWithStats.length,
    accuracy: engineMD5.accuracy.length > 0 ? 
      (engineMD5.accuracy.reduce((a, b) => a + b, 0) / engineMD5.accuracy.length * 100).toFixed(1) + '%' : 
      'N/A'
  });
});

app.get('/stats', (req, res) => {
  const huAccuracy = engineHU.accuracy.length > 0 ?
    (engineHU.accuracy.reduce((a, b) => a + b, 0) / engineHU.accuracy.length * 100).toFixed(1) : 'N/A';
  const md5Accuracy = engineMD5.accuracy.length > 0 ?
    (engineMD5.accuracy.reduce((a, b) => a + b, 0) / engineMD5.accuracy.length * 100).toFixed(1) : 'N/A';
  
  res.json({
    hu: {
      predictions: engineHU.accuracy.length,
      accuracy: `${huAccuracy}%`,
      consecutiveCorrect: engineHU.consecutiveCorrect,
      consecutiveWrong: engineHU.consecutiveWrong
    },
    md5: {
      predictions: engineMD5.accuracy.length,
      accuracy: `${md5Accuracy}%`,
      consecutiveCorrect: engineMD5.consecutiveCorrect,
      consecutiveWrong: engineMD5.consecutiveWrong
    }
  });
});

app.get('/reset', (req, res) => {
  engineHU = new PredictionEngine();
  engineMD5 = new PredictionEngine();
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  saveAll();
  res.json({ message: 'All data reset successfully' });
});

// ==================== STARTUP ====================
loadAll();

// Run every 15 seconds
setInterval(autoProcessPredictions, 15000);
// Initial run after 3 seconds
setTimeout(autoProcessPredictions, 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║     TÀI XỈU PREDICTION SYSTEM - CLEAN & ACCURATE        ║`);
  console.log(`║     Methods: Streak | Pattern | Trend | Momentum       ║`);
  console.log(`║              WMA | Bayesian | Fibonacci | Sum          ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);
  console.log(`🚀 Server: http://0.0.0.0:${PORT}`);
  console.log(`📊 Endpoints:`);
  console.log(`   GET /lc79-hu      - HU prediction`);
  console.log(`   GET /lc79-md5     - MD5 prediction`);
  console.log(`   GET /stats        - Performance stats`);
  console.log(`   GET /lc79-hu/lichsu - Prediction history\n`);
});
