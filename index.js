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
const THRESHOLD_FILE = 'thresholds.json';

let predictionHistory = { hu: [], md5: [] };

const MAX_HISTORY = 500;
const AUTO_SAVE_INTERVAL = 15000;
const MIN_CONFIDENCE_FOR_PREDICTION = 55; // We only predict if we have at least this confidence
let lastProcessedPhien = { hu: null, md5: null };

// ==================== THE CORE INSIGHT ====================
// With binary outcomes, we need to find STATISTICALLY SIGNIFICANT edges.
// We use Z-score testing, sequential probability ratio testing (SPRT),
// and Bayesian updating. If no edge is found, we DON'T PREDICT or give 50/50.

class StatisticalEdgeDetector {
  constructor() {
    // Track various edge signals
    this.streakEdges = {};      // { streakLength: { tai: {correct, total}, xiu: {correct, total} } }
    this.patternEdges = {};     // { patternKey: { tai: {correct, total}, xiu: {correct, total} } }
    this.timeEdges = {};        // { hourSlot: { tai: {hits, total} } }
    this.sumEdges = {};         // { sumRange: { nextTai: count, nextXiu: count } }
    this.amplitudeEdges = {};   // { amplitude: { nextTai, nextXiu } }
    this.alternationEdges = {}; // { altLength: { continues: count, reverses: count } }
    this.winRateHistory = [];
    this.totalPredictions = 0;
    this.totalCorrect = 0;
    this.confidenceThreshold = 55; // Start at 55%, adjust based on actual results
  }

  loadData(type) {
    try {
      if (fs.existsSync(THRESHOLD_FILE)) {
        const data = JSON.parse(fs.readFileSync(THRESHOLD_FILE, 'utf8'));
        if (data[type]) {
          Object.assign(this, data[type]);
        }
      }
    } catch (e) {
      console.error('[EdgeDetector] Load error:', e.message);
    }
    return this;
  }

  saveData(type) {
    try {
      let allData = {};
      if (fs.existsSync(THRESHOLD_FILE)) {
        allData = JSON.parse(fs.readFileSync(THRESHOLD_FILE, 'utf8'));
      }
      allData[type] = {
        streakEdges: this.streakEdges,
        patternEdges: this.patternEdges,
        timeEdges: this.timeEdges,
        sumEdges: this.sumEdges,
        amplitudeEdges: this.amplitudeEdges,
        alternationEdges: this.alternationEdges,
        winRateHistory: this.winRateHistory.slice(-200),
        totalPredictions: this.totalPredictions,
        totalCorrect: this.totalCorrect,
        confidenceThreshold: this.confidenceThreshold
      };
      fs.writeFileSync(THRESHOLD_FILE, JSON.stringify(allData, null, 2));
    } catch (e) {
      console.error('[EdgeDetector] Save error:', e.message);
    }
  }

