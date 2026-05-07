const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'v12_learning_data.json';
const HISTORY_FILE = 'v12_history.json';
const OPTIMAL_WEIGHTS_FILE = 'optimal_weights.json';

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let dataCache = { hu: null, md5: null, lastFetch: { hu: 0, md5: 0 } };
const CACHE_TTL = 5000;

// ==================== ANALYSIS DATA STORAGE ====================
let analysisData = {
    hu: {
        modelPerformance: {},
        featureImportance: [],
        recentTrends: [],
        biasHistory: [],
        accuracyByHour: {},
        accuracyByStreak: {}
    },
    md5: {
        modelPerformance: {},
        featureImportance: [],
        recentTrends: [],
        biasHistory: [],
        accuracyByHour: {},
        accuracyByStreak: {}
    }
};

// ==================== TỐI ƯU HÓA BAYESIAN CHO THAM SỐ ====================
class BayesianOptimizer {
    constructor() {
        this.params = {
            threshold: { min: 0.45, max: 0.55, current: 0.5 },
            confidenceBoost: { min: 0.8, max: 1.2, current: 1.0 },
            streakWeight: { min: 0.5, max: 1.5, current: 1.0 }
        };
        this.history = [];
        this.gpMean = {};
        this.gpVariance = {};
    }
    
    updateParam(paramName, performance) {
        const param = this.params[paramName];
        if (!param) return;
        
        const step = (param.max - param.min) * 0.1;
        const gradient = performance - 0.5;
        let newValue = param.current + gradient * step;
        newValue = Math.max(param.min, Math.min(param.max, newValue));
        param.current = newValue;
        
        this.history.push({ paramName, oldValue: param.current, performance, timestamp: Date.now() });
        if (this.history.length > 100) this.history.shift();
        
        return param.current;
    }
    
    getOptimalThreshold() {
        return this.params.threshold.current;
    }
    
    getConfidenceMultiplier() {
        return this.params.confidenceBoost.current;
    }
}

// ==================== DEEP ENSEMBLE VỚI WEIGHT TỐI ƯU ====================
class DeepEnsembleOptimizer {
    constructor() {
        this.weights = {
            gradientBoost: 1.2,
            lstm: 1.3,
            svm: 1.15,
            patternMatch: 1.0,
            markovChain: 1.1,
            weightedMA: 0.9,
            bayesian: 1.25,
            monteCarlo: 1.0
        };
        this.performanceCache = new Map();
        this.loadOptimalWeights();
    }
    
    loadOptimalWeights() {
        try {
            if (fs.existsSync(OPTIMAL_WEIGHTS_FILE)) {
                const saved = JSON.parse(fs.readFileSync(OPTIMAL_WEIGHTS_FILE));
                this.weights = { ...this.weights, ...saved };
                console.log('[Optimizer] Loaded optimal weights');
            }
        } catch(e) {}
    }
    
    saveOptimalWeights() {
        fs.writeFileSync(OPTIMAL_WEIGHTS_FILE, JSON.stringify(this.weights, null, 2));
    }
    
    updateWeight(modelName, accuracy) {
        const currentWeight = this.weights[modelName] || 1.0;
        let newWeight = currentWeight * (0.95 + accuracy * 0.1);
        newWeight = Math.max(0.5, Math.min(2.0, newWeight));
        this.weights[modelName] = newWeight;
        
        this.performanceCache.set(modelName, { accuracy, timestamp: Date.now() });
        this.saveOptimalWeights();
        return newWeight;
    }
    
    getWeight(modelName) {
        return this.weights[modelName] || 1.0;
    }
    
    getAllWeights() {
        return this.weights;
    }
}

// ==================== GRADIENT BOOSTING NÂNG CAO ====================
class AdvancedGradientBoosting {
    constructor() {
        this.weakLearners = [];
        this.learningRate = 0.08;
        this.maxDepth = 3;
        this.subsample = 0.8;
        this.featureImportance = new Map();
        this.initFeatures();
    }
    
    initFeatures() {
        this.features = [
            'taiRatio', 'streak', 'alternating', 'volatility',
            'last3Pattern', 'last5Pattern', 'hourOfDay', 'sumTrend'
        ];
        this.features.forEach(f => this.featureImportance.set(f, 1.0 / this.features.length));
    }
    
    predict(features) {
        let prediction = 0.5;
        
        for (const learner of this.weakLearners.slice(-20)) {
            let learnerPred = learner.bias;
            for (let i = 0; i < features.length && i < learner.weights.length; i++) {
                learnerPred += learner.weights[i] * features[i];
            }
            prediction += this.learningRate * Math.tanh(learnerPred);
        }
        
        const prob = 1 / (1 + Math.exp(-prediction * 2));
        return {
            probability: prob,
            prediction: prob > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(prob - 0.5) * 90
        };
    }
    
    update(features, actual) {
        const target = actual === 'Tài' ? 1 : 0;
        const currentPred = this.predict(features);
        const residual = target - currentPred.probability;
        
        const weights = features.map(() => (Math.random() - 0.5) * 0.2);
        this.weakLearners.push({
            weights: weights,
            bias: residual * 0.5,
            timestamp: Date.now()
        });
        
        if (this.weakLearners.length > 50) this.weakLearners.shift();
        
        for (let i = 0; i < features.length && i < this.features.length; i++) {
            const importance = Math.abs(residual * features[i]);
            const oldImp = this.featureImportance.get(this.features[i]) || 0.1;
            this.featureImportance.set(this.features[i], oldImp * 0.95 + importance * 0.05);
        }
    }
    
    getImportantFeatures() {
        const sorted = Array.from(this.featureImportance.entries())
            .sort((a,b) => b[1] - a[1])
            .slice(0, 5);
        return sorted;
    }
}

