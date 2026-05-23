const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 5000;

// ==================== API ENDPOINTS ====================
const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

// ==================== FILE PATHS ====================
const FILES = {
  LEARNING: 'learning_data_v12.json',
  HISTORY: 'prediction_history_v12.json',
  ANOMALY: 'anomaly_patterns_v12.json',
  NEURAL: 'neural_models_v12.json',
  ATTENTION: 'attention_models_v12.json',
  LSTM: 'lstm_models_v12.json',
  TRANSFORMER: 'transformer_models_v12.json',
  REINFORCEMENT: 'reinforcement_learning_v12.json',
  ENSEMBLE: 'ensemble_weights_v12.json'
};

// ==================== ADVANCED CONFIGURATION ====================
const CONFIG = {
  MAX_CONFIDENCE: 92,
  MIN_CONFIDENCE: 48,
  MIN_PATTERNS: 3,
  ENSEMBLE_MIN_AGREEMENT: 2,
  SMOOTHING_WINDOW: 7,
  MAX_HISTORY: 500,
  AUTO_SAVE_INTERVAL: 10000,
  BACKTEST_INTERVAL: 300000,
  CLEANUP_INTERVAL: 3600000,
  META_LEARNING_RATE: 0.015,
  META_UPDATE_INTERVAL: 20,
  REGIME_WINDOW: 25,
  FALLBACK_CONFIDENCE: 52,
  RESET_THRESHOLD_ACC: 0.48,
  MARKOV_ORDER: 3,
  LSTM_HIDDEN_SIZE: 32,
  LSTM_LAYERS: 2,
  TRANSFORMER_HEADS: 4,
  TRANSFORMER_LAYERS: 2,
  BATCH_SIZE: 32,
  LEARNING_RATE: 0.001,
  DROPOUT_RATE: 0.2,
  GRADIENT_CLIP: 1.0,
  PATIENCE: 10,
  EPOCHS: 50
};