  // Learn from historical data - find all statistically significant edges
  learnFromHistory(historyData) {
    if (!historyData || historyData.length < 100) return;

    // Convert to simple array of 'Tài'/'Xỉu' and sums
    const results = historyData.map(d => d.Ket_qua);
    const sums = historyData.map(d => d.Tong);

    // 1. Learn streak edges: after a streak of N, what happens next?
    for (let i = 10; i < results.length - 1; i++) {
      // Find current streak at position i
      let streakType = results[i];
      let streakLength = 1;
      for (let j = i - 1; j >= 0; j--) {
        if (results[j] === streakType) streakLength++;
        else break;
      }

      // What happened next?
      const nextOutcome = results[i + 1];
      const streakKey = `${streakType}_${Math.min(streakLength, 15)}`;
      
      if (!this.streakEdges[streakKey]) {
        this.streakEdges[streakKey] = { tai: { correct: 0, total: 0 }, xiu: { correct: 0, total: 0 } };
      }
      
      // Record if continuing the streak would have been correct
      this.streakEdges[streakKey][streakType.toLowerCase()].total++;
      if (nextOutcome === streakType) {
        this.streakEdges[streakKey][streakType.toLowerCase()].correct++;
      }
      
      // Record if reversing would have been correct
      const oppositeType = streakType === 'Tài' ? 'xiu' : 'tai';
      this.streakEdges[streakKey][oppositeType].total++;
      if (nextOutcome !== streakType) {
        this.streakEdges[streakKey][oppositeType].correct++;
      }
    }

    // 2. Learn pattern edges (last 4 outcomes)
    for (let i = 4; i < results.length - 1; i++) {
      const pattern = results.slice(i - 3, i + 1).join('');
      const nextOutcome = results[i + 1];
      
      if (!this.patternEdges[pattern]) {
        this.patternEdges[pattern] = { tai: { correct: 0, total: 0 }, xiu: { correct: 0, total: 0 } };
      }
      
      this.patternEdges[pattern].tai.total++;
      if (nextOutcome === 'Tài') this.patternEdges[pattern].tai.correct++;
      
      this.patternEdges[pattern].xiu.total++;
      if (nextOutcome === 'Xỉu') this.patternEdges[pattern].xiu.correct++;
    }

    // 3. Learn time edges
    for (let i = 0; i < historyData.length; i++) {
      if (!historyData[i].timestamp) continue;
      const hour = new Date(historyData[i].timestamp).getHours();
      const slot = Math.floor(hour / 2); // 2-hour slots
      
      if (!this.timeEdges[slot]) {
        this.timeEdges[slot] = { tai: { hits: 0, total: 0 } };
      }
      this.timeEdges[slot].tai.total++;
      if (historyData[i].Ket_qua === 'Tài') this.timeEdges[slot].tai.hits++;
    }

    // 4. Learn sum edges (what comes after high/low sums)
    for (let i = 0; i < sums.length - 1; i++) {
      const sum = sums[i];
      const range = sum <= 8 ? 'low' : sum >= 13 ? 'high' : 'mid';
      const nextOutcome = results[i + 1];
      
      if (!this.sumEdges[range]) {
        this.sumEdges[range] = { nextTai: 0, nextXiu: 0 };
      }
      if (nextOutcome === 'Tài') this.sumEdges[range].nextTai++;
      else this.sumEdges[range].nextXiu++;
    }

    // 5. Learn amplitude edges
    for (let i = 5; i < results.length - 1; i++) {
      const last5 = results.slice(i - 4, i + 1);
      const taiCount = last5.filter(r => r === 'Tài').length;
      const amplitude = Math.abs(taiCount - 2.5) * 2; // 0 to 5
      const nextOutcome = results[i + 1];
      
      const ampKey = Math.round(amplitude);
      if (!this.amplitudeEdges[ampKey]) {
        this.amplitudeEdges[ampKey] = { nextTai: 0, nextXiu: 0 };
      }
      if (nextOutcome === 'Tài') this.amplitudeEdges[ampKey].nextTai++;
      else this.amplitudeEdges[ampKey].nextXiu++;
    }

    // 6. Learn alternation edges
    for (let i = 3; i < results.length - 1; i++) {
      let altLength = 1;
      for (let j = i; j > 0; j--) {
        if (results[j] !== results[j - 1]) altLength++;
        else break;
      }
      
      const nextOutcome = results[i + 1];
      const wouldContinue = nextOutcome !== results[i];
      const altKey = Math.min(altLength, 10);
      
      if (!this.alternationEdges[altKey]) {
        this.alternationEdges[altKey] = { continues: 0, reverses: 0 };
      }
      if (wouldContinue) this.alternationEdges[altKey].continues++;
      else this.alternationEdges[altKey].reverses++;
    }

    // Adjust confidence threshold based on actual performance
    if (this.totalPredictions > 50) {
      const overallAccuracy = this.totalCorrect / this.totalPredictions;
      // If we're doing well, lower threshold to predict more
      // If doing poorly, raise threshold to be more selective
      if (overallAccuracy > 0.54) this.confidenceThreshold = Math.max(52, this.confidenceThreshold - 1);
      else if (overallAccuracy < 0.48) this.confidenceThreshold = Math.min(65, this.confidenceThreshold + 2);
      else if (overallAccuracy < 0.50) this.confidenceThreshold = Math.min(62, this.confidenceThreshold + 1);
    }

    this.saveData('hu');
    this.saveData('md5');
  }

