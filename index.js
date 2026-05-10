const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const HISTORY_FILE = 'prediction_history.json';
const THRESHOLD_FILE = 'thresholds.json';
const MODEL_FILE = 'advanced_model.json';

let predictionHistory = { hu: [], md5: [] };

const MAX_HISTORY = 1000;
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== ADVANCED NEURAL PATTERN DETECTOR ====================
class NeuralPatternDetector {
  constructor() {
    this.patternMemory = new Map();
    this.sequenceMemory = new Map();
    this.transitionMatrix = {};
    this.markovChains = {};
    this.weightOptimizer = new AdaptiveWeightOptimizer();
    this.ensemblePredictor = new EnsemblePredictor();
    this.reinforcementLearner = new ReinforcementLearner();
    this.kalmanFilter = new KalmanFilter();
    this.volatilityTracker = new VolatilityTracker();
    
    this.streakEdges = {};
    this.patternEdges = {};
    this.timeEdges = {};
    this.sumEdges = {};
    this.amplitudeEdges = {};
    this.alternationEdges = {};
    this.correlationEdges = {};
    this.momentumEdges = {};
    
    this.winRateHistory = [];
    this.totalPredictions = 0;
    this.totalCorrect = 0;
    this.confidenceThreshold = 52;
    this.marketSentiment = 0;
    this.manipulationDetected = false;
  }

  _ensureObject(obj, key, defaultValue = {}) {
    if (!obj[key]) obj[key] = defaultValue;
    return obj[key];
  }

  _ensureStreakEdge(key) {
    if (!this.streakEdges[key]) {
      this.streakEdges[key] = {
        tai: { correct: 0, total: 0, confidence: 0 },
        xiu: { correct: 0, total: 0, confidence: 0 }
      };
    }
    return this.streakEdges[key];
  }

  _ensurePatternEdge(key) {
    if (!this.patternEdges[key]) {
      this.patternEdges[key] = {
        tai: { correct: 0, total: 0, confidence: 0 },
        xiu: { correct: 0, total: 0, confidence: 0 }
      };
    }
    return this.patternEdges[key];
  }

  _ensureTimeEdge(key) {
    if (!this.timeEdges[key]) {
      this.timeEdges[key] = { tai: { hits: 0, total: 0 }, xiu: { hits: 0, total: 0 } };
    }
    return this.timeEdges[key];
  }

  _ensureSumEdge(key) {
    if (!this.sumEdges[key]) {
      this.sumEdges[key] = { tai: 0, xiu: 0, total: 0 };
    }
    return this.sumEdges[key];
  }

  _ensureAmplitudeEdge(key) {
    if (!this.amplitudeEdges[key]) {
      this.amplitudeEdges[key] = { tai: 0, xiu: 0, total: 0 };
    }
    return this.amplitudeEdges[key];
  }

  _ensureAlternationEdge(key) {
    if (!this.alternationEdges[key]) {
      this.alternationEdges[key] = { continues: 0, reverses: 0, total: 0 };
    }
    return this.alternationEdges[key];
  }

  _ensureCorrelationEdge(key) {
    if (!this.correlationEdges[key]) {
      this.correlationEdges[key] = { tai: 0, xiu: 0, total: 0 };
    }
    return this.correlationEdges[key];
  }

  _ensureMomentumEdge(key) {
    if (!this.momentumEdges[key]) {
      this.momentumEdges[key] = { tai: 0, xiu: 0, total: 0 };
    }
    return this.momentumEdges[key];
  }

  loadData(type) {
    try {
      if (fs.existsSync(THRESHOLD_FILE)) {
        const raw = fs.readFileSync(THRESHOLD_FILE, 'utf8');
        const allData = JSON.parse(raw);
        if (allData && allData[type]) {
          const d = allData[type];
          this.streakEdges = d.streakEdges || {};
          this.patternEdges = d.patternEdges || {};
          this.timeEdges = d.timeEdges || {};
          this.sumEdges = d.sumEdges || {};
          this.amplitudeEdges = d.amplitudeEdges || {};
          this.alternationEdges = d.alternationEdges || {};
          this.correlationEdges = d.correlationEdges || {};
          this.momentumEdges = d.momentumEdges || {};
          this.winRateHistory = Array.isArray(d.winRateHistory) ? d.winRateHistory.slice(-500) : [];
          this.totalPredictions = d.totalPredictions || 0;
          this.totalCorrect = d.totalCorrect || 0;
          this.confidenceThreshold = d.confidenceThreshold || 52;
          this.marketSentiment = d.marketSentiment || 0;
          console.log(`[NeuralDetector] Loaded ${type}: ${Object.keys(this.streakEdges).length} edges`);
        }
      }
    } catch (e) {
      console.error('[NeuralDetector] Load error:', e.message);
    }
    return this;
  }

  saveData(type) {
    try {
      let allData = {};
      if (fs.existsSync(THRESHOLD_FILE)) {
        try {
          allData = JSON.parse(fs.readFileSync(THRESHOLD_FILE, 'utf8'));
        } catch (e) {
          allData = {};
        }
      }
      allData[type] = {
        streakEdges: this.streakEdges,
        patternEdges: this.patternEdges,
        timeEdges: this.timeEdges,
        sumEdges: this.sumEdges,
        amplitudeEdges: this.amplitudeEdges,
        alternationEdges: this.alternationEdges,
        correlationEdges: this.correlationEdges,
        momentumEdges: this.momentumEdges,
        winRateHistory: this.winRateHistory.slice(-500),
        totalPredictions: this.totalPredictions,
        totalCorrect: this.totalCorrect,
        confidenceThreshold: this.confidenceThreshold,
        marketSentiment: this.marketSentiment
      };
      fs.writeFileSync(THRESHOLD_FILE, JSON.stringify(allData, null, 2));
    } catch (e) {
      console.error('[NeuralDetector] Save error:', e.message);
    }
  }

