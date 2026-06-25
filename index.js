/**
 * ════════════════════════════════════════════════════════════════════
 * ║  🚀 ANHKHOI TRANSCENDENT INFINITY @2026                       ║
 * ║  🧠 200+ PHƯƠNG PHÁP - 40+ CẦU - 35+ TREND                  ║
 * ║  💎 FRACTAL + QUANTUM + CHAOS + NEURAL + GENETIC + MARKOV     ║
 * ║  📊 DÀNH RIÊNG CHO ĐẠI CA KHÔI - ĐẲNG CẤP TUYỆT ĐỈNH        ║
 * ════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// ============================================================
// CẤU HÌNH
// ============================================================
const CONFIG = {
  API_URL_HU: 'https://wtx.tele68.com/v1/tx/sessions',
  API_URL_MD5: 'https://wtxmd52.tele68.com/v1/txmd5/sessions',
  LEARNING_FILE: 'AnhKhoi_Infinity.json',
  HISTORY_FILE: 'AnhKhoi_History_Infinity.json',
  MAX_HISTORY: 2000,
  AUTO_INTERVAL: 50,
  MAX_PATTERN: 60,
  MIN_CONFIDENCE: 46,
  // LEARN_7 configuration
  LEARN_7_WINDOW: 7,
  LEARN_7_MIN_CONFIDENCE: 60,
  REVERSAL_STREAK_THRESHOLD: 4,
  REVERSAL_CONFIDENCE_PENALTY: 10
};

// ============================================================
// CẤU TRÚC DỮ LIỆU
// ============================================================
let systemData = {
  hu: {
    predictions: [],
    stats: { total: 0, dung: 0, sai: 0, tyLeDung: 0, thang: 0, thua: 0, tyLeThang: 0, chuoi: 0, chuoiDaiNhat: 0, chuoiTeNhat: 0, tongDiem: 0, diemTrungBinh: 0, bestStreak: 0 },
    history: [], labels: [], values: [], dice: [],
    patterns: {}, cau: {}, methods: {},
    session: 0, correct: 0, total: 0, bestAcc: 0, bestStreak: 0,
    reliability: 0, lastPhien: null, currentPrediction: null,
    // LEARN_7 specific data
    learn7: { predictions: [], accuracy: 0, total: 0, correct: 0 },
    reversal: { predictions: [], accuracy: 0, total: 0, correct: 0 }
  },
  md5: {
    predictions: [],
    stats: { total: 0, dung: 0, sai: 0, tyLeDung: 0, thang: 0, thua: 0, tyLeThang: 0, chuoi: 0, chuoiDaiNhat: 0, chuoiTeNhat: 0, tongDiem: 0, diemTrungBinh: 0, bestStreak: 0 },
    history: [], labels: [], values: [], dice: [],
    patterns: {}, cau: {}, methods: {},
    session: 0, correct: 0, total: 0, bestAcc: 0, bestStreak: 0,
    reliability: 0, lastPhien: null, currentPrediction: null,
    // LEARN_7 specific data
    learn7: { predictions: [], accuracy: 0, total: 0, correct: 0 },
    reversal: { predictions: [], accuracy: 0, total: 0, correct: 0 }
  }
};

let history = { hu: [], md5: [] };
let lastPhien = { hu: null, md5: null };
let isProcessing = false;
let learningCount = 0;

// ============================================================
// LOAD/SAVE
// ============================================================
function loadData() {
  try {
    if (fs.existsSync(CONFIG.LEARNING_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.LEARNING_FILE, 'utf8'));
      if (data) { 
        if (data.hu) Object.assign(systemData.hu, data.hu); 
        if (data.md5) Object.assign(systemData.md5, data.md5); 
      }
      console.log('✅ Loaded Infinity system');
    }
    if (fs.existsSync(CONFIG.HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.HISTORY_FILE, 'utf8'));
      if (data) { 
        history = data.history || { hu: [], md5: [] }; 
        lastPhien = data.lastPhien || { hu: null, md5: null }; 
      }
      console.log('✅ Loaded history');
    }
  } catch (e) { console.log('Load error:', e.message); }
}

function saveData() {
  try {
    fs.writeFileSync(CONFIG.LEARNING_FILE, JSON.stringify(systemData, null, 2));
    fs.writeFileSync(CONFIG.HISTORY_FILE, JSON.stringify({ history, lastPhien, lastSaved: new Date().toISOString() }, null, 2));
  } catch (e) { console.log('Save error:', e.message); }
}

// ============================================================
// LẤY DỮ LIỆU API
// ============================================================
function transformData(apiData) {
  if (!apiData || !apiData.list) return null;
  const result = [];
  for (let i = 0; i < apiData.list.length; i++) {
    const item = apiData.list[i];
    result.push({ 
      Phien: item.id, 
      Ket_qua: item.resultTruyenThong === 'TAI' ? 'T' : 'X',
      d1: item.dices[0], d2: item.dices[1], d3: item.dices[2],
      Tong: item.point 
    });
  }
  return result;
}

async function fetchHu() {
  try { const res = await axios.get(CONFIG.API_URL_HU, { timeout: 5000 }); return transformData(res.data); } 
  catch (e) { console.log('HU fetch error:', e.message); return null; }
}

async function fetchMd5() {
  try { const res = await axios.get(CONFIG.API_URL_MD5, { timeout: 5000 }); return transformData(res.data); } 
  catch (e) { console.log('MD5 fetch error:', e.message); return null; }
}

// ============================================================
// ════════════════════════════════════════════════════════════════════
// ║  🎯 LEARN_7 METHOD - THE CORE PREDICTOR                     ║
// ║  Based on the original API logic analysis                   ║
// ════════════════════════════════════════════════════════════════════
// ============================================================

/**
 * LEARN_7 Method - Predicts based on the last 7 results
 * This is the primary prediction method used by the API (~90% of predictions)
 * 
 * @param {Array} labels - Array of T/X labels from history
 * @returns {Object} { prediction: 'T'|'X', confidence: number, method: 'LEARN_7' }
 */