// ==================== UTILITY FUNCTIONS ====================
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ${new Date().toISOString()} - ${msg}`)
};

function sigmoid(x) {
  return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
}

function tanh(x) {
  return Math.tanh(x);
}

function relu(x) {
  return Math.max(0, x);
}

function leakyRelu(x, alpha = 0.01) {
  return x > 0 ? x : alpha * x;
}

function softmax(arr) {
  const max = Math.max(...arr);
  const exp = arr.map(v => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map(v => v / sum);
}

function crossEntropyLoss(pred, target) {
  return -Math.log(pred[target] + 1e-8);
}

function mseLoss(pred, target) {
  return Math.pow(pred - target, 2);
}

// ==================== ADVANCED LSTM NETWORK ====================
class LSTMNetwork {
  constructor(inputSize = 12, hiddenSize = 32, outputSize = 2, numLayers = 2) {
    this.inputSize = inputSize;
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;
    this.numLayers = numLayers;
    
    // LSTM weights for each layer
    this.layers = [];
    for (let l = 0; l < numLayers; l++) {
      const layerInputSize = l === 0 ? inputSize : hiddenSize;
      this.layers.push({
        Wf: this.randomMatrix(hiddenSize, layerInputSize + hiddenSize),
        bf: this.randomVector(hiddenSize),
        Wi: this.randomMatrix(hiddenSize, layerInputSize + hiddenSize),
        bi: this.randomVector(hiddenSize),
        Wc: this.randomMatrix(hiddenSize, layerInputSize + hiddenSize),
        bc: this.randomVector(hiddenSize),
        Wo: this.randomMatrix(hiddenSize, layerInputSize + hiddenSize),
        bo: this.randomVector(hiddenSize)
      });
    }
    
    // Output layer
    this.Wy = this.randomMatrix(outputSize, hiddenSize);
    this.by = this.randomVector(outputSize);
    
    this.h = null;
    this.c = null;
    this.cache = null;
    this.lr = CONFIG.LEARNING_RATE;
  }
  
  randomMatrix(rows, cols) {
    return Array(rows).fill().map(() => 
      Array(cols).fill().map(() => (Math.random() - 0.5) * 0.1)
    );
  }
  
  randomVector(size) {
    return Array(size).fill().map(() => (Math.random() - 0.5) * 0.1);
  }
  
  resetState(batchSize = 1) {
    this.h = Array(this.numLayers).fill().map(() => 
      Array(batchSize).fill().map(() => Array(this.hiddenSize).fill(0))
    );
    this.c = Array(this.numLayers).fill().map(() => 
      Array(batchSize).fill().map(() => Array(this.hiddenSize).fill(0))
    );
  }
  
  lstmCell(x, h_prev, c_prev, params, layerId) {
    const combined = [...x, ...h_prev];
    const f = sigmoid(this.dot(params.Wf, combined).map((v, i) => v + params.bf[i]));
    const i = sigmoid(this.dot(params.Wi, combined).map((v, i) => v + params.bi[i]));
    const c_tilde = tanh(this.dot(params.Wc, combined).map((v, i) => v + params.bc[i]));
    const c = f.map((fv, idx) => fv * c_prev[idx] + i[idx] * c_tilde[idx]);
    const o = sigmoid(this.dot(params.Wo, combined).map((v, i) => v + params.bo[i]));
    const h = o.map((ov, idx) => ov * tanh(c[idx]));
    return { h, c };
  }
  
  dot(matrix, vector) {
    return matrix.map(row => row.reduce((sum, val, i) => sum + val * vector[i], 0));
  }
  
  forward(inputs) {
    const seqLength = inputs.length;
    const batchSize = inputs[0]?.length || 1;
    
    this.resetState(batchSize);
    this.cache = { h: [], c: [], gates: [] };
    
    let lastOutput = null;
    
    for (let t = 0; t < seqLength; t++) {
      let x = inputs[t];
      const layerOutputs = { h: [], c: [], gates: [] };
      
      for (let l = 0; l < this.numLayers; l++) {
        const h_prev = this.h[l][0];
        const c_prev = this.c[l][0];
        const result = this.lstmCell(x, h_prev, c_prev, this.layers[l], l);
        
        this.h[l][0] = result.h;
        this.c[l][0] = result.c;
        x = result.h;
        layerOutputs.h.push(result.h);
        layerOutputs.c.push(result.c);
      }
      
      lastOutput = x;
      this.cache.h.push(layerOutputs.h);
      this.cache.c.push(layerOutputs.c);
    }
    
    const output = this.dot(this.Wy, lastOutput).map((v, i) => v + this.by[i]);
    return softmax(output);
  }
  
  train(features, target) {
    const prediction = this.forward(features);
    const targetOneHot = [target === 0 ? 1 : 0, target === 1 ? 1 : 0];
    const loss = -Math.log(prediction[target] + 1e-8);
    
    // Simple gradient approximation (would need full BPTT for real LSTM)
    const grad = prediction.map((p, i) => p - targetOneHot[i]);
    
    // Update output layer
    for (let i = 0; i < this.Wy.length; i++) {
      for (let j = 0; j < this.Wy[i].length; j++) {
        this.Wy[i][j] -= this.lr * grad[i] * (this.cache.h[this.cache.h.length - 1]?.[this.numLayers - 1]?.[j] || 0);
      }
    }
    
    for (let i = 0; i < this.by.length; i++) {
      this.by[i] -= this.lr * grad[i];
    }
    
    return loss;
  }
  
  predict(features) {
    const probs = this.forward(features);
    const prediction = probs[0] > probs[1] ? 'Tài' : 'Xỉu';
    const confidence = 50 + Math.abs(probs[0] - probs[1]) * 50;
    return { prediction, confidence: Math.min(CONFIG.MAX_CONFIDENCE, confidence) };
  }
  
  save() {
    return {
      layers: this.layers,
      Wy: this.Wy,
      by: this.by,
      inputSize: this.inputSize,
      hiddenSize: this.hiddenSize,
      outputSize: this.outputSize,
      numLayers: this.numLayers
    };
  }
  
  load(data) {
    if (data) {
      this.layers = data.layers;
      this.Wy = data.Wy;
      this.by = data.by;
      this.inputSize = data.inputSize;
      this.hiddenSize = data.hiddenSize;
      this.outputSize = data.outputSize;
      this.numLayers = data.numLayers;
    }
  }
}

// ==================== TRANSFORMER MODEL ====================
class TransformerModel {
  constructor(inputSize = 12, numHeads = 4, numLayers = 2, feedForwardDim = 64) {
    this.inputSize = inputSize;
    this.numHeads = numHeads;
    this.numLayers = numLayers;
    this.feedForwardDim = feedForwardDim;
    this.headDim = inputSize / numHeads;
    
    // Multi-head attention weights
    this.Wq = Array(numLayers).fill().map(() => this.randomMatrix(inputSize, inputSize));
    this.Wk = Array(numLayers).fill().map(() => this.randomMatrix(inputSize, inputSize));
    this.Wv = Array(numLayers).fill().map(() => this.randomMatrix(inputSize, inputSize));
    this.Wo = Array(numLayers).fill().map(() => this.randomMatrix(inputSize, inputSize));
    
    // Feed-forward networks
    this.W1 = Array(numLayers).fill().map(() => this.randomMatrix(feedForwardDim, inputSize));
    this.b1 = Array(numLayers).fill().map(() => this.randomVector(feedForwardDim));
    this.W2 = Array(numLayers).fill().map(() => this.randomMatrix(inputSize, feedForwardDim));
    this.b2 = Array(numLayers).fill().map(() => this.randomVector(inputSize));
    
    // Layer norms
    this.ln1 = Array(numLayers).fill().map(() => ({ gamma: 1, beta: 0 }));
    this.ln2 = Array(numLayers).fill().map(() => ({ gamma: 1, beta: 0 }));
    
    // Output layer
    this.Wout = this.randomMatrix(2, inputSize);
    this.bout = this.randomVector(2);
    
    this.lr = CONFIG.LEARNING_RATE;
  }
  
  randomMatrix(rows, cols) {
    return Array(rows).fill().map(() => 
      Array(cols).fill().map(() => (Math.random() - 0.5) * 0.02)
    );
  }
  
  randomVector(size) {
    return Array(size).fill().map(() => (Math.random() - 0.5) * 0.02);
  }
  
  dot(matrix, vector) {
    return matrix.map(row => row.reduce((sum, val, i) => sum + val * vector[i], 0));
  }
  
  matMul(A, B) {
    const result = Array(A.length).fill().map(() => Array(B[0].length).fill(0));
    for (let i = 0; i < A.length; i++) {
      for (let j = 0; j < B[0].length; j++) {
        for (let k = 0; k < B.length; k++) {
          result[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    return result;
  }
  
  attention(Q, K, V, mask = null) {
    const dk = Q[0].length;
    let scores = this.matMul(Q, this.transpose(K));
    scores = scores.map(row => row.map(v => v / Math.sqrt(dk)));
    
    if (mask) {
      for (let i = 0; i < scores.length; i++) {
        for (let j = 0; j < scores[i].length; j++) {
          if (mask[i][j] === 0) scores[i][j] = -1e9;
        }
      }
    }
    
    const attentionWeights = scores.map(row => softmax(row));
    const output = this.matMul(attentionWeights, V);
    return output;
  }
  
  transpose(matrix) {
    return matrix[0].map((_, colIndex) => matrix.map(row => row[colIndex]));
  }
  
  layerNorm(x, gamma, beta) {
    const mean = x.reduce((a, b) => a + b, 0) / x.length;
    const variance = x.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / x.length;
    const std = Math.sqrt(variance + 1e-8);
    return x.map((val, i) => gamma * (val - mean) / std + beta);
  }
  
  feedForward(x, W1, b1, W2, b2) {
    const hidden = this.dot(W1, x).map((v, i) => relu(v + b1[i]));
    return this.dot(W2, hidden).map((v, i) => v + b2[i]);
  }
  
  forward(sequence) {
    let x = sequence;
    
    for (let layer = 0; layer < this.numLayers; layer++) {
      // Multi-head attention
      const Q = this.dot(this.Wq[layer], x);
      const K = this.dot(this.Wk[layer], x);
      const V = this.dot(this.Wv[layer], x);
      
      const attnOutput = this.attention([Q], [K], [V])[0];
      const attnOutput2 = this.dot(this.Wo[layer], attnOutput);
      
      // Add & norm
      let x2 = attnOutput2.map((v, i) => v + x[i]);
      x2 = this.layerNorm(x2, this.ln1[layer].gamma, this.ln1[layer].beta);
      
      // Feed forward
      const ffOutput = this.feedForward(x2, this.W1[layer], this.b1[layer], this.W2[layer], this.b2[layer]);
      
      // Add & norm
      let x3 = ffOutput.map((v, i) => v + x2[i]);
      x3 = this.layerNorm(x3, this.ln2[layer].gamma, this.ln2[layer].beta);
      
      x = x3;
    }
    
    const output = this.dot(this.Wout, x).map((v, i) => v + this.bout[i]);
    return softmax(output);
  }
  
  train(features, target) {
    const prediction = this.forward(features);
    const loss = -Math.log(prediction[target] + 1e-8);
    
    // Simplified gradient descent (would need full backprop for real transformer)
    const grad = prediction.map((p, i) => p - (i === target ? 1 : 0));
    
    for (let i = 0; i < this.Wout.length; i++) {
      for (let j = 0; j < this.Wout[i].length; j++) {
        this.Wout[i][j] -= this.lr * grad[i] * (features[j] || 0);
      }
    }
    
    for (let i = 0; i < this.bout.length; i++) {
      this.bout[i] -= this.lr * grad[i];
    }
    
    return loss;
  }
  
  predict(features) {
    const probs = this.forward(features);
    const prediction = probs[0] > probs[1] ? 'Tài' : 'Xỉu';
    const confidence = 50 + Math.abs(probs[0] - probs[1]) * 50;
    return { prediction, confidence: Math.min(CONFIG.MAX_CONFIDENCE, confidence) };
  }
  
  save() {
    return {
      Wq: this.Wq, Wk: this.Wk, Wv: this.Wv, Wo: this.Wo,
      W1: this.W1, b1: this.b1, W2: this.W2, b2: this.b2,
      ln1: this.ln1, ln2: this.ln2,
      Wout: this.Wout, bout: this.bout
    };
  }
  
  load(data) {
    if (data) {
      this.Wq = data.Wq; this.Wk = data.Wk; this.Wv = data.Wv; this.Wo = data.Wo;
      this.W1 = data.W1; this.b1 = data.b1; this.W2 = data.W2; this.b2 = data.b2;
      this.ln1 = data.ln1; this.ln2 = data.ln2;
      this.Wout = data.Wout; this.bout = data.bout;
    }
  }
}

// ==================== REINFORCEMENT LEARNING AGENT ====================
class RLAgent {
  constructor() {
    this.qTable = new Map();
    this.alpha = 0.1; // Learning rate
    this.gamma = 0.95; // Discount factor
    this.epsilon = 0.3; // Exploration rate
    this.epsilonDecay = 0.995;
    this.minEpsilon = 0.05;
    this.rewards = [];
  }
  
  getStateKey(state) {
    return JSON.stringify(state);
  }
  
  getQValue(state, action) {
    const key = this.getStateKey(state);
    if (!this.qTable.has(key)) {
      this.qTable.set(key, [0.5, 0.5]);
    }
    return this.qTable.get(key)[action];
  }
  
  chooseAction(state) {
    if (Math.random() < this.epsilon) {
      return Math.random() < 0.5 ? 0 : 1;
    }
    
    const q0 = this.getQValue(state, 0);
    const q1 = this.getQValue(state, 1);
    return q0 > q1 ? 0 : 1;
  }
  
  update(state, action, reward, nextState) {
    const key = this.getStateKey(state);
    if (!this.qTable.has(key)) {
      this.qTable.set(key, [0.5, 0.5]);
    }
    
    const currentQ = this.getQValue(state, action);
    const nextKey = this.getStateKey(nextState);
    if (!this.qTable.has(nextKey)) {
      this.qTable.set(nextKey, [0.5, 0.5]);
    }
    
    const nextMaxQ = Math.max(...this.qTable.get(nextKey));
    const newQ = currentQ + this.alpha * (reward + this.gamma * nextMaxQ - currentQ);
    
    const qValues = this.qTable.get(key);
    qValues[action] = newQ;
    this.qTable.set(key, qValues);
    
    this.rewards.push(reward);
    if (this.rewards.length > 100) this.rewards.shift();
    
    // Decay epsilon
    this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);
  }
  
  getAverageReward() {
    if (this.rewards.length === 0) return 0;
    return this.rewards.reduce((a, b) => a + b, 0) / this.rewards.length;
  }
  
  save() {
    return {
      qTable: Array.from(this.qTable.entries()),
      alpha: this.alpha,
      gamma: this.gamma,
      epsilon: this.epsilon
    };
  }
  
  load(data) {
    if (data) {
      this.qTable = new Map(data.qTable);
      this.alpha = data.alpha;
      this.gamma = data.gamma;
      this.epsilon = data.epsilon;
    }
  }
}

// ==================== ENHANCED NEURAL NETWORK ====================
class EnhancedNeuralNetwork {
  constructor(inputSize = 15, hiddenSizes = [24, 16, 8]) {
    this.inputSize = inputSize;
    this.hiddenSizes = hiddenSizes;
    
    // Build layers dynamically
    this.layers = [];
    let prevSize = inputSize;
    
    for (let i = 0; i < hiddenSizes.length; i++) {
      this.layers.push({
        W: this.randomMatrix(hiddenSizes[i], prevSize),
        b: this.randomVector(hiddenSizes[i]),
        dropout: CONFIG.DROPOUT_RATE
      });
      prevSize = hiddenSizes[i];
    }
    
    // Output layer
    this.layers.push({
      W: this.randomMatrix(2, prevSize),
      b: this.randomVector(2),
      dropout: 0
    });
    
    this.lr = CONFIG.LEARNING_RATE;
    this.momentum = 0.9;
    this.velocity = [];
    this.initVelocity();
  }
  
  randomMatrix(rows, cols) {
    const scale = Math.sqrt(2.0 / cols);
    return Array(rows).fill().map(() => 
      Array(cols).fill().map(() => (Math.random() - 0.5) * 2 * scale)
    );
  }
  
  randomVector(size) {
    return Array(size).fill().map(() => (Math.random() - 0.5) * 0.1);
  }
  
  initVelocity() {
    this.velocity = this.layers.map(layer => ({
      W: layer.W.map(row => row.map(() => 0)),
      b: layer.b.map(() => 0)
    }));
  }
  
  dot(matrix, vector) {
    return matrix.map(row => row.reduce((sum, val, i) => sum + val * vector[i], 0));
  }
  
  forward(x, training = false) {
    const activations = [x];
    let current = x;
    
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      const z = this.dot(layer.W, current).map((v, idx) => v + layer.b[idx]);
      
      let a;
      if (i === this.layers.length - 1) {
        a = softmax(z);
      } else {
        a = z.map(leakyRelu);
        if (training && layer.dropout > 0) {
          const mask = a.map(() => Math.random() > layer.dropout ? 1 : 0);
          a = a.map((v, idx) => v * mask[idx] / (1 - layer.dropout));
        }
      }
      
      activations.push(a);
      current = a;
    }
    
    return { output: current, activations };
  }
  
  backward(x, target, forwardResult) {
    const { activations } = forwardResult;
    const gradients = [];
    
    // Output layer gradient
    let delta = activations[activations.length - 1].map((p, i) => p - (i === target ? 1 : 0));
    
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      const prevAct = activations[i];
      
      const dW = Array(layer.W.length).fill().map(() => Array(layer.W[0].length).fill(0));
      for (let j = 0; j < layer.W.length; j++) {
        for (let k = 0; k < layer.W[0].length; k++) {
          dW[j][k] = delta[j] * prevAct[k];
        }
      }
      
      const db = delta.slice();
      
      gradients.unshift({ dW, db });
      
      if (i > 0) {
        const nextDelta = Array(layer.W[0].length).fill(0);
        for (let j = 0; j < layer.W.length; j++) {
          for (let k = 0; k < layer.W[0].length; k++) {
            nextDelta[k] += delta[j] * layer.W[j][k];
          }
        }
        delta = nextDelta.map(v => v * (prevAct[k] > 0 ? 1 : 0.01));
      }
    }
    
    // Update weights with momentum
    for (let i = 0; i < this.layers.length; i++) {
      const { dW, db } = gradients[i];
      const layer = this.layers[i];
      
      for (let j = 0; j < layer.W.length; j++) {
        for (let k = 0; k < layer.W[0].length; k++) {
          this.velocity[i].W[j][k] = this.momentum * this.velocity[i].W[j][k] - this.lr * dW[j][k];
          layer.W[j][k] += this.velocity[i].W[j][k];
        }
      }
      
      for (let j = 0; j < layer.b.length; j++) {
        this.velocity[i].b[j] = this.momentum * this.velocity[i].b[j] - this.lr * db[j];
        layer.b[j] += this.velocity[i].b[j];
      }
    }
  }
  
  train(features, targetTai) {
    const target = targetTai ? 0 : 1;
    const forwardResult = this.forward(features, true);
    this.backward(features, target, forwardResult);
    return crossEntropyLoss(forwardResult.output, target);
  }
  
  predict(features) {
    const { output } = this.forward(features, false);
    const prediction = output[0] > output[1] ? 'Tài' : 'Xỉu';
    const confidence = 50 + Math.abs(output[0] - output[1]) * 50;
    return { prediction, confidence: Math.min(CONFIG.MAX_CONFIDENCE, confidence) };
  }
  
  save() {
    return {
      layers: this.layers.map(layer => ({
        W: layer.W, b: layer.b, dropout: layer.dropout
      })),
      inputSize: this.inputSize,
      hiddenSizes: this.hiddenSizes
    };
  }
  
  load(data) {
    if (data) {
      this.layers = data.layers;
      this.inputSize = data.inputSize;
      this.hiddenSizes = data.hiddenSizes;
      this.initVelocity();
    }
  }
}

// ==================== ENHANCED ATTENTION MODEL ====================
class EnhancedAttentionModel {
  constructor(windowSize = 30, numHeads = 3) {
    this.windowSize = windowSize;
    this.numHeads = numHeads;
    this.headDim = 4;
    
    // Multi-head attention weights
    this.Wq = Array(numHeads).fill().map(() => this.randomMatrix(this.headDim, 2));
    this.Wk = Array(numHeads).fill().map(() => this.randomMatrix(this.headDim, 2));
    this.Wv = Array(numHeads).fill().map(() => this.randomMatrix(this.headDim, 2));
    this.Wo = this.randomMatrix(2, this.headDim * numHeads);
    
    // Positional encoding
    this.positionalEncoding = Array(windowSize).fill().map((_, i) => [
      Math.sin(i / 10000),
      Math.cos(i / 10000)
    ]);
    
    this.keyHistory = [];
    this.valueHistory = [];
    this.query = null;
    this.lr = CONFIG.LEARNING_RATE;
  }
  
  randomMatrix(rows, cols) {
    return Array(rows).fill().map(() => 
      Array(cols).fill().map(() => (Math.random() - 0.5) * 0.1)
    );
  }
  
  embedResult(result, sumValue = 10, position = 0) {
    const resultVec = [result === 'Tài' ? 1 : -1, (sumValue - 10.5) / 4];
    const posVec = this.positionalEncoding[position % this.windowSize];
    return [
      resultVec[0] + posVec[0] * 0.1,
      resultVec[1] + posVec[1] * 0.1
    ];
  }
  
  multiHeadAttention(query, keys, values) {
    const headOutputs = [];
    
    for (let h = 0; h < this.numHeads; h++) {
      const Q = this.dot(this.Wq[h], query);
      const Ks = keys.map(k => this.dot(this.Wk[h], k));
      const Vs = values.map(v => this.dot(this.Wv[h], v));
      
      let scores = Ks.map(k => this.dotProduct(Q, k));
      const sumScores = scores.reduce((a, b) => a + b, 0) + 1e-8;
      const attention = scores.map(s => s / sumScores);
      
      let output = [0, 0];
      for (let i = 0; i < attention.length; i++) {
        output[0] += attention[i] * Vs[i][0];
        output[1] += attention[i] * Vs[i][1];
      }
      headOutputs.push(output);
    }
    
    const concatenated = headOutputs.flat();
    return this.dot(this.Wo, concatenated);
  }
  
  dot(matrix, vector) {
    return matrix.map(row => row.reduce((sum, val, i) => sum + val * vector[i], 0));
  }
  
  dotProduct(a, b) {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }
  
  update(results, sums) {
    const seq = results.slice(0, this.windowSize);
    const sumSeq = sums.slice(0, this.windowSize);
    
    this.keyHistory = seq.map((r, i) => this.embedResult(r, sumSeq[i] || 10, i));
    this.valueHistory = this.keyHistory.slice();
    
    if (seq.length > 0) {
      this.query = this.embedResult(seq[0], sumSeq[0] || 10, 0);
    }
  }
  
  train(actualNextResult, actualNextSum) {
    if (!this.query || this.keyHistory.length === 0) return;
    
    const targetEmb = this.embedResult(actualNextResult, actualNextSum);
    const predEmb = this.multiHeadAttention(this.query, this.keyHistory, this.valueHistory);
    
    const error = targetEmb.map((v, i) => v - predEmb[i]);
    
    // Simplified gradient update
    for (let h = 0; h < this.numHeads; h++) {
      for (let i = 0; i < this.Wq[h].length; i++) {
        for (let j = 0; j < this.Wq[h][i].length; j++) {
          this.Wq[h][i][j] += this.lr * error[i] * this.query[j];
        }
      }
    }
  }
  
  predict() {
    if (!this.query || this.keyHistory.length < 5) return null;
    
    const predEmb = this.multiHeadAttention(this.query, this.keyHistory, this.valueHistory);
    const probTai = sigmoid(predEmb[0] * 2);
    const confidence = 50 + Math.abs(probTai - 0.5) * 80;
    
    return {
      prediction: probTai > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.min(CONFIG.MAX_CONFIDENCE, confidence)
    };
  }
  
  save() {
    return {
      Wq: this.Wq, Wk: this.Wk, Wv: this.Wv, Wo: this.Wo,
      windowSize: this.windowSize, numHeads: this.numHeads
    };
  }
  
  load(data) {
    if (data) {
      this.Wq = data.Wq; this.Wk = data.Wk; this.Wv = data.Wv; this.Wo = data.Wo;
      this.windowSize = data.windowSize; this.numHeads = data.numHeads;
    }
  }
}

// ==================== ADVANCED MARKOV CHAIN ====================
class AdvancedMarkovChain {
  constructor(order = 3) {
    this.order = order;
    this.transitions = new Map();
    this.ngramCounts = new Map();
    this.totalTransitions = 0;
    this.kneserNeyDiscount = 0.75;
  }
  
  getStateKey(state) {
    return state.join('');
  }
  
  train(data) {
    if (!data || data.length < this.order + 1) return;
    
    for (let i = 0; i <= data.length - this.order - 1; i++) {
      const state = data.slice(i, i + this.order);
      const next = data[i + this.order];
      const stateKey = this.getStateKey(state);
      
      if (!this.transitions.has(stateKey)) {
        this.transitions.set(stateKey, new Map());
      }
      
      const nextMap = this.transitions.get(stateKey);
      nextMap.set(next, (nextMap.get(next) || 0) + 1);
      this.totalTransitions++;
      
      // Track lower-order n-grams for Kneser-Ney smoothing
      for (let j = 1; j <= this.order; j++) {
        const subState = state.slice(this.order - j);
        const subKey = this.getStateKey(subState);
        if (!this.ngramCounts.has(subKey)) {
          this.ngramCounts.set(subKey, new Map());
        }
        const subMap = this.ngramCounts.get(subKey);
        subMap.set(next, (subMap.get(next) || 0) + 1);
      }
    }
  }
  
  kneserNeyProb(state, next) {
    const stateKey = this.getStateKey(state);
    const stateTrans = this.transitions.get(stateKey);
    
    if (!stateTrans) return this.continuationProb(next);
    
    const count = stateTrans.get(next) || 0;
    const total = Array.from(stateTrans.values()).reduce((a, b) => a + b, 0);
    
    if (total === 0) return this.continuationProb(next);
    
    const discountedCount = Math.max(0, count - this.kneserNeyDiscount);
    const lambda = (this.kneserNeyDiscount / total) * this.transitions.size;
    
    return (discountedCount / total) + lambda * this.continuationProb(next);
  }
  
  continuationProb(next) {
    let uniquePredecessors = 0;
    for (const [_, nextMap] of this.ngramCounts) {
      if (nextMap.has(next)) uniquePredecessors++;
    }
    
    let totalUnique = 0;
    for (const [_, nextMap] of this.ngramCounts) {
      totalUnique += nextMap.size;
    }
    
    return totalUnique > 0 ? uniquePredecessors / totalUnique : 0.5;
  }
  
  predict(lastN) {
    if (!lastN || lastN.length < this.order) return null;
    
    const state = lastN.slice(0, this.order);
    const probT = this.kneserNeyProb(state, 'T');
    const probX = this.kneserNeyProb(state, 'X');
    
    if (Math.abs(probT - 0.5) < 0.08) return null;
    
    const confidence = 50 + Math.abs(probT - 0.5) * 60;
    
    return {
      prediction: probT > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.min(CONFIG.MAX_CONFIDENCE, confidence)
    };
  }
  
  save() {
    return {
      order: this.order,
      transitions: Array.from(this.transitions.entries()),
      ngramCounts: Array.from(this.ngramCounts.entries()),
      totalTransitions: this.totalTransitions
    };
  }
  
  load(data) {
    if (data) {
      this.order = data.order;
      this.transitions = new Map(data.transitions);
      this.ngramCounts = new Map(data.ngramCounts);
      this.totalTransitions = data.totalTransitions;
    }
  }
}

// ==================== ENHANCED ANOMALY DETECTOR ====================
class EnhancedAnomalyDetector {
  constructor() {
    this.anomalyPatterns = [];
    this.breakPoints = [];
    this.timeWindowStats = {};
    this.reinforcementMemory = { tai: 0, xiu: 0 };
    this.confidenceHistory = {};
    this.featureWeights = {
      trend: 25, balance: 20, entropy: 15, streak: 15, 
      sumTrend: 15, momentum: 10, volatility: 10, clustering: 10
    };
    this.zScoreHistory = [];
    this.movingAverage = [];
    this.ewmaAlpha = 0.3;
    this.anomalyThreshold = 1.8;
  }
  
  calculateEntropy(results) {
    const total = results.length;
    if (total === 0) return 1;
    const taiCount = results.filter(r => r === 'Tài').length;
    const pTai = taiCount / total;
    const pXiu = 1 - pTai;
    if (pTai === 0 || pXiu === 0) return 0;
    return -(pTai * Math.log2(pTai) + pXiu * Math.log2(pXiu));
  }
  
  calculateVolatility(sums, window = 10) {
    if (sums.length < window) return 0;
    const recent = sums.slice(0, window);
    const mean = recent.reduce((a, b) => a + b, 0) / window;
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window;
    return Math.sqrt(variance);
  }
  
  detectChangePoint(results) {
    if (results.length < 8) return null;
    
    const half = Math.floor(results.length / 2);
    const firstHalf = results.slice(0, half);
    const secondHalf = results.slice(half, half * 2);
    
    const firstRatio = firstHalf.filter(r => r === 'Tài').length / firstHalf.length;
    const secondRatio = secondHalf.filter(r => r === 'Tài').length / secondHalf.length;
    
    if (Math.abs(firstRatio - secondRatio) > 0.3) {
      return { detected: true, confidence: Math.min(90, Math.abs(firstRatio - secondRatio) * 150) };
    }
    return { detected: false, confidence: 0 };
  }
  
  detectAnomaly(results, sums = [], windowSize = 15) {
    if (results.length < windowSize) return { isAnomaly: false, score: 0 };
    
    const recent = results.slice(0, windowSize);
    const taiCount = recent.filter(r => r === 'Tài').length;
    const expectedMean = windowSize * 0.5;
    const expectedStd = Math.sqrt(windowSize * 0.5 * 0.5);
    let zScore = expectedStd > 0 ? (taiCount - expectedMean) / expectedStd : 0;
    
    this.zScoreHistory.push(zScore);
    if (this.zScoreHistory.length > 50) this.zScoreHistory.shift();
    
    const meanZ = this.zScoreHistory.reduce((a, b) => a + b, 0) / this.zScoreHistory.length;
    const adjustedZ = zScore - meanZ * 0.5;
    
    this.movingAverage.push(adjustedZ);
    if (this.movingAverage.length > 10) this.movingAverage.shift();
    const smoothedZ = this.movingAverage.reduce((a, b) => a + b, 0) / this.movingAverage.length;
    
    const entropy = this.calculateEntropy(recent);
    const volatility = this.calculateVolatility(sums, windowSize);
    const changePoint = this.detectChangePoint(results);
    
    let anomalyScore = Math.abs(smoothedZ) / 3;
    if (entropy < 0.5) anomalyScore += 0.3;
    if (volatility > 3) anomalyScore += 0.2;
    if (changePoint.detected) anomalyScore += 0.4;
    
    const isAnomaly = Math.abs(smoothedZ) > this.anomalyThreshold || anomalyScore > 0.6;
    
    let breakDirection = null;
    let breakDetected = false;
    
    if (results.length >= 6) {
      let streak = 1;
      for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) streak++;
        else break;
      }
      if (streak >= 4 && results.length > streak && results[streak] !== results[0]) {
        breakDetected = true;
        breakDirection = results[streak];
      }
    }
    
    return {
      isAnomaly,
      score: Math.min(100, anomalyScore * 100),
      zScore: adjustedZ.toFixed(2),
      entropy: entropy.toFixed(3),
      volatility: volatility.toFixed(2),
      breakDetected,
      breakDirection,
      changePoint: changePoint.detected
    };
  }
  
  learnFromResult(prediction, actual, confidence, featuresUsed = null) {
    const isCorrect = prediction === actual;
    
    if (isCorrect) {
      if (prediction === 'Tài') this.reinforcementMemory.tai += 0.08;
      else this.reinforcementMemory.xiu += 0.08;
    } else {
      if (prediction === 'Tài') this.reinforcementMemory.tai -= 0.1;
      else this.reinforcementMemory.xiu -= 0.1;
    }
    
    this.reinforcementMemory.tai = Math.max(-3, Math.min(3, this.reinforcementMemory.tai));
    this.reinforcementMemory.xiu = Math.max(-3, Math.min(3, this.reinforcementMemory.xiu));
    
    const bucket = Math.floor(confidence / 10) * 10;
    if (!this.confidenceHistory[bucket]) {
      this.confidenceHistory[bucket] = { correct: 0, total: 0 };
    }
    this.confidenceHistory[bucket].total++;
    if (isCorrect) this.confidenceHistory[bucket].correct++;
    
    this.save();
  }
  
  calibrateConfidence(rawConfidence, method) {
    const calibrated = this.calibrateByHistory(rawConfidence, method);
    const biasCorrection = this.getBiasCorrection();
    let final = calibrated + biasCorrection * 30;
    return Math.min(CONFIG.MAX_CONFIDENCE, Math.max(CONFIG.MIN_CONFIDENCE, Math.round(final)));
  }
  
  calibrateByHistory(confidence, method) {
    const bucket = Math.floor(confidence / 10) * 10;
    const stats = this.confidenceHistory[bucket];
    
    if (!stats || stats.total < 5) {
      if (confidence > 70) return confidence - 8;
      if (confidence < 55) return confidence + 5;
      return confidence;
    }
    
    const actualAccuracy = stats.correct / stats.total;
    const calibration = (actualAccuracy * 100) - bucket;
    return confidence + calibration * 0.5;
  }
  
  getBiasCorrection() {
    const diff = (this.reinforcementMemory.tai || 0) - (this.reinforcementMemory.xiu || 0);
    return Math.max(-0.25, Math.min(0.25, diff * 0.05));
  }
  
  updateTimeWindowStats(result, timestamp) {
    const hour = timestamp.getHours();
    const minute = Math.floor(timestamp.getMinutes() / 15) * 15;
    const windowKey = `${hour}:${String(minute).padStart(2, '0')}`;
    
    if (!this.timeWindowStats[windowKey]) {
      this.timeWindowStats[windowKey] = { tai: 0, xiu: 0, total: 0 };
    }
    
    if (result === 'Tài') this.timeWindowStats[windowKey].tai++;
    else this.timeWindowStats[windowKey].xiu++;
    this.timeWindowStats[windowKey].total++;
  }
  
  predictByTimeWindow(currentTimestamp) {
    const hour = currentTimestamp.getHours();
    const minute = Math.floor(currentTimestamp.getMinutes() / 15) * 15;
    const windowKey = `${hour}:${String(minute).padStart(2, '0')}`;
    const stats = this.timeWindowStats[windowKey];
    
    if (!stats || stats.total < 8) return null;
    
    const taiRatio = stats.tai / stats.total;
    const confidenceBonus = Math.min(15, Math.sqrt(stats.total) * 1.5);
    
    if (taiRatio > 0.6) {
      return { prediction: 'Tài', confidence: 55 + Math.round(taiRatio * 20 + confidenceBonus) };
    }
    if (taiRatio < 0.4) {
      return { prediction: 'Xỉu', confidence: 55 + Math.round((1 - taiRatio) * 20 + confidenceBonus) };
    }
    return null;
  }
  
  save() {
    try {
      fs.writeFileSync(FILES.ANOMALY, JSON.stringify({
        anomalyPatterns: this.anomalyPatterns.slice(-500),
        breakPoints: this.breakPoints.slice(-500),
        timeWindowStats: this.timeWindowStats,
        featureWeights: this.featureWeights,
        confidenceHistory: this.confidenceHistory,
        reinforcementMemory: this.reinforcementMemory
      }, null, 2));
    } catch (error) {
      logger.error(`Failed to save anomaly data: ${error.message}`);
    }
  }
  
  load() {
    try {
      if (fs.existsSync(FILES.ANOMALY)) {
        const data = JSON.parse(fs.readFileSync(FILES.ANOMALY, 'utf8'));
        this.anomalyPatterns = data.anomalyPatterns || [];
        this.breakPoints = data.breakPoints || [];
        this.timeWindowStats = data.timeWindowStats || {};
        this.featureWeights = data.featureWeights || this.featureWeights;
        this.confidenceHistory = data.confidenceHistory || {};
        this.reinforcementMemory = data.reinforcementMemory || { tai: 0, xiu: 0 };
        logger.info('Anomaly detector data loaded');
      }
    } catch (error) {
      logger.error(`Failed to load anomaly data: ${error.message}`);
    }
  }
}

// ==================== ADVANCED MONTE CARLO ====================
class AdvancedMonteCarlo {
  constructor(historicalData, windowSize = 60) {
    this.historicalData = historicalData;
    this.windowSize = windowSize;
    this.numSimulations = 15000;
    this.minPatterns = CONFIG.MIN_PATTERNS;
  }
  
  extractFeatures(data) {
    if (!data || data.length < this.windowSize) return null;
    
    const windowData = data.slice(0, this.windowSize);
    const results = windowData.map(d => d.Ket_qua);
    const sums = windowData.map(d => d.Tong);
    
    const taiCount = results.filter(r => r === 'Tài').length;
    const balanceRatio = Math.min(taiCount, results.length - taiCount) / Math.max(taiCount, results.length - taiCount, 1);
    
    const last10 = results.slice(0, 10);
    const last10Tai = last10.filter(r => r === 'Tài').length;
    
    const sumsLast10 = sums.slice(0, 10);
    const sumMean = sumsLast10.reduce((a, b) => a + b, 0) / 10;
    const sumStd = Math.sqrt(sumsLast10.reduce((a, b) => a + Math.pow(b - sumMean, 2), 0) / 10);
    
    let streak = 1;
    for (let i = 1; i < results.length; i++) {
      if (results[i] === results[0]) streak++;
      else break;
    }
    
    let alternating = 0;
    for (let i = 1; i < Math.min(results.length, 15); i++) {
      if (results[i] !== results[i-1]) alternating++;
    }
    
    const patterns = [];
    for (let i = 0; i <= results.length - 5; i++) {
      patterns.push(results.slice(i, i + 5).join(''));
    }
    const patternFrequency = {};
    patterns.forEach(p => patternFrequency[p] = (patternFrequency[p] || 0) + 1);
    const avgPatternFreq = Object.values(patternFrequency).reduce((a, b) => a + b, 0) / Object.keys(patternFrequency).length;
    
    return {
      taiRatio: taiCount / results.length,
      balanceRatio,
      last10Tai,
      sumMean,
      sumStd,
      streak: Math.min(streak, 20),
      alternatingRatio: alternating / Math.min(results.length - 1, 14),
      avgPatternFreq,
      recentResults: results.slice(0, 10),
      recentSums: sums.slice(0, 10)
    };
  }
  
  findSimilarPatterns(currentFeatures, maxMatches = 150) {
    const matches = [];
    
    for (let i = 0; i <= this.historicalData.length - this.windowSize - 1; i++) {
      const windowData = this.historicalData.slice(i, i + this.windowSize);
      const features = this.extractFeatures(windowData);
      if (!features) continue;
      
      let similarity = 0;
      
      // Compare tai ratio
      const taiDiff = Math.abs(features.taiRatio - currentFeatures.taiRatio);
      similarity += Math.max(0, 30 - taiDiff * 60);
      
      // Compare streak
      const streakDiff = Math.abs(features.streak - currentFeatures.streak);
      similarity += Math.max(0, 20 - streakDiff * 2);
      
      // Compare alternating pattern
      const altDiff = Math.abs(features.alternatingRatio - currentFeatures.alternatingRatio);
      similarity += Math.max(0, 15 - altDiff * 30);
      
      // Compare sum statistics
      const sumMeanDiff = Math.abs(features.sumMean - currentFeatures.sumMean);
      similarity += Math.max(0, 15 - sumMeanDiff * 3);
      
      // Compare pattern frequency
      const patternDiff = Math.abs(features.avgPatternFreq - currentFeatures.avgPatternFreq);
      similarity += Math.max(0, 10 - patternDiff * 5);
      
      // Compare recent results
      let recentMatch = 0;
      for (let j = 0; j < Math.min(5, features.recentResults.length, currentFeatures.recentResults.length); j++) {
        if (features.recentResults[j] === currentFeatures.recentResults[j]) recentMatch++;
      }
      similarity += recentMatch * 4;
      
      if (similarity > 20) {
        matches.push({
          similarity,
          nextResult: this.historicalData[i + this.windowSize]?.Ket_qua,
          recency: i / this.historicalData.length
        });
      }
    }
    
    matches.sort((a, b) => b.similarity - a.similarity);
    return matches.slice(0, maxMatches);
  }
  
  runMonteCarloSimulation(data, currentFeatures) {
    if (this.historicalData.length < 50) {
      return this.weightedFallback(data);
    }
    
    const similarPatterns = this.findSimilarPatterns(currentFeatures, 150);
    
    if (similarPatterns.length < this.minPatterns) {
      return this.weightedFallback(data);
    }
    
    let taiWeight = 0, xiuWeight = 0, totalWeight = 0;
    
    for (const pattern of similarPatterns) {
      let weight = Math.pow(pattern.similarity / 100, 1.5);
      weight *= Math.exp(-pattern.recency * 0.8);
      
      // Boost weight for recent patterns
      if (pattern.recency > 0.8) weight *= 1.3;
      
      totalWeight += weight;
      
      if (pattern.nextResult === 'Tài') taiWeight += weight;
      else if (pattern.nextResult === 'Xỉu') xiuWeight += weight;
    }
    
    if (totalWeight === 0) return this.weightedFallback(data);
    
    const taiProbability = taiWeight / totalWeight;
    const confidenceBoost = Math.min(20, Math.sqrt(similarPatterns.length) * 1.5);
    let rawConfidence = 45 + Math.abs(taiProbability - 0.5) * 100 + confidenceBoost;
    
    return {
      prediction: taiProbability > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.min(CONFIG.MAX_CONFIDENCE, Math.round(rawConfidence)),
      similarPatternsCount: similarPatterns.length,
      method: 'advanced_monte_carlo'
    };
  }
  
  weightedFallback(data) {
    if (!data || data.length === 0) {
      return { prediction: 'Tài', confidence: 50, method: 'fallback' };
    }
    
    const weights = [0.15, 0.13, 0.11, 0.1, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04];
    const recentResults = data.slice(0, Math.min(10, data.length)).map(d => d.Ket_qua);
    
    let weightedTai = 0, totalWeight = 0;
    
    for (let i = 0; i < recentResults.length && i < weights.length; i++) {
      const weight = weights[i];
      totalWeight += weight;
      if (recentResults[i] === 'Tài') weightedTai += weight;
    }
    
    const taiProb = totalWeight > 0 ? weightedTai / totalWeight : 0.5;
    const confidence = 45 + Math.abs(taiProb - 0.5) * 60;
    
    return {
      prediction: taiProb > 0.5 ? 'Tài' : 'Xỉu',
      confidence: Math.min(CONFIG.MAX_CONFIDENCE, Math.round(confidence)),
      method: 'weighted_fallback'
    };
  }
  
  predict(data) {
    if (!data || data.length < this.windowSize) {
      return this.weightedFallback(data);
    }
    
    const currentFeatures = this.extractFeatures(data);
    if (!currentFeatures) {
      return this.weightedFallback(data);
    }
    
    return this.runMonteCarloSimulation(data, currentFeatures);
  }
}

// ==================== REGIME DETECTOR ====================
class RegimeDetector {
  constructor() {
    this.regimeHistory = [];
    this.regimeThresholds = {
      trending: 0.55,
      volatile: 0.45,
      mixed: 0.5
    };
  }
  
  detectRegime(learningData) {
    if (!learningData.recentAccuracy || learningData.recentAccuracy.length < CONFIG.REGIME_WINDOW) {
      return { regime: 'unknown', confidence: 0.5 };
    }
    
    const recent = learningData.recentAccuracy.slice(-CONFIG.REGIME_WINDOW);
    const overallRate = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // Calculate volatility
    const variance = recent.reduce((a, b) => a + Math.pow(b - overallRate, 2), 0) / recent.length;
    const volatility = Math.sqrt(variance);
    
    let regime = 'mixed';
    let confidence = overallRate;
    
    if (overallRate > this.regimeThresholds.trending && volatility < 0.15) {
      regime = 'trending';
      confidence = overallRate;
    } else if (volatility > 0.2) {
      regime = 'volatile';
      confidence = 1 - volatility;
    }
    
    this.regimeHistory.push({ regime, confidence, timestamp: Date.now() });
    if (this.regimeHistory.length > 100) this.regimeHistory.shift();
    
    return { regime, confidence: Math.min(0.9, confidence) };
  }
  
  getMarketPhase() {
    if (this.regimeHistory.length < 20) return 'neutral';
    
    const recentRegimes = this.regimeHistory.slice(-20);
    const trendingCount = recentRegimes.filter(r => r.regime === 'trending').length;
    const volatileCount = recentRegimes.filter(r => r.regime === 'volatile').length;
    
    if (trendingCount > 12) return 'strong_trend';
    if (volatileCount > 12) return 'high_volatility';
    return 'neutral';
  }
}

// ==================== ENSEMBLE WEIGHT OPTIMIZER ====================
class EnsembleWeightOptimizer {
  constructor() {
    this.weights = {
      neuralnet: 0.15,
      attention: 0.15,
      lstm: 0.12,
      transformer: 0.12,
      markov: 0.1,
      monteCarlo: 0.1,
      anomaly: 0.08,
      dice: 0.05,
      time: 0.05,
      balance: 0.04,
      simple: 0.04
    };
    this.performanceHistory = {};
    this.learningRate = 0.01;
  }
  
  updateWeights(methodPerformances) {
    let totalPerformance = 0;
    const performance = {};
    
    for (const [method, perf] of Object.entries(methodPerformances)) {
      if (perf && perf.total > 5) {
        const accuracy = perf.correct / perf.total;
        performance[method] = accuracy;
        totalPerformance += accuracy;
      }
    }
    
    if (totalPerformance === 0) return;
    
    // Update weights based on performance
    for (const [method, accuracy] of Object.entries(performance)) {
      if (this.weights[method] !== undefined) {
        const targetWeight = accuracy / totalPerformance;
        this.weights[method] += this.learningRate * (targetWeight - this.weights[method]);
        this.weights[method] = Math.max(0.02, Math.min(0.3, this.weights[method]));
      }
    }
    
    // Normalize
    const sum = Object.values(this.weights).reduce((a, b) => a + b, 0);
    for (const method in this.weights) {
      this.weights[method] /= sum;
    }
  }
  
  getWeights() {
    return { ...this.weights };
  }
  
  save() {
    try {
      fs.writeFileSync(FILES.ENSEMBLE, JSON.stringify({
        weights: this.weights,
        performanceHistory: this.performanceHistory
      }, null, 2));
    } catch (error) {
      logger.error(`Failed to save ensemble weights: ${error.message}`);
    }
  }
  
  load() {
    try {
      if (fs.existsSync(FILES.ENSEMBLE)) {
        const data = JSON.parse(fs.readFileSync(FILES.ENSEMBLE, 'utf8'));
        this.weights = data.weights;
        this.performanceHistory = data.performanceHistory || {};
        logger.info('Ensemble weights loaded');
      }
    } catch (error) {
      logger.error(`Failed to load ensemble weights: ${error.message}`);
    }
  }
}

// ==================== DATA STRUCTURES ====================
let learningData = {
  hu: {
    predictions: [], totalPredictions: 0, correctPredictions: 0,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    methodPerformance: {
      neuralnet: { correct: 0, total: 0 }, attention: { correct: 0, total: 0 },
      lstm: { correct: 0, total: 0 }, transformer: { correct: 0, total: 0 },
      markov: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
      time: { correct: 0, total: 0 }, balance: { correct: 0, total: 0 },
      simple: { correct: 0, total: 0 }
    },
    lastUpdate: null
  },
  md5: {
    predictions: [], totalPredictions: 0, correctPredictions: 0,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    recentAccuracy: [],
    methodPerformance: {
      neuralnet: { correct: 0, total: 0 }, attention: { correct: 0, total: 0 },
      lstm: { correct: 0, total: 0 }, transformer: { correct: 0, total: 0 },
      markov: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
      anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
      time: { correct: 0, total: 0 }, balance: { correct: 0, total: 0 },
      simple: { correct: 0, total: 0 }
    },
    lastUpdate: null
  }
};

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let predictionProbBuffer = { hu: [], md5: [] };

// Initialize AI models
let neuralNetworks = { hu: new EnhancedNeuralNetwork(), md5: new EnhancedNeuralNetwork() };
let attentionModels = { hu: new EnhancedAttentionModel(), md5: new EnhancedAttentionModel() };
let lstmNetworks = { hu: new LSTMNetwork(), md5: new LSTMNetwork() };
let transformerModels = { hu: new TransformerModel(), md5: new TransformerModel() };
let markovChains = { hu: new AdvancedMarkovChain(CONFIG.MARKOV_ORDER), md5: new AdvancedMarkovChain(CONFIG.MARKOV_ORDER) };
let monteCarloSimulators = { hu: null, md5: null };
let anomalyDetector = new EnhancedAnomalyDetector();
let regimeDetectors = { hu: new RegimeDetector(), md5: new RegimeDetector() };
let rlAgents = { hu: new RLAgent(), md5: new RLAgent() };
let ensembleOptimizer = new EnsembleWeightOptimizer();

// ==================== HELPER FUNCTIONS ====================
function normalizeResult(result) {
  if (result === 'Tài' || result === 'tài') return 'tai';
  if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
  return result.toLowerCase();
}

function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) return null;
  return apiData.list.map(item => ({
    Phien: item.id,
    Ket_qua: item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    Xuc_xac_1: item.dices[0],
    Xuc_xac_2: item.dices[1],
    Xuc_xac_3: item.dices[2],
    Tong: item.point,
    timestamp: new Date().toISOString()
  }));
}

async function fetchData(url) {
  try {
    const response = await axios.get(url, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    logger.error(`Failed to fetch data from ${url}: ${error.message}`);
    return null;
  }
}

function extractAdvancedFeatures(results, sums, hour, biasCorrection) {
  const features = [];
  
  // Last 5 results pattern
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  features.push(taiCount5 / 5);
  
  // Streak analysis
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  features.push(streak / 15);
  
  // Alternating pattern
  let alternations = 0;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i-1]) alternations++;
  }
  features.push(alternations / 9);
  
  // Sum statistics
  const sumMean = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const sumStd = Math.sqrt(sums.slice(0, 10).reduce((a, b) => a + Math.pow(b - sumMean, 2), 0) / 10);
  features.push((sumMean - 10.5) / 4);
  features.push(sumStd / 3);
  
  // Time features
  features.push(hour / 24);
  const minute = new Date().getMinutes();
  features.push(minute / 60);
  const dayOfWeek = new Date().getDay();
  features.push(dayOfWeek / 7);
  
  // Recent results
  features.push(results[0] === 'Tài' ? 1 : 0);
  features.push(results.length > 1 && results[1] === 'Tài' ? 1 : 0);
  features.push(results.length > 2 && results[2] === 'Tài' ? 1 : 0);
  features.push(results.length > 3 && results[3] === 'Tài' ? 1 : 0);
  
  // Bias correction
  features.push(biasCorrection);
  
  // Momentum
  if (results.length >= 5) {
    const momentum = (taiCount5 / 5 - 0.5) * 2;
    features.push(momentum);
  } else {
    features.push(0);
  }
  
  // Volatility from recent sums
  const volatility = sumStd;
  features.push(volatility);
  
  // Pad to fixed size
  while (features.length < 20) features.push(0);
  
  return features.slice(0, 20);
}

// ==================== PREDICTION METHODS ====================
function predictSimple(results, regime) {
  if (results.length < 3) return { prediction: results[0] || 'Tài', confidence: 50 };
  
  let streak = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streak++;
    else break;
  }
  
  if (regime.regime === 'trending' && streak >= 2) {
    const confidence = 55 + Math.min(15, streak * 3);
    return { prediction: results[0], confidence: Math.min(70, confidence) };
  }
  
  if (streak >= 4) {
    const confidence = 58 + Math.min(12, streak * 2);
    return { prediction: results[0], confidence: Math.min(75, confidence) };
  }
  
  // Check for alternating pattern
  let alternating = true;
  for (let i = 1; i < Math.min(results.length, 8); i++) {
    if (results[i] === results[i-1]) {
      alternating = false;
      break;
    }
  }
  if (alternating && results.length >= 6) {
    return { prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài', confidence: 58 };
  }
  
  // Balance check
  const last10 = results.slice(0, 10);
  const taiCount10 = last10.filter(r => r === 'Tài').length;
  if (taiCount10 >= 7) return { prediction: 'Xỉu', confidence: 60 };
  if (taiCount10 <= 3) return { prediction: 'Tài', confidence: 60 };
  
  return { prediction: results[0], confidence: 52 };
}

function predictDiceMeanReversion(sums) {
  if (!sums || sums.length < 15) return null;
  
  const recentSums = sums.slice(0, 15);
  const avgSum = recentSums.reduce((a, b) => a + b, 0) / 15;
  const zScore = (avgSum - 10.5) / 2.9;
  
  if (Math.abs(zScore) < 0.6) return null;
  
  const confidence = 50 + Math.min(25, Math.abs(zScore) * 8);
  
  return {
    prediction: zScore > 0 ? 'Xỉu' : 'Tài',
    confidence: Math.min(CONFIG.MAX_CONFIDENCE, confidence),
    zScore: zScore.toFixed(2)
  };
}

function predictBalance(results) {
  if (results.length < 20) return null;
  
  const last20 = results.slice(0, 20);
  const taiCount20 = last20.filter(r => r === 'Tài').length;
  const taiRatio = taiCount20 / 20;
  
  if (Math.abs(taiRatio - 0.5) < 0.08) return null;
  
  const confidence = 50 + Math.abs(taiRatio - 0.5) * 80;
  
  return {
    prediction: taiRatio > 0.5 ? 'Xỉu' : 'Tài',
    confidence: Math.min(CONFIG.MAX_CONFIDENCE, confidence)
  };
}

// ==================== SUPER PREDICTION ENGINE ====================
function calculateSuperPrediction(data, type) {
  const results = data.slice(0, 50).map(d => d.Ket_qua);
  const sums = data.slice(0, 50).map(d => d.Tong);
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  const biasCorrection = anomalyDetector.getBiasCorrection();
  const regime = regimeDetectors[type].detectRegime(learningData[type]);
  const marketPhase = regimeDetectors[type].getMarketPhase();
  
  const predictions = [];
  const weights = ensembleOptimizer.getWeights();
  
  // 1. Enhanced Neural Network
  try {
    const features = extractAdvancedFeatures(results, sums, currentHour, biasCorrection);
    const nnPred = neuralNetworks[type].predict(features);
    predictions.push({ ...nnPred, name: 'neuralnet', weight: weights.neuralnet });
  } catch (e) { logger.error(`NeuralNet error: ${e.message}`); }
  
  // 2. Enhanced Attention Model
  try {
    attentionModels[type].update(results, sums);
    const attPred = attentionModels[type].predict();
    if (attPred) predictions.push({ ...attPred, name: 'attention', weight: weights.attention });
  } catch (e) { logger.error(`Attention error: ${e.message}`); }
  
  // 3. LSTM Network
  try {
    const features = extractAdvancedFeatures(results, sums, currentHour, biasCorrection);
    const lstmPred = lstmNetworks[type].predict([features]);
    predictions.push({ ...lstmPred, name: 'lstm', weight: weights.lstm });
  } catch (e) { logger.error(`LSTM error: ${e.message}`); }
  
  // 4. Transformer Model
  try {
    const features = extractAdvancedFeatures(results, sums, currentHour, biasCorrection);
    const transformerPred = transformerModels[type].predict(features);
    predictions.push({ ...transformerPred, name: 'transformer', weight: weights.transformer });
  } catch (e) { logger.error(`Transformer error: ${e.message}`); }
  
  // 5. Advanced Markov Chain
  try {
    const resultsForMarkov = results.map(r => r === 'Tài' ? 'T' : 'X');
    const markovPred = markovChains[type].predict(resultsForMarkov);
    if (markovPred) predictions.push({ ...markovPred, name: 'markov', weight: weights.markov });
  } catch (e) { logger.error(`Markov error: ${e.message}`); }
  
  // 6. Advanced Monte Carlo
  try {
    if (monteCarloSimulators[type]) {
      const mcPred = monteCarloSimulators[type].predict(data);
      if (mcPred) predictions.push({ ...mcPred, name: 'monteCarlo', weight: weights.monteCarlo });
    }
  } catch (e) { logger.error(`MonteCarlo error: ${e.message}`); }
  
  // 7. Anomaly Detection
  try {
    const anomaly = anomalyDetector.detectAnomaly(results, sums, 15);
    if (anomaly.isAnomaly && anomaly.breakDirection) {
      predictions.push({
        prediction: anomaly.breakDirection,
        confidence: Math.min(75, 55 + anomaly.score * 0.2),
        name: 'anomaly',
        weight: weights.anomaly
      });
    }
  } catch (e) { logger.error(`Anomaly error: ${e.message}`); }
  
  // 8. Dice Mean Reversion
  try {
    const dicePred = predictDiceMeanReversion(sums);
    if (dicePred) predictions.push({ ...dicePred, name: 'dice', weight: weights.dice });
  } catch (e) { logger.error(`Dice error: ${e.message}`); }
  
  // 9. Time Window Pattern
  try {
    const timePred = anomalyDetector.predictByTimeWindow(currentTime);
    if (timePred) predictions.push({ ...timePred, name: 'time', weight: weights.time });
  } catch (e) { logger.error(`Time error: ${e.message}`); }
  
  // 10. Balance Strategy
  try {
    const balancePred = predictBalance(results);
    if (balancePred) predictions.push({ ...balancePred, name: 'balance', weight: weights.balance });
  } catch (e) { logger.error(`Balance error: ${e.message}`); }
  
  // 11. Simple Pattern
  try {
    const simplePred = predictSimple(results, regime);
    predictions.push({ ...simplePred, name: 'simple', weight: weights.simple });
  } catch (e) { logger.error(`Simple error: ${e.message}`); }
  
  // Weighted ensemble voting
  let taiWeight = 0, xiuWeight = 0, totalWeight = 0;
  let totalConfidence = 0;
  
  for (const pred of predictions) {
    const weight = pred.weight || 0.1;
    totalWeight += weight;
    totalConfidence += pred.confidence * weight;
    
    if (pred.prediction === 'Tài') taiWeight += weight;
    else xiuWeight += weight;
  }
  
  if (totalWeight === 0) {
    return { prediction: 'Tài', confidence: 50, factors: ['Fallback'], methodsUsed: {} };
  }
  
  const finalPrediction = taiWeight > xiuWeight ? 'Tài' : 'Xỉu';
  let finalConfidence = totalConfidence / totalWeight;
  
  // Apply regime-based adjustment
  if (regime.regime === 'trending') finalConfidence += 5;
  if (marketPhase === 'strong_trend') finalConfidence += 3;
  if (marketPhase === 'high_volatility') finalConfidence -= 5;
  
  // Apply bias correction
  finalConfidence += biasCorrection * 20;
  
  // Calibrate confidence
  finalConfidence = anomalyDetector.calibrateConfidence(finalConfidence, 'ensemble');
  finalConfidence = Math.min(CONFIG.MAX_CONFIDENCE, Math.max(CONFIG.MIN_CONFIDENCE, finalConfidence));
  
  // Smooth predictions
  const taiProb = finalPrediction === 'Tài' ? finalConfidence / 100 : 1 - finalConfidence / 100;
  predictionProbBuffer[type].push(taiProb);
  if (predictionProbBuffer[type].length > CONFIG.SMOOTHING_WINDOW) {
    predictionProbBuffer[type].shift();
  }
  const smoothedProb = predictionProbBuffer[type].reduce((a, b) => a + b, 0) / predictionProbBuffer[type].length;
  const smoothedPrediction = smoothedProb > 0.5 ? 'Tài' : 'Xỉu';
  
  // RL Agent decision
  const state = {
    taiWeight, xiuWeight, confidence: finalConfidence,
    regime: regime.regime, marketPhase
  };
  const rlAction = rlAgents[type].chooseAction(state);
  const rlPrediction = rlAction === 0 ? 'Tài' : 'Xỉu';
  
  // Combine with RL
  const finalWithRL = rlPrediction === smoothedPrediction ? smoothedPrediction : 
    (finalConfidence > 65 ? smoothedPrediction : rlPrediction);
  
  const factors = predictions.map(p => `${p.name}:${p.prediction}(${Math.round(p.confidence)}%)`);
  const methodsUsed = Object.fromEntries(predictions.map(p => [p.name, true]));
  
  return {
    prediction: finalWithRL,
    confidence: Math.round(finalConfidence),
    factors: factors.slice(0, 5),
    methodsUsed,
    regime: regime.regime,
    marketPhase,
    predictionsCount: predictions.length
  };
}

// ==================== DATA MANAGEMENT ====================
async function autoProcessPredictions() {
  try {
    const [dataHu, dataMd5] = await Promise.all([
      fetchData(API_URL_HU),
      fetchData(API_URL_MD5)
    ]);
    
    for (const [type, data, apiUrl] of [
      ['hu', dataHu, API_URL_HU],
      ['md5', dataMd5, API_URL_MD5]
    ]) {
      if (!data || data.length === 0) continue;
      
      // Update Monte Carlo simulator
      if (data.length >= 60) {
        monteCarloSimulators[type] = new AdvancedMonteCarlo(data, 60);
      }
      
      // Train models with new data
      const results = data.slice(0, 50).map(d => d.Ket_qua);
      const sums = data.slice(0, 50).map(d => d.Tong);
      const resultsForMarkov = results.map(r => r === 'Tài' ? 'T' : 'X');
      markovChains[type].train(resultsForMarkov);
      
      // Extract features and train neural networks
      const features = extractAdvancedFeatures(results, sums, new Date().getHours(), anomalyDetector.getBiasCorrection());
      const lastResult = results[0] === 'Tài';
      
      neuralNetworks[type].train(features, lastResult);
      attentionModels[type].update(results, sums);
      lstmNetworks[type].train([features], lastResult ? 0 : 1);
      transformerModels[type].train(features, lastResult ? 0 : 1);
      
      // Verify pending predictions
      await verifyPredictions(type, data);
      
      // Make new prediction
      const latestPhien = data[0].Phien;
      const nextPhien = latestPhien + 1;
      
      if (lastProcessedPhien[type] !== nextPhien) {
        const result = calculateSuperPrediction(data, type);
        savePredictionToHistory(type, nextPhien, result.prediction, result.confidence);
        recordPrediction(type, nextPhien, result);
        lastProcessedPhien[type] = nextPhien;
        
        logger.info(`[${type.toUpperCase()} #${nextPhien}] ${result.prediction} (${result.confidence}%) | Regime: ${result.regime} | Methods: ${result.predictionsCount}`);
      }
    }
    
    saveAllData();
  } catch (error) {
    logger.error(`Auto-process error: ${error.message}`);
  }
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  const now = Date.now();
  
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    const predTime = new Date(pred.timestamp).getTime();
    if (now - predTime > 1800000) {
      pred.verified = true;
      pred.isCorrect = false;
      pred.actual = 'TIMEOUT';
      continue;
    }
    
    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult) {
      pred.verified = true;
      pred.actual = actualResult.Ket_qua;
      pred.isCorrect = pred.prediction === pred.actual;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 500) {
        learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-500);
      }
      
      // Update method performance
      if (pred.methodsUsed) {
        for (const method of Object.keys(pred.methodsUsed)) {
          if (learningData[type].methodPerformance[method]) {
            learningData[type].methodPerformance[method].total++;
            if (pred.isCorrect) learningData[type].methodPerformance[method].correct++;
          }
        }
      }
      
      // Update RL agent
      const state = {
        taiWeight: 0.5, xiuWeight: 0.5,
        confidence: pred.confidence / 100,
        regime: 'mixed', marketPhase: 'neutral'
      };
      const action = pred.prediction === 'Tài' ? 0 : 1;
      const reward = pred.isCorrect ? 1 : -1;
      const nextState = { ...state };
      rlAgents[type].update(state, action, reward, nextState);
      
      // Update ensemble weights periodically
      if (learningData[type].totalPredictions % 10 === 0) {
        ensembleOptimizer.updateWeights(learningData[type].methodPerformance);
      }
      
      // Learn from result in anomaly detector
      anomalyDetector.learnFromResult(pred.prediction, pred.actual, pred.confidence);
      anomalyDetector.updateTimeWindowStats(pred.actual, new Date(pred.timestamp));
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
  }
}

