window.onerror = function (msg, url, lineNo, columnNo, error) {
    const debugEl = document.getElementById('debug-log');
    if (debugEl) {
        debugEl.style.display = 'block';
        debugEl.textContent += `Error: ${msg}\nLine: ${lineNo}\n`;
    }
    return false;
};

// Initialize App
console.log('App Script Starting...');

// Safe import for Capacitor Plugins
const { TextToSpeech } = window.Capacitor ? window.Capacitor.Plugins : {};

// alert('System Check: App Started'); // Uncomment for aggressive debugging if needed

// App State
const state = {
    data: [],
    categories: ['All'],
    activeCategory: 'All',
    isListening: false,
    // New Everest Pay State
    user: null, // { id, name, points, branch_id }
    todayMission: [], // Array of indices or items
    missionStatus: {}, // { index: { attempts: 0, completed: false } }
};

// Backend URL (Change this to your Render URL in production)
// Backend URL (Change this to your Render URL in production)
const BACKEND_URL = 'https://korean-app-for-pay.onrender.com';

// Google Sheet Published CSV URL
// Google Sheet Published CSV URL (Added timestamp to prevent caching)
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRo4iD3re1NbdQt7ok1xP41jIOZ_LTBciO7oBWLHaZR7cNajUlTZvlwONDRKIlZlm6UThP8zxDK5pmO/pub?output=csv&t=' + new Date().getTime();

// Fallback Data (Internal backup)
const FALLBACK_DATA = [
    { Category: '인사/입장', Situation: '환영', Korean: 'APP ERROR: Google Sheet 연결 실패', Pronunciation: 'Connection Failed', Nepali: '잠시 후 다시 시도해주세요.' },
    { Category: '인사/입장', Situation: '환영', Korean: '어서 오세요.', Pronunciation: '오소 오세요', Nepali: 'स्वागत छ।' },
    { Category: '주문', Situation: '주문', Korean: '주문하시겠어요?', Pronunciation: 'जुमुन 하सि게स्सयो?', Nepali: 'अर्डर लिनू?' }
];

// DOM Elements
const categoryHeader = document.getElementById('category-header');
const categoryLabel = document.getElementById('current-category-label');
const categoryDropdown = document.getElementById('category-dropdown');
const cardContainer = document.getElementById('card-container');

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // 1. In-App Browser Escape Logic (Only for web environment, not needed in native APK)
    const userAgent = navigator.userAgent.toLowerCase();
    const isAndroid = /android/i.test(navigator.userAgent);
    const isCapacitor = !!(window.Capacitor && window.Capacitor.platform); // Detect if running inside Capacitor

    // Only run this logic if NOT in Capacitor and using a problematic in-app browser
    if (!isCapacitor && userAgent.match(/kakaotalk|line|naver|instagram|facebook|fbav|fbios|messenger/i)) {
        if (isAndroid) {
            const cleanUrl = location.href.replace(/^https?:\/\//, '');
            location.href = `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;end`;
            return;
        } else {
            alert('⚠️ 음성 인식이 지원되지 않는 브라우저입니다.\n(메신저 브라우저 감지됨)\n\n[해결 방법]\n화면 우측 상단 [⋮] 또는 [⋯] 메뉴를 누르고\n"다른 브라우저로 열기"를 선택해주세요.');
        }
    }

    await loadData();
    renderCategories();
    renderCards();
    updateChallengeUI();

    // Click outside to close menu
    document.addEventListener('click', (e) => {
        const wrapper = document.querySelector('.category-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            categoryDropdown.classList.remove('show');
            categoryHeader.classList.remove('open');
        }
    });
});

// Toggle Menu
window.toggleCategoryMenu = function () {
    categoryDropdown.classList.toggle('show');
    categoryHeader.classList.toggle('open');
}

// Data Loading
async function loadData() {
    // Safety Valve: Force fallback after 3 seconds if data is stuck
    const safetyTimeout = setTimeout(() => {
        console.warn('Data loading timed out (3s limit reached)');
        useFallbackData();
    }, 3000);

    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const csvText = await response.text();

        // Clear timeout if fetch succeeds
        clearTimeout(safetyTimeout);

        if (typeof Papa === 'undefined') {
            throw new Error('PapaParse library not loaded');
        }

        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: function (results) {
                // Clear timeout if parsing completes successfully
                clearTimeout(safetyTimeout);

                if (results.data && results.data.length > 0) {
                    // Normalize headers: Trim spaces from keys
                    const headers = results.meta.fields || [];
                    console.log('CSV Headers:', headers);

                    // Find exact key for Pronunciation (handling potential encoding/space issues)
                    const pronKey = headers.find(h => h.includes('발음') || h.includes('Pronunciation')) || '발음(नेपाली लिपि)';

                    // Map Google Sheet columns to App internal state
                    const mappedData = results.data.map(row => ({
                        Category: row['대분류'] || row['Category'] || '기타',
                        Situation: row['상황'] || row['Situation'] || '',
                        Korean: row['한국어'] || row['Korean'] || '',
                        Pronunciation: row[pronKey] || row['Pronunciation'] || '',
                        Nepali: row['네팔어'] || row['Nepali'] || ''
                    })).filter(item => item.Korean); // Filter out empty rows

                    if (mappedData.length > 0) {
                        state.data = mappedData;
                        initCategories();
                        renderCategories();
                        renderCards();
                        return;
                    }
                }
                // If we get here, parsing failed or data was empty
                throw new Error('Parsed data is empty');
            },
            error: function (err) {
                console.error('Papa Parse Error:', err);
                useFallbackData();
            }
        });
    } catch (error) {
        console.warn('Google Sheet fetch failed, falling back to local data.', error);
        useFallbackData();
    }
}

