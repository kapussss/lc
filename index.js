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
    ngram: { correct: 0, total: 0, recent: [] },
    similarity: { correct: 0, total: 0, recent: [] },
    modulo: { correct: 0, total: 0, recent: [] },
    phaseMarkov: { correct: 0, total: 0, recent: [] },
    bayes: { correct: 0, total: 0, recent: [] },
    streakTable: { correct: 0, total: 0, recent: [] },
    shape: { correct: 0, total: 0, recent: [] },
    dice: { correct: 0, total: 0, recent: [] },
    timeWindow: { correct: 0, total: 0, recent: [] },
    metaFlip: { correct: 0, total: 0, recent: [] },
    leader: { correct: 0, total: 0, recent: [] },
    strategy: { correct: 0, total: 0, recent: [] },
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

function isTai(result) {
  return normalizeResult(result) === 'tai';
}

function sumBand(sum) {
  if (sum <= 7) return 'very_low';
  if (sum <= 9) return 'low';
  if (sum <= 12) return 'mid';
  if (sum <= 14) return 'high';
  return 'very_high';
}

function rowSymbol(row) {
  return `${normalizeResult(row.Ket_qua)}:${sumBand(row.Tong)}:${Number(row.Tong) % 2}`;
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
    learnedTotal: total,
    effectiveRate: rate < 0.5 ? 1 - rate : rate,
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

function predictNgram(data) {
  if (data.length < 70) return null;

  const candidates = [];
  const specs = [];
  for (let size = 2; size <= 10; size++) specs.push({ size, kind: 'result' });
  for (let size = 2; size <= 6; size++) specs.push({ size, kind: 'symbol' });

  for (const spec of specs) {
    const mapper = spec.kind === 'result'
      ? row => normalizeResult(row.Ket_qua)
      : row => rowSymbol(row);
    const current = data.slice(0, spec.size).map(mapper).join('|');
    let taiWeight = 0;
    let totalWeight = 0;
    let total = 0;

    for (let i = 1; i <= data.length - spec.size; i++) {
      const pattern = data.slice(i, i + spec.size).map(mapper).join('|');
      if (pattern !== current) continue;

      const recencyWeight = 1 + Math.exp(-i / Math.max(data.length * 0.25, 1));
      total++;
      totalWeight += recencyWeight;
      if (isTai(data[i - 1].Ket_qua)) taiWeight += recencyWeight;
    }

    if (total < (spec.kind === 'result' ? 4 : 3)) continue;

    const pTai = betaProbability(taiWeight, totalWeight, spec.kind === 'result' ? 8 : 10);
    const edge = Math.abs(pTai - 0.5);
    const score = edge * Math.log2(total + 1) * (1 + spec.size / 10);
    candidates.push({ ...spec, total, pTai, score });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 5);
  let weightedTai = 0;
  let totalWeight = 0;

  for (const item of top) {
    const weight = Math.max(0.05, item.score);
    weightedTai += item.pTai * weight;
    totalWeight += weight;
  }

  const pTai = weightedTai / totalWeight;
  if (Math.abs(pTai - 0.5) < 0.025) return null;

  return makeSignal('ngram', pTai, 1.05, {
    top: top.map(item => ({
      kind: item.kind,
      size: item.size,
      total: item.total,
      pTai: Number(item.pTai.toFixed(4)),
      score: Number(item.score.toFixed(4))
    }))
  });
}

function predictStreakTable(data) {
  if (data.length < 60) return null;

  const results = data.map(row => row.Ket_qua);
  const current = currentStreak(results);
  const currentKey = `${normalizeResult(current.value)}:${Math.min(current.length, 8)}`;
  let tai = 0;
  let total = 0;

  for (let i = 1; i < data.length - 1; i++) {
    const local = currentStreak(results.slice(i));
    const key = `${normalizeResult(local.value)}:${Math.min(local.length, 8)}`;
    if (key !== currentKey) continue;

    total++;
    if (isTai(data[i - 1].Ket_qua)) tai++;
  }

  if (total < 8) return null;

  const pTai = betaProbability(tai, total, 12);
  if (Math.abs(pTai - 0.5) < 0.03) return null;

  return makeSignal('streakTable', pTai, 0.55, {
    key: currentKey,
    tai,
    total
  });
}

function stateFeatures(data, start, nextPhien) {
  const window = data.slice(start, start + 20);
  if (window.length < 6) return [];

  const results = window.map(row => normalizeResult(row.Ket_qua));
  const sums = window.map(row => row.Tong);
  const streak = currentStreak(window.map(row => row.Ket_qua));
  const avg5 = mean(sums.slice(0, 5), 10.5);
  const avg12 = mean(sums.slice(0, 12), 10.5);
  const last3 = results.slice(0, 3).join('');
  const last5Tai = results.slice(0, 5).filter(result => result === 'tai').length;
  const phien = Number(nextPhien);

  return [
    `r1:${results[0]}`,
    `r2:${results.slice(0, 2).join('')}`,
    `r3:${last3}`,
    `streak:${normalizeResult(streak.value)}:${Math.min(streak.length, 6)}`,
    `sum:${sumBand(sums[0])}`,
    `sum2:${sumBand(sums[0])}:${sumBand(sums[1])}`,
    `drift:${avg5 > avg12 + 0.6 ? 'up' : (avg5 < avg12 - 0.6 ? 'down' : 'flat')}`,
    `bias5:${last5Tai}`,
    Number.isFinite(phien) ? `m7:${phien % 7}` : null,
    Number.isFinite(phien) ? `m13:${phien % 13}` : null,
    Number.isFinite(phien) ? `m17:${phien % 17}` : null
  ].filter(Boolean);
}

function predictBayes(data, nextPhien) {
  if (data.length < 80) return null;

  const targetFeatures = stateFeatures(data, 0, nextPhien || (data[0]?.Phien + 1));
  const featureSet = new Set(targetFeatures);
  const stats = {};

  for (let i = 1; i < data.length - 10; i++) {
    const actual = data[i - 1];
    const features = stateFeatures(data, i, actual.Phien);
    for (const feature of features) {
      if (!featureSet.has(feature)) continue;
      stats[feature] = stats[feature] || { tai: 0, total: 0 };
      stats[feature].total++;
      if (isTai(actual.Ket_qua)) stats[feature].tai++;
    }
  }

  let weightedTai = 0;
  let totalWeight = 0;
  const used = [];

  for (const [feature, item] of Object.entries(stats)) {
    if (item.total < 8) continue;
    const pTai = betaProbability(item.tai, item.total, 14);
    const edge = Math.abs(pTai - 0.5);
    if (edge < 0.025) continue;

    const weight = edge * Math.min(2.5, Math.log2(item.total + 1));
    weightedTai += pTai * weight;
    totalWeight += weight;
    used.push({ feature, total: item.total, pTai, weight });
  }

  if (totalWeight === 0) return null;

  used.sort((a, b) => b.weight - a.weight);
  const pTai = weightedTai / totalWeight;
  if (Math.abs(pTai - 0.5) < 0.025) return null;

  return makeSignal('bayes', pTai, 0.9, {
    features: used.slice(0, 6).map(item => ({
      feature: item.feature,
      total: item.total,
      pTai: Number(item.pTai.toFixed(4))
    }))
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

function predictPhaseMarkov(data, nextPhien) {
  if (!Number.isFinite(nextPhien) || data.length < 90) return null;

  const latest = data[0];
  const latestResult = normalizeResult(latest.Ket_qua);
  const latestBand = sumBand(latest.Tong);
  let best = null;

  for (let mod = 4; mod <= 144; mod++) {
    const targetKey = `${nextPhien % mod}|${latestResult}|${latestBand}`;
    let tai = 0;
    let total = 0;

    for (let i = 1; i < data.length; i++) {
      const prev = data[i];
      const actual = data[i - 1];
      const key = `${actual.Phien % mod}|${normalizeResult(prev.Ket_qua)}|${sumBand(prev.Tong)}`;
      if (key !== targetKey) continue;

      total++;
      if (isTai(actual.Ket_qua)) tai++;
    }

    if (total < 5) continue;

    const pTai = betaProbability(tai, total, 12);
    const edge = Math.abs(pTai - 0.5);
    const support = clamp(Math.log(total + 1) / Math.log(40), 0, 1);
    const score = edge * support;

    if (!best || score > best.score) {
      best = { mod, tai, total, pTai, score };
    }
  }

  if (!best || best.score < 0.02) return null;

  return makeSignal('phaseMarkov', best.pTai, 0.8, {
    mod: best.mod,
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
    predictNgram(data),
    predictSimilarity(data),
    predictModulo(data, nextPhien || (data[0]?.Phien + 1)),
    predictPhaseMarkov(data, nextPhien || (data[0]?.Phien + 1)),
    predictBayes(data, nextPhien || (data[0]?.Phien + 1)),
    predictStreakTable(data),
    predictShape(data),
    predictDice(sums),
    predictTimeWindow(type)
  ].filter(Boolean);
}

function estimateColdMethodRatesFromData(type, data, maxRounds = 60) {
  const methodStats = {};
  if (!Array.isArray(data) || data.length < CONFIG.PATTERN_WINDOW + 30) return methodStats;

  let tested = 0;
  const maxIndex = data.length - CONFIG.PATTERN_WINDOW - 1;
  for (let i = 1; i <= maxIndex; i++) {
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

function combineSignals(type, rawSignals, options = {}) {
  const signals = rawSignals.map(signal => reliabilityWeight(type, signal, options.coldRates || null));
  const neutralWeight = 1.1;
  let weightedTai = neutralWeight * 0.5;
  let totalWeight = neutralWeight;

  for (const signal of signals) {
    weightedTai += signal.pTai * signal.effectiveWeight;
    totalWeight += signal.effectiveWeight;
  }

  const elite = signals.filter(signal =>
    signal.learnedTotal >= 24 &&
    signal.effectiveRate >= 0.54 &&
    Math.abs(signal.pTai - 0.5) >= 0.015
  ).sort((a, b) => {
    const aScore = (a.effectiveRate - 0.5) * Math.sqrt(a.learnedTotal) * (Math.abs(a.pTai - 0.5) + 0.02);
    const bScore = (b.effectiveRate - 0.5) * Math.sqrt(b.learnedTotal) * (Math.abs(b.pTai - 0.5) + 0.02);
    return bScore - aScore;
  }).slice(0, 3);

  if (elite.length > 0) {
    let eliteTai = 0;
    let eliteWeight = 0;
    for (const signal of elite) {
      const edge = Math.abs(signal.pTai - 0.5);
      const weight = signal.effectiveWeight * (1 + edge * 6) * (1 + (signal.effectiveRate - 0.54) * 10);
      eliteTai += signal.pTai * weight;
      eliteWeight += weight;
    }

    const allProb = weightedTai / totalWeight;
    const eliteProb = eliteTai / eliteWeight;
    const eliteTrust = clamp(eliteWeight / (eliteWeight + 2.2), 0.42, 0.78);
    return {
      pTai: clamp(eliteProb * eliteTrust + allProb * (1 - eliteTrust), 0.32, 0.68),
      signals
    };
  }

  return {
    pTai: clamp(weightedTai / totalWeight, 0.35, 0.65),
    signals
  };
}

function calculateBasePrediction(data, type, nextPhien = null, options = {}) {
  const rawSignals = getRawSignals(data, type, nextPhien);
  const combined = combineSignals(type, rawSignals, options);
  const pTai = combined.pTai;
  const prediction = pTai >= 0.5 ? 'Tài' : 'Xỉu';
  const reliability = methodRate(type, 'ensemble', options.coldRates || null).rate;
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
    signals: combined.signals,
    rawSignals
  };
}

function selectRecentStrategy(type, data, maxRounds = 70) {
  if (!Array.isArray(data) || data.length < CONFIG.PATTERN_WINDOW + 35) return null;

  const stats = {};
  const maxIndex = data.length - CONFIG.PATTERN_WINDOW - 1;
  let tested = 0;

  for (let i = 1; i <= maxIndex; i++) {
    if (tested >= maxRounds) break;
    const train = data.slice(i);
    const actual = data[i - 1];
    if (!actual || actual.Phien !== data[i].Phien + 1) continue;

    const rawSignals = getRawSignals(train, type, actual.Phien);
    for (const signal of rawSignals) {
      stats[signal.method] = stats[signal.method] || { correct: 0, total: 0 };
      stats[signal.method].total++;
      if (signal.prediction === actual.Ket_qua) stats[signal.method].correct++;
    }
    tested++;
  }

  const priority = ['simple', 'dice', 'ngram', 'streakTable', 'shape'];
  let best = null;
  for (const method of priority) {
    const item = stats[method];
    if (!item) continue;
    if (item.total < 18) continue;
    const rawRate = item.correct / item.total;
    const rate = betaProbability(item.correct, item.total, 8);
    const score = (rate - 0.5) * Math.sqrt(item.total);

    if (rate < (method === 'simple' ? 0.545 : 0.565)) continue;
    if (!best || score > best.score) {
      best = {
        method,
        mode: 'normal',
        rate,
        rawRate,
        total: item.total,
        score
      };
    }
  }

  return best;
}

function estimateMetaCalibration(type, data, coldRates = null, maxRounds = 70) {
  if (!Array.isArray(data) || data.length < CONFIG.PATTERN_WINDOW + 35) {
    return { mode: 'normal', total: 0, normalRate: 0.5, flipRate: 0.5 };
  }

  let total = 0;
  let normalCorrect = 0;
  let actionable = 0;
  let actionableCorrect = 0;
  const maxIndex = data.length - CONFIG.PATTERN_WINDOW - 1;

  for (let i = 1; i <= maxIndex; i++) {
    if (total >= maxRounds) break;
    const train = data.slice(i);
    const actual = data[i - 1];
    if (!actual || actual.Phien !== data[i].Phien + 1) continue;

    const base = calculateBasePrediction(train, type, actual.Phien, { coldRates });
    if (base.signals.length < 2 || base.edge < 0.012) continue;

    total++;
    const isCorrect = base.prediction === actual.Ket_qua;
    if (isCorrect) normalCorrect++;
    if (base.action === 'predict') {
      actionable++;
      if (isCorrect) actionableCorrect++;
    }
  }

  if (total < 18) {
    return { mode: 'normal', total, normalRate: 0.5, flipRate: 0.5 };
  }

  const normalRate = normalCorrect / total;
  const flipRate = 1 - normalRate;
  const actionableRate = actionable > 0 ? actionableCorrect / actionable : normalRate;
  let mode = 'normal';

  if (flipRate >= 0.57 && flipRate - normalRate >= 0.08) {
    mode = 'flip';
  } else if (normalRate < 0.47 && actionableRate < 0.47) {
    mode = 'observe';
  }

  return {
    mode,
    total,
    normalRate,
    flipRate,
    actionable,
    actionableRate
  };
}

function calculatePrediction(data, type, nextPhien = null, options = {}) {
  const coldRates = options.coldRates || null;
  const base = calculateBasePrediction(data, type, nextPhien, { coldRates });
  const meta = options.disableMeta
    ? { mode: 'normal', total: 0, normalRate: 0.5, flipRate: 0.5 }
    : estimateMetaCalibration(type, data, coldRates);

  let pTai = base.pTai;
  let prediction = base.prediction;
  const signals = base.signals.slice();
  const strategy = options.enableStrategy ? selectRecentStrategy(type, data) : null;

  if (meta.mode === 'flip' && base.edge >= 0.015) {
    pTai = clamp(1 - pTai, 0.35, 0.65);
    prediction = pTai >= 0.5 ? 'Tài' : 'Xỉu';
    signals.push({
      method: 'metaFlip',
      prediction,
      pTai,
      confidence: confidenceFromProbability(pTai, meta.flipRate),
      baseWeight: 0.5,
      effectiveWeight: 0.5,
      learnedRate: meta.flipRate,
      details: {
        mode: meta.mode,
        total: meta.total,
        normalRate: Number(meta.normalRate.toFixed(4)),
        flipRate: Number(meta.flipRate.toFixed(4))
      }
    });
  }

  const simpleBackbone = base.rawSignals.find(signal => signal.method === 'simple');
  if (simpleBackbone) {
    const simpleRateInfo = methodRate(type, 'simple', coldRates);
    pTai = clamp(simpleBackbone.pTai, 0.34, 0.66);
    prediction = pTai >= 0.5 ? 'Tài' : 'Xỉu';
    signals.push({
      method: 'leader',
      prediction,
      pTai,
      confidence: confidenceFromProbability(pTai, Math.max(simpleRateInfo.rate, 0.54)),
      baseWeight: 0.85,
      effectiveWeight: 0.85,
      learnedRate: simpleRateInfo.rate,
      learnedTotal: simpleRateInfo.total,
      effectiveRate: Math.max(simpleRateInfo.rate, 1 - simpleRateInfo.rate),
      details: {
        selectedMethod: 'simple_backbone',
        total: simpleRateInfo.total,
        rate: Number(simpleRateInfo.rate.toFixed(4)),
        rawPrediction: simpleBackbone.prediction,
        rawPTai: Number(simpleBackbone.pTai.toFixed(4))
      }
    });
  }

  const leaders = base.rawSignals
    .map(signal => {
      const rateInfo = methodRate(type, signal.method, coldRates);
      return {
        signal,
        rate: rateInfo.rate,
        total: rateInfo.total,
        score: (rateInfo.rate - 0.5) * Math.sqrt(Math.max(rateInfo.total, 1)) * (Math.abs(signal.pTai - 0.5) + 0.02)
      };
    })
    .filter(item =>
      item.total >= 24 &&
      item.rate >= 0.56 &&
      Math.abs(item.signal.pTai - 0.5) >= 0.012
    )
    .sort((a, b) => b.score - a.score);

  if (leaders.length > 0 && !simpleBackbone) {
    const leader = leaders[0];
    const leaderTrust = clamp((leader.rate - 0.535) * 7, 0.45, 0.88);
    pTai = clamp(leader.signal.pTai * leaderTrust + pTai * (1 - leaderTrust), 0.32, 0.68);
    prediction = pTai >= 0.5 ? 'Tài' : 'Xỉu';
    signals.push({
      method: 'leader',
      prediction,
      pTai,
      confidence: confidenceFromProbability(pTai, leader.rate),
      baseWeight: 0.9,
      effectiveWeight: 0.9,
      learnedRate: leader.rate,
      learnedTotal: leader.total,
      effectiveRate: leader.rate,
      details: {
        selectedMethod: leader.signal.method,
        total: leader.total,
        rate: Number(leader.rate.toFixed(4)),
        rawPrediction: leader.signal.prediction,
        rawPTai: Number(leader.signal.pTai.toFixed(4))
      }
    });
  }

  if (strategy) {
    const rawSignal = base.rawSignals.find(signal => signal.method === strategy.method);
    if (rawSignal) {
      const strategyProb = strategy.mode === 'flip' ? 1 - rawSignal.pTai : rawSignal.pTai;
      const strategyEdge = Math.abs(strategyProb - 0.5);
      const strategyTrust = clamp((strategy.rate - 0.535) * 8, 0.35, 0.88);

      if (strategyEdge >= 0.012) {
        pTai = clamp(strategyProb * strategyTrust + pTai * (1 - strategyTrust), 0.32, 0.68);
        prediction = pTai >= 0.5 ? 'Tài' : 'Xỉu';
        signals.push({
          method: 'strategy',
          prediction,
          pTai,
          confidence: confidenceFromProbability(pTai, strategy.rate),
          baseWeight: 0.75,
          effectiveWeight: 0.75,
          learnedRate: strategy.rate,
          learnedTotal: strategy.total,
          effectiveRate: strategy.rate,
          details: {
            selectedMethod: strategy.method,
            mode: strategy.mode,
            total: strategy.total,
            rawRate: Number(strategy.rawRate.toFixed(4)),
            rate: Number(strategy.rate.toFixed(4))
          }
        });
      }
    }
  }

  const leaderRate = leaders[0]?.rate || 0.5;
  const metaRate = meta.mode === 'flip' ? meta.flipRate : meta.normalRate;
  const reliability = strategy ? Math.max(strategy.rate, leaderRate, metaRate) : Math.max(leaderRate, metaRate);
  const confidence = confidenceFromProbability(pTai, reliability);
  const edge = Math.abs(pTai - 0.5);
  const simpleLeader = signals.find(signal =>
    signal.method === 'leader' &&
    signal.details?.selectedMethod === 'simple_backbone'
  );
  const leaderAllowsAction = !simpleLeader || simpleLeader.learnedRate >= 0.545;
  const action = leaderAllowsAction && meta.mode !== 'observe' && confidence >= CONFIG.MIN_ACTION_CONFIDENCE && edge >= CONFIG.MIN_ACTION_EDGE
    ? 'predict'
    : 'observe';

  return {
    prediction,
    confidence,
    pTai: Number(pTai.toFixed(4)),
    pXiu: Number((1 - pTai).toFixed(4)),
    edge: Number(edge.toFixed(4)),
    action,
    meta,
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
  const maxIndex = data.length - CONFIG.PATTERN_WINDOW - 1;

  for (let i = 1; i <= maxIndex; i++) {
    if (total >= maxRounds) break;

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
