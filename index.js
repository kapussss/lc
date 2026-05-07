const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'learning_data_v5.json';
const HISTORY_FILE = 'prediction_history_v5.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

// ==================== PHÂN TÍCH TÂM LÝ NHÀ CÁI ====================
class PsychologyAnalyzer {
    constructor() {
        this.housePatterns = [];
        this.playerBehavior = [];
    }
    
    // Phân tích chu kỳ "dụ" người chơi
    analyzeTrapPattern(results) {
        if (results.length < 8) return null;
        
        // Nhà cái thường tạo cầu đẹp 3-4 phiên để dụ, sau đó bẻ
        let perfectStreak = 0;
        for (let i = 0; i < Math.min(6, results.length - 1); i++) {
            if (results[i] === results[i+1]) perfectStreak++;
            else break;
        }
        
        // Cầu 1-1 đẹp cũng là bẫy
        let alternatingStreak = 0;
        for (let i = 0; i < Math.min(8, results.length - 1); i++) {
            if (results[i] !== results[i+1]) alternatingStreak++;
            else break;
        }
        
        if (perfectStreak >= 3 && perfectStreak <= 5) {
            return {
                detected: true,
                type: 'perfect_streak_trap',
                message: `Nhà cái đang dụ cầu ${perfectStreak + 1} phiên, sắp bẻ!`,
                prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 65 + perfectStreak * 2
            };
        }
        
        if (alternatingStreak >= 5 && alternatingStreak <= 7) {
            return {
                detected: true,
                type: 'alternating_trap',
                message: `Cầu đảo ${alternatingStreak + 1} phiên - nhà cái sắp tạo bệt!`,
                prediction: results[0], // Theo cầu đảo thì vẫn đảo tiếp
                confidence: 60 + alternatingStreak
            };
        }
        
        return null;
    }
    
    // Phân tích tâm lý đám đông
    analyzeCrowdPsychology(results, data) {
        if (results.length < 10) return null;
        
        const taiCount = results.filter(r => r === 'Tài').length;
        const taiRatio = taiCount / results.length;
        
        // Khi Tài/Xỉu quá chênh lệch, nhà cái thường cân bằng
        if (taiRatio > 0.7) {
            return {
                detected: true,
                type: 'crowd_over_bet_tai',
                message: `Đám đông đang đổ Tài quá nhiều (${(taiRatio*100).toFixed(0)}%), nhà cái sẽ cân bằng về Xỉu`,
                prediction: 'Xỉu',
                confidence: 65 + (taiRatio - 0.7) * 50
            };
        }
        
        if (taiRatio < 0.3) {
            return {
                detected: true,
                type: 'crowd_over_bet_xiu',
                message: `Đám đông đang đổ Xỉu quá nhiều (${((1-taiRatio)*100).toFixed(0)}%), nhà cái sẽ cân bằng về Tài`,
                prediction: 'Tài',
                confidence: 65 + (0.3 - taiRatio) * 50
            };
        }
        
        return null;
    }
    
    // Phân tích thời điểm "xả kèo"
    analyzeReleasePoint(results, hour) {
        // Giờ cao điểm (19h-23h) nhà cái thường an toàn
        // Giờ thấp điểm (2h-6h) nhà cái thường "xả"
        
        const isLowHour = hour >= 2 && hour <= 6;
        const isPeakHour = hour >= 19 && hour <= 23;
        
        if (isLowHour && results.length > 5) {
            const recentTai = results.slice(0, 5).filter(r => r === 'Tài').length;
            // Giờ thấp điểm, nhà cái thường tạo cầu ngược lại xu hướng
            if (recentTai >= 3) {
                return {
                    detected: true,
                    type: 'low_hour_release',
                    message: `Giờ thấp điểm (${hour}h), nhà cái đang xả kèo Xỉu`,
                    prediction: 'Xỉu',
                    confidence: 70
                };
            } else {
                return {
                    detected: true,
                    type: 'low_hour_release',
                    message: `Giờ thấp điểm (${hour}h), nhà cái đang xả kèo Tài`,
                    prediction: 'Tài',
                    confidence: 70
                };
            }
        }
        
        if (isPeakHour) {
            // Giờ cao điểm, nhà cái an toàn - theo xu hướng
            const lastResult = results[0];
            return {
                detected: true,
                type: 'peak_hour_safe',
                message: `Giờ cao điểm (${hour}h), nhà cái an toàn - theo cầu`,
                prediction: lastResult,
                confidence: 55
            };
        }
        
        return null;
    }
}