function useFallbackData() {
    state.data = FALLBACK_DATA;
    initCategories();
    renderCategories();
    renderCards();

    // Show a toast or small alert about the error
    const msg = document.createElement('div');
    msg.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); color:white; padding:10px 20px; border-radius:30px; z-index:9999; font-size:12px;';
    msg.textContent = 'Data loaded from backup (Connection Issue)';
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 5000);
}

function initCategories() {
    const uniqueCats = [...new Set(state.data.map(item => item.Category).filter(Boolean))];
    state.categories = ['All', ...uniqueCats];
}

// Category Translations (Korean -> English)
const CATEGORY_TRANSLATIONS = {
    '인사/입장': '인사/입장 (Greeting)',
    '자리/안내': '자리/안내 (Guidance)',
    '주문': '주문 (Order)',
    '주문 시작': '주문 시작 (Order Start)',
    '메뉴/기본': '메뉴/기본 (Menu)',
    '주문/확인': '주문/확인 (Confirm)',
    '시간/안내': '시간/안내 (Time Info)',
    '서빙': '서빙 (Serving)',
    '서빙/기본': '서빙/기본 (Serving)',
    '추가/옵션': '추가/옵션 (Option)',
    '계산': '계산 (Bill)',
    '계산/결제': '계산/결제 (Payment)',
    '예약/대기': '예약/대기 (Booking)',
    '포장/배달': '포장/배달 (Packing)',
    '컴플레인': '컴플레인 (Complain)',
    '위생/청소': '위생/청소 (Cleaning)',
    '운영/안내': '운영/안내 (Guide)',
    '고객 케어': '고객 케어 (Care)',
    '응급/안전': '응급/안전 (Emergency)',
    '직원/내부': '직원/내부 (Staff)',
    '추가/회전': '추가/회전 (Rotation)',
    '마감/퇴장': '마감/퇴장 (Closing)',
    '기타': '기타 (Others)'
};

// Rendering Categories (Dropdown Logic)
function renderCategories() {
    if (!categoryDropdown) return;
    categoryDropdown.innerHTML = '';

    // Resolve Display Name for Active Category
    const activeLabel = CATEGORY_TRANSLATIONS[state.activeCategory] || state.activeCategory;
    // Update Header Label
    categoryLabel.textContent = state.activeCategory === 'All' ? 'Choose Category (메뉴 선택)' : activeLabel;

    state.categories.forEach(cat => {
        const chip = document.createElement('div');
        chip.className = `chip ${state.activeCategory === cat ? 'active' : ''}`;

        // Add translation if available
        const displayCat = CATEGORY_TRANSLATIONS[cat] || cat;
        chip.textContent = displayCat;

        chip.onclick = (e) => {
            e.stopPropagation(); // Prevent bubbling
            state.activeCategory = cat;
            renderCategories(); // Update active class
            renderCards();
            // Close menu
            categoryDropdown.classList.remove('show');
            categoryHeader.classList.remove('open');
        };
        categoryDropdown.appendChild(chip);
    });

    // Add 'Grid Class' to dropdown for styling
    categoryDropdown.classList.add('grid-layout');
}

// Global Modal Controls
window.openModal = function (id) {
    document.getElementById(id).style.display = 'flex';
}

window.closeModal = function (id) {
    document.getElementById(id).style.display = 'none';
}

