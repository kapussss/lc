const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'learning_data.json';
const HISTORY_FILE = 'prediction_history.json';
const ANOMALY_FILE = 'anomaly_patterns.json';
const META_LEARNING_FILE = 'meta_learning.json';
const FULL_HISTORY_FILE = 'full_history.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 500;
const AUTO_SAVE_INTERVAL = 10000;
let lastProcessedPhien = { hu: null, md5: null };
let dataCache = { hu: null, md5: null, lastFetch: { hu: 0, md5: 0 } };
const CACHE_TTL = 5000;

// ==================== THƯ VIỆN TOÁN HỌC NÂNG CAO ====================

function factorial(n) {
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
}

function combination(n, k) {
    if (k < 0 || k > n) return 0;
    return factorial(n) / (factorial(k) * factorial(n - k));
}

function binomialProbability(n, k, p) {
    return combination(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

function normalCDF(x, mean = 0, std = 1) {
    const z = (x - mean) / std;
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
}

function pearsonCorrelation(x, y) {
    if (x.length !== y.length || x.length < 2) return 0;
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumX2 = x.reduce((a, b) => a + b * b, 0);
    const sumY2 = y.reduce((a, b) => a + b * b, 0);
    const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
    
    const numerator = sumXY - sumX * sumY / n;
    const denominator = Math.sqrt((sumX2 - sumX * sumX / n) * (sumY2 - sumY * sumY / n));
    return denominator === 0 ? 0 : numerator / denominator;
}

// ==================== KALMAN FILTER ====================
class AdvancedKalmanFilter {
    constructor() {
        this.x = 0.5;
        this.P = 0.1;
        this.Q = 0.03;
        this.R = 0.08;
        this.biasCorrection = 0;
        this.biasHistory = [];
    }
    
    predict() {
        this.P += this.Q;
    }
    
    update(measurement) {
        this.predict();
        const K = this.P / (this.P + this.R);
        this.x = this.x + K * (measurement - this.x);
        this.P = (1 - K) * this.P;
        
        const bias = this.x - measurement;
        this.biasHistory.push(bias);
        if (this.biasHistory.length > 50) this.biasHistory.shift();
        this.biasCorrection = this.biasHistory.reduce((a, b) => a + b, 0) / this.biasHistory.length;
        
        return this.x;
    }
    
    getBias() {
        return Math.max(-0.2, Math.min(0.2, this.biasCorrection));
    }
    
    reset() {
        this.x = 0.5;
        this.P = 0.1;
        this.biasCorrection = 0;
        this.biasHistory = [];
    }
}

// ==================== META LEARNING ENGINE ====================
class MetaLearner {
    constructor() {
        this.algorithmWeights = {
            monteCarlo: 1.0,
            lstm: 1.0,
            fuzzyLogic: 1.0,
            bayesian: 1.0,
            patternMatch: 1.0,
            anomalyBreak: 1.0,
            timeWindow: 1.0,
            trendReversal: 1.0,
            markovChain: 1.0,
            neuralNet: 1.0,
            kalman: 1.0
        };
        this.performanceHistory = {};
        this.adaptationRate = 0.05;
        this.loadMetaData();
    }

    loadMetaData() {
        try {
            if (fs.existsSync(META_LEARNING_FILE)) {
                const data = JSON.parse(fs.readFileSync(META_LEARNING_FILE, 'utf8'));
                this.algorithmWeights = data.algorithmWeights || this.algorithmWeights;
                this.performanceHistory = data.performanceHistory || {};
                console.log('[Meta] Loaded meta-learning data');
            }
        } catch (e) {}
    }

    saveMetaData() {
        fs.writeFileSync(META_LEARNING_FILE, JSON.stringify({
            algorithmWeights: this.algorithmWeights,
            performanceHistory: this.performanceHistory,
            lastUpdated: new Date().toISOString()
        }, null, 2));
    }

    updateWeights(algorithm, success, confidence) {
        if (!this.performanceHistory[algorithm]) {
            this.performanceHistory[algorithm] = { wins: 0, total: 0, recent: [] };
        }
        this.performanceHistory[algorithm].total++;
        if (success) this.performanceHistory[algorithm].wins++;
        this.performanceHistory[algorithm].recent.push(success ? 1 : 0);
        if (this.performanceHistory[algorithm].recent.length > 20) this.performanceHistory[algorithm].recent.shift();
        
        const recentAccuracy = this.performanceHistory[algorithm].recent.reduce((a,b) => a + b, 0) / this.performanceHistory[algorithm].recent.length;
        const targetWeight = 0.5 + recentAccuracy * 0.8;
        this.algorithmWeights[algorithm] = this.algorithmWeights[algorithm] * (1 - this.adaptationRate) + targetWeight * this.adaptationRate;
        this.algorithmWeights[algorithm] = Math.max(0.3, Math.min(2.0, this.algorithmWeights[algorithm]));
        
        this.saveMetaData();
    }

    getWeight(algorithm) {
        return this.algorithmWeights[algorithm] || 1.0;
    }
}

// ==================== LSTM PATTERN RECOGNITION ====================
class LSTMPatternRecognizer {
    constructor(sequenceLength = 8) {
        this.sequenceLength = sequenceLength;
        this.patternLibrary = [];
        this.loadPatternLibrary();
    }

    loadPatternLibrary() {
        try {
            if (fs.existsSync('lstm_patterns.json')) {
                this.patternLibrary = JSON.parse(fs.readFileSync('lstm_patterns.json', 'utf8'));
                console.log(`[LSTM] Loaded ${this.patternLibrary.length} patterns`);
            }
        } catch (e) {}
    }

    encodeSequence(sequence) {
        const mapping = { 'Tài': [1, 0], 'Xỉu': [0, 1] };
        return sequence.map(s => mapping[s] || [0.5, 0.5]).flat();
    }

    findSimilarPatterns(recentResults, maxMatches = 30) {
        const currentSeq = recentResults.slice(0, this.sequenceLength);
        const currentEncoded = this.encodeSequence(currentSeq);
        const matches = [];
        
        for (const pattern of this.patternLibrary) {
            let similarity = 0;
            for (let i = 0; i < Math.min(currentEncoded.length, pattern.encoded?.length || 0); i++) {
                if (Math.abs(currentEncoded[i] - pattern.encoded[i]) < 0.5) similarity++;
            }
            similarity = similarity / currentEncoded.length;
            if (similarity > 0.6) {
                matches.push({
                    similarity,
                    nextResult: pattern.nextResult,
                    confidence: pattern.confidence
                });
            }
        }
        
        matches.sort((a,b) => b.similarity - a.similarity);
        return matches.slice(0, maxMatches);
    }

    predict(recentResults) {
        if (recentResults.length < this.sequenceLength || this.patternLibrary.length < 10) return null;
        
        const similar = this.findSimilarPatterns(recentResults, 20);
        if (similar.length < 3) return null;
        
        let taiConfidence = 0;
        let xiuConfidence = 0;
        let totalWeight = 0;
        
        for (const pattern of similar) {
            const weight = pattern.similarity * 2;
            totalWeight += weight;
            if (pattern.nextResult === 'Tài') taiConfidence += weight;
            else xiuConfidence += weight;
        }
        
        const taiProb = taiConfidence / totalWeight;
        return {
            prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(taiProb - 0.5) * 80,
            probability: taiProb
        };
    }

    learn(pattern, nextResult, success) {
        const encoded = this.encodeSequence(pattern);
        this.patternLibrary.unshift({
            pattern: pattern.slice(),
            encoded: encoded,
            nextResult: nextResult,
            confidence: success ? 1 : 0.3,
            timestamp: new Date().toISOString()
        });
        if (this.patternLibrary.length > 200) this.patternLibrary.pop();
        
        fs.writeFileSync('lstm_patterns.json', JSON.stringify(this.patternLibrary.slice(0, 200), null, 2));
    }
}

// ==================== FUZZY LOGIC ENGINE ====================
class FuzzyLogicEngine {
    constructor() {
        this.rules = [];
        this.initRules();
    }

    initRules() {
        this.rules = [
            { condition: (streak, alt, vol) => streak >= 4 && alt < 3, output: 'break', strength: 0.7 },
            { condition: (streak, alt, vol) => alt >= 6 && streak < 3, output: 'alternating', strength: 0.8 },
            { condition: (streak, alt, vol) => vol > 5 && streak < 3, output: 'random', strength: 0.6 },
            { condition: (streak, alt, vol) => streak >= 6 && alt < 2, output: 'strong_break', strength: 0.85 }
        ];
    }

    fuzzify(value, type) {
        const ranges = {
            streak: { low: [0,2], medium: [1,4], high: [3,10] },
            alternating: { low: [0,3], medium: [2,6], high: [5,12] },
            volatility: { low: [0,2], medium: [1,4], high: [3,8] }
        };
        const r = ranges[type];
        if (!r) return { low: 1, medium: 0, high: 0 };
        if (value <= r.low[1]) return { low: 1, medium: Math.max(0, (value - r.low[0])/(r.low[1] - r.low[0])), high: 0 };
        if (value <= r.medium[1]) return { low: Math.max(0, (r.medium[1] - value)/(r.medium[1] - r.medium[0])), medium: 1, high: Math.max(0, (value - r.medium[0])/(r.medium[1] - r.medium[0])) };
        return { low: 0, medium: Math.max(0, (r.high[1] - value)/(r.high[1] - r.high[0])), high: 1 };
    }

    evaluate(streak, alternating, volatility) {
        const f_streak = this.fuzzify(streak, 'streak');
        const f_alt = this.fuzzify(alternating, 'alternating');
        const f_vol = this.fuzzify(volatility, 'volatility');
        
        let breakScore = 0;
        let continueScore = 0;
        let randomScore = 0;
        
        for (const rule of this.rules) {
            let fireStrength = 1;
            if (rule.condition.toString().includes('streak')) fireStrength *= f_streak.high;
            if (rule.condition.toString().includes('alt')) fireStrength *= f_alt.high;
            if (rule.condition.toString().includes('vol')) fireStrength *= f_vol.medium;
            fireStrength = Math.max(0.1, Math.min(0.9, fireStrength));
            
            if (rule.output.includes('break')) breakScore += fireStrength * rule.strength;
            else if (rule.output.includes('alternating')) continueScore += fireStrength * rule.strength;
            else if (rule.output.includes('random')) randomScore += fireStrength * rule.strength;
        }
        
        const total = breakScore + continueScore + randomScore;
        if (total === 0) return { decision: 'neutral', confidence: 50 };
        
        let decision = 'continue';
        let confidence = (continueScore / total) * 100;
        if (breakScore > continueScore && breakScore > randomScore) {
            decision = 'break';
            confidence = (breakScore / total) * 100;
        } else if (randomScore > continueScore && randomScore > breakScore) {
            decision = 'random';
            confidence = (randomScore / total) * 100;
        }
        
        return { decision, confidence: Math.min(85, 50 + confidence/2) };
    }
}

// ==================== BAYESIAN INFERENCE ====================
class BayesianInference {
    constructor() {
        this.priors = { Tai: 0.5, Xiu: 0.5 };
        this.likelihoods = {};
    }

    updateLikelihood(observation, result) {
        if (!this.likelihoods[observation]) {
            this.likelihoods[observation] = { Tai: 1, Xiu: 1 };
        }
        this.likelihoods[observation][result]++;
    }

    predict(observations) {
        let postTai = Math.log(this.priors.Tai);
        let postXiu = Math.log(this.priors.Xiu);
        
        for (const obs of observations) {
            if (this.likelihoods[obs]) {
                postTai += Math.log(this.likelihoods[obs].Tai / (this.likelihoods[obs].Tai + this.likelihoods[obs].Xiu));
                postXiu += Math.log(this.likelihoods[obs].Xiu / (this.likelihoods[obs].Tai + this.likelihoods[obs].Xiu));
            }
        }
        
        const probTai = Math.exp(postTai) / (Math.exp(postTai) + Math.exp(postXiu));
        return {
            prediction: probTai > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(probTai - 0.5) * 80,
            probability: probTai
        };
    }

    getObservationKey(results) {
        if (results.length < 3) return 'default';
        return results.slice(0, 5).join('_');
    }
}

// ==================== GENETIC ALGORITHM ====================
class GeneticAdaptor {
    constructor() {
        this.population = this.initializePopulation(20);
        this.generation = 0;
        this.bestFitness = 0;
    }

    initializePopulation(size) {
        const population = [];
        for (let i = 0; i < size; i++) {
            population.push({
                weights: {
                    momentum: 0.3 + Math.random() * 0.5,
                    streak: 0.2 + Math.random() * 0.6,
                    pattern: 0.3 + Math.random() * 0.5
                },
                fitness: 0,
                threshold: 0.4 + Math.random() * 0.3
            });
        }
        return population;
    }

    evaluateFitness(predictions, actuals) {
        for (const individual of this.population) {
            let correct = 0;
            for (let i = 0; i < Math.min(predictions.length, actuals.length); i++) {
                if (predictions[i] === actuals[i]) correct++;
            }
            individual.fitness = correct / Math.max(1, Math.min(predictions.length, actuals.length));
        }
    }

    evolve() {
        this.population.sort((a,b) => b.fitness - a.fitness);
        const newPopulation = this.population.slice(0, 4);
        
        while (newPopulation.length < 20) {
            const parent1 = this.population[Math.floor(Math.random() * 8)];
            const parent2 = this.population[Math.floor(Math.random() * 8)];
            const child = this.crossover(parent1, parent2);
            this.mutate(child);
            newPopulation.push(child);
        }
        
        this.population = newPopulation;
        this.generation++;
    }

    crossover(p1, p2) {
        const child = {
            weights: {},
            fitness: 0,
            threshold: Math.random() > 0.5 ? p1.threshold : p2.threshold
        };
        for (const key in p1.weights) {
            child.weights[key] = Math.random() > 0.5 ? p1.weights[key] : p2.weights[key];
        }
        return child;
    }

    mutate(individual) {
        if (Math.random() < 0.2) {
            const keys = Object.keys(individual.weights);
            const key = keys[Math.floor(Math.random() * keys.length)];
            individual.weights[key] += (Math.random() - 0.5) * 0.1;
            individual.weights[key] = Math.max(0.05, Math.min(0.95, individual.weights[key]));
        }
    }

    getOptimalWeights() {
        const best = this.population.reduce((a,b) => a.fitness > b.fitness ? a : b, this.population[0]);
        return best.weights;
    }
}

// ==================== IMPROVED MONTE CARLO ====================
class ImprovedMonteCarlo {
    constructor(historicalData, windowSize = 10) {
        this.historicalData = historicalData;
        this.windowSize = windowSize;
        this.numSimulations = 8000;
        this.timeDecay = 0.95;
    }

    extractRecentFeatures(data) {
        if (!data || data.length < 8) return null;
        
        const results = data.slice(0, this.windowSize).map(d => d.Ket_qua);
        const taiCount = results.filter(r => r === 'Tài').length;
        
        let currentStreak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[0]) currentStreak++;
            else break;
        }
        
        let alternatingLength = 1;
        for (let i = 1; i < Math.min(results.length, 15); i++) {
            if (results[i] !== results[i-1]) alternatingLength++;
            else break;
        }
        
        return {
            results,
            taiRatio: taiCount / results.length,
            currentStreak,
            alternatingLength,
            lastResult: results[0]
        };
    }

    findRecentPatterns(currentFeatures, maxMatches = 60) {
        const matches = [];
        const dataLength = this.historicalData.length;
        
        for (let i = 0; i <= dataLength - this.windowSize - 1; i++) {
            const windowData = this.historicalData.slice(i, i + this.windowSize);
            const windowResults = windowData.map(d => d.Ket_qua);
            const windowTaiCount = windowResults.filter(r => r === 'Tài').length;
            
            let similarity = 0;
            const taiDiff = Math.abs(windowTaiCount / this.windowSize - currentFeatures.taiRatio);
            similarity += Math.max(0, 30 - taiDiff * 50);
            
            const streakDiff = Math.abs(this.getStreakLength(windowResults) - currentFeatures.currentStreak);
            similarity += Math.max(0, 20 - streakDiff * 3);
            
            const timeWeight = Math.pow(this.timeDecay, i / 10);
            similarity *= (0.8 + timeWeight * 0.4);
            
            if (similarity > 20) {
                matches.push({
                    similarity,
                    nextResult: this.historicalData[i + this.windowSize]?.Ket_qua,
                    timeWeight
                });
            }
        }
        
        matches.sort((a,b) => b.similarity - a.similarity);
        return matches.slice(0, maxMatches);
    }

    getStreakLength(results) {
        if (results.length === 0) return 0;
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[0]) streak++;
            else break;
        }
        return streak;
    }

    runSimulation(currentData, anomalyDetector, currentHour) {
        const currentFeatures = this.extractRecentFeatures(currentData);
        
        if (!currentFeatures || this.historicalData.length < 20) {
            const last10Results = currentData.slice(0, 10).map(d => d.Ket_qua);
            const taiCount = last10Results.filter(r => r === 'Tài').length;
            const taiProb = taiCount / 10;
            return {
                taiProbability: taiProb.toFixed(4),
                confidence: 50 + Math.abs(taiProb - 0.5) * 50,
                prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu'
            };
        }
        
        const similarPatterns = this.findRecentPatterns(currentFeatures, 80);
        
        if (similarPatterns.length < 5) {
            const last5Results = currentData.slice(0, 5).map(d => d.Ket_qua);
            const taiCount = last5Results.filter(r => r === 'Tài').length;
            const taiProb = taiCount / 5;
            return {
                taiProbability: taiProb.toFixed(4),
                confidence: 55,
                prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu'
            };
        }
        
        let taiWins = 0;
        let xiuWins = 0;
        let totalWeight = 0;
        
        for (let sim = 0; sim < this.numSimulations; sim++) {
            const idx = Math.floor(Math.random() * similarPatterns.length);
            const pattern = similarPatterns[idx];
            const weight = (pattern.similarity / 100) * (pattern.timeWeight || 1);
            totalWeight += weight;
            if (pattern.nextResult === 'Tài') taiWins += weight;
            else xiuWins += weight;
        }
        
        let taiProbability = taiWins / totalWeight;
        
        // Chống bias
        const biasCorrection = anomalyDetector?.getBiasCorrection() || 0;
        taiProbability += biasCorrection * 0.3;
        taiProbability = Math.max(0.4, Math.min(0.6, taiProbability));
        
        const confidence = 50 + Math.abs(taiProbability - 0.5) * 80;
        
        return {
            taiProbability: taiProbability.toFixed(4),
            confidence: Math.min(85, Math.max(55, confidence)),
            prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu'
        };
    }
}

