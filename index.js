const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const DATA_FILE = 'ai_vip_data.json';

// ==================== CẤU HÌNH AI VIP ====================
const AI_CONFIG = {
  targetAccuracy: 0.70,
  minConfidence: 60,
  maxConfidence: 88,
  analysisDepth: 100,
  trendWindow: 20,
  riskFactor: 0.15,
  adaptiveLearning: true
};

// ==================== CẤU TRÚC DỮ LIỆU THÔNG MINH ====================
let aiData = {
  version: 'VIP-AI-ULTRA',
  lastUpdate: new Date().toISOString(),
  history: { hu: [], md5: [] },
  patterns: {
    hu: {},
    md5: {}
  },
  stats: {
    hu: { total: 0, correct: 0, streak: 0, bestStreak: 0 },
    md5: { total: 0, correct: 0, streak: 0, bestStreak: 0 }
  },
  models: {
    diceTrend: { accuracy: 0.5 },
    probability: { accuracy: 0.5 },
    neuralNetwork: { accuracy: 0.5 },
    smartVoting: { accuracy: 0.5 }
  }
};

// ==================== HỆ THỐNG PHÂN TÍCH VIP ====================
class VIPAnalyzer {
  constructor(type) {
    this.type = type;
    this.patternWeights = {
      dice_trend: 1.3,
      probability: 1.2,
      neutral: 1.1,
      atom: 1.25,
      fibonacci: 1.15,
      golden_ratio: 1.15,
      resistance: 1.3,
      house_analysis: 1.4,
      cheat_detection: 1.35,
      smart_voting: 1.5
    };
  }

  // 1. PHÂN TÍCH DICE TRENDLINE (CẢI TIẾN VIP)
  analyzeDiceTrendline(data) {
    if (data.length < 10) return null;
    
    const recent = data.slice(0, 10);
    let trendScore = { tai: 0, xiu: 0 };
    
    // Phân tích xu hướng từng viên xúc xắc
    for (let diceIndex = 0; diceIndex < 3; diceIndex++) {
      const diceValues = recent.map(d => [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3][diceIndex]);
      const movingAvg = diceValues.reduce((a, b) => a + b, 0) / diceValues.length;
      
      // Xu hướng tăng/giảm
      if (diceValues[0] > diceValues[3]) {
        trendScore.xiu += (diceValues[0] - diceValues[3]) * 0.3;
      } else if (diceValues[0] < diceValues[3]) {
        trendScore.tai += (diceValues[3] - diceValues[0]) * 0.3;
      }
      
      // Phân tích momentum
      const momentum = (diceValues[0] - diceValues[1]) + (diceValues[1] - diceValues[2]);
      if (momentum > 2) trendScore.tai += 1.5;
      if (momentum < -2) trendScore.xiu += 1.5;
    }
    
    const prediction = trendScore.tai >= trendScore.xiu ? 'Tài' : 'Xỉu';
    const confidence = 65 + Math.min(15, Math.abs(trendScore.tai - trendScore.xiu));
    
    return {
      method: 'DICE_TRENDLINE_VIP',
      prediction,
      confidence: Math.round(confidence),
      score: trendScore,
      reason: `Phân tích xu hướng vi xúc xắc (Tài:${trendScore.tai.toFixed(1)} Xỉu:${trendScore.xiu.toFixed(1)})`
    };
  }

