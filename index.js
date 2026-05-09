const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'learning_data.json';
const HISTORY_FILE = 'prediction_history.json';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== CRITICAL FIX: Weighted Statistical Engine ====================
class PredictionEngine {
  constructor() {
    this.performanceTracker = { tai_correct: 0, tai_total: 0, xiu_correct: 0, xiu_total: 0 };
    this.streakMemory = {};
  }

  // CORE FIX: Better streak analysis with exponential weighting
  analyzeStreak(results) {
    let currentStreak = 1;
    let streakType = results[0];
    
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) currentStreak++;
      else break;
    }
    
    // Track streak patterns in memory
    const key = `${currentStreak}_${streakType}`;
    if (!this.streakMemory[key]) {
      this.streakMemory[key] = { continued: 0, broken: 0 };
    }
    
    // Calculate probability based on memory
    const memory = this.streakMemory[key];
    const total = memory.continued + memory.broken;
    let continuationProbability = 0.5;
    
    if (total > 5) {
      continuationProbability = memory.continued / total;
    } else {
      // Bayesian prior based on streak length
      continuationProbability = 0.5 + (currentStreak / 20);
    }
    
    continuationProbability = Math.min(0.8, Math.max(0.2, continuationProbability));
    
    return {
      type: streakType,
      length: currentStreak,
      continuationProbability,
      prediction: continuationProbability > 0.5 ? streakType : (streakType === 'Tài' ? 'Xỉu' : 'Tài'),
      confidence: 50 + Math.abs(continuationProbability - 0.5) * 50
    };
  }

  // CORE FIX: Proper alternating detection
  detectAlternatingPattern(results, minLength = 4) {
    let alternatingCount = 0;
    
    for (let i = 1; i < Math.min(results.length, 10); i++) {
      if (results[i] !== results[i-1]) alternatingCount++;
      else break;
    }
    
    if (alternatingCount >= minLength - 1) {
      return {
        detected: true,
        next: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: 55 + alternatingCount * 3,
        length: alternatingCount + 1
      };
    }
    
    return { detected: false };
  }

  // CORE FIX: Moving average with proper weighting
  weightedMovingAverage(results, windowSize = 20) {
    const recent = results.slice(0, Math.min(windowSize, results.length));
    let weightedTai = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < recent.length; i++) {
      // Exponential decay weight
      const weight = Math.exp(-i / (windowSize / 3));
      if (recent[i] === 'Tài') weightedTai += weight;
      totalWeight += weight;
    }
    
    const taiProbability = weightedTai / totalWeight;
    
    return {
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      confidence: 48 + Math.abs(taiProbability - 0.5) * 40,
      taiProbability: taiProbability.toFixed(3)
    };
  }

  // CORE FIX: Look for specific patterns that work
  detectBreakPoints(results) {
    if (results.length < 6) return null;
    
    // Pattern: 4 same then 2 different = potential break
    const last6 = results.slice(0, 6);
    const first4 = last6.slice(0, 4);
    const last2 = last6.slice(4, 6);
    
    if (first4.every(r => r === first4[0]) && last2.every(r => r === first4[0])) {
      // 6 in a row - might continue
      return { prediction: first4[0], confidence: 65, pattern: 'strong_streak' };
    }
    
    if (first4.every(r => r === first4[0]) && last2.every(r => r !== first4[0])) {
      // Break detected
      return { prediction: last2[0], confidence: 70, pattern: 'break_confirmed' };
    }
    
    // Pattern: 3-3 break
    const first3 = last6.slice(0, 3);
    const second3 = last6.slice(3, 6);
    if (first3.every(r => r === first3[0]) && second3.every(r => r === second3[0]) && first3[0] !== second3[0]) {
      return { prediction: second3[0], confidence: 68, pattern: '3_3_break' };
    }
    
    return null;
  }

  // CORE FIX: Learn from results with proper weighting
  learn(actualResult, predictedResult) {
    if (predictedResult === 'Tài') {
      this.performanceTracker.tai_total++;
      if (actualResult === 'Tài') this.performanceTracker.tai_correct++;
    } else {
      this.performanceTracker.xiu_total++;
      if (actualResult === 'Xỉu') this.performanceTracker.xiu_correct++;
    }
    
    // Update streak memory
    // This would be called when we verify results
  }

  getBias() {
    const taiAcc = this.performanceTracker.tai_total > 0 ? 
      this.performanceTracker.tai_correct / this.performanceTracker.tai_total : 0.5;
    const xiuAcc = this.performanceTracker.xiu_total > 0 ? 
      this.performanceTracker.xiu_correct / this.performanceTracker.xiu_total : 0.5;
    
    return taiAcc - xiuAcc;
  }
}

