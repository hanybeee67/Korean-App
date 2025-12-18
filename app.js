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
    isListening: false
};

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
                    // Map Google Sheet columns to App internal state
                    const mappedData = results.data.map(row => ({
                        Category: row['대분류'] || '기타',
                        Situation: row['상황'] || '',
                        Korean: row['한국어'] || '',
                        Pronunciation: row['발음(नेपाली लिपि)'] || '',
                        Nepali: row['네팔어'] || ''
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
window.startListening = function (targetText, btnId) {
    // iOS Detection
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isIOS) {
        alert('아이폰(iOS)은 보안 정책상 \n웹사이트 음성 인식을 지원하지 않습니다.\n(듣기 연습만 가능합니다)');
        return;
    }

    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert('이 브라우저는 음성 인식을 지원하지 않습니다.\n(안드로이드 Chrome을 사용해주세요)');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const btn = document.getElementById(btnId);

    recognition.onstart = () => {
        btn.classList.add('recording');
    };

    recognition.onend = () => {
        btn.classList.remove('recording');
    };

    recognition.onresult = (event) => {
        const script = event.results[0][0].transcript;
        const accuracy = compareStrings(script, targetText);

        // Simple feedback alert
        if (accuracy > 0.7) {
            alert(`धेरै राम्रो! (Great!)\nतपाईंको उच्चारण: "${script}"`);
        } else {
            alert(`फेरि प्रयास गर्नुहोस् (Try again)\n\nYou said: "${script}"`);
        }
    };

    try {
        recognition.start();
    } catch (e) {
        alert('마이크 권한을 확인해주세요.');
    }
};

// Simple string similarity for feedback (Levenshtein distance based simplified)
function compareStrings(s1, s2) {
    s1 = s1.replace(/\s+/g, '').replace(/[.,?!]/g, '');
    s2 = s2.replace(/\s+/g, '').replace(/[.,?!]/g, '');

    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;
    return 0.5; // Placeholder logic
}