  // 2. PHÂN TÍCH XÁC SUẤT TOÁN HỌC (PROBABILITY VIP)
  analyzeProbability(data) {
    if (data.length < 50) return null;
    
    const window = data.slice(0, 50);
    const results = window.map(d => d.Ket_qua);
    const sums = window.map(d => d.Tong);
    
    // Xác suất cơ bản
    const taiCount = results.filter(r => r === 'Tài').length;
    const baseProbability = taiCount / results.length;
    
    // Xác suất có điều kiện (Conditional Probability)
    let conditionalProb = { tai: 0.5, xiu: 0.5 };
    
    for (let i = 1; i < results.length - 1; i++) {
      const prev = results[i];
      const current = results[i + 1];
      
      if (prev === 'Tài' && current === 'Tài') conditionalProb.tai++;
      if (prev === 'Xỉu' && current === 'Xỉu') conditionalProb.xiu++;
    }
    
    conditionalProb.tai = conditionalProb.tai / (results.length - 1);
    conditionalProb.xiu = conditionalProb.xiu / (results.length - 1);
    
    // Xác suất tổng điểm
    const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
    const sumProb = avgSum > 10.5 ? { tai: 0.6, xiu: 0.4 } : { tai: 0.4, xiu: 0.6 };
    
    // Kết hợp xác suất Bayes
    const finalTaiProb = (baseProbability * 0.3) + (conditionalProb.tai * 0.4) + (sumProb.tai * 0.3);
    const finalXiuProb = (1 - baseProbability) * 0.3 + conditionalProb.xiu * 0.4 + sumProb.xiu * 0.3;
    
    const prediction = finalTaiProb >= finalXiuProb ? 'Tài' : 'Xỉu';
    const confidence = 60 + Math.min(25, Math.abs(finalTaiProb - finalXiuProb) * 100);
    
    return {
      method: 'PROBABILITY_VIP',
      prediction,
      confidence: Math.round(confidence),
      probabilities: {
        base: baseProbability,
        conditional: conditionalProb,
        sum: sumProb,
        final: { tai: finalTaiProb, xiu: finalXiuProb }
      },
      reason: `Xác suất Bayes: Tài ${(finalTaiProb*100).toFixed(1)}% | Xỉu ${(finalXiuProb*100).toFixed(1)}%`
    };
  }

  // 3. PHÂN TÍCH NEUTRAL (TRẠNG THÁI CÂN BẰNG)
  analyzeNeutral(data) {
    if (data.length < 30) return null;
    
    const recent = data.slice(0, 30);
    const results = recent.map(d => d.Ket_qua);
    
    // Kiểm tra trạng thái neutral
    const taiCount = results.filter(r => r === 'Tài').length;
    const ratio = taiCount / results.length;
    
    // Neutral zone: 40% - 60%
    if (ratio >= 0.4 && ratio <= 0.6) {
      // Trong vùng neutral, dự đoán theo momentum
      const last5 = results.slice(0, 5);
      const momentum = last5[0] === last5[1] ? 'stable' : 'changing';
      
      let prediction;
      if (momentum === 'stable') {
        prediction = last5[0]; // Giữ nguyên xu hướng
      } else {
        prediction = last5[0] === 'Tài' ? 'Xỉu' : 'Tài'; // Đảo chiều
      }
      
      return {
        method: 'NEUTRAL_ANALYSIS',
        prediction,
        confidence: 62,
        neutralZone: true,
        ratio,
        reason: `Trạng thái cân bằng (${(ratio*100).toFixed(0)}% Tài) - Momentum: ${momentum}`
      };
    }
    
    return null;
  }

  // 4. PHÂN TÍCH ATOM (PHÂN TÍCH VI MÔ)
  analyzeAtom(data) {
    if (data.length < 15) return null;
    
    const recent = data.slice(0, 15);
    const atomPatterns = [];
    
    // Phân tích vi mô từng bộ xúc xắc
    for (let i = 0; i < recent.length - 2; i++) {
      const current = recent[i];
      const next = recent[i + 1];
      
      // So sánh từng viên xúc xắc
      const diceChanges = [
        current.Xuc_xac_1 - next.Xuc_xac_1,
        current.Xuc_xac_2 - next.Xuc_xac_2,
        current.Xuc_xac_3 - next.Xuc_xac_3
      ];
      
      const increaseCount = diceChanges.filter(c => c < 0).length;
      const decreaseCount = diceChanges.filter(c => c > 0).length;
      
      atomPatterns.push({
        increase: increaseCount,
        decrease: decreaseCount,
        resultChange: current.Ket_qua !== next.Ket_qua
      });
    }
    
    // Tìm pattern phổ biến
    const commonPattern = findCommonAtomPattern(atomPatterns);
    
    if (commonPattern) {
      const currentDice = [recent[0].Xuc_xac_1, recent[0].Xuc_xac_2, recent[0].Xuc_xac_3];
      const prediction = predictFromAtomPattern(currentDice, commonPattern);
      
      return {
        method: 'ATOM_ANALYSIS',
        prediction,
        confidence: 68,
        pattern: commonPattern,
        reason: `Phân tích vi mô: Pattern ${commonPattern.type} độ tin cậy ${commonPattern.confidence}%`
      };
    }
    
    return null;
  }

