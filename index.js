const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'prediction_history.json';
const THRESHOLD_FILE = 'thresholds.json';

let predictionHistory = { hu: [], md5: [] };

const MAX_HISTORY = 500;
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== STATISTICAL EDGE DETECTOR ====================
class StatisticalEdgeDetector {
  constructor() {
    this.streakEdges = {};
    this.patternEdges = {};
    this.timeEdges = {};
    this.sumEdges = {};
    this.amplitudeEdges = {};
    this.alternationEdges = {};
    this.winRateHistory = [];
    this.totalPredictions = 0;
    this.totalCorrect = 0;
    this.confidenceThreshold = 55;
  }

  // Safe initialization helpers
  _ensureStreakEdge(key) {
    if (!this.streakEdges[key]) {
      this.streakEdges[key] = {
        tai: { correct: 0, total: 0 },
        xiu: { correct: 0, total: 0 }
      };
    }
    return this.streakEdges[key];
  }

  _ensurePatternEdge(key) {
    if (!this.patternEdges[key]) {
      this.patternEdges[key] = {
        tai: { correct: 0, total: 0 },
        xiu: { correct: 0, total: 0 }
      };
    }
    return this.patternEdges[key];
  }

  _ensureTimeEdge(key) {
    if (!this.timeEdges[key]) {
      this.timeEdges[key] = { tai: { hits: 0, total: 0 } };
    }
    return this.timeEdges[key];
  }

  _ensureSumEdge(key) {
    if (!this.sumEdges[key]) {
      this.sumEdges[key] = { nextTai: 0, nextXiu: 0 };
    }
    return this.sumEdges[key];
  }

  _ensureAmplitudeEdge(key) {
    if (!this.amplitudeEdges[key]) {
      this.amplitudeEdges[key] = { nextTai: 0, nextXiu: 0 };
    }
    return this.amplitudeEdges[key];
  }

  _ensureAlternationEdge(key) {
    if (!this.alternationEdges[key]) {
      this.alternationEdges[key] = { continues: 0, reverses: 0 };
    }
    return this.alternationEdges[key];
  }