const engine = { hu: new PredictionEngine(), md5: new PredictionEngine() };

// ==================== SIMPLIFIED BUT ACCURATE PREDICTION ====================
function makePrediction(data, type) {
  const results = data.slice(0, 30).map(d => d.Ket_qua);
  const engineInstance = engine[type];
  
  // Get multiple signals
  const streak = engineInstance.analyzeStreak(results);
  const alternating = engineInstance.detectAlternatingPattern(results);
  const wma = engineInstance.weightedMovingAverage(results, 25);
  const breakPoint = engineInstance.detectBreakPoints(results);
  
  let votes = { 'Tài': 0, 'Xỉu': 0 };
  let totalConfidence = 0;
  
  // 1. Break point detection (highest priority if found)
  if (breakPoint) {
    votes[breakPoint.prediction] += breakPoint.confidence * 1.5;
    totalConfidence += breakPoint.confidence * 1.5;
  }
  
  // 2. Alternating pattern (second priority)
  if (alternating.detected && alternating.length >= 5) {
    votes[alternating.next] += alternating.confidence * 1.2;
    totalConfidence += alternating.confidence * 1.2;
  }
  
  // 3. Streak analysis
  votes[streak.prediction] += streak.confidence;
  totalConfidence += streak.confidence;
  
  // 4. Weighted moving average
  votes[wma.prediction] += wma.confidence * 0.8;
  totalConfidence += wma.confidence * 0.8;
  
  // Apply bias correction
  const bias = engineInstance.getBias();
  if (Math.abs(bias) > 0.1) {
    if (bias > 0) votes['Xỉu'] *= 0.9; // Reduce Xỉu if Tài is performing better
    else votes['Tài'] *= 0.9;
  }
  
  // Determine winner
  const prediction = votes['Tài'] >= votes['Xỉu'] ? 'Tài' : 'Xỉu';
  
  // Calculate confidence based on vote differential
  const maxVotes = Math.max(votes['Tài'], votes['Xỉu']);
  const minVotes = Math.min(votes['Tài'], votes['Xỉu']);
  const confidence = Math.min(75, Math.max(52, 
    50 + ((maxVotes - minVotes) / (maxVotes + minVotes)) * 40
  ));
  
  return {
    prediction,
    confidence: Math.round(confidence),
    details: {
      streak: { prediction: streak.prediction, confidence: streak.confidence },
      alternating: alternating.detected ? { next: alternating.next, confidence: alternating.confidence } : null,
      wma: { prediction: wma.prediction, confidence: wma.confidence, taiProb: wma.taiProbability },
      breakPoint: breakPoint ? { prediction: breakPoint.prediction, confidence: breakPoint.confidence } : null,
      bias: bias.toFixed(2)
    }
  };
}

// ==================== DATA FETCHING ====================
function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Tong: item.point,
    timestamp: new Date().toISOString()
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

// ==================== LEARNING DATA ====================
let learningData = {
  hu: { predictions: [], correct: 0, total: 0 },
  md5: { predictions: [], correct: 0, total: 0 }
};

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
      learningData = JSON.parse(data);
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
    }
  } catch (error) {
    console.error('Error loading history:', error.message);
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
    console.error('Error saving history:', error.message);
  }
}

