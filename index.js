const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 5000);

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';

const DATA_DIR = __dirname;
const LEARNING_FILE = path.join(DATA_DIR, 'learning_data.json');
const HISTORY_FILE = path.join(DATA_DIR, 'prediction_history.json');

const LABELS = ['Tài', 'Xỉu'];

const CONFIG = {
  MAX_HISTORY: 300,
  MAX_PREDICTIONS: 1500,
  AUTO_PROCESS_INTERVAL: 15000,
  CLEANUP_INTERVAL: 21600000,
  FETCH_TIMEOUT: 10000,
  PATTERN_WINDOW: 32,
  PATTERN_MIN_MATCHES: 10,
  MIN_ACTION_EDGE: 0.035,
  MIN_ACTION_CONFIDENCE: 54,
  CONFIDENCE_CAP: 67,
  METHOD_PRIOR: 40,
  RECENT_METHOD_WINDOW: 80,
  RECENT_ACCURACY_WINDOW: 20
};

function emptyMethodStats() {
  return {
    simple: { correct: 0, total: 0, recent: [] },
    markov: { correct: 0, total: 0, recent: [] },
    similarity: { correct: 0, total: 0, recent: [] },
    dice: { correct: 0, total: 0, recent: [] },
    timeWindow: { correct: 0, total: 0, recent: [] },
    ensemble: { correct: 0, total: 0, recent: [] }
  };
}

function emptyLearningBucket() {
  return {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    recentAccuracy: [],
    streakAnalysis: {
      wins: 0,
      losses: 0,
      currentStreak: 0,
      bestStreak: 0,
      worstStreak: 0
    },
    methodPerformance: emptyMethodStats(),
    mistakePatterns: {},
    timeWindowStats: {},
    lastUpdate: null
  };
}

let learningData = {
  hu: emptyLearningBucket(),
  md5: emptyLearningBucket()
};

let predictionHistory = { hu: [], md5: [] };
let lastProcessedPhien = { hu: null, md5: null };
let apiCache = { hu: { at: 0, data: null }, md5: { at: 0, data: null } };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values, fallback = 0) {
  if (!values || values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeResult(result) {
  if (result === 'Tài' || result === 'tai' || result === 'TAI') return 'tai';
  if (result === 'Xỉu' || result === 'xiu' || result === 'XIU') return 'xiu';
  return String(result || '').toLowerCase();
}

function denormalizeResult(result) {
  return normalizeResult(result) === 'tai' ? 'Tài' : 'Xỉu';
}

function opposite(result) {
  return result === 'Tài' ? 'Xỉu' : 'Tài';
}

function safeJsonRead(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
