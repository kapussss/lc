const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;

console.log('🚀 LC79 API - KHỞI ĐỘNG...');

// ==================== CHỈ LC79 ====================
const GAMES = {
    lc79_tx: { name: 'LC79 Tài Xỉu', url: 'https://chance-compete-chambers-feelings.trycloudflare.com/api/tx', type: 'taixiu', icon: '🎲' },
    lc79_md5: { name: 'LC79 MD5', url: 'https://chance-compete-chambers-feelings.trycloudflare.com/api/txmd5', type: 'taixiu', icon: '🔐' }
};

// AI học từ lịch sử
let aiModel = {
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    accuracyHistory: []
};

let predictionsDB = {};
for (const key of Object.keys(GAMES)) predictionsDB[key] = [];

// ==================== LẤY DỮ LIỆU ====================
async function fetchGameData(gameKey) {
    const game = GAMES[gameKey];
    if (!game) return null;
    try {
        const res = await axios.get(game.url, { timeout: 8000 });
        if (res.data && res.data.ket_qua) {
            let ketQua = (res.data.ket_qua === 'Tài' || res.data.ket_qua === 'TAI') ? 'Tài' : 'Xỉu';
            return { phien: res.data.phien, ket_qua: ketQua, tong: res.data.tong || 0 };
        }
        return null;
    } catch(e) { return null; }
}

