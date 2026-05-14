const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 5000);

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

const DATA_DIR = __dirname;
const LEARNING_FILE = path.join(DATA_DIR, 'learning_data.json');
const HISTORY_FILE = path.join(DATA_DIR, 'prediction_history.json');
const OUTCOME_FILE = path.join(DATA_DIR, 'outcome_history.json');

const LABELS = ['Tài', 'Xỉu'];

const CONFIG = {
  MAX_HISTORY: 300,
  MAX_OUTCOME_HISTORY: 20000,
  MAX_PREDICTIONS: 1500,
  AUTO_PROCESS_INTERVAL: 15000,
  CLEANUP_INTERVAL: 21600000,
  FETCH_TIMEOUT: 10000,
  PATTERN_WINDOW: 32,
  PATTERN_MIN_MATCHES: 10,
  MIN_ACTION_EDGE: 0.035,
  MIN_ACTION_CONFIDENCE: 54,
  CONFIDENCE_CAP: 67,
  METHOD_PRIOR: 40,
  RECENT_METHOD_WINDOW: 80,
  RECENT_ACCURACY_WINDOW: 20
};

function emptyMethodStats() {
  return {
    simple: { correct: 0, total: 0, recent: [] },
    markov: { correct: 0, total: 0, recent: [] },
    similarity: { correct: 0, total: 0, recent: [] },
    modulo: { correct: 0, total: 0, recent: [] },
    shape: { correct: 0, total: 0, recent: [] },
    dice: { correct: 0, total: 0, recent: [] },
    timeWindow: { correct: 0, total: 0, recent: [] },
    ensemble: { correct: 0, total: 0, recent: [] }
  };
}

function emptyLearningBucket() {
  return {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    recentAccuracy: [],
    streakAnalysis: {
      wins: 0,
      losses: 0,
      currentStreak: 0,
      bestStreak: 0,
      worstStreak: 0
    },
    methodPerformance: emptyMethodStats(),
    mistakePatterns: {},
    timeWindowStats: {},
    lastUpdate: null
  };
}

let learningData = {
  hu: emptyLearningBucket(),
  md5: emptyLearningBucket()
};

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let outcomeHistory = { hu: [], md5: [] };
let apiCache = { hu: { at: 0, data: null }, md5: { at: 0, data: null } };
let coldRateCache = { hu: null, md5: null };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values, fallback = 0) {
  if (!values || values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeResult(result) {
  if (result === 'Tài' || result === 'tai' || result === 'TAI') return 'tai';
  if (result === 'Xỉu' || result === 'xiu' || result === 'XIU') return 'xiu';
  return String(result || '').toLowerCase();
}

function denormalizeResult(result) {
  return normalizeResult(result) === 'tai' ? 'Tài' : 'Xỉu';
}

function opposite(result) {
  return result === 'Tài' ? 'Xỉu' : 'Tài';
}

function safeJsonRead(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`[Data] Cannot read ${path.basename(file)}:`, error.message);
    return fallback;
  }
}