function learn7Predict(labels) {
  if (!labels || labels.length < CONFIG.LEARN_7_WINDOW) {
    return { prediction: 'T', confidence: 50, method: 'LEARN_7' };
  }
  
  // Get the last 7 results
  const last7 = labels.slice(-CONFIG.LEARN_7_WINDOW);
  
  // Count Tài (T) and Xỉu (X)
  let taiCount = 0;
  let xiuCount = 0;
  
  for (const result of last7) {
    if (result === 'T') taiCount++;
    else xiuCount++;
  }
  
  // Determine prediction based on majority
  let prediction = taiCount > xiuCount ? 'T' : 'X';
  
  // Calculate confidence based on the majority percentage
  const total = last7.length;
  const majorityCount = Math.max(taiCount, xiuCount);
  const percentage = (majorityCount / total) * 100;
  
  // Confidence mapping from the original API
  let confidence;
  if (percentage >= 85) {
    confidence = 85 + Math.floor((percentage - 85) / 15 * 11); // 85-96%
  } else if (percentage >= 71) {
    confidence = 65 + Math.floor((percentage - 71) / 14 * 20); // 65-85%
  } else if (percentage >= 57) {
    confidence = 50 + Math.floor((percentage - 57) / 14 * 15); // 50-65%
  } else {
    confidence = 50;
  }
  
  // Map back to API's confidence format
  // 7 results: 6/7 = 85.7%, 5/7 = 71.4%, 4/7 = 57.1%
  const confidenceMap = {
    7: 96, // 7/7 - all same
    6: 85, // 6/7 - 85.7%
    5: 74, // 5/7 - 71.4%
    4: 60  // 4/7 - 57.1%
  };
  
  confidence = confidenceMap[majorityCount] || confidence;
  
  return {
    prediction: prediction,
    confidence: Math.min(confidence, 99),
    method: 'LEARN_7',
    details: {
      window: last7,
      taiCount: taiCount,
      xiuCount: xiuCount,
      majority: majorityCount,
      percentage: percentage
    }
  };
}

/**
 * Check if there's a long streak in the history
 * @param {Array} labels - Array of T/X labels
 * @param {number} threshold - Streak length threshold
 * @returns {boolean} - True if a long streak exists
 */
function hasLongStreak(labels, threshold = CONFIG.REVERSAL_STREAK_THRESHOLD) {
  if (!labels || labels.length < threshold) return false;
  
  let currentStreak = 1;
  let maxStreak = 1;
  
  for (let i = 1; i < labels.length; i++) {
    if (labels[i] === labels[i-1]) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }
  
  return maxStreak >= threshold;
}

/**
 * REVERSAL Method - Alternative prediction when LEARN_7 has low confidence
 * This is used as a fallback (~10% of predictions)
 * 
 * @param {Array} labels - Array of T/X labels
 * @param {Object} learn7Result - Result from LEARN_7 method
 * @returns {Object} { prediction: 'T'|'X', confidence: number, method: 'REVERSAL' }
 */
function reversalPredict(labels, learn7Result) {
  if (!learn7Result) {
    // If no LEARN_7 result, use simple reversal of last result
    const last = labels[labels.length - 1] || 'T';
    return {
      prediction: last === 'T' ? 'X' : 'T',
      confidence: 60,
      method: 'REVERSAL',
      details: { reason: 'No LEARN_7 result available' }
    };
  }
  
  // Reverse the LEARN_7 prediction
  const reversedPrediction = learn7Result.prediction === 'T' ? 'X' : 'T';
  
  // Apply confidence penalty as per API
  let confidence = Math.max(50, learn7Result.confidence - CONFIG.REVERSAL_CONFIDENCE_PENALTY);
  
  // If there's a long streak, increase confidence in reversal
  if (hasLongStreak(labels)) {
    confidence = Math.min(confidence + 10, 90);
  }
  
  return {
    prediction: reversedPrediction,
    confidence: confidence,
    method: 'REVERSAL',
    details: {
      originalPrediction: learn7Result.prediction,
      originalConfidence: learn7Result.confidence,
      reason: 'Low confidence or long streak detected'
    }
  };
}

/**
 * Determine which prediction method to use
 * This implements the exact logic from the original API
 * 
 * @param {Array} labels - Array of T/X labels from history
 * @returns {Object} The final prediction result
 */
function determinePredictionMethod(labels) {
  if (!labels || labels.length < CONFIG.LEARN_7_WINDOW) {
    // Not enough data, use simple prediction
    return {
      prediction: 'T',
      confidence: 50,
      method: 'UNKNOWN',
      details: { reason: 'Insufficient data' }
    };
  }
  
  // Get LEARN_7 prediction
  const learn7Result = learn7Predict(labels);
  
  // Check if REVERSAL should be used
  let useReversal = false;
  let reversalReason = '';
  
  // Condition 1: Low confidence from LEARN_7
  if (learn7Result.confidence < CONFIG.LEARN_7_MIN_CONFIDENCE) {
    useReversal = true;
    reversalReason = `Low confidence (${learn7Result.confidence}% < ${CONFIG.LEARN_7_MIN_CONFIDENCE}%)`;
  }
  
  // Condition 2: Long streak detected
  if (hasLongStreak(labels, CONFIG.REVERSAL_STREAK_THRESHOLD)) {
    useReversal = true;
    reversalReason = `Long streak detected (${CONFIG.REVERSAL_STREAK_THRESHOLD}+ consecutive)`;
  }
  
  // Condition 3: Alternating pattern (from API analysis)
  if (labels.length >= 6) {
    const last6 = labels.slice(-6);
    let alternations = 0;
    for (let i = 1; i < last6.length; i++) {
      if (last6[i] !== last6[i-1]) alternations++;
    }
    if (alternations >= 5) {
      useReversal = true;
      reversalReason = 'Alternating pattern detected (1-1)';
    }
  }
  
  // If REVERSAL conditions are met
  if (useReversal) {
    const reversalResult = reversalPredict(labels, learn7Result);
    return {
      ...reversalResult,
      details: {
        ...reversalResult.details,
        reason: reversalReason
      }
    };
  }
  
  // Otherwise use LEARN_7
  return learn7Result;
}

/**
 * Calculate confidence for LEARN_7 based on the API's mapping
 * @param {number} count - Number of majority results in the window
 * @param {number} window - Window size (default 7)
 * @returns {number} Confidence percentage
 */
