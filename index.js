// server_tx_ultimate.js - Tài Xỉu Prediction v13.0
// Thuật toán dice cao cấp + Anti-cheat + Pattern recognition
// 🔥 NEW: Movement change analysis + Super learning time frame + Online weight adaptation

const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;
const AUTH_KEY = "kapub";
const USER_ID = "@Kapubb";
const ALGO_NAME = "DiceAIPredictor";

// ================= CẤU HÌNH GAME =================
const GAME_CONFIG = {
    "lc79_tx": {
        game_key: "LC79_TX",
        api_url: "https://wtx.tele68.com/v1/tx/sessions",
        name: "LC79 Tài Xỉu"
    },
    "lc79_md5": {
        game_key: "LC79_MD5",
        api_url: "https://wtxmd52.tele68.com/v1/txmd5/sessions",
        name: "LC79 MD5"
    },
    "betvip_tx": {
        game_key: "BETVIP_TX",
        api_url: "https://wtx.macminim6.online/v1/tx/sessions",
        name: "BETVIP Tài Xỉu"
    },
    "betvip_md5": {
        game_key: "BETVIP_MD5",
        api_url: "https://wtxmd52.macminim6.online/v1/txmd5/sessions",
        name: "BETVIP MD5"
    }
};

// ================= DICE ALGORITHMS ENGINE (ENHANCED) =================
class DiceAnalyzer {
    constructor() {
        // Face tracking
        this.faces = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
        this.facesByPos = { pos1: {}, pos2: {}, pos3: {} };
        this.faceGaps = { 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] };
        this.lastFaceSeen = {};
        
        // Transition matrices (6x6)
        this.faceTransition = Array(7).fill().map(() => Array(7).fill(0));
        this.posTransition = { pos1: Array(7).fill().map(() => Array(7).fill(0)),
                               pos2: Array(7).fill().map(() => Array(7).fill(0)),
                               pos3: Array(7).fill().map(() => Array(7).fill(0)) };
        
        // Sum tracking
        this.sumFreq = {};
        this.sumTransition = Array(19).fill().map(() => Array(19).fill(0));
        this.sumHistory = [];
        
        // Pair & Triple
        this.pairFreq = {};
        this.tripleFreq = {};
        this.doubleCount = { 0:0, 1:0, 2:0, 3:0 };
        
        // Sequence
        this.diceHistory = [];
        this.sequencePatterns = {};
        
        // Markov Chain cấp 2 & 3
        this.markov2 = {};
        this.markov3 = {};
        
        // Hot/Cold tracking
        this.hotFaces = [];
        this.coldFaces = [];
        this.trend = { up: 0, down: 0, stable: 0 };
        
        // Stats
        this.mean = 0;
        this.variance = 0;
        this.totalRolls = 0;
        
