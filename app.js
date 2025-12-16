// App State
const state = {
    data: [],
    categories: ['All'],
    activeCategory: 'All',
    isListening: false
};

// Fallback Data (in case CSV fetch fails on local file system)
const FALLBACK_DATA = [
    { Category: 'Hall', Situation: 'Greeting', Korean: '어서 오세요.', Pronunciation: 'Eoseo oseyo.', Nepali: 'Swagat chha.' },
    { Category: 'Hall', Situation: 'Order', Korean: '주문하시겠어요?', Pronunciation: 'Jumun hasigess-eoyo?', Nepali: 'Order garnu hun chha?' },
    { Category: 'Kitchen', Situation: 'Order', Korean: '양파 썰어주세요.', Pronunciation: 'Yangpa ssehen-eo juseyo.', Nepali: 'Pyaj katnuhos.' },
    { Category: 'Daily', Situation: 'Greeting', Korean: '안녕하세요.', Pronunciation: 'Annyeonghaseyo.', Nepali: 'Namaste.' },
    { Category: 'Daily', Situation: 'Thanks', Korean: '감사합니다.', Pronunciation: 'Gamsahamnida.', Nepali: 'Dhanyabaad.' }
];

// DOM Elements
const categoryContainer = document.getElementById('category-container');
const cardContainer = document.getElementById('card-container');

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    renderCategories();
    renderCards();
});

// Data Loading
async function loadData() {
    try {
        const response = await fetch('sample_data.csv');
        if (!response.ok) throw new Error('Network response was not ok');
        const csvText = await response.text();
        
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                if (results.data && results.data.length > 0) {
                    state.data = results.data;
                    initCategories();
                    renderCategories();
                    renderCards();
                }
            }
        });
    } catch (error) {
        console.warn('CSV fetch failed (likely due to local file restrictions), using fallback data.', error);
        state.data = FALLBACK_DATA;
        initCategories();
        renderCategories();
        renderCards();
    }
}

function initCategories() {
    const uniqueCats = [...new Set(state.data.map(item => item.Category).filter(Boolean))];
    state.categories = ['All', ...uniqueCats];
}

// Rendering
function renderCategories() {
    categoryContainer.innerHTML = '';
    state.categories.forEach(cat => {
        const chip = document.createElement('div');
        chip.className = `chip ${state.activeCategory === cat ? 'active' : ''}`;
        chip.textContent = cat;
        chip.onclick = () => {
            state.activeCategory = cat;
            renderCategories();
            renderCards();
        };
        categoryContainer.appendChild(chip);
    });
}

function renderCards() {
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
                <button class="btn-icon play-btn" onclick="speakText('${item.Korean}', this)">
                    <i class="fas fa-volume-up"></i>
                </button>
                <button class="btn-icon mic-btn" id="mic-${index}" onclick="startListening('${item.Korean}', 'mic-${index}')">
                    <i class="fas fa-microphone"></i>
                </button>
            </div>
        `;
        cardContainer.appendChild(card);
    });
}

// TTS (Text to Speech)
window.speakText = function(text, btnElement) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'ko-KR';
        utterance.rate = 0.9; // Slightly slower for better clarity
        
        // Button animation
        const icon = btnElement.querySelector('i');
        const originalClass = icon.className;
        icon.className = 'fas fa-volume-high fa-beat'; // Visual feedback
        
        utterance.onend = () => {
            icon.className = originalClass;
        };

        window.speechSynthesis.speak(utterance);
    } else {
        alert('이 브라우저는 음성 합성을 지원하지 않습니다. (TTS not supported)');
    }
};

// STT (Speech to Text)
window.startListening = function(targetText, btnId) {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 사용해주세요.');
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
        
        // Simple feedback alert for now
        if (accuracy > 0.7) {
            alert(`성공! (Great!)\n당신의 발음: "${script}"\n정확도: Good`);
        } else {
            alert(`다시 시도해보세요. (Try again)\n당신의 발음: "${script}"\n목표: "${targetText}"`);
        }
    };

    recognition.start();
};

// Simple string similarity for feedback (Levenshtein distance based simplified)
function compareStrings(s1, s2) {
    s1 = s1.replace(/\s+/g, '').replace(/[.,?!]/g, '');
    s2 = s2.replace(/\s+/g, '').replace(/[.,?!]/g, '');
    
    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;
    return 0.5; // Placeholder logic
}