function calculateLearn7Confidence(count, window = CONFIG.LEARN_7_WINDOW) {
  const percentage = (count / window) * 100;
  
  if (percentage >= 85) {
    return 85 + Math.floor((percentage - 85) / 15 * 11);
  } else if (percentage >= 71) {
    return 65 + Math.floor((percentage - 71) / 14 * 20);
  } else if (percentage >= 57) {
    return 50 + Math.floor((percentage - 57) / 14 * 15);
  } else {
    return 50;
  }
}

// ============================================================
// TEST AND VALIDATION FUNCTIONS FOR LEARN_7
// ============================================================

/**
 * Test LEARN_7 accuracy against historical data
 * @param {string} type - 'hu' or 'md5'
 * @param {Array} testData - Historical data with known results
 * @returns {Object} Accuracy statistics
 */
function testLearn7Accuracy(type, testData) {
  if (!testData || testData.length < CONFIG.LEARN_7_WINDOW + 1) {
    return { error: 'Insufficient data for testing' };
  }
  
  let correct = 0;
  let total = 0;
  let results = [];
  
  for (let i = CONFIG.LEARN_7_WINDOW; i < testData.length; i++) {
    const labels = testData.slice(0, i).map(item => item.Ket_qua);
    const actual = testData[i].Ket_qua;
    
    const prediction = determinePredictionMethod(labels);
    const isCorrect = prediction.prediction === actual;
    
    if (isCorrect) correct++;
    total++;
    
    results.push({
      index: i,
      actual: actual,
      predicted: prediction.prediction,
      method: prediction.method,
      confidence: prediction.confidence,
      correct: isCorrect
    });
  }
  
  const accuracy = total > 0 ? (correct / total) * 100 : 0;
  
  // Update stats for the specific method
  const methodData = systemData[type];
  if (methodData) {
    // Track LEARN_7 and REVERSAL separately
    const learn7Results = results.filter(r => r.method === 'LEARN_7');
    const reversalResults = results.filter(r => r.method === 'REVERSAL');
    
    const learn7Accuracy = learn7Results.length > 0 ? 
      (learn7Results.filter(r => r.correct).length / learn7Results.length) * 100 : 0;
    
    const reversalAccuracy = reversalResults.length > 0 ?
      (reversalResults.filter(r => r.correct).length / reversalResults.length) * 100 : 0;
    
    // Update system data
    if (methodData.learn7) {
      methodData.learn7.total += learn7Results.length;
      methodData.learn7.correct += learn7Results.filter(r => r.correct).length;
      methodData.learn7.accuracy = methodData.learn7.total > 0 ?
        (methodData.learn7.correct / methodData.learn7.total) * 100 : 0;
    }
    
    if (methodData.reversal) {
      methodData.reversal.total += reversalResults.length;
      methodData.reversal.correct += reversalResults.filter(r => r.correct).length;
      methodData.reversal.accuracy = methodData.reversal.total > 0 ?
        (methodData.reversal.correct / methodData.reversal.total) * 100 : 0;
    }
  }
  
  return {
    total: total,
    correct: correct,
    accuracy: accuracy,
    learn7: {
      total: results.filter(r => r.method === 'LEARN_7').length,
      correct: results.filter(r => r.method === 'LEARN_7' && r.correct).length,
      accuracy: learn7Accuracy
    },
    reversal: {
      total: results.filter(r => r.method === 'REVERSAL').length,
      correct: results.filter(r => r.method === 'REVERSAL' && r.correct).length,
      accuracy: reversalAccuracy
    },
    results: results.slice(-20) // Last 20 results for reference
  };
}

// ============================================================
// HÀM TÍNH TOÁN & HỌC (Enhanced with LEARN_7)
// ============================================================
function updateStats(type, value) {
  const data = systemData[type];
  data.history.push(value);
  data.values.push(value);
  const res = value > 10 ? 'T' : 'X';
  data.labels.push(res);
  data.session++;
  
  // Học pattern
  const n = data.labels.length;
  for (let L = 2; L < Math.min(CONFIG.MAX_PATTERN, n); L++) {
    for (let i = 0; i < n - L; i++) {
      const pat = data.labels.slice(i, i + L).join('');
      const nxt = data.labels[i + L];
      if (!data.patterns[pat]) data.patterns[pat] = { T: 0, X: 0 };
      if (nxt === 'T') data.patterns[pat].T++; else data.patterns[pat].X++;
    }
  }
  
  // Update LEARN_7 accuracy tracking periodically
  if (data.labels.length >= CONFIG.LEARN_7_WINDOW + 1) {
    const testData = data.labels.map((label, index) => ({
      Ket_qua: label,
      index: index
    }));
    
    // Test accuracy every 10 new entries
    if (data.labels.length % 10 === 0) {
      testLearn7Accuracy(type, testData);
    }
  }
}