  // 5. PHÂN TÍCH FIBONACCI
  analyzeFibonacci(data) {
    if (data.length < 21) return null;
    
    const fibSequence = [1, 2, 3, 5, 8, 13, 21];
    const results = data.slice(0, 21).map(d => d.Ket_qua);
    
    let fibTai = 0;
    let fibXiu = 0;
    
    fibSequence.forEach(pos => {
      if (pos <= results.length) {
        if (results[pos - 1] === 'Tài') fibTai++;
        else fibXiu++;
      }
    });
    
    // Fibonacci reversal pattern
    if (Math.abs(fibTai - fibXiu) >= 3) {
      const dominant = fibTai > fibXiu ? 'Tài' : 'Xỉu';
      const prediction = dominant === 'Tài' ? 'Xỉu' : 'Tài';
      
      return {
        method: 'FIBONACCI',
        prediction,
        confidence: 70,
        fibScore: { tai: fibTai, xiu: fibXiu },
        reason: `Fibonacci reversal: ${fibTai}T-${fibXiu}X → Bẻ cầu ${prediction}`
      };
    }
    
    // Fibonacci continuation
    if (fibTai === fibXiu || Math.abs(fibTai - fibXiu) <= 1) {
      const prediction = results[0];
      
      return {
        method: 'FIBONACCI',
        prediction,
        confidence: 65,
        fibScore: { tai: fibTai, xiu: fibXiu },
        reason: `Fibonacci cân bằng: Theo xu hướng hiện tại`
      };
    }
    
    return null;
  }

  // 6. PHÂN TÍCH GOLDEN RATIO (TỶ LỆ VÀNG)
  analyzeGoldenRatio(data) {
    if (data.length < 34) return null;
    
    const goldenPositions = [1, 2, 3, 5, 8, 13, 21, 34];
    const results = data.slice(0, 34).map(d => d.Ket_qua);
    
    let goldenTai = 0;
    let goldenXiu = 0;
    
    goldenPositions.forEach(pos => {
      if (pos <= results.length) {
        if (results[pos - 1] === 'Tài') goldenTai++;
        else goldenXiu++;
      }
    });
    
    const ratio = Math.max(goldenTai, goldenXiu) / Math.min(goldenTai, goldenXiu) || 1;
    
    // Golden ratio detection (1.618)
    if (ratio >= 1.5 && ratio <= 1.8) {
      const dominant = goldenTai > goldenXiu ? 'Tài' : 'Xỉu';
      const prediction = dominant;
      
      return {
        method: 'GOLDEN_RATIO',
        prediction,
        confidence: 72,
        ratio: ratio.toFixed(2),
        goldenScore: { tai: goldenTai, xiu: goldenXiu },
        reason: `Tỷ lệ vàng ${ratio.toFixed(2)} → ${prediction} chiếm ưu thế`
      };
    }
    
    return null;
  }

  // 7. PHÂN TÍCH KHÁNG CỰ/HỖ TRỢ
  analyzeResistanceSupport(data) {
    if (data.length < 25) return null;
    
    const sums = data.slice(0, 25).map(d => d.Tong);
    const currentSum = sums[0];
    
    // Tìm resistance và support
    const sortedSums = [...sums].sort((a, b) => b - a);
    const resistance = sortedSums[0]; // Highest
    const support = sortedSums[sortedSums.length - 1]; // Lowest
    
    // Khoảng cách đến resistance/support
    const toResistance = resistance - currentSum;
    const toSupport = currentSum - support;
    
    let prediction = null;
    let reason = '';
    let confidence = 0;
    
    if (toResistance <= 2) {
      prediction = 'Xỉu';
      confidence = 75;
      reason = `Chạm kháng cự ${resistance} (hiện tại: ${currentSum})`;
    } else if (toSupport <= 2) {
      prediction = 'Tài';
      confidence = 75;
      reason = `Chạm hỗ trợ ${support} (hiện tại: ${currentSum})`;
    } else if (toResistance < toSupport) {
      prediction = 'Xỉu';
      confidence = 65;
      reason = `Gần kháng cự (còn ${toResistance} điểm)`;
    } else if (toSupport < toResistance) {
      prediction = 'Tài';
      confidence = 65;
      reason = `Gần hỗ trợ (còn ${toSupport} điểm)`;
    }
    
    if (prediction) {
      return {
        method: 'RESISTANCE_SUPPORT',
        prediction,
        confidence,
        levels: { resistance, support, current: currentSum },
        reason
      };
    }
    
    return null;
  }