// ==================== TREND REVERSAL DETECTOR ====================
class TrendReversalDetector {
    detect(results) {
        if (results.length < 8) return null;
        
        const last8 = results.slice(0, 8);
        const first4 = last8.slice(0, 4);
        const last4 = last8.slice(4, 8);
        
        const first4Tai = first4.filter(r => r === 'Tài').length;
        const last4Tai = last4.filter(r => r === 'Tài').length;
        
        if (first4Tai >= 3 && last4Tai <= 1) {
            return { prediction: 'Xỉu', confidence: 68 };
        }
        if (first4Tai <= 1 && last4Tai >= 3) {
            return { prediction: 'Tài', confidence: 68 };
        }
        
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[0]) streak++;
            else break;
        }
        if (streak >= 4) {
            return { 
                prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', 
                confidence: 60 + Math.min(15, streak * 2)
            };
        }
        return null;
    }
}

// ==================== MARKOV CHAIN ====================
class MarkovChainPredictor {
    constructor(order = 2) {
        this.order = order;
        this.transitions = {};
    }

    learn(sequence) {
        for (let i = 0; i <= sequence.length - this.order - 1; i++) {
            const state = sequence.slice(i, i + this.order).join('|');
            const next = sequence[i + this.order];
            if (!this.transitions[state]) this.transitions[state] = { Tài: 0, Xỉu: 0 };
            this.transitions[state][next]++;
        }
    }

