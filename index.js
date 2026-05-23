// server.js - DICE MASTER AI v11.0 (Advanced Dice Engine + Anti-Cheat)
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;
const AUTH_KEY = "kapub";
const USER_ID = "@Kapubb";
const ALGO_NAME = "DiceMASTER_AI_v11";

// ================= CONFIG =================
const GAME_CONFIG = {
    "lc79_tx": {
        game_key: "LC79_TX",
        api_url: "https://wtx.tele68.com/v1/tx/sessions",
        name: "LC79 Tài Xỉu",
        type: "legacy"
    },
    "lc79_md5": {
        game_key: "LC79_MD5",
        api_url: "https://wtxmd52.tele68.com/v1/txmd5/sessions",
        name: "LC79 MD5",
        type: "legacy"
    },
    "betvip_tx": {
        game_key: "BETVIP_TX",
        api_url: "https://wtx.macminim6.online/v1/tx/sessions",
        name: "BETVIP Tài Xỉu",
        type: "legacy"
    },
    "betvip_md5": {
        game_key: "BETVIP_MD5",
        api_url: "https://wtxmd52.macminim6.online/v1/txmd5/sessions",
        name: "BETVIP MD5",
        type: "legacy"
    }
};

// ================= CACHE & HISTORY =================
let gameCache = {};
let gameHistory = {};
let predictionHistory = {};
let pendingPredictions = {};
let lastProcessedSession = {};

// ================= NÂNG CẤP: FEATURE EXTRACTOR =================
class FeatureExtractor {
    static extractFeatures(history) {
        if (!history || history.length < 10) return null;
        
        const n = history.length;
        const recent10 = history.slice(-10);
        const recent20 = history.slice(-20);
        const recent50 = history.slice(-50);
        
        // Kết quả dạng số (T=1, X=0)
        const results = history.map(h => h.result === 'Tài' ? 1 : 0);
        
        // 1. Tỷ lệ Tài trong các khoảng
        const taiRate10 = recent10.filter(h => h.result === 'Tài').length / 10;
        const taiRate20 = recent20.filter(h => h.result === 'Tài').length / 20;
        const taiRate50 = recent50.filter(h => h.result === 'Tài').length / 50;
        
        // 2. Thống kê xúc xắc
        const allDices = history.map(h => [h.d1, h.d2, h.d3]).flat();
        const faceFreq = {1:0,2:0,3:0,4:0,5:0,6:0};
        allDices.forEach(d => faceFreq[d]++);
        const totalDices = allDices.length;
        
        // 3. Chuỗi HL (High/Low)
        const hlStrings = recent10.map(h => {
            const hl = (h.d1 >= 4 ? 'H' : 'L') + (h.d2 >= 4 ? 'H' : 'L') + (h.d3 >= 4 ? 'H' : 'L');
            return hl;
        });
        const hCount10 = hlStrings.join('').split('H').length - 1;
        const hlRate10 = hCount10 / 30; // 30 vị trí trong 10 phiên
        
        // 4. Chuỗi Chẵn/Lẻ
        const oeStrings = recent10.map(h => {
            return (h.d1 % 2 === 0 ? 'C' : 'L') + (h.d2 % 2 === 0 ? 'C' : 'L') + (h.d3 % 2 === 0 ? 'C' : 'L');
        });
        const cCount10 = oeStrings.join('').split('C').length - 1;
        const ceRate10 = cCount10 / 30;
        
        // 5. Độ lệch chuẩn tổng điểm
        const scores10 = recent10.map(h => h.totalScore);
        const avgScore10 = scores10.reduce((a,b) => a+b, 0) / 10;
        const stdScore10 = Math.sqrt(scores10.reduce((sum, s) => sum + Math.pow(s - avgScore10, 2), 0) / 10);
        
        // 6. Số lần đảo chiều (Runs)
        let runs = 0;
        for (let i = 1; i < n; i++) {
            if (results[i] !== results[i-1]) runs++;
        }
        const runsRate = runs / (n - 1);
        
        // 7. Streak hiện tại
        let currentStreak = 1;
        const lastResult = results[n-1];
        for (let i = n-2; i >= 0; i--) {
            if (results[i] === lastResult) currentStreak++;
            else break;
        }
        
        // 8. Tần suất xuất hiện của tổng điểm
        const scoreFreq = {};
        recent50.forEach(h => {
            scoreFreq[h.totalScore] = (scoreFreq[h.totalScore] || 0) + 1;
        });
        
        // 9. Chuỗi pattern 5 phiên gần nhất
        const pattern5 = results.slice(-5).join('');
        const pattern10 = results.slice(-10).join('');
        
        // 10. Biến động tổng (Volatility)
        const scores50 = recent50.map(h => h.totalScore);
        const volatility = this.calculateVolatility(scores50);
        
        return {
            taiRate10, taiRate20, taiRate50,
            faceFreq, totalDices,
            hlRate10, ceRate10,
            avgScore10, stdScore10,
            runsRate, currentStreak,
            lastResult,
            scoreFreq,
            pattern5, pattern10,
            volatility,
            lastDices: [history[n-1].d1, history[n-1].d2, history[n-1].d3],
            lastTotal: history[n-1].totalScore
        };
    }
    
    static calculateVolatility(scores) {
        if (scores.length < 2) return 0;
        let sumChanges = 0;
        for (let i = 1; i < scores.length; i++) {
            sumChanges += Math.abs(scores[i] - scores[i-1]);
        }
        return sumChanges / (scores.length - 1);
    }
}