        // ========== NEW: Movement & Time-weighted learning ==========
        // Store each roll with recency weight (exponential decay)
        this.rollBuffer = [];          // each element: { d1,d2,d3,sum, delta1,delta2,delta3,deltaSum, age }
        this.decayLambda = 0.15;      // decay factor per roll (higher = more weight to recent)
        // Movement transition matrices (weighted by recency)
        this.delta1Trans = {};   // key: "prevDelta|nextDelta" -> totalWeight
        this.delta2Trans = {};
        this.delta3Trans = {};
        this.sumDeltaTrans = {};
        // For online learning: adjust algorithm weights
        this.algoWeights = {   // current weight of each algorithm (used in final prediction)
            faceFreq: 0.15,
            faceTrans: 0.12,
            sumTrans: 0.10,
            pair: 0.08,
            markov2: 0.10,
            seqPattern: 0.07,
            hotCold: 0.08,
            gap: 0.05,
            trend: 0.05,
            doublePattern: 0.03,
            movement: 0.12      // new movement-based algo
        };
        this.algoPerformance = {};   // track recent accuracy per algo
        this.correctCount = {};
        this.totalCount = {};
        for (let algo in this.algoWeights) {
            this.algoPerformance[algo] = 0.5;
            this.correctCount[algo] = 0;
            this.totalCount[algo] = 0;
        }
        this.lastMovementPrediction = null;
    }
    
    // Update with new roll (d1,d2,d3,sum)
    update(d1, d2, d3, sum) {
        this.totalRolls++;
        
        // 1. Face frequency
        [d1, d2, d3].forEach(f => this.faces[f]++);
        this.facesByPos.pos1[d1] = (this.facesByPos.pos1[d1] || 0) + 1;
        this.facesByPos.pos2[d2] = (this.facesByPos.pos2[d2] || 0) + 1;
        this.facesByPos.pos3[d3] = (this.facesByPos.pos3[d3] || 0) + 1;
        
        // 2. Face gaps
        const now = this.totalRolls;
        [d1, d2, d3].forEach(f => {
            if (this.lastFaceSeen[f]) {
                this.faceGaps[f].push(now - this.lastFaceSeen[f]);
                if (this.faceGaps[f].length > 20) this.faceGaps[f].shift();
            }
            this.lastFaceSeen[f] = now;
        });
        
        // 3. Sum frequency
        this.sumFreq[sum] = (this.sumFreq[sum] || 0) + 1;
        this.sumHistory.push(sum);
        if (this.sumHistory.length > 100) this.sumHistory.shift();
        
        // 4. Update mean & variance (online)
        const oldMean = this.mean;
        this.mean = this.mean + (sum - this.mean) / this.totalRolls;
        if (this.totalRolls > 1) {
            this.variance = this.variance + (sum - oldMean) * (sum - this.mean);
        }
        
        // 5. Update transitions (nếu có dữ liệu trước)
        if (this.diceHistory.length > 0) {
            const last = this.diceHistory[this.diceHistory.length - 1];
            
            // Face transition
            this.faceTransition[last.d1][d1]++;
            this.faceTransition[last.d2][d2]++;
            this.faceTransition[last.d3][d3]++;
            
            // Position transition
            this.posTransition.pos1[last.d1][d1]++;
            this.posTransition.pos2[last.d2][d2]++;
            this.posTransition.pos3[last.d3][d3]++;
            
            // Sum transition
            this.sumTransition[last.sum][sum]++;
            
            // Pairs
            const pair12 = `${Math.min(d1,d2)}-${Math.max(d1,d2)}`;
            const pair23 = `${Math.min(d2,d3)}-${Math.max(d2,d3)}`;
            const pair13 = `${Math.min(d1,d3)}-${Math.max(d1,d3)}`;
            this.pairFreq[pair12] = (this.pairFreq[pair12] || 0) + 1;
            this.pairFreq[pair23] = (this.pairFreq[pair23] || 0) + 1;
            this.pairFreq[pair13] = (this.pairFreq[pair13] || 0) + 1;
            
            // Markov cấp 2
            if (this.diceHistory.length >= 2) {
                const prev2 = this.diceHistory[this.diceHistory.length - 2];
                const key2 = `${prev2.d1},${prev2.d2},${prev2.d3}|${last.d1},${last.d2},${last.d3}`;
                this.markov2[key2] = (this.markov2[key2] || 0) + 1;
                
                // Markov cấp 3
                if (this.diceHistory.length >= 3) {
                    const prev3 = this.diceHistory[this.diceHistory.length - 3];
                    const key3 = `${prev3.d1},${prev3.d2},${prev3.d3}|${prev2.d1},${prev2.d2},${prev2.d3}|${last.d1},${last.d2},${last.d3}`;
                    this.markov3[key3] = (this.markov3[key3] || 0) + 1;
                }
            }
        }
        
        // 6. Triple
        const triple = `${d1}${d2}${d3}`;
        this.tripleFreq[triple] = (this.tripleFreq[triple] || 0) + 1;
        
        // 7. Doubles
        const doubles = (d1 === d2 ? 1 : 0) + (d2 === d3 ? 1 : 0) + (d1 === d3 ? 1 : 0);
        this.doubleCount[doubles]++;
        
        // 8. Sequence patterns
        this.diceHistory.push({ d1, d2, d3, sum });
        if (this.diceHistory.length > 200) this.diceHistory.shift();
        
        if (this.diceHistory.length >= 3) {
            const last3 = this.diceHistory.slice(-3);
            const pattern = last3.map(s => `${s.d1}${s.d2}${s.d3}`).join('|');
            this.sequencePatterns[pattern] = (this.sequencePatterns[pattern] || 0) + 1;
        }
        
        // 9. Update hot/cold faces
        this.updateHotCold();
        
        // 10. Update trend
        this.updateTrend();
        
        // ========== NEW: Movement & time-weighted learning ==========
        // Compute deltas if we have previous roll
        let delta1=0, delta2=0, delta3=0, deltaSum=0;
        if (this.rollBuffer.length > 0) {
            const prev = this.rollBuffer[this.rollBuffer.length - 1];
            delta1 = d1 - prev.d1;
            delta2 = d2 - prev.d2;
            delta3 = d3 - prev.d3;
            deltaSum = sum - prev.sum;
        }
        // Add new roll with age 0
        this.rollBuffer.push({ d1, d2, d3, sum, delta1, delta2, delta3, deltaSum, age: 0 });
        // Limit buffer size and decay ages
        const MAX_BUFFER = 150;
        if (this.rollBuffer.length > MAX_BUFFER) this.rollBuffer.shift();
        // Increase age of all entries (time decay)
        for (let i = 0; i < this.rollBuffer.length; i++) {
            this.rollBuffer[i].age++;
        }
        
        // Update weighted movement transitions using exponential decay
        if (this.rollBuffer.length >= 2) {
            const curr = this.rollBuffer[this.rollBuffer.length - 1];
            const prev = this.rollBuffer[this.rollBuffer.length - 2];
            const weight = Math.exp(-this.decayLambda * curr.age); // curr.age is 0 for newest, so weight=1
            // Delta transitions
            const key1 = `${prev.delta1}|${curr.delta1}`;
            const key2 = `${prev.delta2}|${curr.delta2}`;
            const key3 = `${prev.delta3}|${curr.delta3}`;
            const keySum = `${prev.deltaSum}|${curr.deltaSum}`;
            this.delta1Trans[key1] = (this.delta1Trans[key1] || 0) + weight;
            this.delta2Trans[key2] = (this.delta2Trans[key2] || 0) + weight;
            this.delta3Trans[key3] = (this.delta3Trans[key3] || 0) + weight;
            this.sumDeltaTrans[keySum] = (this.sumDeltaTrans[keySum] || 0) + weight;
        }
        
        // Adapt decay lambda based on volatility (super learning timeframe)
        if (this.rollBuffer.length >= 20) {
            const recentDeltas = this.rollBuffer.slice(-10).map(r => Math.abs(r.deltaSum));
            const avgDelta = recentDeltas.reduce((a,b)=>a+b,0)/recentDeltas.length;
            if (avgDelta > 5) this.decayLambda = Math.min(0.5, this.decayLambda + 0.01);
            else if (avgDelta < 2) this.decayLambda = Math.max(0.05, this.decayLambda - 0.005);
        }
    }
    
    updateHotCold() {
        const expectedPerFace = (this.totalRolls * 3) / 6;
        const faces = [1,2,3,4,5,6];
        this.hotFaces = [];
        this.coldFaces = [];
        faces.forEach(face => {
            const actual = this.faces[face];
            const ratio = actual / expectedPerFace;
            if (ratio > 1.15) this.hotFaces.push(face);
            if (ratio < 0.85) this.coldFaces.push(face);
        });
    }
    
    updateTrend() {
        if (this.sumHistory.length < 10) return;
        const recent = this.sumHistory.slice(-5);
        const older = this.sumHistory.slice(-10, -5);
        const recentAvg = recent.reduce((a,b) => a+b, 0) / 5;
        const olderAvg = older.reduce((a,b) => a+b, 0) / 5;
        const diff = recentAvg - olderAvg;
        if (diff > 0.8) this.trend.up++;
        else if (diff < -0.8) this.trend.down++;
        else this.trend.stable++;
        if (this.trend.up + this.trend.down + this.trend.stable > 20) {
            // trim but keep relative
        }
    }
    
    // ========== NEW: Movement-based prediction with time weight ==========
    predictMovement(lastD1, lastD2, lastD3, lastSum) {
        if (this.rollBuffer.length < 3) return { probTai: 0.5, confidence: 0 };
        // Get the last known deltas (from previous roll to current last roll)
        // Actually we need the last movement that happened: from second-last to last
        if (this.rollBuffer.length < 2) return { probTai: 0.5, confidence: 0 };
        const lastEntry = this.rollBuffer[this.rollBuffer.length - 1];
        const prevEntry = this.rollBuffer[this.rollBuffer.length - 2];
        const lastDelta1 = lastEntry.delta1;
        const lastDelta2 = lastEntry.delta2;
        const lastDelta3 = lastEntry.delta3;
        const lastDeltaSum = lastEntry.deltaSum;
        
        // Now predict next deltas based on weighted transitions
        let totalWeightTai = 0, totalWeightXiu = 0;
        let totalSamples = 0;
        // For each possible next delta value (-5..5 for dice, -15..15 for sum)
        for (let nd1 = -5; nd1 <= 5; nd1++) {
            const key1 = `${lastDelta1}|${nd1}`;
            const w1 = this.delta1Trans[key1] || 0;
            for (let nd2 = -5; nd2 <= 5; nd2++) {
                const key2 = `${lastDelta2}|${nd2}`;
                const w2 = this.delta2Trans[key2] || 0;
                for (let nd3 = -5; nd3 <= 5; nd3++) {
                    const key3 = `${lastDelta3}|${nd3}`;
                    const w3 = this.delta3Trans[key3] || 0;
                    const jointWeight = w1 * w2 * w3;
                    if (jointWeight === 0) continue;
                    // Estimate next sum delta (approximate as sum of individual deltas)
                    const nextDeltaSum = nd1 + nd2 + nd3;
                    // Use sum delta transition as well
                    const keySum = `${lastDeltaSum}|${nextDeltaSum}`;
                    const wSum = this.sumDeltaTrans[keySum] || 0;
                    const finalWeight = jointWeight * (wSum + 0.1);
                    
                    const nextSum = lastEntry.sum + nextDeltaSum;
                    if (nextSum >= 11) totalWeightTai += finalWeight;
                    else totalWeightXiu += finalWeight;
                    totalSamples += finalWeight;
                }
            }
        }
        if (totalSamples < 0.1) return { probTai: 0.5, confidence: 0 };
        const probTai = totalWeightTai / (totalWeightTai + totalWeightXiu);
        const confidence = Math.min(85, Math.abs(probTai-0.5)*2*100);
        return { probTai, confidence };
    }
    
    // Online learning: adjust algorithm weights based on last prediction accuracy
    adaptWeights(lastPrediction, actualResult, algoContributions) {
        // algoContributions is an object { algoName: { predicted: 'Tai'/'Xiu', weight } } for each algorithm that contributed
        const learningRate = 0.02;
        for (let algo in algoContributions) {
            const contrib = algoContributions[algo];
            if (!contrib) continue;
            const correct = (contrib.predicted === actualResult);
            this.totalCount[algo] = (this.totalCount[algo] || 0) + 1;
            if (correct) this.correctCount[algo] = (this.correctCount[algo] || 0) + 1;
            const recentAccuracy = this.correctCount[algo] / this.totalCount[algo];
            // Adjust weight: increase if correct, decrease if wrong, but keep within bounds
            let delta = correct ? learningRate : -learningRate;
            let newWeight = this.algoWeights[algo] + delta;
            newWeight = Math.max(0.02, Math.min(0.25, newWeight));
            this.algoWeights[algo] = newWeight;
            // Normalize all weights to sum to 1 (optional)
        }
        // Normalization
        let totalWeight = 0;
        for (let algo in this.algoWeights) totalWeight += this.algoWeights[algo];
        if (totalWeight > 0) {
            for (let algo in this.algoWeights) {
                this.algoWeights[algo] /= totalWeight;
            }
        }
    }
    
    // Modified prediction that uses movement and adaptive weights
    predict(lastD1, lastD2, lastD3, lastSum) {
        let algoResults = {}; // store each algorithm's prediction & confidence
        let algoContrib = {}; // for adaptation later
        
        // --- Algorithm 1: Face Frequency ---
        const totalFaces = this.totalRolls * 3;
        let faceTaiScore = 0, faceXiuScore = 0;
        for (let face = 1; face <= 6; face++) {
            const prob = (this.faces[face] || 0) / totalFaces;
            const expected = 1/6;
            const deviation = prob - expected;
            if (face >= 4) {
                faceTaiScore += Math.max(0, deviation) * 2;
                faceXiuScore += Math.max(0, -deviation) * 1.5;
            } else {
                faceXiuScore += Math.max(0, deviation) * 2;
                faceTaiScore += Math.max(0, -deviation) * 1.5;
            }
        }
        let faceScore = (faceTaiScore - faceXiuScore) / (faceTaiScore + faceXiuScore + 0.001);
        let facePred = faceScore > 0 ? 'Tài' : 'Xỉu';
        let faceConf = Math.min(90, Math.abs(faceScore)*100);
        algoResults.faceFreq = { prediction: facePred, confidence: faceConf, score: faceScore };
        algoContrib.faceFreq = { predicted: facePred, weight: this.algoWeights.faceFreq };
        
        // --- Algorithm 2: Face Transition ---
        let transTai = 0, transXiu = 0;
        [lastD1, lastD2, lastD3].forEach(last => {
            const trans = this.faceTransition[last];
            let total = 0, highSum = 0;
            for (let f=1; f<=6; f++) { total += trans[f]; if(f>=4) highSum += trans[f]; }
            if(total>0) { let probHigh = highSum/total; if(probHigh>0.55) transTai+=probHigh; else if(probHigh<0.45) transXiu+=(1-probHigh); }
        });
        let transScore = (transTai - transXiu) / (transTai+transXiu+0.001);
        let transPred = transScore > 0 ? 'Tài' : 'Xỉu';
        let transConf = Math.min(90, Math.abs(transScore)*100);
        algoResults.faceTrans = { prediction: transPred, confidence: transConf, score: transScore };
        algoContrib.faceTrans = { predicted: transPred, weight: this.algoWeights.faceTrans };
        
        // --- Algorithm 3: Sum Transition ---
        const sumTrans = this.sumTransition[lastSum];
        let sumTai=0, sumXiu=0, sumTotal=0;
        for(let s=3;s<=18;s++) { sumTotal+=sumTrans[s]; if(s>=11) sumTai+=sumTrans[s]; else sumXiu+=sumTrans[s]; }
        let sumScore = 0;
        if(sumTotal>2) sumScore = (sumTai - sumXiu)/sumTotal;
        let sumPred = sumScore > 0 ? 'Tài' : 'Xỉu';
        let sumConf = Math.min(90, Math.abs(sumScore)*100);
        algoResults.sumTrans = { prediction: sumPred, confidence: sumConf, score: sumScore };
        algoContrib.sumTrans = { predicted: sumPred, weight: this.algoWeights.sumTrans };
        
        // --- Algorithm 4: Pair Analysis ---
        const lastPair12 = `${Math.min(lastD1,lastD2)}-${Math.max(lastD1,lastD2)}`;
        let pairTai=0, pairXiu=0, pairTotal=0;
        for(let triple in this.tripleFreq) {
            const d = triple.split('').map(Number);
            const pair = `${Math.min(d[0],d[1])}-${Math.max(d[0],d[1])}`;
            if(pair === lastPair12) {
                const sumTriple = d[0]+d[1]+d[2];
                if(sumTriple>=11) pairTai+=this.tripleFreq[triple];
                else pairXiu+=this.tripleFreq[triple];
                pairTotal+=this.tripleFreq[triple];
            }
        }
        let pairScore = 0;
        if(pairTotal>2) pairScore = (pairTai - pairXiu)/pairTotal;
        let pairPred = pairScore > 0 ? 'Tài' : 'Xỉu';
        let pairConf = Math.min(90, Math.abs(pairScore)*100);
        algoResults.pair = { prediction: pairPred, confidence: pairConf, score: pairScore };
        algoContrib.pair = { predicted: pairPred, weight: this.algoWeights.pair };
        
        // --- Algorithm 5: Markov Chain cấp 2 ---
        let markovScore = 0;
        if(this.diceHistory.length >= 2) {
            const prev = this.diceHistory[this.diceHistory.length-1];
            const key2 = `${prev.d1},${prev.d2},${prev.d3}|${lastD1},${lastD2},${lastD3}`;
            let markovTai=0, markovXiu=0, markovTotal=0;
            for(let k in this.markov2) {
                if(k.startsWith(key2)) {
                    const nextTriple = k.split('|')[2];
                    if(nextTriple) {
                        const d = nextTriple.split(',').map(Number);
                        const sum = d[0]+d[1]+d[2];
                        if(sum>=11) markovTai+=this.markov2[k];
                        else markovXiu+=this.markov2[k];
                        markovTotal+=this.markov2[k];
                    }
                }
            }
            if(markovTotal>1) markovScore = (markovTai - markovXiu)/markovTotal;
        }
        let markovPred = markovScore > 0 ? 'Tài' : 'Xỉu';
        let markovConf = Math.min(90, Math.abs(markovScore)*100);
        algoResults.markov2 = { prediction: markovPred, confidence: markovConf, score: markovScore };
        algoContrib.markov2 = { predicted: markovPred, weight: this.algoWeights.markov2 };
        
        // --- Algorithm 6: Sequence Pattern ---
        let seqScore = 0;
        if(this.diceHistory.length >= 3) {
            const last2 = this.diceHistory.slice(-2);
            const patternKey = last2.map(s=>`${s.d1}${s.d2}${s.d3}`).join('|');
            let seqTai=0, seqXiu=0, seqTotal=0;
            for(let p in this.sequencePatterns) {
                if(p.startsWith(patternKey)) {
                    const parts = p.split('|');
                    if(parts.length>=3) {
                        const nextTriple = parts[2];
                        const sum = nextTriple.split('').map(Number).reduce((a,b)=>a+b,0);
                        if(sum>=11) seqTai+=this.sequencePatterns[p];
                        else seqXiu+=this.sequencePatterns[p];
                        seqTotal+=this.sequencePatterns[p];
                    }
                }
            }
            if(seqTotal>1) seqScore = (seqTai - seqXiu)/seqTotal;
        }
        let seqPred = seqScore > 0 ? 'Tài' : 'Xỉu';
        let seqConf = Math.min(90, Math.abs(seqScore)*100);
        algoResults.seqPattern = { prediction: seqPred, confidence: seqConf, score: seqScore };
        algoContrib.seqPattern = { predicted: seqPred, weight: this.algoWeights.seqPattern };
        
        // --- Algorithm 7: Hot/Cold Faces ---
        let hotTai=0, hotXiu=0;
        this.hotFaces.forEach(face => { if(face>=4) hotTai+=0.12; else hotXiu+=0.12; });
        this.coldFaces.forEach(face => { if(face>=4) hotXiu+=0.08; else hotTai+=0.08; });
        let hotScore = (hotTai - hotXiu) / (hotTai+hotXiu+0.001);
        let hotPred = hotScore > 0 ? 'Tài' : 'Xỉu';
        let hotConf = Math.min(90, Math.abs(hotScore)*100);
        algoResults.hotCold = { prediction: hotPred, confidence: hotConf, score: hotScore };
        algoContrib.hotCold = { predicted: hotPred, weight: this.algoWeights.hotCold };
        
        // --- Algorithm 8: Gap Analysis ---
        let gapTai=0, gapXiu=0;
        [lastD1, lastD2, lastD3].forEach(face => {
            const gaps = this.faceGaps[face];
            if(gaps.length>0) {
                const avgGap = gaps.reduce((a,b)=>a+b,0)/gaps.length;
                const expectedGap = (this.totalRolls*3)/6;
                if(avgGap > expectedGap*1.2) {
                    if(face>=4) gapTai+=0.1;
                    else gapXiu+=0.1;
                }
            }
        });
        let gapScore = (gapTai - gapXiu) / (gapTai+gapXiu+0.001);
        let gapPred = gapScore > 0 ? 'Tài' : 'Xỉu';
        let gapConf = Math.min(90, Math.abs(gapScore)*100);
        algoResults.gap = { prediction: gapPred, confidence: gapConf, score: gapScore };
        algoContrib.gap = { predicted: gapPred, weight: this.algoWeights.gap };
        
        // --- Algorithm 9: Trend Analysis ---
        let trendScore = 0;
        if(this.sumHistory.length >= 10) {
            const ma5 = this.sumHistory.slice(-5).reduce((a,b)=>a+b,0)/5;
            const ma10 = this.sumHistory.slice(-10).reduce((a,b)=>a+b,0)/10;
            const momentum = ma5 - ma10;
            if(momentum > 1) trendScore = 0.08;
            if(momentum < -1) trendScore = -0.08;
        }
        let trendPred = trendScore > 0 ? 'Tài' : 'Xỉu';
        let trendConf = Math.min(90, Math.abs(trendScore)*100);
        algoResults.trend = { prediction: trendPred, confidence: trendConf, score: trendScore };
        algoContrib.trend = { predicted: trendPred, weight: this.algoWeights.trend };
        
        // --- Algorithm 10: Double Pattern (placeholder) ---
        let doublePred = 'Xỉu'; // stub
        let doubleScore = 0;
        algoResults.doublePattern = { prediction: doublePred, confidence: 50, score: doubleScore };
        algoContrib.doublePattern = { predicted: doublePred, weight: this.algoWeights.doublePattern };
        
        // --- NEW Algorithm 11: Movement + time-weighted learning ---
        const movement = this.predictMovement(lastD1, lastD2, lastD3, lastSum);
        let moveScore = (movement.probTai - 0.5)*2;
        let movePred = movement.probTai > 0.5 ? 'Tài' : 'Xỉu';
        let moveConf = movement.confidence;
        algoResults.movement = { prediction: movePred, confidence: moveConf, score: moveScore };
        algoContrib.movement = { predicted: movePred, weight: this.algoWeights.movement };
        
        // ========== COMBINE WITH ADAPTIVE WEIGHTS ==========
        let totalTai = 0, totalXiu = 0, totalWeight = 0;
        for (let algo in algoResults) {
            const w = this.algoWeights[algo] || 0.05;
            const pred = algoResults[algo].prediction;
            const score = algoResults[algo].score;
            if (pred === 'Tài') totalTai += w * (Math.abs(score)+0.5);
            else totalXiu += w * (Math.abs(score)+0.5);
            totalWeight += w;
        }
        if (totalWeight === 0) return { prediction: null, confidence: 0 };
        const probTai = totalTai / (totalTai + totalXiu);
        const confidence = Math.min(92, Math.max(55, Math.abs(probTai - 0.5) * 2 * 100));
        
        // Save algoContrib for later adaptation when we know actual result
        this.lastAlgoContrib = algoContrib;
        
        if (Math.abs(probTai - 0.5) < 0.04) {
            return { prediction: 'CHO', confidence: 0, probTai: probTai, algoContrib: algoContrib };
        }
        return {
            prediction: probTai > 0.5 ? 'Tài' : 'Xỉu',
            confidence: confidence,
            probTai: probTai,
            algoContrib: algoContrib
        };
    }
    
    getStats() {
        return {
            total_rolls: this.totalRolls,
            face_frequency: this.faces,
            hot_faces: this.hotFaces,
            cold_faces: this.coldFaces,
            mean_sum: this.mean.toFixed(2),
            variance_sum: this.variance.toFixed(2),
            unique_triples: Object.keys(this.tripleFreq).length,
            double_rate: {
                no_double: (this.doubleCount[0] / this.totalRolls * 100).toFixed(1) + '%',
                one_double: (this.doubleCount[1] / this.totalRolls * 100).toFixed(1) + '%',
                two_double: (this.doubleCount[2] / this.totalRolls * 100).toFixed(1) + '%',
                triple: (this.doubleCount[3] / this.totalRolls * 100).toFixed(1) + '%'
            },
            // New stats
            decay_lambda: this.decayLambda.toFixed(3),
            algo_weights: this.algoWeights,
            buffer_size: this.rollBuffer.length
        };
    }
    
    // Called after actual result known
    updateWithActual(predictionObj, actualResult) {
        if (predictionObj && predictionObj.algoContrib) {
            this.adaptWeights(predictionObj, actualResult, predictionObj.algoContrib);
        }
    }
}