function safeJsonWrite(file, value) {
  try {
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch (error) {
    console.error(`[Data] Cannot write ${path.basename(file)}:`, error.message);
  }
}

function ensureMethodStats(bucket) {
  const defaults = emptyMethodStats();
  bucket.methodPerformance = bucket.methodPerformance || defaults;

  for (const [method, stats] of Object.entries(defaults)) {
    const existing = bucket.methodPerformance[method] || {};
    bucket.methodPerformance[method] = {
      correct: Number(existing.correct || 0),
      total: Number(existing.total || 0),
      recent: Array.isArray(existing.recent) ? existing.recent.slice(-CONFIG.RECENT_METHOD_WINDOW) : []
    };
  }
}

function loadState() {
  const parsedLearning = safeJsonRead(LEARNING_FILE, null);
  if (parsedLearning) {
    for (const type of ['hu', 'md5']) {
      learningData[type] = {
        ...emptyLearningBucket(),
        ...(parsedLearning[type] || {})
      };
      ensureMethodStats(learningData[type]);
      learningData[type].predictions = Array.isArray(learningData[type].predictions)
        ? learningData[type].predictions
        : [];
      learningData[type].recentAccuracy = Array.isArray(learningData[type].recentAccuracy)
        ? learningData[type].recentAccuracy
        : [];
      learningData[type].mistakePatterns = learningData[type].mistakePatterns || {};
      learningData[type].timeWindowStats = learningData[type].timeWindowStats || {};
      recalculateTotals(type);
    }
  }

  const parsedHistory = safeJsonRead(HISTORY_FILE, null);
  if (parsedHistory) {
    predictionHistory = parsedHistory.history || predictionHistory;
    lastProcessedPhien = parsedHistory.lastProcessedPhien || lastProcessedPhien;
  }

  const parsedOutcomes = safeJsonRead(OUTCOME_FILE, null);
  if (parsedOutcomes) {
    outcomeHistory = {
      hu: Array.isArray(parsedOutcomes.hu) ? preprocessData(parsedOutcomes.hu) || [] : [],
      md5: Array.isArray(parsedOutcomes.md5) ? preprocessData(parsedOutcomes.md5) || [] : []
    };
  }
}

function saveState() {
  safeJsonWrite(LEARNING_FILE, learningData);
  safeJsonWrite(HISTORY_FILE, {
    history: predictionHistory,
    lastProcessedPhien,
    lastSaved: new Date().toISOString()
  });
  safeJsonWrite(OUTCOME_FILE, {
    hu: outcomeHistory.hu,
    md5: outcomeHistory.md5,
    lastSaved: new Date().toISOString()
  });
}

function recalculateTotals(type) {
  const verified = learningData[type].predictions.filter(p => p.verified && p.actual !== 'TIMEOUT');
  learningData[type].totalPredictions = verified.length;
  learningData[type].correctPredictions = verified.filter(p => p.isCorrect).length;
}

function transformApiData(apiData) {
  if (!apiData || !Array.isArray(apiData.list)) return null;

  return apiData.list
    .filter(item => item && item.id != null && Array.isArray(item.dices) && item.dices.length >= 3)
    .map(item => {
      const dice = item.dices.map(Number);
      const sum = Number(item.point || dice.reduce((a, b) => a + b, 0));
      return {
        Phien: Number(item.id),
        Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
        Xuc_xac_1: dice[0],
        Xuc_xac_2: dice[1],
        Xuc_xac_3: dice[2],
        Tong: clamp(sum, 3, 18),
        timestamp: item.createdAt || item.updatedAt || new Date().toISOString()
      };
    })
    .sort((a, b) => b.Phien - a.Phien);
}

function preprocessData(rawData) {
  if (!Array.isArray(rawData) || rawData.length === 0) return null;

  const seen = new Set();
  return rawData
    .filter(row => {
      if (!Number.isFinite(row.Phien) || seen.has(row.Phien)) return false;
      seen.add(row.Phien);
      return LABELS.includes(row.Ket_qua);
    })
    .map(row => ({
      ...row,
      Tong: clamp(Number(row.Tong || 10), 3, 18)
    }));
}

function mergeOutcomeHistory(type, liveData) {
  if (!Array.isArray(liveData) || liveData.length === 0) return outcomeHistory[type] || [];

  const byPhien = new Map();
  for (const row of outcomeHistory[type] || []) {
    byPhien.set(String(row.Phien), row);
  }
  for (const row of liveData) {
    byPhien.set(String(row.Phien), row);
  }

  outcomeHistory[type] = Array.from(byPhien.values())
    .sort((a, b) => b.Phien - a.Phien)
    .slice(0, CONFIG.MAX_OUTCOME_HISTORY);

  return outcomeHistory[type];
}

function getDataTape(type, liveData = []) {
  return mergeOutcomeHistory(type, liveData);
}

async function fetchApi(type, force = false) {
  const cached = apiCache[type];
  if (!force && cached.data && Date.now() - cached.at < 4000) return cached.data;

  const url = type === 'hu' ? API_URL_HU : API_URL_MD5;
  try {
    const response = await axios.get(url, { timeout: CONFIG.FETCH_TIMEOUT });
    const data = preprocessData(transformApiData(response.data));
    if (data && data.length > 0) {
      mergeOutcomeHistory(type, data);
      apiCache[type] = { at: Date.now(), data };
      return data;
    }
  } catch (error) {
    console.error(`[Fetch ${type}]`, error.message);
  }

  return cached.data;
}

function currentStreak(results) {
  if (!results.length) return { value: null, length: 0 };
  let length = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[0]) break;
    length++;
  }
  return { value: results[0], length };
}

function alternatingLength(results) {
  if (!results.length) return 0;
  let length = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[i - 1]) break;
    length++;
  }
  return length;
}

function betaProbability(success, total, prior = 2) {
  return (success + prior * 0.5) / (total + prior);
}

function confidenceFromProbability(pTai, reliability = 0.5) {
  const edge = Math.abs(pTai - 0.5);
  const cap = CONFIG.CONFIDENCE_CAP + Math.max(0, reliability - 0.55) * 30;
  return Math.round(clamp(50 + edge * 135, 50, cap));
}

function makeSignal(method, pTai, baseWeight, details = {}) {
  const probability = clamp(Number(pTai), 0.08, 0.92);
  return {
    method,
    prediction: probability >= 0.5 ? 'Tài' : 'Xỉu',
    pTai: probability,
    confidence: confidenceFromProbability(probability),
    baseWeight,
    details
  };
}

function methodRate(type, method, coldRatesOverride = null) {
  const stats = learningData[type].methodPerformance[method];
  const coldRates = coldRatesOverride || getColdMethodRates(type);
  const cold = coldRates[method];
  if (!stats && !cold) return { rate: 0.5, total: 0, recentRate: 0.5 };
  if (!stats && cold) {
    const coldRate = betaProbability(cold.correct, cold.total, CONFIG.METHOD_PRIOR);
    return { rate: coldRate, total: cold.total, recentRate: coldRate };
  }

  const longRate = betaProbability(stats.correct, stats.total, CONFIG.METHOD_PRIOR);
  const recentRate = stats.recent.length >= 12 ? mean(stats.recent, longRate) : longRate;
  const liveRate = longRate * 0.45 + recentRate * 0.55;
  const coldRate = cold ? betaProbability(cold.correct, cold.total, CONFIG.METHOD_PRIOR) : 0.5;
  const liveTrust = clamp(stats.total / 80, 0, 1);
  const rate = cold ? liveRate * liveTrust + coldRate * (1 - liveTrust) : liveRate;
  const total = stats.total + (cold ? Math.min(cold.total, 120) : 0);

  return { rate, total, recentRate };
}