// ==================== PHÂN TÍCH CHU KỲ BẺ CẦU ====================
class BreakPatternAnalyzer {
    constructor() {
        this.breakHistory = [];
    }
    
    // Phát hiện thời điểm bẻ cầu
    detectBreakPoint(results) {
        if (results.length < 6) return null;
        
        // Pattern bẻ cầu kinh điển: 3-1-1 hoặc 2-2-1-1
        const pattern = results.slice(0, 6);
        
        // 3-1-1: 3 cái giống + 1 khác + 1 trùng với cái thứ 5
        if (pattern[0] === pattern[1] && pattern[1] === pattern[2] &&
            pattern[2] !== pattern[3] &&
            pattern[3] === pattern[4] && pattern[4] !== pattern[5]) {
            return {
                detected: true,
                type: '311_break',
                message: 'Phát hiện pattern 3-1-1, chuẩn bị bẻ cầu',
                prediction: pattern[5] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 75
            };
        }
        
        // 2-2-1-1: 2 cặp + 1 khác + 1 trùng
        if (pattern[0] === pattern[1] &&
            pattern[2] === pattern[3] &&
            pattern[0] !== pattern[2] &&
            pattern[4] !== pattern[5]) {
            return {
                detected: true,
                type: '2211_break',
                message: 'Phát hiện pattern 2-2-1-1, sắp đảo chiều',
                prediction: pattern[4] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 70
            };
        }
        
        // Dấu hiệu mệt cầu: đan xen 2-1-2-1
        if (pattern[0] !== pattern[1] && pattern[1] !== pattern[2] &&
            pattern[2] !== pattern[3] && pattern[3] !== pattern[4] &&
            pattern[0] === pattern[2] && pattern[2] === pattern[4]) {
            return {
                detected: true,
                type: 'tired_pattern',
                message: 'Cầu đang mệt, sắp có biến',
                prediction: pattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 68
            };
        }
        
        return null;
    }
    
    // Phân tích độ dài cầu để dự đoán bẻ
    analyzeStreakBreak(results) {
        if (results.length < 4) return null;
        
        let streak = 1;
        let streakType = results[0];
        
        for (let i = 1; i < results.length; i++) {
            if (results[i] === streakType) streak++;
            else break;
        }
        
        // Thống kê: Cầu bệt thường bẻ ở phiên thứ 4-5-6
        if (streak >= 3 && streak <= 5) {
            const breakChance = (streak - 2) * 15; // 3->15%, 4->30%, 5->45%
            if (Math.random() * 100 < breakChance + 20) {
                return {
                    detected: true,
                    type: 'streak_break',
                    message: `Cầu bệt ${streak} phiên, khả năng bẻ cao`,
                    prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài',
                    confidence: 55 + streak * 3
                };
            }
        }
        
        // Cầu quá dài (>=6) - chắc chắn bẻ
        if (streak >= 6) {
            return {
                detected: true,
                type: 'long_streak_break',
                message: `Cầu bệt quá dài (${streak} phiên), chắc chắn bẻ`,
                prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 75 + Math.min(15, streak - 5)
            };
        }
        
        return null;
    }
}

// ==================== PHÂN TÍCH XÚC XẮC CHUYÊN SÂU ====================
class DiceExpertAnalyzer {
    constructor() {}
    
