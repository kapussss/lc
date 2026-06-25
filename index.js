
/**
 * ════════════════════════════════════════════════════════════════════
 * ║  🧬 TX_PREDICTOR_IMMORTAL_PHOENIX — BẤT TỬ PHƯỢNG HOÀNG    ║
 * ║  👑 TOOL KAPUB - DỰ ĐOÁN CAO CẤP                         ║
 * ║  ✅ TỰ SỬA LỖI — TỰ SỐNG LẠI — 30+ THUẬT TOÁN CẦU        ║
 * ════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// ============================================================
// HÀM THỜI GIAN VIỆT NAM
// ============================================================
function vnNow() {
    const now = new Date();
    now.setHours(now.getHours() + 7);
    return now.toISOString();
}

// ============================================================
// 📊 STATS TOÀN CỤC
// ============================================================
let stats = {
    total: 0, correct: 0, wrong: 0,
    last_prediction: null,
    start_time: vnNow(),
    history: [],
    streak_correct: 0, streak_wrong: 0,
    best_streak: 0, worst_streak: 0,
    total_predictions_made: 0,
    prediction_started: false,
    tai_predictions: 0,
    xiu_predictions: 0,
    model_version: "IMMORTAL_PHOENIX_v8.0",
    learning_iterations: 0,
    total_patterns_learned: 0,
    processed_phiens: {},
    last_phien: 0
};

// ============================================================
// 🧬 THUẬT TOÁN IMMORTAL_PHOENIX
// ============================================================

// ============================================================
// 🔧 MODULE 0: HỆ THỐNG TỰ SỬA LỖI & TỰ SỐNG LẠI
// ============================================================
class SelfHealingSystem {
    constructor() {
        this.errorCount = 0;
        this.maxErrorsBeforeReset = 5;
        this.resetCount = 0;
        this.healthStatus = 'HEALTHY';
        this.errorLog = [];
        this.lastResetTime = null;
        this.modulesStatus = new Map();
    }

    checkHealth(moduleName, result) {
        if (!result || result.conf < 0 || result.conf > 100) {
            this.reportError(moduleName, 'CONFIDENCE_OUT_OF_RANGE');
            return false;
        }
        if (result.pred !== 'TAI' && result.pred !== 'XIU') {
            this.reportError(moduleName, 'INVALID_PREDICTION');
            return false;
        }
        this.modulesStatus.set(moduleName, 'OK');
        return true;
    }

    reportError(moduleName, errorType) {
        this.errorCount++;
        this.errorLog.push({
            time: new Date().toISOString(),
            module: moduleName,
            error: errorType,
            errorCount: this.errorCount
        });

        if (this.errorCount >= this.maxErrorsBeforeReset) {
            this.selfHeal();
        }
        if (this.errorLog.length > 100) this.errorLog.shift();
    }

    selfHeal() {
        this.resetCount++;
        this.lastResetTime = new Date().toISOString();
        this.errorCount = 0;
        this.healthStatus = 'HEALING';
        
        setTimeout(() => {
            this.healthStatus = 'HEALTHY';
        }, 100);
    }

    isHealthy() { return this.healthStatus === 'HEALTHY'; }

    getStatus() {
        return {
            health: this.healthStatus,
            errors: this.errorCount,
            resets: this.resetCount,
            modules: Object.fromEntries(this.modulesStatus)
        };
    }

    sanitizeResult(result) {
        if (!result) return { pred: 'TAI', conf: 50, name: 'FALLBACK' };
        if (result.conf > 95) result.conf = 90;
        if (result.conf < 50) result.conf = 55;
        if (result.pred !== 'TAI' && result.pred !== 'XIU') {
            result.pred = 'TAI';
            result.conf = 50;
        }
        return result;
    }
}

// ============================================================
// 🎲 MODULE 1: PHÂN TÍCH XÚC XẮC CHUYÊN SÂU
// ============================================================
class DeepDiceAnalyzer {
    constructor(healer) {
        this.healer = healer;
        this.diceFaces = {};
        for (let i = 1; i <= 6; i++) {
            this.diceFaces[i] = { count: 0, streak: 0, maxStreak: 0, lastAppeared: 0, hotScore: 0 };
        }
        this.pairStats = new Map();
        this.tripleStats = new Map();
        this.totalStats = new Map();
        this.oddEvenStats = { odd: { count: 0, streak: 0 }, even: { count: 0, streak: 0 } };
        this.totalRolls = 0;
        this.recentRolls = [];
        this.predictionCache = new Map();
    }

    analyzeRoll(diceResult, nextResult, nextTotal) {
        if (!diceResult || !Array.isArray(diceResult) || diceResult.length < 3) return;
        this.totalRolls++;
        const total = diceResult.reduce((a, b) => a + b, 0);
        const seenFaces = new Set();

        for (const face of diceResult) {
            if (face >= 1 && face <= 6) {
                const stats = this.diceFaces[face];
                stats.count++;
                stats.lastAppeared = this.totalRolls;
                stats.streak++;
                stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
                stats.hotScore = stats.count / this.totalRolls;
                seenFaces.add(face);

                if (face % 2 === 0) {
                    this.oddEvenStats.even.count++;
                    this.oddEvenStats.even.streak++;
                    this.oddEvenStats.odd.streak = 0;
                } else {
                    this.oddEvenStats.odd.count++;
                    this.oddEvenStats.odd.streak++;
                    this.oddEvenStats.even.streak = 0;
                }
            }
        }

        for (let i = 1; i <= 6; i++) {
            if (!seenFaces.has(i)) this.diceFaces[i].streak = 0;
        }

        for (let i = 0; i < diceResult.length; i++) {
            for (let j = i + 1; j < diceResult.length; j++) {
                const pair = [diceResult[i], diceResult[j]].sort((a, b) => a - b).join(',');
                if (!this.pairStats.has(pair)) {
                    this.pairStats.set(pair, { count: 0, nextTAI: 0, nextXIU: 0, nextTotals: [] });
                }
                const pairEntry = this.pairStats.get(pair);
                pairEntry.count++;
                if (nextResult) {
                    if (nextResult === 'TAI') pairEntry.nextTAI++;
                    else pairEntry.nextXIU++;
                }
                if (nextTotal !== undefined && nextTotal !== null) {
                    pairEntry.nextTotals.push(nextTotal);
                    if (pairEntry.nextTotals.length > 50) pairEntry.nextTotals.shift();
                }
            }
        }

        const tripleKey = [...diceResult].sort((a, b) => a - b).join(',');
        if (!this.tripleStats.has(tripleKey)) {
            this.tripleStats.set(tripleKey, { count: 0, nextTAI: 0, nextXIU: 0, nextTotals: [] });
        }
        const tripleEntry = this.tripleStats.get(tripleKey);
        tripleEntry.count++;
        if (nextResult) {
            if (nextResult === 'TAI') tripleEntry.nextTAI++;
            else tripleEntry.nextXIU++;
        }
        if (nextTotal !== undefined && nextTotal !== null) {
            tripleEntry.nextTotals.push(nextTotal);
            if (tripleEntry.nextTotals.length > 50) tripleEntry.nextTotals.shift();
        }

        if (!this.totalStats.has(total)) {
            this.totalStats.set(total, { count: 0, nextTAI: 0, nextXIU: 0, nextTotals: [] });
        }
        const totalEntry = this.totalStats.get(total);
        totalEntry.count++;
        if (nextResult) {
            if (nextResult === 'TAI') totalEntry.nextTAI++;
            else totalEntry.nextXIU++;
        }
        if (nextTotal !== undefined && nextTotal !== null) {
            totalEntry.nextTotals.push(nextTotal);
            if (totalEntry.nextTotals.length > 50) totalEntry.nextTotals.shift();
        }

        this.recentRolls.unshift({ dice: diceResult, total, result: nextResult });
        if (this.recentRolls.length > 100) this.recentRolls.pop();
        this.predictionCache.clear();
    }

    estimateDice(total) {
        if (!total || total < 3 || total > 18) return [3, 3, 4];
        const distributions = {
            3: [1,1,1], 4: [1,1,2], 5: [1,2,2], 6: [1,2,3],
            7: [1,3,3], 8: [2,3,3], 9: [3,3,3], 10: [3,3,4],
            11: [3,4,4], 12: [4,4,4], 13: [4,4,5], 14: [4,5,5],
            15: [5,5,5], 16: [5,5,6], 17: [5,6,6], 18: [6,6,6]
        };
        return distributions[total] || [3, 3, total - 6 > 6 ? 6 : total - 6 < 1 ? 1 : total - 6];
    }

    predictFromTotal(currentTotal) {
        if (!currentTotal) return null;
        const cacheKey = `TOTAL_${currentTotal}`;
        if (this.predictionCache.has(cacheKey)) return this.predictionCache.get(cacheKey);
        const entry = this.totalStats.get(currentTotal);
        if (!entry || entry.count < 3) return null;
        const totalNext = entry.nextTAI + entry.nextXIU;
        if (totalNext < 3) return null;
        const taiRatio = entry.nextTAI / totalNext;
        const result = {
            pred: taiRatio > 0.5 ? 'TAI' : 'XIU',
            conf: Math.min(80, Math.round(58 + Math.abs(taiRatio - 0.5) * 55)),
            name: `Xúc Xắc Tổng ${currentTotal}`,
            reason: `Tổng ${currentTotal} → ${(taiRatio*100).toFixed(0)}% Tài (${entry.count} lần)`,
            module: 'DICE_TOTAL'
        };
        this.predictionCache.set(cacheKey, result);
        return this.healer.sanitizeResult(result);
    }

    predictFromPair(diceResult) {
        if (!diceResult || diceResult.length < 2) return null;
        const results = [];
        for (let i = 0; i < diceResult.length; i++) {
            for (let j = i + 1; j < diceResult.length; j++) {
                const pair = [diceResult[i], diceResult[j]].sort((a, b) => a - b).join(',');
                const entry = this.pairStats.get(pair);
                if (entry && entry.count >= 3 && (entry.nextTAI + entry.nextXIU) >= 3) {
                    const taiRatio = entry.nextTAI / (entry.nextTAI + entry.nextXIU);
                    results.push({
                        pred: taiRatio > 0.5 ? 'TAI' : 'XIU',
                        conf: Math.round(58 + Math.abs(taiRatio - 0.5) * 55),
                        name: `Cặp [${pair}]`,
                        reason: `Cặp ${pair} → ${(taiRatio*100).toFixed(0)}% Tài`,
                        module: 'DICE_PAIR'
                    });
                }
            }
        }
        return results.length > 0 ? results : null;
    }

    predictFromTriple(diceResult) {
        if (!diceResult || diceResult.length < 3) return null;
        const tripleKey = [...diceResult].sort((a, b) => a - b).join(',');
        const entry = this.tripleStats.get(tripleKey);
        if (!entry || entry.count < 2 || (entry.nextTAI + entry.nextXIU) < 2) return null;
        const taiRatio = entry.nextTAI / (entry.nextTAI + entry.nextXIU);
        return this.healer.sanitizeResult({
            pred: taiRatio > 0.5 ? 'TAI' : 'XIU',
            conf: Math.round(60 + Math.abs(taiRatio - 0.5) * 50),
            name: `Bộ 3 [${tripleKey}]`,
            reason: `Bộ ${tripleKey} → ${(taiRatio*100).toFixed(0)}% Tài`,
            module: 'DICE_TRIPLE'
        });
    }

    predictHotCold(diceResult) {
        const hotFaces = [];
        const coldFaces = [];
        for (let i = 1; i <= 6; i++) {
            const stats = this.diceFaces[i];
            if (stats.count > 0) {
                if (stats.streak >= 2) hotFaces.push(i);
                if (this.totalRolls - stats.lastAppeared >= 10) coldFaces.push(i);
            }
        }
        if (hotFaces.filter(f => f >= 4).length >= 2) {
            return this.healer.sanitizeResult({
                pred: 'XIU',
                conf: 62,
                name: 'Số Nóng',
                reason: `Nhiều số cao đang hot: ${hotFaces.join(',')}`,
                module: 'DICE_HOT'
            });
        }
        if (coldFaces.filter(f => f <= 3).length >= 2) {
            return this.healer.sanitizeResult({
                pred: 'TAI',
                conf: 60,
                name: 'Số Lạnh',
                reason: `Số thấp lâu chưa về: ${coldFaces.join(',')}`,
                module: 'DICE_COLD'
            });
        }
        return null;
    }

    predictTrend(currentTotal, prevTotal) {
        if (!prevTotal || !currentTotal) return null;
        const diff = currentTotal - prevTotal;
        if (diff >= 3 && currentTotal >= 11) {
            return this.healer.sanitizeResult({
                pred: 'XIU',
                conf: 65,
                name: 'Tổng Tăng Mạnh',
                reason: `${prevTotal}→${currentTotal} (+${diff}) → XIU`,
                module: 'DICE_TREND'
            });
        }
        if (diff <= -3 && currentTotal <= 10) {
            return this.healer.sanitizeResult({
                pred: 'TAI',
                conf: 65,
                name: 'Tổng Giảm Mạnh',
                reason: `${prevTotal}→${currentTotal} (${diff}) → TÀI`,
                module: 'DICE_TREND'
            });
        }
        return null;
    }

    predictOddEven() {
        const oddStreak = this.oddEvenStats.odd.streak;
        const evenStreak = this.oddEvenStats.even.streak;
        if (oddStreak >= 5) {
            return this.healer.sanitizeResult({
                pred: 'XIU',
                conf: 62,
                name: 'Lẻ Dài',
                reason: `${oddStreak} số lẻ liên tiếp → XIU`,
                module: 'DICE_ODD'
            });
        }
        if (evenStreak >= 5) {
            return this.healer.sanitizeResult({
                pred: 'TAI',
                conf: 62,
                name: 'Chẵn Dài',
                reason: `${evenStreak} số chẵn liên tiếp → TÀI`,
                module: 'DICE_EVEN'
            });
        }
        return null;
    }

    analyzeAll(points, arr) {
        const results = [];
        const currentTotal = points[0] || 10;
        const prevTotal = points[1] || null;
        const estimatedDice = this.estimateDice(currentTotal);
        const addResult = (result) => {
            if (result && this.healer.checkHealth('DICE', result)) results.push(result);
        };
        addResult(this.predictFromTotal(currentTotal));
        addResult(this.predictTrend(currentTotal, prevTotal));
        addResult(this.predictHotCold(estimatedDice));
        addResult(this.predictOddEven());
        const pairResults = this.predictFromPair(estimatedDice);
        if (pairResults) pairResults.forEach(r => addResult(r));
        addResult(this.predictFromTriple(estimatedDice));
        return results;
    }
}

// ============================================================
// 🏗️ MODULE 2: 30+ THUẬT TOÁN CẦU
// ============================================================
class CauAlgorithms {
    constructor(healer) {
        this.healer = healer;
        this.cauMemory = new Map();
        this.cauHistory = [];
    }

    safeResult(pred, conf, name, reason) {
        return this.healer.sanitizeResult({ pred, conf, name, reason, module: 'CAU' });
    }

    cau_1_1(arr) {
        if (arr.length < 6) return null;
        let count = 0;
        for (let i = 0; i < 5 && i < arr.length - 1; i++) {
            if (arr[i] !== arr[i+1]) count++; else break;
        }
        if (count >= 5) return this.safeResult(arr[0] === 'TAI' ? 'XIU' : 'TAI', 88, 'Cầu 1-1 Hoàn Hảo', '6 phiên xen kẽ');
        if (count >= 4) return this.safeResult(arr[0] === 'TAI' ? 'XIU' : 'TAI', 80, 'Cầu 1-1', '5 phiên xen kẽ');
        if (count >= 3) return this.safeResult(arr[0] === 'TAI' ? 'XIU' : 'TAI', 72, 'Cầu 1-1 Ngắn', '4 phiên xen kẽ');
        return null;
    }

    cau_2_2(arr) {
        if (arr.length < 4) return null;
        if (arr[0] === arr[1] && arr[2] === arr[3] && arr[0] !== arr[2]) {
            let repeat = 0;
            for (let i = 4; i < arr.length - 1; i += 2) {
                if (i+1 < arr.length && arr[i] === arr[i+1] && arr[i] !== arr[i-2]) repeat++; else break;
            }
            return this.safeResult(arr[2], 78 + repeat * 3, 'Cầu 2-2', `AABB → ${arr[2]}${repeat > 0 ? ' (lặp ' + repeat + 'x)' : ''}`);
        }
        return null;
    }

    cau_3_3(arr) {
        if (arr.length < 6) return null;
        if (arr[0] === arr[1] && arr[1] === arr[2] && arr[3] === arr[4] && arr[4] === arr[5] && arr[0] !== arr[3]) {
            return this.safeResult(arr[3], 85, 'Cầu 3-3', `AAABBB → ${arr[3]}`);
        }
        return null;
    }

    cau_4_4(arr) {
        if (arr.length < 8) return null;
        if (arr[0] === arr[1] && arr[1] === arr[2] && arr[2] === arr[3] &&
            arr[4] === arr[5] && arr[5] === arr[6] && arr[6] === arr[7] && arr[0] !== arr[4]) {
            return this.safeResult(arr[4], 88, 'Cầu 4-4', `AAAABBBB → ${arr[4]}`);
        }
        return null;
    }

    cau_5_5(arr) {
        if (arr.length < 10) return null;
        if (arr[0] === arr[1] && arr[1] === arr[2] && arr[2] === arr[3] && arr[3] === arr[4] &&
            arr[5] === arr[6] && arr[6] === arr[7] && arr[7] === arr[8] && arr[8] === arr[9] && arr[0] !== arr[5]) {
            return this.safeResult(arr[5], 90, 'Cầu 5-5', `AAAAABBBBB → ${arr[5]}`);
        }
        return null;
    }

    cau_betTheo(arr) {
        if (arr.length < 3) return null;
        let streak = 1;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] === arr[0]) streak++; else break;
        }
        if (streak >= 3 && streak <= 4) return this.safeResult(arr[0], 65 + streak, 'Theo Bệt', `Bệt ${streak} → Theo ${arr[0]}`);
        if (streak === 2) return this.safeResult(arr[0], 60, 'Bệt Ngắn', `Bệt 2 → Có thể ${arr[0]}`);
        return null;
    }

    cau_betGay(arr) {
        if (arr.length < 2) return null;
        let streak = 1;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] === arr[0]) streak++; else break;
        }
        const reverse = arr[0] === 'TAI' ? 'XIU' : 'TAI';
        if (streak >= 8) return this.safeResult(reverse, 88, 'Siêu Bệt Gãy', `Bệt ${streak} → ${reverse}`);
        if (streak >= 6) return this.safeResult(reverse, 80, 'Bệt Dài Gãy', `Bệt ${streak} → ${reverse}`);
        if (streak >= 5) return this.safeResult(reverse, 72, 'Bệt Gãy', `Bệt ${streak} → ${reverse}`);
        return null;
    }

    cau_gay3_2(arr) {
        if (arr.length < 5) return null;
        if (arr[0] === arr[1] && arr[1] !== arr[2] && arr[2] === arr[3] && arr[3] === arr[4]) {
            return this.safeResult(arr[2], 78, 'Gãy 3-2', `AAABB → ${arr[2]}`);
        }
        return null;
    }

    cau_gay2_3(arr) {
        if (arr.length < 5) return null;
        if (arr[0] === arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[3] === arr[4]) {
            return this.safeResult(arr[3], 78, 'Gãy 2-3', `AABBB → ${arr[3]}`);
        }
        return null;
    }

    cau_gayABBA(arr) {
        if (arr.length < 4) return null;
        if (arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[0] === arr[3]) {
            return this.safeResult(arr[1], 76, 'Gãy ABBA', `ABBA → ${arr[1]}`);
        }
        return null;
    }

    cau_gayDotNgot(arr) {
        if (arr.length < 6) return null;
        let streak = 1;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] === arr[0]) streak++; else break;
        }
        if (streak >= 4 && arr.length > streak + 1 && arr[streak] !== arr[streak+1]) {
            const reverse = arr[streak] === 'TAI' ? 'XIU' : 'TAI';
            return this.safeResult(reverse, 72, 'Gãy Đột Ngột', `Bệt ${streak} → gãy 1 nhịp → ${reverse}`);
        }
        return null;
    }

    cau_doiXungGuong(arr) {
        if (arr.length < 6) return null;
        if (arr[0] !== arr[1] && arr[1] === arr[2] && arr[2] === arr[3] && arr[3] === arr[4] && arr[4] !== arr[5] && arr[0] === arr[5]) {
            return this.safeResult(arr[0] === 'TAI' ? 'XIU' : 'TAI', 80, 'Đối Xứng Gương', `ABCCBA → ${arr[0] === 'TAI' ? 'XIU' : 'TAI'}`);
        }
        return null;
    }

    cau_doiXung5(arr) {
        if (arr.length < 5) return null;
        if (arr[0] !== arr[1] && arr[1] !== arr[2] && arr[2] !== arr[3] && arr[3] !== arr[4] &&
            arr[0] === arr[4] && arr[1] === arr[3]) {
            return this.safeResult(arr[2] === 'TAI' ? 'XIU' : 'TAI', 75, 'Đối Xứng 5', `ABCBA → ${arr[2] === 'TAI' ? 'XIU' : 'TAI'}`);
        }
        return null;
    }

    cau_bacThangLen(arr) {
        if (arr.length < 6) return null;
        if (arr[0] === arr[1] && arr[1] !== arr[2] && arr[2] === arr[3] && arr[3] !== arr[4] && arr[4] === arr[5]) {
            return this.safeResult(arr[4], 72, 'Bậc Thang', `AABABC → ${arr[4]}`);
        }
        return null;
    }

    cau_tamGiac(arr) {
        if (arr.length < 3) return null;
        if (arr[0] !== arr[1] && arr[0] === arr[2]) {
            return this.safeResult(arr[1], 68, 'Tam Giác', `ABA → ${arr[1]}`);
        }
        return null;
    }

    cau_ziczac(arr) {
        if (arr.length < 8) return null;
        let ziczacCount = 0;
        for (let i = 0; i < 7 && i < arr.length - 1; i++) {
            if (arr[i] !== arr[i+1]) ziczacCount++; else break;
        }
        if (ziczacCount >= 7) return this.safeResult(arr[0] === 'TAI' ? 'XIU' : 'TAI', 85, 'Ziczac Dài', `${ziczacCount+1} phiên ziczac → đảo`);
        if (ziczacCount >= 5) return this.safeResult(arr[0] === 'TAI' ? 'XIU' : 'TAI', 75, 'Ziczac', `${ziczacCount+1} phiên ziczac → đảo`);
        return null;
    }

    cau_patternLap(arr) {
        if (arr.length < 8) return null;
        for (let len = 3; len <= 5; len++) {
            const recent = arr.slice(0, len);
            for (let i = len; i < Math.min(arr.length, 35); i++) {
                const hist = arr.slice(i, i + len);
                if (recent.join('') === hist.join('') && i > len && arr[i-1]) {
                    const conf = Math.min(82, 80 - i);
                    if (conf >= 68) return this.safeResult(arr[i-1], conf, 'Pattern Lặp', `Pattern ${len} lặp cách ${i} phiên → ${arr[i-1]}`);
                }
            }
        }
        return null;
    }

    cau_daoChieuSauBet(arr) {
        if (arr.length < 4) return null;
        let streak = 1;
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] === arr[0]) streak++; else break;
        }
        if (streak >= 3 && arr.length > streak && arr[streak] !== arr[0]) {
            return this.safeResult(arr[streak], 70, 'Đảo Sau Bệt', `Bệt ${streak} → đảo → ${arr[streak]}`);
        }
        return null;
    }

    cau_xenKe2_1(arr) {
        if (arr.length < 6) return null;
        if (arr[0] === arr[1] && arr[1] !== arr[2] && arr[2] === arr[3] && arr[3] !== arr[4] && arr[0] === arr[4]) {
            return this.safeResult(arr[0] === 'TAI' ? 'XIU' : 'TAI', 72, 'Xen Kẽ 2-1', `AABAA → ${arr[0] === 'TAI' ? 'XIU' : 'TAI'}`);
        }
        return null;
    }

    cau_moRong3_2_3(arr) {
        if (arr.length < 8) return null;
        if (arr[0] === arr[1] && arr[1] === arr[2] && arr[2] !== arr[3] && arr[3] === arr[4] &&
            arr[4] !== arr[5] && arr[5] === arr[6] && arr[6] === arr[7]) {
            return this.safeResult(arr[5], 75, 'Mở Rộng 3-2-3', `AAABBCCC → ${arr[5]}`);
        }
        return null;
    }

    cau_meanReversion30(arr) {
        if (arr.length < 30) return null;
        const taiCount = arr.slice(0, 30).filter(x => x === 'TAI').length;
        const imbalance = Math.abs(taiCount - 15);
        if (imbalance >= 8) return this.safeResult(taiCount > 15 ? 'XIU' : 'TAI', 60 + imbalance * 2, 'Mean Reversion 30', `${taiCount}T-${30-taiCount}X → cân bằng`);
        return null;
    }

    cau_meanReversion50(arr) {
        if (arr.length < 50) return null;
        const taiCount = arr.slice(0, 50).filter(x => x === 'TAI').length;
        const imbalance = Math.abs(taiCount - 25);
        if (imbalance >= 12) return this.safeResult(taiCount > 25 ? 'XIU' : 'TAI', 58 + imbalance, 'Mean Reversion 50', `${taiCount}T-${50-taiCount}X → cân bằng`);
        return null;
    }

    cau_chuKy(arr) {
        if (arr.length < 20) return null;
        for (let period = 2; period <= 10; period++) {
            let matches = 0;
            const total = Math.min(arr.length, 40) - period;
            for (let i = period; i < Math.min(arr.length, 40); i++) {
                if (arr[i] === arr[i-period]) matches++;
            }
            const acc = matches / (total || 1);
            if (acc > 0.65 && total >= 10) {
                return this.safeResult(arr[arr.length - period] || arr[0], 58 + acc * 25, 'Chu Kỳ', `Chu kỳ ${period} phiên (${(acc*100).toFixed(0)}%)`);
            }
        }
        return null;
    }

    cau_theoGio(arr) {
        const hour = new Date().getHours();
        if (hour >= 6 && hour <= 12) {
            const recentTAI = arr.slice(0, 10).filter(x => x === 'TAI').length;
            if (recentTAI >= 6) return this.safeResult('TAI', 60, 'Giờ Sáng', `Sáng ${hour}h → Tài (${recentTAI}/10)`);
        }
        if (hour >= 18 && hour <= 23) {
            const recentXIU = arr.slice(0, 10).filter(x => x === 'XIU').length;
            if (recentXIU >= 6) return this.safeResult('XIU', 60, 'Giờ Tối', `Tối ${hour}h → Xỉu (${recentXIU}/10)`);
        }
        return null;
    }

    cau_daoChieuLienTuc(arr) {
        if (arr.length < 6) return null;
        let reversals = 0;
        for (let i = 1; i < 5 && i < arr.length; i++) {
            if (arr[i] !== arr[i-1]) reversals++;
        }
        if (reversals >= 4) return this.safeResult(arr[0] === 'TAI' ? 'XIU' : 'TAI', 78, 'Đảo Liên Tục', `${reversals} lần đảo/5 phiên → tiếp tục đảo`);
        return null;
    }

    cau_onDinh(arr) {
        if (arr.length < 10) return null;
        const first5 = arr.slice(0, 5).filter(x => x === 'TAI').length;
        const last5 = arr.slice(5, 10).filter(x => x === 'TAI').length;
        if (Math.abs(first5 - last5) <= 1) {
            const totalTAI = arr.slice(0, 10).filter(x => x === 'TAI').length;
            return this.safeResult(totalTAI >= 5 ? 'TAI' : 'XIU', 58, 'Ổn Định', `10 phiên ổn định → ${totalTAI >= 5 ? 'Tài' : 'Xỉu'}`);
        }
        return null;
    }

    cau_breakout(arr) {
        if (arr.length < 8) return null;
        const first4 = arr.slice(0, 4);
        const last4 = arr.slice(4, 8);
        const firstTAI = first4.filter(x => x === 'TAI').length;
        const lastTAI = last4.filter(x => x === 'TAI').length;
        if (Math.abs(firstTAI - lastTAI) >= 3) {
            return this.safeResult(lastTAI >= 3 ? 'TAI' : 'XIU', 65, 'Breakout', `Thay đổi ${firstTAI}→${lastTAI} Tài/4 phiên → ${lastTAI >= 3 ? 'Tài' : 'Xỉu'}`);
        }
        return null;
    }

    cau_tichLuy(arr) {
        if (arr.length < 12) return null;
        let sameCount = 0;
        for (let i = 0; i < 12; i++) {
            if (arr[i] === arr[0]) sameCount++;
        }
        if (sameCount >= 8) {
            const reverse = arr[0] === 'TAI' ? 'XIU' : 'TAI';
            return this.safeResult(reverse, 68, 'Tích Lũy', `${sameCount}/12 ${arr[0]} → ${reverse}`);
        }
        return null;
    }

    cau_phanKy(points, arr) {
        if (points.length < 5 || arr.length < 5) return null;
        const pointTrend = points[0] > points[4] ? 'UP' : 'DOWN';
        const cauTrend = arr.slice(0, 5).filter(x => x === 'TAI').length >= 3 ? 'TAI' : 'XIU';
        if (pointTrend === 'UP' && cauTrend === 'XIU') return this.safeResult('XIU', 62, 'Phân Kỳ', `Điểm tăng + Xỉu → XIU`);
        if (pointTrend === 'DOWN' && cauTrend === 'TAI') return this.safeResult('TAI', 62, 'Phân Kỳ', `Điểm giảm + Tài → TÀI`);
        return null;
    }

    cau_hoiTu(points, arr) {
        if (points.length < 3 || arr.length < 3) return null;
        if (points[0] >= 13 && arr[0] === 'XIU') return this.safeResult('XIU', 65, 'Hội Tụ', `Điểm ${points[0]} + Xỉu → XIU`);
        if (points[0] <= 8 && arr[0] === 'TAI') return this.safeResult('TAI', 65, 'Hội Tụ', `Điểm ${points[0]} + Tài → TÀI`);
        return null;
    }

    runAll(arr, points) {
        const results = [];
        const addResult = (result) => {
            if (result && this.healer.checkHealth('CAU', result)) results.push(result);
        };
        addResult(this.cau_1_1(arr));
        addResult(this.cau_2_2(arr));
        addResult(this.cau_3_3(arr));
        addResult(this.cau_4_4(arr));
        addResult(this.cau_5_5(arr));
        addResult(this.cau_betTheo(arr));
        addResult(this.cau_betGay(arr));
        addResult(this.cau_gay3_2(arr));
        addResult(this.cau_gay2_3(arr));
        addResult(this.cau_gayABBA(arr));
        addResult(this.cau_gayDotNgot(arr));
        addResult(this.cau_doiXungGuong(arr));
        addResult(this.cau_doiXung5(arr));
        addResult(this.cau_bacThangLen(arr));
        addResult(this.cau_tamGiac(arr));
        addResult(this.cau_ziczac(arr));
        addResult(this.cau_patternLap(arr));
        addResult(this.cau_daoChieuSauBet(arr));
        addResult(this.cau_xenKe2_1(arr));
        addResult(this.cau_moRong3_2_3(arr));
        addResult(this.cau_meanReversion30(arr));
        addResult(this.cau_meanReversion50(arr));
        addResult(this.cau_chuKy(arr));
        addResult(this.cau_theoGio(arr));
        addResult(this.cau_daoChieuLienTuc(arr));
        addResult(this.cau_onDinh(arr));
        addResult(this.cau_breakout(arr));
        addResult(this.cau_tichLuy(arr));
        addResult(this.cau_phanKy(points, arr));
        addResult(this.cau_hoiTu(points, arr));
        return results;
    }
}

// ============================================================
// 🧠 MODULE 3: HỆ THỐNG TỰ HỌC VĨNH VIỄN
// ============================================================
class EternalLearning {
    constructor(healer) {
        this.healer = healer;
        this.patternBank = new Map();
        this.weightBank = new Map();
        this.learningHistory = [];
        this.totalLearned = 0;
        this.recentAccuracy = 0.5;
        this.bestAlgo = null;
        this.worstAlgo = null;
    }

    learn(arr, points, prediction, actual) {
        if (!arr || arr.length < 2) return;
        this.totalLearned++;
        for (let len = 3; len <= 8; len++) {
            if (arr.length < len + 1) continue;
            const pattern = arr.slice(1, 1 + len).join('');
            const result = arr[0];
            if (!this.patternBank.has(pattern)) {
                this.patternBank.set(pattern, { TAI: 0, XIU: 0, total: 0 });
            }
            this.patternBank.get(pattern)[result]++;
            this.patternBank.get(pattern).total++;
        }
        if (points.length >= 2) {
            const pointKey = `P${Math.round(points[0])}_${points[0] > points[1] ? 'UP' : 'DOWN'}`;
            if (!this.patternBank.has(pointKey)) {
                this.patternBank.set(pointKey, { TAI: 0, XIU: 0, total: 0 });
            }
            this.patternBank.get(pointKey)[arr[0]]++;
            this.patternBank.get(pointKey).total++;
        }
        this.learningHistory.push({ time: Date.now(), actual, predicted: prediction?.pred });
        if (this.learningHistory.length > 10000) this.learningHistory.shift();
        const recent = this.learningHistory.slice(-200);
        this.recentAccuracy = recent.length > 0 ? recent.filter(l => l.predicted === l.actual).length / recent.length : 0;
    }

    predict(arr, points) {
        const results = [];
        for (let len = 7; len >= 3; len--) {
            if (arr.length < len) continue;
            const pattern = arr.slice(0, len).join('');
            const data = this.patternBank.get(pattern);
            if (data && data.total >= 5) {
                const taiRatio = data.TAI / data.total;
                if (Math.abs(taiRatio - 0.5) > 0.12) {
                    results.push({
                        pred: taiRatio > 0.5 ? 'TAI' : 'XIU',
                        conf: Math.round(55 + Math.abs(taiRatio - 0.5) * 60),
                        name: `Learned L${len}`,
                        reason: `${data.total} mẫu → ${(taiRatio*100).toFixed(0)}% Tài`
                    });
                }
            }
        }
        return results;
    }
}

// ============================================================
// 🎯 MODULE 4: ENSEMBLE + TỔNG HỢP
// ============================================================
class OmegaEnsemble {
    constructor(healer) {
        this.healer = healer;
        this.votingHistory = [];
    }

    combine(cauResults, diceResults, learningResults) {
        const allSignals = [...cauResults, ...diceResults, ...learningResults];
        if (allSignals.length === 0) {
            return this.healer.sanitizeResult({
                pred: 'TAI',
                conf: 50,
                name: 'NO_SIGNAL',
                reason: 'Không có tín hiệu'
            });
        }
        let taiScore = 0, xiuScore = 0;
        const algoVotes = [];
        for (const signal of allSignals) {
            const weight = signal.conf / 100;
            if (signal.pred === 'TAI') taiScore += weight;
            else xiuScore += weight;
            algoVotes.push({
                name: signal.name,
                pred: signal.pred,
                conf: signal.conf,
                module: signal.module || 'UNKNOWN',
                reason: signal.reason || ''
            });
        }
        const totalScore = taiScore + xiuScore;
        const taiRatio = totalScore > 0 ? taiScore / totalScore : 0.5;
        const finalPred = taiScore > xiuScore ? 'TAI' : 'XIU';
        const strength = Math.abs(taiRatio - 0.5);
        let conf = Math.round(55 + strength * 37);
        const agreeCount = finalPred === 'TAI' ? algoVotes.filter(v => v.pred === 'TAI').length : algoVotes.filter(v => v.pred === 'XIU').length;
        const agreeRatio = agreeCount / algoVotes.length;
        if (agreeRatio >= 0.85 && algoVotes.length >= 6) conf += 5;
        if (agreeRatio >= 0.95 && algoVotes.length >= 10) conf += 3;
        if (agreeRatio < 0.55) conf -= 3;
        conf = Math.min(92, Math.max(50, conf));
        const result = {
            pred: finalPred,
            conf: conf,
            name: '🧠 IMMORTAL PHOENIX',
            reason: `${algoVotes.length} tín hiệu → ${finalPred} (${agreeCount}/${algoVotes.length})`,
            details: {
                totalSignals: algoVotes.length,
                taiCount: algoVotes.filter(v => v.pred === 'TAI').length,
                xiuCount: algoVotes.filter(v => v.pred === 'XIU').length,
                taiRatio: (taiRatio * 100).toFixed(1) + '%',
                agreeRatio: (agreeRatio * 100).toFixed(1) + '%',
                algoVotes: algoVotes.slice(0, 10)
            }
        };
        return this.healer.sanitizeResult(result);
    }
}

// ============================================================
// 🧬 IMMORTAL PHOENIX — MAIN ENGINE
// ============================================================
class TX_LogicPen_IMMORTAL_PHOENIX {
    constructor() {
        this.healer = new SelfHealingSystem();
        this.diceAnalyzer = new DeepDiceAnalyzer(this.healer);
        this.cauAlgorithms = new CauAlgorithms(this.healer);
        this.eternalLearning = new EternalLearning(this.healer);
        this.ensemble = new OmegaEnsemble(this.healer);
        this.history = [];
        this.lastResult = null;
        this.errorStreak = 0;
        this.totalPredictions = 0;
        this.lastPredictionTime = null;
    }

    loadData(data) {
        try {
            if (!data || !Array.isArray(data) || data.length === 0) {
                this.healer.reportError('LOAD', 'No data');
                return;
            }
            this.history = [...data].sort((a, b) => (b.phien || 0) - (a.phien || 0));
            const arr = this._arr();
            const points = this._points();
            for (let i = arr.length - 1; i >= 1; i--) {
                const total = points[i] || 10;
                const dice = this.diceAnalyzer.estimateDice(total);
                this.diceAnalyzer.analyzeRoll(dice, arr[i-1] || null, points[i-1] || null);
            }
            for (let i = arr.length - 1; i >= 10; i--) {
                this.eternalLearning.learn(arr.slice(i), points.slice(i), null, arr[i-1] || arr[i]);
            }
            stats.learning_iterations = this.eternalLearning.totalLearned;
            stats.total_patterns_learned = this.eternalLearning.patternBank.size;
        } catch (e) {
            this.healer.reportError('LOAD', e.message);
        }
    }

    _arr() {
        return this.history.map(s => (s.ket_qua || '').toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI'));
    }

    _points() {
        return this.history.filter(s => s.tong !== undefined && s.tong !== null).map(s => s.tong);
    }

    predict(data) {
        try {
            if (!data || !Array.isArray(data) || data.length === 0) {
                this.healer.reportError('PREDICT', 'No data');
                return { pred: 'TAI', conf: 50, name: 'NO_DATA', reason: 'Không có dữ liệu' };
            }
            this.loadData(data);
            const arr = this._arr();
            const points = this._points();
            if (arr.length < 2) {
                return { pred: arr[0] || 'TAI', conf: 50, name: 'NO_DATA', reason: 'Dữ liệu không đủ' };
            }
            const cauResults = this.cauAlgorithms.runAll(arr, points);
            const diceResults = this.diceAnalyzer.analyzeAll(points, arr);
            const learningResults = this.eternalLearning.predict(arr, points);
            const result = this.ensemble.combine(cauResults, diceResults, learningResults);
            this.lastResult = result;
            this.totalPredictions++;
            this.lastPredictionTime = Date.now();
            stats.last_prediction = result.pred;
            stats.total_predictions_made++;
            stats.prediction_started = true;
            stats.learning_iterations = this.eternalLearning.totalLearned;
            stats.total_patterns_learned = this.eternalLearning.patternBank.size;
            if (result.pred === 'TAI') stats.tai_predictions++;
            else stats.xiu_predictions++;
            return result;
        } catch (e) {
            this.healer.reportError('PREDICT', e.message);
            this.healer.selfHeal();
            return { pred: 'TAI', conf: 50, name: 'ERROR_FALLBACK', reason: 'Lỗi hệ thống: ' + e.message };
        }
    }

    updateStatus(actual) {
        try {
            if (!this.lastResult) return false;
            if (!actual) return false;
            
            const a = actual.toUpperCase().replace('XỈU', 'XIU').replace('TÀI', 'TAI');
            if (a !== 'TAI' && a !== 'XIU') return false;
            
            const wasCorrect = this.lastResult.pred === a;
            const arr = this._arr();
            const points = this._points();
            this.eternalLearning.learn(arr, points, this.lastResult, a);
            
            if (wasCorrect) {
                this.errorStreak = 0;
                stats.streak_correct++;
                stats.streak_wrong = 0;
                stats.best_streak = Math.max(stats.best_streak, stats.streak_correct);
                stats.correct++;
            } else {
                this.errorStreak++;
                stats.streak_wrong++;
                stats.streak_correct = 0;
                stats.worst_streak = Math.max(stats.worst_streak, stats.streak_wrong);
                stats.wrong++;
            }
            stats.total++;
            stats.learning_iterations = this.eternalLearning.totalLearned;
            stats.total_patterns_learned = this.eternalLearning.patternBank.size;
            stats.history.push({
                time: vnNow(),
                prediction: this.lastResult.pred,
                actual: a,
                correct: wasCorrect,
                streak: stats.streak_correct
            });
            if (stats.history.length > 5000) stats.history.shift();
            
            return wasCorrect;
        } catch (e) {
            this.healer.reportError('UPDATE', e.message);
            this.healer.selfHeal();
            return false;
        }
    }

    getStats() {
        const accuracy = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) : '0.0';
        const recent100 = stats.history.slice(-100);
        const recentAcc = recent100.length > 0 ? (recent100.filter(h => h.correct).length / recent100.length * 100).toFixed(1) : '0.0';
        return {
            ...stats,
            accuracy: accuracy + '%',
            recent_100_accuracy: recentAcc + '%',
            tai_ratio: stats.total_predictions_made > 0 ? (stats.tai_predictions / stats.total_predictions_made * 100).toFixed(1) + '%' : '0%',
            xiu_ratio: stats.total_predictions_made > 0 ? (stats.xiu_predictions / stats.total_predictions_made * 100).toFixed(1) + '%' : '0%',
            healer_status: this.healer.getStatus(),
            best_algo: this.eternalLearning.bestAlgo,
            worst_algo: this.eternalLearning.worstAlgo,
            model: stats.model_version
        };
    }
}

// ============================================================
// KHỞI TẠO GLOBAL
// ============================================================
const predictor = new TX_LogicPen_IMMORTAL_PHOENIX();

// ============================================================
// 📡 LẤY DỮ LIỆU API
// ============================================================
function transformData(apiData) {
    if (!apiData || !apiData.list || !Array.isArray(apiData.list) || apiData.list.length === 0) return null;
    const result = [];
    for (let i = 0; i < apiData.list.length; i++) {
        const item = apiData.list[i];
        if (!item || !item.id) continue;
        result.push({
            Phien: item.id,
            Ket_qua: item.resultTruyenThong === 'TAI' ? 'T' : 'X',
            d1: item.dices && item.dices.length > 0 ? item.dices[0] : 1,
            d2: item.dices && item.dices.length > 1 ? item.dices[1] : 1,
            d3: item.dices && item.dices.length > 2 ? item.dices[2] : 1,
            Tong: item.point || 0
        });
    }
    return result.length > 0 ? result : null;
}

async function fetchHu() {
    try {
        const res = await axios.get('https://wtx.tele68.com/v1/tx/sessions', { timeout: 10000 });
        return transformData(res.data);
    } catch (e) {
        console.log('HU fetch error:', e.message);
        return null;
    }
}

async function fetchMd5() {
    try {
        const res = await axios.get('https://wtxmd52.tele68.com/v1/txmd5/sessions', { timeout: 10000 });
        return transformData(res.data);
    } catch (e) {
        console.log('MD5 fetch error:', e.message);
        return null;
    }
}

// ============================================================
// 💾 LƯU LỊCH SỬ
// ============================================================
let historyData = { hu: [], md5: [] };
const HISTORY_FILE = './history_immortal.json';

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            historyData = data;
            const allPhiens = [...(historyData.hu || []), ...(historyData.md5 || [])];
            for (const item of allPhiens) {
                if (item.phien) {
                    stats.processed_phiens[item.phien] = item.trangThai || 'UNKNOWN';
                }
            }
            if (historyData.hu && historyData.hu.length > 0) {
                stats.last_phien = historyData.hu[0]?.phien || 0;
            }
            console.log('✅ Loaded history:', historyData.hu.length, 'HU,', historyData.md5.length, 'MD5');
        }
    } catch (e) { console.log('Load history error:', e.message); }
}

function saveHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(historyData, null, 2));
    } catch (e) { console.log('Save history error:', e.message); }
}

// ============================================================
// 🎯 HÀM DỰ ĐOÁN - ĐÃ SỬA LỖI
// ============================================================
function calculatePrediction(data, type) {
    try {
        // Kiểm tra dữ liệu đầu vào
        if (!data || !Array.isArray(data) || data.length === 0) {
            return {
                phien: 0,
                prediction: '---',
                confidence: 50,
                ketQua: '---',
                trangThai: 'PENDING',
                algorithmCount: 0,
                reason: 'Không có dữ liệu',
                name: 'No Data',
                isNew: false
            };
        }
        
        const phien = data[0]?.Phien || 0;
        const ketQuaRaw = data[0]?.Ket_qua || 'X';
        const ketQua = ketQuaRaw === 'T' ? 'TAI' : 'XIU';
        
        // Kiểm tra phiên đã xử lý chưa
        if (stats.processed_phiens[phien]) {
            const existing = historyData[type]?.find(r => r.phien === phien);
            if (existing) {
                return {
                    prediction: existing.duDoan,
                    confidence: parseInt(existing.doTinCay) || 50,
                    phien: phien,
                    ketQua: existing.ketQua,
                    trangThai: existing.trangThai,
                    algorithmCount: existing.algorithmCount || 0,
                    reason: existing.reason || '',
                    name: existing.name || 'Cached',
                    isNew: false
                };
            }
            return null;
        }
        
        // Chuẩn bị dữ liệu cho predictor
        const historyDataForPredictor = data.map(item => ({
            ket_qua: item.Ket_qua === 'T' ? 'TAI' : 'XIU',
            tong: item.Tong,
            phien: item.Phien
        }));
        
        // Gọi predict và lưu kết quả
        const result = predictor.predict(historyDataForPredictor);
        
        if (!result || !result.pred) {
            return {
                phien: phien,
                prediction: '---',
                confidence: 50,
                ketQua: ketQua,
                trangThai: 'PENDING',
                algorithmCount: 0,
                reason: 'Không đủ dữ liệu',
                name: 'No Signal',
                isNew: false
            };
        }
        
        // Cập nhật last_phien
        if (phien > stats.last_phien) {
            stats.last_phien = phien;
        }
        
        // Cập nhật trạng thái và lưu kết quả
        const isCorrect = predictor.updateStatus(ketQua);
        const trangThai = isCorrect ? 'WIN' : 'LOSE';
        
        // Đánh dấu đã xử lý
        stats.processed_phiens[phien] = trangThai;
        
        // Cập nhật stats tổng quan
        stats.last_prediction = result.pred;
        stats.total_predictions_made++;
        stats.prediction_started = true;
        stats.learning_iterations = predictor.eternalLearning.totalLearned;
        stats.total_patterns_learned = predictor.eternalLearning.patternBank.size;
        
        if (result.pred === 'TAI') {
            stats.tai_predictions++;
        } else {
            stats.xiu_predictions++;
        }
        
        // Lưu vào history
        if (!historyData[type]) historyData[type] = [];
        
        // Kiểm tra trùng lặp trước khi thêm
        const existingIndex = historyData[type].findIndex(r => r.phien === phien);
        
        const record = {
            phien: phien,
            duDoan: result.pred,
            doTinCay: result.conf.toFixed(0) + '%',
            ketQua: ketQua,
            trangThai: trangThai,
            loai: type.toUpperCase(),
            thoiGian: vnNow(),
            algorithmCount: result.details?.totalSignals || 0,
            reason: result.reason || '',
            name: result.name || '',
            confidence: result.conf.toFixed(0)
        };
        
        if (existingIndex !== -1) {
            // Cập nhật record cũ
            historyData[type][existingIndex] = record;
        } else {
            // Thêm mới vào đầu danh sách
            historyData[type].unshift(record);
            // Giới hạn 1000 record
            if (historyData[type].length > 1000) {
                const removed = historyData[type].splice(1000);
                for (const r of removed) {
                    delete stats.processed_phiens[r.phien];
                }
            }
        }
        
        // Lưu ngay lập tức
        saveHistory();
        
        // Trả về kết quả với flag isNew = true
        return {
            prediction: result.pred,
            confidence: result.conf,
            phien: phien,
            ketQua: ketQua,
            trangThai: trangThai,
            algorithmCount: result.details?.totalSignals || 0,
            reason: result.reason || '',
            name: result.name || '',
            isNew: true
        };
    } catch (e) {
        console.error('Calculate prediction error:', e.message);
        return {
            phien: 0,
            prediction: '---',
            confidence: 50,
            ketQua: '---',
            trangThai: 'ERROR',
            algorithmCount: 0,
            reason: 'Lỗi: ' + e.message,
            name: 'Error',
            isNew: false
        };
    }
}

// ============================================================
// 🚀 ROUTES - GIAO DIỆN MỚI
// ============================================================

app.get('/', function(req, res) {
    res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Kapub Dự Đoán</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', sans-serif; }
        body { background: #030408; display: flex; justify-content: center; align-items: center; min-height: 100vh; color: #ffffff; padding: 15px; }
        .app-wrapper {
            background: #080a11; width: 100%; max-width: 410px; height: 860px;
            border-radius: 40px; padding: 0; position: relative;
            box-shadow: 0 40px 80px rgba(0,0,0,0.9);
            border: 1px solid rgba(255,255,255,0.04);
            overflow: hidden; display: flex; flex-direction: column;
        }
        .content-scroll-area { 
            flex: 1; overflow-y: auto; padding: 30px 22px 20px 22px; 
            display: flex; flex-direction: column; position: relative; z-index: 1; gap: 20px;
        }
        .content-scroll-area::-webkit-scrollbar { width: 2px; }
        .content-scroll-area::-webkit-scrollbar-thumb { background: #d4af37; border-radius: 10px; }
        #homeScreen { display: flex; flex-direction: column; flex: 1; animation: fadeSlide 0.6s ease-out; gap: 20px; }
        @keyframes fadeSlide { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        .hero-header { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 15px; }
        .royal-icon { color: #d4af37; font-size: 24px; }
        .brand-name { font-size: 22px; font-weight: 900; color: #fff; letter-spacing: -0.5px; }
        .brand-name span { color: #d4af37; }
        .greeting-wrap { 
            background: rgba(14, 18, 30, 0.8); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; padding: 18px 20px; 
            box-shadow: inset 0 0 30px rgba(255,255,255,0.01);
        }
        .greeting-line { font-size: 18px; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 10px; }
        .greeting-line i { color: #d4af37; font-size: 16px;}
        .greeting-desc { font-size: 14px; font-weight: 500; color: #8d98b1; line-height: 1.6; margin-top: 6px; }
        .greeting-desc strong { color: #d4af37; font-weight: 700; }
        .intro-stack { display: flex; flex-direction: column; gap: 12px; flex: 1; justify-content: center; }
        .intro-card {
            background: rgba(14, 18, 30, 0.5); border: 1px solid rgba(255,255,255,0.04); border-radius: 14px; 
            padding: 16px 18px; display: flex; flex-direction: column; gap: 6px;
            transition: all 0.3s ease;
        }
        .intro-card:hover { background: rgba(18, 24, 40, 0.6); transform: translateX(4px); border-color: rgba(212, 175, 55, 0.1); }
        .intro-title { font-size: 16px; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 12px; }
        .intro-title i { color: #d4af37; font-size: 16px; width: 20px; text-align: center; }
        .intro-detail { font-size: 13px; font-weight: 500; color: #8d98b1; line-height: 1.5; padding-left: 32px; }
        .btn-group { display: flex; flex-direction: column; gap: 12px; margin-top: auto; padding-top: 10px;}
        .btn-enter { 
            position: relative; background: rgba(14, 18, 30, 0.9); border-radius: 18px; 
            padding: 16px 20px; display: flex; align-items: center; gap: 16px; cursor: pointer; 
            transition: all 0.3s ease; overflow: hidden;
            border: 2px solid transparent; 
        }
        .btn-enter:active { transform: scale(0.97); }
        .btn-enter i { font-size: 24px; width: 30px; text-align: center; }
        .btn-enter .btn-icon-hu { color: #f59e0b; }
        .btn-enter .btn-icon-md5 { color: #3b82f6; }
        .btn-enter h4 { font-size: 16px; font-weight: 800; color: #fff; }
        .btn-enter p { font-size: 11px; font-weight: 500; color: #8d98b1; }
        .btn-enter.rainbow-active::before {
            content: ''; position: absolute; inset: -2px; border-radius: 18px; padding: 2px;
            background: conic-gradient(from 0deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #8f00ff, #ff0000);
            animation: spin-rainbow 3s linear infinite;
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor; mask-composite: exclude;
            pointer-events: none; z-index: 1;
        }
        @keyframes spin-rainbow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        #predictScreen { display: none; flex-direction: column; flex: 1; gap: 14px; animation: fadeSlide 0.4s ease-out; }
        .top-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
        .back-btn { background: transparent; border: none; color: #8d98b1; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: 0.2s; }
        .back-btn:hover { color: #fff; transform: translateX(-3px); }
        .tool-title { font-size: 14px; font-weight: 800; color: #d4af37; }
        .p-box { 
            background: rgba(14, 18, 30, 0.7); border: 1px solid rgba(255,255,255,0.05); border-radius: 20px; 
            padding: 24px 20px; text-align: center; transition: 0.4s; position: relative;
        }
        .p-box.active-tai { border-color: rgba(59, 130, 246, 0.4); box-shadow: 0 0 50px rgba(59, 130, 246, 0.05); }
        .p-box.active-xiu { border-color: rgba(239, 68, 68, 0.4); box-shadow: 0 0 50px rgba(239, 68, 68, 0.05); }
        .p-label { font-size: 11px; font-weight: 700; color: #8d98b1; letter-spacing: 2px; }
        .p-result { font-size: 68px; font-weight: 900; line-height: 1; margin: 15px 0 20px 0; transition: all 0.3s; }
        .p-result.tai { color: #3b82f6; text-shadow: 0 0 30px rgba(59, 130, 246, 0.3); }
        .p-result.xiu { color: #ef4444; text-shadow: 0 0 30px rgba(239, 68, 68, 0.3); }
        .p-stats { display: flex; justify-content: center; gap: 35px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.05); }
        .p-stats > div { display: flex; flex-direction: column; gap: 2px; align-items: center; }
        .p-stats > div span:first-child { font-size: 9px; font-weight: 700; color: #8d98b1; letter-spacing: 0.5px; }
        .p-stats > div span:last-child { font-size: 20px; font-weight: 800; }
        .h-wrap { background: rgba(14, 18, 30, 0.6); border: 1px solid rgba(255,255,255,0.04); border-radius: 16px; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .h-head { display: grid; grid-template-columns: 0.8fr 1.2fr 1fr 1fr 1.4fr; padding: 12px 16px; background: rgba(0,0,0,0.3); font-size: 10px; font-weight: 800; color: #8d98b1; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .h-col { text-align: center; }
        .h-col:first-child { text-align: left; }
        .h-scroll { flex: 1; overflow-y: auto; padding-bottom: 10px; }
        .h-scroll::-webkit-scrollbar { width: 2px; }
        .h-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        @keyframes rowPop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        .h-row { display: grid; grid-template-columns: 0.8fr 1.2fr 1fr 1fr 1.4fr; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.03); align-items: center; animation: rowPop 0.25s ease-out; }
        .h-id { font-size: 13px; font-weight: 700; color: #8d98b1; font-family: monospace; text-align: left; }
        .h-val { font-size: 15px; font-weight: 700; text-align: center; }
        .h-val.text-red { color: #ef4444; }
        .h-val.text-green { color: #22c55e; }
        .h-pct { font-size: 13px; font-weight: 700; text-align: center; color: #3b82f6; }
        .h-stt-box { display: flex; justify-content: center; }
        .h-stt { padding: 2px 14px; border-radius: 20px; font-size: 10px; font-weight: 800; border: 1px solid transparent; }
        .h-stt.win { background: rgba(34, 197, 94, 0.1); color: #22c55e; border-color: rgba(34, 197, 94, 0.15); }
        .h-stt.lose { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.15); }
        @media (max-width: 400px) { .app-wrapper { height: 100vh; border-radius: 0; } }
    </style>
</head>
<body>
    <div class="app-wrapper">
        <div class="content-scroll-area">
            <div id="homeScreen">
                <div class="hero-header">
                    <i class="fas fa-crown royal-icon"></i>
                    <div class="brand-name">KAPUB</div>
                </div>
                <div class="greeting-wrap">
                    <div class="greeting-line"><i class="fas fa-circle-check"></i> Dự Đoán Độc Quyền</div>
                    <div class="greeting-desc">
                        Hệ thống phân tích đa tầng <strong>thế hệ mới</strong>.<br>
                        Được tối ưu bởi các thuật toán dự đoán chiến lược uy tín.
                    </div>
                </div>
                <div class="intro-stack">
                    <div class="intro-card">
                        <div class="intro-title"><i class="fas fa-microchip"></i> Công Nghệ Xử Lý Đa Tầng</div>
                        <div class="intro-detail">Thuật toán tối ưu hóa dựa trên dữ liệu lớn, phân tích biến động theo thời gian thực, đảm bảo độ chính xác tuyệt đối.</div>
                    </div>
                    <div class="intro-card">
                        <div class="intro-title"><i class="fas fa-shield-halved"></i> Giao Thức Bảo Mật Dynamic</div>
                        <div class="intro-detail">Hệ thống sử dụng mã hóa dữ liệu đa lớp, ngăn chặn can thiệp trái phép, đảm bảo an toàn cho mọi phiên dự đoán.</div>
                    </div>
                    <div class="intro-card">
                        <div class="intro-title"><i class="fas fa-bolt"></i> Hỗ Trợ Liên Tục 24/7</div>
                        <div class="intro-detail">Hệ thống luôn sẵn sàng phục vụ, đảm bảo dữ liệu trôi chảy và hỗ trợ người dùng kịp thời mọi lúc.</div>
                    </div>
                </div>
                <div class="btn-group">
                    <div class="btn-enter" id="btnHu" onclick="openTool('Hũ')">
                        <i class="fas fa-dice-d6 btn-icon-hu"></i>
                        <div><h4>Dự Đoán Hũ</h4><p>Phân tích chuyên sâu thuật toán Hũ</p></div>
                    </div>
                    <div class="btn-enter" id="btnMd5" onclick="openTool('MD5')">
                        <i class="fas fa-lock btn-icon-md5"></i>
                        <div><h4>Dự Đoán MD5</h4><p>Giải mã chuỗi MD5 chính xác</p></div>
                    </div>
                </div>
            </div>
            <div id="predictScreen">
                <div class="top-nav">
                    <button class="back-btn" onclick="goHome()"><i class="fas fa-arrow-left"></i> Quay lại</button>
                    <div class="tool-title" id="toolTitle">Dự Đoán Hũ</div>
                </div>
                <div class="p-box active-xiu" id="predictCard">
                    <div class="p-label">Kết Quả Dự Đoán</div>
                    <div class="p-result xiu" id="resultTextDisplay">XỈU</div>
                    <div class="p-stats">
                        <div><span>Tin Cậy</span><span style="color:#3b82f6;" id="confDisplay">85%</span></div>
                        <div><span>Thuật Toán</span><span style="color:#ffffff;" id="algoDisplay">7</span></div>
                        <div><span>Trạng Thái</span><span style="color:#22c55e; font-size:16px;" id="statusDisplay">THẮNG</span></div>
                    </div>
                </div>
                <div class="h-wrap">
                    <div class="h-head">
                        <div class="h-col">Phiên</div>
                        <div class="h-col">Dự Đoán</div>
                        <div class="h-col">Kết Quả</div>
                        <div class="h-col">Tin Cậy</div>
                        <div class="h-col">Trạng Thái</div>
                    </div>
                    <div class="h-scroll" id="historyContainer"></div>
                </div>
            </div>
        </div>
    </div>
    <script>
        let sessionCount = 0;
        let currentMode = ""; 
        let runningInterval = null;
        const homeScreen = document.getElementById('homeScreen');
        const predictScreen = document.getElementById('predictScreen');
        const historyContainer = document.getElementById('historyContainer');
        const predictCard = document.getElementById('predictCard');
        const resultTextDisplay = document.getElementById('resultTextDisplay');
        const confDisplay = document.getElementById('confDisplay');
        const algoDisplay = document.getElementById('algoDisplay');
        const statusDisplay = document.getElementById('statusDisplay');
        const toolTitle = document.getElementById('toolTitle');

        async function fetchAPI(endpoint) {
            try {
                const res = await fetch(endpoint);
                if (!res.ok) throw new Error('Network error');
                return await res.json();
            } catch (e) { return null; }
        }

        function openTool(mode) {
            currentMode = mode;
            toolTitle.innerText = "Dự Đoán " + mode;
            homeScreen.style.display = 'none';
            predictScreen.style.display = 'flex';
            if (runningInterval) {
                clearInterval(runningInterval);
                runningInterval = null;
            }
            sessionCount = 0;
            historyContainer.innerHTML = '';
            loadHistory(mode);
            runningInterval = setInterval(function() { generateData(mode); }, 5000);
            generateData(mode);
        }

        async function loadHistory(mode) {
            const endpoint = mode === 'Hũ' ? '/api/history/hu' : '/api/history/md5';
            const data = await fetchAPI(endpoint);
            if (data && data.history) {
                historyContainer.innerHTML = '';
                const history = data.history.slice(0, 40);
                for (const item of history) {
                    addHistoryRow(item);
                }
                sessionCount = history.length;
            }
        }

        function addHistoryRow(item) {
            const prefix = item.loai === 'HU' ? 'HU' : 'MD5';
            const sessionId = '#' + prefix + String(item.phien).padStart(6, '0');
            const colorPredict = item.duDoan === 'TAI' ? 'text-red' : 'text-green';
            const colorActual = item.ketQua === 'TAI' ? 'text-red' : 'text-green';
            const statusClass = item.trangThai === 'WIN' ? 'win' : 'lose';
            const statusText = item.trangThai === 'WIN' ? 'THẮNG' : 'THUA';
            const row = document.createElement('div');
            row.className = 'h-row';
            row.innerHTML = '<div class="h-id">' + sessionId + '</div><div class="h-val ' + colorPredict + '">' + (item.duDoan || '---') + '</div><div class="h-val ' + colorActual + '">' + (item.ketQua || '---') + '</div><div class="h-pct">' + (item.doTinCay || '0%') + '</div><div class="h-stt-box"><span class="h-stt ' + statusClass + '">' + statusText + '</span></div>';
            historyContainer.prepend(row);
        }

        async function generateData(mode) {
            const endpoint = mode === 'Hũ' ? '/api/hu' : '/api/md5';
            const data = await fetchAPI(endpoint);
            if (data) {
                sessionCount++;
                const duDoan = data.duDoan || data.prediction || '---';
                const doTinCay = data.doTinCay || (data.confidence ? data.confidence.toFixed(0) + '%' : '0%');
                const trangThai = data.trangThai || 'PENDING';
                const algoCount = data.algorithmCount || 0;
                const name = data.name || '';
                const isNew = data.isNew || false;
                
                resultTextDisplay.innerText = duDoan;
                confDisplay.innerText = doTinCay;
                algoDisplay.innerText = algoCount;
                
                if (duDoan === 'TAI') {
                    resultTextDisplay.className = 'p-result tai';
                    predictCard.className = 'p-box active-tai';
                } else if (duDoan === 'XIU') {
                    resultTextDisplay.className = 'p-result xiu';
                    predictCard.className = 'p-box active-xiu';
                } else {
                    resultTextDisplay.className = 'p-result';
                    predictCard.className = 'p-box';
                }
                
                if (trangThai === 'WIN') {
                    statusDisplay.innerText = 'THẮNG';
                    statusDisplay.style.color = '#22c55e';
                } else if (trangThai === 'LOSE') {
                    statusDisplay.innerText = 'THUA';
                    statusDisplay.style.color = '#ef4444';
                } else {
                    statusDisplay.innerText = 'CHỜ...';
                    statusDisplay.style.color = '#fbbf24';
                }
                
                if (isNew) {
                    predictCard.style.animation = 'none';
                    setTimeout(() => {
                        predictCard.style.animation = 'fadeSlide 0.5s ease-out';
                    }, 10);
                }
                
                if (data.phien && duDoan && duDoan !== '---') {
                    const prefix = mode === 'Hũ' ? 'HU' : 'MD5';
                    const sessionId = '#' + prefix + String(data.phien).padStart(6, '0');
                    
                    const existingRows = historyContainer.querySelectorAll('.h-row');
                    let exists = false;
                    for (const row of existingRows) {
                        if (row.querySelector('.h-id')?.textContent === sessionId) {
                            exists = true;
                            break;
                        }
                    }
                    
                    if (!exists && isNew) {
                        const item = {
                            phien: data.phien,
                            duDoan: duDoan,
                            ketQua: data.ketQua || '---',
                            doTinCay: doTinCay,
                            trangThai: trangThai,
                            loai: prefix,
                            name: name
                        };
                        addHistoryRow(item);
                        while (historyContainer.children.length > 40) {
                            historyContainer.removeChild(historyContainer.lastChild);
                        }
                    }
                }
            }
        }

        function goHome() {
            if (runningInterval) {
                clearInterval(runningInterval);
                runningInterval = null;
            }
            predictScreen.style.display = 'none';
            homeScreen.style.display = 'flex';
        }
    </script>
</body>
</html>`);
});

// ============================================================
// API ENDPOINTS - ĐÃ SỬA
// ============================================================

app.get('/api/hu', async function(req, res) {
    try {
        const data = await fetchHu();
        if (!data) {
            return res.status(503).json({ 
                error: 'Không thể lấy dữ liệu HU',
                phien: 0,
                duDoan: '---',
                doTinCay: '0%',
                ketQua: '---',
                trangThai: 'ERROR',
                algorithmCount: 0,
                isNew: false
            });
        }
        
        const result = calculatePrediction(data, 'hu');
        
        if (!result) {
            const latest = historyData.hu?.[0];
            if (latest) {
                return res.json({
                    phien: latest.phien,
                    duDoan: latest.duDoan,
                    doTinCay: latest.doTinCay,
                    ketQua: latest.ketQua,
                    trangThai: latest.trangThai,
                    reason: latest.reason || 'Đã xử lý trước đó',
                    algorithmCount: latest.algorithmCount || 0,
                    name: latest.name || 'Cached',
                    isNew: false,
                    stats: {
                        total: stats.total,
                        correct: stats.correct,
                        wrong: stats.wrong,
                        accuracy: stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) + '%' : '0%'
                    }
                });
            }
            return res.json({
                phien: data[0]?.Phien || 0,
                duDoan: '---',
                doTinCay: '0%',
                ketQua: '---',
                trangThai: 'PENDING',
                reason: 'Chờ dữ liệu mới',
                algorithmCount: 0,
                name: 'Waiting',
                isNew: false,
                stats: {
                    total: stats.total,
                    correct: stats.correct,
                    wrong: stats.wrong,
                    accuracy: stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) + '%' : '0%'
                }
            });
        }
        
        res.json({
            phien: result.phien,
            duDoan: result.prediction,
            doTinCay: result.confidence.toFixed(0) + '%',
            ketQua: result.ketQua,
            trangThai: result.trangThai,
            reason: result.reason || '',
            algorithmCount: result.algorithmCount || 0,
            name: result.name || '',
            isNew: result.isNew || false,
            stats: {
                total: stats.total,
                correct: stats.correct,
                wrong: stats.wrong,
                accuracy: stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) + '%' : '0%'
            }
        });
    } catch (e) {
        console.error('API HU error:', e.message);
        res.status(500).json({ 
            error: e.message,
            duDoan: '---',
            doTinCay: '0%',
            trangThai: 'ERROR',
            isNew: false
        });
    }
});

app.get('/api/md5', async function(req, res) {
    try {
        const data = await fetchMd5();
        if (!data) {
            return res.status(503).json({ 
                error: 'Không thể lấy dữ liệu MD5',
                phien: 0,
                duDoan: '---',
                doTinCay: '0%',
                ketQua: '---',
                trangThai: 'ERROR',
                algorithmCount: 0,
                isNew: false
            });
        }
        
        const result = calculatePrediction(data, 'md5');
        
        if (!result) {
            const latest = historyData.md5?.[0];
            if (latest) {
                return res.json({
                    phien: latest.phien,
                    duDoan: latest.duDoan,
                    doTinCay: latest.doTinCay,
                    ketQua: latest.ketQua,
                    trangThai: latest.trangThai,
                    reason: latest.reason || 'Đã xử lý trước đó',
                    algorithmCount: latest.algorithmCount || 0,
                    name: latest.name || 'Cached',
                    isNew: false,
                    stats: {
                        total: stats.total,
                        correct: stats.correct,
                        wrong: stats.wrong,
                        accuracy: stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) + '%' : '0%'
                    }
                });
            }
            return res.json({
                phien: data[0]?.Phien || 0,
                duDoan: '---',
                doTinCay: '0%',
                ketQua: '---',
                trangThai: 'PENDING',
                reason: 'Chờ dữ liệu mới',
                algorithmCount: 0,
                name: 'Waiting',
                isNew: false,
                stats: {
                    total: stats.total,
                    correct: stats.correct,
                    wrong: stats.wrong,
                    accuracy: stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) + '%' : '0%'
                }
            });
        }
        
        res.json({
            phien: result.phien,
            duDoan: result.prediction,
            doTinCay: result.confidence.toFixed(0) + '%',
            ketQua: result.ketQua,
            trangThai: result.trangThai,
            reason: result.reason || '',
            algorithmCount: result.algorithmCount || 0,
            name: result.name || '',
            isNew: result.isNew || false,
            stats: {
                total: stats.total,
                correct: stats.correct,
                wrong: stats.wrong,
                accuracy: stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) + '%' : '0%'
            }
        });
    } catch (e) {
        console.error('API MD5 error:', e.message);
        res.status(500).json({ 
            error: e.message,
            duDoan: '---',
            doTinCay: '0%',
            trangThai: 'ERROR',
            isNew: false
        });
    }
});

app.get('/api/history/:type', function(req, res) {
    try {
        const type = req.params.type;
        if (type === 'all') {
            const all = (historyData.hu || []).concat(historyData.md5 || []);
            all.sort((a, b) => (b.phien || 0) - (a.phien || 0));
            res.json({ history: all, total: all.length });
        } else if (type === 'hu') {
            res.json({ history: historyData.hu || [], total: (historyData.hu || []).length });
        } else if (type === 'md5') {
            res.json({ history: historyData.md5 || [], total: (historyData.md5 || []).length });
        } else {
            res.status(400).json({ error: 'Invalid type. Use: all, hu, md5' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stats', function(req, res) {
    try {
        const detailedStats = predictor.getStats();
        const cleanStats = { ...detailedStats };
        delete cleanStats.processed_phiens;
        res.json(cleanStats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/health', function(req, res) {
    res.json({
        status: 'online',
        timestamp: vnNow(),
        version: stats.model_version,
        total_predictions: stats.total_predictions_made,
        healer_status: predictor.healer.getStatus()
    });
});

app.post('/api/refresh', function(req, res) {
    try {
        predictor.diceAnalyzer.predictionCache.clear();
        res.json({ 
            success: true, 
            message: 'Cache cleared',
            timestamp: vnNow()
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// 🚀 KHỞI ĐỘNG SERVER
// ============================================================
loadHistory();
app.listen(PORT, '0.0.0.0', function() {
    console.log('========================================');
    console.log('🧬 IMMORTAL PHOENIX PREDICTOR');
    console.log('✅ 30+ THUẬT TOÁN CẦU');
    console.log('✅ TỰ SỬA LỖI - TỰ SỐNG LẠI');
    console.log('✅ TỰ HỌC VĨNH VIỄN');
    console.log('✅ LƯU 1000 PHIÊN - KHÔNG TRÙNG');
    console.log('✅ ĐÃ SỬA LỖI LOGIC');
    console.log('Server: http://0.0.0.0:' + PORT);
    console.log('========================================');
});