// ================= ANTI-CHEAT DETECTION =================
class AntiCheat {
    constructor() {
        this.suspiciousCount = 0;
        this.alerts = [];
    }
    
    check(data) {
        const issues = [];
        if (!data.list || !Array.isArray(data.list)) issues.push('INVALID_DATA_STRUCTURE');
        if (data.typeStat) {
            const tai = data.typeStat.TAI || 0;
            const xiu = data.typeStat.XIU || 0;
            const total = tai + xiu;
            if (total > 50) {
                const ratio = tai / total;
                if (ratio > 0.65 || ratio < 0.35) {
                    issues.push(`BIASED_RESULT: Tai=${ratio*100}%`);
                    this.suspiciousCount++;
                }
            }
        }
        const ids = data.list.map(item => item.id);
        const uniqueIds = new Set(ids);
        if (uniqueIds.size !== ids.length) issues.push('DUPLICATE_SESSION_IDS');
        for (const item of data.list) {
            if (item.dices) {
                for (const d of item.dices) {
                    if (d < 1 || d > 6) issues.push(`INVALID_DICE_VALUE: ${d}`);
                }
            }
        }
        return {
            isClean: issues.length === 0,
            issues: issues,
            alertLevel: issues.length >= 2 ? 'HIGH' : (issues.length === 1 ? 'LOW' : 'NORMAL')
        };
    }
}