// ==================== 80+ CẦU TÀI XỈU ====================
function phatHienCauTaiXiu(res, len, sums) {
    // Bệt 2-15
    for (let l = 2; l <= 15; l++) {
        if (len < l) continue;
        let ok = true;
        for (let i = 1; i < l; i++) if (res[i] !== res[0]) { ok = false; break; }
        if (ok) {
            let conf = Math.min(95, 48 + l * 3);
            let weight = aiModel.patternStats[`Bệt_${l}`]?.accuracy || 1;
            return { pred: res[0], conf: Math.floor(conf * weight), name: `🔴 Bệt ${l} phiên` };
        }
    }
    
    // Đảo 1-1 3-15
    for (let l = 3; l <= 15; l++) {
        if (len < l) continue;
        let ok = true;
        for (let i = 1; i < l; i++) if (res[i] === res[i-1]) { ok = false; break; }
        if (ok) {
            let pred = res[l-1] === 'Tài' ? 'Xỉu' : 'Tài';
            let conf = Math.min(92, 52 + l * 2);
            let weight = aiModel.patternStats[`Đảo_${l}`]?.accuracy || 1;
            return { pred: pred, conf: Math.floor(conf * weight), name: `🟡 Đảo 1-1 dài ${l} nhịp` };
        }
    }
    
    // Cầu 2-2
    if (len >= 4 && res[0] === res[1] && res[2] === res[3] && res[0] !== res[2]) {
        let pred = res[2] === 'Tài' ? 'Xỉu' : 'Tài';
        let weight = aiModel.patternStats['Cau22']?.accuracy || 1;
        return { pred: pred, conf: Math.floor(82 * weight), name: `🟢 Cầu 2-2` };
    }
    
    // Cầu 3-3
    if (len >= 6 && res[0]===res[1] && res[1]===res[2] && res[3]===res[4] && res[4]===res[5] && res[0]!==res[3]) {
        let pred = res[3] === 'Tài' ? 'Xỉu' : 'Tài';
        let weight = aiModel.patternStats['Cau33']?.accuracy || 1;
        return { pred: pred, conf: Math.floor(85 * weight), name: `🟣 Cầu 3-3` };
    }
    
    // Cầu 1-2-1
    if (len >= 4 && res[0] !== res[1] && res[1] === res[2] && res[2] !== res[3] && res[0] === res[3]) {
        let weight = aiModel.patternStats['Cau121']?.accuracy || 1;
        return { pred: res[0], conf: Math.floor(86 * weight), name: `🎯 Cầu 1-2-1` };
    }
    
    // Cầu 2-1-2
    if (len >= 5 && res[0] === res[1] && res[1] !== res[2] && res[2] === res[3] && res[3] !== res[4] && res[0] !== res[2]) {
        let pred = res[0] === 'Tài' ? 'Xỉu' : 'Tài';
        let weight = aiModel.patternStats['Cau212']?.accuracy || 1;
        return { pred: pred, conf: Math.floor(87 * weight), name: `🎯 Cầu 2-1-2` };
    }
    
    // Cầu 1-2-3
    if (len >= 6 && res[0]===res[1] && res[1]===res[2] && res[3]===res[4] && res[0]!==res[3] && res[3]!==res[5]) {
        let weight = aiModel.patternStats['Cau123']?.accuracy || 1;
        return { pred: res[5], conf: Math.floor(84 * weight), name: `📈 Cầu 1-2-3` };
    }
    
    // Cầu 3-2-1
    if (len >= 6 && res[0]===res[1] && res[2]===res[3] && res[3]===res[4] && res[0]!==res[2] && res[2]!==res[5]) {
        let weight = aiModel.patternStats['Cau321']?.accuracy || 1;
        return { pred: res[2], conf: Math.floor(84 * weight), name: `📉 Cầu 3-2-1` };
    }
    
    // Cầu 1-1-2-2
    if (len >= 4 && res[0] === res[1] && res[2] === res[3] && res[0] !== res[2]) {
        let pred = res[2] === 'Tài' ? 'Xỉu' : 'Tài';
        let weight = aiModel.patternStats['Cau1122']?.accuracy || 1;
        return { pred: pred, conf: Math.floor(82 * weight), name: `🔷 Cầu 1-1-2-2` };
    }
    
    // Cầu 2-2-1-1
    if (len >= 4 && res[0] !== res[1] && res[1] === res[2] && res[2] === res[3]) {
        let weight = aiModel.patternStats['Cau2211']?.accuracy || 1;
        return { pred: res[0], conf: Math.floor(82 * weight), name: `🔶 Cầu 2-2-1-1` };
    }
    
    // Nhảy cóc
    if (len >= 5 && res[0] === res[2] && res[2] === res[4]) {
        let weight = aiModel.patternStats['NhayCoc']?.accuracy || 1;
        return { pred: res[0], conf: Math.floor(78 * weight), name: `🐸 Nhảy cóc 3 bước` };
    }
    
    // Cầu gương
    if (len >= 4 && res[0] === res[3] && res[1] === res[2]) {
        let pred = res[1] === 'Tài' ? 'Xỉu' : 'Tài';
        let weight = aiModel.patternStats['Guong']?.accuracy || 1;
        return { pred: pred, conf: Math.floor(80 * weight), name: `🪞 Cầu gương 4 phiên` };
    }
    
    // Chu kỳ 2
    if (len >= 4 && res[0] === res[2] && res[1] === res[3]) {
        let next = res[len % 2];
        let weight = aiModel.patternStats['ChuKy2']?.accuracy || 1;
        return { pred: next === 'Tài' ? 'Tài' : 'Xỉu', conf: Math.floor(76 * weight), name: `🔄 Chu kỳ 2 phiên` };
    }
    
    // Ziczac
    let ziczacLen = 1;
    for (let i = 1; i < Math.min(len, 12); i++) {
        if (res[i] !== res[i-1]) ziczacLen++;
        else break;
    }
    if (ziczacLen >= 6) {
        let pred = res[ziczacLen-1] === 'Tài' ? 'Xỉu' : 'Tài';
        let weight = aiModel.patternStats['Ziczac']?.accuracy || 1;
        return { pred: pred, conf: Math.floor(74 * weight), name: `⚡ Ziczac ${ziczacLen} nhịp` };
    }
    
    // Tổng điểm
    if (sums && sums.length >= 5) {
        let avg5 = sums.slice(0,5).reduce((a,b)=>a+b,0)/5;
        if (avg5 >= 13.5) {
            let weight = aiModel.patternStats['TongCao']?.accuracy || 1;
            return { pred: 'Xỉu', conf: Math.floor(74 * weight), name: `📊 Tổng cao ${avg5.toFixed(1)}` };
        }
        if (avg5 <= 8.5) {
            let weight = aiModel.patternStats['TongThap']?.accuracy || 1;
            return { pred: 'Tài', conf: Math.floor(74 * weight), name: `📊 Tổng thấp ${avg5.toFixed(1)}` };
        }
    }
    
    // Cực điểm
    if (sums && sums.length >= 10) {
        let high15 = sums.slice(0,10).filter(s => s >= 15).length;
        let low6 = sums.slice(0,10).filter(s => s <= 6).length;
        if (high15 >= 4) {
            let weight = aiModel.patternStats['CucDiem']?.accuracy || 1;
            return { pred: 'Xỉu', conf: Math.floor(82 * weight), name: `⚡ Cực điểm cao ${high15}/10` };
        }
        if (low6 >= 4) {
            let weight = aiModel.patternStats['CucDiem']?.accuracy || 1;
            return { pred: 'Tài', conf: Math.floor(82 * weight), name: `⚡ Cực điểm thấp ${low6}/10` };
        }
    }
    
    // Nóng lạnh
    let last10 = res.slice(0, Math.min(10, len));
    let tai10 = last10.filter(r => r === 'Tài').length;
    if (tai10 >= 8) {
        let weight = aiModel.patternStats['Nong']?.accuracy || 1;
        return { pred: 'Xỉu', conf: Math.floor(86 * weight), name: `🔥 Tài nóng ${tai10}/10 → Xỉu` };
    }
    if (tai10 <= 2) {
        let weight = aiModel.patternStats['Lanh']?.accuracy || 1;
        return { pred: 'Tài', conf: Math.floor(86 * weight), name: `❄️ Xỉu nóng ${10-tai10}/10 → Tài` };
    }
    if (tai10 >= 7) {
        let weight = aiModel.patternStats['Nong']?.accuracy || 1;
        return { pred: 'Xỉu', conf: Math.floor(80 * weight), name: `🔥 Tài nóng ${tai10}/10 → Xỉu` };
    }
    if (tai10 <= 3) {
        let weight = aiModel.patternStats['Lanh']?.accuracy || 1;
        return { pred: 'Tài', conf: Math.floor(80 * weight), name: `❄️ Xỉu nóng ${10-tai10}/10 → Tài` };
    }
    
    // Chênh lệch
    if (len >= 20) {
        let last20 = res.slice(0, 20);
        let tai20 = last20.filter(r => r === 'Tài').length;
        let diff = Math.abs(tai20 - (20 - tai20));
        if (diff >= 8) {
            let pred = tai20 > 10 ? 'Xỉu' : 'Tài';
            let weight = aiModel.patternStats['ChenhLech']?.accuracy || 1;
            return { pred: pred, conf: Math.floor(74 * weight), name: `⚖️ Chênh ${tai20}/20 → ${pred}` };
        }
    }
    
    // Xu hướng 3 phiên cuối
    let last3 = res.slice(0, 3);
    let tai3 = last3.filter(r => r === 'Tài').length;
    let pred = tai3 >= 2 ? 'Tài' : 'Xỉu';
    let weight = aiModel.patternStats['XuHuong']?.accuracy || 1;
    return { pred: pred, conf: Math.floor(65 * weight), name: `📊 Xu hướng ${tai3}T-${3-tai3}X` };
}