// ==================== LSTM DEEP LEARNING NÂNG CAO ====================
class AdvancedLSTM {
    constructor() {
        this.hiddenState = Array(16).fill(0);
        this.cellState = Array(16).fill(0);
        this.weights = {
            input: Array(16).fill().map(() => Array(12).fill().map(() => Math.random() * 0.2 - 0.1)),
            forget: Array(16).fill().map(() => Array(12).fill().map(() => Math.random() * 0.2 - 0.1)),
            output: Array(16).fill().map(() => Array(12).fill().map(() => Math.random() * 0.2 - 0.1)),
            cell: Array(16).fill().map(() => Array(12).fill().map(() => Math.random() * 0.2 - 0.1))
        };
        this.learningRate = 0.003;
        this.sequenceMemory = [];
        this.accuracy = 0.5;
    }
    
    sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
    tanh(x) { return Math.tanh(x); }
    
    forward(input) {
        const newHidden = Array(16).fill(0);
        const newCell = Array(16).fill(0);
        
        for (let i = 0; i < 16; i++) {
            let inputGate = 0, forgetGate = 0, outputGate = 0, cellGate = 0;
            
            for (let j = 0; j < input.length; j++) {
                inputGate += this.weights.input[i][j] * input[j];
                forgetGate += this.weights.forget[i][j] * input[j];
                outputGate += this.weights.output[i][j] * input[j];
                cellGate += this.weights.cell[i][j] * input[j];
            }
            
            for (let j = 0; j < 16; j++) {
                inputGate += this.weights.input[i][j + input.length] * this.hiddenState[j];
                forgetGate += this.weights.forget[i][j + input.length] * this.hiddenState[j];
                outputGate += this.weights.output[i][j + input.length] * this.hiddenState[j];
                cellGate += this.weights.cell[i][j + input.length] * this.hiddenState[j];
            }
            
            const iGate = this.sigmoid(inputGate);
            const fGate = this.sigmoid(forgetGate);
            const oGate = this.sigmoid(outputGate);
            const cGate = this.tanh(cellGate);
            
            newCell[i] = fGate * this.cellState[i] + iGate * cGate;
            newHidden[i] = oGate * this.tanh(newCell[i]);
        }
        
        this.hiddenState = newHidden;
        this.cellState = newCell;
        
        let output = 0;
        for (let i = 0; i < 16; i++) {
            output += this.hiddenState[i] * (Math.random() * 0.5);
        }
        
        return this.sigmoid(output);
    }
    
    extractFeatures(results, sums) {
        const features = [];
        for (let i = 0; i < Math.min(10, results.length); i++) {
            features.push(results[i] === 'Tài' ? 1 : 0);
        }
        for (let i = 0; i < Math.min(10, results.length); i++) {
            features.push(0);
        }
        while (features.length < 12) features.push(0);
        
        if (results.length > 0) {
            const taiRatio = results.filter(r => r === 'Tài').length / results.length;
            features[10] = taiRatio;
        }
        if (sums.length > 0) {
            const avgSum = sums.slice(0, 5).reduce((a,b) => a+b, 0) / Math.min(5, sums.length);
            features[11] = avgSum / 13;
        }
        
        return features;
    }
    
    predict(results, sums) {
        if (results.length < 5) return { prediction: 'Tài', confidence: 55 };
        
        const features = this.extractFeatures(results, sums);
        const output = this.forward(features);
        
        this.sequenceMemory.push({ features, output, timestamp: Date.now() });
        if (this.sequenceMemory.length > 30) this.sequenceMemory.shift();
        
        return {
            prediction: output > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(output - 0.5) * 80,
            probability: output
        };
    }
    
    train(target) {
        if (this.sequenceMemory.length === 0) return;
        
        const lastSeq = this.sequenceMemory[this.sequenceMemory.length - 1];
        const error = target - lastSeq.output;
        
        for (let layer of ['input', 'forget', 'output', 'cell']) {
            const weights = this.weights[layer];
            for (let i = 0; i < weights.length; i++) {
                for (let j = 0; j < weights[i].length; j++) {
                    weights[i][j] += this.learningRate * error * lastSeq.features[j % lastSeq.features.length];
                }
            }
        }
        
        // Update accuracy tracking
        const correct = (target === 1 && lastSeq.output > 0.5) || (target === 0 && lastSeq.output <= 0.5);
        this.accuracy = this.accuracy * 0.95 + (correct ? 1 : 0) * 0.05;
    }
    
    getAccuracy() {
        return this.accuracy;
    }
}

// ==================== SUPPORT VECTOR MACHINE VỚI RBF KERNEL ====================
class SVMWithRBF {
    constructor() {
        this.supportVectors = [];
        this.alphas = [];
        this.bias = 0;
        this.gamma = 0.5;
        this.C = 1.0;
        this.accuracy = 0.5;
    }
    
    rbfKernel(x1, x2) {
        let squaredDist = 0;
        for (let i = 0; i < x1.length; i++) {
            const diff = x1[i] - x2[i];
            squaredDist += diff * diff;
        }
        return Math.exp(-this.gamma * squaredDist);
    }
    
    predict(features) {
        let sum = this.bias;
        for (let i = 0; i < this.supportVectors.length; i++) {
            sum += this.alphas[i] * this.rbfKernel(features, this.supportVectors[i]);
        }
        const decision = Math.tanh(sum);
        return {
            prediction: decision > 0 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(decision) * 40,
            decisionValue: decision
        };
    }
    
    addSupportVector(vector, alpha) {
        this.supportVectors.push(vector);
        this.alphas.push(alpha);
        
        if (this.supportVectors.length > 100) {
            this.supportVectors.shift();
            this.alphas.shift();
        }
    }
    