    predict(lastResults) {
        if (lastResults.length < this.order) return null;
        const state = lastResults.slice(0, this.order).join('|');
        const trans = this.transitions[state];
        if (!trans || (trans.Tài + trans.Xỉu) < 3) return null;
        
        const total = trans.Tài + trans.Xỉu;
        const taiProb = trans.Tài / total;
        return {
            prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(taiProb - 0.5) * 50
        };
    }
}

// ==================== SIMPLE NEURAL NET ====================
class SimpleNeuralNet {
    constructor() {
        this.weights1 = Array(8).fill().map(() => Array(5).fill().map(() => Math.random() * 0.2 - 0.1));
        this.weights2 = Array(5).fill().map(() => Math.random() * 0.2 - 0.1);
        this.bias1 = Array(5).fill(0);
        this.bias2 = 0;
    }

    sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
    
    forward(features) {
        let hidden = Array(5).fill(0);
        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < features.length; j++) {
                hidden[i] += this.weights1[j][i] * features[j];
            }
            hidden[i] = this.sigmoid(hidden[i] + this.bias1[i]);
        }
        let output = 0;
        for (let i = 0; i < 5; i++) output += this.weights2[i] * hidden[i];
        return this.sigmoid(output + this.bias2);
    }

    extractFeatures(results, sums) {
        const features = Array(8).fill(0);
        features[0] = results.filter(r => r === 'Tài').length / results.length;
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[0]) streak++;
            else break;
        }
        features[1] = Math.min(1, streak / 10);
        let alt = 1;
        for (let i = 1; i < Math.min(results.length, 12); i++) {
            if (results[i] !== results[i-1]) alt++;
            else break;
        }
        features[2] = Math.min(1, alt / 12);
        features[3] = results[0] === 'Tài' ? 1 : 0;
        features[4] = results[1] === 'Tài' ? 1 : 0;
        features[5] = results[2] === 'Tài' ? 1 : 0;
        features[6] = results[3] === 'Tài' ? 1 : 0;
        features[7] = results[4] === 'Tài' ? 1 : 0;
        return features;
    }

    predict(results, sums) {
        if (results.length < 10) return null;
        const features = this.extractFeatures(results, sums);
        const output = this.forward(features);
        return {
            prediction: output > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(output - 0.5) * 60
        };
    }
}