// ================= NÂNG CẤP: DICE GRAPH ENGINE (Markov bậc cao) =================
class DiceGraphEngine {
    constructor() {
        // Markov chain cho từng viên xúc xắc (bậc 1: từ mặt trước -> mặt sau)
        this.markovDice1 = Array.from({length: 7}, () => Array(7).fill(0));
        this.markovDice2 = Array.from({length: 7}, () => Array(7).fill(0));
        this.markovDice3 = Array.from({length: 7}, () => Array(7).fill(0));
        
        // Markov cho tổng điểm (bậc 2: từ (tổng trước, tổng hiện tại) -> tổng tiếp theo)
        this.markovScore2 = {}; // key: "prevScore_currentScore" -> {nextScore: count}
        
        // Markov cho pattern T/X (bậc 3)
        this.markovPattern3 = {}; // key: "TTX" -> {T: count, X: count}
        
        // Đếm số lần cập nhật
        this.updateCount = 0;
    }
    
    update(history) {
        if (!history || history.length < 4) return;
        const n = history.length;
        
        // Cập nhật Markov dice bậc 1
        const last = history[n-1];
        const prev = history[n-2];
        
        if (prev.d1 >= 1 && prev.d1 <= 6 && last.d1 >= 1 && last.d1 <= 6) {
            this.markovDice1[prev.d1][last.d1]++;
        }
        if (prev.d2 >= 1 && prev.d2 <= 6 && last.d2 >= 1 && last.d2 <= 6) {
            this.markovDice2[prev.d2][last.d2]++;
        }
        if (prev.d3 >= 1 && prev.d3 <= 6 && last.d3 >= 1 && last.d3 <= 6) {
            this.markovDice3[prev.d3][last.d3]++;
        }
        
        // Cập nhật Markov score bậc 2
        if (n >= 3) {
            const prev2 = history[n-3];
            const key = `${prev2.totalScore}_${prev.totalScore}`;
            if (!this.markovScore2[key]) {
                this.markovScore2[key] = {};
            }
            this.markovScore2[key][last.totalScore] = (this.markovScore2[key][last.totalScore] || 0) + 1;
        }
        
        // Cập nhật Markov pattern T/X bậc 3
        if (n >= 4) {
            const r1 = history[n-3].result === 'Tài' ? 'T' : 'X';
            const r2 = history[n-2].result === 'Tài' ? 'T' : 'X';
            const r3 = history[n-1].result === 'Tài' ? 'T' : 'X';
            const pattern = r1 + r2 + r3;
            
            if (!this.markovPattern3[pattern]) {
                this.markovPattern3[pattern] = {T: 0, X: 0};
            }
            const r4 = last.result === 'Tài' ? 'T' : 'X';
            this.markovPattern3[pattern][r4]++;
        }
        
        this.updateCount++;
    }
    
    predictNext(history) {
        const predictions = [];
        const n = history.length;
        const last = history[n-1];
        const prev = history[n-2];
        
        // Dự đoán từ Markov dice bậc 1
        const dice1Pred = this.getMostLikelyNext(this.markovDice1[last.d1]);
        const dice2Pred = this.getMostLikelyNext(this.markovDice2[last.d2]);
        const dice3Pred = this.getMostLikelyNext(this.markovDice3[last.d3]);
        
        if (dice1Pred && dice2Pred && dice3Pred) {
            const totalPred = dice1Pred.value + dice2Pred.value + dice3Pred.value;
            predictions.push({
                predict: totalPred >= 11 ? 'Tài' : 'Xỉu',
                confidence: Math.min(0.7, (dice1Pred.prob + dice2Pred.prob + dice3Pred.prob) / 3),
                source: 'markov_dice_1',
                weight: 0.1
            });
        }
        
        // Dự đoán từ Markov score bậc 2
        if (n >= 2) {
            const prev2 = history[n-3] || history[0];
            const key = `${prev2.totalScore}_${prev.totalScore}`;
            const scoreTransitions = this.markovScore2[key];
            
            if (scoreTransitions && Object.keys(scoreTransitions).length > 0) {
                let totalCount = 0, taiCount = 0;
                for (const [score, count] of Object.entries(scoreTransitions)) {
                    totalCount += count;
                    if (parseInt(score) >= 11) taiCount += count;
                }
                if (totalCount > 0) {
                    const probTai = taiCount / totalCount;
                    predictions.push({
                        predict: probTai > 0.5 ? 'Tài' : 'Xỉu',
                        confidence: Math.abs(probTai - 0.5) * 2 + 0.4,
                        source: 'markov_score_2',
                        weight: 0.08
                    });
                }
            }
        }
        
        // Dự đoán từ Markov pattern T/X bậc 3
        if (n >= 3) {
            const r1 = history[n-3].result === 'Tài' ? 'T' : 'X';
            const r2 = history[n-2].result === 'Tài' ? 'T' : 'X';
            const r3 = history[n-1].result === 'Tài' ? 'T' : 'X';
            const pattern = r1 + r2 + r3;
            const patternTrans = this.markovPattern3[pattern];
            
            if (patternTrans && (patternTrans.T + patternTrans.X) > 0) {
                const probT = patternTrans.T / (patternTrans.T + patternTrans.X);
                predictions.push({
                    predict: probT > 0.5 ? 'Tài' : 'Xỉu',
                    confidence: Math.abs(probT - 0.5) * 2 + 0.3,
                    source: 'markov_pattern_3',
                    weight: 0.12
                });
            }
        }
        
        return predictions;
    }
    