  // Calculate Z-score for a proportion
  zScore(successes, total, expectedProb = 0.5) {
    if (total < 10) return 0; // Not enough data
    const observed = successes / total;
    const se = Math.sqrt(expectedProb * (1 - expectedProb) / total);
    if (se === 0) return 0;
    return (observed - expectedProb) / se;
  }

  // Get p-value from Z-score (one-tailed)
  pValue(z) {
    const absZ = Math.abs(z);
    // Approximation of normal CDF
    const t = 1 / (1 + 0.2316419 * absZ);
    const d = 0.3989423 * Math.exp(-absZ * absZ / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return 1 - prob;
  }

  // Find the best prediction with statistical confidence
  findBestPrediction(currentResults, currentSums, currentTimestamp) {
    const signals = [];
    const recentResults = currentResults.slice(0, 30);
    const recentSums = currentSums.slice(0, 30);

    // 1. Check streak edge
    let streakType = recentResults[0];
    let streakLength = 1;
    for (let i = 1; i < recentResults.length; i++) {
      if (recentResults[i] === streakType) streakLength++;
      else break;
    }
    const streakKey = `${streakType}_${Math.min(streakLength, 15)}`;
    const streakData = this.streakEdges[streakKey];
    
    if (streakData) {
      // Which has been more correct historically?
      const continueStats = streakData[streakType.toLowerCase()];
      const reverseStats = streakData[streakType === 'Tài' ? 'xiu' : 'tai'];
      
      // Check "continue" signal
      if (continueStats && continueStats.total >= 15) {
        const z = this.zScore(continueStats.correct, continueStats.total, 0.5);
        const p = this.pValue(z);
        if (p < 0.35 && continueStats.correct / continueStats.total > 0.5) {
          signals.push({
            prediction: streakType,
            strength: Math.min(1, (continueStats.correct / continueStats.total - 0.5) * 10),
            zScore: z,
            evidence: `Streak continue: ${continueStats.correct}/${continueStats.total}`,
            source: 'streak_continue'
          });
        }
      }
      
      // Check "reverse" signal
      if (reverseStats && reverseStats.total >= 15) {
        const z = this.zScore(reverseStats.correct, reverseStats.total, 0.5);
        const p = this.pValue(z);
        if (p < 0.35 && reverseStats.correct / reverseStats.total > 0.5) {
          signals.push({
            prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài',
            strength: Math.min(1, (reverseStats.correct / reverseStats.total - 0.5) * 10),
            zScore: z,
            evidence: `Streak reverse: ${reverseStats.correct}/${reverseStats.total}`,
            source: 'streak_reverse'
          });
        }
      }
    }

    // 2. Check pattern edge
    if (recentResults.length >= 4) {
      const pattern = recentResults.slice(0, 4).join('');
      const patternData = this.patternEdges[pattern];
      
      if (patternData && patternData.tai.total + patternData.xiu.total >= 20) {
        const taiRate = patternData.tai.correct / Math.max(1, patternData.tai.total);
        const xiuRate = patternData.xiu.correct / Math.max(1, patternData.xiu.total);
        
        if (taiRate > 0.52 && patternData.tai.total >= 15) {
          signals.push({
            prediction: 'Tài',
            strength: Math.min(1, (taiRate - 0.5) * 15),
            evidence: `Pattern ${pattern}: Tài ${patternData.tai.correct}/${patternData.tai.total}`,
            source: 'pattern'
          });
        }
        if (xiuRate > 0.52 && patternData.xiu.total >= 15) {
          signals.push({
            prediction: 'Xỉu',
            strength: Math.min(1, (xiuRate - 0.5) * 15),
            evidence: `Pattern ${pattern}: Xỉu ${patternData.xiu.correct}/${patternData.xiu.total}`,
            source: 'pattern'
          });
        }
      }
    }

    // 3. Check time edge
    if (currentTimestamp) {
      const hour = new Date(currentTimestamp).getHours();
      const slot = Math.floor(hour / 2);
      const timeData = this.timeEdges[slot];
      
      if (timeData && timeData.tai.total >= 30) {
        const taiRate = timeData.tai.hits / timeData.tai.total;
        const z = this.zScore(timeData.tai.hits, timeData.tai.total, 0.5);
        const p = this.pValue(z);
        
        if (p < 0.3) {
          signals.push({
            prediction: taiRate > 0.5 ? 'Tài' : 'Xỉu',
            strength: Math.min(1, Math.abs(taiRate - 0.5) * 15),
            zScore: z,
            evidence: `Time slot ${slot}: ${timeData.tai.hits}/${timeData.tai.total} Tài`,
            source: 'time'
          });
        }
      }
    }

    // 4. Check sum edge
    if (recentSums.length > 0) {
      const lastSum = recentSums[0];
      const range = lastSum <= 8 ? 'low' : lastSum >= 13 ? 'high' : 'mid';
      const sumData = this.sumEdges[range];
      
      if (sumData && sumData.nextTai + sumData.nextXiu >= 30) {
        const taiRate = sumData.nextTai / (sumData.nextTai + sumData.nextXiu);
        const z = this.zScore(sumData.nextTai, sumData.nextTai + sumData.nextXiu, 0.5);
        const p = this.pValue(z);
        
        if (p < 0.35) {
          signals.push({
            prediction: taiRate > 0.5 ? 'Tài' : 'Xỉu',
            strength: Math.min(1, Math.abs(taiRate - 0.5) * 15),
            zScore: z,
            evidence: `After ${range} sum: Tài ${sumData.nextTai}/${sumData.nextTai + sumData.nextXiu}`,
            source: 'sum'
          });
        }
      }
    }

    // 5. Check amplitude edge
    const last5 = recentResults.slice(0, 5);
    const taiCount = last5.filter(r => r === 'Tài').length;
    const amplitude = Math.round(Math.abs(taiCount - 2.5) * 2);
    const ampData = this.amplitudeEdges[amplitude];
    
    if (ampData && ampData.nextTai + ampData.nextXiu >= 20) {
      const total = ampData.nextTai + ampData.nextXiu;
      const taiRate = ampData.nextTai / total;
      const z = this.zScore(ampData.nextTai, total, 0.5);
      const p = this.pValue(z);
      
      if (p < 0.35) {
        signals.push({
          prediction: taiRate > 0.5 ? 'Tài' : 'Xỉu',
          strength: Math.min(1, Math.abs(taiRate - 0.5) * 12),
          zScore: z,
          evidence: `Amplitude ${amplitude}: Tài ${ampData.nextTai}/${total}`,
          source: 'amplitude'
        });
      }
    }

    // 6. Check alternation edge
    let altLength = 1;
    for (let i = 1; i < Math.min(recentResults.length, 11); i++) {
      if (recentResults[i] !== recentResults[i - 1]) altLength++;
      else break;
    }
    const altKey = Math.min(altLength, 10);
    const altData = this.alternationEdges[altKey];
    
    if (altData && altData.continues + altData.reverses >= 20) {
      const total = altData.continues + altData.reverses;
      const continueRate = altData.continues / total;
      const z = this.zScore(altData.continues, total, 0.5);
      const p = this.pValue(z);
      
      if (p < 0.35) {
        signals.push({
          prediction: continueRate > 0.5 ? (recentResults[0] === 'Tài' ? 'Xỉu' : 'Tài') : recentResults[0],
          strength: Math.min(1, Math.abs(continueRate - 0.5) * 12),
          zScore: z,
          evidence: `Alternation ${altKey}: continues ${altData.continues}/${total}`,
          source: 'alternation'
        });
      }
    }

    return signals;
  }

  // Aggregate signals into a final prediction with confidence
  aggregateSignals(signals, recentResults) {
    if (signals.length === 0) {
      return { 
        prediction: null, 
        confidence: 0, 
        canPredict: false,
        reason: 'No statistical edge found'
      };
    }

    // Weight signals by strength and combine using Bayesian updating
    let taiWeight = 0;
    let xiuWeight = 0;
    let totalWeight = 0;

    for (const signal of signals) {
      const weight = signal.strength * Math.min(1, Math.abs(signal.zScore || 1) / 3);
      if (signal.prediction === 'Tài') taiWeight += weight;
      else xiuWeight += weight;
      totalWeight += weight;
    }

    // Add prior from recent results
    const last20 = recentResults.slice(0, 20);
    const recentTai = last20.filter(r => r === 'Tài').length;
    const priorWeight = 0.5; // Low weight for prior
    taiWeight += (recentTai / 20) * priorWeight;
    xiuWeight += (1 - recentTai / 20) * priorWeight;
    totalWeight += priorWeight;

    if (totalWeight === 0) {
      return { prediction: null, confidence: 0, canPredict: false, reason: 'Zero weight' };
    }

    const taiProbability = taiWeight / totalWeight;
    const confidence = 50 + Math.abs(taiProbability - 0.5) * 100;
    
    // Only predict if confidence exceeds threshold
    const canPredict = confidence >= this.confidenceThreshold;
    
    // Check signal agreement
    const predictions = signals.map(s => s.prediction);
    const agreement = predictions.filter(p => p === predictions[0]).length / predictions.length;
    
    let finalConfidence = confidence;
    if (agreement < 0.5) {
      finalConfidence = Math.min(confidence, 52); // Low agreement = low confidence
    }

    return {
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.round(Math.min(75, finalConfidence)),
      canPredict: canPredict && agreement >= 0.4,
      taiProbability: taiProbability,
      signalCount: signals.length,
      agreement: agreement,
      signals: signals.slice(0, 5),
      reason: canPredict ? `${signals.length} signals, ${(agreement*100).toFixed(0)}% agreement` : `Confidence ${Math.round(confidence)}% < threshold ${this.confidenceThreshold}%`
    };
  }

  // Record actual outcome to update edge statistics and threshold
  recordOutcome(prediction, actual, confidence, signals) {
    this.totalPredictions++;
    const correct = prediction === actual;
    if (correct) this.totalCorrect++;

    // Update confidence threshold dynamically
    this.winRateHistory.push(correct ? 1 : 0);
    if (this.winRateHistory.length > 100) this.winRateHistory.shift();

    if (this.winRateHistory.length >= 20) {
      const recentWinRate = this.winRateHistory.reduce((a, b) => a + b, 0) / this.winRateHistory.length;
      
      // Adjust threshold: if winning, be slightly more aggressive; if losing, be more conservative
      if (recentWinRate > 0.55) {
        this.confidenceThreshold = Math.max(51, this.confidenceThreshold - 0.5);
      } else if (recentWinRate < 0.47) {
        this.confidenceThreshold = Math.min(65, this.confidenceThreshold + 1);
      }
    }
  }
}

// ==================== GLOBAL STATE ====================
let edgeDetectorHU = new StatisticalEdgeDetector().loadData('hu');
let edgeDetectorMD5 = new StatisticalEdgeDetector().loadData('md5');
let learningData = { hu: { predictions: [] }, md5: { predictions: [] } };

// ==================== HELPER FUNCTIONS ====================
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
  if (result === 'Tài' || result === 'tài') return 'tai';
  if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
  return 'xiu';
}