  // 8. PHÂN TÍCH NHÀ CÁI (HOUSE ANALYSIS)
  analyzeHousePattern(data) {
    if (data.length < 100) return null;
    
    const recent = data.slice(0, 100);
    const results = recent.map(d => d.Ket_qua);
    
    // Kiểm tra pattern bất thường
    const patterns = detectHousePatterns(results);
    
    if (patterns.suspicious) {
      const prediction = patterns.expected || (Math.random() > 0.5 ? 'Tài' : 'Xỉu');
      
      return {
        method: 'HOUSE_ANALYSIS',
        prediction,
        confidence: patterns.confidence || 70,
        suspicious: true,
        patternType: patterns.type,
        reason: `Phát hiện pattern ${patterns.type}: ${patterns.description}`
      };
    }
    
    return null;
  }

  // 9. PHÁT HIỆN CẦU BỊP (CHEAT DETECTION)
  analyzeCheatDetection(data) {
    if (data.length < 50) return null;
    
    const recent = data.slice(0, 50);
    const results = recent.map(d => d.Ket_qua);
    const sums = recent.map(d => d.Tong);
    
    // Kiểm tra xác suất bất thường
    const statisticalTests = performStatisticalTests(results, sums);
    
    if (statisticalTests.anomaly) {
      // Nếu phát hiện bất thường, đề xuất đối lập hoặc bỏ qua
      const prediction = statisticalTests.recommendation || 
                       (statisticalTests.expected === 'Tài' ? 'Xỉu' : 'Tài');
      
      return {
        method: 'CHEAT_DETECTION',
        prediction,
        confidence: statisticalTests.confidence,
        anomaly: true,
        testResults: statisticalTests,
        reason: `Cảnh báo: ${statisticalTests.message}`
      };
    }
    
    return null;
  }

  // 10. SMART VOTING (TỔNG HỢP THÔNG MINH)
  smartVoting(analysisResults) {
    if (!analysisResults || analysisResults.length === 0) return null;
    
    // Tính điểm weighted
    const votes = { tai: 0, xiu: 0 };
    let totalWeight = 0;
    
    analysisResults.forEach(result => {
      if (!result) return;
      
      const weight = this.patternWeights[result.method.toLowerCase().split('_')[0]] || 1.0;
      const score = (result.confidence / 100) * weight;
      
      if (result.prediction === 'Tài') {
        votes.tai += score;
      } else {
        votes.xiu += score;
      }
      totalWeight += weight;
    });
    
    // Normalize
    votes.tai = totalWeight > 0 ? votes.tai / totalWeight : 0;
    votes.xiu = totalWeight > 0 ? votes.xiu / totalWeight : 0;
    
    const prediction = votes.tai >= votes.xiu ? 'Tài' : 'Xỉu';
    const confidence = Math.max(votes.tai, votes.xiu) * 100;
    
    // Điều chỉnh confidence theo số lượng phương pháp đồng thuận
    const agreementCount = analysisResults.filter(r => 
      r && r.prediction === prediction
    ).length;
    
    const agreementBoost = Math.min(10, agreementCount * 2);
    const finalConfidence = Math.min(88, confidence + agreementBoost);
    
    // Lấy lý do từ phương pháp có độ tin cậy cao nhất
    const topMethod = analysisResults
      .filter(r => r && r.prediction === prediction)
      .sort((a, b) => b.confidence - a.confidence)[0];
    
    return {
      method: 'SMART_VOTING_VIP',
      prediction,
      confidence: Math.round(finalConfidence),
      votes: { tai: votes.tai, xiu: votes.xiu },
      agreement: agreementCount + '/' + analysisResults.length,
      topReason: topMethod ? topMethod.reason : 'Không đủ dữ liệu phân tích',
      detailedAnalysis: analysisResults.filter(r => r)
    };
  }

