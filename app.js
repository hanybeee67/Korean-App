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
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1Z2a6HhVooEh3uJ-bhdip74PENPLZeC9A/export?format=csv&t=' + new Date().getTime();

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

    // 0. Environment Detection
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isIOS = /iPad|iPhone|iPod/.test(userAgent) && !window.MSStream;

    // 1. Try Native Capacitor TTS Plugin (Preferred for stable Android)
    if (TextToSpeech && !isIOS) { // Skip Native Plugin on iOS to use WebSpeech's better voice control if preferred
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

    // 2. Web Speech API (Primary for iOS & Fallback for Android)
    const synth = getSynth();
    const UtteranceClass = getUtteranceClass();

    if (!synth || !UtteranceClass) {
        // ... Error Alert Logic ...
        alert(`[Error] TTS Engine not found.`);
        if (icon) icon.style.opacity = '1';
        return;
    }

    // Stop manual playback if already speaking
    synth.cancel();

    setTimeout(() => {
        try {
            const utterance = new UtteranceClass(text);
            utterance.lang = 'ko-KR';

            // --- iOS Optimization ---
            // --- iOS Optimization ---
            if (isIOS) {
                // iPhone defaults to a very slow rate for Korean sometimes. Boost it.
                // User Feedback: "Too fast" at 1.1 -> Lowering to 0.85
                utterance.rate = 0.85;

                // Voice Selection Strategy for iOS
                // Try to find high quality Apple voices
                const voice = voices.find(v => v.name.includes('Yuna') || v.name.includes('Sora') || v.name.includes('Damian') || v.lang === 'ko-KR');
                if (voice) {
                    utterance.voice = voice;
                    // If it's a "Compact" voice, it might be the robotic one. High quality ones usually don't have "Compact" in name sometimes on older iOS.
                    // But generally picking a specific named one is safer.
                }
            } else {
                // Android / Desktop
                utterance.rate = 1.0;
                let korVoice = voices.find(v => v.lang.includes('ko-KR')) || voices.find(v => v.lang.includes('ko'));
                if (korVoice) utterance.voice = korVoice;
            }
            // -------------------------

            utterance.onend = () => { if (icon) icon.style.opacity = '1'; };
            utterance.onerror = (e) => {
                if (e.error !== 'interrupted' && e.error !== 'canceled') {
                    console.error('TTS Error:', e.error);
                }
                if (icon) icon.style.opacity = '1';
            };

            synth.speak(utterance);
        } catch (err) {
            console.error(err);
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

    // --- Critical Fix for iPhone Freezing: Abort previous instance ---
    if (window.currentRecognition) {
        try {
            window.currentRecognition.abort();
        } catch (e) { console.warn('Abort error:', e); }
        window.currentRecognition = null;
    }
    // ---------------------------------------------------------------

    const recognition = new SpeechRecognition();
    window.currentRecognition = recognition; // Track current instance

    recognition.lang = 'ko-KR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

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
                if (state.user && state.todayMission.some(m => (m.Korean || m) === targetText)) {
                    // Pass server message handling in app.js if needed or just handle here?
                    // Ideally handleMissionSuccess makes the API call and returns the message.
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

    // Fallback Data (Hardcoded 9 Branches)
    const FALLBACK_BRANCHES = [
        { id: '1', name: '동대문 본점' },
        { id: '2', name: '영등포점' },
        { id: '3', name: '굿모닝시티점' },
        { id: '4', name: '양재점' },
        { id: '5', name: '수원 영통점' },
        { id: '6', name: '하남스타필드점' },
        { id: '7', name: '동탄 롯데백화점점' },
        { id: '8', name: '마곡 원그로브점' },
        { id: '9', name: '룸비니' }
    ];

    try {
        // Add timestamp to prevent caching
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s Timeout

        const res = await fetch(`${BACKEND_URL}/api/branches?t=${new Date().getTime()}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error('Server response not ok');

        const branches = await res.json();
        if (!branches || branches.length === 0) throw new Error('Empty branch list');

        select.innerHTML = '<option value="">Select Branch (지점 선택)</option>';
        branches.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.name; // Use NAME as value for robustness (Server now supports it)
            opt.dataset.id = b.id; // Keep ID in dataset just in case
            opt.textContent = b.name;
            select.appendChild(opt);
        });
    } catch (e) {
        console.warn('Failed to load branches from server, using fallback.', e);

        // Use Fallback
        select.innerHTML = '<option value="">Select Branch (지점 선택)</option>';
        FALLBACK_BRANCHES.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b.name; // Use NAME as value
            opt.textContent = b.name;
            select.appendChild(opt);
        });
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

    // Updated Logic: Send BOTH branch_name and branch_id for maximum compatibility
    const selectedName = branchSelect.value;
    let targetBranchId = null;

    // Try to find ID from dataset (if loaded from server)
    const selectedOption = branchSelect.options[branchSelect.selectedIndex];
    if (selectedOption && selectedOption.dataset.id) {
        targetBranchId = selectedOption.dataset.id;
    } else {
        // Fallback: Map Name to ID manually
        const BRANCH_MAP = {
            '동대문 본점': '1',
            '영등포점': '2',
            '굿모닝시티점': '3',
            '양재점': '4',
            '수원 영통점': '5',
            '하남스타필드점': '6',
            '동탄 롯데백화점점': '7',
            '마곡 원그로브점': '8',
            '룸비니': '9'
        };
        targetBranchId = BRANCH_MAP[selectedName] || null;
    }

    const payload = {
        name,
        password,
        branch_name: selectedName,
        branch_id: targetBranchId // Send explicit ID if found
    };

    try {
        const response = await fetch(`${BACKEND_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
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
                document.getElementById('feedback-text').textContent = 'Registration Successful! Please login.';

                switchAuthMode('login');
            }
        } else {
            msg.textContent = data.message || 'Action failed';
        }
    } catch (e) {
        console.error(e);
        msg.textContent = 'Server connection failed: ' + e.message;
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

        state.todayMission = pool.slice(0, 3);

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

// ==========================================
// Monthly Test Logic (Auto Trigger on Last Day)
// ==========================================
async function checkAndStartMonthlyTest() {
    const today = new Date();
    // TEST OVERRIDE: Uncomment next line to force test for debugging
    // const today = new Date(2025, 0, 31); 

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // Check if tomorrow is the 1st of next month -> Today is Last Day
    if (tomorrow.getDate() === 1) {
        console.log("It is the last day of the month! Preparing Monthly Test...");

        // 1. Generate Test Pool (Re-run seeded RNG for all days of this month)
        const currentMonthPool = new Set();
        const year = today.getFullYear();
        const month = today.getMonth(); // 0-indexed

        // Loop from Day 1 to Yesterday
        for (let d = 1; d < today.getDate(); d++) {
            const dateObj = new Date(year, month, d);
            const rng = new SeededRandom(dateObj.toDateString());
            // Shuffle logic COPY
            const dayPool = [...state.data];
            for (let i = dayPool.length - 1; i > 0; i--) {
                const j = Math.floor(rng.next() * (i + 1));
                [dayPool[i], dayPool[j]] = [dayPool[j], dayPool[i]];
            }
            // Add that day's 2 missions
            currentMonthPool.add(dayPool[0]);
            currentMonthPool.add(dayPool[1]);
        }

        // Convert Set to Array and Pick 10 Randomly
        const testQuestions = Array.from(currentMonthPool)
            .sort(() => 0.5 - Math.random())
            .slice(0, 10);

        if (testQuestions.length < 10) {
            console.warn("Not enough history for test. Using random pool.");
            // Fallback if not enough days passed
        }

        startMonthlyTestUI(testQuestions);
    }
}

function startMonthlyTestUI(questions) {
    if (!questions || questions.length === 0) return;

    // Create Modal UI dynamically
    const modalId = 'monthly-test-modal';
    let modal = document.getElementById(modalId);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal-overlay';
        modal.style.display = 'flex'; // Force show
        document.body.appendChild(modal);
    }

    let currentQIndex = 0;
    let score = 0;

    function renderQuestion() {
        if (currentQIndex >= questions.length) {
            finishTest(score, questions.length);
            return;
        }

        const q = questions[currentQIndex];
        modal.innerHTML = `
            <div class="modal-content" style="max-width:500px; text-align:center;">
                <h2 style="color:#d35400;">Monthly Evaluation (월말 평가)</h2>
                <div style="font-weight:bold; margin-bottom:20px;">
                    Question ${currentQIndex + 1} / ${questions.length}
                </div>
                
                <div class="card" style="margin-bottom:20px; text-align:left;">
                     <div class="sentence-korean">${q.Korean}</div>
                     <div class="sentence-pronunciation">${q.Pronunciation}</div>
                     <div class="sentence-meaning">${q.Nepali}</div>
                </div>
                
                <p>Speak the Korean sentence!</p>
                <div style="margin:20px 0;">
                    <button id="test-mic-btn" class="btn-icon mic-btn" style="width:60px; height:60px; margin:0 auto; background:#2ecc71; color:white;">
                        <i class="fas fa-microphone" style="font-size:1.5rem;"></i>
                    </button>
                    <div id="test-interim" style="height:20px; margin-top:10px; color:#2ecc71;"></div>
                </div>
                <div style="font-size:0.8rem; color:#aaa;">2 attempts allowed</div>
            </div>
        `;

        // Handle Test Mic Logic (Simplified for brevity)
        const micBtn = document.getElementById('test-mic-btn');
        let attempts = 2;

        micBtn.onclick = () => {
            // Re-use logic or bespoke for test? Bespoke for safety
            // Just simulation call to existing startListening but override callback??
            // For now, let's just use existing startListening but hijack the result handling
            // This is tricky. Let's make a simplified test listener.
            runTestRecognition(q.Korean, micBtn, (success) => {
                if (success) {
                    score++;
                    currentQIndex++;
                    alert('Correct! (정답)');
                    renderQuestion();
                } else {
                    attempts--;
                    if (attempts <= 0) {
                        alert('Failed (오답). Next Question.');
                        currentQIndex++;
                        renderQuestion();
                    } else {
                        alert('Try Again (다시 시도). 1 attempt left.');
                    }
                }
            });
        };
    }

    renderQuestion();
}

// Wrapper for Test Recognition
function runTestRecognition(target, btnElement, callback) {
    if (!('webkitSpeechRecognition' in window)) {
        // Fallback for non-supported (Mock success for dev?)
        alert('Browser not supported');
        callback(false);
        return;
    }
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'ko-KR';
    recognition.maxAlternatives = 1;

    btnElement.classList.add('recording');
    recognition.start();

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const accuracy = compareStrings(transcript, target);
        btnElement.classList.remove('recording');

        if (accuracy > 0.7) callback(true);
        else callback(false);
    };

    recognition.onerror = () => {
        btnElement.classList.remove('recording');
        callback(false);
    };
}

async function finishTest(score, total) {
    const percentage = (score / total) * 100;
    const isPass = percentage >= 70;
    const result = isPass ? 'PASS' : 'FAIL';

    const today = new Date();
    const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    // Save Result
    try {
        await fetch(`${BACKEND_URL}/api/monthly_test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.user.id, score: percentage, result, month: monthStr })
        });
    } catch (e) { console.error(e); }

    // Remove Modal
    document.getElementById('monthly-test-modal').remove();

    // Final Alert
    if (isPass) {
        alert(`🎉 TEST PASSED! Score: ${percentage}%.\n\nMonthly points awarded.`);
    } else {
        alert(`TEST FAILED. Score: ${percentage}%.\n\nPlease study more next month.`);
    }
}