    update(features, actual) {
        const target = actual === 'Tài' ? 1 : -1;
        const prediction = this.predict(features);
        const error = target - prediction.decisionValue;
        
        if (error * target < 1) {
            this.addSupportVector(features.slice(), target * this.C * Math.abs(error));
            this.bias += 0.01 * error;
        }
        
        // Update accuracy
        const correct = (target === 1 && prediction.decisionValue > 0) || (target === -1 && prediction.decisionValue <= 0);
        this.accuracy = this.accuracy * 0.95 + (correct ? 1 : 0) * 0.05;
    }
    
    getAccuracy() {
        return this.accuracy;
    }
}

// ==================== MAIN PREDICTION ENGINE V12 ====================
class SuperPredictionEngineV12 {
    constructor() {
        this.gradientBoosting = new AdvancedGradientBoosting();
        this.lstm = new AdvancedLSTM();
        this.svmRBF = new SVMWithRBF();
        this.ensembleOptimizer = new DeepEnsembleOptimizer();
        this.bayesianOptimizer = new BayesianOptimizer();
        this.predictionCache = [];
        this.accuracyTracking = [];
        this.modelAccuracies = {};
        
        this.models = {
            gradientBoost: (data) => this.predictGradientBoost(data),
            lstm: (data) => this.predictLSTM(data),
            svm: (data) => this.predictSVM(data),
            patternMatch: (data) => this.predictPatternMatch(data),
            markovChain: (data) => this.predictMarkovChain(data),
            weightedMA: (data) => this.predictWeightedMA(data),
            bayesian: (data) => this.predictBayesian(data),
            monteCarlo: (data) => this.predictMonteCarlo(data)
        };
        
        // Initialize model accuracies
        for (const name of Object.keys(this.models)) {
            this.modelAccuracies[name] = 0.5;
        }
    }
    
    extractFeatures(results, sums) {
        const features = [];
        
        const taiRatio = results.filter(r => r === 'Tài').length / results.length;
        features.push(taiRatio);
        
        let streak = 1;
        for (let i = 1; i < results.length; i++) {
            if (results[i] === results[0]) streak++;
            else break;
        }
        features.push(Math.min(1, streak / 10));
        
        let alt = 1;
        for (let i = 1; i < Math.min(results.length, 15); i++) {
            if (results[i] !== results[i-1]) alt++;
            else break;
        }
        features.push(Math.min(1, alt / 15));
        
        let volatility = 0;
        if (sums.length > 1) {
            const mean = sums.slice(0, 5).reduce((a,b) => a+b, 0) / Math.min(5, sums.length);
            volatility = Math.sqrt(sums.slice(0, 5).reduce((a,b) => a + Math.pow(b - mean, 2), 0) / Math.min(5, sums.length));
        }
        features.push(Math.min(1, volatility / 8));
        
        for (let i = 0; i < Math.min(3, results.length); i++) {
            features.push(results[i] === 'Tài' ? 1 : 0);
        }
        
        const hour = new Date().getHours();
        features.push(Math.sin(2 * Math.PI * hour / 24));
        
        let sumTrend = 0;
        if (sums.length >= 3) {
            sumTrend = (sums[0] - sums[1]) + (sums[1] - sums[2]);
        }
        features.push(Math.max(-1, Math.min(1, sumTrend / 10)));
        
        return features;
    }
    
    predictGradientBoost(data) {
        const results = data.slice(0, 12).map(d => d.Ket_qua);
        const sums = data.slice(0, 10).map(d => d.Tong);
        const features = this.extractFeatures(results, sums);
        return this.gradientBoosting.predict(features);
    }
    
    predictLSTM(data) {
        const results = data.slice(0, 15).map(d => d.Ket_qua);
        const sums = data.slice(0, 12).map(d => d.Tong);
        return this.lstm.predict(results, sums);
    }
    
    predictSVM(data) {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        const sums = data.slice(0, 8).map(d => d.Tong);
        const features = this.extractFeatures(results, sums);
        return this.svmRBF.predict(features);
    }
    
    predictPatternMatch(data) {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        const patterns = {
            'Tài,Tài,Tài': { next: 'Xỉu', confidence: 65 },
            'Xỉu,Xỉu,Xỉu': { next: 'Tài', confidence: 65 },
            'Tài,Xỉu,Tài,Xỉu,Tài,Xỉu': { next: 'Tài', confidence: 60 },
            'Xỉu,Tài,Xỉu,Tài,Xỉu,Tài': { next: 'Xỉu', confidence: 60 }
        };
        
        const key = results.slice(0, 6).join(',');
        const match = patterns[key];
        
        if (match) {
            return { prediction: match.next, confidence: match.confidence };
        }
        
        const taiCount = results.filter(r => r === 'Tài').length;
        const taiProb = taiCount / results.length;
        return {
            prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 55 + Math.abs(taiProb - 0.5) * 30
        };
    }
    
    predictMarkovChain(data) {
        const results = data.slice(0, 15).map(d => d.Ket_qua);
        const order = 2;
        const transitions = new Map();
        
        for (let i = 0; i <= results.length - order - 1; i++) {
            const state = results.slice(i, i + order).join(',');
            const next = results[i + order];
            const key = `${state}->${next}`;
            transitions.set(key, (transitions.get(key) || 0) + 1);
        }
        
        const currentState = results.slice(0, order).join(',');
        let taiCount = 0, xiuCount = 0;
        
        for (const [key, count] of transitions) {
            if (key.startsWith(currentState)) {
                if (key.endsWith('Tài')) taiCount += count;
                else if (key.endsWith('Xỉu')) xiuCount += count;
            }
        }
        
        const total = taiCount + xiuCount;
        if (total === 0) return null;
        
        const taiProb = taiCount / total;
        return {
            prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(taiProb - 0.5) * 60
        };
    }
    