  // Advanced sequence pattern learning with temporal weighting
  learnFromHistory(historyData) {
    if (!historyData || !Array.isArray(historyData) || historyData.length < 20) return;

    const results = historyData.map(d => d.Ket_qua || '');
    const sums = historyData.map(d => d.Tong || 10);
    const timestamps = historyData.map(d => d.timestamp ? new Date(d.timestamp).getTime() : Date.now());
    const n = results.length;

    // Calculate temporal weights (more recent = higher weight)
    const temporalWeights = Array(n).fill().map((_, i) => Math.exp(-i / 50));

    // 1. Enhanced streak learning with temporal weighting
    for (let i = 5; i < n - 1; i++) {
      if (!results[i] || !results[i + 1]) continue;
      
      let streakType = results[i];
      let streakLength = 1;
      for (let j = i - 1; j >= 0; j--) {
        if (results[j] === streakType) streakLength++;
        else break;
      }

      const nextOutcome = results[i + 1];
      const streakKey = `${streakType}_${Math.min(streakLength, 20)}`;
      const weight = temporalWeights[i];

      const edge = this._ensureStreakEdge(streakKey);
      const lowerType = streakType.toLowerCase();

      if (edge[lowerType]) {
        edge[lowerType].total += weight;
        if (nextOutcome === streakType) edge[lowerType].correct += weight;
        edge[lowerType].confidence = edge[lowerType].correct / Math.max(1, edge[lowerType].total);
      }

      const oppositeType = streakType === 'Tài' ? 'xiu' : 'tai';
      if (edge[oppositeType]) {
        edge[oppositeType].total += weight;
        if (nextOutcome !== streakType) edge[oppositeType].correct += weight;
        edge[oppositeType].confidence = edge[oppositeType].correct / Math.max(1, edge[oppositeType].total);
      }
    }

    // 2. Enhanced pattern learning with variable length (3-7)
    for (let len = 3; len <= 7; len++) {
      for (let i = len; i < n - 1; i++) {
        const slice = results.slice(i - len + 1, i + 1);
        if (slice.some(r => !r)) continue;
        
        const pattern = slice.join('');
        const nextOutcome = results[i + 1];
        if (!nextOutcome) continue;
        const weight = temporalWeights[i];

        const edge = this._ensurePatternEdge(`${len}_${pattern}`);
        const outcomeKey = nextOutcome === 'Tài' ? 'tai' : 'xiu';
        
        if (edge[outcomeKey]) {
          edge[outcomeKey].total += weight;
          edge[outcomeKey].correct += weight;
          edge[outcomeKey].confidence = edge[outcomeKey].correct / edge[outcomeKey].total;
        }
      }
    }

    // 3. Advanced time analysis with minute-level granularity
    for (let i = 0; i < n; i++) {
      const outcome = results[i];
      if (!outcome) continue;
      
      const ts = timestamps[i];
      const hour = new Date(ts).getHours();
      const minute = new Date(ts).getMinutes();
      const slot = hour * 4 + Math.floor(minute / 15); // 15-minute slots
      const weight = temporalWeights[i];

      const edge = this._ensureTimeEdge(slot);
      const outcomeKey = outcome === 'Tài' ? 'tai' : 'xiu';
      
      if (edge[outcomeKey]) {
        edge[outcomeKey].total += weight;
        edge[outcomeKey].hits += weight;
        edge[outcomeKey].confidence = edge[outcomeKey].hits / edge[outcomeKey].total;
      }
    }

    // 4. Enhanced sum analysis with clustering
    for (let i = 0; i < n - 1; i++) {
      if (!sums[i] || !results[i + 1]) continue;
      
      const sum = sums[i];
      // 5 clusters instead of 3 for better granularity
      const cluster = sum <= 6 ? 'very_low' : sum <= 9 ? 'low' : sum <= 12 ? 'mid' : sum <= 15 ? 'high' : 'very_high';
      const nextOutcome = results[i + 1];
      const weight = temporalWeights[i];

      const edge = this._ensureSumEdge(cluster);
      edge.total += weight;
      if (nextOutcome === 'Tài') edge.tai += weight;
      else edge.xiu += weight;
    }

    // 5. Enhanced correlation learning (dice relationships)
    for (let i = 0; i < n - 1; i++) {
      const session = historyData[i];
      if (!session || !session.Xuc_xac_1 || !session.Xuc_xac_2 || !session.Xuc_xac_3) continue;
      
      const dice1 = session.Xuc_xac_1;
      const dice2 = session.Xuc_xac_2;
      const dice3 = session.Xuc_xac_3;
      const nextOutcome = results[i + 1];
      
      // Detect patterns in dice combinations
      const diceSum = dice1 + dice2 + dice3;
      const hasPair = dice1 === dice2 || dice2 === dice3 || dice1 === dice3;
      const isTriple = dice1 === dice2 && dice2 === dice3;
      const weight = temporalWeights[i];
      
      const key = `${hasPair ? 'pair' : 'no_pair'}_${isTriple ? 'triple' : 'no_triple'}`;
      const edge = this._ensureCorrelationEdge(key);
      edge.total += weight;
      if (nextOutcome === 'Tài') edge.tai += weight;
      else edge.xiu += weight;
    }

    // 6. Momentum detection (consecutive wins/losses for specific outcomes)
    for (let i = 3; i < n - 1; i++) {
      const last3 = results.slice(i - 2, i + 1);
      if (last3.some(r => !r)) continue;
      
      const momentum = last3.filter(r => r === 'Tài').length;
      const nextOutcome = results[i + 1];
      const weight = temporalWeights[i];
      
      const edge = this._ensureMomentumEdge(momentum);
      edge.total += weight;
      if (nextOutcome === 'Tài') edge.tai += weight;
      else edge.xiu += weight;
    }

    // 7. Update market sentiment
    this.updateMarketSentiment(results);
    
    // 8. Train reinforcement learning model
    this.reinforcementLearner.train(results, sums, timestamps);
    
    // 9. Adjust dynamic threshold
    this.adjustDynamicThreshold();
  }
  