function renderCards() {
    if (!cardContainer) return;
    cardContainer.innerHTML = '';
    const filteredData = state.activeCategory === 'All'
        ? state.data
        : state.data.filter(item => item.Category === state.activeCategory);

    if (filteredData.length === 0) {
        cardContainer.innerHTML = '<div class="loading">No items found in this category.</div>';
        return;
    }

    filteredData.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="sentence-korean">${item.Korean}</div>
            <div class="sentence-pronunciation">${item.Pronunciation || ''}</div>
            <div class="sentence-meaning">${item.Nepali}</div>
            <div class="card-actions">
                <div class="interim-text" id="interim-${index}"></div>
                <button class="btn-icon play-btn" onclick="speakText('${item.Korean}', this)" aria-label="Listen" style="background:#e74c3c; color:white;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                </button>
                <button class="btn-icon mic-btn" id="mic-${index}" onclick="startListening('${item.Korean}', 'mic-${index}')" aria-label="Speak" style="background:#2ecc71; color:white;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                </button>
            </div>
        `;
        cardContainer.appendChild(card);
    });
}

// TTS (Text to Speech) Helpers
function getSynth() {
    return window.speechSynthesis ||
        window.webkitSpeechSynthesis ||
        (navigator && navigator.speechSynthesis);
}

function getUtteranceClass() {
    return window.SpeechSynthesisUtterance ||
        window.webkitSpeechSynthesisUtterance ||
        window.mozSpeechSynthesisUtterance ||
        window.msSpeechSynthesisUtterance;
}

let voices = [];
function loadVoices() {
    const synth = getSynth();
    if (synth) {
        voices = synth.getVoices();
        console.log('Voices loaded:', voices.length);
    }
}

// Initial voice load attempt
if (getSynth()) {
    if (getSynth().onvoiceschanged !== undefined) {
        getSynth().onvoiceschanged = loadVoices;
    }
    loadVoices();
}

window.speakText = async function (text, btnElement) {
    const icon = btnElement ? btnElement.querySelector('svg') : null;
    if (icon) icon.style.opacity = '0.5';

    // 1. Try Native Capacitor TTS Plugin (Best for Android 16)
    if (TextToSpeech) {
        try {
            await TextToSpeech.speak({
                text: text,
                lang: 'ko-KR',
                rate: 0.9,
                pitch: 1.0,
                volume: 1.0,
                category: 'ambient',
            });
            if (icon) icon.style.opacity = '1';
            return;
        } catch (e) {
            console.warn('Native TTS failed, falling back to Web Speech:', e);
        }
    }

    // 2. Fallback to Web Speech API
    const synth = getSynth();
    const UtteranceClass = getUtteranceClass();

    if (!synth || !UtteranceClass) {
        const isSecure = window.isSecureContext ? "Secure" : "Not Secure";
        const hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
        const ua = navigator.userAgent;

        alert(`[치명적 오류] 음성 재생 엔진을 찾을 수 없습니다.\n\n[진단 리포트]\n- Context: ${isSecure}\n- Native Plugin: ${!!TextToSpeech}\n- Synth API: ${!!synth}\n- Utterance Class: ${!!UtteranceClass}\n- Mic API: ${hasSR}\n- UA: ${ua}\n\n[해결 방법]\n안드로이드 시스템 웹뷰(WebView) 앱을 최신으로 업데이트해 주세요.`);
        if (icon) icon.style.opacity = '1';
        return;
    }

    // Stop manual playback if already speaking
    synth.cancel();

    setTimeout(() => {
        try {
            const utterance = new UtteranceClass(text);
            utterance.lang = 'ko-KR';
            utterance.rate = 0.9;

            // Resilience: Try to find a Korean voice
            let korVoice = voices.find(v => v.lang.includes('ko-KR')) || voices.find(v => v.lang.includes('ko'));
            if (korVoice) utterance.voice = korVoice;

            utterance.onend = () => { if (icon) icon.style.opacity = '1'; };
            utterance.onerror = (e) => {
                if (e.error !== 'interrupted' && e.error !== 'canceled') {
                    console.error('TTS Error:', e.error);
                    alert(`재생 오류: ${e.error}`);
                }
                if (icon) icon.style.opacity = '1';
            };

            synth.speak(utterance);
        } catch (err) {
            alert('객체 생성 실패: ' + err.message);
            if (icon) icon.style.opacity = '1';
        }
    }, 50);
};

// STT (Speech to Text)
window.startListening = async function (targetText, btnId) {
    if (state.isListening) return;

    const userAgent = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/i.test(userAgent);
    const isKakaotalk = /kakaotalk/i.test(userAgent);

    if (isIOS && isKakaotalk) {
        alert('⚠️ 아이폰 카톡 브라우저에서는 마이크 기능이 제한됩니다.\n\n[해결 방법]\n오른쪽 하단 [⋯] 버튼을 누르고\n"Safari로 열기"를 선택해 주세요.');
        return;
    }

    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert('이 브라우저는 음성 인식을 지원하지 않습니다.\n\n[권장 브라우저]\n- 안드로이드: Chrome\n- 아이폰: Safari');
        return;
    }

    // 1. 오디오 세션 정리 (TTS 중단)
    const synth = getSynth();
    if (synth && synth.speaking) synth.cancel();

    // 2. 새로운 인스턴스 생성 (아이폰 사파리 안정성 위함)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = true; // 실시간 결과 활성화
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    const btn = document.getElementById(btnId);
    const interimEl = document.getElementById(btnId.replace('mic-', 'interim-'));

    recognition.onstart = () => {
        state.isListening = true;
        btn.classList.add('recording');
        if (interimEl) interimEl.textContent = '듣고 있어요...';
        console.log('Voice Recognition Started');
    };

    recognition.onend = () => {
        setTimeout(() => {
            state.isListening = false;
            btn.classList.remove('recording');
            if (interimEl) interimEl.textContent = '';
        }, 500);
        console.log('Voice Recognition Ended');
    };

    recognition.onerror = (event) => {
        state.isListening = false;
        btn.classList.remove('recording');
        if (interimEl) interimEl.textContent = '';
        console.error('STT Error:', event.error);

        // 'aborted'와 'no-speech'는 경고창을 띄우지 않고 콘솔 로그만 남김
        if (event.error === 'aborted') {
            console.warn('Recognition aborted');
        } else if (event.error === 'no-speech') {
            if (interimEl) {
                interimEl.textContent = '⚠️ 목소리가 들리지 않습니다.';
                setTimeout(() => { if (interimEl.textContent.includes('목소리')) interimEl.textContent = ''; }, 3000);
            }
            console.warn('No speech detected');
        } else if (event.error === 'not-allowed') {
            alert('마이크 권한이 거부되었습니다. 설정에서 마이크를 허용해주세요.');
        } else {
            alert(`음성 인식 오류: ${event.error}`);
        }
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        if (interimEl && interimTranscript) {
            interimEl.textContent = interimTranscript;
            interimEl.style.color = '#2ecc71';
        }

        if (finalTranscript) {
            const script = finalTranscript;
            const accuracy = compareStrings(script, targetText);
            if (interimEl) interimEl.textContent = '';

            if (accuracy > 0.7) {
                new Audio('clap.mp3').play().catch(e => console.log('Audio error:', e));

                document.getElementById('feedback-icon').innerHTML = '👏';
                document.getElementById('feedback-icon').classList.add('animate-clap');
                document.getElementById('feedback-title').textContent = 'धेरै राम्रो! (Great!)';
                document.getElementById('feedback-title').style.color = '#2ecc71';
                document.getElementById('feedback-sub').textContent = `"${script}"`;
                document.getElementById('feedback-text').textContent = 'Excellent pronunciation!';
                openModal('feedback-modal');
                setTimeout(() => document.getElementById('feedback-icon').classList.remove('animate-clap'), 3000);

                // --- Everest Pay Reward Logic ---
                // FIX: Check against object properly (item.Korean or item if string)
                if (state.user && state.todayMission.some(m => (m.Korean || m) === targetText)) {
                    handleMissionSuccess(targetText);
                }
                // --------------------------------
            } else {
                // Decrement attempts if it is a mission item
                if (state.user && state.todayMission.some(m => (m.Korean || m) === targetText)) {
                    handleMissionFailure(targetText);
                }

                document.getElementById('feedback-icon').innerHTML = '🎯';
                document.getElementById('feedback-title').textContent = '페리 प्रयास गर्नुहोस् (Try again)';
                document.getElementById('feedback-title').style.color = '#e67e22';
                document.getElementById('feedback-sub').textContent = `"${script}"`;
                document.getElementById('feedback-text').textContent = 'Keep practicing!';
                openModal('feedback-modal');
            }
        }
    };

    // 3. 실행 지연 (아이폰 하드웨어 전환 시간 확보)
    setTimeout(() => {
        try {
            recognition.start();
        } catch (e) {
            console.error('Start Error:', e);
            state.isListening = false;
            btn.classList.remove('recording');
        }
    }, 300);
};

// Simple string similarity for feedback (Levenshtein distance based simplified)
function compareStrings(s1, s2) {
    s1 = s1.replace(/\s+/g, '').replace(/[.,?!]/g, '');
    s2 = s2.replace(/\s+/g, '').replace(/[.,?!]/g, '');

    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;
    return 0.5; // Placeholder logic
}

// ==========================================
// Everest Pay Logic (Login & Challenge)
// ==========================================

// 1. Authentication
// 0. Load Branches
async function loadBranches() {
    const select = document.getElementById('login-branch');
    if (!select || select.options.length > 1) return; // Already loaded

    try {
        // Add timestamp to prevent caching
        const res = await fetch(`${BACKEND_URL}/api/branches?t=${new Date().getTime()}`);
        const branches = await res.json();

        select.innerHTML = '<option value="">Select Branch (지점 선택)</option>';
        branches.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error('Failed to load branches', e);
        if (select) select.innerHTML = '<option value="">Error loading branches</option>';
    }
}

// 1. Authentication
// 1. Authentication
window.openLoginModal = function () {
    openModal('login-modal');
    loadBranches();
    switchAuthMode('login'); // Default to login
}

let currentAuthMode = 'login';

window.switchAuthMode = function (mode) {
    currentAuthMode = mode;
    const btn = document.getElementById('btn-submit-auth');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const msg = document.getElementById('login-msg');

    msg.textContent = ''; // Clear errors

    if (mode === 'login') {
        btn.textContent = 'Login (로그인)';
        tabLogin.classList.add('active-tab');
        tabLogin.classList.remove('inactive-tab');
        tabRegister.classList.add('inactive-tab');
        tabRegister.classList.remove('active-tab');
    } else {
        btn.textContent = 'Register (가입하기)';
        tabRegister.classList.add('active-tab');
        tabRegister.classList.remove('inactive-tab');
        tabLogin.classList.add('inactive-tab');
        tabLogin.classList.remove('active-tab');
    }
};

window.handleAuthSubmit = async function () {
    const branchSelect = document.getElementById('login-branch');
    const branchId = branchSelect ? branchSelect.value : null;
    const name = document.getElementById('login-name').value;
    const password = document.getElementById('login-pw').value;
    const msg = document.getElementById('login-msg');

    if (!branchId || !name || !password) {
        msg.textContent = 'Please fill all fields (모든 정보를 입력해주세요).';
        return;
    }

    const endpoint = currentAuthMode === 'login' ? '/api/login' : '/api/register';

    try {
        const response = await fetch(`${BACKEND_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, password, branch_id: branchId })
        });
        const data = await response.json();

        if (data.success) {
            if (currentAuthMode === 'login') {
                state.user = data.user;
                msg.textContent = '';
                document.getElementById('login-name').value = '';
                document.getElementById('login-pw').value = '';
                closeModal('login-modal');
                updateUserUI();
                initDailyChallenge(); // Init Daily Mission First (Seeded)
                checkAndStartMonthlyTest(); // Then Check for Monthly Test

                // Show Success Modal instead of Alert
                openModal('feedback-modal');
                document.getElementById('feedback-icon').innerHTML = '🎉';
                document.getElementById('feedback-title').textContent = 'Welcome!';
                document.getElementById('feedback-title').style.color = '#2ecc71';
                document.getElementById('feedback-sub').textContent = state.user.name;
                document.getElementById('feedback-text').textContent = 'Successfully Logged In (로그인 성공)';
                setTimeout(() => closeModal('feedback-modal'), 2000);
            } else {
                // Register Success -> Switch to login
                openModal('feedback-modal');
                document.getElementById('feedback-icon').innerHTML = '✨';
                document.getElementById('feedback-title').textContent = 'Registration Complete';
                document.getElementById('feedback-title').style.color = '#3498db';
                document.getElementById('feedback-sub').textContent = 'Join Success';
                document.getElementById('feedback-text').textContent = 'Please Login now (가입 성공! 로그인해주세요)';

                switchAuthMode('login');
            }
        } else {
            msg.textContent = data.message || 'Action failed';
        }
    } catch (e) {
        console.error(e);
        msg.textContent = 'Server connection failed.';
    }
};