// ================= PATTERN RECOGNITION (CẦU) =================
class PatternRecognizer {
    constructor() {
        this.betPattern = { Tai: {}, Xiu: {} };
        this.oneOnePattern = 0;
        this.twoTwoPattern = 0;
    }
    
    update(result) {
        // placeholder
    }
    
    predict(history) {
        if (history.length < 5) return null;
        const last5 = history.slice(-5);
        let isOneOne = true;
        for (let i = 1; i < last5.length; i++) {
            if (last5[i] === last5[i-1]) { isOneOne = false; break; }
        }
        if (isOneOne && last5.length >= 4) {
            return { prediction: last5[last5.length-1] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 65, source: 'cau_1_1' };
        }
        if (last5.length >= 4 && last5[0] === last5[1] && last5[2] === last5[3] && last5[0] !== last5[2]) {
            return { prediction: last5[0], confidence: 60, source: 'cau_2_2' };
        }
        return null;
    }
}

// ================= MAIN SERVER =================
app.use(express.json());

let gameCache = {};
let gameDiceAnalyzers = {};
let gamePatternRecognizers = {};
let gameHistory = {};
let predictionHistory = {};
let lastProcessedId = {};
let pendingPredictions = {};
let antiCheat = new AntiCheat();

let totalPredictions = 0;
let totalCorrect = 0;