  loadData(type) {
    try {
      if (fs.existsSync(THRESHOLD_FILE)) {
        const raw = fs.readFileSync(THRESHOLD_FILE, 'utf8');
        const allData = JSON.parse(raw);
        if (allData && allData[type]) {
          const d = allData[type];
          this.streakEdges = d.streakEdges || {};
          this.patternEdges = d.patternEdges || {};
          this.timeEdges = d.timeEdges || {};
          this.sumEdges = d.sumEdges || {};
          this.amplitudeEdges = d.amplitudeEdges || {};
          this.alternationEdges = d.alternationEdges || {};
          this.winRateHistory = Array.isArray(d.winRateHistory) ? d.winRateHistory.slice(-200) : [];
          this.totalPredictions = d.totalPredictions || 0;
          this.totalCorrect = d.totalCorrect || 0;
          this.confidenceThreshold = d.confidenceThreshold || 55;
          console.log(`[EdgeDetector] Loaded ${type}: ${Object.keys(this.streakEdges).length} streaks, ${Object.keys(this.patternEdges).length} patterns, ${this.totalPredictions} preds`);
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
        try {
          allData = JSON.parse(fs.readFileSync(THRESHOLD_FILE, 'utf8'));
        } catch (e) {
          allData = {};
        }
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

  learnFromHistory(historyData) {
    if (!historyData || !Array.isArray(historyData) || historyData.length < 30) return;

    const results = historyData.map(d => d.Ket_qua || '');
    const sums = historyData.map(d => d.Tong || 10);
    const n = results.length;

    // 1. Learn streak edges
    for (let i = 5; i < n - 1; i++) {
      if (!results[i] || !results[i + 1]) continue;
      
      let streakType = results[i];
      let streakLength = 1;
      for (let j = i - 1; j >= 0; j--) {
        if (results[j] === streakType) streakLength++;
        else break;
      }

      const nextOutcome = results[i + 1];
      const streakKey = `${streakType}_${Math.min(streakLength, 15)}`;

      const edge = this._ensureStreakEdge(streakKey);
      const lowerType = streakType.toLowerCase();

      if (edge[lowerType]) {
        edge[lowerType].total++;
        if (nextOutcome === streakType) edge[lowerType].correct++;
      }

      const oppositeType = streakType === 'Tài' ? 'xiu' : 'tai';
      if (edge[oppositeType]) {
        edge[oppositeType].total++;
        if (nextOutcome !== streakType) edge[oppositeType].correct++;
      }
    }

    // 2. Learn pattern edges
    for (let i = 4; i < n - 1; i++) {
      const slice = results.slice(i - 3, i + 1);
      if (slice.some(r => !r)) continue;
      
      const pattern = slice.join('');
      const nextOutcome = results[i + 1];
      if (!nextOutcome) continue;

      const edge = this._ensurePatternEdge(pattern);

      if (edge.tai) {
        edge.tai.total++;
        if (nextOutcome === 'Tài') edge.tai.correct++;
      }
      if (edge.xiu) {
        edge.xiu.total++;
        if (nextOutcome === 'Xỉu') edge.xiu.correct++;
      }
    }

    // 3. Learn time edges
    for (let i = 0; i < n; i++) {
      const outcome = results[i];
      if (!outcome) continue;
      
      const ts = historyData[i]?.timestamp;
      const hour = ts ? new Date(ts).getHours() : 0;
      const slot = Math.floor(hour / 2);

      const edge = this._ensureTimeEdge(slot);
      if (edge.tai) {
        edge.tai.total++;
        if (outcome === 'Tài') edge.tai.hits++;
      }
    }

    // 4. Learn sum edges
    for (let i = 0; i < n - 1; i++) {
      if (!sums[i] || !results[i + 1]) continue;
      
      const sum = sums[i];
      const range = sum <= 8 ? 'low' : sum >= 13 ? 'high' : 'mid';
      const nextOutcome = results[i + 1];

      const edge = this._ensureSumEdge(range);
      if (nextOutcome === 'Tài') edge.nextTai++;
      else edge.nextXiu++;
    }

    // 5. Learn amplitude edges
    for (let i = 5; i < n - 1; i++) {
      const last5 = results.slice(i - 4, i + 1);
      if (last5.some(r => !r) || !results[i + 1]) continue;
      
      const taiCount = last5.filter(r => r === 'Tài').length;
      const amplitude = Math.round(Math.abs(taiCount - 2.5) * 2);
      const nextOutcome = results[i + 1];

      const edge = this._ensureAmplitudeEdge(amplitude);
      if (nextOutcome === 'Tài') edge.nextTai++;
      else edge.nextXiu++;
    }

    // 6. Learn alternation edges
    for (let i = 3; i < n - 1; i++) {
      if (!results[i] || !results[i + 1]) continue;
      
      let altLength = 1;
      for (let j = i; j > 0; j--) {
        if (results[j] && results[j - 1] && results[j] !== results[j - 1]) altLength++;
        else break;
      }

      const nextOutcome = results[i + 1];
      const wouldContinue = nextOutcome !== results[i];
      const altKey = Math.min(altLength, 10);

      const edge = this._ensureAlternationEdge(altKey);
      if (wouldContinue) edge.continues++;
      else edge.reverses++;
    }

    // Adjust threshold
    if (this.totalPredictions > 30 && this.winRateHistory.length >= 20) {
      const recentWinRate = this.winRateHistory.reduce((a, b) => a + b, 0) / this.winRateHistory.length;
      if (recentWinRate > 0.54) {
        this.confidenceThreshold = Math.max(51, this.confidenceThreshold - 1);
      } else if (recentWinRate < 0.47) {
        this.confidenceThreshold = Math.min(65, this.confidenceThreshold + 2);
      }
    }
  }

  zScore(successes, total, expectedProb = 0.5) {
    if (!total || total < 5) return 0;
    const observed = successes / total;
    const se = Math.sqrt(expectedProb * (1 - expectedProb) / total);
    if (se === 0) return 0;
    return (observed - expectedProb) / se;
  }

  pValue(z) {
    const absZ = Math.abs(z);
    if (absZ > 6) return 0;
    const t = 1 / (1 + 0.2316419 * absZ);
    const d = 0.3989423 * Math.exp(-absZ * absZ / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return Math.max(0, 1 - prob);
  }

  findBestPrediction(currentResults, currentSums, currentTimestamp) {
    const signals = [];
    const recentResults = currentResults.slice(0, 30);
    const recentSums = currentSums.slice(0, 30);

    if (recentResults.length < 5) return [];

    // 1. Streak edge
    let streakType = recentResults[0];
    let streakLength = 1;
    for (let i = 1; i < recentResults.length; i++) {
      if (recentResults[i] === streakType) streakLength++;
      else break;
    }
    const streakKey = `${streakType}_${Math.min(streakLength, 15)}`;
    const streakData = this.streakEdges[streakKey];

    if (streakData) {
      const continueStats = streakData[streakType.toLowerCase()];
      const reverseStats = streakData[streakType === 'Tài' ? 'xiu' : 'tai'];

      if (continueStats && continueStats.total >= 10) {
        const z = this.zScore(continueStats.correct, continueStats.total, 0.5);
        const p = this.pValue(z);
        if (p < 0.40 && continueStats.correct / continueStats.total > 0.5) {
          signals.push({
            prediction: streakType,
            strength: Math.min(1, (continueStats.correct / continueStats.total - 0.5) * 10),
            zScore: z,
            evidence: `Streak continue: ${continueStats.correct}/${continueStats.total}`,
            source: 'streak_continue'
          });
        }
      }

      if (reverseStats && reverseStats.total >= 10) {
        const z = this.zScore(reverseStats.correct, reverseStats.total, 0.5);
        const p = this.pValue(z);
        if (p < 0.40 && reverseStats.correct / reverseStats.total > 0.5) {
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

    // 2. Pattern edge
    if (recentResults.length >= 4) {
      const pattern = recentResults.slice(0, 4).join('');
      const patternData = this.patternEdges[pattern];

      if (patternData && patternData.tai && patternData.xiu) {
        const taiTotal = patternData.tai.total || 0;
        const xiuTotal = patternData.xiu.total || 0;
        const combinedTotal = taiTotal + xiuTotal;

        if (combinedTotal >= 15) {
          if (taiTotal >= 10) {
            const taiRate = patternData.tai.correct / Math.max(1, taiTotal);
            if (taiRate > 0.50) {
              signals.push({
                prediction: 'Tài',
                strength: Math.min(1, (taiRate - 0.5) * 20),
                evidence: `Pattern ${pattern}: Tài ${patternData.tai.correct}/${taiTotal}`,
                source: 'pattern_tai'
              });
            }
          }
          if (xiuTotal >= 10) {
            const xiuRate = patternData.xiu.correct / Math.max(1, xiuTotal);
            if (xiuRate > 0.50) {
              signals.push({
                prediction: 'Xỉu',
                strength: Math.min(1, (xiuRate - 0.5) * 20),
                evidence: `Pattern ${pattern}: Xỉu ${patternData.xiu.correct}/${xiuTotal}`,
                source: 'pattern_xiu'
              });
            }
          }
        }
      }
    }

    // 3. Time edge
    if (currentTimestamp) {
      const hour = new Date(currentTimestamp).getHours();
      const slot = Math.floor(hour / 2);
      const timeData = this.timeEdges[slot];

      if (timeData && timeData.tai && timeData.tai.total >= 20) {
        const taiRate = timeData.tai.hits / timeData.tai.total;
        const z = this.zScore(timeData.tai.hits, timeData.tai.total, 0.5);
        const p = this.pValue(z);

        if (p < 0.40) {
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

    // 4. Sum edge
    if (recentSums.length > 0 && recentSums[0]) {
      const lastSum = recentSums[0];
      const range = lastSum <= 8 ? 'low' : lastSum >= 13 ? 'high' : 'mid';
      const sumData = this.sumEdges[range];

      if (sumData && (sumData.nextTai + sumData.nextXiu) >= 20) {
        const total = sumData.nextTai + sumData.nextXiu;
        const taiRate = sumData.nextTai / total;
        const z = this.zScore(sumData.nextTai, total, 0.5);
        const p = this.pValue(z);

        if (p < 0.40) {
          signals.push({
            prediction: taiRate > 0.5 ? 'Tài' : 'Xỉu',
            strength: Math.min(1, Math.abs(taiRate - 0.5) * 15),
            zScore: z,
            evidence: `After ${range} sum: Tài ${sumData.nextTai}/${total}`,
            source: 'sum'
          });
        }
      }
    }

    // 5. Amplitude edge
    if (recentResults.length >= 5) {
      const last5 = recentResults.slice(0, 5);
      const taiCount = last5.filter(r => r === 'Tài').length;
      const amplitude = Math.round(Math.abs(taiCount - 2.5) * 2);
      const ampData = this.amplitudeEdges[amplitude];

      if (ampData && (ampData.nextTai + ampData.nextXiu) >= 15) {
        const total = ampData.nextTai + ampData.nextXiu;
        const taiRate = ampData.nextTai / total;
        const z = this.zScore(ampData.nextTai, total, 0.5);
        const p = this.pValue(z);

        if (p < 0.40) {
          signals.push({
            prediction: taiRate > 0.5 ? 'Tài' : 'Xỉu',
            strength: Math.min(1, Math.abs(taiRate - 0.5) * 12),
            zScore: z,
            evidence: `Amplitude ${amplitude}: Tài ${ampData.nextTai}/${total}`,
            source: 'amplitude'
          });
        }
      }
    }

    // 6. Alternation edge
    let altLength = 1;
    for (let i = 1; i < Math.min(recentResults.length, 11); i++) {
      if (recentResults[i] !== recentResults[i - 1]) altLength++;
      else break;
    }
    const altKey = Math.min(altLength, 10);
    const altData = this.alternationEdges[altKey];

    if (altData && (altData.continues + altData.reverses) >= 15) {
      const total = altData.continues + altData.reverses;
      const continueRate = altData.continues / total;
      const z = this.zScore(altData.continues, total, 0.5);
      const p = this.pValue(z);

      if (p < 0.40) {
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

  aggregateSignals(signals, recentResults) {
    if (!signals || signals.length === 0) {
      return {
        prediction: null,
        confidence: 0,
        canPredict: false,
        reason: 'No statistical edge found',
        signals: []
      };
    }

    let taiWeight = 0;
    let xiuWeight = 0;
    let totalWeight = 0;

    for (const signal of signals) {
      if (!signal || !signal.prediction) continue;
      const weight = (signal.strength || 0.1) * Math.min(1, Math.abs(signal.zScore || 0.5) / 3);
      if (signal.prediction === 'Tài') taiWeight += weight;
      else if (signal.prediction === 'Xỉu') xiuWeight += weight;
      totalWeight += weight;
    }

    // Add prior from recent results
    const last20 = recentResults.slice(0, 20);
    const recentTai = last20.filter(r => r === 'Tài').length;
    const priorWeight = 0.3;
    taiWeight += (recentTai / Math.max(1, last20.length)) * priorWeight;
    xiuWeight += (1 - recentTai / Math.max(1, last20.length)) * priorWeight;
    totalWeight += priorWeight;

    if (totalWeight === 0) {
      return {
        prediction: null,
        confidence: 0,
        canPredict: false,
        reason: 'Zero total weight',
        signals: signals.slice(0, 5)
      };
    }

    const taiProbability = taiWeight / totalWeight;
    const confidence = 50 + Math.abs(taiProbability - 0.5) * 100;

    // Check signal agreement
    const predictions = signals.map(s => s.prediction).filter(p => p);
    const agreement = predictions.length > 0
      ? predictions.filter(p => p === predictions[0]).length / predictions.length
      : 0;

    let finalConfidence = confidence;
    if (agreement < 0.5) {
      finalConfidence = Math.min(confidence, 52);
    }

    const canPredict = finalConfidence >= this.confidenceThreshold && agreement >= 0.4;

    return {
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.round(Math.min(75, finalConfidence)),
      canPredict,
      taiProbability,
      signalCount: signals.length,
      agreement,
      signals: signals.slice(0, 5),
      reason: canPredict
        ? `${signals.length} signals, ${(agreement * 100).toFixed(0)}% agreement`
        : `Confidence ${Math.round(finalConfidence)}% < threshold ${this.confidenceThreshold}%`
    };
  }

  recordOutcome(prediction, actual, confidence, signals) {
    if (!prediction || !actual) return;
    
    this.totalPredictions++;
    const correct = prediction === actual;
    if (correct) this.totalCorrect++;

    this.winRateHistory.push(correct ? 1 : 0);
    if (this.winRateHistory.length > 200) this.winRateHistory.shift();

    if (this.winRateHistory.length >= 20) {
      const recentWinRate = this.winRateHistory.reduce((a, b) => a + b, 0) / this.winRateHistory.length;
      if (recentWinRate > 0.54) {
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
  if (result === 'Tài' || result === 'tài') return 'tai';
  if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
  return 'unknown';
}

function preprocessData(data) {
  if (!data || !Array.isArray(data)) return [];
  return data.filter(d => d && d.Tong >= 3 && d.Tong <= 18 && d.Ket_qua);
}

function savePredictionToHistory(type, phien, result) {
  const record = {
    phien_hien_tai: phien.toString(),
    du_doan: result.prediction ? normalizeResult(result.prediction) : 'unknown',
    ti_le: result.canPredict ? `${result.confidence}%` : '0%',
    can_predict: result.canPredict,
    reason: result.reason || '',
    signal_count: result.signalCount || 0,
    id: 'kapub',
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
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
  const edgeDetector = type === 'hu' ? edgeDetectorHU : edgeDetectorMD5;

  const results = data.map(d => d.Ket_qua || '');
  const sums = data.map(d => d.Tong || 10);

  if (results.length < 10) {
    return {
      prediction: null,
      confidence: 0,
      canPredict: false,
      reason: 'Insufficient data',
      signals: []
    };
  }

  // Learn from ALL available history (up to 500 most recent)
  const historyForLearning = data.slice(0, Math.min(500, data.length));
  edgeDetector.learnFromHistory(historyForLearning);

  // Find signals
  const signals = edgeDetector.findBestPrediction(results, sums, data[0]?.timestamp);

  // Aggregate
  const result = edgeDetector.aggregateSignals(signals, results);

  // Save learned data
  edgeDetector.saveData(type);

  return result;
}

async function verifyAndUpdate(type, data, phienToVerify, lastPrediction) {
  if (!phienToVerify || !lastPrediction || !lastPrediction.prediction) return;

  const actualSession = data.find(d => d && d.Phien && d.Phien.toString() === phienToVerify.toString());
  if (!actualSession || !actualSession.Ket_qua) return;

  const edgeDetector = type === 'hu' ? edgeDetectorHU : edgeDetectorMD5;
  edgeDetector.recordOutcome(
    lastPrediction.prediction,
    actualSession.Ket_qua,
    lastPrediction.confidence || 0,
    lastPrediction.signals || []
  );
  edgeDetector.saveData(type);
}

// ==================== AUTO PROCESS ====================
async function autoProcessPredictions() {
  try {
    // Process HU
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const processedHu = preprocessData(dataHu);
      if (processedHu.length > 0) {
        const latestHuPhien = processedHu[0].Phien;
        const nextHuPhien = latestHuPhien + 1;

        if (lastProcessedPhien.hu && lastProcessedPhien.hu !== nextHuPhien) {
          const lastPred = predictionHistory.hu[0];
          if (lastPred && lastPred.prediction && lastPred.prediction !== 'unknown') {
            await verifyAndUpdate('hu', processedHu, lastProcessedPhien.hu, {
              prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu',
              confidence: parseInt(lastPred.ti_le) || 0,
              signals: []
            });
          }
        }

        if (lastProcessedPhien.hu !== nextHuPhien) {
          const result = makePrediction('hu', processedHu);
          savePredictionToHistory('hu', nextHuPhien, result);
          lastProcessedPhien.hu = nextHuPhien;

          const status = result.canPredict
            ? `🎯 ${result.prediction} (${result.confidence}%)`
            : `⏸️ SKIP - ${result.reason}`;
          console.log(`[Hu #${nextHuPhien}] ${status} | Signals: ${result.signalCount || 0}`);
        }
      }
    }

    // Process MD5
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const processedMd5 = preprocessData(dataMd5);
      if (processedMd5.length > 0) {
        const latestMd5Phien = processedMd5[0].Phien;
        const nextMd5Phien = latestMd5Phien + 1;

        if (lastProcessedPhien.md5 && lastProcessedPhien.md5 !== nextMd5Phien) {
          const lastPred = predictionHistory.md5[0];
          if (lastPred && lastPred.prediction && lastPred.prediction !== 'unknown') {
            await verifyAndUpdate('md5', processedMd5, lastProcessedPhien.md5, {
              prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu',
              confidence: parseInt(lastPred.ti_le) || 0,
              signals: []
            });
          }
        }

        if (lastProcessedPhien.md5 !== nextMd5Phien) {
          const result = makePrediction('md5', processedMd5);
          savePredictionToHistory('md5', nextMd5Phien, result);
          lastProcessedPhien.md5 = nextMd5Phien;

          const status = result.canPredict
            ? `🎯 ${result.prediction} (${result.confidence}%)`
            : `⏸️ SKIP - ${result.reason}`;
          console.log(`[MD5 #${nextMd5Phien}] ${status} | Signals: ${result.signalCount || 0}`);
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
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('kapub');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });

    const processed = preprocessData(data);
    if (processed.length === 0) return res.status(500).json({ error: 'Data error' });

    const result = makePrediction('hu', processed);
    const latestPhien = processed[0].Phien;
    const nextPhien = latestPhien + 1;

    if (lastProcessedPhien.hu && lastProcessedPhien.hu !== nextPhien) {
      const lastPred = predictionHistory.hu[0];
      if (lastPred && lastPred.prediction && lastPred.prediction !== 'unknown') {
        await verifyAndUpdate('hu', processed, lastProcessedPhien.hu, {
          prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu',
          confidence: parseInt(lastPred.ti_le) || 0,
          signals: []
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
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });

    const processed = preprocessData(data);
    if (processed.length === 0) return res.status(500).json({ error: 'Data error' });

    const result = makePrediction('md5', processed);
    const latestPhien = processed[0].Phien;
    const nextPhien = latestPhien + 1;

    if (lastProcessedPhien.md5 && lastProcessedPhien.md5 !== nextPhien) {
      const lastPred = predictionHistory.md5[0];
      if (lastPred && lastPred.prediction && lastPred.prediction !== 'unknown') {
        await verifyAndUpdate('md5', processed, lastProcessedPhien.md5, {
          prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu',
          confidence: parseInt(lastPred.ti_le) || 0,
          signals: []
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
    const processed = data ? preprocessData(data) : [];
    const historyWithStatus = predictionHistory.hu.map(record => {
      const actual = processed.find(d => d && d.Phien && d.Phien.toString() === record.phien_hien_tai);
      let status = '⏳';
      if (actual && actual.Ket_qua) {
        const predictedTai = record.du_doan === 'tai';
        const actualTai = actual.Ket_qua === 'Tài';
        status = predictedTai === actualTai ? '✅' : '❌';
      }
      return { ...record, ket_qua_thuc_te: actual?.Ket_qua || null, status };
    });
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: historyWithStatus, total: historyWithStatus.length });
  } catch (error) {
    res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    const processed = data ? preprocessData(data) : [];
    const historyWithStatus = predictionHistory.md5.map(record => {
      const actual = processed.find(d => d && d.Phien && d.Phien.toString() === record.phien_hien_tai);
      let status = '⏳';
      if (actual && actual.Ket_qua) {
        const predictedTai = record.du_doan === 'tai';
        const actualTai = actual.Ket_qua === 'Tài';
        status = predictedTai === actualTai ? '✅' : '❌';
      }
      return { ...record, ket_qua_thuc_te: actual?.Ket_qua || null, status };
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
    const processed = preprocessData(data);
    if (processed.length === 0) return res.status(500).json({ error: 'Data error' });

    const result = makePrediction('hu', processed);
    const ed = edgeDetectorHU;
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
      dynamicThreshold: ed.confidenceThreshold,
      totalMade: ed.totalPredictions,
      totalCorrect: ed.totalCorrect,
      winRate: ed.totalPredictions > 0
        ? (ed.totalCorrect / ed.totalPredictions * 100).toFixed(1) + '%'
        : 'N/A'
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
    if (processed.length === 0) return res.status(500).json({ error: 'Data error' });

    const result = makePrediction('md5', processed);
    const ed = edgeDetectorMD5;
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
      dynamicThreshold: ed.confidenceThreshold,
      totalMade: ed.totalPredictions,
      totalCorrect: ed.totalCorrect,
      winRate: ed.totalPredictions > 0
        ? (ed.totalCorrect / ed.totalPredictions * 100).toFixed(1) + '%'
        : 'N/A'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/stats', (req, res) => {
  const ed = edgeDetectorHU;
  const recentWR = ed.winRateHistory.length > 0
    ? (ed.winRateHistory.reduce((a, b) => a + b, 0) / ed.winRateHistory.length * 100).toFixed(1) + '%'
    : 'N/A';

  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
    totalMade: ed.totalPredictions,
    totalCorrect: ed.totalCorrect,
    overallWinRate: ed.totalPredictions > 0
      ? (ed.totalCorrect / ed.totalPredictions * 100).toFixed(1) + '%'
      : 'N/A',
    recentWinRate: recentWR,
    confidenceThreshold: ed.confidenceThreshold + '%',
    edgeCounts: {
      streaks: Object.keys(ed.streakEdges).length,
      patterns: Object.keys(ed.patternEdges).length,
      timeSlots: Object.keys(ed.timeEdges).length,
      sumRanges: Object.keys(ed.sumEdges).length,
      amplitudes: Object.keys(ed.amplitudeEdges).length,
      alternations: Object.keys(ed.alternationEdges).length
    }
  });
});

app.get('/lc79-md5/stats', (req, res) => {
  const ed = edgeDetectorMD5;
  const recentWR = ed.winRateHistory.length > 0
    ? (ed.winRateHistory.reduce((a, b) => a + b, 0) / ed.winRateHistory.length * 100).toFixed(1) + '%'
    : 'N/A';

  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5',
    totalMade: ed.totalPredictions,
    totalCorrect: ed.totalCorrect,
    overallWinRate: ed.totalPredictions > 0
      ? (ed.totalCorrect / ed.totalPredictions * 100).toFixed(1) + '%'
      : 'N/A',
    recentWinRate: recentWR,
    confidenceThreshold: ed.confidenceThreshold + '%',
    edgeCounts: {
      streaks: Object.keys(ed.streakEdges).length,
      patterns: Object.keys(ed.patternEdges).length,
      timeSlots: Object.keys(ed.timeEdges).length,
      sumRanges: Object.keys(ed.sumEdges).length,
      amplitudes: Object.keys(ed.amplitudeEdges).length,
      alternations: Object.keys(ed.alternationEdges).length
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

// ==================== STARTUP ====================
loadAll();

setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
setTimeout(autoProcessPredictions, 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - STATISTICAL EDGE DETECTOR v10.1               ║`);
  console.log(`║     Learns 6 edge types, predicts only when significant         ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);
  console.log(`Server running: http://0.0.0.0:${PORT}`);
  console.log(`\n🔍 EDGE TYPES: streak, pattern, time, sum, amplitude, alternation`);
  console.log(`🎯 Only predicts when confidence > dynamic threshold (starts 55%)`);
  console.log(`📋 ENDPOINTS: /lc79-hu, /lc79-md5, /lc79-hu/lichsu, etc.\n`);
});