    predictWeightedMA(data) {
        const weights = [0.3, 0.25, 0.2, 0.15, 0.1];
        const results = data.slice(0, 5).map(d => d.Ket_qua);
        
        let weightedTai = 0;
        let totalWeight = 0;
        
        for (let i = 0; i < results.length && i < weights.length; i++) {
            totalWeight += weights[i];
            if (results[i] === 'Tài') weightedTai += weights[i];
        }
        
        const taiProb = weightedTai / totalWeight;
        return {
            prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 55 + Math.abs(taiProb - 0.5) * 50
        };
    }
    
    predictBayesian(data) {
        const results = data.slice(0, 8).map(d => d.Ket_qua);
        const priors = { Tai: 0.5, Xiu: 0.5 };
        
        let taiPosterior = priors.Tai;
        let xiuPosterior = priors.Xiu;
        
        for (let i = 0; i < results.length; i++) {
            const observed = results[i];
            if (observed === 'Tài') {
                taiPosterior *= 0.55;
                xiuPosterior *= 0.45;
            } else {
                taiPosterior *= 0.45;
                xiuPosterior *= 0.55;
            }
        }
        
        const total = taiPosterior + xiuPosterior;
        const taiProb = taiPosterior / total;
        
        return {
            prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 50 + Math.abs(taiProb - 0.5) * 70
        };
    }
    
    predictMonteCarlo(data) {
        const results = data.slice(0, 10).map(d => d.Ket_qua);
        const sums = data.slice(0, 8).map(d => d.Tong);
        
        let taiCount = 0;
        const simulations = 1000;
        
        for (let sim = 0; sim < simulations; sim++) {
            let volatility = 0.2;
            if (sums.length > 1) {
                const mean = sums.slice(0, 5).reduce((a,b) => a+b, 0) / Math.min(5, sums.length);
                volatility = Math.min(0.5, Math.sqrt(sums.slice(0, 5).reduce((a,b) => a + Math.pow(b - mean, 2), 0) / Math.min(5, sums.length)) / 10);
            }
            const recentBias = results.filter(r => r === 'Tài').length / results.length;
            let simulatedProb = recentBias + (Math.random() - 0.5) * volatility * 0.3;
            simulatedProb = Math.max(0.3, Math.min(0.7, simulatedProb));
            
            if (simulatedProb > 0.5) taiCount++;
        }
        
        const taiProb = taiCount / simulations;
        return {
            prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
            confidence: 55 + Math.abs(taiProb - 0.5) * 50
        };
    }
    
    predict(data, type) {
        const results = data.slice(0, 15).map(d => d.Ket_qua);
        const sums = data.slice(0, 12).map(d => d.Tong);
        
        const predictions = [];
        const modelDetails = {};
        
        for (const [name, model] of Object.entries(this.models)) {
            try {
                const pred = model(data);
                if (pred && pred.prediction) {
                    const weight = this.ensembleOptimizer.getWeight(name);
                    const effectiveWeight = weight * (pred.confidence / 100);
                    predictions.push({
                        name,
                        prediction: pred.prediction,
                        confidence: pred.confidence,
                        weight: effectiveWeight
                    });
                    modelDetails[name] = {
                        prediction: pred.prediction,
                        confidence: pred.confidence,
                        weight: weight
                    };
                }
            } catch(e) {
                console.error(`Model ${name} error:`, e.message);
            }
        }
        
        if (predictions.length === 0) {
            return { prediction: 'Tài', confidence: 55, details: {}, ensembleSize: 0 };
        }
        
        let taiWeight = 0, xiuWeight = 0;
        for (const pred of predictions) {
            if (pred.prediction === 'Tài') {
                taiWeight += pred.weight;
            } else {
                xiuWeight += pred.weight;
            }
        }
        
        const totalWeight = taiWeight + xiuWeight;
        let rawTaiProb = totalWeight > 0 ? taiWeight / totalWeight : 0.5;
        
        const optimalThreshold = this.bayesianOptimizer.getOptimalThreshold();
        let finalPrediction = rawTaiProb > optimalThreshold ? 'Tài' : 'Xỉu';
        let finalConfidence = 50 + Math.abs(rawTaiProb - 0.5) * 80;
        
        const confidenceMult = this.bayesianOptimizer.getConfidenceMultiplier();
        finalConfidence = Math.min(90, finalConfidence * confidenceMult);
        
        if (finalConfidence < 60 && results.length > 5) {
            const lstmPred = this.lstm.predict(results, sums);
            if (lstmPred.confidence > 65) {
                finalPrediction = lstmPred.prediction;
                finalConfidence = (finalConfidence + lstmPred.confidence) / 2;
            }
        }
        
        this.predictionCache.push({
            prediction: finalPrediction,
            confidence: finalConfidence,
            timestamp: Date.now(),
            type: type,
            modelDetails: modelDetails
        });
        
        if (this.predictionCache.length > 200) this.predictionCache.shift();
        
        return {
            prediction: finalPrediction,
            confidence: Math.round(finalConfidence),
            ensembleSize: predictions.length,
            details: modelDetails,
            topModels: predictions.slice(0, 3).map(p => `${p.name}(${Math.round(p.confidence)}%)`).join(', ')
        };
    }
    