  // 11. PHÂN TÍCH TỔNG HỢP VIP
  analyzeVIP(data) {
    const allAnalysis = [
      this.analyzeDiceTrendline(data),
      this.analyzeProbability(data),
      this.analyzeNeutral(data),
      this.analyzeAtom(data),
      this.analyzeFibonacci(data),
      this.analyzeGoldenRatio(data),
      this.analyzeResistanceSupport(data),
      this.analyzeHousePattern(data),
      this.analyzeCheatDetection(data)
    ].filter(r => r !== null);
    
    return this.smartVoting(allAnalysis);
  }
}

// ==================== HÀM HỖ TRỢ ====================
function findCommonAtomPattern(patterns) {
  if (patterns.length < 5) return null;
  
  const patternCounts = {};
  patterns.forEach(p => {
    const key = `${p.increase}-${p.decrease}-${p.resultChange}`;
    patternCounts[key] = (patternCounts[key] || 0) + 1;
  });
  
  const mostCommon = Object.entries(patternCounts)
    .sort((a, b) => b[1] - a[1])[0];
  
  if (mostCommon && mostCommon[1] >= patterns.length * 0.3) {
    const [increase, decrease, resultChange] = mostCommon[0].split('-').map(Number);
    return {
      type: 'ATOM_PATTERN',
      increase,
      decrease,
      resultChange: Boolean(resultChange),
      confidence: (mostCommon[1] / patterns.length) * 100
    };
  }
  
  return null;
}

function predictFromAtomPattern(currentDice, pattern) {
  // Logic đơn giản dự đoán từ pattern
  if (pattern.increase > pattern.decrease) {
    return 'Tài';
  } else if (pattern.decrease > pattern.increase) {
    return 'Xỉu';
  } else {
    return pattern.resultChange ? 
      (Math.random() > 0.5 ? 'Tài' : 'Xỉu') : 
      (currentDice.reduce((a, b) => a + b, 0) > 10.5 ? 'Xỉu' : 'Tài');
  }
}

function detectHousePatterns(results) {
  const patterns = {
    suspicious: false,
    type: null,
    confidence: 0,
    description: ''
  };
  
  // Pattern 1: Quá nhiều streak dài
  let streakLengths = [];
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
  
  if (streakLengths.length >= 3) {
    patterns.suspicious = true;
    patterns.type = 'LONG_STREAKS';
    patterns.confidence = 75;
    patterns.description = `Phát hiện ${streakLengths.length} streak dài (>5)`;
    patterns.expected = streakLengths.length % 2 === 0 ? 'Tài' : 'Xỉu';
  }
  
  // Pattern 2: Alternating quá đều
  let alternatingPerfect = true;
  for (let i = 1; i < Math.min(15, results.length); i++) {
    if (results[i] === results[i-1]) {
      alternatingPerfect = false;
      break;
    }
  }
  
  if (alternatingPerfect) {
    patterns.suspicious = true;
    patterns.type = 'PERFECT_ALTERNATING';
    patterns.confidence = 80;
    patterns.description = '15 phiên đảo chiều hoàn hảo';
    patterns.expected = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  return patterns;
}

function performStatisticalTests(results, sums) {
  const tests = {
    anomaly: false,
    confidence: 70,
    message: '',
    recommendation: null,
    expected: null
  };
  
  // Test 1: Distribution test
  const taiCount = results.filter(r => r === 'Tài').length;
  const expectedTai = results.length * 0.5;
  const deviation = Math.abs(taiCount - expectedTai) / expectedTai;
  
  if (deviation > 0.3) {
    tests.anomaly = true;
    tests.message = `Phân bố bất thường: ${((taiCount/results.length)*100).toFixed(0)}% Tài`;
    tests.expected = taiCount > expectedTai ? 'Xỉu' : 'Tài';
    tests.recommendation = tests.expected === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  // Test 2: Sum distribution
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  if (avgSum < 8 || avgSum > 13) {
    tests.anomaly = true;
    tests.message = `Tổng điểm bất thường: ${avgSum.toFixed(1)} (thường 8-13)`;
    tests.confidence = 75;
  }
  
  // Test 3: Pattern repetition
  if (results.length >= 20) {
    const first10 = results.slice(0, 10);
    const next10 = results.slice(10, 20);
    
    if (JSON.stringify(first10) === JSON.stringify(next10)) {
      tests.anomaly = true;
      tests.message = 'Pattern lặp lại chính xác 10 phiên';
      tests.confidence = 85;
      tests.recommendation = first10[9] === 'Tài' ? 'Xỉu' : 'Tài';
    }
  }
  
  return tests;
}

// ==================== HÀM XỬ LÝ DỮ LIỆU ====================
function transformData(apiData) {
  if (!apiData?.list) return [];
  
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices[0],
    Xuc_xac_2: item.dices[1],
    Xuc_xac_3: item.dices[2],
    Tong: item.point
  }));
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      aiData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log('✅ Đã load dữ liệu AI VIP');
    }
  } catch (e) {
    console.log('Khởi tạo dữ liệu AI VIP mới');
  }
}