function initGame(gameId) {
    if (!gameDiceAnalyzers[gameId]) gameDiceAnalyzers[gameId] = new DiceAnalyzer();
    if (!gamePatternRecognizers[gameId]) gamePatternRecognizers[gameId] = new PatternRecognizer();
    if (!gameHistory[gameId]) gameHistory[gameId] = [];
    if (!predictionHistory[gameId]) predictionHistory[gameId] = [];
    if (!lastProcessedId[gameId]) lastProcessedId[gameId] = null;
}

async function fetchGameData(url) {
    try {
        const response = await axios.get(url, { timeout: 10000 });
        return response.data;
    } catch (error) {
        console.error(`Fetch error: ${error.message}`);
        return null;
    }
}

function updateHistory(gameId, sessionId, result, sum, dices) {
    gameHistory[gameId].unshift({ sessionId, result, sum, dices, timestamp: Date.now() });
    if (gameHistory[gameId].length > 200) gameHistory[gameId] = gameHistory[gameId].slice(0, 200);
    const analyzer = gameDiceAnalyzers[gameId];
    analyzer.update(dices[0], dices[1], dices[2], sum);
}

function getResultFromSum(sum) { return sum >= 11 ? 'Tài' : 'Xỉu'; }

function getCombinedPrediction(gameId, lastResult, lastSum, lastDices) {
    const analyzer = gameDiceAnalyzers[gameId];
    const pattern = gamePatternRecognizers[gameId];
    const history = gameHistory[gameId].map(h => h.result);
    
    if (analyzer.totalRolls < 15) return { prediction: null, confidence: 0, reason: 'Đang học dữ liệu...' };
    
    const dicePred = analyzer.predict(lastDices[0], lastDices[1], lastDices[2], lastSum);
    const patternPred = pattern.predict(history);
    
    let finalPred = null, finalConfidence = 0;
    if (dicePred.prediction && dicePred.prediction !== 'CHO') {
        finalPred = dicePred.prediction;
        finalConfidence = dicePred.confidence * 0.7;
        if (patternPred && patternPred.prediction) {
            if (patternPred.prediction === finalPred) {
                finalConfidence += patternPred.confidence * 0.3;
                finalConfidence = Math.min(95, finalConfidence);
            } else {
                finalConfidence = dicePred.confidence * 0.8;
            }
        }
    } else if (patternPred && patternPred.prediction) {
        finalPred = patternPred.prediction;
        finalConfidence = patternPred.confidence * 0.9;
    }
    if (!finalPred) return { prediction: 'CHO', confidence: 0, reason: 'Không đủ tín hiệu' };
    return {
        prediction: finalPred,
        confidence: Math.round(finalConfidence),
        reason: `Dice:${(dicePred.probTai*100||50).toFixed(0)}% Tai | ${patternPred ? 'Pattern:'+patternPred.source : 'No pattern'}`,
        dicePredictionObj: dicePred   // pass for online learning
    };
}