    learn(prediction, actual, confidence, modelDetails, type) {
        const isCorrect = prediction === actual;
        
        this.accuracyTracking.push({ correct: isCorrect, timestamp: Date.now() });
        if (this.accuracyTracking.length > 100) this.accuracyTracking.shift();
        
        const recentAccuracy = this.accuracyTracking.slice(-50).filter(a => a.correct).length / 
                              Math.min(50, this.accuracyTracking.length);
        
        // Update each model's accuracy based on their prediction
        for (const [modelName, details] of Object.entries(modelDetails)) {
            const modelCorrect = details.prediction === actual;
            const oldAcc = this.modelAccuracies[modelName] || 0.5;
            this.modelAccuracies[modelName] = oldAcc * 0.95 + (modelCorrect ? 1 : 0) * 0.05;
            this.ensembleOptimizer.updateWeight(modelName, this.modelAccuracies[modelName]);
        }
        
        this.bayesianOptimizer.updateParam('threshold', recentAccuracy);
        this.bayesianOptimizer.updateParam('confidenceBoost', recentAccuracy);
        
        const features = this.extractFeatures(
            this.predictionCache.slice(-12).filter(p => p.type === type).map(p => p.prediction || 'Tài'),
            []
        );
        this.gradientBoosting.update(features, actual);
        this.lstm.train(actual === 'Tài' ? 1 : 0);
        this.svmRBF.update(features, actual);
        
        return recentAccuracy;
    }
    
    getAccuracy() {
        if (this.accuracyTracking.length === 0) return 0;
        const recent = this.accuracyTracking.slice(-50);
        const correct = recent.filter(a => a.correct).length;
        return (correct / recent.length) * 100;
    }
    
    getModelAccuracies() {
        return this.modelAccuracies;
    }
    
    getFeatureImportance() {
        return this.gradientBoosting.getImportantFeatures();
    }
}

// ==================== DATA MANAGEMENT ====================

let learningData = {
    hu: { predictions: [], total: 0, correct: 0, accuracy: 0 },
    md5: { predictions: [], total: 0, correct: 0, accuracy: 0 }
};

let engines = {
    hu: new SuperPredictionEngineV12(),
    md5: new SuperPredictionEngineV12()
};

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

async function verifyAndLearn(type, currentData) {
    let updated = false;
    const engine = engines[type];
    const data = learningData[type];
    
    for (const pred of data.predictions) {
        if (pred.verified) continue;
        const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
        if (actualResult) {
            pred.verified = true;
            pred.actual = actualResult.Ket_qua;
            pred.isCorrect = pred.prediction === pred.actual;
            
            if (pred.isCorrect) {
                data.correct++;
            }
            
            // Learn with model details if available
            const accuracy = engine.learn(pred.prediction, pred.actual, pred.confidence, pred.modelDetails || {}, type);
            
            // Update prediction history entry with actual result
            const historyEntry = predictionHistory[type].find(h => h.phien_hien_tai === pred.phien);
            if (historyEntry) {
                historyEntry.ket_qua_thuc_te = pred.actual;
                historyEntry.status = pred.isCorrect ? '✅ Đúng' : '❌ Sai';
                historyEntry.actual_normalized = normalizeResult(pred.actual);
            }
            
            updated = true;
        }
    }
    
    if (updated) {
        data.accuracy = data.total > 0 ? (data.correct / data.total * 100).toFixed(2) : 0;
        saveLearningData();
        savePredictionHistory();
    }
}

async function autoProcess() {
    try {
        // Process HU
        const dataHu = await fetchDataHu();
        if (dataHu && dataHu.length > 0) {
            const latestHuPhien = dataHu[0].Phien;
            const nextHuPhien = latestHuPhien + 1;
            
            if (lastProcessedPhien.hu !== nextHuPhien) {
                await verifyAndLearn('hu', dataHu);
                const result = engines.hu.predict(dataHu, 'hu');
                
                const record = {
                    phien: nextHuPhien.toString(),
                    prediction: result.prediction,
                    confidence: result.confidence,
                    timestamp: new Date().toISOString(),
                    verified: false,
                    actual: null,
                    isCorrect: null,
                    modelDetails: result.details
                };
                learningData.hu.predictions.unshift(record);
                learningData.hu.total++;
                
                predictionHistory.hu.unshift({
                    phien_hien_tai: nextHuPhien.toString(),
                    du_doan: normalizeResult(result.prediction),
                    ti_le: `${result.confidence}%`,
                    id: 'kapub',
                    timestamp: new Date().toISOString(),
                    ket_qua_thuc_te: null,
                    status: null,
                    actual_normalized: null
                });
                
                lastProcessedPhien.hu = nextHuPhien;
                
                const currentAccuracy = engines.hu.getAccuracy();
                console.log(`[HU v12] ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | Ensemble:${result.ensembleSize} | Acc:${learningData.hu.accuracy}% | Live:${currentAccuracy.toFixed(1)}%`);
            }
        }
        
        // Process MD5
        const dataMd5 = await fetchDataMd5();
        if (dataMd5 && dataMd5.length > 0) {
            const latestMd5Phien = dataMd5[0].Phien;
            const nextMd5Phien = latestMd5Phien + 1;
            
            if (lastProcessedPhien.md5 !== nextMd5Phien) {
                await verifyAndLearn('md5', dataMd5);
                const result = engines.md5.predict(dataMd5, 'md5');
                
                const record = {
                    phien: nextMd5Phien.toString(),
                    prediction: result.prediction,
                    confidence: result.confidence,
                    timestamp: new Date().toISOString(),
                    verified: false,
                    actual: null,
                    isCorrect: null,
                    modelDetails: result.details
                };
                learningData.md5.predictions.unshift(record);
                learningData.md5.total++;
                
                predictionHistory.md5.unshift({
                    phien_hien_tai: nextMd5Phien.toString(),
                    du_doan: normalizeResult(result.prediction),
                    ti_le: `${result.confidence}%`,
                    id: 'kapub',
                    timestamp: new Date().toISOString(),
                    ket_qua_thuc_te: null,
                    status: null,
                    actual_normalized: null
                });
                
                lastProcessedPhien.md5 = nextMd5Phien;
                
                const currentAccuracy = engines.md5.getAccuracy();
                console.log(`[MD5 v12] ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | Ensemble:${result.ensembleSize} | Acc:${learningData.md5.accuracy}% | Live:${currentAccuracy.toFixed(1)}%`);
            }
        }
        
        // Trim histories
        if (predictionHistory.hu.length > 500) predictionHistory.hu = predictionHistory.hu.slice(0, 500);
        if (predictionHistory.md5.length > 500) predictionHistory.md5 = predictionHistory.md5.slice(0, 500);
        if (learningData.hu.predictions.length > 500) learningData.hu.predictions = learningData.hu.predictions.slice(0, 500);
        if (learningData.md5.predictions.length > 500) learningData.md5.predictions = learningData.md5.predictions.slice(0, 500);
        
        saveLearningData();
        savePredictionHistory();
        
    } catch (error) {
        console.error('[Auto] Error:', error.message);
    }
}

