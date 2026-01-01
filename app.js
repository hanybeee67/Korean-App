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
    // Everest-Pay State
    user: null, // { id, name, branch, total_points, level }
    dailyMissions: [] // [{...text, completed: bool}]
};

// API Configuration
// Use the current window location (origin) as the base URL
// This allows the app to work regardless of the server IP change
const API_BASE_URL = window.location.origin;
// const API_BASE_URL = 'http://192.168.0.3:3000'; // Legacy Hardcoded IP

// Google Sheet Published CSV URL
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRo4iD3re1NbdQt7ok1xP41jIOZ_LTBciO7oBWLHaZR7cNajUlTZvlwONDRKIlZlm6UThP8zxDK5pmO/pub?output=csv';

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

// Everest-Pay DOM
const epWidget = document.getElementById('ep-widget');
const userLevelBadge = document.getElementById('user-level-badge');
const userBalance = document.getElementById('user-balance');
const missionSection = document.getElementById('mission-section');
const missionContainer = document.getElementById('mission-container');

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

    // Check Login
    checkLogin();

    await loadData();
    renderCategories();
    renderCards();

    // Click outside to close menu
    document.addEventListener('click', (e) => {
        const wrapper = document.querySelector('.category-wrapper');
        if (wrapper && !wrapper.contains(e.target)) {
            categoryDropdown.classList.remove('show');
            categoryHeader.classList.remove('open');
        }
    });

    // Check query params for Admin mode
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'admin') {
        renderAdminDashboard();
    }
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
                clearTimeout(safetyTimeout);
                if (results.data && results.data.length > 0) {
                    const mappedData = results.data.map(row => ({
                        Category: row['대분류'] || '기타',
                        Situation: row['상황'] || '',
                        Korean: row['한국어'] || '',
                        Pronunciation: row['발음(नेपाली लिपि)'] || '',
                        Nepali: row['네팔어'] || ''
                    })).filter(item => item.Korean);

                    if (mappedData.length > 0) {
                        state.data = mappedData;
                        initCategories();
                        renderCategories();
                        renderCards();

                        // Initialize Daily Mission after data load
                        initDailyMission();
                        return;
                    }
                }
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
    initDailyMission();

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
    const activeLabel = CATEGORY_TRANSLATIONS[state.activeCategory] || state.activeCategory;
    categoryLabel.textContent = state.activeCategory === 'All' ? 'Choose Category (메뉴 선택)' : activeLabel;

    state.categories.forEach(cat => {
        const chip = document.createElement('div');
        chip.className = `chip ${state.activeCategory === cat ? 'active' : ''}`;
        const displayCat = CATEGORY_TRANSLATIONS[cat] || cat;
        chip.textContent = displayCat;

        chip.onclick = (e) => {
            e.stopPropagation();
            state.activeCategory = cat;
            renderCategories();
            renderCards();
            categoryDropdown.classList.remove('show');
            categoryHeader.classList.remove('open');
        };
        categoryDropdown.appendChild(chip);
    });
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
        // Prevent ID conflict with mission cards
        const uniqueId = `card-${index}`;
        card.className = 'card';
        card.innerHTML = `
            <div class="sentence-korean">${item.Korean}</div>
            <div class="sentence-pronunciation">${item.Pronunciation || ''}</div>
            <div class="sentence-meaning">${item.Nepali}</div>
            <div class="card-actions">
                <div class="interim-text" id="interim-${uniqueId}"></div>
                <button class="btn-icon play-btn" onclick="speakText('${item.Korean}', this)" aria-label="Listen" style="background:#e74c3c; color:white;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                </button>
                <button class="btn-icon mic-btn" id="mic-${uniqueId}" onclick="startListening('${item.Korean}', 'mic-${uniqueId}')" aria-label="Speak" style="background:#2ecc71; color:white;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
                </button>
            </div>
        `;
        cardContainer.appendChild(card);
    });
}

// ------ Everest-Pay & Mission Logic ------

function checkLogin() {
    const savedUser = localStorage.getItem('everestUser');
    if (savedUser) {
        state.user = JSON.parse(savedUser);
        updateHeaderUI();
        // Sync with server if needed
    } else {
        openModal('login-modal');
    }
}