function createEndpoint(gameId) {
    return async (req, res) => {
        const key = req.query.key;
        if (key !== AUTH_KEY) return res.status(403).json({ error: "Access denied" });
        
        initGame(gameId);
        const config = GAME_CONFIG[gameId];
        let data = gameCache[gameId];
        if (!data) { data = await fetchGameData(config.api_url); if(data) gameCache[gameId] = data; }
        if (!data || !data.list || data.list.length === 0) return res.status(500).json({ error: "Cannot fetch data" });
        
        const cheatCheck = antiCheat.check(data);
        const latest = data.list[0];
        const sessionId = latest.id;
        const resultRaw = latest.resultTruyenThong;
        const result = resultRaw === 'TAI' ? 'Tài' : 'Xỉu';
        const sum = latest.point;
        const dices = latest.dices;
        
        if (lastProcessedId[gameId] === sessionId) {
            const lastPred = pendingPredictions[gameId] || { prediction: 'Tài', confidence: 60 };
            const taiPercent = lastPred.prediction === 'Tài' ? lastPred.confidence : 100 - lastPred.confidence;
            return res.json({ status: "cached", phien: sessionId, xuc_xac: dices, tong: sum, ket_qua: result, du_doan: lastPred.prediction, do_tin_cay: `${taiPercent}%-${100-taiPercent}%`, id: USER_ID, ai_model: ALGO_NAME, anti_cheat: cheatCheck.alertLevel });
        }
        
        // Compare with previous prediction for accuracy feedback
        if (pendingPredictions[gameId] && lastProcessedId[gameId] !== sessionId) {
            const lastPred = pendingPredictions[gameId];
            if (lastPred.prediction !== 'CHO') {
                const isCorrect = lastPred.prediction === result;
                predictionHistory[gameId].unshift({ sessionId, prediction: lastPred.prediction, actual: result, isCorrect, confidence: lastPred.confidence, time: new Date().toISOString() });
                totalPredictions++; if(isCorrect) totalCorrect++;
                if(predictionHistory[gameId].length > 50) predictionHistory[gameId].pop();
                
                // Online learning: update analyzer weights with actual result
                if (lastPred.dicePredictionObj) {
                    gameDiceAnalyzers[gameId].updateWithActual(lastPred.dicePredictionObj, result);
                }
            }
        }
        
        lastProcessedId[gameId] = sessionId;
        updateHistory(gameId, sessionId, result, sum, dices);
        const prediction = getCombinedPrediction(gameId, result, sum, dices);
        
        pendingPredictions[gameId] = {
            prediction: prediction.prediction,
            confidence: prediction.confidence,
            reason: prediction.reason,
            dicePredictionObj: prediction.dicePredictionObj
        };
        
        const diceStats = gameDiceAnalyzers[gameId].getStats();
        const taiPercent = prediction.prediction === 'Tài' ? prediction.confidence : 100 - prediction.confidence;
        
        const response = {
            phien: sessionId, phien_tiep_theo: sessionId+1, xuc_xac_hien_tai: dices, tong_hien_tai: sum, ket_qua_hien_tai: result,
            du_doan_phien_tiep: prediction.prediction, do_tin_cay: prediction.prediction === 'CHO' ? "0%-0%" : `${Math.round(taiPercent)}%-${Math.round(100-taiPercent)}%`,
            ly_do: prediction.reason,
            dice_analysis: { tong_so_lan_quay: diceStats.total_rolls, mat_hot: diceStats.hot_faces, mat_nguoi: diceStats.cold_faces, trung_binh_tong: diceStats.mean_sum, ty_le_double: diceStats.double_rate, so_bo_ba_khac_nhau: diceStats.unique_triples, he_so_thoi_gian: diceStats.decay_lambda, trong_so_thuat_toan: diceStats.algo_weights },
            anti_cheat: cheatCheck.alertLevel,
            id: USER_ID, ai_model: `${ALGO_NAME} v13.0 (Super Learning)`,
            algorithms: ["Face Frequency","Face Transition","Sum Transition","Pair Analysis","Markov Chain C2","Sequence Pattern","Hot/Cold Faces","Gap Analysis","Trend Analysis","Double Pattern","Movement + TimeWeight"],
            lich_su_du_doan: predictionHistory[gameId]?.slice(0,5) || []
        };
        if (cheatCheck.issues.length > 0) response.canh_bao = cheatCheck.issues;
        res.json(response);
    };
}