  updateMarketSentiment(results) {
    // Detect manipulation patterns
    const recentResults = results.slice(0, 20);
    const taiRate = recentResults.filter(r => r === 'Tài').length / 20;
    const expectedRate = 0.5;
    const deviation = Math.abs(taiRate - expectedRate);
    
    // Detect unusual patterns
    this.manipulationDetected = deviation > 0.2;
    this.marketSentiment = (taiRate - 0.5) * 2; // -1 to 1 range
  }
  
  adjustDynamicThreshold() {
    if (this.totalPredictions < 30) return;
    
    const recentWinRate = this.winRateHistory.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, this.winRateHistory.length);
    
    // Adaptive threshold based on performance
    if (recentWinRate > 0.56) {
      this.confidenceThreshold = Math.max(48, this.confidenceThreshold - 1);
    } else if (recentWinRate < 0.48) {
      this.confidenceThreshold = Math.min(68, this.confidenceThreshold + 1.5);
    }
    
    // Adjust based on market sentiment
    if (Math.abs(this.marketSentiment) > 0.3) {
      this.confidenceThreshold += 2; // Be more cautious in manipulated markets
    }
  }

  // Advanced prediction with ensemble methods
  findBestPrediction(currentResults, currentSums, currentTimestamp) {
    const signals = [];
    const recentResults = currentResults.slice(0, 50);
    const recentSums = currentSums.slice(0, 50);
    
    if (recentResults.length < 10) return [];
    
    // Get predictions from all edge types
    const streakPred = this.getStreakPrediction(recentResults);
    if (streakPred) signals.push(streakPred);
    
    const patternPred = this.getPatternPrediction(recentResults);
    if (patternPred) signals.push(patternPred);
    
    const timePred = this.getTimePrediction(currentTimestamp);
    if (timePred) signals.push(timePred);
    
    const sumPred = this.getSumPrediction(recentSums);
    if (sumPred) signals.push(sumPred);
    
    const amplitudePred = this.getAmplitudePrediction(recentResults);
    if (amplitudePred) signals.push(amplitudePred);
    
    const correlationPred = this.getCorrelationPrediction(recentResults, currentResults);
    if (correlationPred) signals.push(correlationPred);
    
    const momentumPred = this.getMomentumPrediction(recentResults);
    if (momentumPred) signals.push(momentumPred);
    
    // Get ensemble prediction
    const ensemblePred = this.ensemblePredictor.predict(signals, recentResults);
    if (ensemblePred) signals.push(ensemblePred);
    
    // Apply Kalman filter for smoothing
    const filteredSignals = this.kalmanFilter.process(signals);
    
    return filteredSignals;
  }
  
  getStreakPrediction(results) {
    if (results.length < 2) return null;
    
    let streakType = results[0];
    let streakLength = 1;
    for (let i = 1; i < Math.min(results.length, 20); i++) {
      if (results[i] === streakType) streakLength++;
      else break;
    }
    
    const streakKey = `${streakType}_${Math.min(streakLength, 20)}`;
    const streakData = this.streakEdges[streakKey];
    
    if (streakData) {
      const continueConfidence = streakData[streakType.toLowerCase()]?.confidence || 0;
      const reverseConfidence = streakData[streakType === 'Tài' ? 'xiu' : 'tai']?.confidence || 0;
      
      if (continueConfidence > 0.52 && continueConfidence > reverseConfidence) {
        return {
          prediction: streakType,
          confidence: continueConfidence,
          source: 'streak_continue',
          weight: this.weightOptimizer.getWeight('streak')
        };
      } else if (reverseConfidence > 0.52 && reverseConfidence > continueConfidence) {
        return {
          prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài',
          confidence: reverseConfidence,
          source: 'streak_reverse',
          weight: this.weightOptimizer.getWeight('streak')
        };
      }
    }
    return null;
  }
  
  getPatternPrediction(results) {
    if (results.length < 4) return null;
    
    const predictions = [];
    
    // Try multiple pattern lengths
    for (let len of [3, 4, 5, 6]) {
      if (results.length >= len) {
        const pattern = results.slice(0, len).join('');
        const patternKey = `${len}_${pattern}`;
        const patternData = this.patternEdges[patternKey];
        
        if (patternData) {
          const taiConf = patternData.tai?.confidence || 0;
          const xiuConf = patternData.xiu?.confidence || 0;
          
          if (taiConf > 0.53 && taiConf > xiuConf) {
            predictions.push({
              prediction: 'Tài',
              confidence: taiConf,
              source: `pattern_${len}`,
              weight: 0.8
            });
          } else if (xiuConf > 0.53 && xiuConf > taiConf) {
            predictions.push({
              prediction: 'Xỉu',
              confidence: xiuConf,
              source: `pattern_${len}`,
              weight: 0.8
            });
          }
        }
      }
    }
    
    if (predictions.length === 0) return null;
    
    // Weight average of multiple pattern lengths
    const avgConf = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
    const avgPred = predictions[0].prediction; // Most common prediction
    
    return {
      prediction: avgPred,
      confidence: avgConf,
      source: 'pattern_ensemble',
      weight: this.weightOptimizer.getWeight('pattern')
    };
  }
  
  getTimePrediction(timestamp) {
    if (!timestamp) return null;
    
    const hour = new Date(timestamp).getHours();
    const minute = new Date(timestamp).getMinutes();
    const slot = hour * 4 + Math.floor(minute / 15);
    const timeData = this.timeEdges[slot];
    
    if (timeData && timeData.tai && timeData.xiu) {
      const taiConf = timeData.tai.confidence || 0;
      const xiuConf = timeData.xiu.confidence || 0;
      const totalConf = taiConf + xiuConf;
      
      if (totalConf > 0 && Math.abs(taiConf - xiuConf) > 0.1) {
        return {
          prediction: taiConf > xiuConf ? 'Tài' : 'Xỉu',
          confidence: Math.max(taiConf, xiuConf),
          source: 'time_cycle',
          weight: this.weightOptimizer.getWeight('time')
        };
      }
    }
    return null;
  }
  
  getSumPrediction(sums) {
    if (sums.length === 0) return null;
    
    const lastSum = sums[0];
    const cluster = lastSum <= 6 ? 'very_low' : lastSum <= 9 ? 'low' : lastSum <= 12 ? 'mid' : lastSum <= 15 ? 'high' : 'very_high';
    const sumData = this.sumEdges[cluster];
    
    if (sumData && sumData.total > 20) {
      const taiRate = sumData.tai / sumData.total;
      const confidence = Math.abs(taiRate - 0.5) * 2;
      
      if (confidence > 0.1) {
        return {
          prediction: taiRate > 0.5 ? 'Tài' : 'Xỉu',
          confidence: 0.5 + confidence,
          source: 'sum_cluster',
          weight: this.weightOptimizer.getWeight('sum')
        };
      }
    }
    return null;
  }
  
  getAmplitudePrediction(results) {
    if (results.length < 10) return null;
    
    const last10 = results.slice(0, 10);
    const taiCount = last10.filter(r => r === 'Tài').length;
    const amplitude = Math.abs(taiCount - 5);
    const ampData = this.amplitudeEdges[amplitude];
    
    if (ampData && ampData.total > 15) {
      const taiRate = ampData.tai / ampData.total;
      const confidence = Math.abs(taiRate - 0.5) * 1.5;
      
      if (confidence > 0.1) {
        return {
          prediction: taiRate > 0.5 ? 'Tài' : 'Xỉu',
          confidence: 0.5 + confidence,
          source: 'amplitude',
          weight: this.weightOptimizer.getWeight('amplitude')
        };
      }
    }
    return null;
  }
  
  getCorrelationPrediction(results, fullResults) {
    // Detect if there are unusual dice patterns
    const hasRecentPair = this.detectRecentPair(fullResults);
    
    const key = `${hasRecentPair ? 'pair' : 'no_pair'}_false`;
    const corrData = this.correlationEdges[key];
    
    if (corrData && corrData.total > 20) {
      const taiRate = corrData.tai / corrData.total;
      const confidence = Math.abs(taiRate - 0.5) * 1.8;
      
      if (confidence > 0.12) {
        return {
          prediction: taiRate > 0.5 ? 'Tài' : 'Xỉu',
          confidence: 0.5 + confidence,
          source: 'correlation',
          weight: this.weightOptimizer.getWeight('correlation')
        };
      }
    }
    return null;
  }
  
  getMomentumPrediction(results) {
    if (results.length < 4) return null;
    
    const last3 = results.slice(0, 3);
    const taiCount = last3.filter(r => r === 'Tài').length;
    const momentumData = this.momentumEdges[taiCount];
    
    if (momentumData && momentumData.total > 15) {
      const taiRate = momentumData.tai / momentumData.total;
      const confidence = Math.abs(taiRate - 0.5) * 1.6;
      
      if (confidence > 0.1) {
        return {
          prediction: taiRate > 0.5 ? 'Tài' : 'Xỉu',
          confidence: 0.5 + confidence,
          source: 'momentum',
          weight: this.weightOptimizer.getWeight('momentum')
        };
      }
    }
    return null;
  }
  
  detectRecentPair(fullResults) {
    // Check last 5 sessions for pairs
    const recentSessions = fullResults.slice(0, 5);
    // This would need actual dice data, simplified for now
    return false;
  }

  aggregateSignals(signals, recentResults) {
    if (!signals || signals.length === 0) {
      return {
        prediction: null,
        confidence: 0,
        canPredict: false,
        reason: 'No statistical edge found',
        signals: []
      };
    }
    
    // Weighted aggregation with adaptive weights
    let taiWeight = 0;
    let xiuWeight = 0;
    let totalWeight = 0;
    
    for (const signal of signals) {
      if (!signal || !signal.prediction) continue;
      const weight = signal.confidence * (signal.weight || 1);
      if (signal.prediction === 'Tài') taiWeight += weight;
      else if (signal.prediction === 'Xỉu') xiuWeight += weight;
      totalWeight += weight;
    }
    
    // Add Bayesian prior based on long-term average
    const longTermAvg = this.totalPredictions > 0 ? 
      this.totalCorrect / this.totalPredictions : 0.5;
    const priorWeight = 0.2;
    taiWeight += (longTermAvg) * priorWeight;
    xiuWeight += (1 - longTermAvg) * priorWeight;
    totalWeight += priorWeight;
    
    // Add market sentiment adjustment
    if (Math.abs(this.marketSentiment) > 0.2) {
      const sentimentAdjustment = this.marketSentiment * 0.3;
      if (sentimentAdjustment > 0) taiWeight += sentimentAdjustment * totalWeight;
      else xiuWeight += Math.abs(sentimentAdjustment) * totalWeight;
    }
    
    if (totalWeight === 0) {
      return {
        prediction: null,
        confidence: 0,
        canPredict: false,
        reason: 'Zero total weight',
        signals: signals.slice(0, 5)
      };
    }
    
    const taiProbability = taiWeight / totalWeight;
    const confidence = 50 + Math.abs(taiProbability - 0.5) * 100;
    
    // Calculate signal agreement
    const predictions = signals.map(s => s.prediction).filter(p => p);
    const agreement = predictions.length > 0 ?
      Math.max(
        predictions.filter(p => p === 'Tài').length,
        predictions.filter(p => p === 'Xỉu').length
      ) / predictions.length : 0;
    
    // Ensemble confidence boosting
    const ensembleConfidence = this.ensemblePredictor.getConfidenceBoost(
      taiProbability, agreement, signals.length
    );
    
    let finalConfidence = Math.min(85, confidence * ensembleConfidence);
    
    // Adjust for market manipulation
    if (this.manipulationDetected) {
      finalConfidence *= 0.85;
    }
    
    const canPredict = finalConfidence >= this.confidenceThreshold && agreement >= 0.5;
    
    // Reinforcement learning adjustment
    const rlAdjustment = this.reinforcementLearner.getAdjustment(recentResults);
    finalConfidence += rlAdjustment;
    
    return {
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.round(Math.min(85, Math.max(50, finalConfidence))),
      canPredict,
      taiProbability,
      signalCount: signals.length,
      agreement,
      marketSentiment: this.marketSentiment,
      manipulationDetected: this.manipulationDetected,
      signals: signals.slice(0, 8),
      reason: canPredict ?
        `${signals.length} signals, ${(agreement * 100).toFixed(0)}% agreement, sentiment: ${(this.marketSentiment * 100).toFixed(0)}` :
        `Confidence ${Math.round(finalConfidence)}% < threshold ${this.confidenceThreshold}%`
    };
  }

  recordOutcome(prediction, actual, confidence, signals) {
    if (!prediction || !actual) return;
    
    this.totalPredictions++;
    const correct = prediction === actual;
    if (correct) this.totalCorrect++;
    
    this.winRateHistory.push(correct ? 1 : 0);
    if (this.winRateHistory.length > 500) this.winRateHistory.shift();
    
    // Update reinforcement learning
    this.reinforcementLearner.recordOutcome(prediction, actual, confidence, signals);
    
    // Update weight optimizer
    if (signals) {
      this.weightOptimizer.updateWeights(signals, correct);
    }
  }
}