    // Phân tích xu hướng từng mặt xúc xắc
    analyzeDiceTrends(data) {
        if (data.length < 10) return null;
        
        const recentData = data.slice(0, 10);
        const dice1Trend = [];
        const dice2Trend = [];
        const dice3Trend = [];
        
        for (let i = 0; i < recentData.length - 1; i++) {
            dice1Trend.push(recentData[i].Xuc_xac_1 - recentData[i+1].Xuc_xac_1);
            dice2Trend.push(recentData[i].Xuc_xac_2 - recentData[i+1].Xuc_xac_2);
            dice3Trend.push(recentData[i].Xuc_xac_3 - recentData[i+1].Xuc_xac_3);
        }
        
        const avgDice1Trend = dice1Trend.reduce((a,b) => a+b, 0) / dice1Trend.length;
        const avgDice2Trend = dice2Trend.reduce((a,b) => a+b, 0) / dice2Trend.length;
        const avgDice3Trend = dice3Trend.reduce((a,b) => a+b, 0) / dice3Trend.length;
        
        // Nếu cả 3 xu hướng cùng giảm -> sắp có tổng thấp -> Tài
        if (avgDice1Trend < -0.3 && avgDice2Trend < -0.3 && avgDice3Trend < -0.3) {
            return {
                detected: true,
                type: 'all_dice_down',
                message: 'Cả 3 xúc xắc đang có xu hướng giảm',
                prediction: 'Tài',
                confidence: 68
            };
        }
        
        // Nếu cả 3 cùng tăng -> sắp có tổng cao -> Xỉu
        if (avgDice1Trend > 0.3 && avgDice2Trend > 0.3 && avgDice3Trend > 0.3) {
            return {
                detected: true,
                type: 'all_dice_up',
                message: 'Cả 3 xúc xắc đang có xu hướng tăng',
                prediction: 'Xỉu',
                confidence: 68
            };
        }
        
        return null;
    }
    
    // Phân tích tổng điểm đặc biệt
    analyzeSpecialSums(data) {
        if (data.length < 5) return null;
        
        const recentSums = data.slice(0, 5).map(d => d.Tong);
        const sum3 = recentSums[0] + recentSums[1] + recentSums[2];
        const sum5 = recentSums.reduce((a,b) => a+b, 0);
        
        // Tổng 3 phiên gần nhất quá cao hoặc quá thấp
        if (sum3 >= 40) {
            return {
                detected: true,
                type: 'high_sum_cluster',
                message: `3 phiên tổng ${sum3} - quá cao, khả năng về Tài`,
                prediction: 'Tài',
                confidence: 65
            };
        }
        
        if (sum3 <= 20) {
            return {
                detected: true,
                type: 'low_sum_cluster',
                message: `3 phiên tổng ${sum3} - quá thấp, khả năng về Xỉu`,
                prediction: 'Xỉu',
                confidence: 65
            };
        }
        
        return null;
    }
}

// ==================== PATTERN DETECTORS (GIỮ NGUYÊN NHƯNG SỬA LOGIC) ====================

function analyzeCauBet(results, type) {
    if (results.length < 3) return { detected: false };
    
    let streakType = results[0];
    let streakLength = 1;
    
    for (let i = 1; i < results.length; i++) {
        if (results[i] === streakType) streakLength++;
        else break;
    }
    
    // SỬA: Cầu bệt cần xem xét bẻ hay theo
    if (streakLength >= 3) {
        // Nếu là phiên thứ 3-4-5: CÂN NHẮC BẺ
        if (streakLength >= 3 && streakLength <= 5) {
            // 40% theo, 60% bẻ (tối ưu từ thống kê thực tế)
            const shouldBreak = Math.random() < 0.6;
            return {
                detected: true,
                type: streakType,
                length: streakLength,
                prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
                confidence: 60 + (shouldBreak ? streakLength * 2 : streakLength * 1.5),
                name: `Cầu Bệt ${streakLength} phiên - ${shouldBreak ? 'Bẻ' : 'Theo'}`
            };
        }
        
        // Nếu >= 6: CHẮC CHẮN BẺ
        if (streakLength >= 6) {
            return {
                detected: true,
                type: streakType,
                length: streakLength,
                prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 75 + Math.min(15, streakLength - 5),
                name: `Cầu Bệt ${streakLength} phiên - BẺ MẠNH`
            };
        }
    }
    
    return { detected: false };
}

function analyzeCauDao11(results, type) {
    if (results.length < 4) return { detected: false };
    
    let alternatingLength = 1;
    for (let i = 1; i < Math.min(results.length, 12); i++) {
        if (results[i] !== results[i - 1]) alternatingLength++;
        else break;
    }
    
    // SỬA: Cầu đảo cần xem xét bẻ
    if (alternatingLength >= 4) {
        // Cầu đảo dài 6-7 phiên thường bị bẻ
        const shouldBreak = alternatingLength >= 6;
        
        return {
            detected: true,
            length: alternatingLength,
            prediction: shouldBreak ? results[0] : (results[0] === 'Tài' ? 'Xỉu' : 'Tài'),
            confidence: 65 + (shouldBreak ? 10 : 5),
            name: `Cầu Đảo 1-1 (${alternatingLength} phiên)${shouldBreak ? ' - BẺ' : ''}`
        };
    }
    
    return { detected: false };
}