function savePredictionToHistory(type, phien, prediction, confidence, signals, reason) {
  const record = {
    phien_hien_tai: phien.toString(),
    du_doan: prediction ? normalizeResult(prediction) : 'unknown',
    ti_le: `${confidence}%`,
    can_predict: prediction !== null,
    reason: reason || '',
    signal_count: signals?.length || 0,
    id: 'kapub',
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  return record;
}

function preprocessData(data) {
  if (!data || !Array.isArray(data)) return null;
  return data.filter(d => d.Tong >= 3 && d.Tong <= 18 && d.Ket_qua);
}

// ==================== MAIN PREDICTION LOGIC ====================
function makePrediction(type, data) {
  const edgeDetector = type === 'hu' ? edgeDetectorHU : edgeDetectorMD5;
  
  // Ensure we have enough data
  const results = data.map(d => d.Ket_qua);
  const sums = data.map(d => d.Tong);
  
  if (results.length < 30) {
    return {
      prediction: null,
      confidence: 0,
      canPredict: false,
      reason: 'Insufficient data for analysis'
    };
  }

  // Learn from recent history
  edgeDetector.learnFromHistory(data.slice(0, Math.min(500, data.length)));

  // Find all statistical signals
  const signals = edgeDetector.findBestPrediction(results, sums, data[0]?.timestamp);

  // Aggregate signals
  const result = edgeDetector.aggregateSignals(signals, results);

  return result;
}

async function verifyPrediction(type, data, phien, prediction) {
  const actual = data.find(d => d.Phien.toString() === phien.toString());
  if (!actual) return null;
  
  const correct = actual.Ket_qua === prediction.prediction;
  const edgeDetector = type === 'hu' ? edgeDetectorHU : edgeDetectorMD5;
  
  if (prediction.prediction) {
    edgeDetector.recordOutcome(prediction.prediction, actual.Ket_qua, prediction.confidence, prediction.signals);
  }
  
  edgeDetector.saveData(type);
  
  return { actual: actual.Ket_qua, correct };
}

// ==================== AUTO PROCESS ====================
async function autoProcessPredictions() {
  try {
    // Process HU
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const processedHu = preprocessData(dataHu);
      if (processedHu) {
        const latestHuPhien = processedHu[0].Phien;
        const nextHuPhien = latestHuPhien + 1;
        
        if (lastProcessedPhien.hu !== nextHuPhien) {
          // Verify previous prediction
          if (lastProcessedPhien.hu) {
            await verifyPrediction('hu', processedHu, lastProcessedPhien.hu, 
              predictionHistory.hu[0] || { prediction: null, confidence: 0 }
            );
          }
          
          // Make new prediction
          const result = makePrediction('hu', processedHu);
          savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence, result.signals, result.reason);
          lastProcessedPhien.hu = nextHuPhien;
          
          const status = result.canPredict ? 
            `🎯 ${result.prediction} (${result.confidence}%)` : 
            `⏸️ SKIP - ${result.reason}`;
          console.log(`[Hu #${nextHuPhien}] ${status} | Signals: ${result.signalCount || 0}`);
        }
      }
    }
    
    // Process MD5
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const processedMd5 = preprocessData(dataMd5);
      if (processedMd5) {
        const latestMd5Phien = processedMd5[0].Phien;
        const nextMd5Phien = latestMd5Phien + 1;
        
        if (lastProcessedPhien.md5 !== nextMd5Phien) {
          if (lastProcessedPhien.md5) {
            await verifyPrediction('md5', processedMd5, lastProcessedPhien.md5,
              predictionHistory.md5[0] || { prediction: null, confidence: 0 }
            );
          }
          
          const result = makePrediction('md5', processedMd5);
          savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence, result.signals, result.reason);
          lastProcessedPhien.md5 = nextMd5Phien;
          
          const status = result.canPredict ? 
            `🎯 ${result.prediction} (${result.confidence}%)` : 
            `⏸️ SKIP - ${result.reason}`;
          console.log(`[MD5 #${nextMd5Phien}] ${status} | Signals: ${result.signalCount || 0}`);
        }
      }
    }
    
    // Save state
    saveAll();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