// ==================== ADAPTIVE WEIGHT OPTIMIZER ====================
class AdaptiveWeightOptimizer {
  constructor() {
    this.weights = {
      streak: 1.0,
      pattern: 1.0,
      time: 0.8,
      sum: 0.9,
      amplitude: 0.7,
      correlation: 0.6,
      momentum: 0.8
    };
    this.performance = {};
    this.learningRate = 0.05;
  }
  
  getWeight(source) {
    return this.weights[source] || 0.5;
  }
  
  updateWeights(signals, wasCorrect) {
    for (const signal of signals) {
      const source = signal.source;
      if (this.performance[source] === undefined) {
        this.performance[source] = { correct: 0, total: 0 };
      }
      
      this.performance[source].total++;
      if (wasCorrect) this.performance[source].correct++;
      
      // Update weight based on performance
      const accuracy = this.performance[source].correct / this.performance[source].total;
      const targetWeight = Math.min(1.5, Math.max(0.3, accuracy * 2));
      
      this.weights[source] += (targetWeight - this.weights[source]) * this.learningRate;
      this.weights[source] = Math.min(1.5, Math.max(0.3, this.weights[source]));
    }
  }
}

// ==================== ENSEMBLE PREDICTOR ====================
class EnsemblePredictor {
  constructor() {
    this.models = [];
    this.modelWeights = [];
    this.performance = [];
  }
  