function reliabilityWeight(type, signal, coldRatesOverride = null) {
  const { rate, total } = methodRate(type, signal.method, coldRatesOverride);
  const sampleTrust = clamp(Math.sqrt(total / 180), 0, 1);
  const learnedEdge = rate - 0.5;
  const signalEdge = Math.abs(signal.pTai - 0.5);

  let pTai = signal.pTai;
  let weight = signal.baseWeight * (0.25 + signalEdge * 8);

  if (total >= 30 && learnedEdge < -0.035) {
    pTai = 1 - pTai;
    weight *= 0.55 + sampleTrust * 0.25;
  } else if (total >= 30) {
    weight *= 0.65 + sampleTrust * clamp((learnedEdge + 0.04) * 8, 0, 1.35);
  }

  return {
    ...signal,
    pTai,
    prediction: pTai >= 0.5 ? 'Tài' : 'Xỉu',
    learnedRate: rate,
    effectiveWeight: clamp(weight, 0.01, 2.5)
  };
}

function predictSimple(results, type) {
  const streak = currentStreak(results);
  const alt = alternatingLength(results);
  const key = results.slice(0, 6).join('');
  const mistakes = learningData[type].mistakePatterns[key]?.count || 0;

  if (mistakes >= 5) {
    return makeSignal('simple', opposite(results[0]) === 'Tài' ? 0.57 : 0.43, 0.7, {
      reason: 'mistake_reversal',
      mistakes
    });
  }

  if (alt >= 6) {
    return makeSignal('simple', opposite(results[0]) === 'Tài' ? 0.55 : 0.45, 0.55, {
      reason: 'alternating',
      alt
    });
  }

  if (streak.length >= 5) {
    return makeSignal('simple', streak.value === 'Tài' ? 0.54 : 0.46, 0.5, {
      reason: 'long_streak',
      streak: streak.length
    });
  }

  const last8 = results.slice(0, 8);
  const tai = last8.filter(r => r === 'Tài').length;
  const pTai = betaProbability(tai, last8.length, 10);
  return makeSignal('simple', pTai, 0.35, {
    reason: 'recent_bias',
    tai,
    total: last8.length
  });
}

function predictMarkov(data) {
  const results = data.map(row => row.Ket_qua);
  const candidates = [];

  for (let size = 6; size >= 3; size--) {
    const current = results.slice(0, size).join('|');
    let tai = 0;
    let total = 0;

    for (let i = 1; i <= results.length - size; i++) {
      const pattern = results.slice(i, i + size).join('|');
      if (pattern !== current) continue;

      total++;
      if (results[i - 1] === 'Tài') tai++;
    }

    if (total >= 4) {
      candidates.push({ size, tai, total, pTai: betaProbability(tai, total, 6) });
    }
  }

  if (candidates.length === 0) return null;

  const weighted = candidates.reduce((acc, item) => {
    const weight = item.total * item.size;
    acc.weight += weight;
    acc.tai += item.pTai * weight;
    return acc;
  }, { tai: 0, weight: 0 });

  return makeSignal('markov', weighted.tai / weighted.weight, 0.85, {
    matches: candidates.map(c => ({ size: c.size, total: c.total, tai: c.tai }))
  });
}

function featureVector(window) {
  const results = window.map(row => row.Ket_qua);
  const sums = window.map(row => row.Tong);
  const last10 = results.slice(0, 10);
  const last20 = results.slice(0, 20);
  const streak = currentStreak(results);
  const avg5 = mean(sums.slice(0, 5), 10.5);
  const avg20 = mean(sums.slice(0, 20), 10.5);

  return {
    tai10: last10.filter(r => r === 'Tài').length / Math.max(last10.length, 1),
    tai20: last20.filter(r => r === 'Tài').length / Math.max(last20.length, 1),
    streakType: streak.value,
    streakLength: Math.min(streak.length, 8),
    altLength: Math.min(alternatingLength(results), 8),
    sumDrift: (avg5 - avg20) / 6,
    avg5
  };
}

function similarityScore(a, b) {
  let score = 0;
  score += Math.max(0, 1 - Math.abs(a.tai10 - b.tai10) * 3) * 30;
  score += Math.max(0, 1 - Math.abs(a.tai20 - b.tai20) * 2) * 20;
  score += a.streakType === b.streakType ? 18 : 0;
  score += Math.max(0, 1 - Math.abs(a.streakLength - b.streakLength) / 6) * 14;
  score += Math.max(0, 1 - Math.abs(a.altLength - b.altLength) / 6) * 10;
  score += Math.max(0, 1 - Math.abs(a.sumDrift - b.sumDrift) * 3) * 8;
  return score;
}