function saveAll() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    console.error('Save error:', e.message);
  }
}

function loadAll() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      predictionHistory = data.history || { hu: [], md5: [] };
      lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
    }
    console.log('[Data] History loaded');
  } catch (e) {
    console.error('Load error:', e.message);
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
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    
    const processed = preprocessData(data);
    if (!processed) return res.status(500).json({ error: 'Data processing failed' });
    
    const result = makePrediction('hu', processed);
    const latestPhien = processed[0].Phien;
    const nextPhien = latestPhien + 1;
    
    savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, result.signals, result.reason);
    lastProcessedPhien.hu = nextPhien;
    saveAll();
    
    if (!result.canPredict || !result.prediction) {
      return res.json({
        phien_hien_tai: nextPhien.toString(),
        du_doan: 'unknown',
        ti_le: '0%',
        status: 'skip',
        reason: result.reason,
        id: 'kapub'
      });
    }
    
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
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    
    const processed = preprocessData(data);
    if (!processed) return res.status(500).json({ error: 'Data processing failed' });
    
    const result = makePrediction('md5', processed);
    const latestPhien = processed[0].Phien;
    const nextPhien = latestPhien + 1;
    
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, result.signals, result.reason);
    lastProcessedPhien.md5 = nextPhien;
    saveAll();
    
    if (!result.canPredict || !result.prediction) {
      return res.json({
        phien_hien_tai: nextPhien.toString(),
        du_doan: 'unknown',
        ti_le: '0%',
        status: 'skip',
        reason: result.reason,
        id: 'kapub'
      });
    }
    
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
    if (data) {
      const processed = preprocessData(data);
      if (processed) {
        const historyWithStatus = predictionHistory.hu.map(record => {
          const actual = processed.find(d => d.Phien.toString() === record.phien_hien_tai);
          return {
            ...record,
            ket_qua_thuc_te: actual?.Ket_qua || null,
            status: actual ? (actual.Ket_qua === (record.du_doan === 'tai' ? 'Tài' : 'Xỉu') ? '✅' : '❌') : '⏳'
          };
        });
        return res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: historyWithStatus, total: historyWithStatus.length });
      }
    }
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
  } catch (error) {
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (data) {
      const processed = preprocessData(data);
      if (processed) {
        const historyWithStatus = predictionHistory.md5.map(record => {
          const actual = processed.find(d => d.Phien.toString() === record.phien_hien_tai);
          return {
            ...record,
            ket_qua_thuc_te: actual?.Ket_qua || null,
            status: actual ? (actual.Ket_qua === (record.du_doan === 'tai' ? 'Tài' : 'Xỉu') ? '✅' : '❌') : '⏳'
          };
        });
        return res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: historyWithStatus, total: historyWithStatus.length });
      }
    }
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
  } catch (error) {
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
  }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    
    const processed = preprocessData(data);
    if (!processed) return res.status(500).json({ error: 'Data error' });
    
    const result = makePrediction('hu', processed);
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      canPredict: result.canPredict,
      reason: result.reason,
      signals: result.signals?.map(s => ({
        source: s.source,
        prediction: s.prediction,
        strength: s.strength?.toFixed(3),
        evidence: s.evidence
      })) || [],
      threshold: edgeDetectorHU.confidenceThreshold,
      totalPredictions: edgeDetectorHU.totalPredictions,
      winRate: edgeDetectorHU.totalPredictions > 0 ? 
        (edgeDetectorHU.totalCorrect / edgeDetectorHU.totalPredictions * 100).toFixed(1) + '%' : 'N/A'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    
    const processed = preprocessData(data);
    if (!processed) return res.status(500).json({ error: 'Data error' });
    
    const result = makePrediction('md5', processed);
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      canPredict: result.canPredict,
      reason: result.reason,
      signals: result.signals?.map(s => ({
        source: s.source,
        prediction: s.prediction,
        strength: s.strength?.toFixed(3),
        evidence: s.evidence
      })) || [],
      threshold: edgeDetectorMD5.confidenceThreshold,
      totalPredictions: edgeDetectorMD5.totalPredictions,
      winRate: edgeDetectorMD5.totalPredictions > 0 ? 
        (edgeDetectorMD5.totalCorrect / edgeDetectorMD5.totalPredictions * 100).toFixed(1) + '%' : 'N/A'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/stats', (req, res) => {
  const ed = edgeDetectorHU;
  const recentWinRate = ed.winRateHistory.length > 0 ?
    (ed.winRateHistory.reduce((a, b) => a + b, 0) / ed.winRateHistory.length * 100).toFixed(1) + '%' : 'N/A';
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
    totalPredictions: ed.totalPredictions,
    totalCorrect: ed.totalCorrect,
    overallWinRate: ed.totalPredictions > 0 ? 
      (ed.totalCorrect / ed.totalPredictions * 100).toFixed(1) + '%' : 'N/A',
    recentWinRate: recentWinRate,
    confidenceThreshold: ed.confidenceThreshold + '%',
    edgeCounts: {
      streakEdges: Object.keys(ed.streakEdges).length,
      patternEdges: Object.keys(ed.patternEdges).length,
      timeEdges: Object.keys(ed.timeEdges).length,
      sumEdges: Object.keys(ed.sumEdges).length
    }
  });
});