// ==================== AI HỌC ====================
function aiHoc(actual, predicted, pattern) {
    if (!aiModel.patternStats[pattern]) {
        aiModel.patternStats[pattern] = { total: 0, correct: 0, accuracy: 0.7 };
    }
    let stats = aiModel.patternStats[pattern];
    stats.total++;
    if (actual === predicted) stats.correct++;
    stats.accuracy = stats.correct / stats.total;
    
    aiModel.totalPredictions++;
    if (actual === predicted) aiModel.correctPredictions++;
}

// ==================== DỰ ĐOÁN ====================
function duDoanTaiXiu(lichSu, ketQuaHienTai) {
    let res = lichSu.slice(0, 30).map(h => h.ket_qua_thuc_te).filter(r => r);
    if (res.length === 0 && ketQuaHienTai) res = [ketQuaHienTai];
    
    let sums = lichSu.slice(0, 30).map(h => h.tong).filter(t => t);
    
    let cau = phatHienCauTaiXiu(res, res.length, sums);
    if (!cau) cau = { pred: 'Tài', conf: 60, name: 'Mặc định' };
    
    return {
        du_doan: cau.pred,
        do_tin_cay: cau.conf + '%',
        ly_do: cau.name,
        conf_raw: cau.conf
    };
}

// ==================== API ====================
app.get('/api/predict/:game', async (req, res) => {
    const gameKey = req.params.game;
    const game = GAMES[gameKey];
    if (!game) return res.json({ error: 'Game không tồn tại', games: Object.keys(GAMES) });
    
    const currentData = await fetchGameData(gameKey);
    if (!currentData) return res.json({ error: 'Không lấy được dữ liệu', game: game.name });
    
    let lastPrediction = predictionsDB[gameKey]?.length > 0 ? predictionsDB[gameKey][0] : null;
    let ketQuaTruoc = currentData.ket_qua;
    let dungSaiTruoc = null;
    let phienTiepTheo = typeof currentData.phien === 'number' ? currentData.phien + 1 : (parseInt(currentData.phien) + 1).toString();
    
    if (lastPrediction && ketQuaTruoc && lastPrediction.loai_cau) {
        dungSaiTruoc = lastPrediction.du_doan === ketQuaTruoc ? '✅ ĐÚNG' : '❌ SAI';
        aiHoc(ketQuaTruoc, lastPrediction.du_doan, lastPrediction.loai_cau);
    }
    
    const prediction = duDoanTaiXiu(predictionsDB[gameKey], currentData.ket_qua);
    
    const result = {
        game: game.name,
        icon: game.icon,
        phien_hien_tai: phienTiepTheo,
        ket_qua_truoc: ketQuaTruoc,
        dung_sai_truoc: dungSaiTruoc,
        du_doan: prediction.du_doan,
        do_tin_cay: prediction.do_tin_cay,
        ly_do: prediction.ly_do,
        loai_cau: cau?.pattern || 'XuHuong',
        timestamp: new Date().toISOString(),
        ket_qua_thuc_te: ketQuaTruoc
    };
    
    predictionsDB[gameKey].unshift(result);
    if (predictionsDB[gameKey].length > 50) predictionsDB[gameKey] = predictionsDB[gameKey].slice(0, 50);
    
    res.json(result);
});