window.handleLogin = async function () {
    const branch = document.getElementById('login-branch').value;
    const name = document.getElementById('login-name').value;

    if (!branch || !name) {
        alert('Please fill all fields (지점과 이름을 입력해주세요).');
        return;
    }

    // Call API
    try {
        const res = await fetch(`${API_BASE_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, branch })
        });

        let data = { success: false };
        if (res.ok) {
            data = await res.json();
        } else {
            console.warn('Backend not responding, using local mock');
            // Mock Login for local testing without running server
            data = {
                success: true,
                user: { id: Date.now(), name, branch, total_points: 0, level: 1 }
            };
        }

        if (data.success) {
            state.user = data.user;
            localStorage.setItem('everestUser', JSON.stringify(state.user));
            updateHeaderUI();
            closeModal('login-modal');
        } else {
            alert('Login Failed (로그인 실패)');
        }
    } catch (e) {
        console.error('Login Error:', e);
        // Fallback for demo
        state.user = { id: 999, name, branch, total_points: 0, level: 1 };
        localStorage.setItem('everestUser', JSON.stringify(state.user));
        updateHeaderUI();
        closeModal('login-modal');
    }
}

function updateHeaderUI() {
    if (!state.user) return;

    epWidget.style.display = 'flex';
    userLevelBadge.textContent = getLevelLabel(state.user.level);
    userBalance.textContent = state.user.total_points.toLocaleString();

    // Update profile modal
    document.getElementById('profile-name').textContent = state.user.name;
    document.getElementById('profile-branch').textContent = state.user.branch;
    document.getElementById('profile-balance').textContent = state.user.total_points.toLocaleString();
}

function getLevelLabel(level) {
    if (level === 1) return '🌱 Intern (수습)';
    if (level === 2) return '🌿 Staff (사원)';
    if (level === 3) return '🌳 Senior (대리)';
    if (level >= 4) return '👑 Manager (매니저)';
    return '🌱 Intern';
}

function initDailyMission() {
    if (state.data.length === 0) return;

    // Check Local Storage for today's mission
    const today = new Date().toISOString().split('T')[0];
    const savedMission = JSON.parse(localStorage.getItem('everestDailyMission'));

    if (savedMission && savedMission.date === today) {
        state.dailyMissions = savedMission.missions;
    } else {
        // Generate New Mission (Random 2 items)
        const candidates = state.data.sort(() => 0.5 - Math.random()).slice(0, 2);
        state.dailyMissions = candidates.map(item => ({
            ...item,
            completed: false
        }));
        localStorage.setItem('everestDailyMission', JSON.stringify({
            date: today,
            missions: state.dailyMissions
        }));
    }

    renderMissions();
}

function renderMissions() {
    missionSection.style.display = 'block';
    missionContainer.innerHTML = '';

    state.dailyMissions.forEach((item, index) => {
        const card = document.createElement('div');
        const uniqueId = `mission-${index}`;
        card.className = `card mission-card ${item.completed ? 'mission-complete' : ''}`;
        card.innerHTML = `
            ${item.completed ? '<div style="position:absolute; top:10px; right:10px; color:#2ecc71; font-weight:bold;">Success! (+200₩)</div>' : ''}
            <div class="sentence-korean">${item.Korean}</div>
            <div class="sentence-pronunciation">${item.Pronunciation || ''}</div>
            <div class="sentence-meaning">${item.Nepali}</div>
            <div class="card-actions">
                <div class="interim-text" id="interim-${uniqueId}"></div>
                <button class="btn-icon play-btn" onclick="speakText('${item.Korean}', this)" aria-label="Listen">
                    <i class="fas fa-volume-up"></i>
                </button>
                <button class="btn-icon mic-btn" id="mic-${uniqueId}" onclick="startListening('${item.Korean}', 'mic-${uniqueId}', true)" aria-label="Speak">
                    <i class="fas fa-microphone"></i>
                </button>
            </div>
        `;
        missionContainer.appendChild(card);
    });
}

// ------ Core Logic: TTS & STT ------

// ... (TTS functions same as before)
function getSynth() {
    return window.speechSynthesis || window.webkitSpeechSynthesis || (navigator && navigator.speechSynthesis);
}
function getUtteranceClass() {
    return window.SpeechSynthesisUtterance || window.webkitSpeechSynthesisUtterance || window.mozSpeechSynthesisUtterance || window.msSpeechSynthesisUtterance;
}
let voices = [];
function loadVoices() {
    const synth = getSynth();
    if (synth) voices = synth.getVoices();
}
if (getSynth()) {
    if (getSynth().onvoiceschanged !== undefined) getSynth().onvoiceschanged = loadVoices;
    loadVoices();
}

window.speakText = async function (text, btnElement) {
    // ... (Existing TTS Logic preserved)
    const icon = btnElement ? btnElement.querySelector('i') || btnElement.querySelector('svg') : null;
    if (icon) icon.style.opacity = '0.5';

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
            console.warn('Native TTS failed', e);
        }
    }
    const synth = getSynth();
    const UtteranceClass = getUtteranceClass();
    if (!synth || !UtteranceClass) {
        alert('TTS Error');
        if (icon) icon.style.opacity = '1';
        return;
    }
    synth.cancel();
    setTimeout(() => {
        try {
            const utterance = new UtteranceClass(text);
            utterance.lang = 'ko-KR';
            utterance.rate = 0.9;
            let korVoice = voices.find(v => v.lang.includes('ko-KR')) || voices.find(v => v.lang.includes('ko'));
            if (korVoice) utterance.voice = korVoice;
            utterance.onend = () => { if (icon) icon.style.opacity = '1'; };
            synth.speak(utterance);
        } catch (err) { console.error(err); if (icon) icon.style.opacity = '1'; }
    }, 50);
};

// Modified STT to support Missions
window.startListening = async function (targetText, btnId, isMission = false) {
    if (state.isListening) return;

    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert('Browser not supported (Chrome/Safari required).');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    const btn = document.getElementById(btnId);
    // Find interim element by ID replacement
    const interimEl = document.getElementById(btnId.replace('mic-', 'interim-'));

    recognition.onstart = () => {
        state.isListening = true;
        btn.classList.add('recording');
        if (interimEl) interimEl.textContent = 'Listening...';
    };

    recognition.onend = () => {
        setTimeout(() => {
            state.isListening = false;
            btn.classList.remove('recording');
            if (interimEl && interimEl.textContent === 'Listening...') interimEl.textContent = '';
        }, 500);
    };

    recognition.onresult = async (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        if (interimEl) {
            interimEl.textContent = finalTranscript || interimTranscript;
            interimEl.style.color = '#2ecc71';
        }

        if (finalTranscript) {
            const accuracy = compareStrings(finalTranscript, targetText);

            if (accuracy > 0.7) {
                // SUCCESS
                new Audio('clap.mp3').play().catch(e => { });

                if (isMission) {
                    await handleMissionSuccess(targetText, btnId);
                } else {
                    // Regular Feedback
                    showFeedback('Great!', finalTranscript, 'Excellent pronunciation!');
                }
            } else {
                // FAIL
                showFeedback('Try again', finalTranscript, 'Keep practicing!');
            }
        }
    };

    recognition.start();
};

async function handleMissionSuccess(targetText, btnId) {
    // Check if already completed
    const missionIndex = state.dailyMissions.findIndex(m => m.Korean === targetText);
    if (missionIndex !== -1 && !state.dailyMissions[missionIndex].completed) {
        state.dailyMissions[missionIndex].completed = true;

        // Update Local Storage
        const today = new Date().toISOString().split('T')[0];
        localStorage.setItem('everestDailyMission', JSON.stringify({
            date: today,
            missions: state.dailyMissions
        }));

        // Render update (visual complete)
        renderMissions();

        // Add Points via API
        if (state.user) {
            try {
                const res = await fetch(`${API_BASE_URL}/api/score/earn`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: state.user.id,
                        points: 200,
                        description: `Mission: ${targetText.substring(0, 10)}...`
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    state.user.total_points = data.newBalance;
                } else {
                    // fall back local
                    state.user.total_points += 200;
                }
                localStorage.setItem('everestUser', JSON.stringify(state.user));
                updateHeaderUI();

                showFeedback('Mission Complete!', '+ 200 Won Earned', 'Points added to your wallet!');
            } catch (e) {
                // Offline fallback
                state.user.total_points += 200;
                localStorage.setItem('everestUser', JSON.stringify(state.user));
                updateHeaderUI();
                showFeedback('Mission Local Save', '+ 200 Won', 'Server offline, saved locally.');
            }
        }
    } else {
        showFeedback('Great!', targetText, 'You already completed this mission!');
    }
}

function showFeedback(title, sub, text) {
    document.getElementById('feedback-title').textContent = title;
    document.getElementById('feedback-sub').textContent = `"${sub}"`;
    document.getElementById('feedback-text').textContent = text;

    if (title.includes('Great') || title.includes('Mission')) {
        document.getElementById('feedback-icon').innerHTML = '👏';
        document.getElementById('feedback-title').style.color = '#2ecc71';
    } else {
        document.getElementById('feedback-icon').innerHTML = '🎯';
        document.getElementById('feedback-title').style.color = '#e67e22';
    }
    openModal('feedback-modal');
}

function compareStrings(s1, s2) {
    s1 = s1.replace(/\s+/g, '').replace(/[.,?!]/g, '');
    s2 = s2.replace(/\s+/g, '').replace(/[.,?!]/g, '');
    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;
    return 0.5;
}

// Simple Admin Dashboard Render
function renderAdminDashboard() {
    document.body.innerHTML = '<h1>Admin Dashboard</h1><div id="admin-content">Loading...</div>';
    fetch(`${API_BASE_URL}/api/admin/leaderboard`)
        .then(res => res.json())
        .then(data => {
            let html = '<table border="1" style="width:100%; border-collapse:collapse;"><tr><th>Rank</th><th>Name</th><th>Branch</th><th>Points</th></tr>';
            data.forEach((user, idx) => {
                html += `<tr><td>${idx + 1}</td><td>${user.name}</td><td>${user.branch}</td><td>${user.total_points}</td></tr>`;
            });
            html += '</table>';
            html += '<br><button onclick="location.href=\'index.html\'">Back to App</button>';
            document.getElementById('admin-content').innerHTML = html;
        })
        .catch(e => {
            document.getElementById('admin-content').innerHTML = 'Error loading admin data. Is server running?';
        });
}