// ==================== ANOMALY DETECTION ENGINE ====================
class AnomalyDetector {
    constructor() {
        this.anomalyPatterns = [];
        this.breakPoints = [];
        this.timeWindowStats = {};
        this.reinforcementMemory = { tai: 0, xiu: 0 };
        this.loadAnomalyData();
    }

    loadAnomalyData() {
        try {
            if (fs.existsSync(ANOMALY_FILE)) {
                const data = JSON.parse(fs.readFileSync(ANOMALY_FILE, 'utf8'));
                this.anomalyPatterns = data.anomalyPatterns || [];
                this.breakPoints = data.breakPoints || [];
                this.timeWindowStats = data.timeWindowStats || {};
                console.log(`[Anomaly] Loaded ${this.anomalyPatterns.length} patterns`);
            }
        } catch (error) {
            console.error('[Anomaly] Load error:', error.message);
        }
    }

    saveAnomalyData() {
        try {
            fs.writeFileSync(ANOMALY_FILE, JSON.stringify({
                anomalyPatterns: this.anomalyPatterns.slice(-200),
                breakPoints: this.breakPoints.slice(-200),
                timeWindowStats: this.timeWindowStats,
                lastSaved: new Date().toISOString()
            }, null, 2));
        } catch (error) {
            console.error('[Anomaly] Save error:', error.message);
        }
    }

    detectAnomaly(results, windowSize = 8) {
        if (results.length < windowSize) return { isAnomaly: false, score: 0 };
        
        const recent = results.slice(0, windowSize);
        const taiCount = recent.filter(r => r === 'Tài').length;
        const deviation = Math.abs(taiCount / windowSize - 0.5);
        const isAnomaly = deviation > 0.35;
        const anomalyScore = Math.min(100, deviation * 250);
        
        let breakDetected = false;
        let breakDirection = null;
        
        if (results.length >= 5) {
            const first4 = results.slice(0, 4);
            const fifth = results[4];
            const allSame = first4.every(r => r === first4[0]);
            if (allSame && fifth !== first4[0]) {
                breakDetected = true;
                breakDirection = fifth;
                this.recordBreakPoint(first4[0], fifth, new Date());
            }
        }
        
        let alternatingLength = 1;
        for (let i = 1; i < Math.min(results.length, 12); i++) {
            if (results[i] !== results[i-1]) alternatingLength++;
            else break;
        }
        const isAlternatingAnomaly = alternatingLength >= 7;
        
        return {
            isAnomaly: isAnomaly || breakDetected || isAlternatingAnomaly,
            score: anomalyScore,
            breakDetected,
            breakDirection,
            alternatingLength,
            isAlternatingAnomaly
        };
    }

    recordBreakPoint(fromType, toType, timestamp) {
        this.breakPoints.push({
            from: fromType,
            to: toType,
            timestamp: timestamp.toISOString(),
            hour: timestamp.getHours()
        });
        if (this.breakPoints.length > 200) this.breakPoints = this.breakPoints.slice(-200);
        this.saveAnomalyData();
    }

    learnFromResult(prediction, actual, confidence) {
        const isCorrect = prediction === actual;
        if (isCorrect) {
            this.reinforcementMemory[prediction === 'Tài' ? 'tai' : 'xiu'] += 1;
        } else {
            const wrongSide = prediction === 'Tài' ? 'tai' : 'xiu';
            this.reinforcementMemory[wrongSide] = Math.max(0, this.reinforcementMemory[wrongSide] - 0.5);
        }
        this.reinforcementMemory.tai = Math.min(5, Math.max(-3, this.reinforcementMemory.tai));
        this.reinforcementMemory.xiu = Math.min(5, Math.max(-3, this.reinforcementMemory.xiu));
        this.saveAnomalyData();
    }

    getBiasCorrection() {
        const diff = (this.reinforcementMemory.tai || 0) - (this.reinforcementMemory.xiu || 0);
        if (Math.abs(diff) < 1.5) return 0;
        return Math.max(-0.15, Math.min(0.15, diff / 15));
    }

    updateTimeWindowStats(result, timestamp) {
        const hour = timestamp.getHours();
        const minute = Math.floor(timestamp.getMinutes() / 15) * 15;
        const windowKey = `${hour}:${minute}`;
        if (!this.timeWindowStats[windowKey]) {
            this.timeWindowStats[windowKey] = { tai: 0, xiu: 0, total: 0 };
        }
        if (result === 'Tài') this.timeWindowStats[windowKey].tai++;
        else this.timeWindowStats[windowKey].xiu++;
        this.timeWindowStats[windowKey].total++;
        this.saveAnomalyData();
    }

    predictByTimeWindow(currentTimestamp) {
        const hour = currentTimestamp.getHours();
        const minute = Math.floor(currentTimestamp.getMinutes() / 15) * 15;
        const windowKey = `${hour}:${minute}`;
        const stats = this.timeWindowStats[windowKey];
        if (!stats || stats.total < 8) return null;
        const taiRatio = stats.tai / stats.total;
        if (taiRatio > 0.65) return { prediction: 'Tài', confidence: 55 + Math.round(taiRatio * 25) };
        if (taiRatio < 0.35) return { prediction: 'Xỉu', confidence: 55 + Math.round((1 - taiRatio) * 25) };
        return null;
    }
}

// ==================== ENSEMBLE VOTING SYSTEM ====================
class EnsembleVoter {
    constructor() {
        this.voters = [];
        this.voterWeights = {};
    }

    addVoter(name, predictFunc, weight = 1.0) {
        this.voters.push({ name, predictFunc, weight });
        this.voterWeights[name] = weight;
    }