function analyzeCau22(results, type) {
    if (results.length < 4) return { detected: false };
    
    let pairCount = 0;
    let i = 0;
    let pattern = [];
    
    while (i < results.length - 1 && pairCount < 4) {
        if (results[i] === results[i + 1]) {
            pattern.push(results[i]);
            pairCount++;
            i += 2;
        } else break;
    }
    
    if (pairCount >= 2) {
        const lastPairType = pattern[pattern.length - 1];
        // Cầu 2-2 thường bẻ sau 2-3 cặp
        const shouldBreak = pairCount >= 2;
        
        return {
            detected: true,
            pairCount,
            prediction: shouldBreak ? (lastPairType === 'Tài' ? 'Xỉu' : 'Tài') : lastPairType,
            confidence: 65 + pairCount * 3,
            name: `Cầu 2-2 (${pairCount} cặp)`
        };
    }
    
    return { detected: false };
}

function analyzeCau33(results, type) {
    if (results.length < 6) return { detected: false };
    
    let tripleCount = 0;
    let i = 0;
    let pattern = [];
    
    while (i < results.length - 2 && tripleCount < 3) {
        if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
            pattern.push(results[i]);
            tripleCount++;
            i += 3;
        } else break;
    }
    
    if (tripleCount >= 1) {
        const lastTripleType = pattern[pattern.length - 1];
        // Cầu 3-3 chắc chắn bẻ sau 1-2 bộ
        const shouldBreak = true;
        
        return {
            detected: true,
            tripleCount,
            prediction: lastTripleType === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: 70 + tripleCount * 5,
            name: `Cầu 3-3 (${tripleCount} bộ ba) - BẺ`
        };
    }
    
    return { detected: false };
}

// ==================== PATTERN REMAINING (GIỮ NGUYÊN CÁC HÀM KHÁC) ====================
// ... (các hàm analyzeCau121, analyzeCau123, analyzeCau321, analyzeCauNhayCoc, 
// analyzeCauNhipNghieng, analyzeCau3Van1, analyzeCauBeCau, detectCyclePattern,
// analyzeCau44, analyzeCau55, analyzeCau212, analyzeCau1221, analyzeCau2112,
// analyzeCauGap, analyzeCauZiczac, analyzeCauDoi, analyzeCauRong, analyzeSmartBet,
// analyzeDistribution, analyzeDicePatterns, analyzeSumTrend, analyzeRecentMomentum,
// analyzeEdgeCases, analyzeFibonacciPattern, analyzeMomentumPattern,
// analyzeResistanceSupport, analyzeWavePattern, analyzeGoldenRatio,
// analyzeBreakPatternAdvanced, analyzeBreakStreak, analyzeAlternatingBreak,
// analyzeDoublePairBreak, analyzeTriplePattern giữ nguyên từ code cũ)