function savePredictionToHistory(type, phien, prediction, confidence) {
  const record = {
    phien_hien_tai: phien.toString(),
    du_doan: normalizeResult(prediction),
    ti_le: `${confidence}%`,
    id: 'kapub_v12',
    timestamp: new Date().toISOString(),
    ket_qua_thuc_te: null,
    status: '⏳'
  };
  
  predictionHistory[type].unshift(record);
  if (predictionHistory[type].length > CONFIG.MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, CONFIG.MAX_HISTORY);
  }
  
  return record;
}

function recordPrediction(type, phien, result) {
  const record = {
    phien: phien.toString(),
    prediction: result.prediction,
    confidence: result.confidence,
    factors: result.factors,
    methodsUsed: result.methodsUsed,
    regime: result.regime,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  
  if (learningData[type].predictions.length > 2000) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 2000);
  }
}

function saveAllData() {
  try {
    fs.writeFileSync(FILES.LEARNING, JSON.stringify(learningData, null, 2));
    fs.writeFileSync(FILES.HISTORY, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    }, null, 2));
    fs.writeFileSync(FILES.NEURAL, JSON.stringify({
      hu: neuralNetworks.hu.save(),
      md5: neuralNetworks.md5.save()
    }, null, 2));
    fs.writeFileSync(FILES.ATTENTION, JSON.stringify({
      hu: attentionModels.hu.save(),
      md5: attentionModels.md5.save()
    }, null, 2));
    fs.writeFileSync(FILES.LSTM, JSON.stringify({
      hu: lstmNetworks.hu.save(),
      md5: lstmNetworks.md5.save()
    }, null, 2));
    fs.writeFileSync(FILES.TRANSFORMER, JSON.stringify({
      hu: transformerModels.hu.save(),
      md5: transformerModels.md5.save()
    }, null, 2));
    fs.writeFileSync(FILES.REINFORCEMENT, JSON.stringify({
      hu: rlAgents.hu.save(),
      md5: rlAgents.md5.save()
    }, null, 2));
    
    ensembleOptimizer.save();
    anomalyDetector.save();
    
    logger.debug('All data saved successfully');
  } catch (error) {
    logger.error(`Failed to save data: ${error.message}`);
  }
}