    vote(data, context = {}) {
        const details = {};
        let taiScore = 0;
        let xiuScore = 0;
        let totalWeight = 0;
        
        for (const voter of this.voters) {
            try {
                const result = voter.predictFunc(data, context);
                if (result && result.prediction) {
                    const effectiveWeight = voter.weight * (result.confidence / 100);
                    totalWeight += effectiveWeight;
                    
                    if (result.prediction === 'Tài') taiScore += effectiveWeight;
                    else xiuScore += effectiveWeight;
                    
                    details[voter.name] = result;
                }
            } catch (e) {
                // Silent fail
            }
        }
        
        if (totalWeight === 0) {
            return { prediction: 'Tài', confidence: 55, details: {}, voteCount: 0 };
        }
        
        const finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
        const confidence = Math.round(Math.max(taiScore, xiuScore) / totalWeight * 100);
        
        return {
            prediction: finalPrediction,
            confidence: Math.min(88, Math.max(55, confidence)),
            details,
            voteCount: Object.keys(details).length
        };
    }
}

// ==================== PATTERN DETECTORS ====================
const patternDetectors = {
    cau_bet: (r) => ({ prediction: r[0] || 'Tài', confidence: 55 }),
    cau_dao_11: (r) => r[0] === r[1] ? null : { prediction: r[0], confidence: 58 },
    cau_22: (r) => {
        if (r.length >= 4 && r[0] === r[1] && r[2] === r[3] && r[0] !== r[2]) {
            return { prediction: r[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 65 };
        }
        return null;
    },
    cau_121: (r) => {
        if (r.length >= 3 && r[0] === r[2] && r[0] !== r[1]) {
            return { prediction: r[0], confidence: 60 };
        }
        return null;
    }
};

// ==================== HISTORICAL PATTERN ANALYZER ====================
class HistoricalPatternAnalyzer {
    constructor() {
        this.fullHistory = [];
        this.patternDatabase = new Map();
        this.loadFullHistory();
    }
    
    loadFullHistory() {
        try {
            if (fs.existsSync(FULL_HISTORY_FILE)) {
                const data = JSON.parse(fs.readFileSync(FULL_HISTORY_FILE, 'utf8'));
                this.fullHistory = data.history || [];
                console.log(`[History] Loaded ${this.fullHistory.length} historical records`);
                this.buildPatternDatabase();
            }
        } catch (e) {}
    }
    
    saveFullHistory() {
        fs.writeFileSync(FULL_HISTORY_FILE, JSON.stringify({
            history: this.fullHistory.slice(-2000),
            lastUpdated: new Date().toISOString()
        }, null, 2));
    }
    
    addToHistory(phien, result, type) {
        this.fullHistory.push({
            phien,
            result,
            type,
            timestamp: new Date().toISOString()
        });
        if (this.fullHistory.length > 2000) this.fullHistory.shift();
        this.saveFullHistory();
        this.buildPatternDatabase();
    }
    
    buildPatternDatabase() {
        this.patternDatabase.clear();
        const patternLength = 6;
        
        for (let i = 0; i <= this.fullHistory.length - patternLength - 1; i++) {
            const pattern = this.fullHistory.slice(i, i + patternLength).map(p => p.result);
            const nextResult = this.fullHistory[i + patternLength]?.result;
            const patternKey = pattern.join('');
            
            if (!this.patternDatabase.has(patternKey)) {
                this.patternDatabase.set(patternKey, { tai: 0, xiu: 0, total: 0 });
            }
            const stats = this.patternDatabase.get(patternKey);
            if (nextResult === 'Tài') stats.tai++;
            else stats.xiu++;
            stats.total++;
        }
        
        console.log(`[History] Built pattern database with ${this.patternDatabase.size} unique patterns`);
    }
    
    predictByHistory(recentResults) {
        if (recentResults.length < 6) return null;
        const patternKey = recentResults.slice(0, 6).join('');
        const stats = this.patternDatabase.get(patternKey);
        
        if (!stats || stats.total < 3) return null;
        
        const taiProb = stats.tai / stats.total;
        return {
            prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(taiProb - 0.5) * 40,
            matchesFound: stats.total
        };
    }
    
    detectCycles(results, minCycleLength = 3) {
        const cycles = [];
        const resultsStr = results.map(r => r === 'Tài' ? '1' : '0').join('');
        
        for (let len = minCycleLength; len <= Math.min(6, results.length / 2); len++) {
            const pattern = resultsStr.substring(0, len);
            let isCyclic = true;
            for (let i = 0; i < resultsStr.length - len; i += len) {
                const nextChunk = resultsStr.substring(i, i + len);
                if (nextChunk !== pattern.substring(0, nextChunk.length)) {
                    isCyclic = false;
                    break;
                }
            }
            if (isCyclic && pattern.length >= minCycleLength) {
                cycles.push({
                    length: len,
                    pattern: pattern,
                    nextPrediction: pattern[0] === '1' ? 'Tài' : 'Xỉu'
                });
            }
        }
        
        return cycles;
    }
}

// ==================== LEARNING DATA ====================
let learningData = {
    hu: { predictions: [], totalPredictions: 0, correctPredictions: 0, recentAccuracy: [], streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 }, lastUpdate: null },
    md5: { predictions: [], totalPredictions: 0, correctPredictions: 0, recentAccuracy: [], streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 }, lastUpdate: null }
};

// ==================== KHỞI TẠO CÁC ENGINE ====================
let monteCarloSimulators = { hu: null, md5: null };
let anomalyDetector = new AnomalyDetector();
let metaLearner = new MetaLearner();
let lstmRecognizer = new LSTMPatternRecognizer();
let fuzzyEngine = new FuzzyLogicEngine();
let bayesianInference = new BayesianInference();
let geneticAdaptor = new GeneticAdaptor();
let trendReversalDetector = new TrendReversalDetector();
let markovChain = new MarkovChainPredictor(2);
let neuralNet = new SimpleNeuralNet();
let ensembleVoter = new EnsembleVoter();
let advancedKalman = new AdvancedKalmanFilter();
let historicalAnalyzer = new HistoricalPatternAnalyzer();