function predictSimilarity(data) {
  if (data.length < CONFIG.PATTERN_WINDOW + 8) return null;

  const current = featureVector(data.slice(0, CONFIG.PATTERN_WINDOW));
  const matches = [];

  for (let i = 1; i <= data.length - CONFIG.PATTERN_WINDOW; i++) {
    const candidate = data.slice(i, i + CONFIG.PATTERN_WINDOW);
    const score = similarityScore(current, featureVector(candidate));
    if (score < 42) continue;

    matches.push({
      score,
      nextResult: data[i - 1].Ket_qua,
      index: i
    });
  }

  if (matches.length < CONFIG.PATTERN_MIN_MATCHES) return null;

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, 80);
  let taiWeight = 0;
  let totalWeight = 0;

  for (const match of top) {
    const recencyBoost = Math.exp(-match.index / Math.max(data.length * 0.35, 1));
    const weight = Math.pow(match.score / 100, 1.6) * (1 + recencyBoost * 0.25);
    totalWeight += weight;
    if (match.nextResult === 'Tài') taiWeight += weight;
  }

  return makeSignal('similarity', betaProbability(taiWeight, totalWeight, 4), 1.0, {
    matches: top.length,
    bestScore: Number(top[0].score.toFixed(1))
  });
}

function predictModulo(data, nextPhien) {
  if (!Number.isFinite(nextPhien) || data.length < 90) return null;

  let best = null;
  for (let mod = 3; mod <= 96; mod++) {
    const bucket = nextPhien % mod;
    let tai = 0;
    let total = 0;

    for (const row of data) {
      if (row.Phien % mod !== bucket) continue;
      total++;
      if (row.Ket_qua === 'Tài') tai++;
    }

    if (total < Math.max(12, Math.ceil(data.length / mod * 0.55))) continue;

    const pTai = betaProbability(tai, total, 16);
    const edge = Math.abs(pTai - 0.5);
    const support = clamp(Math.log(total) / Math.log(90), 0, 1);
    const score = edge * support;

    if (!best || score > best.score) {
      best = { mod, bucket, tai, total, pTai, score };
    }
  }

  if (!best || best.score < 0.018) return null;

  return makeSignal('modulo', best.pTai, 0.75, {
    mod: best.mod,
    bucket: best.bucket,
    tai: best.tai,
    total: best.total,
    score: Number(best.score.toFixed(4))
  });
}

function predictShape(data) {
  if (data.length < 80) return null;

  const latest = data[0];
  const sums = data.map(row => row.Tong);
  const results = data.map(row => row.Ket_qua);
  const recentSumBand = latest.Tong <= 8 ? 'low' : (latest.Tong >= 13 ? 'high' : 'mid');
  const streak = currentStreak(results);
  const targetKey = `${latest.Ket_qua}|${recentSumBand}|${Math.min(streak.length, 5)}`;
  let tai = 0;
  let total = 0;

  for (let i = 1; i < data.length - 1; i++) {
    const row = data[i];
    const band = row.Tong <= 8 ? 'low' : (row.Tong >= 13 ? 'high' : 'mid');
    const slice = results.slice(i);
    const localStreak = currentStreak(slice);
    const key = `${row.Ket_qua}|${band}|${Math.min(localStreak.length, 5)}`;

    if (key !== targetKey) continue;
    total++;
    if (data[i - 1].Ket_qua === 'Tài') tai++;
  }

  if (total < 10) return null;

  const pTai = betaProbability(tai, total, 10);
  if (Math.abs(pTai - 0.5) < 0.035) return null;

  return makeSignal('shape', pTai, 0.55, {
    key: targetKey,
    tai,
    total,
    lastSum: latest.Tong,
    avg12: Number(mean(sums.slice(0, 12), 10.5).toFixed(2))
  });
}

function predictDice(sums) {
  if (sums.length < 18) return null;

  const recent = sums.slice(0, 12);
  const avg = mean(recent, 10.5);
  const drift = (avg - 10.5) / 3.2;
  if (Math.abs(drift) < 0.12) return null;

  const pTai = clamp(0.5 + drift * 0.06, 0.43, 0.57);
  return makeSignal('dice', pTai, 0.35, {
    avg: Number(avg.toFixed(2)),
    drift: Number(drift.toFixed(3))
  });
}

function updateTimeStats(type, actual, timestamp) {
  const date = new Date(timestamp);
  const slot = `${date.getHours()}:${String(Math.floor(date.getMinutes() / 15) * 15).padStart(2, '0')}`;
  const stats = learningData[type].timeWindowStats[slot] || { tai: 0, xiu: 0, total: 0 };

  if (actual === 'Tài') stats.tai++;
  else stats.xiu++;
  stats.total++;
  stats.lastUpdate = new Date().toISOString();
  learningData[type].timeWindowStats[slot] = stats;
}

function predictTimeWindow(type, now = new Date()) {
  const slot = `${now.getHours()}:${String(Math.floor(now.getMinutes() / 15) * 15).padStart(2, '0')}`;
  const stats = learningData[type].timeWindowStats[slot];
  if (!stats || stats.total < 30) return null;

  const pTai = betaProbability(stats.tai, stats.total, 20);
  if (Math.abs(pTai - 0.5) < 0.045) return null;

  return makeSignal('timeWindow', pTai, 0.3, {
    slot,
    total: stats.total
  });
}