function loadAllData() {
  try {
    if (fs.existsSync(FILES.LEARNING)) {
      const data = JSON.parse(fs.readFileSync(FILES.LEARNING, 'utf8'));
      learningData = { ...learningData, ...data };
    }
    
    if (fs.existsSync(FILES.HISTORY)) {
      const data = JSON.parse(fs.readFileSync(FILES.HISTORY, 'utf8'));
      predictionHistory = data.history || { hu: [], md5: [] };
      lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
    }
    
    if (fs.existsSync(FILES.NEURAL)) {
      const data = JSON.parse(fs.readFileSync(FILES.NEURAL, 'utf8'));
      if (data.hu) neuralNetworks.hu.load(data.hu);
      if (data.md5) neuralNetworks.md5.load(data.md5);
    }
    
    if (fs.existsSync(FILES.ATTENTION)) {
      const data = JSON.parse(fs.readFileSync(FILES.ATTENTION, 'utf8'));
      if (data.hu) attentionModels.hu.load(data.hu);
      if (data.md5) attentionModels.md5.load(data.md5);
    }
    
    if (fs.existsSync(FILES.LSTM)) {
      const data = JSON.parse(fs.readFileSync(FILES.LSTM, 'utf8'));
      if (data.hu) lstmNetworks.hu.load(data.hu);
      if (data.md5) lstmNetworks.md5.load(data.md5);
    }
    
    if (fs.existsSync(FILES.TRANSFORMER)) {
      const data = JSON.parse(fs.readFileSync(FILES.TRANSFORMER, 'utf8'));
      if (data.hu) transformerModels.hu.load(data.hu);
      if (data.md5) transformerModels.md5.load(data.md5);
    }
    
    if (fs.existsSync(FILES.REINFORCEMENT)) {
      const data = JSON.parse(fs.readFileSync(FILES.REINFORCEMENT, 'utf8'));
      if (data.hu) rlAgents.hu.load(data.hu);
      if (data.md5) rlAgents.md5.load(data.md5);
    }
    
    ensembleOptimizer.load();
    anomalyDetector.load();
    
    logger.success('All AI models loaded successfully');
  } catch (error) {
    logger.error(`Failed to load data: ${error.message}`);
  }
}