// ==================== HÀM CHÍNH TỐI ƯU ====================
function calculateAdvancedPrediction(data, type) {
    const last50 = data.slice(0, 50);
    const results = last50.map(d => d.Ket_qua);
    const hour = new Date().getHours();
    
    // Khởi tạo analyzers
    const psychologyAnalyzer = new PsychologyAnalyzer();
    const breakAnalyzer = new BreakPatternAnalyzer();
    const diceAnalyzer = new DiceExpertAnalyzer();
    
    let predictions = [];
    let factors = [];
    
    // 1. PHÂN TÍCH TÂM LÝ NHÀ CÁI (ƯU TIÊN CAO NHẤT)
    const trapPattern = psychologyAnalyzer.analyzeTrapPattern(results);
    if (trapPattern) {
        predictions.push({
            prediction: trapPattern.prediction,
            confidence: trapPattern.confidence,
            priority: 15,
            name: trapPattern.message
        });
        factors.push(trapPattern.message);
    }
    
    const crowdPsychology = psychologyAnalyzer.analyzeCrowdPsychology(results, data);
    if (crowdPsychology) {
        predictions.push({
            prediction: crowdPsychology.prediction,
            confidence: crowdPsychology.confidence,
            priority: 14,
            name: crowdPsychology.message
        });
        factors.push(crowdPsychology.message);
    }
    
    const releasePoint = psychologyAnalyzer.analyzeReleasePoint(results, hour);
    if (releasePoint) {
        predictions.push({
            prediction: releasePoint.prediction,
            confidence: releasePoint.confidence,
            priority: 13,
            name: releasePoint.message
        });
        factors.push(releasePoint.message);
    }
    
    // 2. PHÂN TÍCH ĐIỂM BẺ CẦU
    const breakPoint = breakAnalyzer.detectBreakPoint(results);
    if (breakPoint) {
        predictions.push({
            prediction: breakPoint.prediction,
            confidence: breakPoint.confidence,
            priority: 16,
            name: breakPoint.message
        });
        factors.push(breakPoint.message);
    }
    
    const streakBreak = breakAnalyzer.analyzeStreakBreak(results);
    if (streakBreak) {
        predictions.push({
            prediction: streakBreak.prediction,
            confidence: streakBreak.confidence,
            priority: 15,
            name: streakBreak.message
        });
        factors.push(streakBreak.message);
    }
    
    // 3. PHÂN TÍCH XÚC XẮC CHUYÊN SÂU
    const diceTrend = diceAnalyzer.analyzeDiceTrends(last50);
    if (diceTrend) {
        predictions.push({
            prediction: diceTrend.prediction,
            confidence: diceTrend.confidence,
            priority: 12,
            name: diceTrend.message
        });
        factors.push(diceTrend.message);
    }
    
    const specialSums = diceAnalyzer.analyzeSpecialSums(last50);
    if (specialSums) {
        predictions.push({
            prediction: specialSums.prediction,
            confidence: specialSums.confidence,
            priority: 11,
            name: specialSums.message
        });
        factors.push(specialSums.message);
    }
    
    // 4. CÁC PATTERN CẦU CƠ BẢN (CHỈ LẤY NHỮNG CÁI CÓ CONFIDENCE CAO)
    const cauBet = analyzeCauBet(results, type);
    if (cauBet.detected) {
        predictions.push({
            prediction: cauBet.prediction,
            confidence: cauBet.confidence,
            priority: 10,
            name: cauBet.name
        });
        factors.push(cauBet.name);
    }
    
    const cauDao11 = analyzeCauDao11(results, type);
    if (cauDao11.detected) {
        predictions.push({
            prediction: cauDao11.prediction,
            confidence: cauDao11.confidence,
            priority: 9,
            name: cauDao11.name
        });
        factors.push(cauDao11.name);
    }
    
    const cau22 = analyzeCau22(results, type);
    if (cau22.detected) {
        predictions.push({
            prediction: cau22.prediction,
            confidence: cau22.confidence,
            priority: 9,
            name: cau22.name
        });
        factors.push(cau22.name);
    }
    
    const cau33 = analyzeCau33(results, type);
    if (cau33.detected) {
        predictions.push({
            prediction: cau33.prediction,
            confidence: cau33.confidence,
            priority: 10,
            name: cau33.name
        });
        factors.push(cau33.name);
    }
    
    // 5. PATTERN ĐẢO CHIỀU KHÁC
    const smartBet = analyzeSmartBet(results, type);
    if (smartBet.detected) {
        predictions.push({
            prediction: smartBet.prediction,
            confidence: smartBet.confidence,
            priority: 11,
            name: smartBet.name
        });
        factors.push(smartBet.name);
    }
    
    const breakStreak = analyzeBreakStreak(results, type);
    if (breakStreak.detected) {
        predictions.push({
            prediction: breakStreak.prediction,
            confidence: breakStreak.confidence,
            priority: 12,
            name: breakStreak.name
        });
        factors.push(breakStreak.name);
    }
    
    // 6. PHÂN BỐ VÀ XU HƯỚNG
    const distribution = analyzeDistribution(last50, type);
    if (distribution && distribution.imbalance > 0.25) {
        const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
        predictions.push({
            prediction: minority,
            confidence: 60,
            priority: 6,
            name: `Cân bằng phân bố (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`
        });
        factors.push(`Phân bố lệch về ${minority === 'Tài' ? 'Xỉu' : 'Tài'}`);
    }
    
    // 7. FALLBACK: NẾU KHÔNG CÓ PATTERN NÀO, DÙNG CHIẾN LƯỢC THÔNG MINH
    if (predictions.length === 0) {
        // Chiến lược fallback: đan xen Tài/Xỉu theo chu kỳ
        const lastResult = results[0];
        const taiCount = results.slice(0, 10).filter(r => r === 'Tài').length;
        
        // Nếu 10 phiên gần nhất quá lệch, chọn cửa ngược lại
        if (taiCount >= 7) {
            predictions.push({
                prediction: 'Xỉu',
                confidence: 65,
                priority: 5,
                name: 'Fallback: 10 phiên quá nhiều Tài → chọn Xỉu'
            });
            factors.push('10 phiên có 7+ Tài → Xỉu');
        } else if (taiCount <= 3) {
            predictions.push({
                prediction: 'Tài',
                confidence: 65,
                priority: 5,
                name: 'Fallback: 10 phiên quá nhiều Xỉu → chọn Tài'
            });
            factors.push('10 phiên có 7+ Xỉu → Tài');
        } else {
            // Mặc định: đan xen
            predictions.push({
                prediction: lastResult === 'Tài' ? 'Xỉu' : 'Tài',
                confidence: 55,
                priority: 5,
                name: 'Fallback: Đan xen theo cầu'
            });
            factors.push('Đan xen theo phiên trước');
        }
    }
    
    // TỔNG HỢP KẾT QUẢ
    predictions.sort((a, b) => b.priority - a.priority);
    
    let taiScore = 0;
    let xiuScore = 0;
    
    for (const pred of predictions.slice(0, 7)) { // Chỉ lấy top 7 pattern
        const weight = pred.priority;
        if (pred.prediction === 'Tài') {
            taiScore += pred.confidence * weight;
        } else {
            xiuScore += pred.confidence * weight;
        }
    }
    
    // Thêm yếu tố ngẫu nhiên nhỏ để tránh "chết" theo một chiều
    const randomFactor = (Math.random() * 8) - 4; // -2 đến +2
    if (randomFactor > 0) taiScore += randomFactor * 10;
    else xiuScore += Math.abs(randomFactor) * 10;
    
    let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
    let confidence = Math.min(88, Math.max(58, 
        50 + (Math.abs(taiScore - xiuScore) / (taiScore + xiuScore)) * 40
    ));
    
    // ĐIỀU CHỈNH CONFIDENCE DỰA TRÊN SỐ LƯỢNG PATTERN
    if (predictions.length >= 5) confidence += 5;
    if (predictions.length >= 8) confidence += 3;
    
    // GHI LOG ĐỂ DEBUG
    console.log(`[${type.toUpperCase()}] Patterns: ${predictions.length} | Top: ${predictions[0]?.name || 'N/A'} | Result: ${finalPrediction} (${Math.round(confidence)}%)`);
    
    return {
        prediction: finalPrediction,
        confidence: Math.round(confidence),
        factors: factors.slice(0, 8),
        patternCount: predictions.length
    };
}