app.get('/lc79-md5/stats', (req, res) => {
  const ed = edgeDetectorMD5;
  const recentWinRate = ed.winRateHistory.length > 0 ?
    (ed.winRateHistory.reduce((a, b) => a + b, 0) / ed.winRateHistory.length * 100).toFixed(1) + '%' : 'N/A';
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5',
    totalPredictions: ed.totalPredictions,
    totalCorrect: ed.totalCorrect,
    overallWinRate: ed.totalPredictions > 0 ? 
      (ed.totalCorrect / ed.totalPredictions * 100).toFixed(1) + '%' : 'N/A',
    recentWinRate: recentWinRate,
    confidenceThreshold: ed.confidenceThreshold + '%',
    edgeCounts: {
      streakEdges: Object.keys(ed.streakEdges).length,
      patternEdges: Object.keys(ed.patternEdges).length,
      timeEdges: Object.keys(ed.timeEdges).length,
      sumEdges: Object.keys(ed.sumEdges).length
    }
  });
});

app.get('/reset', (req, res) => {
  edgeDetectorHU = new StatisticalEdgeDetector();
  edgeDetectorMD5 = new StatisticalEdgeDetector();
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  
  edgeDetectorHU.saveData('hu');
  edgeDetectorMD5.saveData('md5');
  saveAll();
  
  res.json({ message: 'All data reset successfully' });
});