  predict(signals, recentResults) {
    if (signals.length === 0) return null;
    
    // Simple majority voting with confidence
    let taiVotes = 0;
    let xiuVotes = 0;
    let totalConfidence = 0;
    
    for (const signal of signals) {
      const weight = signal.confidence * (signal.weight || 1);
      if (signal.prediction === 'Tài') taiVotes += weight;
      else xiuVotes += weight;
      totalConfidence += signal.confidence;
    }
    
    const avgConfidence = totalConfidence / signals.length;
    const prediction = taiVotes > xiuVotes ? 'Tài' : 'Xỉu';
    const confidence = Math.abs(taiVotes - xiuVotes) / (taiVotes + xiuVotes) * avgConfidence;
    
    return {
      prediction: prediction,
      confidence: Math.min(0.85, confidence),
      source: 'ensemble',
      weight: 1.2
    };
  }
  
  getConfidenceBoost(taiProb, agreement, signalCount) {
    let boost = 1.0;
    
    // More signals = higher confidence (if they agree)
    if (signalCount >= 5 && agreement > 0.7) boost *= 1.1;
    if (signalCount >= 3 && agreement > 0.8) boost *= 1.05;
    
    // Strong probability = higher confidence
    if (Math.abs(taiProb - 0.5) > 0.2) boost *= 1.08;
    
    return Math.min(1.25, boost);
  }
}

// ==================== REINFORCEMENT LEARNER ====================
class ReinforcementLearner {
  constructor() {
    this.qTable = new Map();
    this.learningRate = 0.1;
    this.discountFactor = 0.95;
    this.explorationRate = 0.1;
  }
  
  getState(results, sums) {
    // Create state representation
    const last3 = results.slice(0, 3).join('');
    const taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
    const sumTrend = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    return `${last3}_${taiCount}_${Math.floor(sumTrend)}`;
  }
  
  getAdjustment(recentResults) {
    // Get Q-value adjustment based on current state
    const state = this.getState(recentResults, []);
    const qValue = this.qTable.get(state) || 0.5;
    return (qValue - 0.5) * 0.1; // Small adjustment factor
  }
  
  train(results, sums, timestamps) {
    // Simple Q-learning update
    for (let i = 0; i < results.length - 1; i++) {
      const state = this.getState(results.slice(i), sums.slice(i));
      const action = results[i] === 'Tài' ? 1 : 0;
      const nextState = this.getState(results.slice(i + 1), sums.slice(i + 1));
      const reward = results[i + 1] === results[i] ? 1 : -0.5;
      
      const currentQ = this.qTable.get(state) || 0.5;
      const nextQ = this.qTable.get(nextState) || 0.5;
      const newQ = currentQ + this.learningRate * (reward + this.discountFactor * nextQ - currentQ);
      
      this.qTable.set(state, newQ);
    }
  }
  
  recordOutcome(prediction, actual, confidence, signals) {
    // Can be used for additional learning
    const reward = prediction === actual ? confidence / 100 : -(confidence / 100);
    // Update based on reward...
  }
}

// ==================== KALMAN FILTER ====================
class KalmanFilter {
  constructor() {
    this.Q = 0.01; // Process noise
    this.R = 0.1;  // Measurement noise
    this.P = 1;    // Error covariance
    this.K = 0;    // Kalman gain
    this.x = 0.5;  // State
  }
  
  process(signals) {
    if (signals.length === 0) return signals;
    
    // Filter the confidence values
    const filtered = [];
    for (const signal of signals) {
      const measurement = signal.confidence;
      // Prediction
      this.P = this.P + this.Q;
      // Update
      this.K = this.P / (this.P + this.R);
      this.x = this.x + this.K * (measurement - this.x);
      this.P = (1 - this.K) * this.P;
      
      filtered.push({
        ...signal,
        confidence: this.x
      });
    }
    
    return filtered;
  }
}