for (const gameId of Object.keys(GAME_CONFIG)) app.get(`/api/${gameId}`, createEndpoint(gameId));

app.get('/api/stats/:gameId', (req, res) => {
    const key = req.query.key;
    if (key !== AUTH_KEY) return res.status(403).json({ error: "Access denied" });
    const gameId = req.params.gameId;
    const analyzer = gameDiceAnalyzers[gameId];
    if(!analyzer) return res.json({ error: "Game not initialized" });
    res.json({ game: gameId, total_predictions: totalPredictions, total_correct: totalCorrect, accuracy: totalPredictions>0 ? ((totalCorrect/totalPredictions)*100).toFixed(2)+'%' : '0%', dice_stats: analyzer.getStats(), history: predictionHistory[gameId]?.slice(0,20) || [] });
});

app.get('/api/health', (req, res) => { res.json({ status: "running", version: "13.0-superlearning", games: Object.keys(GAME_CONFIG), algorithms: 11, anti_cheat: true }); });
app.get('/', (req, res) => { res.json({ service: ALGO_NAME, version: "v13.0 - Ultimate Dice + Movement + Super Learning", endpoints: Object.keys(GAME_CONFIG).map(id=>`/api/${id}?key=${AUTH_KEY}`), algorithms: ["🎲 Face Frequency","🔄 Face Transition","📊 Sum Transition","🔗 Pair & Triple","🧬 Markov Chain","📈 Sequence Pattern","🔥 Hot/Cold","⏱️ Gap Analysis","📉 Trend Analysis","🃏 Double Pattern","🌀 Movement+TimeWeight"] }); });

async function autoRefresh() {
    while(true) {
        for(const gameId of Object.keys(GAME_CONFIG)) { try { const data = await fetchGameData(GAME_CONFIG[gameId].api_url); if(data) gameCache[gameId] = data; } catch(e) {} }
        await new Promise(r => setTimeout(r, 3000));
    }
}
autoRefresh();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🎲 TÀI XỈU ULTIMATE PREDICTOR v13.0 (Super Learning) 🎲 ║
╠══════════════════════════════════════════════════════════════╣
║  Port: ${PORT}                                              ║
║  Auth: ${AUTH_KEY}                                          ║
║  User: ${USER_ID}                                           ║
╠══════════════════════════════════════════════════════════════╣
║  📊 THUẬT TOÁN DICE: 11 (bổ sung Movement + TimeWeight)    ║
║  🧠 HỌC TẬP: Online weight adaptation + Exponential decay   ║
║  🛡️ ANTI-CHEAT: Active                                      ║
╠══════════════════════════════════════════════════════════════╣
║  🎮 GAMES:                                                  ║
${Object.keys(GAME_CONFIG).map(id => `  │    - /api/${id}`).join('\n')}
╚══════════════════════════════════════════════════════════════╝
    `);
});