    getMostLikelyNext(transitions) {
        if (!transitions) return null;
        let maxCount = 0;
        let bestValue = null;
        let total = 0;
        
        for (let i = 1; i <= 6; i++) {
            total += transitions[i] || 0;
            if ((transitions[i] || 0) > maxCount) {
                maxCount = transitions[i] || 0;
                bestValue = i;
            }
        }
        
        if (total === 0 || !bestValue) return null;
        return { value: bestValue, prob: maxCount / total };
    }
}

// ================= NÂNG CẤP: PATTERN CLUSTER ENGINE =================
class PatternClusterEngine {
    constructor() {
        this.patterns = {}; // Lưu các mẫu pattern và kết quả tiếp theo
        this.clusterMemory = {}; // Gom nhóm các pattern tương tự
    }
    
    extractPattern(history, length) {
        if (!history || history.length < length + 1) return null;
        const results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
        return results.slice(-length - 1).join('');
    }
    
    update(history) {
        if (!history || history.length < 5) return;
        const n = history.length;
        const results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
        
        // Học pattern từ độ dài 3 đến 10
        for (let len = 3; len <= 10; len++) {
            if (n > len) {
                const pattern = results.slice(-len - 1, -1).join('');
                const next = results[n-1];
                
                if (!this.patterns[len]) this.patterns[len] = {};
                if (!this.patterns[len][pattern]) {
                    this.patterns[len][pattern] = {T: 0, X: 0, total: 0};
                }
                this.patterns[len][pattern][next]++;
                this.patterns[len][pattern].total++;
                
                // Phân cụm pattern tương tự
                this.clusterSimilar(pattern, len);
            }
        }
    }
    
    clusterSimilar(pattern, len) {
        // Gom các pattern có độ tương đồng cao (cùng kết thúc)
        const suffix = pattern.slice(-3);
        if (!this.clusterMemory[suffix]) {
            this.clusterMemory[suffix] = { patterns: [], nextT: 0, nextX: 0 };
        }
        if (!this.clusterMemory[suffix].patterns.includes(pattern)) {
            this.clusterMemory[suffix].patterns.push(pattern);
        }
    }
    
    predict(history) {
        const predictions = [];
        const n = history.length;
        if (n < 5) return predictions;
        
        const results = history.map(h => h.result === 'Tài' ? 'T' : 'X');
        
        // Dự đoán từ pattern khớp chính xác
        for (let len = 10; len >= 3; len--) {
            if (n >= len) {
                const currentPattern = results.slice(-len).join('');
                const patternData = this.patterns[len]?.[currentPattern];
                
                if (patternData && patternData.total >= 3) {
                    const probT = patternData.T / patternData.total;
                    predictions.push({
                        predict: probT > 0.5 ? 'Tài' : 'Xỉu',
                        confidence: Math.abs(probT - 0.5) * 2 + 0.3,
                        source: `pattern_exact_${len}`,
                        weight: 0.02 * len
                    });
                    break; // Ưu tiên pattern dài nhất
                }
            }
        }
        
        // Dự đoán từ cluster pattern tương tự
        const currentSuffix = results.slice(-3).join('');
        const cluster = this.clusterMemory[currentSuffix];
        if (cluster && cluster.patterns.length > 1) {
            // Gom tất cả kết quả tiếp theo từ các pattern trong cluster
            let clusterT = 0, clusterX = 0;
            for (const pat of cluster.patterns) {
                for (let len = 3; len <= 10; len++) {
                    const patData = this.patterns[len]?.[pat];
                    if (patData) {
                        clusterT += patData.T;
                        clusterX += patData.X;
                    }
                }
            }
            
            if (clusterT + clusterX > 5) {
                const probT = clusterT / (clusterT + clusterX);
                predictions.push({
                    predict: probT > 0.5 ? 'Tài' : 'Xỉu',
                    confidence: Math.abs(probT - 0.5) * 2 + 0.2,
                    source: 'cluster_similar',
                    weight: 0.06
                });
            }
        }
        
        return predictions;
    }
}

// ================= NÂNG CẤP: ANTI-CHEAT DETECTION ENGINE =================
class AntiCheatEngine {
    constructor() {
        this.trustScores = {};
        this.anomalyLog = {};
        this.recentDataHashes = {};
        this.lastCheckTime = {};
        
        // Ngưỡng cảnh báo
        this.THRESHOLD_TRUST_LOW = 30;
        this.THRESHOLD_FACE_DEVIATION = 0.15; // Độ lệch tần suất mặt xúc xắc
        this.THRESHOLD_AUTOCORR = 0.3; // Tự tương quan
        this.CHECK_INTERVAL = 10; // Kiểm tra mỗi 10 phiên
    }
    
    initGame(gameId) {
        if (!this.trustScores[gameId]) {
            this.trustScores[gameId] = 100;
            this.anomalyLog[gameId] = [];
            this.lastCheckTime[gameId] = 0;
        }
    }
    