function getRawSignals(data, type, nextPhien = null) {
  const results = data.slice(0, 60).map(row => row.Ket_qua);
  const sums = data.slice(0, 60).map(row => row.Tong);
  return [
    predictSimple(results, type),
    predictMarkov(data),
    predictSimilarity(data),
    predictModulo(data, nextPhien || (data[0]?.Phien + 1)),
    predictShape(data),
    predictDice(sums),
    predictTimeWindow(type)
  ].filter(Boolean);
}

function estimateColdMethodRatesFromData(type, data, maxRounds = 180) {
  const methodStats = {};
  if (!Array.isArray(data) || data.length < CONFIG.PATTERN_WINDOW + 30) return methodStats;

  let tested = 0;
  for (let i = data.length - CONFIG.PATTERN_WINDOW - 1; i >= 1; i--) {
    if (tested >= maxRounds) break;
    const train = data.slice(i);
    const actual = data[i - 1];
    if (!actual || actual.Phien !== data[i].Phien + 1) continue;

    const rawSignals = getRawSignals(train, type, actual.Phien);
    for (const signal of rawSignals) {
      methodStats[signal.method] = methodStats[signal.method] || { correct: 0, total: 0 };
      methodStats[signal.method].total++;
      if (signal.prediction === actual.Ket_qua) methodStats[signal.method].correct++;
    }
    tested++;
  }

  return Object.fromEntries(Object.entries(methodStats).filter(([, stats]) => stats.total >= 12));
}

function getColdMethodRates(type) {
  const data = outcomeHistory[type] || [];
  const key = `${data.length}:${data[0]?.Phien || 0}:${data[data.length - 1]?.Phien || 0}`;
  if (coldRateCache[type]?.key === key) return coldRateCache[type].rates;

  const rates = estimateColdMethodRatesFromData(type, data);
  coldRateCache[type] = { key, rates };
  return rates;
}

function calculatePrediction(data, type, nextPhien = null, options = {}) {
  const rawSignals = getRawSignals(data, type, nextPhien);

  const signals = rawSignals.map(signal => reliabilityWeight(type, signal, options.coldRates || null));
  const neutralWeight = 1.1;
  let weightedTai = neutralWeight * 0.5;
  let totalWeight = neutralWeight;

  for (const signal of signals) {
    weightedTai += signal.pTai * signal.effectiveWeight;
    totalWeight += signal.effectiveWeight;
  }

  const pTai = clamp(weightedTai / totalWeight, 0.35, 0.65);
  const prediction = pTai >= 0.5 ? 'Tài' : 'Xỉu';
  const reliability = methodRate(type, 'ensemble').rate;
  const confidence = confidenceFromProbability(pTai, reliability);
  const edge = Math.abs(pTai - 0.5);
  const action = confidence >= CONFIG.MIN_ACTION_CONFIDENCE && edge >= CONFIG.MIN_ACTION_EDGE
    ? 'predict'
    : 'observe';

  return {
    prediction,
    confidence,
    pTai: Number(pTai.toFixed(4)),
    pXiu: Number((1 - pTai).toFixed(4)),
    edge: Number(edge.toFixed(4)),
    action,
    signals
  };
}

function upsertHistory(type, phien, result) {
  const record = {
    phien_hien_tai: String(phien),
    du_doan: normalizeResult(result.prediction),
    ti_le: `${result.confidence}%`,
    id: 'kapub',
    action: result.action,
    edge: result.edge,
    timestamp: new Date().toISOString()
  };

  const existingIndex = predictionHistory[type].findIndex(item => item.phien_hien_tai === String(phien));
  if (existingIndex >= 0) {
    predictionHistory[type][existingIndex] = {
      ...predictionHistory[type][existingIndex],
      ...record
    };
  } else {
    predictionHistory[type].unshift(record);
  }

  predictionHistory[type] = predictionHistory[type].slice(0, CONFIG.MAX_HISTORY);
  return record;
}

function findPrediction(type, phien) {
  return learningData[type].predictions.find(pred => pred.phien === String(phien));
}

function recordPrediction(type, phien, result) {
  const existing = findPrediction(type, phien);
  if (existing) return existing;

  const record = {
    phien: String(phien),
    prediction: result.prediction,
    confidence: result.confidence,
    pTai: result.pTai,
    edge: result.edge,
    action: result.action,
    subModelOutputs: Object.fromEntries(result.signals.map(signal => [
      signal.method,
      {
        prediction: signal.prediction,
        pTai: Number(signal.pTai.toFixed(4)),
        confidence: signal.confidence,
        learnedRate: Number((signal.learnedRate || 0.5).toFixed(4)),
        weight: Number((signal.effectiveWeight || 0).toFixed(4)),
        details: signal.details || {}
      }
    ])),
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };

  learningData[type].predictions.unshift(record);
  learningData[type].predictions = learningData[type].predictions.slice(0, CONFIG.MAX_PREDICTIONS);
  return record;
}