// ==========================================
// Seeded Random for Unified Daily Missions
// ==========================================
class SeededRandom {
    constructor(seed) {
        this.seed = this.cyrb128(seed);
    }
    cyrb128(str) {
        let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
        for (let i = 0, k; i < str.length; i++) {
            k = str.charCodeAt(i);
            h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
            h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
            h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
            h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
        }
        h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
        h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
        h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
        h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
        return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
    }
    next() {
        let [a, b, c, d] = this.seed;
        a |= 0; b |= 0; c |= 0; d |= 0;
        let t = (a + b | 0) + d | 0;
        d = d + 1 | 0; a = b ^ b >>> 9;
        b = c + (c << 3) | 0; c = (c << 21 | c >>> 11);
        c = c + t | 0;
        this.seed = [a, b, c, d];
        return (t >>> 0) / 4294967296;
    }
}

function updateUserUI() {
    const btnLogin = document.getElementById('btn-login');
    const profile = document.getElementById('user-profile');
    const challengeSection = document.getElementById('challenge-section');

    if (state.user) {
        btnLogin.style.display = 'none';
        profile.style.display = 'flex';
        document.getElementById('user-name').textContent = state.user.name;
        document.getElementById('user-points').textContent = state.user.points;
        challengeSection.style.display = 'block';
    } else {
        btnLogin.style.display = 'block';
        profile.style.display = 'none';
        challengeSection.style.display = 'none';
    }
}