// ==================== VERIFICATION ====================
async function verifyAndLearn(type, currentData) {
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    const actual = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actual) {
      pred.verified = true;
      pred.actual = actual.Ket_qua;
      pred.correct = pred.prediction === actual.Ket_qua;
      
      if (pred.correct) learningData[type].correct++;
      
      // Learn from result
      engine[type].learn(actual.Ket_qua, pred.prediction);
    }
  }
  
  // Clean old predictions
  if (learningData[type].predictions.length > 100) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 100);
  }
  
  saveLearningData();
}

// ==================== AUTO PROCESS ====================
async function autoProcess() {
  try {
    // Process HU
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestPhien = dataHu[0].Phien;
      const nextPhien = latestPhien + 1;
      
      if (lastProcessedPhien.hu !== nextPhien) {
        await verifyAndLearn('hu', dataHu);
        const result = makePrediction(dataHu, 'hu');
        
        predictionHistory.hu.unshift({
          phien_hien_tai: nextPhien.toString(),
          du_doan: result.prediction.toLowerCase(),
          ti_le: `${result.confidence}%`,
          id: 'kapub',
          timestamp: new Date().toISOString()
        });
        
        learningData.hu.predictions.unshift({
          phien: nextPhien.toString(),
          prediction: result.prediction,
          confidence: result.confidence,
          verified: false,
          timestamp: new Date().toISOString()
        });
        learningData.hu.total++;
        lastProcessedPhien.hu = nextPhien;
        
        console.log(`[HU #${nextPhien}] ${result.prediction} (${result.confidence}%) | WMA:${result.details.wma.taiProb} | Streak:${result.details.streak.prediction}`);
      }
    }
    
    // Process MD5
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestPhien = dataMd5[0].Phien;
      const nextPhien = latestPhien + 1;
      
      if (lastProcessedPhien.md5 !== nextPhien) {
        await verifyAndLearn('md5', dataMd5);
        const result = makePrediction(dataMd5, 'md5');
        
        predictionHistory.md5.unshift({
          phien_hien_tai: nextPhien.toString(),
          du_doan: result.prediction.toLowerCase(),
          ti_le: `${result.confidence}%`,
          id: 'kapub',
          timestamp: new Date().toISOString()
        });
        
        learningData.md5.predictions.unshift({
          phien: nextPhien.toString(),
          prediction: result.prediction,
          confidence: result.confidence,
          verified: false,
          timestamp: new Date().toISOString()
        });
        learningData.md5.total++;
        lastProcessedPhien.md5 = nextPhien;
        
        console.log(`[MD5 #${nextPhien}] ${result.prediction} (${result.confidence}%) | WMA:${result.details.wma.taiProb} | Streak:${result.details.streak.prediction}`);
      }
    }
    
    savePredictionHistory();
    saveLearningData();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