    /**
     * Kiểm tra tính toàn vẹn dữ liệu
     */
    checkDataIntegrity(gameId, data, sessionId) {
        const issues = [];
        
        // 1. Kiểm tra hash dữ liệu (phát hiện replay)
        const dataStr = JSON.stringify(data);
        const dataHash = crypto.createHash('md5').update(dataStr).digest('hex');
        
        if (this.recentDataHashes[gameId]) {
            const recent = this.recentDataHashes[gameId];
            if (recent.includes(dataHash)) {
                issues.push({
                    type: 'REPLAY_DETECTED',
                    severity: 'HIGH',
                    detail: 'Dữ liệu trùng lặp với phiên trước - nghi ngờ replay attack'
                });
                this.trustScores[gameId] = Math.max(0, this.trustScores[gameId] - 30);
            }
            
            // Lưu hash mới, giữ tối đa 50 hash gần nhất
            recent.push(dataHash);
            if (recent.length > 50) recent.shift();
        } else {
            this.recentDataHashes[gameId] = [dataHash];
        }
        
        // 2. Kiểm tra session ID lộn xộn
        if (sessionId && this.lastProcessedSession[gameId]) {
            if (sessionId < this.lastProcessedSession[gameId]) {
                issues.push({
                    type: 'SESSION_ID_ANOMALY',
                    severity: 'MEDIUM',
                    detail: `Session ID lùi: ${sessionId} < ${this.lastProcessedSession[gameId]}`
                });
                this.trustScores[gameId] = Math.max(0, this.trustScores[gameId] - 15);
            }
        }
        
        return issues;
    }
    
    /**
     * Kiểm định thống kê tính ngẫu nhiên
     */
    statisticalAudit(gameId, history) {
        const issues = [];
        const n = history.length;
        if (n < 50) return { issues, trustChange: 0 }; // Chưa đủ dữ liệu
        
        const recent50 = history.slice(-50);
        
        // 1. Kiểm tra phân phối mặt xúc xắc (Chi-Square test)
        const faceFreq = {1:0, 2:0, 3:0, 4:0, 5:0, 6:0};
        recent50.forEach(h => {
            faceFreq[h.d1]++; faceFreq[h.d2]++; faceFreq[h.d3]++;
        });
        const totalFaces = 150; // 50 phiên * 3 viên
        const expectedFreq = totalFaces / 6; // 25
        
        let chiSquareFaces = 0;
        for (let i = 1; i <= 6; i++) {
            const observed = faceFreq[i] || 0;
            chiSquareFaces += Math.pow(observed - expectedFreq, 2) / expectedFreq;
        }
        
        // Chi-square critical value for df=5, alpha=0.05 is ~11.07
        if (chiSquareFaces > 11.07) {
            issues.push({
                type: 'FACE_DISTRIBUTION_BIASED',
                severity: 'MEDIUM',
                detail: `Phân phối mặt xúc xắc bất thường (Chi2=${chiSquareFaces.toFixed(2)})`,
                data: faceFreq
            });
            this.trustScores[gameId] = Math.max(0, this.trustScores[gameId] - 20);
        }
        
        // 2. Kiểm tra phân phối T/X (50/50 gần đúng)
        const taiCount = recent50.filter(h => h.result === 'Tài').length;
        const taiRatio = taiCount / 50;
        if (Math.abs(taiRatio - 0.5) > 0.2) {
            issues.push({
                type: 'TX_DISTRIBUTION_BIASED',
                severity: 'LOW',
                detail: `Tỷ lệ T/X lệch: ${(taiRatio*100).toFixed(1)}% Tài`
            });
            this.trustScores[gameId] = Math.max(0, this.trustScores[gameId] - 10);
        }
        
        // 3. Kiểm tra Runs Test (tính độc lập)
        const results = recent50.map(h => h.result === 'Tài' ? 1 : 0);
        let runs = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] !== results[i-1]) runs++;
        }
        
        const n1 = results.filter(r => r === 1).length; // Số Tài
        const n2 = results.length - n1; // Số Xỉu
        const expectedRuns = (2 * n1 * n2) / (n1 + n2) + 1;
        const stdRuns = Math.sqrt((2 * n1 * n2 * (2 * n1 * n2 - n1 - n2)) / 
                                  (Math.pow(n1 + n2, 2) * (n1 + n2 - 1)));
        
        if (stdRuns > 0) {
            const zScore = (runs - expectedRuns) / stdRuns;
            if (Math.abs(zScore) > 2.58) { // 99% confidence
                issues.push({
                    type: 'RUNS_TEST_FAILED',
                    severity: 'HIGH',
                    detail: `Chuỗi không độc lập (z=${zScore.toFixed(2)})`
                });
                this.trustScores[gameId] = Math.max(0, this.trustScores[gameId] - 25);
            }
        }
        
        // 4. Kiểm tra tự tương quan (Autocorrelation) lag-1
        if (recent50.length >= 2) {
            const scores = recent50.map(h => h.totalScore);
            const mean = scores.reduce((a,b) => a+b, 0) / scores.length;
            let num = 0, den = 0;
            
            for (let i = 1; i < scores.length; i++) {
                num += (scores[i] - mean) * (scores[i-1] - mean);
            }
            for (let i = 0; i < scores.length; i++) {
                den += Math.pow(scores[i] - mean, 2);
            }
            
            const autocorr = den > 0 ? num / den : 0;
            if (Math.abs(autocorr) > this.THRESHOLD_AUTOCORR) {
                issues.push({
                    type: 'HIGH_AUTOCORRELATION',
                    severity: 'MEDIUM',
                    detail: `Tự tương quan cao (r=${autocorr.toFixed(3)})`
                });
                this.trustScores[gameId] = Math.max(0, this.trustScores[gameId] - 15);
            }
        }
        
        // 5. Kiểm tra entropy của chuỗi kết quả
        const entropy = this.calculateEntropy(results);
        const maxEntropy = Math.log2(2); // 1.0 cho binary
        if (entropy < maxEntropy * 0.7) { // Entropy quá thấp
            issues.push({
                type: 'LOW_ENTROPY',
                severity: 'HIGH',
                detail: `Entropy thấp (${entropy.toFixed(3)}/${maxEntropy.toFixed(3)}) - Dữ liệu có thể bị thao túng`
            });
            this.trustScores[gameId] = Math.max(0, this.trustScores[gameId] - 25);
        }
        
        // Giới hạn trust score
        this.trustScores[gameId] = Math.min(100, this.trustScores[gameId]);
        
        return {
            issues,
            trustScore: this.trustScores[gameId],
            metrics: {
                chiSquareFaces: chiSquareFaces.toFixed(2),
                taiRatio: (taiRatio * 100).toFixed(1) + '%',
                runs,
                expectedRuns: expectedRuns.toFixed(1),
                autocorr: autocorr ? autocorr.toFixed(3) : 'N/A',
                entropy: entropy.toFixed(3)
            }
        };
    }
    
    calculateEntropy(binaryArray) {
        const count1 = binaryArray.filter(x => x === 1).length;
        const count0 = binaryArray.length - count1;
        const p1 = count1 / binaryArray.length;
        const p0 = count0 / binaryArray.length;
        
        let entropy = 0;
        if (p1 > 0) entropy -= p1 * Math.log2(p1);
        if (p0 > 0) entropy -= p0 * Math.log2(p0);
        return entropy;
    }
    
    /**
     * Đánh giá tổng thể và quyết định có nên dự đoán không
     */
    shouldPredict(gameId) {
        return this.trustScores[gameId] >= this.THRESHOLD_TRUST_LOW;
    }
    
    /**
     * Phục hồi trust score từ từ nếu không có vấn đề
     */
    recoverTrust(gameId) {
        if (this.trustScores[gameId] < 100) {
            this.trustScores[gameId] = Math.min(100, this.trustScores[gameId] + 2);
        }
    }
    
    getTrustStatus(gameId) {
        const score = this.trustScores[gameId] || 100;
        if (score >= 70) return 'GOOD';
        if (score >= 30) return 'WARNING';
        return 'CRITICAL';
    }
}