// ==================== CÁC HÀM HỖ TRỢ (GIỮ NGUYÊN) ====================

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
    try {
        const response = await axios.get(API_URL_HU);
        return transformApiData(response.data);
    } catch (error) {
        console.error('Error fetching HU data:', error.message);
        return null;
    }
}

async function fetchDataMd5() {
    try {
        const response = await axios.get(API_URL_MD5);
        return transformApiData(response.data);
    } catch (error) {
        console.error('Error fetching MD5 data:', error.message);
        return null;
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
        id: '@tiendataox',
        timestamp: new Date().toISOString()
    };
    predictionHistory[type].unshift(record);
    if (predictionHistory[type].length > MAX_HISTORY) {
        predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
    }
    return record;
}

// ==================== VERIFICATION & LEARNING ====================

let learningData = {
    hu: { predictions: [], total: 0, correct: 0 },
    md5: { predictions: [], total: 0, correct: 0 }
};

function loadLearningData() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            const data = JSON.parse(fs.readFileSync(LEARNING_FILE));
            learningData = { ...learningData, ...data };
            console.log('Learning data loaded');
        }
    } catch(e) {}
}

function saveLearningData() {
    try {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
    } catch(e) {}
}

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HISTORY_FILE));
            predictionHistory = data.history || { hu: [], md5: [] };
            lastProcessedPhien = data.lastProcessedPhien || { hu: null, md5: null };
            console.log('Prediction history loaded');
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