// ==================== SETUP FULL ENSEMBLE ====================
function setupFullEnsemble() {
    ensembleVoter = new EnsembleVoter();
    
    ensembleVoter.addVoter('MonteCarlo', (data, ctx) => {
        if (monteCarloSimulators[ctx.type]) {
            return monteCarloSimulators[ctx.type].runSimulation(data, anomalyDetector, new Date().getHours());
        }
        return null;
    }, metaLearner.getWeight('monteCarlo'));
    
    ensembleVoter.addVoter('LSTM', (data, ctx) => {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        return lstmRecognizer.predict(results);
    }, metaLearner.getWeight('lstm'));
    
    ensembleVoter.addVoter('FuzzyLogic', (data, ctx) => {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        let streak = 1, alternating = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[0]) streak++;
            else break;
        }
        for (let i = 1; i < Math.min(results.length, 12); i++) {
            if (results[i] !== results[i-1]) alternating++;
            else break;
        }
        const sums = data.slice(0, 8).map(d => d.Tong);
        let vol = 0;
        if (sums.length > 1) {
            const mean = sums.slice(0,5).reduce((a,b)=>a+b,0)/Math.min(5, sums.length);
            vol = Math.sqrt(sums.slice(0,5).reduce((a,b)=>a+Math.pow(b-mean,2),0)/Math.min(5, sums.length));
        }
        const fuzzy = fuzzyEngine.evaluate(streak, alternating, vol);
        let result = { prediction: results[0], confidence: fuzzy.confidence };
        if (fuzzy.decision === 'break') {
            result.prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
        }
        return result;
    }, metaLearner.getWeight('fuzzyLogic'));
    
    ensembleVoter.addVoter('Bayesian', (data, ctx) => {
        const results = data.slice(0, 8).map(d => d.Ket_qua);
        const obsKey = bayesianInference.getObservationKey(results);
        return bayesianInference.predict([obsKey]);
    }, metaLearner.getWeight('bayesian'));
    
    ensembleVoter.addVoter('PatternMatch', (data, ctx) => {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        let bestMatch = null;
        let bestConfidence = 0;
        for (const [name, detector] of Object.entries(patternDetectors)) {
            const result = detector(results);
            if (result && result.confidence > bestConfidence) {
                bestMatch = result;
                bestConfidence = result.confidence;
            }
        }
        return bestMatch;
    }, metaLearner.getWeight('patternMatch'));
    
    ensembleVoter.addVoter('AnomalyBreak', (data, ctx) => {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        const anomaly = anomalyDetector.detectAnomaly(results, 8);
        if (anomaly.breakDetected && anomaly.breakDirection) {
            return { prediction: anomaly.breakDirection, confidence: 68 };
        }
        if (anomaly.isAlternatingAnomaly) {
            return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 65 };
        }
        return null;
    }, metaLearner.getWeight('anomalyBreak'));
    
    ensembleVoter.addVoter('TimeWindow', (data, ctx) => {
        return anomalyDetector.predictByTimeWindow(new Date());
    }, metaLearner.getWeight('timeWindow'));
    
    ensembleVoter.addVoter('TrendReversal', (data, ctx) => {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        return trendReversalDetector.detect(results);
    }, metaLearner.getWeight('trendReversal'));
    
    ensembleVoter.addVoter('MarkovChain', (data, ctx) => {
        const results = data.slice(0, 12).map(d => d.Ket_qua);
        if (learningData[ctx.type].predictions.length > 10) {
            const recentActuals = learningData[ctx.type].predictions.filter(p => p.verified).slice(0, 30).map(p => p.actual);
            if (recentActuals.length > 10) markovChain.learn(recentActuals);
        }
        return markovChain.predict(results);
    }, metaLearner.getWeight('markovChain'));
    
    ensembleVoter.addVoter('NeuralNet', (data, ctx) => {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        const sums = data.slice(0, 10).map(d => d.Tong);
        return neuralNet.predict(results, sums);
    }, metaLearner.getWeight('neuralNet'));
    
    ensembleVoter.addVoter('Kalman', (data, ctx) => {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        const taiRatio = results.filter(r => r === 'Tài').length / results.length;
        const filtered = advancedKalman.update(taiRatio);
        return {
            prediction: filtered > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(filtered - 0.5) * 60
        };
    }, metaLearner.getWeight('kalman'));
    
    ensembleVoter.addVoter('HistoricalPattern', (data, ctx) => {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        return historicalAnalyzer.predictByHistory(results);
    }, 1.2);
    
    ensembleVoter.addVoter('CycleDetector', (data, ctx) => {
        const results = data.slice(0, 12).map(d => d.Ket_qua);
        const cycles = historicalAnalyzer.detectCycles(results);
        if (cycles.length > 0) {
            const bestCycle = cycles[0];
            return {
                prediction: bestCycle.nextPrediction,
                confidence: 60 + Math.min(15, bestCycle.length * 3)
            };
        }
        return null;
    }, 1.1);
    
    console.log('\n✅ ENSEMBLE CONFIGURED WITH 12+ ALGORITHMS');
    console.log('   1. Monte Carlo     2. LSTM          3. Fuzzy Logic');
    console.log('   4. Bayesian        5. Pattern Match 6. Anomaly Break');
    console.log('   7. Time Window     8. Trend Reversal 9. Markov Chain');
    console.log('   10. Neural Net     11. Kalman Filter 12. Historical Pattern');
    console.log('   13. Cycle Detector\n');
}

// ==================== HELPER FUNCTIONS ====================
function updateMonteCarloSimulators(type, data) {
    if (data && data.length >= 10) {
        monteCarloSimulators[type] = new ImprovedMonteCarlo(data, 10);
    }
}

function transformApiData(apiData) {
    if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
    return apiData.list.map(item => ({
        Phien: item.id,
        Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
        Xuc_xac_1: item.dices[0],
        Xuc_xac_2: item.dices[1],
        Xuc_xac_3: item.dices[2],
        Tong: item.point
    }));
}

async function fetchDataHu() {
    const now = Date.now();
    if (dataCache.hu && dataCache.lastFetch.hu && (now - dataCache.lastFetch.hu) < CACHE_TTL) {
        return dataCache.hu;
    }
    try {
        const response = await axios.get(API_URL_HU);
        dataCache.hu = transformApiData(response.data);
        dataCache.lastFetch.hu = now;
        return dataCache.hu;
    } catch (error) {
        console.error('Error fetching HU data:', error.message);
        return dataCache.hu;
    }
}

async function fetchDataMd5() {
    const now = Date.now();
    if (dataCache.md5 && dataCache.lastFetch.md5 && (now - dataCache.lastFetch.md5) < CACHE_TTL) {
        return dataCache.md5;
    }
    try {
        const response = await axios.get(API_URL_MD5);
        dataCache.md5 = transformApiData(response.data);
        dataCache.lastFetch.md5 = now;
        return dataCache.md5;
    } catch (error) {
        console.error('Error fetching MD5 data:', error.message);
        return dataCache.md5;
    }
}

function normalizeResult(result) {
    if (result === 'Tài' || result === 'tài') return 'tai';
    if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
    return result.toLowerCase();
}