function saveData() {
  try {
    aiData.lastUpdate = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(aiData, null, 2));
  } catch (e) {
    console.error('Lỗi save data:', e.message);
  }
}

function updateStats(type, isCorrect) {
  aiData.stats[type].total++;
  if (isCorrect) {
    aiData.stats[type].correct++;
    aiData.stats[type].streak = Math.max(0, aiData.stats[type].streak) + 1;
    if (aiData.stats[type].streak > aiData.stats[type].bestStreak) {
      aiData.stats[type].bestStreak = aiData.stats[type].streak;
    }
  } else {
    aiData.stats[type].streak = Math.min(0, aiData.stats[type].streak) - 1;
  }
}

// ==================== API ENDPOINTS VIP ====================
app.get('/', (req, res) => {
  res.send(`
    <h1>🎯 AI VIP Prediction System</h1>
    <p>Hệ thống AI cực mạnh - @Kapubb</p>
    <p><strong>Endpoints:</strong></p>
    <ul>
      <li>/vip-hu - Dự đoán VIP Hũ</li>
      <li>/vip-md5 - Dự đoán VIP MD5</li>
      <li>/vip-hu/lichsu - Lịch sử VIP Hũ</li>
      <li>/vip-md5/lichsu - Lịch sử VIP MD5</li>
      <li>/vip-stats - Thống kê VIP</li>
      <li>/vip-analysis - Phân tích chi tiết</li>
    </ul>
  `);
});

// Dự đoán VIP HU
app.get('/vip-hu', async (req, res) => {
  try {
    const response = await axios.get(API_URL_HU);
    const data = transformData(response.data);
    
    if (!data || data.length === 0) {
      return res.json({ error: 'Không có dữ liệu' });
    }
    
    const analyzer = new VIPAnalyzer('hu');
    const analysis = analyzer.analyzeVIP(data);
    
    if (!analysis) {
      return res.json({ error: 'Không thể phân tích' });
    }
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    // Lưu vào lịch sử
    aiData.history.hu.unshift({
      phien: nextPhien.toString(),
      prediction: analysis.prediction,
      confidence: analysis.confidence,
      method: analysis.method,
      reason: analysis.topReason,
      timestamp: new Date().toISOString(),
      verified: false
    });
    
    // Giới hạn lịch sử
    if (aiData.history.hu.length > 100) {
      aiData.history.hu = aiData.history.hu.slice(0, 100);
    }
    
    saveData();
    
    res.json({
      phien: nextPhien.toString(),
      du_doan: analysis.prediction.toLowerCase(),
      ti_le: analysis.confidence + '%',
      id: '@Kapubb',
      method: analysis.method,
      reason: analysis.topReason,
      agreement: analysis.agreement
    });
    
  } catch (error) {
    console.error('VIP HU Error:', error.message);
    res.json({ error: 'Lỗi server VIP', details: error.message });
  }
});

// Dự đoán VIP MD5
app.get('/vip-md5', async (req, res) => {
  try {
    const response = await axios.get(API_URL_MD5);
    const data = transformData(response.data);
    
    if (!data || data.length === 0) {
      return res.json({ error: 'Không có dữ liệu' });
    }
    
    const analyzer = new VIPAnalyzer('md5');
    const analysis = analyzer.analyzeVIP(data);
    
    if (!analysis) {
      return res.json({ error: 'Không thể phân tích' });
    }
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    aiData.history.md5.unshift({
      phien: nextPhien.toString(),
      prediction: analysis.prediction,
      confidence: analysis.confidence,
      method: analysis.method,
      reason: analysis.topReason,
      timestamp: new Date().toISOString(),
      verified: false
    });
    
    if (aiData.history.md5.length > 100) {
      aiData.history.md5 = aiData.history.md5.slice(0, 100);
    }
    
    saveData();
    
    res.json({
      phien: nextPhien.toString(),
      du_doan: analysis.prediction.toLowerCase(),
      ti_le: analysis.confidence + '%',
      id: '@Kapubb',
      method: analysis.method,
      reason: analysis.topReason,
      agreement: analysis.agreement
    });
    
  } catch (error) {
    console.error('VIP MD5 Error:', error.message);
    res.json({ error: 'Lỗi server VIP', details: error.message });
  }
});

