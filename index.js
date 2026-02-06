const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'learning_data.json';
const HISTORY_FILE = 'history.json';

// ==================== CẤU TRÚC DỮ LIỆU ĐƠN GIẢN ====================
let history = {
  hu: [],
  md5: [],
  lastProcessed: { hu: null, md5: null },
  stats: { hu: { total: 0, correct: 0 }, md5: { total: 0, correct: 0 } }
};

let learning = {
  hu: { patterns: {}, recent: [] },
  md5: { patterns: {}, recent: [] }
};

// Pattern weights cơ bản
const PATTERN_WEIGHTS = {
  'cau_bet': 1.2,
  'cau_dao': 1.1,
  'cau_22': 1.1,
  'cau_33': 1.1,
  'cau_44': 1.2,
  'cau_121': 1.1,
  'cau_nhip_nghieng': 1.1,
  'cau_3van1': 1.1,
  'tong_cao': 1.1,
  'tong_thap': 1.1,
  'theo_trend': 1.0
};

// ==================== HÀM CƠ BẢN ====================
function loadData() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
    if (fs.existsSync(LEARNING_FILE)) {
      learning = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
    }
    console.log('✅ Đã load dữ liệu');
  } catch (e) {
    console.log('Khởi tạo dữ liệu mới');
  }
}

function saveData() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learning, null, 2));
  } catch (e) {
    console.error('Lỗi save:', e.message);
  }
}

// ==================== PHÂN TÍCH PATTERN ĐƠN GIẢN ====================
function analyzeSimple(data, type) {
  const results = data.slice(0, 20).map(d => d.Ket_qua);
  const sums = data.slice(0, 10).map(d => d.Tong);
  
  let predictions = [];
  
  // 1. Cầu bệt
  const streak = checkStreak(results);
  if (streak.length >= 3) {
    const shouldBreak = streak.length >= 5;
    predictions.push({
      type: 'Cầu bệt ' + streak.length,
      prediction: shouldBreak ? (streak.type === 'Tài' ? 'Xỉu' : 'Tài') : streak.type,
      confidence: Math.min(15, streak.length * 3),
      weight: PATTERN_WEIGHTS.cau_bet
    });
  }
  
  // 2. Cầu đảo 1-1
  if (results.length >= 4) {
    let alternating = 1;
    for (let i = 1; i < Math.min(results.length, 8); i++) {
      if (results[i] !== results[i-1]) alternating++;
      else break;
    }
    if (alternating >= 4) {
      predictions.push({
        type: 'Cầu đảo ' + alternating,
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.min(12, alternating * 2),
        weight: PATTERN_WEIGHTS.cau_dao
      });
    }
  }
  
  // 3. Cầu 2-2
  if (results.length >= 6) {
    let pairs = 0;
    for (let i = 0; i < results.length - 1; i += 2) {
      if (results[i] === results[i+1]) pairs++;
      else break;
    }
    if (pairs >= 2) {
      predictions.push({
        type: 'Cầu 2-2 (' + pairs + ' cặp)',
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.min(13, pairs * 3),
        weight: PATTERN_WEIGHTS.cau_22
      });
    }
  }
  
  // 4. Phân tích tổng
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  if (avgSum > 11) {
    predictions.push({
      type: 'Tổng cao (' + avgSum.toFixed(1) + ')',
      prediction: 'Xỉu',
      confidence: 8,
      weight: PATTERN_WEIGHTS.tong_cao
    });
  } else if (avgSum < 10) {
    predictions.push({
      type: 'Tổng thấp (' + avgSum.toFixed(1) + ')',
      prediction: 'Tài',
      confidence: 8,
      weight: PATTERN_WEIGHTS.tong_thap
    });
  }
  
  // 5. Trend đơn giản
  const taiCount = results.filter(r => r === 'Tài').length;
  if (taiCount >= results.length * 0.7) {
    predictions.push({
      type: 'Trend Tài mạnh',
      prediction: 'Xỉu',
      confidence: 9,
      weight: 1.1
    });
  } else if (taiCount <= results.length * 0.3) {
    predictions.push({
      type: 'Trend Xỉu mạnh',
      prediction: 'Tài',
      confidence: 9,
      weight: 1.1
    });
  }
  
  return predictions;
}

function checkStreak(results) {
  if (results.length === 0) return { type: null, length: 0 };
  let length = 1;
  const first = results[0];
  for (let i = 1; i < results.length; i++) {
    if (results[i] === first) length++;
    else break;
  }
  return { type: first, length };
}