function savePredictionToHistory(type, phien, prediction, confidence) {
    const record = {
        phien_hien_tai: phien.toString(),
        du_doan: normalizeResult(prediction),
        ti_le: `${confidence}%`,
        id: 'kapub',
        timestamp: new Date().toISOString()
    };
    predictionHistory[type].unshift(record);
    if (predictionHistory[type].length > MAX_HISTORY) {
        predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
    return record;
}

function recordPrediction(type, phien, prediction, confidence, factors) {
    const record = {
        phien: phien.toString(),
        prediction,
        confidence,
        factors,
        timestamp: new Date().toISOString(),
        verified: false,
        actual: null,
        isCorrect: null
    };
    learningData[type].predictions.unshift(record);
    learningData[type].totalPredictions++;
    if (learningData[type].predictions.length > 500) {
        learningData[type].predictions = learningData[type].predictions.slice(0, 500);
    }
    saveLearningData();
}

async function verifyPredictions(type, currentData) {
    let updated = false;
    for (const pred of learningData[type].predictions) {
        if (pred.verified) continue;
        const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
        if (actualResult) {
            pred.verified = true;
            pred.actual = actualResult.Ket_qua;
            const predictedNormalized = pred.prediction === 'Tài' ? 'Tài' : 'Xỉu';
            pred.isCorrect = pred.actual === predictedNormalized;
            
            if (pred.isCorrect) {
                learningData[type].correctPredictions++;
                if (learningData[type].streakAnalysis.currentStreak >= 0) learningData[type].streakAnalysis.currentStreak++;
                else learningData[type].streakAnalysis.currentStreak = 1;
                if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
                    learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
                }
            } else {
                if (learningData[type].streakAnalysis.currentStreak <= 0) learningData[type].streakAnalysis.currentStreak--;
                else learningData[type].streakAnalysis.currentStreak = -1;
                if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
                    learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
                }
            }
            
            learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
            if (learningData[type].recentAccuracy.length > 50) learningData[type].recentAccuracy.shift();
            
            // Update models
            const actualValue = pred.actual === 'Tài' ? 1 : 0;
            advancedKalman.update(actualValue);
            anomalyDetector.learnFromResult(pred.prediction, pred.actual, pred.confidence);
            anomalyDetector.updateTimeWindowStats(pred.actual, new Date(pred.timestamp));
            bayesianInference.updateLikelihood(bayesianInference.getObservationKey(currentData.slice(0,5).map(d=>d.Ket_qua)), pred.actual);
            lstmRecognizer.learn(currentData.slice(0,8).map(d=>d.Ket_qua), pred.actual, pred.isCorrect);
            
            // Update meta learning weights
            const algorithmMap = {
                'MonteCarlo': 'monteCarlo', 'LSTM': 'lstm', 'FuzzyLogic': 'fuzzyLogic',
                'Bayesian': 'bayesian', 'PatternMatch': 'patternMatch', 'AnomalyBreak': 'anomalyBreak',
                'TimeWindow': 'timeWindow', 'TrendReversal': 'trendReversal', 'MarkovChain': 'markovChain',
                'NeuralNet': 'neuralNet', 'Kalman': 'kalman'
            };
            for (const factor of pred.factors || []) {
                for (const [key, value] of Object.entries(algorithmMap)) {
                    if (factor.includes(key)) {
                        metaLearner.updateWeights(value, pred.isCorrect, pred.confidence);
                    }
                }
            }
            
            updated = true;
        }
    }
    if (updated) {
        learningData[type].lastUpdate = new Date().toISOString();
        saveLearningData();
        anomalyDetector.saveAnomalyData();
    }
}

function saveLearningData() {
    try {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
    } catch (error) {
        console.error('Error saving learning data:', error.message);
    }
}

function loadLearningData() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            const data = fs.readFileSync(LEARNING_FILE, 'utf8');
            const parsed = JSON.parse(data);
            learningData = { ...learningData, ...parsed };
            console.log('[Load] Learning data loaded');
        }
    } catch (error) {
        console.error('Error loading learning data:', error.message);
    }
}

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            predictionHistory = parsed.history || { hu: [], md5: [] };
            lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
            console.log('[Load] Prediction history loaded');
        }
    } catch (error) {
        console.error('Error loading prediction history:', error.message);
    }
}

function savePredictionHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({
            history: predictionHistory,
            lastProcessedPhien,
            lastSaved: new Date().toISOString()
        }, null, 2));
    } catch (error) {
        console.error('Error saving prediction history:', error.message);
    }
}

// ==================== MAIN PREDICTION FUNCTION ====================
function calculateSuperPrediction(data, type) {
    const context = { type };
    const ensembleResult = ensembleVoter.vote(data, context);
    
    // Apply bias correction
    const kalmanBias = advancedKalman.getBias();
    let finalPrediction = ensembleResult.prediction;
    let finalConfidence = ensembleResult.confidence;
    
    if (Math.abs(kalmanBias) > 0.08) {
        if (kalmanBias > 0.08 && finalPrediction === 'Xỉu') {
            finalPrediction = 'Tài';
            finalConfidence = Math.min(85, finalConfidence + 5);
        } else if (kalmanBias < -0.08 && finalPrediction === 'Tài') {
            finalPrediction = 'Xỉu';
            finalConfidence = Math.min(85, finalConfidence + 5);
        }
    }
    
    // Check historical patterns
    const results = data.slice(0, 10).map(d => d.Ket_qua);
    const historicalPred = historicalAnalyzer.predictByHistory(results);
    if (historicalPred && historicalPred.confidence > 65) {
        if (historicalPred.confidence > finalConfidence + 5) {
            finalPrediction = historicalPred.prediction;
            finalConfidence = historicalPred.confidence;
        }
    }
    
    finalConfidence = Math.max(55, Math.min(88, finalConfidence));
    
    const factors = [];
    if (ensembleResult.details) {
        for (const [name, detail] of Object.entries(ensembleResult.details)) {
            if (detail && detail.confidence) {
                factors.push(`${name}: ${detail.confidence.toFixed(0)}%`);
            }
        }
    }
    factors.push(`KalmanBias: ${(kalmanBias * 100).toFixed(1)}%`);
    
    return {
        prediction: finalPrediction,
        confidence: finalConfidence,
        factors: factors.slice(0, 8),
        voteCount: ensembleResult.voteCount || 0,
        kalmanBias: kalmanBias
    };
}

// ==================== AUTO PROCESS ====================
async function autoProcessPredictions() {
    try {
        const dataHu = await fetchDataHu();
        if (dataHu && dataHu.length > 0) {
            updateMonteCarloSimulators('hu', dataHu);
            const latestHuPhien = dataHu[0].Phien;
            const nextHuPhien = latestHuPhien + 1;
            if (lastProcessedPhien.hu !== nextHuPhien) {
                await verifyPredictions('hu', dataHu);
                const result = calculateSuperPrediction(dataHu, 'hu');
                savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
                recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
                lastProcessedPhien.hu = nextHuPhien;
                
                const accuracy = learningData.hu.correctPredictions / Math.max(1, learningData.hu.totalPredictions);
                console.log(`[Auto] Hu ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | Bias: ${(result.kalmanBias * 100).toFixed(1)}% | Acc: ${(accuracy * 100).toFixed(1)}%`);
            }
        }
        
        const dataMd5 = await fetchDataMd5();
        if (dataMd5 && dataMd5.length > 0) {
            updateMonteCarloSimulators('md5', dataMd5);
            const latestMd5Phien = dataMd5[0].Phien;
            const nextMd5Phien = latestMd5Phien + 1;
            if (lastProcessedPhien.md5 !== nextMd5Phien) {
                await verifyPredictions('md5', dataMd5);
                const result = calculateSuperPrediction(dataMd5, 'md5');
                savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
                recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
                lastProcessedPhien.md5 = nextMd5Phien;
                
                const accuracy = learningData.md5.correctPredictions / Math.max(1, learningData.md5.totalPredictions);
                console.log(`[Auto] MD5 ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | Bias: ${(result.kalmanBias * 100).toFixed(1)}% | Acc: ${(accuracy * 100).toFixed(1)}%`);
            }
        }
        
        savePredictionHistory();
        saveLearningData();
    } catch (error) {
        console.error('[Auto] Error:', error.message);
    }
}

// ==================== EXPRESS ROUTES ====================
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('kapub - Super AI v10.0 with Advanced Statistics & Bias Correction');
});