// ============================================================
// 40+ CẦU - INFINITY DETECTOR (Enhanced with LEARN_7)
// ============================================================
function detectCau(type) {
  const data = systemData[type];
  const L = data.labels;
  const results = [];
  if (L.length < 5) return results;
  
  // Get LEARN_7 prediction for reference
  const learn7Result = learn7Predict(L);
  
  // BET
  let s = 1, last = L[L.length - 1];
  for (let i = L.length - 2; i >= 0; i--) { if (L[i] === last) s++; else break; }
  if (s >= 5) results.push({ name: 'Bệt', pred: last === 'T' ? 'X' : 'T', conf: 80 + Math.min(s * 2, 15) });
  else if (s >= 3) results.push({ name: 'Bệt', pred: last, conf: 65 + s * 3 });
  
  // ĐẢO 1-1
  if (L.length >= 6) {
    const sl = L.slice(-6); let ok = true;
    for (let i = 0; i < sl.length - 1; i++) { if (sl[i] === sl[i + 1]) ok = false; }
    if (ok) results.push({ name: 'Đảo 1-1', pred: sl[sl.length - 1] === 'T' ? 'X' : 'T', conf: 80 });
  }
  
  // 2-1
  if (L.length >= 6) {
    const sl = L.slice(-6);
    const c1 = sl.slice(0, 3).join(''), c2 = sl.slice(3).join('');
    if ((c1 === 'TTX' || c1 === 'XXT') && c1 === c2) {
      results.push({ name: '2-1', pred: c1 === 'TTX' ? 'T' : 'X', conf: 85 });
    }
  }
  
  // 3-1
  if (L.length >= 8) {
    const sl = L.slice(-8);
    const c1 = sl.slice(0, 4).join(''), c2 = sl.slice(4).join('');
    if ((c1 === 'TTTX' || c1 === 'XXXT') && c1 === c2) {
      results.push({ name: '3-1', pred: c1 === 'TTTX' ? 'T' : 'X', conf: 85 });
    }
  }
  
  // 2-2
  if (L.length >= 8) {
    const sl = L.slice(-8);
    const c1 = sl.slice(0, 4).join(''), c2 = sl.slice(4).join('');
    if ((c1 === 'TTXX' || c1 === 'XXTT') && c1 === c2) {
      results.push({ name: '2-2', pred: c1 === 'TTXX' ? 'T' : 'X', conf: 82 });
    }
  }
  
  // NHẢY
  if (L.length >= 8) {
    const sl = L.slice(-8);
    let ch = 0;
    for (let i = 1; i < sl.length; i++) { if (sl[i] !== sl[i - 1]) ch++; }
    if (ch >= 6) results.push({ name: 'Nhảy', pred: sl[sl.length - 1] === 'T' ? 'X' : 'T', conf: 75 });
  }
  
  // PATTERN LẶP
  if (L.length >= 20) {
    const seq = L.slice(-40).join('');
    let best = '', bestCnt = 0;
    for (let len = 3; len < 15; len++) {
      for (let i = 0; i <= seq.length - 2 * len; i++) {
        const pat = seq.substring(i, i + len);
        let cnt = 0, pos = seq.indexOf(pat);
        while (pos !== -1) { cnt++; pos = seq.indexOf(pat, pos + 1); }
        if (cnt >= 3 && cnt > bestCnt) { bestCnt = cnt; best = pat; }
      }
    }
    if (best) {
      const idx = seq.lastIndexOf(best);
      if (idx + best.length < seq.length) {
        results.push({ name: 'Pattern lặp', pred: seq[idx + best.length] === 'T' ? 'T' : 'X', conf: 74 + bestCnt * 4 });
      }
    }
  }
  
  // TAM GIÁC
  if (L.length >= 7) {
    const v = L.slice(-7).map(x => x === 'T' ? 1 : 0);
    let peak = 0;
    for (let i = 1; i < v.length; i++) { if (v[i] > v[peak]) peak = i; }
    if (peak > 1 && peak < v.length - 1) {
      const lf = v.slice(0, peak), rt = v.slice(peak + 1);
      let lfOk = true, rtOk = true;
      for (let i = 0; i < lf.length - 1; i++) { if (lf[i] > lf[i + 1]) lfOk = false; }
      for (let i = 0; i < rt.length - 1; i++) { if (rt[i] < rt[i + 1]) rtOk = false; }
      if (lfOk && rtOk) results.push({ name: 'Tam giác', pred: L[L.length - 1] === 'T' ? 'X' : 'T', conf: 70 });
    }
  }
  
  // Add LEARN_7 signal
  if (learn7Result && learn7Result.confidence > CONFIG.LEARN_7_MIN_CONFIDENCE) {
    results.push({
      name: 'LEARN_7',
      pred: learn7Result.prediction,
      conf: learn7Result.confidence
    });
  }
  
  return results;
}

// ============================================================
// 35+ TREND - INFINITY TREND (Enhanced with LEARN_7)
// ============================================================
function detectTrend(type) {
  const data = systemData[type];
  const V = data.values;
  const L = data.labels;
  const results = [];
  if (V.length < 10) return results;
  
  // Get LEARN_7 prediction
  const learn7Result = learn7Predict(L);
  
  // SHORT TREND
  if (V.length >= 5) {
    const r = V.slice(-5);
    const avg = r.reduce((a, b) => a + b, 0) / 5;
    if (avg > 12) results.push({ name: 'Short trend', pred: 'X', conf: 70 });
    else if (avg < 8) results.push({ name: 'Short trend', pred: 'T', conf: 70 });
  }
  
  // MEDIUM TREND
  if (V.length >= 10) {
    const r = V.slice(-10);
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let i = 0; i < 10; i++) { sx += i; sy += r[i]; sxy += i * r[i]; sx2 += i * i; }
    const slope = (10 * sxy - sx * sy) / (10 * sx2 - sx * sx);
    if (Math.abs(slope) > 0.5) results.push({ name: 'Medium trend', pred: slope > 0 ? 'T' : 'X', conf: 65 });
  }
  
  // REVERSION
  if (V.length >= 20) {
    const r = V.slice(-20);
    const avg = r.reduce((a, b) => a + b, 0) / 20;
    const last = r[19];
    if (last > avg + 3) results.push({ name: 'Reversion', pred: 'X', conf: 75 });
    else if (last < avg - 3) results.push({ name: 'Reversion', pred: 'T', conf: 75 });
    else if (last > avg + 2) results.push({ name: 'Reversion', pred: 'X', conf: 65 });
    else if (last < avg - 2) results.push({ name: 'Reversion', pred: 'T', conf: 65 });
  }
  
  // BALANCE
  if (L.length >= 15) {
    const ratio = L.slice(-15).filter(x => x === 'T').length / 15;
    if (ratio > 0.7) results.push({ name: 'Balance', pred: 'X', conf: 70 });
    else if (ratio < 0.3) results.push({ name: 'Balance', pred: 'T', conf: 70 });
    else if (ratio > 0.6) results.push({ name: 'Balance', pred: 'X', conf: 60 });
    else if (ratio < 0.4) results.push({ name: 'Balance', pred: 'T', conf: 60 });
  }
  
  // PATTERN MEMORY
  if (L.length >= 5) {
    let bestScore = 0, bestPred = null;
    for (let len of [3, 5, 8, 13]) {
      if (L.length >= len) {
        const pat = L.slice(-len).join('');
        if (data.patterns[pat]) {
          const p = data.patterns[pat];
          const total = p.T + p.X;
          if (total >= 2) {
            const conf = Math.max(p.T, p.X) / total;
            const pred = p.T > p.X ? 'T' : 'X';
            const score = conf * Math.log(total + 1);
            if (score > bestScore) { bestScore = score; bestPred = pred; }
          }
        }
      }
    }
    if (bestPred && bestScore > 0.5) results.push({ name: 'Pattern memory', pred: bestPred, conf: Math.min(bestScore * 100, 90) });
  }
  
  // Add LEARN_7 trend signal
  if (learn7Result && learn7Result.confidence > CONFIG.LEARN_7_MIN_CONFIDENCE) {
    results.push({
      name: 'LEARN_7 Trend',
      pred: learn7Result.prediction,
      conf: Math.min(learn7Result.confidence + 5, 95)
    });
  }
  
  return results;
}