function cleanupOldData() {
  for (const type of ['hu', 'md5']) {
    if (learningData[type].predictions.length > 2000) {
      learningData[type].predictions = learningData[type].predictions.slice(0, 2000);
    }
    if (learningData[type].recentAccuracy.length > 500) {
      learningData[type].recentAccuracy = learningData[type].recentAccuracy.slice(-500);
    }
    if (predictionHistory[type].length > CONFIG.MAX_HISTORY) {
      predictionHistory[type] = predictionHistory[type].slice(0, CONFIG.MAX_HISTORY);
    }
  }
  saveAllData();
}

function resetAllData() {
  learningData = {
    hu: {
      predictions: [], totalPredictions: 0, correctPredictions: 0,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [],
      methodPerformance: {
        neuralnet: { correct: 0, total: 0 }, attention: { correct: 0, total: 0 },
        lstm: { correct: 0, total: 0 }, transformer: { correct: 0, total: 0 },
        markov: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
        time: { correct: 0, total: 0 }, balance: { correct: 0, total: 0 },
        simple: { correct: 0, total: 0 }
      },
      lastUpdate: null
    },
    md5: {
      predictions: [], totalPredictions: 0, correctPredictions: 0,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      recentAccuracy: [],
      methodPerformance: {
        neuralnet: { correct: 0, total: 0 }, attention: { correct: 0, total: 0 },
        lstm: { correct: 0, total: 0 }, transformer: { correct: 0, total: 0 },
        markov: { correct: 0, total: 0 }, monteCarlo: { correct: 0, total: 0 },
        anomaly: { correct: 0, total: 0 }, dice: { correct: 0, total: 0 },
        time: { correct: 0, total: 0 }, balance: { correct: 0, total: 0 },
        simple: { correct: 0, total: 0 }
      },
      lastUpdate: null
    }
  };
  
  predictionHistory = { hu: [], md5: [] };
  lastProcessedPhien = { hu: null, md5: null };
  predictionProbBuffer = { hu: [], md5: [] };
  
  // Re-initialize AI models
  neuralNetworks = { hu: new EnhancedNeuralNetwork(), md5: new EnhancedNeuralNetwork() };
  attentionModels = { hu: new EnhancedAttentionModel(), md5: new EnhancedAttentionModel() };
  lstmNetworks = { hu: new LSTMNetwork(), md5: new LSTMNetwork() };
  transformerModels = { hu: new TransformerModel(), md5: new TransformerModel() };
  markovChains = { hu: new AdvancedMarkovChain(CONFIG.MARKOV_ORDER), md5: new AdvancedMarkovChain(CONFIG.MARKOV_ORDER) };
  monteCarloSimulators = { hu: null, md5: null };
  anomalyDetector = new EnhancedAnomalyDetector();
  regimeDetectors = { hu: new RegimeDetector(), md5: new RegimeDetector() };
  rlAgents = { hu: new RLAgent(), md5: new RLAgent() };
  ensembleOptimizer = new EnsembleWeightOptimizer();
  
  saveAllData();
  logger.success('All data has been reset');
}