// ================= KHỞI TẠO CÁC ENGINE =================
const diceGraphEngine = new DiceGraphEngine();
const patternClusterEngine = new PatternClusterEngine();
const antiCheatEngine = new AntiCheatEngine();

// ================= HÀM TIỆN ÍCH =================
async function fetchData(url) {
    try {
        const response = await axios.get(url, { timeout: 10000 });
        return response.data;
    } catch (error) {
        console.error(`Lỗi fetch ${url}:`, error.message);
        return null;
    }
}

async function fetchAndCache(gameId) {
    const config = GAME_CONFIG[gameId];
    if (!config) return null;
    const data = await fetchData(config.api_url);
    if (data) {
        gameCache[gameId] = { data, ts: new Date().toISOString() };
    }
    return data;
}

async function getCachedData(gameId) {
    if (gameCache[gameId]) return gameCache[gameId].data;
    return await fetchAndCache(gameId);
}

function parseSession(item, gameType) {
    let result = null, point = 0, dices = [0, 0, 0], sessionId = null;
    
    if (gameType === "legacy") {
        const resultRaw = (item.resultTruyenThong || "").toUpperCase();
        result = resultRaw.includes("TAI") ? "T" : resultRaw.includes("XIU") ? "X" : null;
        point = item.point || 0;
        dices = item.dices || [0, 0, 0];
        sessionId = item.id;
    }
    return { result, point, dices, sessionId };
}

// ================= HÀM KHỞI TẠO & CẬP NHẬT =================
function initGameHistory(gameId) {
    if (!gameHistory[gameId]) {
        gameHistory[gameId] = [];
    }
    if (!predictionHistory[gameId]) {
        predictionHistory[gameId] = [];
    }
    if (!lastProcessedSession[gameId]) {
        lastProcessedSession[gameId] = null;
    }
    antiCheatEngine.initGame(gameId);
}

function addSession(gameId, session, result, totalScore, d1, d2, d3) {
    if (!gameHistory[gameId]) {
        gameHistory[gameId] = [];
    }
    
    gameHistory[gameId].push({ session, result, totalScore, d1, d2, d3, timestamp: Date.now() });
    
    if (gameHistory[gameId].length > 1000) {
        gameHistory[gameId] = gameHistory[gameId].slice(-500);
    }
    
    // Cập nhật các engine
    diceGraphEngine.update(gameHistory[gameId]);
    patternClusterEngine.update(gameHistory[gameId]);
}