// ==================== TÍNH DỰ ĐOÁN ====================
function calculatePrediction(data, type) {
  const predictions = analyzeSimple(data, type);
  
  if (predictions.length === 0) {
    return {
      prediction: data[0].Ket_qua, // Theo ván trước
      confidence: 55,
      factors: ['Cầu tự nhiên']
    };
  }
  
  // Tính điểm
  let taiScore = 0;
  let xiuScore = 0;
  
  predictions.forEach(p => {
    const score = p.confidence * p.weight;
    if (p.prediction === 'Tài') taiScore += score;
    else xiuScore += score;
  });
  
  const finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  const winRate = history.stats[type].total > 0 
    ? (history.stats[type].correct / history.stats[type].total) 
    : 0.5;
  
  // Độ tin cậy cơ bản
  let confidence = 50 + Math.abs(taiScore - xiuScore) / 2;
  
  // Điều chỉnh theo win rate
  if (winRate > 0.6) confidence += 5;
  if (winRate < 0.4) confidence -= 5;
  
  // Giới hạn 50-80%
  confidence = Math.max(50, Math.min(80, Math.round(confidence)));
  
  return {
    prediction: finalPrediction,
    confidence: confidence,
    factors: predictions.map(p => p.type)
  };
}

// ==================== XÁC MINH DỰ ĐOÁN ====================
async function verifyPredictions(type, currentData) {
  const latestPhien = currentData[0]?.Phien;
  if (!latestPhien) return;
  
  // Kiểm tra các dự đoán chưa verify
  history[type].forEach(record => {
    if (record.verified || !record.phien) return;
    
    const actualResult = currentData.find(d => d.Phien.toString() === record.phien);
    if (actualResult) {
      record.verified = true;
      record.actual = actualResult.Ket_qua;
      record.correct = record.prediction === actualResult.Ket_qua;
      
      // Cập nhật stats
      history.stats[type].total++;
      if (record.correct) history.stats[type].correct++;
    }
  });
  
  // Giữ lịch sử tối đa 100 bản ghi
  if (history[type].length > 100) {
    history[type] = history[type].slice(0, 100);
  }
}

// ==================== API ENDPOINTS ====================
app.get('/', (req, res) => {
  res.send('Lẩu Cua 79 API - @Kapubb');
});

// Dự đoán HU
app.get('/lc79-hu', async (req, res) => {
  try {
    const response = await axios.get(API_URL_HU);
    const data = transformData(response.data);
    
    if (!data || data.length === 0) {
      return res.json({ error: 'Không có dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    
    const latest = data[0];
    const nextPhien = latest.Phien + 1;
    
    // Kiểm tra đã xử lý phiên này chưa
    if (history.lastProcessed.hu === nextPhien) {
      const lastPred = history.hu.find(h => h.phien === nextPhien.toString());
      if (lastPred) {
        return res.json({
          phien: nextPhien.toString(),
          du_doan: lastPred.prediction,
          ti_le: lastPred.confidence + '%',
          id: '@Kapubb'
        });
      }
    }
    
    const result = calculatePrediction(data, 'hu');
    
    // Lưu vào lịch sử
    history.hu.unshift({
      phien: nextPhien.toString(),
      prediction: result.prediction,
      confidence: result.confidence,
      factors: result.factors,
      timestamp: new Date().toISOString(),
      verified: false
    });
    
    history.lastProcessed.hu = nextPhien;
    saveData();
    
    res.json({
      phien: nextPhien.toString(),
      du_doan: result.prediction.toLowerCase(),
      ti_le: result.confidence + '%',
      id: '@Kapubb'
    });
    
  } catch (error) {
    res.json({ error: 'Lỗi server', details: error.message });
  }
});

// Dự đoán MD5
app.get('/lc79-md5', async (req, res) => {
  try {
    const response = await axios.get(API_URL_MD5);
    const data = transformData(response.data);
    
    if (!data || data.length === 0) {
      return res.json({ error: 'Không có dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    
    const latest = data[0];
    const nextPhien = latest.Phien + 1;
    
    if (history.lastProcessed.md5 === nextPhien) {
      const lastPred = history.md5.find(h => h.phien === nextPhien.toString());
      if (lastPred) {
        return res.json({
          phien: nextPhien.toString(),
          du_doan: lastPred.prediction,
          ti_le: lastPred.confidence + '%',
          id: '@Kapubb'
        });
      }
    }
    
    const result = calculatePrediction(data, 'md5');
    
    history.md5.unshift({
      phien: nextPhien.toString(),
      prediction: result.prediction,
      confidence: result.confidence,
      factors: result.factors,
      timestamp: new Date().toISOString(),
      verified: false
    });
    
    history.lastProcessed.md5 = nextPhien;
    saveData();
    
    res.json({
      phien: nextPhien.toString(),
      du_doan: result.prediction.toLowerCase(),
      ti_le: result.confidence + '%',
      id: '@Kapubb'
    });
    
  } catch (error) {
    res.json({ error: 'Lỗi server', details: error.message });
  }
});

// Lịch sử HU
app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    const response = await axios.get(API_URL_HU);
    const data = transformData(response.data);
    await verifyPredictions('hu', data);
    
    const historyWithStatus = history.hu.map(record => ({
      phien: record.phien,
      du_doan: record.prediction.toLowerCase(),
      ti_le: record.confidence + '%',
      ket_qua_thuc_te: record.actual ? record.actual.toLowerCase() : null,
      status: record.verified ? (record.correct ? '✅' : '❌') : '⏳',
      timestamp: record.timestamp
    }));
    
    const accuracy = history.stats.hu.total > 0 
      ? ((history.stats.hu.correct / history.stats.hu.total) * 100).toFixed(1)
      : 0;
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: historyWithStatus.slice(0, 20), // Chỉ 20 bản ghi gần nhất
      stats: {
        total: history.stats.hu.total,
        correct: history.stats.hu.correct,
        accuracy: accuracy + '%'
      }
    });
    
  } catch (error) {
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: history.hu.slice(0, 20).map(h => ({
        phien: h.phien,
        du_doan: h.prediction.toLowerCase(),
        ti_le: h.confidence + '%',
        status: h.verified ? (h.correct ? '✅' : '❌') : '⏳'
      })),
      stats: history.stats.hu
    });
  }
});