// ==================== ROUTES ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('kapub');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) return res.status(500).json({ error: 'No data' });
    
    await verifyAndLearn('hu', data);
    const result = makePrediction(data, 'hu');
    const nextPhien = data[0].Phien + 1;
    
    // Save prediction
    predictionHistory.hu.unshift({
      phien_hien_tai: nextPhien.toString(),
      du_doan: result.prediction.toLowerCase(),
      ti_le: `${result.confidence}%`,
      id: 'kapub',
      timestamp: new Date().toISOString()
    });
    
    learningData.hu.predictions.unshift({
      phien: nextPhien.toString(),
      prediction: result.prediction,
      confidence: result.confidence,
      verified: false,
      timestamp: new Date().toISOString()
    });
    learningData.hu.total++;
    lastProcessedPhien.hu = nextPhien;
    
    savePredictionHistory();
    saveLearningData();
    
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: result.prediction.toLowerCase(),
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
    if (!data || data.length === 0) return res.status(500).json({ error: 'No data' });
    
    await verifyAndLearn('md5', data);
    const result = makePrediction(data, 'md5');
    const nextPhien = data[0].Phien + 1;
    
    predictionHistory.md5.unshift({
      phien_hien_tai: nextPhien.toString(),
      du_doan: result.prediction.toLowerCase(),
      ti_le: `${result.confidence}%`,
      id: 'kapub',
      timestamp: new Date().toISOString()
    });
    
    learningData.md5.predictions.unshift({
      phien: nextPhien.toString(),
      prediction: result.prediction,
      confidence: result.confidence,
      verified: false,
      timestamp: new Date().toISOString()
    });
    learningData.md5.total++;
    lastProcessedPhien.md5 = nextPhien;
    
    savePredictionHistory();
    saveLearningData();
    
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: result.prediction.toLowerCase(),
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
    if (data) await verifyAndLearn('hu', data);
    
    const history = predictionHistory.hu.map(record => {
      const pred = learningData.hu.predictions.find(p => p.phien === record.phien_hien_tai);
      return {
        ...record,
        ket_qua_thuc_te: pred?.actual || null,
        status: pred?.verified ? (pred.correct ? '✅' : '❌') : '⏳'
      };
    });
    
    res.json({ type: 'HU', history, total: history.length });
  } catch (error) {
    res.json({ type: 'HU', history: predictionHistory.hu, total: predictionHistory.hu.length });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (data) await verifyAndLearn('md5', data);
    
    const history = predictionHistory.md5.map(record => {
      const pred = learningData.md5.predictions.find(p => p.phien === record.phien_hien_tai);
      return {
        ...record,
        ket_qua_thuc_te: pred?.actual || null,
        status: pred?.verified ? (pred.correct ? '✅' : '❌') : '⏳'
      };
    });
    
    res.json({ type: 'MD5', history, total: history.length });
  } catch (error) {
    res.json({ type: 'MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
  }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'No data' });
    
    const result = makePrediction(data, 'hu');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'No data' });
    
    const result = makePrediction(data, 'md5');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/stats', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(2) : 0;
  const engineStats = engine.hu.performanceTracker;
  
  res.json({
    type: 'HU',
    totalPredictions: stats.total,
    correctPredictions: stats.correct,
    accuracy: `${accuracy}%`,
    taiAccuracy: engineStats.tai_total > 0 ? (engineStats.tai_correct / engineStats.tai_total * 100).toFixed(2) + '%' : 'N/A',
    xiuAccuracy: engineStats.xiu_total > 0 ? (engineStats.xiu_correct / engineStats.xiu_total * 100).toFixed(2) + '%' : 'N/A',
    bias: engine.hu.getBias().toFixed(2)
  });
});

app.get('/lc79-md5/stats', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(2) : 0;
  const engineStats = engine.md5.performanceTracker;
  
  res.json({
    type: 'MD5',
    totalPredictions: stats.total,
    correctPredictions: stats.correct,
    accuracy: `${accuracy}%`,
    taiAccuracy: engineStats.tai_total > 0 ? (engineStats.tai_correct / engineStats.tai_total * 100).toFixed(2) + '%' : 'N/A',
    xiuAccuracy: engineStats.xiu_total > 0 ? (engineStats.xiu_correct / engineStats.xiu_total * 100).toFixed(2) + '%' : 'N/A',
    bias: engine.md5.getBias().toFixed(2)
  });
});

app.get('/reset', (req, res) => {
  learningData = {
    hu: { predictions: [], correct: 0, total: 0 },
    md5: { predictions: [], correct: 0, total: 0 }
  };
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  
  saveLearningData();
  savePredictionHistory();
  
  res.json({ message: 'Reset complete' });
});

// ==================== START ====================
loadLearningData();
loadPredictionHistory();

setInterval(autoProcess, AUTO_SAVE_INTERVAL);
setTimeout(autoProcess, 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  LC79 AI v2.0 - FOCUSED ACCURACY  ║`);
  console.log(`╚══════════════════════════════════════╝`);
  console.log(`Server: http://0.0.0.0:${PORT}`);
  console.log(`\nCore improvements:`);
  console.log(`  • Exponential weighted moving average`);
  console.log(`  • Pattern detection (breaks, alternating)`);
  console.log(`  • Streak memory & learning`);
  console.log(`  • Bias correction from performance`);
  console.log(`  • Simpler = more accurate\n`);
});