// ==================== SERVER STARTUP ====================
loadAll();

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - STATISTICAL EDGE DETECTOR v10.0               ║`);
  console.log(`║     Only predicts when statistically significant edge exists    ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server running: http://0.0.0.0:${PORT}`);
  console.log(`\n📊 STRATEGY:`);
  console.log(`  ✅ Learns 6 types of statistical edges from history`);
  console.log(`  ✅ Uses Z-score testing to find significant deviations`);
  console.log(`  ✅ Only predicts when confidence > adaptive threshold`);
  console.log(`  ✅ Skips predictions when no edge exists (conserves accuracy)`);
  console.log(`  ✅ Dynamic threshold adjusts based on actual win rate`);
  console.log(`  ✅ Bayesian signal aggregation with prior from recent data`);
  console.log(`\n🔍 EDGE TYPES DETECTED:`);
  console.log(`  1. Streak continuation/reversal patterns`);
  console.log(`  2. 4-outcome sequence patterns`);
  console.log(`  3. Time-of-day biases (2-hour slots)`);
  console.log(`  4. Post-sum outcome distributions`);
  console.log(`  5. Amplitude mean-reversion`);
  console.log(`  6. Alternation length prediction`);
  console.log(`\n⚙️ BEHAVIOR:`);
  console.log(`  - Starts conservative, becomes more aggressive if winning`);
  console.log(`  - Becomes more selective if losing streak detected`);
  console.log(`  - Will output 'unknown' when no valid edge found`);
  console.log(`\n📋 ENDPOINTS:`);
  console.log(`  GET /lc79-hu              - Prediction Hũ (may return 'skip')`);
  console.log(`  GET /lc79-md5             - Prediction MD5 (may return 'skip')`);
  console.log(`  GET /lc79-hu/lichsu       - Prediction history Hũ`);
  console.log(`  GET /lc79-md5/lichsu      - Prediction history MD5`);
  console.log(`  GET /lc79-hu/analysis     - Edge analysis Hũ`);
  console.log(`  GET /lc79-md5/analysis    - Edge analysis MD5`);
  console.log(`  GET /lc79-hu/stats        - Performance statistics`);
  console.log(`  GET /lc79-md5/stats       - Performance statistics`);
  console.log(`  GET /reset                - Reset all learned data\n`);
  
  console.log(`🔄 Auto-prediction: Every ${AUTO_SAVE_INTERVAL/1000}s`);
  console.log(`🎯 Goal: Only predict when P(correct) > 50%\n`);
});