// 2. Daily Challenge Logic (Deterministic)
function initDailyChallenge() {
    if (state.data.length > 0 && state.todayMission.length === 0) {
        // USE DATE SEED for Consistency
        const todayStr = new Date().toDateString(); // e.g. "Fri Jan 03 2026"
        const rng = new SeededRandom(todayStr);

        // Shuffle with seeded RNG
        const pool = [...state.data];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(rng.next() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        state.todayMission = pool.slice(0, 2);

        // Render Mission UI
        const container = document.getElementById('challenge-section');
        // Clear existing mission items if any
        const oldItems = container.querySelectorAll('.mission-item');
        oldItems.forEach(el => el.remove());

        state.todayMission.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'mission-item';
            // Use card styling for consistency but simpler
            div.style.cssText = 'background: rgba(255,255,255,0.95); padding: 15px; border-radius: 12px; margin-top: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);';

            // Unique IDs for this mission instance
            const micId = `mission-mic-${index}`;
            const interimId = `mission-interim-${index}`;

            div.innerHTML = `
                <div style="border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 8px;">
                     <div style="font-weight:bold; font-size:1.2rem; margin-bottom:4px; color:#2c3e50;">${item.Korean}</div>
                     <div style="font-size:0.9rem; color:#e74c3c; font-weight:500;">${item.Pronunciation || ''}</div>
                     <div style="font-size:0.95rem; color:#555; margin-top:4px;">${item.Nepali}</div>
                </div>

                <div class="card-actions" style="margin-top: 10px; justify-content: space-between; align-items: flex-end;">
                     <div style="flex-grow:1;">
                        <div style="font-size:0.8rem; color:#666;">Attempts left: <span id="attempts-${index}">2</span></div>
                        <div id="status-${index}" style="font-size:0.85rem; font-weight:bold; margin-top:2px; color:#e67e22;">Mission Ready</div>
                        <div id="${interimId}" class="interim-text" style="font-size:0.9rem; height:1.5rem;"></div>
                     </div>

                     <div style="display:flex; gap:10px;">
                        <button class="btn-icon play-btn" onclick="speakText('${item.Korean}', this)" style="background:#e74c3c; color:white; width:40px; height:40px;">
                             <i class="fas fa-volume-up"></i>
                        </button>
                        <button class="btn-icon mic-btn" id="${micId}" onclick="startListening('${item.Korean}', '${micId}')" style="background:#2ecc71; color:white; width:40px; height:40px;">
                             <i class="fas fa-microphone"></i>
                        </button>
                     </div>
                </div>
             `;
            container.appendChild(div);

            // Init status tracking using Korean text as key
            state.missionStatus[item.Korean] = { attempts: 0, completed: false, maxAttempts: 2 };
        });
    }
}

function updateChallengeUI() {
    if (state.user) updateUserUI();
}