function updateStreak(type, isCorrect) {
  const streak = learningData[type].streakAnalysis;
  if (isCorrect) {
    streak.wins++;
    streak.currentStreak = streak.currentStreak >= 0 ? streak.currentStreak + 1 : 1;
    streak.bestStreak = Math.max(streak.bestStreak, streak.currentStreak);
  } else {
    streak.losses++;
    streak.currentStreak = streak.currentStreak <= 0 ? streak.currentStreak - 1 : -1;
    streak.worstStreak = Math.min(streak.worstStreak, streak.currentStreak);
  }
}

function pushMethodResult(type, method, isCorrect) {
  ensureMethodStats(learningData[type]);
  const stats = learningData[type].methodPerformance[method];
  if (!stats) return;

  stats.total++;
  if (isCorrect) stats.correct++;
  stats.recent.push(isCorrect ? 1 : 0);
  stats.recent = stats.recent.slice(-CONFIG.RECENT_METHOD_WINDOW);
}

async function verifyPredictions(type, currentData) {
  let changed = false;
  const now = Date.now();

  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;

    const actual = currentData.find(row => String(row.Phien) === pred.phien);
    if (!actual) {
      const ageMs = now - new Date(pred.timestamp).getTime();
      if (Number.isFinite(ageMs) && ageMs > 45 * 60 * 1000) {
        pred.verified = true;
        pred.actual = 'TIMEOUT';
        pred.isCorrect = false;
        changed = true;
      }
      continue;
    }

    pred.verified = true;
    pred.actual = actual.Ket_qua;
    pred.isCorrect = pred.prediction === actual.Ket_qua;

    learningData[type].totalPredictions++;
    if (pred.isCorrect) learningData[type].correctPredictions++;
    updateStreak(type, pred.isCorrect);

    learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
    learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-300);

    pushMethodResult(type, 'ensemble', pred.isCorrect);

    for (const [method, output] of Object.entries(pred.subModelOutputs || {})) {
      pushMethodResult(type, method, output.prediction === actual.Ket_qua);
    }

    if (!pred.isCorrect) {
      const context = currentData.slice(0, 6).map(row => row.Ket_qua).join('');
      learningData[type].mistakePatterns[context] = learningData[type].mistakePatterns[context] || {
        count: 0,
        lastSeen: null
      };
      learningData[type].mistakePatterns[context].count++;
      learningData[type].mistakePatterns[context].lastSeen = new Date().toISOString();
    }

    updateTimeStats(type, actual.Ket_qua, pred.timestamp);
    changed = true;
  }

  if (changed) {
    learningData[type].lastUpdate = new Date().toISOString();
    recalculateTotals(type);
  }

  return changed;
}

async function getOrCreatePrediction(type, data) {
  const tape = getDataTape(type, data);
  await verifyPredictions(type, tape);

  const latestPhien = data[0].Phien;
  const nextPhien = latestPhien + 1;
  const existing = findPrediction(type, nextPhien);

  if (existing && !existing.verified) {
    upsertHistory(type, nextPhien, existing);
    return {
      phien: nextPhien,
      result: existing,
      created: false
    };
  }

  const result = calculatePrediction(tape, type, nextPhien);
  const record = recordPrediction(type, nextPhien, result);
  upsertHistory(type, nextPhien, record);
  lastProcessedPhien[type] = nextPhien;
  saveState();

  return {
    phien: nextPhien,
    result: record,
    created: true
  };
}

async function autoProcessType(type) {
  const data = await fetchApi(type, true);
  if (!data || data.length === 0) return;

  const tape = getDataTape(type, data);
  await verifyPredictions(type, tape);
  const latestPhien = data[0].Phien;
  const nextPhien = latestPhien + 1;

  if (lastProcessedPhien[type] === nextPhien && findPrediction(type, nextPhien)) {
    saveState();
    return;
  }

  const { result, created } = await getOrCreatePrediction(type, data);
  if (created) {
    console.log(`[${type.toUpperCase()} #${nextPhien}] ${result.prediction} (${result.confidence}%) edge=${result.edge} action=${result.action}`);
  }
}

async function autoProcessPredictions() {
  try {
    await Promise.all([autoProcessType('hu'), autoProcessType('md5')]);
    saveState();
  } catch (error) {
    console.error('[Auto]', error.message);
  }
}

function publicPrediction(record, phien) {
  return {
    phien_hien_tai: String(phien || record.phien),
    du_doan: normalizeResult(record.prediction),
    ti_le: `${record.confidence}%`,
    id: 'kapub'
  };
}

function methodPerformance(type) {
  ensureMethodStats(learningData[type]);
  const output = {};

  for (const [method, perf] of Object.entries(learningData[type].methodPerformance)) {
    if (perf.total > 0) {
      output[method] = {
        accuracy: `${(perf.correct / perf.total * 100).toFixed(2)}%`,
        recentAccuracy: `${(mean(perf.recent, 0) * 100).toFixed(2)}%`,
        total: perf.total,
        correct: perf.correct
      };
    }
  }

  return output;
}