function saveLearningData() {
    try {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
    } catch(e) {}
}

function loadLearningData() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            const data = JSON.parse(fs.readFileSync(LEARNING_FILE));
            learningData = { ...learningData, ...data };
            console.log(`[Load] Learning data loaded - HU:${learningData.hu.accuracy}% MD5:${learningData.md5.accuracy}%`);
        }
    } catch(e) {}
}

function savePredictionHistory() {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify({
            history: predictionHistory,
            lastProcessedPhien
        }, null, 2));
    } catch(e) {}
}

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE));
            predictionHistory = data.history || { hu: [], md5: [] };
            lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
            console.log(`[Load] Prediction history loaded - HU:${predictionHistory.hu.length} MD5:${predictionHistory.md5.length} records`);
        }
    } catch(e) {}
}

// ==================== API ENDPOINTS ====================

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('kapub - Super AI v12.1 - Full Analysis & History Fixed');
});

// Main prediction endpoints
app.get('/lc79-hu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });
        
        await verifyAndLearn('hu', data);
        const latestPhien = data[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = engines.hu.predict(data, 'hu');
        
        learningData.hu.predictions.unshift({
            phien: nextPhien.toString(),
            prediction: result.prediction,
            confidence: result.confidence,
            timestamp: new Date().toISOString(),
            verified: false,
            actual: null,
            isCorrect: null,
            modelDetails: result.details
        });
        learningData.hu.total++;
        
        predictionHistory.hu.unshift({
            phien_hien_tai: nextPhien.toString(),
            du_doan: normalizeResult(result.prediction),
            ti_le: `${result.confidence}%`,
            id: 'kapub',
            timestamp: new Date().toISOString(),
            ket_qua_thuc_te: null,
            status: null,
            actual_normalized: null
        });
        
        saveLearningData();
        savePredictionHistory();
        
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
        
        await verifyAndLearn('md5', data);
        const latestPhien = data[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = engines.md5.predict(data, 'md5');
        
        learningData.md5.predictions.unshift({
            phien: nextPhien.toString(),
            prediction: result.prediction,
            confidence: result.confidence,
            timestamp: new Date().toISOString(),
            verified: false,
            actual: null,
            isCorrect: null,
            modelDetails: result.details
        });
        learningData.md5.total++;
        
        predictionHistory.md5.unshift({
            phien_hien_tai: nextPhien.toString(),
            du_doan: normalizeResult(result.prediction),
            ti_le: `${result.confidence}%`,
            id: 'kapub',
            timestamp: new Date().toISOString(),
            ket_qua_thuc_te: null,
            status: null,
            actual_normalized: null
        });
        
        saveLearningData();
        savePredictionHistory();
        
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

// History endpoints with correct/incorrect display
app.get('/lc79-hu/lichsu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (data && data.length > 0) {
            await verifyAndLearn('hu', data);
        }
        
        // Format history with status
        const formattedHistory = predictionHistory.hu.map(record => {
            const status = record.status;
            let statusIcon = '';
            if (status === '✅ Đúng') statusIcon = '✅';
            else if (status === '❌ Sai') statusIcon = '❌';
            else statusIcon = '⏳';
            
            return {
                ...record,
                hien_thi: `${record.phien_hien_tai} | Dự đoán: ${record.du_doan} (${record.ti_le}) | Thực tế: ${record.ket_qua_thuc_te || 'Chờ'} | ${statusIcon} ${record.status || 'Chưa có kết quả'}`,
                status_icon: statusIcon
            };
        });
        
        const stats = {
            total: formattedHistory.length,
            correct: formattedHistory.filter(h => h.status === '✅ Đúng').length,
            wrong: formattedHistory.filter(h => h.status === '❌ Sai').length,
            pending: formattedHistory.filter(h => h.status === null).length,
            accuracy: learningData.hu.accuracy
        };
        
        res.json({
            type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
            stats: stats,
            history: formattedHistory,
            total: formattedHistory.length
        });
    } catch (error) {
        res.json({
            type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
            stats: { total: predictionHistory.hu.length, correct: 0, wrong: 0, pending: predictionHistory.hu.length, accuracy: '0%' },
            history: predictionHistory.hu,
            total: predictionHistory.hu.length
        });
    }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (data && data.length > 0) {
            await verifyAndLearn('md5', data);
        }
        
        const formattedHistory = predictionHistory.md5.map(record => {
            const status = record.status;
            let statusIcon = '';
            if (status === '✅ Đúng') statusIcon = '✅';
            else if (status === '❌ Sai') statusIcon = '❌';
            else statusIcon = '⏳';
            
            return {
                ...record,
                hien_thi: `${record.phien_hien_tai} | Dự đoán: ${record.du_doan} (${record.ti_le}) | Thực tế: ${record.ket_qua_thuc_te || 'Chờ'} | ${statusIcon} ${record.status || 'Chưa có kết quả'}`,
                status_icon: statusIcon
            };
        });
        
        const stats = {
            total: formattedHistory.length,
            correct: formattedHistory.filter(h => h.status === '✅ Đúng').length,
            wrong: formattedHistory.filter(h => h.status === '❌ Sai').length,
            pending: formattedHistory.filter(h => h.status === null).length,
            accuracy: learningData.md5.accuracy
        };
        
        res.json({
            type: 'Lẩu Cua 79 - Tài Xỉu MD5',
            stats: stats,
            history: formattedHistory,
            total: formattedHistory.length
        });
    } catch (error) {
        res.json({
            type: 'Lẩu Cua 79 - Tài Xỉu MD5',
            stats: { total: predictionHistory.md5.length, correct: 0, wrong: 0, pending: predictionHistory.md5.length, accuracy: '0%' },
            history: predictionHistory.md5,
            total: predictionHistory.md5.length
        });
    }
});