// Lịch sử MD5
app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    const response = await axios.get(API_URL_MD5);
    const data = transformData(response.data);
    await verifyPredictions('md5', data);
    
    const historyWithStatus = history.md5.map(record => ({
      phien: record.phien,
      du_doan: record.prediction.toLowerCase(),
      ti_le: record.confidence + '%',
      ket_qua_thuc_te: record.actual ? record.actual.toLowerCase() : null,
      status: record.verified ? (record.correct ? '✅' : '❌') : '⏳',
      timestamp: record.timestamp
    }));
    
    const accuracy = history.stats.md5.total > 0 
      ? ((history.stats.md5.correct / history.stats.md5.total) * 100).toFixed(1)
      : 0;
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: historyWithStatus.slice(0, 20),
      stats: {
        total: history.stats.md5.total,
        correct: history.stats.md5.correct,
        accuracy: accuracy + '%'
      }
    });
    
  } catch (error) {
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: history.md5.slice(0, 20).map(h => ({
        phien: h.phien,
        du_doan: h.prediction.toLowerCase(),
        ti_le: h.confidence + '%',
        status: h.verified ? (h.correct ? '✅' : '❌') : '⏳'
      })),
      stats: history.stats.md5
    });
  }
});

// Thống kê
app.get('/stats', (req, res) => {
  const huAcc = history.stats.hu.total > 0 
    ? ((history.stats.hu.correct / history.stats.hu.total) * 100).toFixed(1)
    : 0;
    
  const md5Acc = history.stats.md5.total > 0 
    ? ((history.stats.md5.correct / history.stats.md5.total) * 100).toFixed(1)
    : 0;
    
  res.json({
    hu: {
      total_predictions: history.stats.hu.total,
      correct: history.stats.hu.correct,
      accuracy: huAcc + '%',
      recent: history.hu.length
    },
    md5: {
      total_predictions: history.stats.md5.total,
      correct: history.stats.md5.correct,
      accuracy: md5Acc + '%',
      recent: history.md5.length
    },
    last_updated: new Date().toISOString()
  });
});

// Reset dữ liệu (debug)
app.get('/reset', (req, res) => {
  history = {
    hu: [],
    md5: [],
    lastProcessed: { hu: null, md5: null },
    stats: { hu: { total: 0, correct: 0 }, md5: { total: 0, correct: 0 } }
  };
  saveData();
  res.json({ message: 'Đã reset dữ liệu' });
});

// ==================== HÀM HỖ TRỢ ====================
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

// ==================== TỰ ĐỘNG XÁC MINH ====================
async function autoVerify() {
  console.log('🔄 Auto-verify predictions...');
  try {
    const [huData, md5Data] = await Promise.all([
      axios.get(API_URL_HU).then(r => transformData(r.data)).catch(() => []),
      axios.get(API_URL_MD5).then(r => transformData(r.data)).catch(() => [])
    ]);
    
    if (huData.length > 0) await verifyPredictions('hu', huData);
    if (md5Data.length > 0) await verifyPredictions('md5', md5Data);
    
    saveData();
  } catch (error) {
    console.error('Auto-verify error:', error.message);
  }
}

// ==================== KHỞI ĐỘNG ====================
loadData();

// Auto-verify mỗi 30 giây
setInterval(autoVerify, 30000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server chạy tại http://0.0.0.0:${PORT}`);
  console.log('🎯 Lẩu Cua 79 - Tài Xỉu Prediction');
  console.log('📊 ID: @Kapubb');
  console.log('');
  console.log('📌 Endpoints:');
  console.log('  /lc79-hu          - Dự đoán Tài Xỉu Hũ');
  console.log('  /lc79-md5         - Dự đoán Tài Xỉu MD5');
  console.log('  /lc79-hu/lichsu   - Lịch sử dự đoán Hũ');
  console.log('  /lc79-md5/lichsu  - Lịch sử dự đoán MD5');
  console.log('  /stats            - Thống kê độ chính xác');
  console.log('');
  console.log('⚡ Tối ưu cho DeepSeek - Nhẹ nhàng & Hiệu quả');
});