// ================= DỰ ĐOÁN NÂNG CAO =================
function predictAdvanced(gameId) {
    const history = gameHistory[gameId];
    if (!history || history.length < 10) {
        return { prediction: 'CHO', confidence: 0, reason: 'Chưa đủ dữ liệu (cần >= 10 phiên)' };
    }
    
    // Kiểm tra Anti-Cheat
    if (!antiCheatEngine.shouldPredict(gameId)) {
        return { 
            prediction: 'CHO', 
            confidence: 0, 
            reason: `Trust Score thấp (${antiCheatEngine.trustScores[gameId]}) - Nghi ngờ dữ liệu không ngẫu nhiên` 
        };
    }
    
    const features = FeatureExtractor.extractFeatures(history);
    if (!features) {
        return { prediction: 'CHO', confidence: 0, reason: 'Không thể trích xuất đặc trưng' };
    }
    
    let predictions = [];
    
    // 1. Dự đoán từ Dice Graph Engine (Markov)
    const markovPredictions = diceGraphEngine.predictNext(history);
    predictions.push(...markovPredictions);
    
    // 2. Dự đoán từ Pattern Cluster Engine
    const patternPredictions = patternClusterEngine.predict(history);
    predictions.push(...patternPredictions);
    
    // 3. Dự đoán từ phân tích xu hướng T/X
    const trendPrediction = predictFromTrend(features);
    predictions.push(trendPrediction);
    
    // 4. Dự đoán từ phân tích xúc xắc chi tiết
    const diceDetailPrediction = predictFromDiceDetails(features, history);
    predictions.push(diceDetailPrediction);
    
    // 5. Dự đoán từ biến động
    const volatilityPrediction = predictFromVolatility(features);
    predictions.push(volatilityPrediction);
    
    // 6. Dự đoán từ streak hiện tại
    const streakPrediction = predictFromStreak(features, history);
    predictions.push(streakPrediction);
    
    // Tổng hợp dự đoán với trọng số
    let weightedTai = 0, weightedXiu = 0, totalWeight = 0;
    
    for (const pred of predictions) {
        if (pred.predict === 'CHO') continue;
        const w = pred.weight * pred.confidence;
        if (pred.predict === 'Tài') weightedTai += w;
        else if (pred.predict === 'Xỉu') weightedXiu += w;
        totalWeight += w;
    }
    
    if (totalWeight === 0) {
        return { prediction: 'CHO', confidence: 0, reason: 'Không đủ tín hiệu dự đoán' };
    }
    
    const probTai = weightedTai / totalWeight;
    
    // Nếu tín hiệu quá yếu -> CHO
    if (Math.abs(probTai - 0.5) < 0.05) {
        return { prediction: 'CHO', confidence: 0, reason: 'Tín hiệu quá yếu' };
    }
    
    const finalPrediction = probTai > 0.5 ? 'Tài' : 'Xỉu';
    const confidence = Math.round(Math.min(95, Math.max(55, Math.abs(probTai - 0.5) * 2 * 100)));
    
    const topSources = predictions
        .filter(p => p.predict !== 'CHO')
        .sort((a, b) => b.weight * b.confidence - a.weight * a.confidence)
        .slice(0, 3);
    
    return {
        prediction: finalPrediction,
        confidence,
        reason: topSources.map(s => s.source).join(', '),
        totalSources: predictions.filter(p => p.predict !== 'CHO').length,
        trustScore: antiCheatEngine.trustScores[gameId],
        trustStatus: antiCheatEngine.getTrustStatus(gameId)
    };
}

function predictFromTrend(features) {
    // Phân tích xu hướng từ tỷ lệ Tài các khoảng
    const trendScore = (features.taiRate10 - 0.5) * 0.5 + (features.taiRate20 - 0.5) * 0.3 + (features.taiRate50 - 0.5) * 0.2;
    const predictTrend = trendScore > 0 ? 'Tài' : 'Xỉu';
    const confidence = Math.min(0.7, Math.abs(trendScore) * 2 + 0.4);
    
    return {
        predict: predictTrend,
        confidence,
        source: 'trend_analysis',
        weight: 0.15
    };
}

function predictFromDiceDetails(features, history) {
    const n = history.length;
    const last = history[n-1];
    
    // Đếm số mặt cao (>=4) trong lần gần nhất
    const currentHighCount = (last.d1 >= 4 ? 1 : 0) + (last.d2 >= 4 ? 1 : 0) + (last.d3 >= 4 ? 1 : 0);
    
    // Nếu 3 viên đều cao -> khả năng về Xỉu
    if (currentHighCount === 3) {
        return { predict: 'Xỉu', confidence: 0.65, source: '3_high_reversal', weight: 0.1 };
    }
    
    // Nếu 3 viên đều thấp -> khả năng về Tài
    if (currentHighCount === 0) {
        return { predict: 'Tài', confidence: 0.65, source: '3_low_reversal', weight: 0.1 };
    }
    
    // Nếu tổng điểm quá cao (>15) -> khả năng giảm
    if (features.lastTotal > 15) {
        return { predict: 'Xỉu', confidence: 0.6, source: 'high_score_reversal', weight: 0.08 };
    }
    
    // Nếu tổng điểm quá thấp (<6) -> khả năng tăng
    if (features.lastTotal < 6) {
        return { predict: 'Tài', confidence: 0.6, source: 'low_score_reversal', weight: 0.08 };
    }
    
    return { predict: 'CHO', confidence: 0, source: 'dice_detail', weight: 0 };
}

function predictFromVolatility(features) {
    // Biến động cao -> dễ đảo chiều
    if (features.volatility > 4.5) {
        const lastResult = features.lastResult;
        return {
            predict: lastResult === 1 ? 'Xỉu' : 'Tài',
            confidence: 0.6,
            source: 'high_volatility_reversal',
            weight: 0.07
        };
    }
    
    // Biến động thấp -> dễ tiếp tục xu hướng
    if (features.volatility < 2.5 && features.volatility > 0) {
        const recentTrend = features.taiRate10 > 0.5 ? 'Tài' : 'Xỉu';
        return {
            predict: recentTrend,
            confidence: 0.55,
            source: 'low_volatility_continue',
            weight: 0.05
        };
    }
    
    return { predict: 'CHO', confidence: 0, source: 'volatility', weight: 0 };
}

