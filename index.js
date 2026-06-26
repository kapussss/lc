/**
 * ====================================================================
 * QUANTUM APEX TERMINAL - VERSION VIP V33 ULTIMATE
 * FIX: INSTANT ALTERNATION OVERRIDE & FAST RL DECAY & DOUBLE-LOSS INVERTER
 * ====================================================================
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const UPDATE_INTERVAL = 1000; 
const HISTORY_FILE = path.join(__dirname, 'prediction_history.json');

let historyData = new Array();
let currentPrediction = null;
let lastPhienId = null;
let updateLock = false;
let tongDuDoan = 0;
let duDoanDung = 0;
let chuoiDungLienTiep = 0;
let chuoiSaiLienTiep = 0;
let predictionHistory = new Array();

function formatResultName(str) {
    if (!str) return "TAI";
    const upper = str.toUpperCase().trim();
    if (upper === "TAI" || upper === "TÀI" || upper === "1") return "TAI";
    if (upper === "XIU" || upper === "XỈU" || upper === "0") return "XIU";
    return "TAI";
}

class QuantumApexPredictor {
    constructor() {
        this.lichSu = new Array();          
        this.lichSuDiem = new Array();      
        this.lichSuMD5 = new Array();       
        this.algoScores = {}; 
        this.lastPredictions = {}; 
        this.recentLosses = 0; // Đếm số lần thua gần nhất để kích hoạt Inverter
        this.algos = this.initAlgos();
    }

    initAlgos() {
        return {
            // 1. INSTANT ALTERNATION (Bắt cầu 1-1 cực nhanh)
            InstantAlt: () => {
                if (this.lichSu.length < 4) return "TAI";
                const l = this.lichSu;
                const n = l.length;
                // T-X-T hoặc X-T-X
                if (l[n-1] !== l[n-2] && l[n-2] !== l[n-3] && l[n-1] === l[n-3]) {
                    return l[n-1] === "TAI" ? "XIU" : "TAI";
                }
                return l[n-1];
            },
            
            // 2. STREAK BREAKER SNIPER
            StreakSniper: () => {
                if (this.lichSu.length < 20) return "TAI";
                const last = this.lichSu[this.lichSu.length - 1];
                let currStreak = 1;
                for (let i = this.lichSu.length - 2; i >= 0; i--) {
                    if (this.lichSu[i] === last) currStreak++; else break;
                }
                let streaks = [], tempS = 1;
                for (let i = 1; i < this.lichSu.length; i++) {
                    if (this.lichSu[i] === this.lichSu[i-1]) tempS++;
                    else { streaks.push(tempS); tempS = 1; }
                }
                const avgStreak = streaks.reduce((a,b)=>a+b,0) / (streaks.length || 1);
                if (currStreak >= Math.ceil(avgStreak) + 1) return last === "TAI" ? "XIU" : "TAI";
                return last;
            },
            
            // 3. MEAN REVERSION SNIPER
            MeanReversion: () => {
                if (this.lichSu.length < 15) return "TAI";
                const last10 = this.lichSu.slice(-10);
                const taiCount = last10.filter(x => x === "TAI").length;
                if (taiCount >= 7) return "XIU"; 
                if (10 - taiCount >= 7) return "TAI"; 
                return this.lichSu[this.lichSu.length - 1];
            },
            
            // 4. POINT EXHAUSTION
            PointExhaustion: () => {
                if (this.lichSuDiem.length < 5) return "TAI";
                const last3Pts = this.lichSuDiem.slice(-3);
                const avgPt = last3Pts.reduce((a,b)=>a+b,0) / 3;
                if (avgPt >= 15) return "XIU"; 
                if (avgPt <= 6) return "TAI";  
                return avgPt >= 10.5 ? "TAI" : "XIU";
            },
            
            // 5. MARKOV 4
            Markov4: () => {
                if (this.lichSu.length < 10) return "TAI";
                let p = {}; const n = this.lichSu.length;
                for (let i = 0; i < n - 4; i++) {
                    let s = this.lichSu.slice(i, i + 4).join("");
                    let nx = this.lichSu[i + 4];
                    if (!p[s]) p[s] = { TAI: 0, XIU: 0 };
                    p[s][nx]++;
                }
                let c = this.lichSu.slice(-4).join("");
                const s = p[c];
                if (!s) return this.lichSu[this.lichSu.length - 1];
                return s.TAI >= s.XIU ? "TAI" : "XIU";
            },
            
            // 6. MARKOV 6
            Markov6: () => {
                if (this.lichSu.length < 15) return "TAI";
                let p = {}; const n = this.lichSu.length;
                for (let i = 0; i < n - 6; i++) {
                    let s = this.lichSu.slice(i, i + 6).join("");
                    let nx = this.lichSu[i + 6];
                    if (!p[s]) p[s] = { TAI: 0, XIU: 0 };
                    p[s][nx]++;
                }
                let c = this.lichSu.slice(-6).join("");
                const s = p[c];
                if (!s) return this.lichSu[this.lichSu.length - 1];
                return s.TAI >= s.XIU ? "TAI" : "XIU";
            },
            
            // 7. KNN
            KNN: () => {
                if (this.lichSu.length < 10) return "TAI";
                const c = this.lichSu.slice(-4).join("");
                let t = 0, x = 0;
                for (let i = 0; i < this.lichSu.length - 5; i++) {
                    if (this.lichSu.slice(i, i + 4).join("") === c) {
                        if (this.lichSu[i + 4] === "TAI") t++; else x++;
                    }
                }
                return t >= x ? "TAI" : "XIU";
            },
            
            // 8. HMM
            HMM: () => {
                if (this.lichSu.length < 12) return "TAI";
                const o = this.lichSu.slice(-12).map(x => x === "TAI" ? 0 : 1);
                let p = [{s0: 0.5, s1: 0.5}];
                o.forEach(e => {
                    let pr = p[p.length - 1];
                    p.push({s0: Math.max(pr.s0*0.7, pr.s1*0.4)*(e===0?0.8:0.2), s1: Math.max(pr.s0*0.3, pr.s1*0.6)*(e===0?0.3:0.7)});
                });
                return p[p.length - 1].s0 >= p[p.length - 1].s1 ? "TAI" : "XIU";
            },
            
            // 9. BAYESIAN
            Bayesian: () => {
                if (this.lichSu.length < 5) return "TAI";
                let tT = 0, tX = 0, xT = 0, xX = 0;
                for (let i = 0; i < this.lichSu.length - 1; i++) {
                    if (this.lichSu[i] === "TAI") { this.lichSu[i + 1] === "TAI" ? tT++ : xT++; }
                    else { this.lichSu[i + 1] === "TAI" ? tX++ : xX++; }
                }
                const l = this.lichSu[this.lichSu.length - 1];
                if (l === "TAI") return tT >= xT ? "TAI" : "XIU";
                return tX >= xX ? "TAI" : "XIU";
            },
            
            // 10. DEEP SEQ
            DeepSeq: () => {
                if (this.lichSu.length < 20) return "TAI";
                const c = this.lichSu.slice(-5).join("");
                let t = 0, x = 0;
                for (let i = 0; i < this.lichSu.length - 6; i++) {
                    if (this.lichSu.slice(i, i + 5).join("") === c) {
                        if (this.lichSu[i + 5] === "TAI") t++; else x++;
                    }
                }
                if (t + x < 2) return this.lichSu[this.lichSu.length - 1];
                return t >= x ? "TAI" : "XIU";
            }
        };
    }

    themKetQua(ketQua, tongDiem, xucXacArray, md5String) {
        if (!tongDiem) tongDiem = 10;
        if (!xucXacArray) xucXacArray = new Array(1, 2, 3);
        if (!md5String) md5String = "000";
        const chuanHoa = (ketQua === "TAI" || ketQua === "TÀI") ? "TAI" : (ketQua === "XIU" || ketQua === "XỈU") ? "XIU" : (tongDiem >= 11 ? "TAI" : "XIU");
        
        // 1. Cập nhật điểm RL
        if (Object.keys(this.lastPredictions).length > 0) {
            for (let name in this.lastPredictions) {
                if (!this.algoScores[name]) this.algoScores[name] = 0;
                this.algoScores[name] *= 0.75; // FAST DECAY: Phai mờ nhanh để quên trend cũ
                if (this.lastPredictions[name] === chuanHoa) {
                    this.algoScores[name] += 2; // Reward
                } else {
                    this.algoScores[name] -= 1.5; // Penalty nặng
                }
            }
        }
        this.lastPredictions = {}; 
        
        // 2. Thêm vào lịch sử
        this.lichSu.push(chuanHoa);
        this.lichSuDiem.push(tongDiem);
        this.lichSuMD5.push(md5String);
        if (this.lichSu.length > 500) {
            this.lichSu.shift(); this.lichSuDiem.shift(); this.lichSuMD5.shift();
        }
    }

    getMarketPhase() {
        if (this.lichSu.length < 15) return "UNKNOWN";
        const last15 = this.lichSu.slice(-15);
        let alt = 0, streak = 0;
        for(let i=1; i<last15.length; i++) {
            if(last15[i] !== last15[i-1]) alt++; else streak++;
        }
        if (alt > 10) return "ALTERNATING";
        if (streak > 10) return "TRENDING";
        return "CHOPPY";
    }

    duDoanChinhXac() {
        if (this.lichSu.length < 10) {
            this.lastPredictions = {};
            return { duDoan: "TAI", doTinCay: 50, lyDo: "Đang nạp dữ liệu...", phase: "UNKNOWN", streakRisk: 0, dna: "---" };
        }
        
        let predictions = {};
        let tVotes = 0, xVotes = 0;
        const phase = this.getMarketPhase();
        const l = this.lichSu;
        const n = l.length;
        
        // INSTANT ALTERNATION OVERRIDE LOGIC
        let forceAlt = false;
        if (n >= 4 && l[n-1] !== l[n-2] && l[n-2] !== l[n-3] && l[n-1] === l[n-3]) {
            forceAlt = true;
        }
        
        for (let name in this.algos) {
            try {
                const pred = this.algos[name].call(this);
                predictions[name] = pred;
                
                let score = this.algoScores[name] || 0;
                let weight = Math.max(0.1, Math.exp(score / 4)); 
                
                if (forceAlt && name === "InstantAlt") weight *= 10.0; // Ép trọng số cực mạnh
                if (phase === "TRENDING" && name === "StreakSniper") weight *= 2.0;
                
                if (pred === "TAI") tVotes += weight; else xVotes += weight;
            } catch (e) {}
        }
        
        this.lastPredictions = predictions; 
        
        let decision = tVotes > xVotes ? "TAI" : "XIU";
        
        // DOUBLE-LOSS INVERTER LOGIC
        if (this.recentLosses >= 2) {
            decision = decision === "TAI" ? "XIU" : "TAI";
            this.recentLosses = 0; // Reset sau khi đảo
            xVotes = tVotes = 50; // Cân bằng để chạy logic confidence
            if (decision === "TAI") tVotes = 80; else xVotes = 80;
        }
        
        let totalVotes = tVotes + xVotes;
        let confidence = totalVotes > 0 ? Math.round((Math.max(tVotes, xVotes) / totalVotes) * 100) : 50;
        
        const last = l[l.length - 1];
        let currStreak = 1;
        for (let i = l.length - 2; i >= 0; i--) {
            if (l[i] === last) currStreak++; else break;
        }
        const streakRisk = Math.min(100, currStreak * 20);
        
        // Market DNA
        const dna = l.slice(-10).map(x => x === "TAI" ? "T" : "X").join("");
        
        let agreeCount = 0;
        for (let p in predictions) if (predictions[p] === decision) agreeCount++;
        
        return { 
            duDoan: decision, 
            doTinCay: Math.min(95, Math.max(55, confidence)), 
            lyDo: `Phase: ${phase} | ${agreeCount}/${Object.keys(predictions).length} Algos`,
            phase: phase,
            streakRisk: streakRisk,
            dna: dna
        };
    }
}

const predictor = new QuantumApexPredictor();

async function checkPreviousPrediction() {
    if (predictionHistory.length === 0) return;
    const lastPrediction = predictionHistory[predictionHistory.length - 1];
    if (lastPrediction.verified) return;
    if (historyData.length === 0) return;

    const targetId = lastPrediction.phienId;
    const foundSession = historyData.find(s => String(s.id) === String(targetId));
    if (foundSession) {
        let d = foundSession.dices || foundSession.result || [1,2,3];
        let t = foundSession.point || foundSession.totalResult || foundSession.score || (parseInt(d[0])+parseInt(d[1])+parseInt(d[2]));
        let k = foundSession.resultTruyenThong || foundSession.resultType || (t >= 11 ? "TAI" : "XIU");
        const actualNorm = k.toUpperCase().includes("TAI") ? "TAI" : "XIU";
        
        lastPrediction.verified = true;
        lastPrediction.ket_qua_thuc = actualNorm;
        lastPrediction.diem_so = t;
        tongDuDoan++;
        if (lastPrediction.du_doan === actualNorm) { 
            duDoanDung++; chuoiDungLienTiep++; chuoiSaiLienTiep = 0; 
            predictor.recentLosses = 0;
        } else { 
            chuoiSaiLienTiep++; chuoiDungLienTiep = 0; 
            predictor.recentLosses++; // Tăng bộ đếm thua
        }
        savePredictionHistory();
        console.log(">>> [APEX V33] Phiên #" + targetId + " | ĐOÁN: " + lastPrediction.du_doan + " | THỰC TẾ: " + actualNorm + " => " + (lastPrediction.du_doan === actualNorm ? 'THẮNG' : 'THUA'));
    }
}

// GIAO DIỆN BENTO GRID V33
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Apex V33 Terminal</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: #08080a; --card: #0c0c0f; --border: #1f1f23;
                --text: #e4e4e7; --muted: #71717a;
                --tai: #f59e0b; --xiu: #06b6d4; --win: #10b981; --lose: #f43f5e;
            }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; display: flex; justify-content: center; padding: 24px 12px; min-height: 100vh; }
            .app { width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 12px; }
            
            header { display: flex; justify-content: space-between; align-items: center; padding: 0 4px 4px; }
            .brand { font-weight: 700; font-size: 14px; letter-spacing: -0.5px; display: flex; align-items: center; gap: 8px; }
            .dot { width: 8px; height: 8px; background: var(--win); border-radius: 50%; box-shadow: 0 0 10px var(--win); animation: pulse 2s infinite; }
            .status-txt { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted); }
            
            .card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; }
            
            .main-pred { padding: 32px 24px; text-align: center; position: relative; overflow: hidden; }
            .main-pred::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.02) 0%, transparent 60%); pointer-events: none; }
            .pred-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 16px; }
            .pred-val { font-size: 64px; font-weight: 800; line-height: 1; letter-spacing: -3px; transition: color 0.3s; }
            .pred-val.tai { color: var(--tai); text-shadow: 0 0 40px rgba(245, 158, 11, 0.4); }
            .pred-val.xiu { color: var(--xiu); text-shadow: 0 0 40px rgba(6, 182, 212, 0.4); }
            .pred-meta { font-size: 11px; color: var(--muted); margin-top: 20px; font-family: 'JetBrains Mono', monospace; }
            
            .phase-bar { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; margin-top: 12px; border-top: 1px solid var(--border); }
            .phase-tag { font-size: 10px; font-weight: 600; padding: 4px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: 1px; }
            .phase-tag.TRENDING { background: rgba(245, 158, 11, 0.1); color: var(--tai); }
            .phase-tag.ALTERNATING { background: rgba(6, 182, 212, 0.1); color: var(--xiu); }
            .phase-tag.CHOPPY { background: rgba(113, 113, 122, 0.1); color: var(--muted); }
            .risk-meter { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--muted); text-transform: uppercase; }
            .risk-bar { width: 60px; height: 4px; background: #27272a; border-radius: 2px; overflow: hidden; }
            .risk-fill { height: 100%; background: var(--lose); transition: width 0.3s; }
            
            .dna-bar { display: flex; gap: 4px; height: 36px; padding: 8px; align-items: center; justify-content: center; }
            .dna-txt { font-family: 'JetBrains Mono', monospace; font-size: 14px; letter-spacing: 4px; color: var(--text); }
            
            .viz-bar { display: flex; gap: 4px; height: 28px; padding: 8px; }
            .viz-block { flex: 1; border-radius: 4px; background: #18181b; transition: all 0.3s; }
            .viz-block.tai { background: var(--tai); }
            .viz-block.xiu { background: var(--xiu); }
            
            .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
            .stat-box { padding: 12px; text-align: center; }
            .stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
            .stat-val { font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 600; }
            .stat-val.win { color: var(--win); }
            .stat-val.lose { color: var(--lose); }
            
            .algo-panel { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
            .algo-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
            .algo-title { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
            .algo-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
            .algo-name { width: 110px; font-family: 'JetBrains Mono', monospace; color: var(--text); font-size: 11px; }
            .algo-bar-bg { flex: 1; height: 6px; background: #18181b; border-radius: 3px; overflow: hidden; }
            .algo-bar-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
            .algo-score { width: 36px; text-align: right; font-family: 'JetBrains Mono', monospace; color: var(--muted); font-size: 11px; }
            
            .history-list { display: flex; flex-direction: column; gap: 6px; }
            .log-item { padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; }
            .log-left { display: flex; flex-direction: column; gap: 4px; }
            .log-phien { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted); }
            .log-status { font-size: 12px; font-weight: 600; letter-spacing: 0.5px; }
            .log-status.thang { color: var(--win); }
            .log-status.thua { color: var(--lose); }
            .log-status.wait { color: var(--muted); }
            .log-right { display: flex; gap: 8px; align-items: center; }
            .log-pill { font-family: 'JetBrains Mono', monospace; font-size: 10px; padding: 4px 10px; border-radius: 6px; width: 44px; text-align: center; font-weight: 600; }
            .log-pill.tai { background: rgba(245, 158, 11, 0.1); color: var(--tai); }
            .log-pill.xiu { background: rgba(6, 182, 212, 0.1); color: var(--xiu); }
            .log-res { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text); width: 44px; text-align: center; }
            
            @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }
        </style>
    </head>
    <body>
        <div class="app">
            <header>
                <div class="brand"><span class="dot"></span>APEX V33</div>
                <div class="status-txt" id="phien-txt">---...</div>
            </header>
            
            <div class="card main-pred">
                <div class="pred-label">PREDICTION</div>
                <div class="pred-val tai" id="val-pred">TÀI</div>
                <div class="pred-meta" id="val-meta">Initializing RL Engine...</div>
                <div class="phase-bar">
                    <div class="phase-tag CHOPPY" id="phase-tag">CHOPPY</div>
                    <div class="risk-meter">
                        <span>Streak Risk</span>
                        <div class="risk-bar"><div class="risk-fill" id="risk-fill" style="width: 0%"></div></div>
                    </div>
                </div>
            </div>
            
            <div class="card dna-bar">
                <div class="dna-txt" id="dna-txt">--- --- ---</div>
            </div>
            
            <div class="card viz-bar" id="viz-bar"></div>
            
            <div class="stats-grid">
                <div class="card stat-box">
                    <div class="stat-label">Win Rate</div>
                    <div class="stat-val win" id="val-acc">0%</div>
                </div>
                <div class="card stat-box">
                    <div class="stat-label">Streak</div>
                    <div class="stat-val win" id="val-streak">0</div>
                </div>
                <div class="card stat-box">
                    <div class="stat-label">Total</div>
                    <div class="stat-val" id="val-total">0</div>
                </div>
                <div class="card stat-box">
                    <div class="stat-label">Max</div>
                    <div class="stat-val" id="val-max">0</div>
                </div>
            </div>
            
            <div class="card algo-panel">
                <div class="algo-head">
                    <div class="algo-title">TOP RL ALGORITHMS</div>
                </div>
                <div id="algo-list"></div>
            </div>
            
            <div class="history-list" id="log-list"></div>
        </div>
        
        <script>
            function lbl(s) {
                if(!s) return '---';
                if(s.toUpperCase().includes('TAI')) return 'TÀI';
                if(s.toUpperCase().includes('XIU')) return 'XỈU';
                return '---';
            }
            async function refresh() {
                try {
                    const res = await fetch('/api/dashboard-stats');
                    const d = await res.json();
                    
                    const sig = d.du_doan_live.toUpperCase().trim();
                    const el = document.getElementById('val-pred');
                    if(sig.includes('TAI')) { el.innerText = 'TÀI'; el.className = 'pred-val tai'; }
                    else { el.innerText = 'XỈU'; el.className = 'pred-val xiu'; }
                    
                    document.getElementById('val-meta').innerText = 'Confidence: ' + d.do_tin_cay_live + '% | ' + d.ly_do_live;
                    document.getElementById('phien-txt').innerText = 'Phiên #' + d.phien_hien_tai_live;
                    
                    const pTag = document.getElementById('phase-tag');
                    pTag.innerText = d.phase || 'CHOPPY';
                    pTag.className = 'phase-tag ' + (d.phase || 'CHOPPY');
                    document.getElementById('risk-fill').style.width = (d.streak_risk || 0) + '%';
                    
                    const dnaEl = document.getElementById('dna-txt');
                    dnaEl.innerText = d.dna || '--- --- ---';
                    
                    const acc = d.tong_phien > 0 ? ((d.thang / d.tong_phien) * 100).toFixed(1) : '0.0';
                    document.getElementById('val-acc').innerText = acc + '%';
                    document.getElementById('val-streak').innerText = d.so_lan_thong;
                    document.getElementById('val-total').innerText = d.tong_phien;
                    document.getElementById('val-max').innerText = d.thang_lien_tiep_max;
                    
                    const viz = document.getElementById('viz-bar');
                    viz.innerHTML = '';
                    if(d.lich_su_20) {
                        d.lich_su_20.forEach(r => {
                            const b = document.createElement('div');
                            b.className = 'viz-block ' + (r === 'TAI' ? 'tai' : 'xiu');
                            viz.appendChild(b);
                        });
                    }
                    
                    const algoList = document.getElementById('algo-list');
                    algoList.innerHTML = '';
                    if(d.top_algos) {
                        d.top_algos.forEach(a => {
                            const w = Math.abs(parseFloat(a.score)) / (d.max_score || 1) * 100;
                            const c = parseFloat(a.score) > 0 ? 'var(--win)' : 'var(--lose)';
                            algoList.innerHTML += \`
                                <div class="algo-row">
                                    <div class="algo-name">\${a.name}</div>
                                    <div class="algo-bar-bg"><div class="algo-bar-fill" style="width: \${w}%; background: \${c}"></div></div>
                                    <div class="algo-score">\${a.score}</div>
                                </div>
                            \`;
                        });
                    }
                    
                    const logList = document.getElementById('log-list');
                    logList.innerHTML = '';
                    if(d.chi_tiet_phien) {
                        d.chi_tiet_phien.forEach(p => {
                            const pc = p.du_doan.includes('TAI') ? 'tai' : 'xiu';
                            let st = 'ĐANG ĐỢI', sc = 'wait';
                            if(p.trang_thai.includes('Thắng')) { st = 'THẮNG'; sc = 'thang'; }
                            else if(p.trang_thai.includes('Thua')) { st = 'THUA'; sc = 'thua'; }
                            
                            logList.innerHTML += \`
                                <div class="card log-item">
                                    <div class="log-left">
                                        <div class="log-phien">Phiên #\${p.phienId}</div>
                                        <div class="log-status \${sc}">\${st}</div>
                                    </div>
                                    <div class="log-right">
                                        <div class="log-pill \${pc}">\${lbl(p.du_doan)}</div>
                                        <div class="log-res">\${p.ket_qua_thuc.includes('Chờ') ? '---' : lbl(p.ket_qua_thuc)}</div>
                                    </div>
                                </div>
                            \`;
                        });
                    }
                } catch(e) {}
            }
            refresh();
            setInterval(refresh, 1000);
        </script>
    </body>
    </html>
    `);
});

app.get('/api/dashboard-stats', (req, res) => {
    const duDoanLive = currentPrediction ? currentPrediction.du_doan : "TAI";
    const doTinCayLive = currentPrediction ? currentPrediction.do_tin_cay : 50;
    const lyDoLive = currentPrediction ? currentPrediction.ly_do : "RL Engine V33 khởi tạo";
    const phienHienTaiLive = currentPrediction ? currentPrediction.phien_hien_tai : 0;
    const phase = currentPrediction ? currentPrediction.phase : "CHOPPY";
    const streakRisk = currentPrediction ? currentPrediction.streakRisk : 0;
    const dna = currentPrediction ? currentPrediction.dna : "---";

    const realAccuracy = tongDuDoan > 0 ? parseFloat(((duDoanDung / tongDuDoan) * 100).toFixed(1)) : 0.0;

    let topAlgos = Object.entries(predictor.algoScores || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, score]) => ({ name, score: score.toFixed(2) }));
        
    let maxScore = topAlgos.length > 0 ? Math.max(...topAlgos.map(a => Math.abs(parseFloat(a.score))), 1) : 1;

    res.json({
        tong_phien: tongDuDoan,
        thang: duDoanDung,
        thua: (tongDuDoan - duDoanDung) > 0 ? (tongDuDoan - duDoanDung) : 0,
        thang_lien_tiep_max: chuoiDungLienTiep, 
        so_lan_thong: chuoiDungLienTiep,
        ty_le_chinh_xac: realAccuracy, 
        phien_hien_tai_live: phienHienTaiLive,
        du_doan_live: duDoanLive,
        do_tin_cay_live: doTinCayLive,
        ly_do_live: lyDoLive,
        phase: phase,
        streak_risk: streakRisk,
        dna: dna,
        lich_su_20: predictor.lichSu.slice(-20).reverse(),
        top_algos: topAlgos,
        max_score: maxScore,
        chi_tiet_phien: predictionHistory.slice(-10).reverse().map(p => ({
            phienId: p.phienId,
            du_doan: p.du_doan,
            ket_qua_thuc: p.ket_qua_thuc ? (p.diem_so ? p.ket_qua_thuc + ' (' + p.diem_so + ')' : p.ket_qua_thuc) : 'Chờ KQ...',
            trang_thai: p.verified ? (p.du_doan === p.ket_qua_thuc ? 'Thắng' : 'Thua') : 'Đang đợi...'
        }))
    });
});

app.get('/api/live', (req, res) => res.json(currentPrediction || { msg: "Đang nạp..." }));
app.get('/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    res.json({ latest_phien: historyData.slice(0, limit), total_phien: historyData.length });
});

async function fetchHistory() {
    try {
        const res = await axios.get(API_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
        let apiList = null;
        if (res && res.data) {
            if (res.data.list && Array.isArray(res.data.list)) apiList = res.data.list; 
            else if (res.data.data && Array.isArray(res.data.data)) apiList = res.data.data; 
            else if (Array.isArray(res.data)) apiList = res.data;
        }
        if (apiList && apiList.length > 0) {
            historyData = apiList.sort((a, b) => (b.id || 0) - (a.id || 0));
            return true;
        }
    } catch (e) {}
    return false;
}

function addLatestToPredictor(latest) {
    let d = latest.dices || latest.result || [1,2,3];
    let t = latest.point || latest.totalResult || latest.score || (parseInt(d[0])+parseInt(d[1])+parseInt(d[2]));
    let k = latest.resultTruyenThong || latest.resultType || (t >= 11 ? "TAI" : "XIU");
    predictor.themKetQua(k, t, d, latest._id || "000");
}

async function updateData() {
    if (updateLock) return;
    updateLock = true;
    try {
        if (await fetchHistory() && historyData.length > 0) {
            const latest = historyData[0];
            const currentId = latest.id;
            if (currentId && currentId !== lastPhienId) {
                await checkPreviousPrediction();
                
                if (predictor.lichSu.length === 0) {
                    await initializeData();
                } else {
                    const lastPredictedId = parseInt(predictor.lichSu[predictor.lichSu.length - 1].id) || 0;
                    if (currentId > lastPredictedId + 1) {
                        await initializeData();
                    } else if (currentId === lastPredictedId + 1 || lastPredictedId === 0) {
                        addLatestToPredictor(latest);
                    }
                }
                
                lastPhienId = currentId;
                const analysis = predictor.duDoanChinhXac();
                currentPrediction = { 
                    phien_hien_tai: currentId + 1, 
                    du_doan: formatResultName(analysis.duDoan), 
                    do_tin_cay: analysis.doTinCay, 
                    ly_do: analysis.lyDo,
                    phase: analysis.phase,
                    streakRisk: analysis.streakRisk,
                    dna: analysis.dna
                };
                
                if (!predictionHistory.find(p => p.phienId === currentId + 1)) {
                    predictionHistory.push({ phienId: currentId + 1, du_doan: formatResultName(analysis.duDoan), do_tin_cay: analysis.doTinCay, ly_do: analysis.lyDo, ket_qua_thuc: null, verified: false, timestamp: Date.now(), diem_so: null });
                    savePredictionHistory();
                }
                console.log(`[V33] #${currentId} -> Next: ${analysis.duDoan} (${analysis.doTinCay}%) | DNA: ${analysis.dna}`);
            }
        }
    } catch (e) {} finally { updateLock = false; }
}

async function initializeData() {
    if (await fetchHistory() && historyData.length > 0) {
        const latest = historyData[0];
        const currentId = latest.id;
        lastPhienId = currentId;
        
        let tempLichSu = [], tempLichSuDiem = [], tempLichSuMD5 = [];
        [...historyData].reverse().forEach(s => {
            let d = s.dices || s.result || [1,2,3];
            let t = s.point || s.totalResult || s.score || (parseInt(d[0])+parseInt(d[1])+parseInt(d[2]));
            let k = s.resultTruyenThong || s.resultType || (t >= 11 ? "TAI" : "XIU");
            tempLichSu.push(k.toUpperCase().includes("TAI") ? "TAI" : "XIU");
            tempLichSuDiem.push(t);
            tempLichSuMD5.push(s._id || s.idString || "000");
        });
        
        predictor.lichSu = []; predictor.lichSuDiem = []; predictor.lichSuMD5 = [];
        predictor.algoScores = {}; predictor.lastPredictions = {};
        
        for (let i = 0; i < tempLichSu.length; i++) {
            if (predictor.lichSu.length > 10) {
                predictor.duDoanChinhXac(); 
            } else {
                predictor.lastPredictions = {};
            }
            predictor.themKetQua(tempLichSu[i], tempLichSuDiem[i], [1,2,3], tempLichSuMD5[i]);
        }
        
        const analysis = predictor.duDoanChinhXac();
        currentPrediction = { 
            phien_hien_tai: currentId + 1, 
            du_doan: formatResultName(analysis.duDoan), 
            do_tin_cay: analysis.doTinCay, 
            ly_do: analysis.lyDo,
            phase: analysis.phase,
            streakRisk: analysis.streakRisk,
            dna: analysis.dna
        };
        console.log("[KHỞI ĐỘNG V33] Instant Alt Override & Inverter Ready.");
    }
}

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            predictionHistory = data.predictions || [];
            tongDuDoan = data.tongDuDoan || 0;
            duDoanDung = data.duDoanDung || 0;
            chuoiDungLienTiep = data.chuoiDungLienTiep || 0;
            chuoiSaiLienTiep = data.chuoiSaiLienTiep || 0;
        }
    } catch (e) {}
}

function savePredictionHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({ predictions: predictionHistory.slice(-500), tongDuDoan, duDoanDung, chuoiDungLienTiep, chuoiSaiLienTiep, lastUpdated: new Date().toISOString() }, null, 2));
    } catch (e) {}
}

app.listen(PORT, () => {
    console.log('==================================================');
    console.log('  APEX V33 TERMINAL RUNNING ON PORT: ' + PORT);
    console.log('  INSTANT ALTERNATION OVERRIDE ACTIVE');
    console.log('  DOUBLE-LOSS INVERTER ACTIVE');
    console.log('==================================================\n');
    loadPredictionHistory(); 
    initializeData();        
    setInterval(async () => { await updateData(); }, UPDATE_INTERVAL);
});