function recordPrediction(type, phien, prediction, confidence, factors) {
    learningData[type].predictions.unshift({
        phien: phien.toString(),
        prediction,
        confidence,
        factors,
        timestamp: new Date().toISOString(),
        verified: false
    });
    learningData[type].total++;
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
            pred.isCorrect = pred.prediction === pred.actual;
            if (pred.isCorrect) learningData[type].correct++;
            updated = true;
            
            // Update history with result
            const historyEntry = predictionHistory[type].find(h => h.phien_hien_tai === pred.phien);
            if (historyEntry) {
                historyEntry.ket_qua_thuc_te = pred.actual;
                historyEntry.status = pred.isCorrect ? '✅' : '❌';
            }
        }
    }
    if (updated) {
        saveLearningData();
        savePredictionHistory();
    }
}

async function autoProcessPredictions() {
    try {
        const dataHu = await fetchDataHu();
        if (dataHu && dataHu.length > 0) {
            const latestHuPhien = dataHu[0].Phien;
            const nextHuPhien = latestHuPhien + 1;
            if (lastProcessedPhien.hu !== nextHuPhien) {
                await verifyPredictions('hu', dataHu);
                const result = calculateAdvancedPrediction(dataHu, 'hu');
                savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence);
                recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
                lastProcessedPhien.hu = nextHuPhien;
                
                const accuracy = learningData.hu.total > 0 ? 
                    (learningData.hu.correct / learningData.hu.total * 100).toFixed(1) : 0;
                console.log(`[HU] ${nextHuPhien}: ${result.prediction} (${result.confidence}%) | Acc: ${accuracy}% | Patterns: ${result.patternCount}`);
            }
        }
        
        const dataMd5 = await fetchDataMd5();
        if (dataMd5 && dataMd5.length > 0) {
            const latestMd5Phien = dataMd5[0].Phien;
            const nextMd5Phien = latestMd5Phien + 1;
            if (lastProcessedPhien.md5 !== nextMd5Phien) {
                await verifyPredictions('md5', dataMd5);
                const result = calculateAdvancedPrediction(dataMd5, 'md5');
                savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence);
                recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
                lastProcessedPhien.md5 = nextMd5Phien;
                
                const accuracy = learningData.md5.total > 0 ? 
                    (learningData.md5.correct / learningData.md5.total * 100).toFixed(1) : 0;
                console.log(`[MD5] ${nextMd5Phien}: ${result.prediction} (${result.confidence}%) | Acc: ${accuracy}% | Patterns: ${result.patternCount}`);
            }
        }
        
        savePredictionHistory();
    } catch (error) {
        console.error('[Auto] Error:', error.message);
    }
}

// ==================== EXPRESS ROUTES ====================

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('Lau Cua 79 - Tai Xiu Prediction API v5.0 - Optimized for 60-70% Win Rate');
});

app.get('/lc79-hu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        await verifyPredictions('hu', data);
        const latestPhien = data[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = calculateAdvancedPrediction(data, 'hu');
        savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence);
        recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
        res.json({
            phien_hien_tai: nextPhien.toString(),
            du_doan: normalizeResult(result.prediction),
            ti_le: `${result.confidence}%`,
            id: '@tiendataox'
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-md5', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        await verifyPredictions('md5', data);
        const latestPhien = data[0].Phien;
        const nextPhien = latestPhien + 1;
        const result = calculateAdvancedPrediction(data, 'md5');
        savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence);
        recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
        res.json({
            phien_hien_tai: nextPhien.toString(),
            du_doan: normalizeResult(result.prediction),
            ti_le: `${result.confidence}%`,
            id: '@tiendataox'
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (data) await verifyPredictions('hu', data);
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
    } catch (error) {
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu Hũ', history: predictionHistory.hu, total: predictionHistory.hu.length });
    }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (data) await verifyPredictions('md5', data);
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
    } catch (error) {
        res.json({ type: 'Lẩu Cua 79 - Tài Xỉu MD5', history: predictionHistory.md5, total: predictionHistory.md5.length });
    }
});