function predictFromStreak(features, history) {
    const n = history.length;
    const streak = features.currentStreak;
    const lastResult = features.lastResult === 1 ? 'Tài' : 'Xỉu';
    
    // Streak dài >= 5 -> khả năng đảo chiều
    if (streak >= 5) {
        const oppositeResult = lastResult === 'Tài' ? 'Xỉu' : 'Tài';
        return {
            predict: oppositeResult,
            confidence: 0.55 + Math.min(0.2, (streak - 5) * 0.05),
            source: `streak_${streak}_reversal`,
            weight: 0.12
        };
    }
    
    // Streak ngắn 2-3 -> khả năng tiếp tục
    if (streak >= 2 && streak <= 3) {
        return {
            predict: lastResult,
            confidence: 0.55,
            source: `streak_${streak}_continue`,
            weight: 0.06
        };
    }
    
    return { predict: 'CHO', confidence: 0, source: 'streak', weight: 0 };
}

// ================= AUTO PING =================
async function pingAllApis() {
    while (true) {
        for (const gameId of Object.keys(GAME_CONFIG)) {
            try {
                await fetchAndCache(gameId);
            } catch (e) {}
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

// ================= ENDPOINTS =================
function createEndpoint(gameId) {
    return async (req, res) => {
        const key = req.query.key;
        if (key !== AUTH_KEY) {
            return res.status(403).json({ error: "Truy cập bị từ chối." });
        }
        
        const config = GAME_CONFIG[gameId];
        if (!config) {
            return res.status(400).json({ error: "Game không hợp lệ." });
        }
        
        initGameHistory(gameId);
        
        let data = await getCachedData(gameId);
        if (!data) {
            data = await fetchData(config.api_url);
            if (!data) {
                return res.status(500).json({ error: "Không thể lấy dữ liệu." });
            }
        }
        
        const items = data.list || data;
        const currentItem = items[0];
        const { result, point, dices, sessionId } = parseSession(currentItem, config.type);
        
        if (!result) {
            return res.status(500).json({ error: "Không có lịch sử." });
        }
        
        const resultText = result === 'T' ? 'Tài' : 'Xỉu';
        
        // ===== KIỂM TRA ANTI-CHEAT =====
        const integrityIssues = antiCheatEngine.checkDataIntegrity(gameId, currentItem, sessionId);
        
        // Kiểm định thống kê định kỳ (mỗi 10 phiên)
        const history = gameHistory[gameId] || [];
        if (history.length > 0 && history.length % 10 === 0) {
            antiCheatEngine.statisticalAudit(gameId, history);
        } else {
            antiCheatEngine.recoverTrust(gameId);
        }
        
        // Nếu đã xử lý phiên này
        if (lastProcessedSession[gameId] === sessionId) {
            const currentPred = pendingPredictions[gameId] || { prediction: 'Tài', confidence: 50 };
            const taiPercent = currentPred.prediction === 'Tài' ? currentPred.confidence : 100 - currentPred.confidence;
            const xiuPercent = 100 - taiPercent;
            
            return res.json({
                phien: sessionId,
                xuc_xac: dices,
                tong: point,
                ket_qua: resultText,
                phien_hien_tai: sessionId ? sessionId + 1 : "?",
                du_doan: currentPred.prediction,
                do_tin_cay: currentPred.prediction === 'CHO' ? "0%-0%" : `${taiPercent}%-${xiuPercent}%`,
                id: USER_ID,
                ai_model: ALGO_NAME,
                trust_score: antiCheatEngine.trustScores[gameId],
                trust_status: antiCheatEngine.getTrustStatus(gameId),
                lich_su_du_doan: predictionHistory[gameId].slice(0, 10)
            });
        }
        
        // Kiểm tra dự đoán trước
        if (pendingPredictions[gameId] && lastProcessedSession[gameId] !== sessionId) {
            const lastPred = pendingPredictions[gameId];
            
            if (lastPred.prediction !== 'CHO') {
                const isCorrect = (lastPred.prediction === 'Tài' && result === 'T') ||
                                 (lastPred.prediction === 'Xỉu' && result === 'X');
                
                const alreadySaved = predictionHistory[gameId].some(h => h.sessionId === sessionId);
                
                if (!alreadySaved) {
                    predictionHistory[gameId].unshift({
                        sessionId: sessionId,
                        prediction: lastPred.prediction,
                        actual: resultText,
                        isCorrect,
                        icon: isCorrect ? '✅' : '❌',
                        confidence: lastPred.confidence,
                        trustScore: antiCheatEngine.trustScores[gameId],
                        timestamp: new Date().toISOString()
                    });
                }
            }
            
            if (predictionHistory[gameId].length > 50) {
                predictionHistory[gameId] = predictionHistory[gameId].slice(0, 50);
            }
        }
        
        // Cập nhật session
        lastProcessedSession[gameId] = sessionId;
        
        // Thêm vào history
        addSession(gameId, sessionId, resultText, point, dices[0], dices[1], dices[2]);
        
        // Dự đoán phiên tiếp theo
        const predResult = predictAdvanced(gameId);
        
        pendingPredictions[gameId] = {
            prediction: predResult.prediction,
            confidence: predResult.confidence,
            reason: predResult.reason,
            timestamp: Date.now()
        };
        
        const taiPercent = predResult.prediction === 'Tài' ? predResult.confidence : 100 - predResult.confidence;
        const xiuPercent = 100 - taiPercent;
        
        const response = {
            phien: sessionId,
            xuc_xac: dices,
            tong: point,
            ket_qua: resultText,
            phien_hien_tai: sessionId ? sessionId + 1 : "?",
            du_doan: predResult.prediction,
            do_tin_cay: predResult.prediction === 'CHO' ? "0%-0%" : `${taiPercent}%-${xiuPercent}%`,
            id: USER_ID,
            ai_model: ALGO_NAME,
            engine_version: "v11.0",
            trust_score: antiCheatEngine.trustScores[gameId],
            trust_status: antiCheatEngine.getTrustStatus(gameId),
            reason: predResult.reason,
            total_sources: predResult.totalSources || 0,
            integrity_alerts: integrityIssues.length > 0 ? integrityIssues.map(i => i.type) : [],
            lich_su_du_doan: predictionHistory[gameId].slice(0, 10)
        };
        
        res.json(response);
    };
}

// ================= ENDPOINTS PHỤ =================
app.get('/api/history/:gameId', (req, res) => {
    const key = req.query.key;
    if (key !== AUTH_KEY) return res.status(403).json({ error: "Truy cập bị từ chối." });
    
    const gameId = req.params.gameId;
    const history = predictionHistory[gameId] || [];
    const total = history.length;
    const correct = history.filter(h => h.isCorrect).length;
    
    res.json({
        game: gameId,
        total_predictions: total,
        correct_predictions: correct,
        accuracy: total > 0 ? ((correct / total) * 100).toFixed(2) + '%' : '0%',
        trust_score: antiCheatEngine.trustScores[gameId] || 100,
        trust_status: antiCheatEngine.getTrustStatus(gameId),
        history
    });
});

app.get('/api/stats', (req, res) => {
    const key = req.query.key;
    if (key !== AUTH_KEY) return res.status(403).json({ error: "Truy cập bị từ chối." });
    
    const gameStats = {};
    let totalPreds = 0, totalCorr = 0;
    
    for (const gameId of Object.keys(GAME_CONFIG)) {
        const hist = predictionHistory[gameId] || [];
        const corr = hist.filter(h => h.isCorrect).length;
        gameStats[gameId] = {
            predictions: hist.length,
            correct: corr,
            accuracy: hist.length > 0 ? ((corr / hist.length) * 100).toFixed(2) + '%' : '0%',
            trust_score: antiCheatEngine.trustScores[gameId] || 100,
            trust_status: antiCheatEngine.getTrustStatus(gameId)
        };
        totalPreds += hist.length;
        totalCorr += corr;
    }
    
    res.json({
        total_predictions: totalPreds,
        total_correct: totalCorr,
        overall_accuracy: totalPreds > 0 ? ((totalCorr / totalPreds) * 100).toFixed(2) + '%' : '0%',
        games: gameStats
    });
});

app.get('/api/anti-cheat/:gameId', (req, res) => {
    const key = req.query.key;
    if (key !== AUTH_KEY) return res.status(403).json({ error: "Truy cập bị từ chối." });
    
    const gameId = req.params.gameId;
    const history = gameHistory[gameId] || [];
    
    let auditResult = null;
    if (history.length >= 50) {
        auditResult = antiCheatEngine.statisticalAudit(gameId, history);
    }
    
    res.json({
        game: gameId,
        trust_score: antiCheatEngine.trustScores[gameId] || 100,
        trust_status: antiCheatEngine.getTrustStatus(gameId),
        total_sessions: history.length,
        last_audit: auditResult?.metrics || null,
        recent_issues: auditResult?.issues || [],
        anomaly_log: antiCheatEngine.anomalyLog[gameId]?.slice(-10) || []
    });
});

// ================= START SERVER =================
app.use(express.json());

for (const gameId of Object.keys(GAME_CONFIG)) {
    app.get(`/api/${gameId}`, createEndpoint(gameId));
}

app.get('/api/health', (req, res) => {
    res.json({ 
        status: "healthy", 
        version: "v11.0",
        games: Object.keys(GAME_CONFIG).length,
        engines: {
            dice_graph: diceGraphEngine.updateCount > 0 ? 'active' : 'learning',
            pattern_cluster: Object.keys(patternClusterEngine.patterns).length > 0 ? 'active' : 'learning',
            anti_cheat: 'active'
        }
    });
});

app.get('/', (req, res) => {
    res.json({
        service: ALGO_NAME,
        version: "v11.0",
        endpoints: Object.keys(GAME_CONFIG).map(id => `/api/${id}`),
        features: [
            "Dice Graph Engine (Markov)",
            "Pattern Cluster Engine",
            "Statistical Anti-Cheat Detection",
            "Feature Extraction & Trend Analysis"
        ],
        auth: "?key=???"
    });
});

pingAllApis();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DICE MASTER AI v11.0 đang chạy...`);
    console.log(`📡 Port: ${PORT} | 🔑 Key: ${AUTH_KEY}`);
    console.log(`🎮 Games: ${Object.keys(GAME_CONFIG).join(', ')}`);
    console.log(`🛡️ Anti-Cheat: ACTIVE`);
    console.log(`🧠 Engines: Dice Graph | Pattern Cluster | Statistical Audit`);
});