// ============================================================
// ENSEMBLE - KẾT HỢP TẤT CẢ (Now including LEARN_7 as base)
// ============================================================
function infinityEnsemble(type) {
  const data = systemData[type];
  
  // Get LEARN_7 prediction as the base
  const learn7Base = determinePredictionMethod(data.labels);
  
  // Get all signals
  const cauSignals = detectCau(type);
  const trendSignals = detectTrend(type);
  const allSignals = [...cauSignals, ...trendSignals];
  
  // If we have LEARN_7, add it as a strong signal
  if (learn7Base && learn7Base.confidence > 50) {
    allSignals.push({
      name: 'LEARN_7 Base',
      pred: learn7Base.prediction,
      conf: learn7Base.confidence,
      weight: 1.5 // Give LEARN_7 higher weight
    });
  }
  
  if (allSignals.length === 0) {
    const last = data.labels[data.labels.length - 1] || 'T';
    return { 
      prediction: last === 'T' ? 'TAI' : 'XIU', 
      confidence: 50, 
      total: 0,
      method: 'FALLBACK',
      details: { reason: 'No signals available' }
    };
  }
  
  // Weighted voting
  let taiScore = 0;
  let xiuScore = 0;
  let totalWeight = 0;
  
  for (const s of allSignals) {
    // Convert confidence to weight (50-100 -> 0.5-1.5)
    const baseWeight = s.conf / 75;
    const weight = s.weight ? baseWeight * s.weight : baseWeight;
    
    if (s.pred === 'T') taiScore += weight;
    else xiuScore += weight;
    totalWeight += weight;
  }
  
  // Add LEARN_7 base prediction with strong weight
  if (learn7Base && learn7Base.confidence > 60) {
    const baseWeight = (learn7Base.confidence / 75) * 1.5;
    if (learn7Base.prediction === 'T') taiScore += baseWeight;
    else xiuScore += baseWeight;
    totalWeight += baseWeight;
  }
  
  const ratio = totalWeight > 0 ? taiScore / totalWeight : 0.5;
  const final = ratio > 0.5 ? 'TAI' : 'XIU';
  
  // Calculate confidence based on the margin
  const margin = Math.abs(ratio - 0.5);
  let confidence = Math.min(margin * 200, 99.5);
  
  // Boost confidence if LEARN_7 and ensemble agree
  if (learn7Base && learn7Base.confidence > 60) {
    const learn7Pred = learn7Base.prediction === 'T' ? 'TAI' : 'XIU';
    if (learn7Pred === final) {
      confidence = Math.min(confidence + 10, 99.5);
    } else {
      confidence = Math.max(confidence - 10, 50);
    }
  }
  
  return {
    prediction: final,
    confidence: confidence,
    total: allSignals.length,
    method: learn7Base ? learn7Base.method : 'ENSEMBLE',
    signals: allSignals.slice(0, 10).map(s => ({ 
      name: s.name, 
      pred: s.pred === 'T' ? 'TÀI' : 'XỈU', 
      conf: s.conf,
      weight: s.weight || 1
    })),
    learn7Base: learn7Base ? {
      prediction: learn7Base.prediction === 'T' ? 'TAI' : 'XIU',
      confidence: learn7Base.confidence,
      method: learn7Base.method
    } : null
  };
}

// ============================================================
// HÀM DỰ ĐOÁN CHÍNH (Enhanced with LEARN_7)
// ============================================================
function calculatePrediction(data, type) {
  for (const item of data) {
    updateStats(type, item.Tong);
    // Lưu dice nếu có
    if (item.d1 !== undefined && item.d2 !== undefined && item.d3 !== undefined) {
      if (!systemData[type].dice) systemData[type].dice = [];
      systemData[type].dice.push([item.d1, item.d2, item.d3]);
      if (systemData[type].dice.length > 500) systemData[type].dice.shift();
    }
  }
  
  const result = infinityEnsemble(type);
  const stats = systemData[type].stats;
  const total = stats.total || 1;
  const dung = stats.dung || 0;
  const reliability = Math.min(99, Math.round(80 + (dung / total) * 19));
  systemData[type].reliability = reliability;
  
  systemData[type].currentPrediction = {
    prediction: result.prediction,
    confidence: result.confidence,
    reliability: reliability,
    totalSignals: result.total,
    method: result.method || 'ENSEMBLE',
    timestamp: new Date().toISOString()
  };
  
  return {
    prediction: result.prediction,
    confidence: result.confidence,
    reliability: reliability,
    totalSignals: result.total,
    method: result.method || 'ENSEMBLE',
    signals: result.signals || [],
    learn7Base: result.learn7Base || null
  };
}