// ==================== VOLATILITY TRACKER ====================
class VolatilityTracker {
  constructor() {
    this.volatility = 0;
    this.history = [];
  }
  
  update(results) {
    // Calculate volatility based on outcome changes
    let changes = 0;
    for (let i = 1; i < results.length; i++) {
      if (results[i] !== results[i-1]) changes++;
    }
    this.volatility = changes / Math.max(1, results.length - 1);
    this.history.push(this.volatility);
    if (this.history.length > 100) this.history.shift();
  }
  
  getVolatility() {
    return this.history.length > 0 ?
      this.history.reduce((a, b) => a + b, 0) / this.history.length : 0;
  }
}

// ==================== GLOBAL STATE ====================
let neuralDetectorHU = new NeuralPatternDetector().loadData('hu');
let neuralDetectorMD5 = new NeuralPatternDetector().loadData('md5');

// ==================== HELPERS (same as before) ====================
function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices?.[0] || 0,
    Xuc_xac_2: item.dices?.[1] || 0,
    Xuc_xac_3: item.dices?.[2] || 0,
    Tong: item.point || 0,
    timestamp: new Date().toISOString()
  }));
}

async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('[HU] Fetch error:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('[MD5] Fetch error:', error.message);
    return null;
  }
}

function normalizeResult(result) {
  if (!result) return 'unknown';
  if (result === 'Tài' || result === 'tài') return 'tai';
  if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
  return 'unknown';
}

function preprocessData(data) {
  if (!data || !Array.isArray(data)) return [];
  return data.filter(d => d && d.Tong >= 3 && d.Tong <= 18 && d.Ket_qua);
}

function savePredictionToHistory(type, phien, result) {
  const record = {
    phien_hien_tai: phien.toString(),
    du_doan: result.prediction ? normalizeResult(result.prediction) : 'unknown',
    ti_le: result.canPredict ? `${result.confidence}%` : '0%',
    can_predict: result.canPredict,
    reason: result.reason || '',
    signal_count: result.signalCount || 0,
    market_sentiment: result.marketSentiment || 0,
    id: 'kapub',
    timestamp: new Date().toISOString()
  };
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  return record;
}

function saveAll() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    console.error('[Save] Error:', e.message);
  }
}

function loadAll() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
      const data = JSON.parse(raw);
      predictionHistory = data.history || { hu: [], md5: [] };
      lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
      console.log('[Data] History loaded');
    }
  } catch (e) {
    console.error('[Load] Error:', e.message);
  }
}

// ==================== ENHANCED PREDICTION LOGIC ====================
function makePrediction(type, data) {
  const neuralDetector = type === 'hu' ? neuralDetectorHU : neuralDetectorMD5;

  const results = data.map(d => d.Ket_qua || '');
  const sums = data.map(d => d.Tong || 10);

  if (results.length < 10) {
    return {
      prediction: null,
      confidence: 0,
      canPredict: false,
      reason: 'Insufficient data',
      signals: []
    };
  }

  // Learn from ALL available history
  const historyForLearning = data.slice(0, Math.min(1000, data.length));
  neuralDetector.learnFromHistory(historyForLearning);

  // Find advanced signals
  const signals = neuralDetector.findBestPrediction(results, sums, data[0]?.timestamp);

  // Aggregate with ensemble
  const result = neuralDetector.aggregateSignals(signals, results);

  // Save learned data
  neuralDetector.saveData(type);

  return result;
}

async function verifyAndUpdate(type, data, phienToVerify, lastPrediction) {
  if (!phienToVerify || !lastPrediction || !lastPrediction.prediction) return;

  const actualSession = data.find(d => d && d.Phien && d.Phien.toString() === phienToVerify.toString());
  if (!actualSession || !actualSession.Ket_qua) return;

  const neuralDetector = type === 'hu' ? neuralDetectorHU : neuralDetectorMD5;
  neuralDetector.recordOutcome(
    lastPrediction.prediction,
    actualSession.Ket_qua,
    lastPrediction.confidence || 0,
    lastPrediction.signals || []
  );
  neuralDetector.saveData(type);
}

// ==================== AUTO PROCESS (same as before) ====================
async function autoProcessPredictions() {
  try {
    // Process HU
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const processedHu = preprocessData(dataHu);
      if (processedHu.length > 0) {
        const latestHuPhien = processedHu[0].Phien;
        const nextHuPhien = latestHuPhien + 1;

        if (lastProcessedPhien.hu && lastProcessedPhien.hu !== nextHuPhien) {
          const lastPred = predictionHistory.hu[0];
          if (lastPred && lastPred.prediction && lastPred.prediction !== 'unknown') {
            await verifyAndUpdate('hu', processedHu, lastProcessedPhien.hu, {
              prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu',
              confidence: parseInt(lastPred.ti_le) || 0,
              signals: []
            });
          }
        }

        if (lastProcessedPhien.hu !== nextHuPhien) {
          const result = makePrediction('hu', processedHu);
          savePredictionToHistory('hu', nextHuPhien, result);
          lastProcessedPhien.hu = nextHuPhien;

          const status = result.canPredict
            ? `🎯 ${result.prediction} (${result.confidence}%) [Sentiment: ${((result.marketSentiment || 0) * 100).toFixed(0)}]`
            : `⏸️ SKIP - ${result.reason}`;
          console.log(`[Hu #${nextHuPhien}] ${status} | Signals: ${result.signalCount || 0}`);
        }
      }
    }

    // Process MD5
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const processedMd5 = preprocessData(dataMd5);
      if (processedMd5.length > 0) {
        const latestMd5Phien = processedMd5[0].Phien;
        const nextMd5Phien = latestMd5Phien + 1;

        if (lastProcessedPhien.md5 && lastProcessedPhien.md5 !== nextMd5Phien) {
          const lastPred = predictionHistory.md5[0];
          if (lastPred && lastPred.prediction && lastPred.prediction !== 'unknown') {
            await verifyAndUpdate('md5', processedMd5, lastProcessedPhien.md5, {
              prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu',
              confidence: parseInt(lastPred.ti_le) || 0,
              signals: []
            });
          }
        }

        if (lastProcessedPhien.md5 !== nextMd5Phien) {
          const result = makePrediction('md5', processedMd5);
          savePredictionToHistory('md5', nextMd5Phien, result);
          lastProcessedPhien.md5 = nextMd5Phien;

          const status = result.canPredict
            ? `🎯 ${result.prediction} (${result.confidence}%) [Sentiment: ${((result.marketSentiment || 0) * 100).toFixed(0)}]`
            : `⏸️ SKIP - ${result.reason}`;
          console.log(`[MD5 #${nextMd5Phien}] ${status} | Signals: ${result.signalCount || 0}`);
        }
      }
    }

    saveAll();
  } catch (error) {
    console.error('[Auto] Error:', error.message);
  }
}