app.get('/api/history/:game', (req, res) => {
    const k = req.params.game;
    res.json({ success: true, game: GAMES[k]?.name, history: predictionsDB[k] || [], total: predictionsDB[k]?.length || 0 });
});

app.post('/api/reset/:game', (req, res) => {
    const k = req.params.game;
    predictionsDB[k] = [];
    res.json({ success: true, message: 'Đã reset lịch sử' });
});

app.get('/api/games', (req, res) => {
    let games = {};
    for (let [k, v] of Object.entries(GAMES)) games[k] = { name: v.name, icon: v.icon };
    res.json({ success: true, games, total: Object.keys(GAMES).length });
});

app.get('/api/ai-stats', (req, res) => {
    res.json({
        total: aiModel.totalPredictions,
        correct: aiModel.correctPredictions,
        accuracy: aiModel.totalPredictions > 0 ? ((aiModel.correctPredictions / aiModel.totalPredictions) * 100).toFixed(1) + '%' : '0%',
        pattern_stats: aiModel.patternStats
    });
});

app.get('/', (req, res) => {
    res.json({
        status: 'LC79 API',
        games: Object.keys(GAMES),
        endpoints: ['/api/predict/:game', '/api/history/:game', '/api/reset/:game', '/api/games', '/api/ai-stats']
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 LC79 API - ${Object.keys(GAMES).length} GAME`);
    console.log(`📡 PORT: ${PORT}`);
    console.log(`🎮 Games: ${Object.keys(GAMES).join(', ')}`);
});