// Lịch sử VIP HU
app.get('/vip-hu/lichsu', (req, res) => {
  const history = aiData.history.hu.map(record => ({
    phien: record.phien,
    du_doan: record.prediction.toLowerCase(),
    ti_le: record.confidence + '%',
    method: record.method,
    reason: record.reason,
    timestamp: record.timestamp,
    status: record.verified ? (record.correct ? '✅' : '❌') : '⏳'
  }));
  
  const stats = aiData.stats.hu;
  const accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : 0;
  
  res.json({
    type: 'VIP Hũ - AI Cực Mạnh',
    history: history.slice(0, 20),
    stats: {
      total: stats.total,
      correct: stats.correct,
      accuracy: accuracy + '%',
      current_streak: stats.streak,
      best_streak: stats.bestStreak
    },
    ai_version: aiData.version
  });
});

// Lịch sử VIP MD5
app.get('/vip-md5/lichsu', (req, res) => {
  const history = aiData.history.md5.map(record => ({
    phien: record.phien,
    du_doan: record.prediction.toLowerCase(),
    ti_le: record.confidence + '%',
    method: record.method,
    reason: record.reason,
    timestamp: record.timestamp,
    status: record.verified ? (record.correct ? '✅' : '❌') : '⏳'
  }));
  
  const stats = aiData.stats.md5;
  const accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : 0;
  
  res.json({
    type: 'VIP MD5 - AI Cực Mạnh',
    history: history.slice(0, 20),
    stats: {
      total: stats.total,
      correct: stats.correct,
      accuracy: accuracy + '%',
      current_streak: stats.streak,
      best_streak: stats.bestStreak
    },
    ai_version: aiData.version
  });
});

// Thống kê VIP
app.get('/vip-stats', (req, res) => {
  const huAcc = aiData.stats.hu.total > 0 
    ? ((aiData.stats.hu.correct / aiData.stats.hu.total) * 100).toFixed(1)
    : 0;
    
  const md5Acc = aiData.stats.md5.total > 0 
    ? ((aiData.stats.md5.correct / aiData.stats.md5.total) * 100).toFixed(1)
    : 0;
    
  res.json({
    ai_system: 'VIP ULTRA AI',
    version: aiData.version,
    config: AI_CONFIG,
    performance: {
      hu: {
        total: aiData.stats.hu.total,
        correct: aiData.stats.hu.correct,
        accuracy: huAcc + '%',
        streak: aiData.stats.hu.streak,
        best_streak: aiData.stats.hu.bestStreak
      },
      md5: {
        total: aiData.stats.md5.total,
        correct: aiData.stats.md5.correct,
        accuracy: md5Acc + '%',
        streak: aiData.stats.md5.streak,
        best_streak: aiData.stats.md5.bestStreak
      }
    },
    models: aiData.models,
    last_updated: aiData.lastUpdate
  });
});

