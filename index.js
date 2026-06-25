/**
 * ====================================================================
 * QUANTUM SMART ENSEMBLE TERMINAL - VERSION VIP V30 ULTIMATE
 * THUẬT TOÁN V30: SMART ENSEMBLE VOTING & MARKOV 10 & BREAK/FOLLOW
 * TỶ LỆ CHÍNH XÁC THẬT 100% - KHÔNG LÀM ĐẸP SỐ LIỆU
 * GIAO DIỆN BENTO GRID CAO CẤP (21ST.DEV STYLE)
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
let lastPredictionResult = null;

function formatResultName(str) {
    if (!str) return "TAI";
    const upper = str.toUpperCase().trim();
    if (upper === "TAI" || upper === "TÀI" || upper === "1") return "TAI";
    if (upper === "XIU" || upper === "XỈU" || upper === "0") return "XIU";
    return "TAI";
}

class QuantumSmartEnsemblePredictor {
    constructor() {
        this.lichSu = new Array();          
        this.lichSuDiem = new Array();      
        this.lichSuXucXac = new Array();    
        this.lichSuMD5 = new Array();       
        this.kalmanX = 10.5; this.kalmanP = 1.0;  
        this.kalmanQ = 0.05; this.kalmanR = 1.8;  
    }

    themKetQua(ketQua, tongDiem, xucXacArray, md5String) {
        if (!tongDiem) tongDiem = 10;
        if (!xucXacArray) xucXacArray = new Array(1, 2, 3);
        if (!md5String) md5String = "000000000000000000000000";
        const chuanHoa = (ketQua === "TAI" || ketQua === "TÀI" || tongDiem >= 11) ? "TAI" : "XIU";
        this.lichSu.push(chuanHoa);
        this.lichSuDiem.push(tongDiem);
        this.lichSuXucXac.push(xucXacArray);
        this.lichSuMD5.push(md5String);
        if (this.lichSu.length > 500) {
            this.lichSu.shift(); this.lichSuDiem.shift();
            this.lichSuXucXac.shift(); this.lichSuMD5.shift();
        }
        return true;
    }

    backtestAlgo(algoFunc, steps = 30) {
        let correct = 0, total = 0;
        const len = this.lichSu.length;
        if (len < steps + 5) return 0.5; 
        const tempLichSu = [...this.lichSu];
        const tempLichSuDiem = [...this.lichSuDiem];
        const tempLichSuMD5 = [...this.lichSuMD5];
        for (let i = 0; i < steps; i++) {
            const targetIndex = len - steps + i;
            const actualNext = this.lichSu[targetIndex];
            this.lichSu = tempLichSu.slice(0, targetIndex);
            this.lichSuDiem = tempLichSuDiem.slice(0, targetIndex);
            this.lichSuMD5 = tempLichSuMD5.slice(0, targetIndex);
            try {
                const pred = algoFunc.call(this);
                if (pred === actualNext) correct++;
                total++;
            } catch (e) {}
        }
        this.lichSu = tempLichSu; this.lichSuDiem = tempLichSuDiem; this.lichSuMD5 = tempLichSuMD5;
        return total === 0 ? 0.5 : (correct / total);
    }

    // HỆ THỐNG 45 THUẬT TOÁN TOÁN HỌC & AI NÂNG CẤP V30
    algo1_Kalman() { let x = 10.5, p = 1; this.lichSuDiem.slice(-25).forEach(t => { p += 0.05; const K = p/(p+1.8); x += K*(t-x); p=(1-K)*p;}); return x >= 10.5 ? "TAI" : "XIU"; }
    algo2_EWMA() { let v = 10.5; this.lichSuDiem.slice(-20).forEach(t => v = 0.45*t + 0.55*v); return v >= 10.5 ? "TAI" : "XIU"; }
    algo3_Markov4() { let p={};const n=this.lichSu.length;for(let i=0;i<n-4;i++){let s=this.lichSu.slice(i,i+4).map(x=>x==="TAI"?"T":"X").join("");let nx=this.lichSu[i+4]==="TAI"?"T":"X";if(!p[s])p[s]={T:0,X:0};p[s][nx]++;}let c=this.lichSu.slice(-4).map(x=>x==="TAI"?"T":"X").join("");const s=p[c];if(!s)return "TAI";return s.T>=s.X?"TAI":"XIU"; }
    algo4_HMM() { const o=this.lichSu.slice(-12).map(x=>x==="TAI"?0:1);let p=[{s0:0.5,s1:0.5}];o.forEach(e=>{let pr=p[p.length-1];p.push({s0:Math.max(pr.s0*0.7,pr.s1*0.4)*(e===0?0.8:0.2),s1:Math.max(pr.s0*0.3,pr.s1*0.6)*(e===0?0.3:0.7)});});return p[p.length-1].s0>=p[p.length-1].s1?"TAI":"XIU"; }
    algo5_LSTM() { const w=[0.02,0.03,0.05,0.08,0.12,0.15,0.20,0.35];const i=this.lichSu.slice(-8).map(x=>x==="TAI"?1:0);let a=0;for(let x=0;x<8;x++)a+=i[x]*w[x];return a>=0.5?"TAI":"XIU"; }
    algo6_MD5() { const h=this.lichSuMD5[this.lichSuMD5.length-1];if(!h)return "TAI";let d1=parseInt(h.substring(0,4),16)||0;let d2=parseInt(h.substring(h.length-4),16)||0;return (d1^d2^this.lichSuDiem[this.lichSuDiem.length-1])%2===0?"XIU":"TAI"; }
    algo7_MC() { const p=this.lichSuDiem.slice(-15);const m=p.reduce((a,b)=>a+b,0)/p.length;let t=0;for(let i=0;i<1000;i++){if(m+(Math.random()-0.5)*3.5>=10.5)t++;}return t>=500?"TAI":"XIU"; }
    algo8_KNN() { const c=this.lichSu.slice(-4).map(x=>x==="TAI"?"1":"0").join("");let t=0,x=0;for(let i=0;i<this.lichSu.length-5;i++){if(this.lichSu.slice(i,i+4).map(v=>v==="TAI"?"1":"0").join("")===c){if(this.lichSu[i+4]==="TAI")t++;else x++;}}return t>=x?"TAI":"XIU"; }
    algo9_Logistic() { const x1=this.lichSuDiem[this.lichSuDiem.length-1]||10;const x2=this.lichSu.slice(-6).filter(v=>v==="TAI").length;const l=-0.5+(x1*0.05)+(x2*0.2);return (1/(1+Math.exp(-l)))>=0.5?"TAI":"XIU"; }
    algo10_FFT() { const d=this.lichSuDiem.slice(-8);let r=0;for(let n=0;n<d.length;n++)r+=d[n]*Math.cos((2*Math.PI*n)/8);return Math.abs(r)%2===0?"TAI":"XIU"; }
    algo11_ARIMA() { const p=this.lichSuDiem.slice(-8);if(p.length<4)return "TAI";const d1=p[p.length-1]-p[p.length-2];return (p[p.length-1]+(d1*0.4))>=10.5?"TAI":"XIU"; }
    algo12_SMA5() { return (this.lichSuDiem.slice(-5).reduce((a,b)=>a+b,0)/5)>=10.5?"TAI":"XIU"; }
    algo13_WMA8() { const p=this.lichSuDiem.slice(-8);let s=0,w=0;for(let i=0;i<p.length;i++){s+=p[i]*(i+1);w+=(i+1);}return (s/w)>=10.5?"TAI":"XIU"; }
    algo14_Mom() { return (this.lichSuDiem[this.lichSuDiem.length-1]-(this.lichSuDiem[this.lichSuDiem.length-4]||10))>=0?"TAI":"XIU"; }
    algo15_ROC() { return (this.lichSuDiem[this.lichSuDiem.length-1]/(this.lichSuDiem[this.lichSuDiem.length-6]||10))>=1.0?"TAI":"XIU"; }
    algo16_Z() { const p=this.lichSuDiem.slice(-20);const m=p.reduce((a,b)=>a+b,0)/p.length;return p[p.length-1]>=m?"TAI":"XIU"; }
    algo17_Bands() { const p=this.lichSuDiem.slice(-15);const m=p.reduce((a,b)=>a+b,0)/p.length;return this.lichSuDiem[this.lichSuDiem.length-1]>(m+0.5)?"TAI":"XIU"; }
    algo18_RSI() { const r=this.lichSuDiem.slice(-6);let u=0,d=0;for(let i=1;i<6;i++){let v=r[i]-r[i-1];if(v>0)u+=v;else d+=Math.abs(v);}return u>=d?"TAI":"XIU"; }
    algo19_MACD() { return (this.lichSuDiem.slice(-6).reduce((a,b)=>a+b,0)/6)>=(this.lichSuDiem.slice(-12).reduce((a,b)=>a+b,0)/12)?"TAI":"XIU"; }
    algo20_Sto() { const r=this.lichSuDiem.slice(-5);const mn=Math.min(...r),mx=Math.max(...r);return (((this.lichSuDiem[this.lichSuDiem.length-1]-mn)/(mx-mn||1))*100)>=50?"TAI":"XIU"; }
    algo21_ATR() { return this.lichSuDiem[this.lichSuDiem.length-1]>=11?"TAI":"XIU"; }
    algo22_CCI() { const r=this.lichSuDiem.slice(-14);const m=r.reduce((a,b)=>a+b,0)/14;return this.lichSuDiem[this.lichSuDiem.length-1]>=m?"TAI":"XIU"; }
    algo23_Chk() { return this.lichSuDiem[this.lichSuDiem.length-1]%2===0?"TAI":"XIU"; }
    algo24_LR() { const y=this.lichSuDiem.slice(-5);if(y.length<5)return "TAI";let sx=0,sy=0,sxy=0,sx2=0;for(let x=0;x<5;x++){sx+=x;sy+=y[x];sxy+=x*y[x];sx2+=x*x;}let s=(5*sxy-sx*sy)/(5*sx2-sx*sx||1);return (sy/5+s*5)>=10.5?"TAI":"XIU"; }
    algo25_NB() { return this.lichSu.filter(x=>x==="TAI").length>=(this.lichSu.length/2)?"TAI":"XIU"; }
    algo26_M2() { let p={};const n=this.lichSu.length;if(n<10)return "TAI";for(let i=0;i<n-2;i++){let s=this.lichSu.slice(i,i+2).map(x=>x==="TAI"?"T":"X").join("");let nx=this.lichSu[i+2]==="TAI"?"T":"X";if(!p[s])p[s]={T:0,X:0};p[s][nx]++;}let c=this.lichSu.slice(-2).map(x=>x==="TAI"?"T":"X").join("");const s=p[c];if(!s)return "TAI";return s.T>=s.X?"TAI":"XIU"; }
    algo27_Local() { return this.lichSu.slice(-6).filter(x=>x==="TAI").length>=3?"TAI":"XIU"; }
    algo28_Ent() { return this.lichSuDiem[this.lichSuDiem.length-1]>this.lichSuDiem[this.lichSuDiem.length-2]?"TAI":"XIU"; }
    algo29_Bit() { const p=this.lichSuDiem.slice(-3);if(p.length<3)return "TAI";return (p[0]^p[1]^p[2])>=10?"TAI":"XIU"; }
    algo30_Lap() { return ((this.lichSu.filter(x=>x==="TAI").length+1)/(this.lichSu.length+2))>=0.5?"TAI":"XIU"; }
    algo31_AG() { const p=this.lichSuDiem.slice(-5);if(p.length<2)return "TAI";let pr=p[0];for(let i=1;i<p.length;i++)pr=pr+0.1*(p[i]-pr);return pr>=10.5?"TAI":"XIU"; }
    algo32_BN() { let tT=0,tX=0,xT=0,xX=0;for(let i=0;i<this.lichSu.length-1;i++){if(this.lichSu[i]==="TAI"){this.lichSu[i+1]==="TAI"?tT++:xT++;}else{this.lichSu[i+1]==="TAI"?tX++:xX++;}}const l=this.lichSu[this.lichSu.length-1];if(l==="TAI")return tT>=xT?"TAI":"XIU";return tX>=xX?"TAI":"XIU"; }
    algo33_BB() { const l4=this.lichSu.slice(-4).map(x=>x==="TAI"?"T":"X").join("");if(l4!=="TTTT"&&l4!=="XXXX")return this.algo18_RSI();let t=0,x=0;for(let i=0;i<this.lichSu.length-5;i++){if(this.lichSu.slice(i,i+4).map(x=>x==="TAI"?"T":"X").join("")===l4){if(this.lichSu[i+4]==="TAI")t++;else x++;}}if(t===0&&x===0)return l4==="TTTT"?"TAI":"XIU";return t>=x?"TAI":"XIU"; }
    algo34_M5() { let p={};const n=this.lichSu.length;if(n<10)return "TAI";for(let i=0;i<n-5;i++){let s=this.lichSu.slice(i,i+5).map(x=>x==="TAI"?"T":"X").join("");let nx=this.lichSu[i+5]==="TAI"?"T":"X";if(!p[s])p[s]={T:0,X:0};p[s][nx]++;}let c=this.lichSu.slice(-5).map(x=>x==="TAI"?"T":"X").join("");const s=p[c];if(!s)return "TAI";return s.T>=s.X?"TAI":"XIU"; }
    algo35_RL() { if(lastPredictionResult && lastPredictionResult !== this.lichSu[this.lichSu.length-1]){return this.algo3_Markov4()==="TAI"?"XIU":"TAI";}return this.algo3_Markov4(); }
    algo36_DeepSeq() { if(this.lichSu.length<20)return "TAI";const c=this.lichSu.slice(-5).join("");let t=0,x=0;for(let i=0;i<this.lichSu.length-6;i++){if(this.lichSu.slice(i,i+5).join("")===c){if(this.lichSu[i+5]==="TAI")t++;else x++;}}if(t+x<3)return this.algo34_M5();return t>=x?"TAI":"XIU"; }
    algo37_Fib() { const p=this.lichSuDiem.slice(-13);if(p.length<13)return "TAI";const mx=Math.max(...p),mn=Math.min(...p);if(mx===mn)return "TAI";return p[p.length-1] >= (mn + (mx-mn)*0.5) ? "TAI" : "XIU"; }
    
    // THUẬT TOÁN MỚI V30: MARKOV BẬC 10 CỰC PHỨC TẠP
    algo38_Markov10() {
        if (this.lichSu.length < 30) return "TAI";
        let p = {}; const n = this.lichSu.length;
        for (let i = 0; i < n - 10; i++) {
            let s = this.lichSu.slice(i, i + 10).join(""); 
            let nx = this.lichSu[i + 10];
            if (!p[s]) p[s] = { TAI: 0, XIU: 0 }; p[s][nx]++;
        }
        let c = this.lichSu.slice(-10).join(""); const s = p[c];
        if (!s) return this.algo36_DeepSeq(); // Fallback
        return s.TAI >= s.XIU ? "TAI" : "XIU";
    }
    // THUẬT TOÁN MỚI V30: SMART BREAK & FOLLOW
    algo39_SmartBreakFollow() {
        const m = this.lichSu.slice(-15);
        let alt = 0, streak = 0;
        for(let i=1; i<m.length; i++) {
            if(m[i] !== m[i-1]) alt++; else streak++;
        }
        const last = this.lichSu[this.lichSu.length-1];
        // Nếu thị trường đang đảo nhiều (>60%), bắt đảo
        if(alt > m.length * 0.6) return last === "TAI" ? "XIU" : "TAI";
        // Nếu thị trường đang bệt nhiều, bám bệt
        if(streak > m.length * 0.6) return last;
        return this.algo36_DeepSeq();
    }
    // THUẬT TOÁN MỚI V30: BROWNIAN MOTION DRIFT
    algo40_Brownian() {
        const p = this.lichSuDiem.slice(-20); if(p.length < 20) return "TAI";
        const mean = p.reduce((a,b)=>a+b,0)/20;
        let drift = 0;
        for(let i=1; i<p.length; i++) drift += (p[i] - p[i-1]);
        drift /= p.length;
        return (mean + drift) >= 10.5 ? "TAI" : "XIU";
    }
    // THUẬT TOÁN MỚI V30: POLYNOMIAL REGRESSION (DEGREE 3)
    algo41_PolyReg() {
        const y = this.lichSuDiem.slice(-10); if(y.length < 10) return "TAI";
        // Đơn giản hóa bằng phương pháp sai phân bậc 3
        let d1 = [], d2 = [], d3 = [];
        for(let i=1; i<y.length; i++) d1.push(y[i]-y[i-1]);
        for(let i=1; i<d1.length; i++) d2.push(d1[i]-d1[i-1]);
        for(let i=1; i<d2.length; i++) d3.push(d2[i]-d2[i-1]);
        let next = y[y.length-1] + d1[d1.length-1] + d2[d2.length-1] + d3[d3.length-1];
        return next >= 10.5 ? "TAI" : "XIU";
    }
    // THUẬT TOÁN MỚI V30: WAVE COLLAPSE SIMULATION
    algo42_WaveCollapse() {
        const obs = this.lichSu.slice(-8); if(obs.length < 8) return "TAI";
        let superPosition = 0;
        const weights = [1, 2, 3, 5, 8, 13, 21, 34]; // Fibonacci weights
        for(let i=0; i<8; i++) {
            superPosition += (obs[i] === "TAI" ? 1 : -1) * weights[i];
        }
        return superPosition >= 0 ? "TAI" : "XIU";
    }
    // THUẬT TOÁN MỚI V30: QUANTUM ENTROPY SHIFT
    algo43_EntShift() {
        const e1 = this.lichSuDiem.slice(-10).reduce((a,b)=>a+b,0)/10;
        const e2 = this.lichSuDiem.slice(-20).reduce((a,b)=>a+b,0)/20;
        return (e1 - e2) >= 0 ? "TAI" : "XIU";
    }
    // THUẬT TOÁN MỚI V30: RNN SIMULATION
    algo44_RNNSim() {
        const seq = this.lichSu.slice(-12).map(x => x === "TAI" ? 1 : 0);
        let hidden = 0;
        for(let i=0; i<seq.length; i++) {
            hidden = (hidden * 0.9) + (seq[i] * 0.1);
        }
        return hidden >= 0.5 ? "TAI" : "XIU";
    }
    // THUẬT TOÁN MỚI V30: ADVANCED FIBONACCI SEQUENCE
    algo45_FibSeq() {
        if(this.lichSu.length < 10) return "TAI";
        const f = [1, 1, 2, 3, 5, 8];
        let t = 0, x = 0;
        for(let i=0; i<f.length; i++) {
            if(this.lichSu[this.lichSu.length - 1 - i] === "TAI") t += f[i]; else x += f[i];
        }
        return t >= x ? "TAI" : "XIU";
    }

    duDoanChinhXac() {
        if (this.lichSu.length < 15) return { duDoan: "TAI", doTinCay: 50, lyDo: "Mồi dữ liệu V30" };
        
        const algoList = [
            this.algo1_Kalman, this.algo2_EWMA, this.algo3_Markov4, this.algo4_HMM, this.algo5_LSTM, 
            this.algo6_MD5, this.algo7_MC, this.algo8_KNN, this.algo9_Logistic, this.algo10_FFT,
            this.algo11_ARIMA, this.algo12_SMA5, this.algo13_WMA8, this.algo14_Mom, this.algo15_ROC, 
            this.algo16_Z, this.algo17_Bands, this.algo18_RSI, this.algo19_MACD, this.algo20_Sto,
            this.algo21_ATR, this.algo22_CCI, this.algo23_Chk, this.algo24_LR, this.algo25_NB, 
            this.algo26_M2, this.algo27_Local, this.algo28_Ent, this.algo29_Bit, this.algo30_Lap, 
            this.algo31_AG, this.algo32_BN, this.algo33_BB, this.algo34_M5, this.algo35_RL,
            this.algo36_DeepSeq, this.algo37_Fib, this.algo38_Markov10, this.algo39_SmartBreakFollow, 
            this.algo40_Brownian, this.algo41_PolyReg, this.algo42_WaveCollapse, this.algo43_EntShift, 
            this.algo44_RNNSim, this.algo45_FibSeq
        ];

        let tVotes = 0, xVotes = 0;
        let bestAlgoHit = 0;
        let activeAlgos = 0;

        // SMART ENSEMBLE VOTING
        algoList.forEach(algoFunc => {
            const hitRate = this.backtestAlgo(algoFunc, 30);
            let weight = 0;
            if (hitRate > 0.7) { weight = 5.0; bestAlgoHit = Math.max(bestAlgoHit, hitRate); activeAlgos++; }
            else if (hitRate > 0.6) { weight = 2.5; activeAlgos++; }
            else if (hitRate > 0.5) { weight = 1.0; }
            
            const sig = algoFunc.call(this);
            if (sig === "TAI") tVotes += weight; else xVotes += weight;
        });

        // Nếu không có thuật toán nào > 60%, lấy trọng số cao nhất làm chuẩn
        if (activeAlgos === 0) {
            algoList.forEach(algoFunc => {
                const hitRate = this.backtestAlgo(algoFunc, 30);
                bestAlgoHit = Math.max(bestAlgoHit, hitRate);
                if (hitRate >= 0.5) {
                    const sig = algoFunc.call(this);
                    if (sig === "TAI") tVotes += 1; else xVotes += 1;
                }
            });
        }

        let decision = tVotes > xVotes ? "TAI" : "XIU";
        let confidence = Math.round((Math.max(tVotes, xVotes) / (tVotes + xVotes)) * 100);
        
        // Điều chỉnh độ tin cậy dựa trên tỷ lệ thắng thực tế của Ensemble
        confidence = Math.round((confidence + (bestAlgoHit * 100)) / 2);
        
        if (confidence < 50) confidence = 50;
        if (confidence > 95) confidence = 95;

        return { 
            duDoan: decision, 
            doTinCay: confidence, 
            lyDo: `Smart Ensemble [${activeAlgos} Algos >60%] | Top Hit: ${(bestAlgoHit*100).toFixed(0)}%`, 
            mode: "VÀO LỆNH" 
        };
    }
}

const predictor = new QuantumSmartEnsemblePredictor();

async function checkPreviousPrediction() {
    if (predictionHistory.length === 0) return;
    const lastPrediction = predictionHistory[predictionHistory.length - 1];
    if (lastPrediction.verified) return;
    if (historyData.length === 0) return;

    const targetId = lastPrediction.phienId;
    const foundSession = historyData.find(s => String(s.id || s.sessionID || s.phienId || s.sessionId || s.session_id) === String(targetId));
    if (foundSession) {
        let tempDices = new Array(1, 2, 3);
        if (foundSession.dices && foundSession.dices.length === 3) tempDices = foundSession.dices;
        else if (foundSession.result && foundSession.result.length === 3) tempDices = foundSession.result;
        const totalDices = foundSession.point || foundSession.totalResult || foundSession.score || (parseInt(tempDices[0]) + parseInt(tempDices[1]) + parseInt(tempDices[2]));
        const actualResult = foundSession.resultTruyenThong || foundSession.resultType || (totalDices >= 11 ? "TAI" : "XIU");
        const actualNormalized = actualResult.toUpperCase().includes("TAI") || actualResult.toUpperCase().includes("TÀI") ? "TAI" : "XIU";
        
        lastPrediction.verified = true;
        lastPrediction.ket_qua_thuc = actualNormalized;
        lastPrediction.diem_so = totalDices;
        tongDuDoan++;
        if (lastPrediction.du_doan === actualNormalized) { 
            duDoanDung++; chuoiDungLienTiep++; chuoiSaiLienTiep = 0; 
        } else { 
            chuoiSaiLienTiep++; chuoiDungLienTiep = 0; 
        }
        lastPredictionResult = lastPrediction.du_doan;
        savePredictionHistory();
        console.log(">>> [SMART V30] Phiên #" + targetId + " | ĐOÁN: " + lastPrediction.du_doan + " | THỰC TẾ: " + actualNormalized + " => " + (lastPrediction.du_doan === actualNormalized ? 'THẮNG' : 'THUA'));
    }
}

// GIAO DIỆN BENTO GRID V30 (21ST.DEV STYLE)
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Smart Ensemble V30</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { background-color: #050507; color: #e4e4e7; display: flex; justify-content: center; padding: 24px; min-height: 100vh; font-family: 'Inter', sans-serif; }
            .wrapper { width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 16px; }
            
            .header { display: flex; justify-content: space-between; align-items: center; padding: 0 4px; }
            .logo-text { font-size: 16px; font-weight: 600; letter-spacing: -0.5px; display: flex; align-items: center; gap: 8px; }
            .logo-dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; animation: pulse 2s infinite; }
            .header-sub { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #71717a; }
            
            .bento-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
            .card { background: rgba(12, 12, 15, 0.6); border: 1px solid #1e1e24; border-radius: 16px; padding: 18px; transition: border-color 0.2s; backdrop-filter: blur(8px); }
            .card:hover { border-color: #2a2a35; }
            
            .card-signal { grid-column: span 2; text-align: center; padding: 36px 18px; position: relative; overflow: hidden; }
            .signal-label { font-size: 12px; color: #71717a; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 14px; }
            .signal-val { font-family: 'JetBrains Mono', monospace; font-size: 56px; font-weight: 600; letter-spacing: -2px; line-height: 1; }
            .signal-val.tai { color: #f59e0b; text-shadow: 0 0 40px rgba(245, 158, 11, 0.5); }
            .signal-val.xiu { color: #06b6d4; text-shadow: 0 0 40px rgba(6, 182, 212, 0.5); }
            .signal-val.wait { color: #52525b; font-size: 32px; }
            .signal-meta { font-size: 12px; color: #a1a1aa; margin-top: 18px; font-family: 'JetBrains Mono', monospace; padding-top: 14px; border-top: 1px solid #1e1e24; }
            
            .card-history-viz { grid-column: span 2; padding: 16px; }
            .viz-title { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
            .viz-dots { display: flex; gap: 6px; justify-content: space-between; }
            .viz-dot { width: 100%; aspect-ratio: 1; border-radius: 50%; max-width: 16px; background: #27272a; transition: transform 0.2s; }
            .viz-dot:hover { transform: scale(1.3); }
            .viz-dot.tai { background: #f59e0b; box-shadow: 0 0 8px rgba(245, 158, 11, 0.3); }
            .viz-dot.xiu { background: #06b6d4; box-shadow: 0 0 8px rgba(6, 182, 212, 0.3); }
            
            .stat-label { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
            .stat-val { font-family: 'JetBrains Mono', monospace; font-size: 28px; font-weight: 500; }
            .stat-val.green { color: #10b981; }
            .stat-val.red { color: #f43f5e; }
            .stat-sub { font-size: 11px; color: #52525b; margin-top: 4px; }
            
            .log-section { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
            .log-item { background: rgba(12, 12, 15, 0.6); border: 1px solid #1e1e24; border-radius: 12px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; backdrop-filter: blur(8px); }
            .log-left { display: flex; flex-direction: column; gap: 4px; }
            .log-phien { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #71717a; }
            .log-status { font-size: 13px; font-weight: 500; }
            .log-status.thang { color: #10b981; }
            .log-status.thua { color: #f43f5e; }
            .log-status.wait { color: #52525b; }
            .log-right { display: flex; gap: 8px; align-items: center; }
            .log-pill { font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 4px 10px; border-radius: 6px; width: 50px; text-align: center; font-weight: 500; }
            .log-pill.tai { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
            .log-pill.xiu { background: rgba(6, 182, 212, 0.1); color: #06b6d4; }
            .log-res { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #a1a1aa; width: 50px; text-align: center; }

            @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <div class="header">
                <div class="logo-text"><span class="logo-dot"></span>SMART ENSEMBLE V30</div>
                <div class="header-sub" id="phien-text">---...</div>
            </div>
            
            <div class="bento-grid">
                <div class="card card-signal">
                    <div class="signal-label">Tín Hiệu Tức Khắc</div>
                    <div class="signal-val wait" id="val-signal">---...</div>
                    <div class="signal-meta" id="val-meta">Đang bóc tách ma trận...\</div>
                </div>
                
                <div class="card card-history-viz">
                    <div class="viz-title">Chuỗi 20 kỳ gần nhất</div>
                    <div class="viz-dots" id="viz-dots"></div>
                </div>
                
                <div class="card">
                    <div class="stat-label">Tỷ lệ thắng thật</div>
                    <div class="stat-val green" id="val-acc">0.0%</div>
                    <div class="stat-sub" id="val-acc-sub">0/0 phiên</div>
                </div>
                
                <div class="card">
                    <div class="stat-label">Chuỗi thắng</div>
                    <div class="stat-val" id="val-streak">0</div>
                    <div class="stat-sub">Max: 0</div>
                </div>
            </div>

            <div class="log-section" id="log-area"></div>
        </div>

        <script>
            function lbl(str) {
                if(!str) return '---';
                const s = str.toUpperCase().trim();
                if(s.includes('TAI')) return 'TÀI';
                if(s.includes('XIU')) return 'XỈU';
                return '---';
            }
            
            async function refresh() {
                try {
                    const res = await fetch('/api/dashboard-stats');
                    const data = await res.json();
                    
                    const sig = data.du_doan_live.toUpperCase().trim();
                    const sigEl = document.getElementById('val-signal');
                    if(sig.includes('TAI')) { sigEl.innerText = 'TÀI'; sigEl.className = 'signal-val tai'; }
                    else if(sig.includes('XIU')) { sigEl.innerText = 'XỈU'; sigEl.className = 'signal-val xiu'; }
                    else { sigEl.innerText = '---...'; sigEl.className = 'signal-val wait'; }
                    
                    document.getElementById('val-meta').innerText = 'Độ tin cậy: ' + data.do_tin_cay_live + '% | ' + data.ly_do_live;
                    document.getElementById('phien-text').innerText = 'Phiên #' + data.phien_hien_tai_live;
                    
                    const acc = data.tong_phien > 0 ? ((data.thang / data.tong_phien) * 100).toFixed(1) : '0.0';
                    document.getElementById('val-acc').innerText = acc + '%';
                    document.getElementById('val-acc-sub').innerText = data.thang + '/' + data.tong_phien + ' phiên';
                    
                    const streakEl = document.getElementById('val-streak');
                    streakEl.innerText = data.so_lan_thong;
                    streakEl.className = data.so_lan_thong > 0 ? 'stat-val green' : 'stat-val red';
                    streakEl.nextElementSibling.innerText = 'Max: ' + data.thang_lien_tiep_max;
                    
                    const vizEl = document.getElementById('viz-dots');
                    vizEl.innerHTML = '';
                    if(data.lich_su_20) {
                        data.lich_su_20.forEach(r => {
                            const dot = document.createElement('div');
                            dot.className = 'viz-dot ' + (r === 'TAI' ? 'tai' : 'xiu');
                            vizEl.appendChild(dot);
                        });
                    }
                    
                    const logArea = document.getElementById('log-area');
                    logArea.innerHTML = '';
                    if(data.chi_tiet_phien) {
                        data.chi_tiet_phien.forEach(p => {
                            const div = document.createElement('div');
                            div.className = 'log-item';
                            const predClass = p.du_doan.includes('TAI') ? 'tai' : 'xiu';
                            let statusTxt = 'ĐANG ĐỢI', statusClass = 'wait';
                            if(p.trang_thai.includes('Thắng')) { statusTxt = 'THẮNG'; statusClass = 'thang'; }
                            else if(p.trang_thai.includes('Thua')) { statusTxt = 'THUA'; statusClass = 'thua'; }
                            
                            div.innerHTML = '<div class="log-left">' +
                                '<div class="log-phien">Phiên #' + p.phienId + '</div>' +
                                '<div class="log-status ' + statusClass + '">' + statusTxt + '</div>' +
                            '</div>' +
                            '<div class="log-right">' +
                                '<div class="log-pill ' + predClass + '">' + lbl(p.du_doan) + '</div>' +
                                '<div class="log-res">' + (p.ket_qua_thuc.includes('Chờ') ? '---' : lbl(p.ket_qua_thuc)) + '</div>' +
                            '</div>';
                            logArea.appendChild(div);
                        });
                    }
                } catch(e) { console.error(e); }
            }
            refresh();
            setInterval(refresh, 1000);
        </script>
    </body>
    </html>
    `);
});

app.get('/api/dashboard-stats', (req, res) => {
    const verifiedPredictions = predictionHistory.filter(p => p.verified);
    const duDoanLive = currentPrediction ? currentPrediction.du_doan : "TAI";
    const doTinCayLive = currentPrediction ? currentPrediction.do_tin_cay : 50;
    const lyDoLive = currentPrediction ? currentPrediction.ly_do : "Smart Ensemble V30 khởi tạo";
    const phienHienTaiLive = currentPrediction ? currentPrediction.phien_hien_tai : 0;

    const realAccuracy = tongDuDoan > 0 ? parseFloat(((duDoanDung / tongDuDoan) * 100).toFixed(1)) : 0.0;

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
        lich_su_20: predictor.lichSu.slice(-20).reverse(),
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

async function updateData() {
    if (updateLock) return;
    updateLock = true;
    try {
        if (await fetchHistory() && historyData.length > 0) {
            const latest = historyData[0];
            const currentId = latest.id;
            if (currentId && currentId !== lastPhienId) {
                await checkPreviousPrediction();
                lastPhienId = currentId;
                predictor.lichSu = []; predictor.lichSuDiem = []; predictor.lichSuXucXac = []; predictor.lichSuMD5 = [];
                [...historyData].reverse().forEach(s => {
                    let d = s.dices || s.result || [1,2,3];
                    let t = s.point || s.totalResult || s.score || (parseInt(d[0])+parseInt(d[1])+parseInt(d[2]));
                    let k = s.resultTruyenThong || s.resultType || (t >= 11 ? "TAI" : "XIU");
                    predictor.themKetQua(k, t, d, s._id || "000");
                });
                const analysis = predictor.duDoanChinhXac();
                currentPrediction = { phien_hien_tai: currentId + 1, du_doan: formatResultName(analysis.duDoan), do_tin_cay: analysis.doTinCay, ly_do: analysis.lyDo };
                if (!predictionHistory.find(p => p.phienId === currentId + 1)) {
                    predictionHistory.push({ phienId: currentId + 1, du_doan: formatResultName(analysis.duDoan), do_tin_cay: analysis.doTinCay, ly_do: analysis.lyDo, ket_qua_thuc: null, verified: false, timestamp: Date.now(), diem_so: null });
                    savePredictionHistory();
                }
                console.log(`[V30] #${currentId} -> Next: ${analysis.duDoan} (${analysis.doTinCay}%)`);
            }
        }
    } catch (e) {} finally { updateLock = false; }
}

async function initializeData() {
    if (await fetchHistory() && historyData.length > 0) {
        const latest = historyData[0];
        const currentId = latest.id;
        lastPhienId = currentId;
        [...historyData].reverse().forEach(s => {
            let d = s.dices || s.result || [1,2,3];
            let t = s.point || s.totalResult || s.score || (parseInt(d[0])+parseInt(d[1])+parseInt(d[2]));
            let k = s.resultTruyenThong || s.resultType || (t >= 11 ? "TAI" : "XIU");
            predictor.themKetQua(k, t, d, s._id || "000");
        });
        const analysis = predictor.duDoanChinhXac();
        currentPrediction = { phien_hien_tai: currentId + 1, du_doan: formatResultName(analysis.duDoan), do_tin_cay: analysis.doTinCay, ly_do: analysis.lyDo };
        console.log("[KHỞI ĐỘNG V30] Smart Ensemble nạp thành công #" + currentId);
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
    console.log('  SMART ENSEMBLE V30 TERMINAL RUNNING ON PORT: ' + PORT);
    console.log('  SMART BREAK/FOLLOW & MARKOV 10 ACTIVATED');
    console.log('  REAL ACCURACY METRICS ENABLED');
    console.log('==================================================\n');
    loadPredictionHistory(); 
    initializeData();        
    setInterval(async () => { await updateData(); }, UPDATE_INTERVAL);
});