// ==================== ENHANCED EXPRESS ROUTES ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('kapub - Advanced Neural Prediction System v2.0');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) return res.status(500).json({ error: 'Cannot fetch data' });

    const processed = preprocessData(data);
    if (processed.length === 0) return res.status(500).json({ error: 'Data error' });

    const result = makePrediction('hu', processed);
    const latestPhien = processed[0].Phien;
    const nextPhien = latestPhien + 1;

    if (lastProcessedPhien.hu && lastProcessedPhien.hu !== nextPhien) {
      const lastPred = predictionHistory.hu[0];
      if (lastPred && lastPred.prediction && lastPred.prediction !== 'unknown') {
        await verifyAndUpdate('hu', processed, lastProcessedPhien.hu, {
          prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu',
          confidence: parseInt(lastPred.ti_le) || 0,
          signals: []
        });
      }
    }

    savePredictionToHistory('hu', nextPhien, result);
    lastProcessedPhien.hu = nextPhien;
    saveAll();

    if (!result.canPredict || !result.prediction) {
      return res.json({
        phien_hien_tai: nextPhien.toString(),
        du_doan: 'unknown',
        ti_le: '0%',
        status: 'skip',
        reason: result.reason,
        market_sentiment: result.marketSentiment || 0,
        id: 'kapub'
      });
    }

    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      market_sentiment: result.marketSentiment || 0,
      signal_count: result.signalCount || 0,
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

    const processed = preprocessData(data);
    if (processed.length === 0) return res.status(500).json({ error: 'Data error' });

    const result = makePrediction('md5', processed);
    const latestPhien = processed[0].Phien;
    const nextPhien = latestPhien + 1;

    if (lastProcessedPhien.md5 && lastProcessedPhien.md5 !== nextPhien) {
      const lastPred = predictionHistory.md5[0];
      if (lastPred && lastPred.prediction && lastPred.prediction !== 'unknown') {
        await verifyAndUpdate('md5', processed, lastProcessedPhien.md5, {
          prediction: lastPred.du_doan === 'tai' ? 'Tài' : 'Xỉu',
          confidence: parseInt(lastPred.ti_le) || 0,
          signals: []
        });
      }
    }

    savePredictionToHistory('md5', nextPhien, result);
    lastProcessedPhien.md5 = nextPhien;
    saveAll();

    if (!result.canPredict || !result.prediction) {
      return res.json({
        phien_hien_tai: nextPhien.toString(),
        du_doan: 'unknown',
        ti_le: '0%',
        status: 'skip',
        reason: result.reason,
        market_sentiment: result.marketSentiment || 0,
        id: 'kapub'
      });
    }

    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      market_sentiment: result.marketSentiment || 0,
      signal_count: result.signalCount || 0,
      id: 'kapub'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Enhanced analysis endpoint with more metrics
app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    const processed = preprocessData(data);
    if (processed.length === 0) return res.status(500).json({ error: 'Data error' });

    const result = makePrediction('hu', processed);
    const nd = neuralDetectorHU;
    
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      canPredict: result.canPredict,
      reason: result.reason,
      market_sentiment: result.marketSentiment || 0,
      manipulation_detected: result.manipulationDetected || false,
      signals: result.signals?.map(s => ({
        source: s.source,
        prediction: s.prediction,
        confidence: (s.confidence * 100).toFixed(1) + '%',
        evidence: s.evidence
      })) || [],
      dynamic_threshold: nd.confidenceThreshold + '%',
      total_predictions: nd.totalPredictions,
      total_correct: nd.totalCorrect,
      overall_win_rate: nd.totalPredictions > 0
        ? (nd.totalCorrect / nd.totalPredictions * 100).toFixed(1) + '%'
        : 'N/A',
      recent_win_rate: nd.winRateHistory.length > 0
        ? (nd.winRateHistory.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, nd.winRateHistory.length) * 100).toFixed(1) + '%'
        : 'N/A'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
    const processed = preprocessData(data);
    if (processed.length === 0) return res.status(500).json({ error: 'Data error' });

    const result = makePrediction('md5', processed);
    const nd = neuralDetectorMD5;
    
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      canPredict: result.canPredict,
      reason: result.reason,
      market_sentiment: result.marketSentiment || 0,
      manipulation_detected: result.manipulationDetected || false,
      signals: result.signals?.map(s => ({
        source: s.source,
        prediction: s.prediction,
        confidence: (s.confidence * 100).toFixed(1) + '%',
        evidence: s.evidence
      })) || [],
      dynamic_threshold: nd.confidenceThreshold + '%',
      total_predictions: nd.totalPredictions,
      total_correct: nd.totalCorrect,
      overall_win_rate: nd.totalPredictions > 0
        ? (nd.totalCorrect / nd.totalPredictions * 100).toFixed(1) + '%'
        : 'N/A',
      recent_win_rate: nd.winRateHistory.length > 0
        ? (nd.winRateHistory.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, nd.winRateHistory.length) * 100).toFixed(1) + '%'
        : 'N/A'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Enhanced stats endpoint