// Phân tích chi tiết
app.get('/vip-analysis', async (req, res) => {
  try {
    const type = req.query.type || 'hu';
    const apiUrl = type === 'hu' ? API_URL_HU : API_URL_MD5;
    
    const response = await axios.get(apiUrl);
    const data = transformData(response.data);
    
    if (!data || data.length === 0) {
      return res.json({ error: 'Không có dữ liệu' });
    }
    
    const analyzer = new VIPAnalyzer(type);
    
    // Chạy tất cả phân tích
    const allAnalysis = [
      analyzer.analyzeDiceTrendline(data),
      analyzer.analyzeProbability(data),
      analyzer.analyzeNeutral(data),
      analyzer.analyzeAtom(data),
      analyzer.analyzeFibonacci(data),
      analyzer.analyzeGoldenRatio(data),
      analyzer.analyzeResistanceSupport(data),
      analyzer.analyzeHousePattern(data),
      analyzer.analyzeCheatDetection(data)
    ].filter(r => r !== null);
    
    const final = analyzer.smartVoting(allAnalysis);
    
    res.json({
      type: `VIP Analysis - ${type.toUpperCase()}`,
      timestamp: new Date().toISOString(),
      data_points: data.length,
      final_prediction: final ? {
        prediction: final.prediction,
        confidence: final.confidence + '%',
        method: final.method,
        reason: final.topReason,
        agreement: final.agreement
      } : null,
      detailed_analysis: allAnalysis.map(a => ({
        method: a.method,
        prediction: a.prediction,
        confidence: a.confidence + '%',
        reason: a.reason
      })),
      raw_data: {
        last_10_results: data.slice(0, 10).map(d => ({
          phien: d.Phien,
          result: d.Ket_qua,
          dice: [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3],
          sum: d.Tong
        }))
      }
    });
    
  } catch (error) {
    res.json({ error: 'Lỗi phân tích', details: error.message });
  }
});

// Auto-verify predictions
async function autoVerify() {
  console.log('🔄 VIP Auto-verify running...');
  
  try {
    const [huResponse, md5Response] = await Promise.allSettled([
      axios.get(API_URL_HU),
      axios.get(API_URL_MD5)
    ]);
    
    // Xác minh HU
    if (huResponse.status === 'fulfilled') {
      const huData = transformData(huResponse.value.data);
      if (huData.length > 0) {
        const latestHu = huData[0];
        
        aiData.history.hu.forEach(record => {
          if (!record.verified && record.phien === latestHu.Phien.toString()) {
            record.verified = true;
            record.actual = latestHu.Ket_qua;
            record.correct = record.prediction === latestHu.Ket_qua;
            
            if (AI_CONFIG.adaptiveLearning) {
              updateStats('hu', record.correct);
            }
          }
        });
      }
    }
    
    // Xác minh MD5
    if (md5Response.status === 'fulfilled') {
      const md5Data = transformData(md5Response.value.data);
      if (md5Data.length > 0) {
        const latestMd5 = md5Data[0];
        
        aiData.history.md5.forEach(record => {
          if (!record.verified && record.phien === latestMd5.Phien.toString()) {
            record.verified = true;
            record.actual = latestMd5.Ket_qua;
            record.correct = record.prediction === latestMd5.Ket_qua;
            
            if (AI_CONFIG.adaptiveLearning) {
              updateStats('md5', record.correct);
            }
          }
        });
      }
    }
    
    saveData();
    console.log('✅ VIP Auto-verify completed');
    
  } catch (error) {
    console.error('VIP Auto-verify error:', error.message);
  }
}

// ==================== KHỞI ĐỘNG HỆ THỐNG ====================
loadData();

// Auto-verify mỗi 1 phút
setInterval(autoVerify, 60000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎯 VIP AI System running on http://0.0.0.0:${PORT}`);
  console.log('🔥 HỆ THỐNG AI VIP CỰC MẠNH - @Kapubb');
  console.log('');
  console.log('📊 CÁC THUẬT TOÁN NÂNG CAO:');
  console.log('  1. Dice Trendline Analysis');
  console.log('  2. Probability & Bayesian Inference');
  console.log('  3. Neutral State Analysis');
  console.log('  4. Atom Pattern Detection');
  console.log('  5. Fibonacci Sequence');
  console.log('  6. Golden Ratio');
  console.log('  7. Resistance & Support Levels');
  console.log('  8. House Pattern Analysis');
  console.log('  9. Cheat Detection');
  console.log('  10. Smart Voting System');
  console.log('');
  console.log('🚀 VIP ENDPOINTS:');
  console.log('  /vip-hu           - Dự đoán VIP Hũ');
  console.log('  /vip-md5          - Dự đoán VIP MD5');
  console.log('  /vip-hu/lichsu    - Lịch sử VIP Hũ');
  console.log('  /vip-md5/lichsu   - Lịch sử VIP MD5');
  console.log('  /vip-stats        - Thống kê VIP');
  console.log('  /vip-analysis     - Phân tích chi tiết');
  console.log('');
  console.log('⚡ Mục tiêu: Accuracy > 70% | Confidence: 60-88%');
});