// Updated Mission Success Handler covering Logging
async function handleMissionSuccess(targetText) {
    if (!state.missionStatus[targetText]) return;
    const mission = state.missionStatus[targetText];
    if (mission.completed) return;

    mission.completed = true;
    const index = state.todayMission.findIndex(item => (item.Korean || item) === targetText);

    // UI Update
    if (index !== -1) {
        document.getElementById(`status-${index}`).textContent = '✅ Completed! (+150p)';
        document.getElementById(`status-${index}`).style.color = '#2ecc71';

        // Disable buttons
        const micBtn = document.getElementById(`mission-mic-${index}`);
        const playBtn = micBtn.previousElementSibling; // roughly finding the sibling
        if (micBtn) micBtn.disabled = true;

        // Use new endpoint
        try {
            const response = await fetch(`${BACKEND_URL}/api/mission_result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: state.user.id,
                    sentence: targetText,
                    result: 'success',
                    attempts_used: mission.attempts
                })
            });
            const data = await response.json();
            if (data.success) {
                state.user.points = data.points;
                document.getElementById('user-points').textContent = state.user.points;

                const modalTitle = document.getElementById('feedback-title');
                if (modalTitle && modalTitle.textContent.includes('Welcome')) return; // Dont override login msg
                if (modalTitle) {
                    document.getElementById('feedback-text').textContent = 'Excellent! (+150 Points Earned)';
                    document.getElementById('feedback-text').style.color = '#27ae60';
                    document.getElementById('feedback-text').style.fontWeight = 'bold';
                }
            }
        } catch (e) { console.error(e); }
    }
}

// Updated Mission Failure Handler
async function handleMissionFailure(targetText) {
    if (!state.missionStatus[targetText]) return;
    const mission = state.missionStatus[targetText];
    if (mission.completed) return;

    mission.attempts++;
    const attemptsLeft = Math.max(0, mission.maxAttempts - mission.attempts);

    // Update attempts UI
    const index = state.todayMission.findIndex(item => (item.Korean || item) === targetText);
    if (index !== -1) {
        const attemptEl = document.getElementById(`attempts-${index}`);
        if (attemptEl) attemptEl.textContent = attemptsLeft;

        // Check for FAIL condition
        if (attemptsLeft === 0) {
            // Lock UI
            document.getElementById(`status-${index}`).textContent = 'Today\'s Attempts Failed (Try again tomorrow)';
            document.getElementById(`status-${index}`).style.color = '#e74c3c';

            // Disable buttons
            const micBtn = document.getElementById(`mission-mic-${index}`);
            if (micBtn) {
                micBtn.disabled = true;
                micBtn.style.opacity = '0.5';
                micBtn.parentElement.innerHTML += '<div style="font-size:0.7rem; color:red; margin-top:5px;">Locked</div>';
            }

            // Log Failure
            try {
                await fetch(`${BACKEND_URL}/api/mission_result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: state.user.id,
                        sentence: targetText,
                        result: 'fail',
                        attempts_used: mission.attempts
                    })
                });
            } catch (e) { console.error('Log Fail Error', e); }
        }
    }
}
/ /   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 / /   M o n t h l y   T e s t   L o g i c   ( A u t o   T r i g g e r   o n   L a s t   D a y )  
 / /   = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = =  
 a s y n c   f u n c t i o n   c h e c k A n d S t a r t M o n t h l y T e s t ( )   {  
         c o n s t   t o d a y   =   n e w   D a t e ( ) ;  
         / /   T E S T   O V E R R I D E :   U n c o m m e n t   n e x t   l i n e   t o   f o r c e   t e s t   f o r   d e b u g g i n g  
         / /   c o n s t   t o d a y   =   n e w   D a t e ( 2 0 2 5 ,   0 ,   3 1 ) ;    
  
         c o n s t   t o m o r r o w   =   n e w   D a t e ( t o d a y ) ;  
         t o m o r r o w . s e t D a t e ( t o d a y . g e t D a t e ( )   +   1 ) ;  
  
         / /   C h e c k   i f   t o m o r r o w   i s   t h e   1 s t   o f   n e x t   m o n t h   - >   T o d a y   i s   L a s t   D a y  
         i f   ( t o m o r r o w . g e t D a t e ( )   = = =   1 )   {  
                 c o n s o l e . l o g ( " I t   i s   t h e   l a s t   d a y   o f   t h e   m o n t h !   P r e p a r i n g   M o n t h l y   T e s t . . . " ) ;  
  
                 / /   1 .   G e n e r a t e   T e s t   P o o l   ( R e - r u n   s e e d e d   R N G   f o r   a l l   d a y s   o f   t h i s   m o n t h )  
                 c o n s t   c u r r e n t M o n t h P o o l   =   n e w   S e t ( ) ;  
                 c o n s t   y e a r   =   t o d a y . g e t F u l l Y e a r ( ) ;  
                 c o n s t   m o n t h   =   t o d a y . g e t M o n t h ( ) ;   / /   0 - i n d e x e d  
  
                 / /   L o o p   f r o m   D a y   1   t o   Y e s t e r d a y  
                 f o r   ( l e t   d   =   1 ;   d   <   t o d a y . g e t D a t e ( ) ;   d + + )   {  
                         c o n s t   d a t e O b j   =   n e w   D a t e ( y e a r ,   m o n t h ,   d ) ;  
                         c o n s t   r n g   =   n e w   S e e d e d R a n d o m ( d a t e O b j . t o D a t e S t r i n g ( ) ) ;  
                         / /   S h u f f l e   l o g i c   C O P Y  
                         c o n s t   d a y P o o l   =   [ . . . s t a t e . d a t a ] ;  
                         f o r   ( l e t   i   =   d a y P o o l . l e n g t h   -   1 ;   i   >   0 ;   i - - )   {  
                                 c o n s t   j   =   M a t h . f l o o r ( r n g . n e x t ( )   *   ( i   +   1 ) ) ;  
                                 [ d a y P o o l [ i ] ,   d a y P o o l [ j ] ]   =   [ d a y P o o l [ j ] ,   d a y P o o l [ i ] ] ;  
                         }  
                         / /   A d d   t h a t   d a y ' s   2   m i s s i o n s  
                         c u r r e n t M o n t h P o o l . a d d ( d a y P o o l [ 0 ] ) ;  
                         c u r r e n t M o n t h P o o l . a d d ( d a y P o o l [ 1 ] ) ;  
                 }  
  
                 / /   C o n v e r t   S e t   t o   A r r a y   a n d   P i c k   1 0   R a n d o m l y  
                 c o n s t   t e s t Q u e s t i o n s   =   A r r a y . f r o m ( c u r r e n t M o n t h P o o l )  
                         . s o r t ( ( )   = >   0 . 5   -   M a t h . r a n d o m ( ) )  
                         . s l i c e ( 0 ,   1 0 ) ;  
  
                 i f   ( t e s t Q u e s t i o n s . l e n g t h   <   1 0 )   {  
                         c o n s o l e . w a r n ( " N o t   e n o u g h   h i s t o r y   f o r   t e s t .   U s i n g   r a n d o m   p o o l . " ) ;  
                         / /   F a l l b a c k   i f   n o t   e n o u g h   d a y s   p a s s e d  
                 }  
  
                 s t a r t M o n t h l y T e s t U I ( t e s t Q u e s t i o n s ) ;  
         }  
 }  
  
 f u n c t i o n   s t a r t M o n t h l y T e s t U I ( q u e s t i o n s )   {  
         i f   ( ! q u e s t i o n s   | |   q u e s t i o n s . l e n g t h   = = =   0 )   r e t u r n ;  
  
         / /   C r e a t e   M o d a l   U I   d y n a m i c a l l y  
         c o n s t   m o d a l I d   =   ' m o n t h l y - t e s t - m o d a l ' ;  
         l e t   m o d a l   =   d o c u m e n t . g e t E l e m e n t B y I d ( m o d a l I d ) ;  
         i f   ( ! m o d a l )   {  
                 m o d a l   =   d o c u m e n t . c r e a t e E l e m e n t ( ' d i v ' ) ;  
                 m o d a l . i d   =   m o d a l I d ;  
                 m o d a l . c l a s s N a m e   =   ' m o d a l - o v e r l a y ' ;  
                 m o d a l . s t y l e . d i s p l a y   =   ' f l e x ' ;   / /   F o r c e   s h o w  
                 d o c u m e n t . b o d y . a p p e n d C h i l d ( m o d a l ) ;  
         }  
  
         l e t   c u r r e n t Q I n d e x   =   0 ;  
         l e t   s c o r e   =   0 ;  
  
         f u n c t i o n   r e n d e r Q u e s t i o n ( )   {  
                 i f   ( c u r r e n t Q I n d e x   > =   q u e s t i o n s . l e n g t h )   {  
                         f i n i s h T e s t ( s c o r e ,   q u e s t i o n s . l e n g t h ) ;  
                         r e t u r n ;  
                 }  
  
                 c o n s t   q   =   q u e s t i o n s [ c u r r e n t Q I n d e x ] ;  
                 m o d a l . i n n e r H T M L   =   `  
                         < d i v   c l a s s = " m o d a l - c o n t e n t "   s t y l e = " m a x - w i d t h : 5 0 0 p x ;   t e x t - a l i g n : c e n t e r ; " >  
                                 < h 2   s t y l e = " c o l o r : # d 3 5 4 0 0 ; " > M o n t h l y   E v a l u a t i o n   ( ? ��Z�  ? /�? ) < / h 2 >  
                                 < d i v   s t y l e = " f o n t - w e i g h t : b o l d ;   m a r g i n - b o t t o m : 2 0 p x ; " >  
                                         Q u e s t i o n   $ { c u r r e n t Q I n d e x   +   1 }   /   $ { q u e s t i o n s . l e n g t h }  
                                 < / d i v >  
                                  
                                 < d i v   c l a s s = " c a r d "   s t y l e = " m a r g i n - b o t t o m : 2 0 p x ;   t e x t - a l i g n : l e f t ; " >  
                                           < d i v   c l a s s = " s e n t e n c e - k o r e a n " > $ { q . K o r e a n } < / d i v >  
                                           < d i v   c l a s s = " s e n t e n c e - p r o n u n c i a t i o n " > $ { q . P r o n u n c i a t i o n } < / d i v >  
                                           < d i v   c l a s s = " s e n t e n c e - m e a n i n g " > $ { q . N e p a l i } < / d i v >  
                                 < / d i v >  
                                  
                                 < p > S p e a k   t h e   K o r e a n   s e n t e n c e ! < / p >  
                                 < d i v   s t y l e = " m a r g i n : 2 0 p x   0 ; " >  
                                         < b u t t o n   i d = " t e s t - m i c - b t n "   c l a s s = " b t n - i c o n   m i c - b t n "   s t y l e = " w i d t h : 6 0 p x ;   h e i g h t : 6 0 p x ;   m a r g i n : 0   a u t o ;   b a c k g r o u n d : # 2 e c c 7 1 ;   c o l o r : w h i t e ; " >  
                                                 < i   c l a s s = " f a s   f a - m i c r o p h o n e "   s t y l e = " f o n t - s i z e : 1 . 5 r e m ; " > < / i >  
                                         < / b u t t o n >  
                                         < d i v   i d = " t e s t - i n t e r i m "   s t y l e = " h e i g h t : 2 0 p x ;   m a r g i n - t o p : 1 0 p x ;   c o l o r : # 2 e c c 7 1 ; " > < / d i v >  
                                 < / d i v >  
                                 < d i v   s t y l e = " f o n t - s i z e : 0 . 8 r e m ;   c o l o r : # a a a ; " > 2   a t t e m p t s   a l l o w e d < / d i v >  
                         < / d i v >  
                 ` ;  
  
                 / /   H a n d l e   T e s t   M i c   L o g i c   ( S i m p l i f i e d   f o r   b r e v i t y )  
                 c o n s t   m i c B t n   =   d o c u m e n t . g e t E l e m e n t B y I d ( ' t e s t - m i c - b t n ' ) ;  
                 l e t   a t t e m p t s   =   2 ;  
  
                 m i c B t n . o n c l i c k   =   ( )   = >   {  
                         / /   R e - u s e   l o g i c   o r   b e s p o k e   f o r   t e s t ?   B e s p o k e   f o r   s a f e t y  
                         / /   J u s t   s i m u l a t i o n   c a l l   t o   e x i s t i n g   s t a r t L i s t e n i n g   b u t   o v e r r i d e   c a l l b a c k ? ?  
                         / /   F o r   n o w ,   l e t ' s   j u s t   u s e   e x i s t i n g   s t a r t L i s t e n i n g   b u t   h i j a c k   t h e   r e s u l t   h a n d l i n g  
                         / /   T h i s   i s   t r i c k y .   L e t ' s   m a k e   a   s i m p l i f i e d   t e s t   l i s t e n e r .  
                         r u n T e s t R e c o g n i t i o n ( q . K o r e a n ,   m i c B t n ,   ( s u c c e s s )   = >   {  
                                 i f   ( s u c c e s s )   {  
                                         s c o r e + + ;  
                                         c u r r e n t Q I n d e x + + ;  
                                         a l e r t ( ' C o r r e c t !   ( ? ����) ' ) ;  
                                         r e n d e r Q u e s t i o n ( ) ;  
                                 }   e l s e   {  
                                         a t t e m p t s - - ;  
                                         i f   ( a t t e m p t s   < =   0 )   {  
                                                 a l e r t ( ' F a i l e d   ( ? {1��) .   N e x t   Q u e s t i o n . ' ) ;  
                                                 c u r r e n t Q I n d e x + + ;  
                                                 r e n d e r Q u e s t i o n ( ) ;  
                                         }   e l s e   {  
                                                 a l e r t ( ' T r y   A g a i n   ( ? |1��  ? ��ĸ) .   1   a t t e m p t   l e f t . ' ) ;  
                                         }  
                                 }  
                         } ) ;  
                 } ;  
         }  
  
         r e n d e r Q u e s t i o n ( ) ;  
 }  
  
 / /   W r a p p e r   f o r   T e s t   R e c o g n i t i o n  
 f u n c t i o n   r u n T e s t R e c o g n i t i o n ( t a r g e t ,   b t n E l e m e n t ,   c a l l b a c k )   {  
         i f   ( ! ( ' w e b k i t S p e e c h R e c o g n i t i o n '   i n   w i n d o w ) )   {  
                 / /   F a l l b a c k   f o r   n o n - s u p p o r t e d   ( M o c k   s u c c e s s   f o r   d e v ? )  
                 a l e r t ( ' B r o w s e r   n o t   s u p p o r t e d ' ) ;  
                 c a l l b a c k ( f a l s e ) ;  
                 r e t u r n ;  
         }  
         c o n s t   r e c o g n i t i o n   =   n e w   ( w i n d o w . S p e e c h R e c o g n i t i o n   | |   w i n d o w . w e b k i t S p e e c h R e c o g n i t i o n ) ( ) ;  
         r e c o g n i t i o n . l a n g   =   ' k o - K R ' ;  
         r e c o g n i t i o n . m a x A l t e r n a t i v e s   =   1 ;  
  
         b t n E l e m e n t . c l a s s L i s t . a d d ( ' r e c o r d i n g ' ) ;  
         r e c o g n i t i o n . s t a r t ( ) ;  
  
         r e c o g n i t i o n . o n r e s u l t   =   ( e v e n t )   = >   {  
                 c o n s t   t r a n s c r i p t   =   e v e n t . r e s u l t s [ 0 ] [ 0 ] . t r a n s c r i p t ;  
                 c o n s t   a c c u r a c y   =   c o m p a r e S t r i n g s ( t r a n s c r i p t ,   t a r g e t ) ;  
                 b t n E l e m e n t . c l a s s L i s t . r e m o v e ( ' r e c o r d i n g ' ) ;  
  
                 i f   ( a c c u r a c y   >   0 . 7 )   c a l l b a c k ( t r u e ) ;  
                 e l s e   c a l l b a c k ( f a l s e ) ;  
         } ;  
  
         r e c o g n i t i o n . o n e r r o r   =   ( )   = >   {  
                 b t n E l e m e n t . c l a s s L i s t . r e m o v e ( ' r e c o r d i n g ' ) ;  
                 c a l l b a c k ( f a l s e ) ;  
         } ;  
 }  
  
 a s y n c   f u n c t i o n   f i n i s h T e s t ( s c o r e ,   t o t a l )   {  
         c o n s t   p e r c e n t a g e   =   ( s c o r e   /   t o t a l )   *   1 0 0 ;  
         c o n s t   i s P a s s   =   p e r c e n t a g e   > =   7 0 ;  
         c o n s t   r e s u l t   =   i s P a s s   ?   ' P A S S '   :   ' F A I L ' ;  
  
         c o n s t   t o d a y   =   n e w   D a t e ( ) ;  
         c o n s t   m o n t h S t r   =   ` $ { t o d a y . g e t F u l l Y e a r ( ) } - $ { S t r i n g ( t o d a y . g e t M o n t h ( )   +   1 ) . p a d S t a r t ( 2 ,   ' 0 ' ) } ` ;  
  
         / /   S a v e   R e s u l t  
         t r y   {  
                 a w a i t   f e t c h ( ` $ { B A C K E N D _ U R L } / a p i / m o n t h l y _ t e s t ` ,   {  
                         m e t h o d :   ' P O S T ' ,  
                         h e a d e r s :   {   ' C o n t e n t - T y p e ' :   ' a p p l i c a t i o n / j s o n '   } ,  
                         b o d y :   J S O N . s t r i n g i f y ( {   u s e r I d :   s t a t e . u s e r . i d ,   s c o r e :   p e r c e n t a g e ,   r e s u l t ,   m o n t h :   m o n t h S t r   } )  
                 } ) ;  
         }   c a t c h   ( e )   {   c o n s o l e . e r r o r ( e ) ;   }  
  
         / /   R e m o v e   M o d a l  
         d o c u m e n t . g e t E l e m e n t B y I d ( ' m o n t h l y - t e s t - m o d a l ' ) . r e m o v e ( ) ;  
  
         / /   F i n a l   A l e r t  
         i f   ( i s P a s s )   {  
                 a l e r t ( ` ? �  T E S T   P A S S E D !   S c o r e :   $ { p e r c e n t a g e } % . \ n \ n M o n t h l y   p o i n t s   a w a r d e d . ` ) ;  
         }   e l s e   {  
                 a l e r t ( ` T E S T   F A I L E D .   S c o r e :   $ { p e r c e n t a g e } % . \ n \ n P l e a s e   s t u d y   m o r e   n e x t   m o n t h . ` ) ;  
         }  
 }  
 