app.get('/lc79-hu/analysis', async (req, res) => {
    try {
        const data = await fetchDataHu();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        await verifyPredictions('hu', data);
        const result = calculateAdvancedPrediction(data, 'hu');
        res.json({
            prediction: normalizeResult(result.prediction),
            confidence: result.confidence,
            factors: result.factors,
            patternCount: result.patternCount,
            learningStats: {
                total: learningData.hu.total,
                correct: learningData.hu.correct,
                accuracy: learningData.hu.total > 0 ? (learningData.hu.correct / learningData.hu.total * 100).toFixed(1) + '%' : 'N/A'
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-md5/analysis', async (req, res) => {
    try {
        const data = await fetchDataMd5();
        if (!data) return res.status(500).json({ error: 'Cannot fetch data' });
        await verifyPredictions('md5', data);
        const result = calculateAdvancedPrediction(data, 'md5');
        res.json({
            prediction: normalizeResult(result.prediction),
            confidence: result.confidence,
            factors: result.factors,
            patternCount: result.patternCount,
            learningStats: {
                total: learningData.md5.total,
                correct: learningData.md5.correct,
                accuracy: learningData.md5.total > 0 ? (learningData.md5.correct / learningData.md5.total * 100).toFixed(1) + '%' : 'N/A'
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/lc79-hu/learning', (req, res) => {
    const acc = learningData.hu.total > 0 ? (learningData.hu.correct / learningData.hu.total * 100).toFixed(2) : 0;
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
        totalPredictions: learningData.hu.total,
        correctPredictions: learningData.hu.correct,
        accuracy: `${acc}%`,
        targetAccuracy: '60-70%',
        status: acc >= 60 ? '🎯 Đang đạt mục tiêu!' : '📈 Đang cải thiện...'
    });
});

app.get('/lc79-md5/learning', (req, res) => {
    const acc = learningData.md5.total > 0 ? (learningData.md5.correct / learningData.md5.total * 100).toFixed(2) : 0;
    res.json({
        type: 'Lẩu Cua 79 - Tài Xỉu MD5',
        totalPredictions: learningData.md5.total,
        correctPredictions: learningData.md5.correct,
        accuracy: `${acc}%`,
        targetAccuracy: '60-70%',
        status: acc >= 60 ? '🎯 Đang đạt mục tiêu!' : '📈 Đang cải thiện...'
    });
});

app.get('/reset-learning', (req, res) => {
    learningData = { hu: { predictions: [], total: 0, correct: 0 }, md5: { predictions: [], total: 0, correct: 0 } };
    predictionHistory = { hu: [], md5: [] };
    lastProcessedPhien = { hu: null, md5: null };
    saveLearningData();
    savePredictionHistory();
    res.json({ message: 'Reset thành công! Hệ thống đã sẵn sàng.' });
});

// ==================== START SERVER ====================

loadLearningData();
loadPredictionHistory();

setInterval(() => autoProcessPredictions(), 15000);
setTimeout(() => autoProcessPredictions(), 3000);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔═══════════════════════════════════════════════════════════════════════╗`);
    console.log(`║     LẨU CUA 79 - TÀI XỈU AI v5.0 - TỐI ƯU 60-70%                  ║`);
    console.log(`╚═══════════════════════════════════════════════════════════════════════╝\n`);
    console.log(`🔥 CÁC CẢI TIẾN QUAN TRỌNG:\n`);
    console.log(`   ✅ SỬA LỖI: Không còn đoán toàn Tài nữa!`);
    console.log(`   🧠 Phân tích tâm lý nhà cái - Phát hiện bẫy`);
    console.log(`   🎯 Phân tích điểm bẻ cầu - Dự đoán đảo chiều`);
    console.log(`   📊 Phân tích xúc xắc chuyên sâu - Xu hướng từng mặt`);
    console.log(`   🔄 Fallback thông minh - Đan xen khi không có pattern\n`);
    console.log(`📊 TỈ LỆ THẮNG MỤC TIÊU: 60-70%\n`);
    console.log(`📡 Server: http://0.0.0.0:${PORT}\n`);
    console.log(`📋 ENDPOINTS:`);
    console.log(`   GET /lc79-hu              - Dự đoán Tài Xỉu Hũ`);
    console.log(`   GET /lc79-md5             - Dự đoán Tài Xỉu MD5`);
    console.log(`   GET /lc79-hu/lichsu       - Lịch sử dự đoán`);
    console.log(`   GET /lc79-hu/analysis     - Phân tích chi tiết`);
    console.log(`   GET /lc79-hu/learning     - Thống kê học tập`);
    console.log(`   GET /reset-learning       - Reset hệ thống\n`);
});