app.get('/lc79-hu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
        updateMonteCarloSimulators('hu', data);
        await verifyPredictions('hu', data);
        const latestPhien = data[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = calculateSuperPrediction(data, 'hu');
        savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
        res.json({
            phien_hien_tai: nextPhien.toString(),
            du_doan: normalizeResult(result.prediction),
            ti_le: `${result.confidence}%`,
            id: 'kapub'
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
        updateMonteCarloSimulators('md5', data);
        await verifyPredictions('md5', data);
        const latestPhien = data[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = calculateSuperPrediction(data, 'md5');
        savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
        recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
        res.json({
            phien_hien_tai: nextPhien.toString(),
            du_doan: normalizeResult(result.prediction),
            ti_le: `${result.confidence}%`,
            id: 'kapub'
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (data && data.length > 0) await verifyPredictions('hu', data);
        const historyWithStatus = predictionHistory.hu.map(record => {
            const prediction = learningData.hu.predictions.find(p => p.phien === record.phien_hien_tai);
            return {
                ...record,
                ket_qua_thuc_te: prediction?.actual || null,
                status: prediction?.isCorrect === true ? '✅' : (prediction?.isCorrect === false ? '❌' : null)
            };
        });
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: historyWithStatus, total: historyWithStatus.length });
    } catch (error) {
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
    }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (data && data.length > 0) await verifyPredictions('md5', data);
        const historyWithStatus = predictionHistory.md5.map(record => {
            const prediction = learningData.md5.predictions.find(p => p.phien === record.phien_hien_tai);
            return {
                ...record,
                ket_qua_thuc_te: prediction?.actual || null,
                status: prediction?.isCorrect === true ? '✅' : (prediction?.isCorrect === false ? '❌' : null)
            };
        });
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: historyWithStatus, total: historyWithStatus.length });
    } catch (error) {
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
    }
});

app.get('/lc79-hu/analysis', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        updateMonteCarloSimulators('hu', data);
        await verifyPredictions('hu', data);
        const result = calculateSuperPrediction(data, 'hu');
        res.json({ 
            prediction: normalizeResult(result.prediction), 
            confidence: result.confidence, 
            factors: result.factors,
            voteCount: result.voteCount,
            kalmanBias: result.kalmanBias
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-md5/analysis', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        updateMonteCarloSimulators('md5', data);
        await verifyPredictions('md5', data);
        const result = calculateSuperPrediction(data, 'md5');
        res.json({ 
            prediction: normalizeResult(result.prediction), 
            confidence: result.confidence, 
            factors: result.factors,
            voteCount: result.voteCount,
            kalmanBias: result.kalmanBias
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-hu/learning', (req, res) => {
    const stats = learningData.hu;
    const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
    const recentAcc = stats.recentAccuracy.length > 0 ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(2) : 0;
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
        totalPredictions: stats.totalPredictions,
        correctPredictions: stats.correctPredictions,
        overallAccuracy: `${accuracy}%`,
        recentAccuracy: `${recentAcc}%`,
        streakAnalysis: stats.streakAnalysis,
        algorithmWeights: metaLearner.algorithmWeights,
        kalmanBias: advancedKalman.getBias(),
        kalmanState: advancedKalman.x,
        historicalPatterns: historicalAnalyzer.patternDatabase.size,
        lastUpdate: stats.lastUpdate
    });
});

app.get('/lc79-md5/learning', (req, res) => {
    const stats = learningData.md5;
    const accuracy = stats.totalPredictions > 0 ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
    const recentAcc = stats.recentAccuracy.length > 0 ? (stats.recentAccuracy.reduce((a, b) => a + b, 0) / stats.recentAccuracy.length * 100).toFixed(2) : 0;
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu MD5',
        totalPredictions: stats.totalPredictions,
        correctPredictions: stats.correctPredictions,
        overallAccuracy: `${accuracy}%`,
        recentAccuracy: `${recentAcc}%`,
        streakAnalysis: stats.streakAnalysis,
        algorithmWeights: metaLearner.algorithmWeights,
        kalmanBias: advancedKalman.getBias(),
        kalmanState: advancedKalman.x,
        historicalPatterns: historicalAnalyzer.patternDatabase.size,
        lastUpdate: stats.lastUpdate
    });
});

app.get('/reset-learning', (req, res) => {
    learningData = {
        hu: { predictions: [], totalPredictions: 0, correctPredictions: 0, recentAccuracy: [], streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 }, lastUpdate: null },
        md5: { predictions: [], totalPredictions: 0, correctPredictions: 0, recentAccuracy: [], streakAnalysis: { currentStreak: 0, bestStreak: 0, worstStreak: 0 }, lastUpdate: null }
    };
    monteCarloSimulators = { hu: null, md5: null };
    anomalyDetector = new AnomalyDetector();
    metaLearner = new MetaLearner();
    lstmRecognizer = new LSTMPatternRecognizer();
    fuzzyEngine = new FuzzyLogicEngine();
    bayesianInference = new BayesianInference();
    geneticAdaptor = new GeneticAdaptor();
    trendReversalDetector = new TrendReversalDetector();
    markovChain = new MarkovChainPredictor(2);
    neuralNet = new SimpleNeuralNet();
    advancedKalman = new AdvancedKalmanFilter();
    historicalAnalyzer = new HistoricalPatternAnalyzer();
    setupFullEnsemble();
    saveLearningData();
    res.json({ message: 'All learning data reset. Bias correction enabled.' });
});

// ==================== START SERVER ====================
loadLearningData();
loadPredictionHistory();
anomalyDetector.loadAnomalyData();
setupFullEnsemble();

setInterval(() => autoProcessPredictions(), AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 3000);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔══════════════════════════════════════════════════════════════════════╗`);
    console.log(`║     LẨU CUA 79 - SUPER AI v10.0 - BIAS CORRECTION ENABLED        ║`);
    console.log(`╚══════════════════════════════════════════════════════════════════════╝\n`);
    console.log(`🎯 GIẢI PHÁP CHỐNG NGHIÊNG XỈU:\n`);
    console.log(`   • Advanced Kalman Filter với bias tracking`);
    console.log(`   • Historical Pattern Database (${historicalAnalyzer.patternDatabase.size} patterns)`);
    console.log(`   • Cycle Detection & Analysis`);
    console.log(`   • Real-time weight adaptation\n`);
    console.log(`📊 13+ THUẬT TOÁN ĐANG CHẠY:\n`);
    console.log(`   [1]  Monte Carlo      [2]  LSTM            [3]  Fuzzy Logic`);
    console.log(`   [4]  Bayesian         [5]  Pattern Match   [6]  Anomaly Break`);
    console.log(`   [7]  Time Window      [8]  Trend Reversal  [9]  Markov Chain`);
    console.log(`   [10] Neural Net       [11] Kalman Filter   [12] Historical Pattern`);
    console.log(`   [13] Cycle Detector\n`);
    console.log(`📡 Server: http://0.0.0.0:${PORT}`);
    console.log(`\n⚠️  CHỈ SỐ QUAN TRỌNG:`);
    console.log(`   • Kalman Bias > 8% → Hệ thống đang tự điều chỉnh`);
    console.log(`   • Recent Accuracy > 55% → Hoạt động tốt\n`);
});