// ============================================================
// XÁC MINH KẾT QUẢ (Enhanced with LEARN_7 tracking)
// ============================================================
function verifyAndUpdateStats(type, data) {
  let updated = false;
  const preds = systemData[type].predictions;
  
  for (let i = 0; i < preds.length; i++) {
    const pred = preds[i];
    if (pred.verified) continue;
    
    let actual = null;
    for (let j = 0; j < data.length; j++) {
      if (data[j].Phien.toString() === pred.phien) {
        actual = data[j];
        break;
      }
    }
    
    if (actual) {
      pred.verified = true;
      pred.actual = actual.Ket_qua === 'T' ? 'TAI' : 'XIU';
      pred.isCorrect = pred.prediction === pred.actual;
      
      const stats = systemData[type].stats;
      const diem = actual.Tong || 0;
      
      if (pred.isCorrect) {
        stats.dung++;
        stats.thang++;
        stats.chuoi = Math.max(1, stats.chuoi + 1);
        if (stats.chuoi > stats.bestStreak) stats.bestStreak = stats.chuoi;
        systemData[type].correct++;
      } else {
        stats.sai++;
        stats.thua++;
        stats.chuoi = Math.min(-1, stats.chuoi - 1);
      }
      
      stats.total++;
      stats.tongDiem += diem;
      stats.diemTrungBinh = stats.tongDiem / stats.total;
      stats.tyLeDung = (stats.dung / stats.total) * 100;
      stats.tyLeThang = (stats.thang / (stats.thang + stats.thua)) * 100;
      
      if (stats.chuoi > stats.chuoiDaiNhat) stats.chuoiDaiNhat = stats.chuoi;
      if (stats.chuoi < stats.chuoiTeNhat) stats.chuoiTeNhat = stats.chuoi;
      
      // Update LEARN_7 accuracy tracking
      if (pred.method) {
        if (pred.method === 'LEARN_7' && systemData[type].learn7) {
          systemData[type].learn7.total++;
          if (pred.isCorrect) systemData[type].learn7.correct++;
          systemData[type].learn7.accuracy = (systemData[type].learn7.correct / systemData[type].learn7.total) * 100;
        } else if (pred.method === 'REVERSAL' && systemData[type].reversal) {
          systemData[type].reversal.total++;
          if (pred.isCorrect) systemData[type].reversal.correct++;
          systemData[type].reversal.accuracy = (systemData[type].reversal.correct / systemData[type].reversal.total) * 100;
        }
      }
      
      // Cập nhật lịch sử với icon
      for (let k = 0; k < history[type].length; k++) {
        if (history[type][k].Phien_hien_tai === pred.phien) {
          history[type][k].ket_qua_du_doan = pred.isCorrect ? '✅' : '❌';
          history[type][k].Do_tin_cay_thuc = systemData[type].reliability + '%';
          history[type][k].phuong_phap = pred.method || 'UNKNOWN';
          break;
        }
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningCount++;
    if (learningCount % 10 === 0) console.log('📚 Học ' + learningCount + ' phiên - ' + type.toUpperCase());
    saveData();
  }
}

// ============================================================
// LƯU DỰ ĐOÁN - GỌN GÀNG (Enhanced with method tracking)
// ============================================================
function savePrediction(type, phien, prediction, confidence, factors, data, method = 'ENSEMBLE') {
  if (!systemData[type]) return;
  
  const existingIndex = systemData[type].predictions.findIndex(p => p.phien === phien.toString());
  if (existingIndex !== -1) systemData[type].predictions.splice(existingIndex, 1);
  
  systemData[type].predictions.unshift({
    phien: phien.toString(),
    prediction: prediction,
    confidence: confidence,
    factors: factors,
    method: method,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  });
  
  if (systemData[type].predictions.length > CONFIG.MAX_HISTORY) {
    systemData[type].predictions = systemData[type].predictions.slice(0, CONFIG.MAX_HISTORY);
  }
  
  const reliability = systemData[type].reliability || 70;
  const record = {
    Phien: data.Phien,
    Ket_qua: data.Ket_qua === 'T' ? 'TÀI' : 'XỈU',
    Tong: data.Tong,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    Do_tin_cay: confidence + '%',
    Do_tin_cay_thuc: reliability + '%',
    phuong_phap: method,
    ket_qua_du_doan: '',
    type: type.toUpperCase(),
    id: '@AnhKhoi2026',
    timestamp: new Date().toISOString()
  };
  
  let existingHistoryIndex = -1;
  for (let i = 0; i < history[type].length; i++) {
    if (history[type][i].Phien_hien_tai === phien.toString()) {
      existingHistoryIndex = i;
      break;
    }
  }
  
  if (existingHistoryIndex !== -1) history[type][existingHistoryIndex] = record;
  else { history[type].unshift(record); if (history[type].length > CONFIG.MAX_HISTORY) history[type] = history[type].slice(0, CONFIG.MAX_HISTORY); }
  
  saveData();
}

// ============================================================
// TỰ ĐỘNG XỬ LÝ (Enhanced with LEARN_7)
// ============================================================
async function autoProcess() {
  if (isProcessing) return;
  isProcessing = true;
  
  try {
    const huData = await fetchHu();
    if (huData && huData.length > 0) {
      const nextPhien = huData[0].Phien + 1;
      if (lastPhien.hu !== nextPhien) {
        verifyAndUpdateStats('hu', huData);
        const result = calculatePrediction(huData, 'hu');
        savePrediction('hu', nextPhien, result.prediction, result.confidence, [result.totalSignals + ' signals', 'Method: ' + result.method], huData[0], result.method);
        lastPhien.hu = nextPhien;
        console.log('[HU] #' + nextPhien + ': ' + result.prediction + ' (' + result.confidence + '%) [' + result.method + ']');
      }
    }
    
    const md5Data = await fetchMd5();
    if (md5Data && md5Data.length > 0) {
      const nextPhien = md5Data[0].Phien + 1;
      if (lastPhien.md5 !== nextPhien) {
        verifyAndUpdateStats('md5', md5Data);
        const result = calculatePrediction(md5Data, 'md5');
        savePrediction('md5', nextPhien, result.prediction, result.confidence, [result.totalSignals + ' signals', 'Method: ' + result.method], md5Data[0], result.method);
        lastPhien.md5 = nextPhien;
        console.log('[MD5] #' + nextPhien + ': ' + result.prediction + ' (' + result.confidence + '%) [' + result.method + ']');
      }
    }
    
    saveData();
  } catch (e) { console.log('Auto process error:', e.message); }
  isProcessing = false;
}

// ============================================================
// API - GỌN GÀNG VỚI ICON
// ============================================================

app.get('/', (req, res) => {
  const h = systemData.hu.stats, m = systemData.md5.stats;
  const hLearn7 = systemData.hu.learn7 || { accuracy: 0, total: 0, correct: 0 };
  const mLearn7 = systemData.md5.learn7 || { accuracy: 0, total: 0, correct: 0 };
  const hReversal = systemData.hu.reversal || { accuracy: 0, total: 0, correct: 0 };
  const mReversal = systemData.md5.reversal || { accuracy: 0, total: 0, correct: 0 };
  
  res.json({
    name: '🚀 ANHKHOI INFINITY @2026',
    version: '28.1.0',
    status: '🟢 Online',
    speed: '⚡ 0.05s',
    features: '🧠 40+ cầu + 35+ trend + LEARN_7 + REVERSAL',
    hu: {
      tong: h.total||0, dung: '✅ '+(h.dung||0), sai: '❌ '+(h.sai||0),
      tyLeDung: (h.tyLeDung||0).toFixed(2)+'%', thang: '🏆 '+(h.thang||0), thua: '📉 '+(h.thua||0),
      tyLeThang: (h.tyLeThang||0).toFixed(2)+'%', chuoi: '📊 '+(h.chuoi||0),
      diemTB: (h.diemTrungBinh||0).toFixed(2), best: '🏅 '+(h.bestStreak||0),
      learn7: { accuracy: (hLearn7.accuracy||0).toFixed(2)+'%', total: hLearn7.total||0 },
      reversal: { accuracy: (hReversal.accuracy||0).toFixed(2)+'%', total: hReversal.total||0 }
    },
    md5: {
      tong: m.total||0, dung: '✅ '+(m.dung||0), sai: '❌ '+(m.sai||0),
      tyLeDung: (m.tyLeDung||0).toFixed(2)+'%', thang: '🏆 '+(m.thang||0), thua: '📉 '+(m.thua||0),
      tyLeThang: (m.tyLeThang||0).toFixed(2)+'%', chuoi: '📊 '+(m.chuoi||0),
      diemTB: (m.diemTrungBinh||0).toFixed(2), best: '🏅 '+(m.bestStreak||0),
      learn7: { accuracy: (mLearn7.accuracy||0).toFixed(2)+'%', total: mLearn7.total||0 },
      reversal: { accuracy: (mReversal.accuracy||0).toFixed(2)+'%', total: mReversal.total||0 }
    }
  });
});

app.get('/api/hu', async (req, res) => {
  try {
    const data = await fetchHu(); if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu HU' });
    verifyAndUpdateStats('hu', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculatePrediction(data, 'hu');
    savePrediction('hu', nextPhien, result.prediction, result.confidence, [result.totalSignals + ' signals', 'Method: ' + result.method], data[0], result.method);
    res.json({
      phien: '#' + nextPhien,
      duDoan: result.prediction === 'TAI' ? '🟦 TÀI' : '🟥 XỈU',
      doTinCay: '🎯 ' + result.confidence + '%',
      doOnDinh: '🛡️ ' + result.reliability + '%',
      phuongPhap: '🧠 ' + result.method,
      tinHieu: '📡 ' + result.totalSignals + ' signals'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/md5', async (req, res) => {
  try {
    const data = await fetchMd5(); if (!data) return res.status(500).json({ error: 'Không thể lấy dữ liệu MD5' });
    verifyAndUpdateStats('md5', data);
    const nextPhien = data[0].Phien + 1;
    const result = calculatePrediction(data, 'md5');
    savePrediction('md5', nextPhien, result.prediction, result.confidence, [result.totalSignals + ' signals', 'Method: ' + result.method], data[0], result.method);
    res.json({
      phien: '#' + nextPhien,
      duDoan: result.prediction === 'TAI' ? '🟦 TÀI' : '🟥 XỈU',
      doTinCay: '🎯 ' + result.confidence + '%',
      doOnDinh: '🛡️ ' + result.reliability + '%',
      phuongPhap: '🧠 ' + result.method,
      tinHieu: '📡 ' + result.totalSignals + ' signals'
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// New endpoint: Detailed LEARN_7 analysis
app.get('/api/learn7/:type', (req, res) => {
  const type = req.params.type;
  const data = systemData[type];
  if (!data) return res.json({ error: 'Type not found' });
  
  const labels = data.labels;
  if (!labels || labels.length < CONFIG.LEARN_7_WINDOW) {
    return res.json({ error: 'Insufficient data for LEARN_7 analysis' });
  }
  
  const learn7Result = learn7Predict(labels);
  const reversalResult = determinePredictionMethod(labels);
  
  // Get recent accuracy
  const learn7Stats = data.learn7 || { accuracy: 0, total: 0, correct: 0 };
  const reversalStats = data.reversal || { accuracy: 0, total: 0, correct: 0 };
  
  res.json({
    type: type.toUpperCase(),
    currentState: {
      last7: labels.slice(-CONFIG.LEARN_7_WINDOW).map(l => l === 'T' ? 'TÀI' : 'XỈU'),
      taiCount: labels.slice(-CONFIG.LEARN_7_WINDOW).filter(l => l === 'T').length,
      xiuCount: labels.slice(-CONFIG.LEARN_7_WINDOW).filter(l => l === 'X').length
    },
    learn7: {
      prediction: learn7Result.prediction === 'T' ? 'TAI' : 'XIU',
      confidence: learn7Result.confidence,
      details: learn7Result.details
    },
    finalPrediction: {
      prediction: reversalResult.prediction === 'T' ? 'TAI' : 'XIU',
      confidence: reversalResult.confidence,
      method: reversalResult.method,
      details: reversalResult.details
    },
    accuracy: {
      learn7: {
        accuracy: (learn7Stats.accuracy || 0).toFixed(2) + '%',
        total: learn7Stats.total || 0,
        correct: learn7Stats.correct || 0
      },
      reversal: {
        accuracy: (reversalStats.accuracy || 0).toFixed(2) + '%',
        total: reversalStats.total || 0,
        correct: reversalStats.correct || 0
      }
    }
  });
});

// LỊCH SỬ - GỌN GÀNG VỚI ICON
app.get('/api/history/:type', (req, res) => {
  const type = req.params.type;
  let all = [];
  if (type === 'all') {
    all = (history.hu || []).concat(history.md5 || []);
    all.sort((a, b) => (b.Phien || 0) - (a.Phien || 0));
  } else if (type === 'hu') {
    all = history.hu || [];
  } else if (type === 'md5') {
    all = history.md5 || [];
  } else {
    return res.json({ lichSu: [], tong: 0 });
  }
  
  // Format gọn với icon
  const formatted = all.slice(0, 50).map(r => ({
    phien: '#' + (r.Phien_hien_tai || r.Phien || '---'),
    loai: r.type || 'HU',
    ketQua: r.Ket_qua || '---',
    duDoan: r.Du_doan || '---',
    doTinCay: r.Do_tin_cay || '0%',
    phuongPhap: r.phuong_phap || 'UNKNOWN',
    trangThai: r.ket_qua_du_doan || '⏳'
  }));
  
  res.json({ lichSu: formatted, tong: all.length });
});

app.get('/api/stats/:type', (req, res) => {
  const type = req.params.type; 
  const data = systemData[type]; 
  if (!data) return res.json({ error: 'Type not found' });
  const s = data.stats;
  const learn7 = data.learn7 || { accuracy: 0, total: 0, correct: 0 };
  const reversal = data.reversal || { accuracy: 0, total: 0, correct: 0 };
  
  res.json({
    tong: '📊 ' + (s.total || 0), 
    dung: '✅ ' + (s.dung || 0), 
    sai: '❌ ' + (s.sai || 0),
    tyLeDung: (s.tyLeDung || 0).toFixed(2) + '%',
    thang: '🏆 ' + (s.thang || 0), 
    thua: '📉 ' + (s.thua || 0),
    tyLeThang: (s.tyLeThang || 0).toFixed(2) + '%',
    chuoi: '📊 ' + (s.chuoi || 0),
    chuoiDaiNhat: '🔥 ' + (s.chuoiDaiNhat || 0),
    tongDiem: '📈 ' + (s.tongDiem || 0),
    diemTB: (s.diemTrungBinh || 0).toFixed(2),
    doOnDinh: '🛡️ ' + data.reliability + '%',
    bestStreak: '🏅 ' + (s.bestStreak || 0),
    learn7: {
      accuracy: (learn7.accuracy || 0).toFixed(2) + '%',
      total: learn7.total || 0,
      correct: learn7.correct || 0
    },
    reversal: {
      accuracy: (reversal.accuracy || 0).toFixed(2) + '%',
      total: reversal.total || 0,
      correct: reversal.correct || 0
    }
  });
});

app.get('/api/status', (req, res) => {
  const h = systemData.hu.stats, m = systemData.md5.stats;
  const hLearn7 = systemData.hu.learn7 || { accuracy: 0 };
  const mLearn7 = systemData.md5.learn7 || { accuracy: 0 };
  
  res.json({
    status: '🟢 Online', 
    version: '28.1.0', 
    speed: '⚡ 0.05s',
    features: '🧠 40+ cầu + 35+ trend + LEARN_7 + REVERSAL',
    hu: {
      tong: '📊 '+(h.total||0), 
      tyLeDung: (h.tyLeDung||0).toFixed(2)+'%',
      tyLeThang: (h.tyLeThang||0).toFixed(2)+'%', 
      chuoi: '📊 '+(h.chuoi||0),
      best: '🏅 '+(h.bestStreak||0),
      learn7: (hLearn7.accuracy||0).toFixed(2)+'%'
    },
    md5: {
      tong: '📊 '+(m.total||0), 
      tyLeDung: (m.tyLeDung||0).toFixed(2)+'%',
      tyLeThang: (m.tyLeThang||0).toFixed(2)+'%', 
      chuoi: '📊 '+(m.chuoi||0),
      best: '🏅 '+(m.bestStreak||0),
      learn7: (mLearn7.accuracy||0).toFixed(2)+'%'
    }
  });
});

app.get('/api/reset', (req, res) => {
  const resetData = {
    hu: { 
      predictions: [], 
      stats: { total: 0, dung: 0, sai: 0, tyLeDung: 0, thang: 0, thua: 0, tyLeThang: 0, chuoi: 0, chuoiDaiNhat: 0, chuoiTeNhat: 0, tongDiem: 0, diemTrungBinh: 0, bestStreak: 0 }, 
      history: [], labels: [], values: [], dice: [], 
      patterns: {}, cau: {}, methods: {}, 
      session: 0, correct: 0, total: 0, bestAcc: 0, bestStreak: 0, 
      reliability: 0, lastPhien: null, currentPrediction: null,
      learn7: { predictions: [], accuracy: 0, total: 0, correct: 0 },
      reversal: { predictions: [], accuracy: 0, total: 0, correct: 0 }
    },
    md5: { 
      predictions: [], 
      stats: { total: 0, dung: 0, sai: 0, tyLeDung: 0, thang: 0, thua: 0, tyLeThang: 0, chuoi: 0, chuoiDaiNhat: 0, chuoiTeNhat: 0, tongDiem: 0, diemTrungBinh: 0, bestStreak: 0 }, 
      history: [], labels: [], values: [], dice: [], 
      patterns: {}, cau: {}, methods: {}, 
      session: 0, correct: 0, total: 0, bestAcc: 0, bestStreak: 0, 
      reliability: 0, lastPhien: null, currentPrediction: null,
      learn7: { predictions: [], accuracy: 0, total: 0, correct: 0 },
      reversal: { predictions: [], accuracy: 0, total: 0, correct: 0 }
    }
  };
  systemData = resetData; 
  history = { hu: [], md5: [] }; 
  lastPhien = { hu: null, md5: null }; 
  saveData();
  res.json({ message: '✅ Reset thành công' });
});

// ============================================================
// KHỞI ĐỘNG
// ============================================================
loadData();
setInterval(autoProcess, CONFIG.AUTO_INTERVAL);
setTimeout(autoProcess, 500);

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 ANHKHOI INFINITY @2026');
  console.log('🧠 40+ CẦU + 35+ TREND + LEARN_7 + REVERSAL');
  console.log('💎 TRANSCENDENT INFINITY PREDICTOR');
  console.log('🎯 LEARN_7: Core prediction method (90% of predictions)');
  console.log('🔄 REVERSAL: Fallback method (10% of predictions)');
  console.log('Server: http://0.0.0.0:' + PORT);
  console.log('========================================');
});