function coldStartPerformance(type) {
  const rates = getColdMethodRates(type);
  return Object.fromEntries(Object.entries(rates).map(([method, stats]) => [
    method,
    {
      accuracy: `${(stats.correct / stats.total * 100).toFixed(2)}%`,
      total: stats.total,
      correct: stats.correct
    }
  ]));
}

function statsPayload(type) {
  recalculateTotals(type);
  const stats = learningData[type];
  const verified = stats.predictions.filter(pred => pred.verified && pred.actual !== 'TIMEOUT');
  const actionable = verified.filter(pred => pred.action === 'predict');
  const actionableCorrect = actionable.filter(pred => pred.isCorrect).length;
  const recent = stats.recentAccuracy.slice(-CONFIG.RECENT_ACCURACY_WINDOW);
  const overall = stats.totalPredictions > 0
    ? stats.correctPredictions / stats.totalPredictions * 100
    : 0;
  const recentAcc = recent.length > 0 ? mean(recent, 0) * 100 : 0;
  const actionableAcc = actionable.length > 0
    ? actionableCorrect / actionable.length * 100
    : 0;

  return {
    type: type === 'hu' ? 'Lẩu Cua 79 - Tài Xỉu Hũ' : 'Lẩu Cua 79 - Tài Xỉu MD5',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${overall.toFixed(2)}%`,
    actionablePredictions: actionable.length,
    actionableCorrect,
    actionableAccuracy: `${actionableAcc.toFixed(2)}%`,
    outcomeHistory: (outcomeHistory[type] || []).length,
    recentAccuracy: `${recentAcc.toFixed(2)}%`,
    streakAnalysis: stats.streakAnalysis,
    methodPerformance: methodPerformance(type),
    coldStartMethodPerformance: coldStartPerformance(type),
    mistakedPatterns: Object.keys(stats.mistakePatterns || {}).length,
    lastUpdate: stats.lastUpdate,
    note: 'Accuracy is calculated from verified unique rounds only; duplicate calls do not inflate totals.'
  };
}

function backtestPayload(type, maxRounds = 300) {
  const data = (outcomeHistory[type] || []).slice();
  if (data.length < CONFIG.PATTERN_WINDOW + 40) {
    return {
      type,
      error: 'Not enough stored outcome history yet',
      outcomeHistory: data.length,
      minimumRecommended: CONFIG.PATTERN_WINDOW + 40
    };
  }

  const methodStats = {};
  let total = 0;
  let correct = 0;
  let actionableTotal = 0;
  let actionableCorrect = 0;
  const rows = [];
  const newestBacktestIndex = 1;
  const oldestBacktestIndex = Math.max(
    newestBacktestIndex,
    data.length - CONFIG.PATTERN_WINDOW - Math.max(40, maxRounds)
  );

  for (let i = data.length - CONFIG.PATTERN_WINDOW - 1; i >= newestBacktestIndex; i--) {
    if (total >= maxRounds) break;
    if (i < oldestBacktestIndex) break;

    const train = data.slice(i);
    const actual = data[i - 1];
    if (!actual || actual.Phien !== data[i].Phien + 1) continue;

    const coldRates = estimateColdMethodRatesFromData(type, train);
    const result = calculatePrediction(train, type, actual.Phien, { coldRates });
    const isCorrect = result.prediction === actual.Ket_qua;
    total++;
    if (isCorrect) correct++;
    if (result.action === 'predict') {
      actionableTotal++;
      if (isCorrect) actionableCorrect++;
    }

    for (const signal of result.signals) {
      methodStats[signal.method] = methodStats[signal.method] || { correct: 0, total: 0 };
      methodStats[signal.method].total++;
      if (signal.prediction === actual.Ket_qua) methodStats[signal.method].correct++;
    }

    if (rows.length < 25) {
      rows.push({
        phien: actual.Phien,
        prediction: normalizeResult(result.prediction),
        actual: normalizeResult(actual.Ket_qua),
        confidence: result.confidence,
        edge: result.edge,
        action: result.action,
        correct: isCorrect
      });
    }
  }

  const methodPerformance = Object.fromEntries(Object.entries(methodStats).map(([method, stats]) => [
    method,
    {
      accuracy: `${(stats.correct / stats.total * 100).toFixed(2)}%`,
      total: stats.total,
      correct: stats.correct
    }
  ]));

  return {
    type: type === 'hu' ? 'Lẩu Cua 79 - Tài Xỉu Hũ' : 'Lẩu Cua 79 - Tài Xỉu MD5',
    outcomeHistory: data.length,
    tested: total,
    correct,
    accuracy: total > 0 ? `${(correct / total * 100).toFixed(2)}%` : '0.00%',
    actionableTested: actionableTotal,
    actionableCorrect,
    actionableAccuracy: actionableTotal > 0 ? `${(actionableCorrect / actionableTotal * 100).toFixed(2)}%` : '0.00%',
    methodPerformance,
    sample: rows
  };
}

async function predictionRoute(type, res) {
  const data = await fetchApi(type, true);
  if (!data || data.length === 0) {
    res.status(502).json({ error: 'Cannot fetch data' });
    return;
  }

  const { phien, result } = await getOrCreatePrediction(type, data);
  res.json(publicPrediction(result, phien));
}

async function historyRoute(type, res) {
  const data = await fetchApi(type, true);
  if (data && data.length > 0) {
    await verifyPredictions(type, getDataTape(type, data));
    saveState();
  }

  const historyWithStatus = predictionHistory[type].map(record => {
    const prediction = findPrediction(type, record.phien_hien_tai);
    return {
      ...record,
      ket_qua_thuc_te: prediction?.actual || null,
      status: prediction?.isCorrect === true ? 'correct' : (prediction?.isCorrect === false ? 'wrong' : 'pending')
    };
  });

  res.json({
    type: type === 'hu' ? 'Lẩu Cua 79 - Tài Xỉu Hũ' : 'Lẩu Cua 79 - Tài Xỉu MD5',
    history: historyWithStatus,
    total: historyWithStatus.length
  });
}

async function analysisRoute(type, res) {
  const data = await fetchApi(type, true);
  if (!data || data.length === 0) {
    res.status(502).json({ error: 'Cannot fetch data' });
    return;
  }

  const tape = getDataTape(type, data);
  await verifyPredictions(type, tape);
  const result = calculatePrediction(tape, type, data[0].Phien + 1);

  res.json({
    prediction: normalizeResult(result.prediction),
    confidence: result.confidence,
    pTai: result.pTai,
    pXiu: result.pXiu,
    edge: result.edge,
    action: result.action,
    details: result.signals.map(signal => ({
      method: signal.method,
      prediction: signal.prediction,
      pTai: Number(signal.pTai.toFixed(4)),
      confidence: signal.confidence,
      learnedRate: Number((signal.learnedRate || 0.5).toFixed(4)),
      weight: Number((signal.effectiveWeight || 0).toFixed(4)),
      details: signal.details
    }))
  });
}

async function collectRoute(type, res) {
  const data = await fetchApi(type, true);
  if (!data || data.length === 0) {
    res.status(502).json({ error: 'Cannot fetch data' });
    return;
  }

  const tape = getDataTape(type, data);
  saveState();
  res.json({
    type,
    fetched: data.length,
    outcomeHistory: tape.length,
    newestPhien: tape[0]?.Phien || null,
    oldestPhien: tape[tape.length - 1]?.Phien || null
  });
}

function resetState() {
  learningData = {
    hu: emptyLearningBucket(),
    md5: emptyLearningBucket()
  };
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  outcomeHistory = { hu: [], md5: [] };
  apiCache = { hu: { at: 0, data: null }, md5: { at: 0, data: null } };
  coldRateCache = { hu: null, md5: null };
  saveState();
}

function cleanupOldData() {
  const oneDayAgo = Date.now() - 86400000;

  for (const type of ['hu', 'md5']) {
    learningData[type].predictions = learningData[type].predictions.slice(0, CONFIG.MAX_PREDICTIONS);
    learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-300);
    outcomeHistory[type] = (outcomeHistory[type] || []).slice(0, CONFIG.MAX_OUTCOME_HISTORY);
    predictionHistory[type] = predictionHistory[type].slice(0, CONFIG.MAX_HISTORY);

    for (const [pattern, info] of Object.entries(learningData[type].mistakePatterns || {})) {
      if (info.lastSeen && new Date(info.lastSeen).getTime() < oneDayAgo) {
        delete learningData[type].mistakePatterns[pattern];
      }
    }

    recalculateTotals(type);
  }

  saveState();
}

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('kapub');
});

app.get('/lc79-hu', (req, res) => predictionRoute('hu', res));
app.get('/lc79-md5', (req, res) => predictionRoute('md5', res));
app.get('/lc79-hu/lichsu', (req, res) => historyRoute('hu', res));
app.get('/lc79-md5/lichsu', (req, res) => historyRoute('md5', res));
app.get('/lc79-hu/analysis', (req, res) => analysisRoute('hu', res));
app.get('/lc79-md5/analysis', (req, res) => analysisRoute('md5', res));
app.get('/lc79-hu/stats', (req, res) => res.json(statsPayload('hu')));
app.get('/lc79-md5/stats', (req, res) => res.json(statsPayload('md5')));
app.get('/lc79-hu/backtest', (req, res) => res.json(backtestPayload('hu', Number(req.query.limit || 300))));
app.get('/lc79-md5/backtest', (req, res) => res.json(backtestPayload('md5', Number(req.query.limit || 300))));
app.get('/lc79-hu/collect', (req, res) => collectRoute('hu', res));
app.get('/lc79-md5/collect', (req, res) => collectRoute('md5', res));

app.get('/reset', (req, res) => {
  resetState();
  res.json({ message: 'All data reset successfully' });
});

loadState();
setTimeout(() => autoProcessPredictions(), 3000);
setInterval(() => autoProcessPredictions(), CONFIG.AUTO_PROCESS_INTERVAL);
setInterval(() => cleanupOldData(), CONFIG.CLEANUP_INTERVAL);

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('LC79 prediction server v10');
  console.log(`Server running: http://0.0.0.0:${PORT}`);
  console.log('Accuracy fixes: unique rounds, corrected pattern labels, per-method scoring, conservative edge gating.');
  console.log('');
});