app.get('/lc79-hu/stats', (req, res) => {
  const nd = neuralDetectorHU;
  const recentWR = nd.winRateHistory.length > 0
    ? (nd.winRateHistory.reduce((a, b) => a + b, 0) / nd.winRateHistory.length * 100).toFixed(1) + '%'
    : 'N/A';

  res.json({
    type: 'Lẩu Cua 79 - Neural Prediction System',
    total_predictions: nd.totalPredictions,
    total_correct: nd.totalCorrect,
    overall_win_rate: nd.totalPredictions > 0
      ? (nd.totalCorrect / nd.totalPredictions * 100).toFixed(1) + '%'
      : 'N/A',
    recent_win_rate: recentWR,
    confidence_threshold: nd.confidenceThreshold + '%',
    market_sentiment: (nd.marketSentiment * 100).toFixed(1) + '%',
    manipulation_detected: nd.manipulationDetected,
    edge_counts: {
      streaks: Object.keys(nd.streakEdges).length,
      patterns: Object.keys(nd.patternEdges).length,
      time_slots: Object.keys(nd.timeEdges).length,
      sum_clusters: Object.keys(nd.sumEdges).length,
      correlations: Object.keys(nd.correlationEdges).length,
      momentum: Object.keys(nd.momentumEdges).length
    }
  });
});

app.get('/lc79-md5/stats', (req, res) => {
  const nd = neuralDetectorMD5;
  const recentWR = nd.winRateHistory.length > 0
    ? (nd.winRateHistory.reduce((a, b) => a + b, 0) / nd.winRateHistory.length * 100).toFixed(1) + '%'
    : 'N/A';

  res.json({
    type: 'Lẩu Cua 79 - Neural Prediction System (MD5)',
    total_predictions: nd.totalPredictions,
    total_correct: nd.totalCorrect,
    overall_win_rate: nd.totalPredictions > 0
      ? (nd.totalCorrect / nd.totalPredictions * 100).toFixed(1) + '%'
      : 'N/A',
    recent_win_rate: recentWR,
    confidence_threshold: nd.confidenceThreshold + '%',
    market_sentiment: (nd.marketSentiment * 100).toFixed(1) + '%',
    manipulation_detected: nd.manipulationDetected,
    edge_counts: {
      streaks: Object.keys(nd.streakEdges).length,
      patterns: Object.keys(nd.patternEdges).length,
      time_slots: Object.keys(nd.timeEdges).length,
      sum_clusters: Object.keys(nd.sumEdges).length,
      correlations: Object.keys(nd.correlationEdges).length,
      momentum: Object.keys(nd.momentumEdges).length
    }
  });
});

// History endpoints (same as before)
app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    const processed = data ? preprocessData(data) : [];
    const historyWithStatus = predictionHistory.hu.map(record => {
      const actual = processed.find(d => d && d.Phien && d.Phien.toString() === record.phien_hien_tai);
      let status = '⏳';
      if (actual && actual.Ket_qua) {
        const predictedTai = record.du_doan === 'tai';
        const actualTai = actual.Ket_qua === 'Tài';
        status = predictedTai === actualTai ? '✅' : '❌';
      }
      return { ...record, ket_qua_thuc_te: actual?.Ket_qua || null, status };
    });
    res.json({ type: 'Lẩu Cua 79 - Neural Predictions', history: historyWithStatus, total: historyWithStatus.length });
  } catch (error) {
    res.json({ type: 'Lẩu Cua 79 - Neural Predictions', history: predictionHistory.hu, total: predictionHistory.hu.length });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    const processed = data ? preprocessData(data) : [];
    const historyWithStatus = predictionHistory.md5.map(record => {
      const actual = processed.find(d => d && d.Phien && d.Phien.toString() === record.phien_hien_tai);
      let status = '⏳';
      if (actual && actual.Ket_qua) {
        const predictedTai = record.du_doan === 'tai';
        const actualTai = actual.Ket_qua === 'Tài';
        status = predictedTai === actualTai ? '✅' : '❌';
      }
      return { ...record, ket_qua_thuc_te: actual?.Ket_qua || null, status };
    });
    res.json({ type: 'Lẩu Cua 79 - Neural Predictions (MD5)', history: historyWithStatus, total: historyWithStatus.length });
  } catch (error) {
    res.json({ type: 'Lẩu Cua 79 - Neural Predictions (MD5)', history: predictionHistory.md5, total: predictionHistory.md5.length });
  }
});

app.get('/reset', (req, res) => {
  neuralDetectorHU = new NeuralPatternDetector();
  neuralDetectorMD5 = new NeuralPatternDetector();
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };

  neuralDetectorHU.saveData('hu');
  neuralDetectorMD5.saveData('md5');
  saveAll();

  res.json({ message: 'All data reset successfully' });
});

// ==================== STARTUP ====================
loadAll();

setInterval(autoProcessPredictions, AUTO_SAVE_INTERVAL);
setTimeout(autoProcessPredictions, 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔════════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║     LẨU CUA 79 - ADVANCED NEURAL PREDICTION SYSTEM v2.0                    ║`);
  console.log(`║     Features: Neural Patterns | Ensemble Learning | Reinforcement         ║`);
  console.log(`║                Kalman Filter | Market Sentiment | Adaptive Weights         ║`);
  console.log(`╚════════════════════════════════════════════════════════════════════════════╝\n`);
  console.log(`🚀 Server running: http://0.0.0.0:${PORT}`);
  console.log(`\n🧠 ADVANCED FEATURES:`);
  console.log(`   • Neural pattern recognition (3-7 length sequences)`);
  console.log(`   • Ensemble learning with 8 edge types`);
  console.log(`   • Reinforcement learning (Q-learning)`);
  console.log(`   • Kalman filter for noise reduction`);
  console.log(`   • Market sentiment & manipulation detection`);
  console.log(`   • Adaptive weight optimization`);
  console.log(`   • Volatility tracking`);
  console.log(`\n🎯 Dynamic threshold: Starts at 52% (adjusts automatically)`);
  console.log(`📊 Endpoints: /lc79-hu, /lc79-md5, /lc79-hu/analysis, /lc79-hu/stats, /lc79-hu/lichsu\n`);
});