// ANALYSIS endpoints - Chi tiết phân tích
app.get('/lc79-hu/analysis', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        
        await verifyAndLearn('hu', data);
        const result = engines.hu.predict(data, 'hu');
        const modelAccuracies = engines.hu.getModelAccuracies();
        const featureImportance = engines.hu.getFeatureImportance();
        const liveAccuracy = engines.hu.getAccuracy();
        
        // Calculate recent trend
        const recentPredictions = learningData.hu.predictions.slice(0, 20);
        const recentCorrect = recentPredictions.filter(p => p.isCorrect === true).length;
        const recentAccuracy = recentPredictions.length > 0 ? (recentCorrect / recentPredictions.length * 100).toFixed(1) : 0;
        
        // Calculate bias
        const last10Results = data.slice(0, 10).map(d => d.Ket_qua);
        const taiCount = last10Results.filter(r => r === 'Tài').length;
        const bias = ((taiCount / 10) - 0.5) * 100;
        
        res.json({
            type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
            prediction: normalizeResult(result.prediction),
            confidence: result.confidence,
            liveAccuracy: `${liveAccuracy.toFixed(2)}%`,
            recentAccuracy: `${recentAccuracy}%`,
            overallAccuracy: `${learningData.hu.accuracy}%`,
            bias: `${bias > 0 ? 'Nghiêng Tài' : 'Nghiêng Xỉu'} ${Math.abs(bias).toFixed(1)}%`,
            ensembleSize: result.ensembleSize,
            topModels: result.topModels,
            modelAccuracies: modelAccuracies,
            featureImportance: featureImportance,
            totalPredictions: learningData.hu.total,
            verifiedPredictions: learningData.hu.predictions.filter(p => p.verified).length,
            lastUpdate: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

app.get('/lc79-md5/analysis', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        
        await verifyAndLearn('md5', data);
        const result = engines.md5.predict(data, 'md5');
        const modelAccuracies = engines.md5.getModelAccuracies();
        const featureImportance = engines.md5.getFeatureImportance();
        const liveAccuracy = engines.md5.getAccuracy();
        
        const recentPredictions = learningData.md5.predictions.slice(0, 20);
        const recentCorrect = recentPredictions.filter(p => p.isCorrect === true).length;
        const recentAccuracy = recentPredictions.length > 0 ? (recentCorrect / recentPredictions.length * 100).toFixed(1) : 0;
        
        const last10Results = data.slice(0, 10).map(d => d.Ket_qua);
        const taiCount = last10Results.filter(r => r === 'Tài').length;
        const bias = ((taiCount / 10) - 0.5) * 100;
        
        res.json({
            type: 'Lẩu Cua 79 - Tài Xỉu MD5',
            prediction: normalizeResult(result.prediction),
            confidence: result.confidence,
            liveAccuracy: `${liveAccuracy.toFixed(2)}%`,
            recentAccuracy: `${recentAccuracy}%`,
            overallAccuracy: `${learningData.md5.accuracy}%`,
            bias: `${bias > 0 ? 'Nghiêng Tài' : 'Nghiêng Xỉu'} ${Math.abs(bias).toFixed(1)}%`,
            ensembleSize: result.ensembleSize,
            topModels: result.topModels,
            modelAccuracies: modelAccuracies,
            featureImportance: featureImportance,
            totalPredictions: learningData.md5.total,
            verifiedPredictions: learningData.md5.predictions.filter(p => p.verified).length,
            lastUpdate: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// Learning stats endpoints
app.get('/lc79-hu/learning', async (req, res) => {
    try {
        await verifyAndLearn('hu', await fetchDataHu());
        const liveAccuracy = engines.hu.getAccuracy();
        const modelAccuracies = engines.hu.getModelAccuracies();
        
        const verifiedCount = learningData.hu.predictions.filter(p => p.verified).length;
        const correctVerified = learningData.hu.predictions.filter(p => p.isCorrect === true).length;
        
        res.json({
            type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
            totalPredictions: learningData.hu.total,
            verifiedPredictions: verifiedCount,
            correctPredictions: learningData.hu.correct,
            correctVerified: correctVerified,
            overallAccuracy: `${learningData.hu.accuracy}%`,
            liveAccuracy: `${liveAccuracy.toFixed(2)}%`,
            modelAccuracies: modelAccuracies,
            targetAccuracy: '70%',
            status: liveAccuracy >= 70 ? '🎯 ĐÃ ĐẠT MỤC TIÊU 70%!' : `📈 Đang hướng tới 70% (hiện tại ${liveAccuracy.toFixed(1)}%)`,
            lastUpdate: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
            error: error.message,
            lastUpdate: new Date().toISOString()
        });
    }
});

app.get('/lc79-md5/learning', async (req, res) => {
    try {
        await verifyAndLearn('md5', await fetchDataMd5());
        const liveAccuracy = engines.md5.getAccuracy();
        const modelAccuracies = engines.md5.getModelAccuracies();
        
        const verifiedCount = learningData.md5.predictions.filter(p => p.verified).length;
        const correctVerified = learningData.md5.predictions.filter(p => p.isCorrect === true).length;
        
        res.json({
            type: 'Lẩu Cua 79 - Tài Xỉu MD5',
            totalPredictions: learningData.md5.total,
            verifiedPredictions: verifiedCount,
            correctPredictions: learningData.md5.correct,
            correctVerified: correctVerified,
            overallAccuracy: `${learningData.md5.accuracy}%`,
            liveAccuracy: `${liveAccuracy.toFixed(2)}%`,
            modelAccuracies: modelAccuracies,
            targetAccuracy: '70%',
            status: liveAccuracy >= 70 ? '🎯 ĐÃ ĐẠT MỤC TIÊU 70%!' : `📈 Đang hướng tới 70% (hiện tại ${liveAccuracy.toFixed(1)}%)`,
            lastUpdate: new Date().toISOString()
        });
    } catch (error) {
        res.json({
            type: 'Lẩu Cua 79 - Tài Xỉu MD5',
            error: error.message,
            lastUpdate: new Date().toISOString()
        });
    }
});

// Reset endpoint
app.get('/reset-learning', (req, res) => {
    learningData = {
        hu: { predictions: [], total: 0, correct: 0, accuracy: 0 },
        md5: { predictions: [], total: 0, correct: 0, accuracy: 0 }
    };
    engines = {
        hu: new SuperPredictionEngineV12(),
        md5: new SuperPredictionEngineV12()
    };
    predictionHistory = { hu: [], md5: [] };
    lastProcessedPhien = { hu: null, md5: null };
    
    // Clear files
    if (fs.existsSync(LEARNING_FILE)) fs.unlinkSync(LEARNING_FILE);
    if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
    if (fs.existsSync(OPTIMAL_WEIGHTS_FILE)) fs.unlinkSync(OPTIMAL_WEIGHTS_FILE);
    
    saveLearningData();
    savePredictionHistory();
    
    res.json({ 
        message: '✅ Hệ thống đã được reset hoàn toàn!',
        version: 'v12.1',
        features: [
            '8 thuật toán ensemble',
            'Phân tích chi tiết từng model',
            'Hiển thị đúng/sai trong lịch sử',
            'Live accuracy tracking',
            'Feature importance analysis'
        ]
    });
});

// ==================== START SERVER ====================

loadLearningData();
loadPredictionHistory();

setInterval(() => autoProcess(), 10000);
setTimeout(() => autoProcess(), 3000);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔════════════════════════════════════════════════════════════════════════════════╗`);
    console.log(`║     LẨU CUA 79 - SUPER AI V12.1 - FULL ANALYSIS + HISTORY FIXED              ║`);
    console.log(`╚════════════════════════════════════════════════════════════════════════════════╝\n`);
    console.log(`🎯 8 THUẬT TOÁN ĐANG HOẠT ĐỘNG:\n`);
    console.log(`   [1] 🚀 Gradient Boosting     [2] 🧠 LSTM Deep Learning`);
    console.log(`   [3] 🎯 SVM with RBF Kernel   [4] 📊 Pattern Matching`);
    console.log(`   [5] 🔄 Markov Chain          [6] ⚖️ Weighted MA`);
    console.log(`   [7] 📈 Bayesian Network      [8] 🎲 Monte Carlo\n`);
    console.log(`✨ TÍNH NĂNG MỚI V12.1:\n`);
    console.log(`   • ✅ HIỂN THỊ ĐÚNG/SAI trong lịch sử`);
    console.log(`   • 📊 ANALYSIS chi tiết từng model`);
    console.log(`   • 🎯 Live accuracy tracking`);
    console.log(`   • 📈 Feature importance analysis`);
    console.log(`   • 🔧 Model performance monitoring\n`);
    console.log(`📡 Server: http://0.0.0.0:${PORT}`);
    console.log(`\n📋 ENDPOINTS:\n`);
    console.log(`   🎲 DỰ ĐOÁN:`);
    console.log(`   GET /lc79-hu              - Dự đoán Tài Xỉu Hũ`);
    console.log(`   GET /lc79-md5             - Dự đoán Tài Xỉu MD5\n`);
    console.log(`   📜 LỊCH SỬ (CÓ HIỂN THỊ ĐÚNG/SAI):`);
    console.log(`   GET /lc79-hu/lichsu       - Xem lịch sử + đúng/sai`);
    console.log(`   GET /lc79-md5/lichsu      - Xem lịch sử + đúng/sai\n`);
    console.log(`   📊 PHÂN TÍCH CHI TIẾT:`);
    console.log(`   GET /lc79-hu/analysis     - Phân tích model + accuracy`);
    console.log(`   GET /lc79-md5/analysis    - Phân tích model + accuracy\n`);
    console.log(`   📈 THỐNG KÊ HỌC TẬP:`);
    console.log(`   GET /lc79-hu/learning     - Accuracy tracking`);
    console.log(`   GET /lc79-md5/learning    - Accuracy tracking\n`);
    console.log(`   🔄 RESET:`);
    console.log(`   GET /reset-learning       - Reset toàn bộ hệ thống\n`);
    console.log(`🎯 MỤC TIÊU: >70% ACCURACY`);
    console.log(`📊 Theo dõi live accuracy để đánh giá hiệu quả!\n`);
});