// ==================== EXPRESS ROUTES ====================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('LẨU CUA 79 - AI PREDICTION v12.0 | Advanced AI System');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchData(API_URL_HU);
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Cannot fetch data' });
    }
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateSuperPrediction(data, 'hu');
    
    savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
    recordPrediction('hu', nextPhien, result);
    
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      regime: result.regime,
      id: 'kapub_v12'
    });
  } catch (error) {
    logger.error(`HU prediction error: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchData(API_URL_MD5);
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Cannot fetch data' });
    }
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    const result = calculateSuperPrediction(data, 'md5');
    
    savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
    recordPrediction('md5', nextPhien, result);
    
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      regime: result.regime,
      id: 'kapub_v12'
    });
  } catch (error) {
    logger.error(`MD5 prediction error: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    const data = await fetchData(API_URL_HU);
    if (data && data.length > 0) {
      await verifyPredictions('hu', data);
    }
    
    const historyWithStatus = predictionHistory.hu.map(record => {
      const pred = learningData.hu.predictions.find(p => p.phien === record.phien_hien_tai);
      return {
        ...record,
        ket_qua_thuc_te: pred?.actual || null,
        status: pred?.isCorrect === true ? '✅' : (pred?.isCorrect === false ? '❌' : '⏳')
      };
    });
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: historyWithStatus,
      total: historyWithStatus.length
    });
  } catch (error) {
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: predictionHistory.hu,
      total: predictionHistory.hu.length
    });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    const data = await fetchData(API_URL_MD5);
    if (data && data.length > 0) {
      await verifyPredictions('md5', data);
    }
    
    const historyWithStatus = predictionHistory.md5.map(record => {
      const pred = learningData.md5.predictions.find(p => p.phien === record.phien_hien_tai);
      return {
        ...record,
        ket_qua_thuc_te: pred?.actual || null,
        status: pred?.isCorrect === true ? '✅' : (pred?.isCorrect === false ? '❌' : '⏳')
      };
    });
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: historyWithStatus,
      total: historyWithStatus.length
    });
  } catch (error) {
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: predictionHistory.md5,
      total: predictionHistory.md5.length
    });
  }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchData(API_URL_HU);
    if (!data) {
      return res.status(500).json({ error: 'Cannot fetch data' });
    }
    
    const result = calculateSuperPrediction(data, 'hu');
    const stats = learningData.hu;
    const overallAccuracy = stats.totalPredictions > 0 ? 
      (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
    
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      confidence_level: result.confidence > 70 ? 'HIGH' : (result.confidence > 55 ? 'MEDIUM' : 'LOW'),
      factors: result.factors,
      methods_used: Object.keys(result.methodsUsed),
      regime: result.regime,
      market_phase: result.marketPhase,
      predictions_count: result.predictionsCount,
      overall_accuracy: `${overallAccuracy}%`,
      recommendation: result.confidence > 65 ? 'Consider betting' : 'Wait for better opportunity'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchData(API_URL_MD5);
    if (!data) {
      return res.status(500).json({ error: 'Cannot fetch data' });
    }
    
    const result = calculateSuperPrediction(data, 'md5');
    const stats = learningData.md5;
    const overallAccuracy = stats.totalPredictions > 0 ? 
      (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
    
    res.json({
      prediction: normalizeResult(result.prediction),
      confidence: result.confidence,
      confidence_level: result.confidence > 70 ? 'HIGH' : (result.confidence > 55 ? 'MEDIUM' : 'LOW'),
      factors: result.factors,
      methods_used: Object.keys(result.methodsUsed),
      regime: result.regime,
      market_phase: result.marketPhase,
      predictions_count: result.predictionsCount,
      overall_accuracy: `${overallAccuracy}%`,
      recommendation: result.confidence > 65 ? 'Consider betting' : 'Wait for better opportunity'
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/lc79-hu/stats', (req, res) => {
  const stats = learningData.hu;
  const overallAccuracy = stats.totalPredictions > 0 ? 
    (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? 
    (stats.recentAccuracy.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, stats.recentAccuracy.length) * 100).toFixed(2) : 0;
  
  const methodAccuracies = {};
  for (const [method, perf] of Object.entries(stats.methodPerformance)) {
    if (perf.total > 0) {
      methodAccuracies[method] = {
        accuracy: (perf.correct / perf.total * 100).toFixed(2) + '%',
        total: perf.total,
        correct: perf.correct
      };
    }
  }
  
  const regime = regimeDetectors.hu.detectRegime(stats);
  const weights = ensembleOptimizer.getWeights();
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${overallAccuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    regime,
    methodPerformance: methodAccuracies,
    ensembleWeights: weights,
    rlAgentReward: rlAgents.hu.getAverageReward().toFixed(3),
    lastUpdate: stats.lastUpdate
  });
});

app.get('/lc79-md5/stats', (req, res) => {
  const stats = learningData.md5;
  const overallAccuracy = stats.totalPredictions > 0 ? 
    (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) : 0;
  const recentAcc = stats.recentAccuracy.length > 0 ? 
    (stats.recentAccuracy.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, stats.recentAccuracy.length) * 100).toFixed(2) : 0;
  
  const methodAccuracies = {};
  for (const [method, perf] of Object.entries(stats.methodPerformance)) {
    if (perf.total > 0) {
      methodAccuracies[method] = {
        accuracy: (perf.correct / perf.total * 100).toFixed(2) + '%',
        total: perf.total,
        correct: perf.correct
      };
    }
  }
  
  const regime = regimeDetectors.md5.detectRegime(stats);
  const weights = ensembleOptimizer.getWeights();
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${overallAccuracy}%`,
    recentAccuracy: `${recentAcc}%`,
    streakAnalysis: stats.streakAnalysis,
    regime,
    methodPerformance: methodAccuracies,
    ensembleWeights: weights,
    rlAgentReward: rlAgents.md5.getAverageReward().toFixed(3),
    lastUpdate: stats.lastUpdate
  });
});

app.get('/lc79-hu/models', (req, res) => {
  const weights = ensembleOptimizer.getWeights();
  res.json({
    active_models: Object.keys(weights),
    ensemble_weights: weights,
    neural_network: { input_size: 20, hidden_layers: [24, 16, 8], activation: 'LeakyReLU' },
    attention: { window_size: 30, num_heads: 4 },
    lstm: { hidden_size: 32, num_layers: 2 },
    transformer: { num_heads: 4, num_layers: 2, feed_forward_dim: 64 },
    markov: { order: 3, smoothing: 'Kneser-Ney' },
    monte_carlo: { simulations: 15000, window_size: 60 },
    reinforcement_learning: { epsilon: rlAgents.hu.epsilon.toFixed(3), alpha: 0.1, gamma: 0.95 }
  });
});

app.get('/reset', (req, res) => {
  resetAllData();
  res.json({ message: 'All data and AI models have been reset successfully', version: 'v12.0' });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '12.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    models_loaded: true
  });
});

// ==================== SERVER STARTUP ====================
loadAllData();

// Start auto-processing
setInterval(() => autoProcessPredictions(), CONFIG.AUTO_SAVE_INTERVAL);
setTimeout(() => autoProcessPredictions(), 5000);
setInterval(() => cleanupOldData(), CONFIG.CLEANUP_INTERVAL);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, saving data...');
  saveAllData();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, saving data...');
  saveAllData();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    LẨU CUA 79 - AI PREDICTION v12.0                        ║');
  console.log('║                         ADVANCED AI SYSTEM                                 ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  AI ALGORITHMS:                                                            ║');
  console.log('║    ✅ Enhanced Neural Network (4 layers, LeakyReLU, Dropout)               ║');
  console.log('║    ✅ Multi-Head Attention (4 heads, positional encoding)                  ║');
  console.log('║    ✅ LSTM Network (2 layers, 32 hidden units)                             ║');
  console.log('║    ✅ Transformer Model (4 heads, 2 layers, feed-forward)                  ║');
  console.log('║    ✅ Advanced Markov Chain (order 3, Kneser-Ney smoothing)                ║');
  console.log('║    ✅ Monte Carlo Simulation (15k simulations, 60-window)                  ║');
  console.log('║    ✅ Enhanced Anomaly Detection (entropy, volatility, change point)       ║');
  console.log('║    ✅ Reinforcement Learning Agent (Q-Learning with epsilon decay)         ║');
  console.log('║    ✅ Ensemble Weight Optimizer (dynamic model weighting)                  ║');
  console.log('║    ✅ Regime Detector (trending/volatile/mixed)                            ║');
  console.log('╠════════════════════════════════════════════════════════════════════════════╣');
  console.log('║  ENDPOINTS:                                                                ║');
  console.log('║    GET /lc79-hu              - Prediction for Hũ                           ║');
  console.log('║    GET /lc79-md5             - Prediction for MD5                          ║');
  console.log('║    GET /lc79-hu/lichsu       - Prediction history Hũ                       ║');
  console.log('║    GET /lc79-md5/lichsu      - Prediction history MD5                      ║');
  console.log('║    GET /lc79-hu/analysis     - Detailed analysis Hũ                        ║');
  console.log('║    GET /lc79-md5/analysis    - Detailed analysis MD5                       ║');
  console.log('║    GET /lc79-hu/stats        - Performance statistics Hũ                   ║');
  console.log('║    GET /lc79-md5/stats       - Performance statistics MD5                  ║');
  console.log('║    GET /lc79-hu/models       - Active models and weights                   ║');
  console.log('║    GET /reset                - Reset all data and models                   ║');
  console.log('║    GET /health               - Health check                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(`\n🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Initialized with ${learningData.hu.totalPredictions + learningData.md5.totalPredictions} total predictions\n`);
});
