const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const tabBtns = document.querySelectorAll('.tab-btn');
const searchTab = document.getElementById('search-tab');
const chatTab = document.getElementById('chat-tab');
const searchResultsView = document.getElementById('searchResultsView');
const chatView = document.getElementById('chatView');
const backToSearchBtn = document.getElementById('backToSearch');
const searchBtn = document.getElementById('searchBtn');
const rhymePattern = document.getElementById('rhymePattern');
const singerFilter = document.getElementById('singerFilter');
const themeFilter = document.getElementById('themeFilter');
const regionFilter = document.getElementById('regionFilter');
const yearFilter = document.getElementById('yearFilter');
const resultsContainer = document.getElementById('resultsContainer');
const loadingIndicator = document.getElementById('loading');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const chatMessages = document.getElementById('chatMessages');

// ─────────────────────────────────────────────
// CULTURAL KEYWORD HIGHLIGHTER
// ─────────────────────────────────────────────
const CULTURAL_KEYWORDS = /الزيتون|الجبل|الصمود|الحنين|الغربة|المقاومة|التراث|الهوية|القافية|الزجل|التراب|الحمامة|النخلة|الورد|البحر|القمر|الشمس|الندى|السحاب|الغيم|الريح|السماء|الأرض|الجذور|السهل|الوادي|النهر|الينبوع|الشجر|الزهر|الياسمين|الرمان|التفاح|الزعتر/g;

function highlightKeywords(text) {
    return text.replace(CULTURAL_KEYWORDS, '<strong>$&</strong>');
}

// ─────────────────────────────────────────────
// ✅ FIXED: typeMessage — builds string in JS variable, only sets innerHTML once per tick
// Old version read element.textContent then set innerHTML causing RTL glitches
// ─────────────────────────────────────────────
function typeMessage(element, text, delay = 12) {
    return new Promise((resolve) => {
        let i = 0;
        let displayed = '';
        element.innerHTML = '';

        const timer = setInterval(() => {
            if (i < text.length) {
                displayed += text.charAt(i);
                i++;
                // Only update DOM once per tick, after building the string
                element.innerHTML = highlightKeywords(displayed.replace(/\n/g, '<br>'));

                if (element.parentElement) {
                    element.parentElement.scrollTop = element.parentElement.scrollHeight;
                }
            } else {
                clearInterval(timer);
                resolve();
            }
        }, delay);
    });
}

// ─────────────────────────────────────────────
// SIDEBAR & NAVIGATION
// ─────────────────────────────────────────────
sidebarToggle.addEventListener('click', () => sidebar.classList.add('active'));
document.addEventListener('click', (e) => {
    if (window.innerWidth <= 992 && sidebar.classList.contains('active') &&
        !sidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
        sidebar.classList.remove('active');
    }
});

const timelineTab = document.getElementById('timeline-tab');
const timelineView = document.getElementById('timelineView');

function hideAllViews() {
    searchResultsView.style.display = 'none';
    chatView.classList.remove('active');
    if (timelineView) timelineView.style.display = 'none';
    [searchTab, chatTab, timelineTab].forEach(t => { if (t) t.classList.remove('active'); });
    tabBtns.forEach(b => b.classList.remove('active'));
}

function setActiveTabBtn(tabName) {
    tabBtns.forEach(b => { if (b.dataset.tab === tabName) b.classList.add('active'); });
}

function showSearchView() {
    hideAllViews();
    setActiveTabBtn('search');
    if (searchTab) searchTab.classList.add('active');
    searchResultsView.style.display = 'block';
    if (window.innerWidth <= 992) sidebar.classList.remove('active');
}

function showChatView() {
    hideAllViews();
    setActiveTabBtn('chat');
    if (chatTab) chatTab.classList.add('active');
    chatView.classList.add('active');
    setTimeout(() => chatInput.focus(), 300);
}

function showTimelineView() {
    hideAllViews();
    setActiveTabBtn('timeline');
    if (timelineTab) timelineTab.classList.add('active');
    if (timelineView) { timelineView.style.display = 'block'; }
    tlInit();
}

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'search') showSearchView();
        else if (btn.dataset.tab === 'chat') showChatView();
        else if (btn.dataset.tab === 'timeline') showTimelineView();
    });
});

backToSearchBtn.addEventListener('click', showSearchView);

// ─────────────────────────────────────────────
// YEAR FILTER — ✅ FIXED: controlled by checkbox, not magic default value
// ─────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────
searchBtn.addEventListener('click', performSearch);
function performSearch() {
    const rhyme = rhymePattern.value.trim();
    const singer = singerFilter.value;
    const theme = themeFilter.value;
    const region = regionFilter.value;
    loadingIndicator.style.display = 'block';
    resultsContainer.innerHTML = '';

    const payload = { top_k: 30 };
    if (rhyme) payload.rhyme_pattern = rhyme;
    if (singer) payload.singer = singer;
    if (theme) payload.theme = theme;
    if (region) payload.region = region;

    const yearVal = parseInt(yearFilter.value);
    if (yearVal > 1943) payload.year_composed = yearVal;

    fetch('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(data => {
        loadingIndicator.style.display = 'none';
        displaySearchResults(data);
    })
    .catch(error => {
        loadingIndicator.style.display = 'none';
        showError('حدث خطأ أثناء البحث. تأكد من تشغيل الخادم.');
        console.error('Search error:', error);
    });
}

function displaySearchResults(data) {
    if (!data.success || data.count === 0) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">😔</div>
                <h3 class="empty-title">لم نعثر على نتائج</h3>
                <p class="empty-subtitle">جرّب تغيير الفلاتر أو تقليل عدد الشروط</p>
            </div>
        `;
        return;
    }

    resultsContainer.innerHTML = '';

    const header = document.createElement('div');
    header.innerHTML = `
        <div style="text-align:center; margin-bottom:30px; background:white; padding:15px 30px; border-radius:20px; box-shadow:0 5px 20px rgba(0,0,0,0.08); border:2px solid var(--cream-dark);">
            <h3 style="color:var(--olive-medium); font-size:1.9rem; font-weight:800;">
                <i class="bi bi-music-note-list"></i> ${data.count} قصيدة
            </h3>
        </div>
    `;
    resultsContainer.appendChild(header);

    data.results.forEach((song, index) => {
        const card = document.createElement('div');
        card.className = 'result-card';
        card.style.animationDelay = `${0.1 + (index * 0.05)}s`;

        const previewLines = (song.preview_lines || [])
            .map(line => `<div style="margin:4px 0; color:var(--ink); font-family:'Lateef',serif; font-size:1.15rem;">"${line}"</div>`)
            .join('');

        const themes = (song.themes || [])
            .map(t => `<span class="theme-tag">${t}</span>`).join('');

        const tone = (song.emotional_tone || [])
            .map(t => `<span style="background:var(--cream-dark); color:var(--olive-dark); padding:3px 10px; border-radius:20px; font-size:0.8rem;">${t}</span>`).join('');

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
                <div>
                    <div class="singer-title" style="font-size:1.3rem;">${song.title}</div>
                    <div class="song-title">${song.singer} • ${song.year_composed} • ${song.album || ''}</div>
                </div>
                <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                    <span style="background:var(--terracotta); color:white; padding:4px 12px; border-radius:20px; font-size:0.85rem;">
                        <i class="bi bi-music-note"></i> ${song.maqam}
                    </span>
                    <span style="background:var(--olive-medium); color:white; padding:4px 12px; border-radius:20px; font-size:0.85rem;">
                        <i class="bi bi-pen"></i> ${song.poetic_form}
                    </span>
                    <span style="background:var(--cream-dark); color:var(--olive-dark); padding:4px 12px; border-radius:20px; font-size:0.85rem;">
                        <i class="bi bi-list-ol"></i> ${song.total_lines} بيت
                    </span>
                </div>
            </div>

            <div style="background:var(--cream); border-right:4px solid var(--terracotta); padding:12px 16px; border-radius:8px; margin-bottom:12px;">
                ${previewLines}
            </div>

            <div style="margin-bottom:10px;">
                <div style="font-size:0.85rem; color:var(--olive-medium); margin-bottom:6px;">
                    <i class="bi bi-clock-history"></i> ${song.historical_event}
                </div>
                <div style="font-size:0.85rem; color:var(--ink); opacity:0.8;">
                    ${song.cultural_significance ? song.cultural_significance.substring(0, 120) + '...' : ''}
                </div>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
                ${themes}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;">
                ${tone}
            </div>
        `;
        // Append audio player separately (async fetch)
        card.appendChild(buildAudioPlayer(song.song_id, song.singer, song.title));
        resultsContainer.appendChild(card);
    });
}

// ─────────────────────────────────────────────
// CHAT — ✅ STREAMING via SSE
// Real tokens arrive from /chat/stream — no more waiting 15-25s
// ─────────────────────────────────────────────
sendChatBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && chatInput.value.trim()) sendMessage();
});

// ─────────────────────────────────────────────
// VOICE INPUT
// ─────────────────────────────────────────────
const micBtn = document.getElementById('micBtn');
let recognition = null;
let isListening = false;

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'ar-LB';
    recognition.interimResults = true;

    recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add('listening');
        micBtn.innerHTML = '<i class="bi bi-stop-fill"></i>';
        chatInput.placeholder = 'جاري الاستماع...';
    };

    recognition.continuous = true;

    recognition.onresult = (e) => {
        const transcript = Array.from(e.results)
            .map(r => r[0].transcript).join('');
        chatInput.value = transcript;
    };

    recognition.onerror = () => stopListening(false);
    recognition.onend   = () => {
        // Restart if still supposed to be listening (browser auto-stops after silence)
        if (isListening) {
            try { recognition.start(); } catch(e) {}
        }
    };

    micBtn.addEventListener('click', () => {
        if (isListening) {
            // User clicks again to stop — stop and send
            recognition.stop();
            stopListening(true);
        } else {
            chatInput.value = '';
            recognition.start();
            isListening = true;
            micBtn.classList.add('listening');
            micBtn.innerHTML = '<i class="bi bi-stop-fill"></i>';
            chatInput.placeholder = 'جاري الاستماع... انقر مجدداً للإرسال';
        }
    });
} else {
    // Browser doesn't support speech recognition
    micBtn.style.display = 'none';
}

function stopListening(andSend = false) {
    isListening = false;
    if (micBtn) {
        micBtn.classList.remove('listening');
        micBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
    }
    chatInput.placeholder = 'اسألني عن رمزية الزيتون في الزجل الفلسطيني...';
    if (andSend && chatInput.value.trim()) {
        setTimeout(() => sendMessage(), 200);
    }
}

// Track suggested questions to prevent re-use
const usedSuggestions = new Set();

function addSuggestedQuestion(question) {
    const btn = document.createElement('button');
    btn.className = 'suggestion-btn';
    btn.textContent = question;
    btn.addEventListener('click', () => {
        chatInput.value = question;
        sendMessage();
        btn.remove();
    });
    chatMessages.appendChild(btn);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    // Add user message
    const userDiv = document.createElement('div');
    userDiv.className = 'message user-message';
    userDiv.innerHTML = message.replace(/\n/g, '<br>');
    chatMessages.appendChild(userDiv);
    chatInput.value = '';
    chatInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message ai-message loading-msg';
    loadingDiv.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;color:var(--olive-medium);">
            <div class="loading-spinner" style="width:20px;height:20px;border-width:3px;"></div>
            <span>الخبير يفكّر...</span>
        </div>
    `;
    chatMessages.appendChild(loadingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // ✅ STREAMING: Connect to SSE endpoint
    try {
        const response = await fetch('/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, context_lines: 3, stream: true })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        // Remove loading, create AI message container
        chatMessages.removeChild(loadingDiv);
        const aiDiv = document.createElement('div');
        aiDiv.className = 'message ai-message';
        chatMessages.appendChild(aiDiv);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        let sourcesReceived = null;

        // Read SSE stream
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const raw = line.slice(6).trim();
                if (!raw) continue;

                let payload;
                try { payload = JSON.parse(raw); } catch { continue; }

                if (payload.error) {
                    aiDiv.innerHTML = `<span style="color:var(--terracotta);">خطأ: ${payload.error}</span>`;
                    break;
                }

                if (payload.done) {
                    sourcesReceived = payload.sources;
                    break;
                }

                if (payload.token) {
                    fullText += payload.token;
                    // ✅ Build string first, set innerHTML once — same fix as typeMessage
                    aiDiv.innerHTML = highlightKeywords(fullText.replace(/\n/g, '<br>'));
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            }
        }

        // Show sources after stream completes
        if (sourcesReceived && sourcesReceived.length > 0) {
            addSources(sourcesReceived);
        }

        // Suggest a follow-up question based on themes
        const themes = sourcesReceived?.[0]?.themes || [];
        if (themes.length > 0 && !usedSuggestions.has(themes[0])) {
            usedSuggestions.add(themes[0]);
            addSuggestedQuestion(`أخبرني أكثر عن موضوع "${themes[0]}" في الزجل`);
        }

    } catch (error) {
        // Fallback to non-streaming if SSE fails
        console.warn('Streaming failed, falling back to /chat:', error);
        try {
            chatMessages.removeChild(loadingDiv);
        } catch {}

        const fallbackDiv = document.createElement('div');
        fallbackDiv.className = 'message ai-message';
        fallbackDiv.innerHTML = `<div style="color:var(--olive-medium); font-style:italic;">جاري المعالجة...</div>`;
        chatMessages.appendChild(fallbackDiv);

        try {
            const res = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, context_lines: 3 })
            });
            const data = await res.json();
            await typeMessage(fallbackDiv, data.answer || 'لا يوجد رد', 12);
            if (data.sources?.length > 0) addSources(data.sources);
        } catch (e) {
            fallbackDiv.innerHTML = `<span style="color:var(--terracotta);">عذراً، حدث خطأ. تأكد من تشغيل الخادم.</span>`;
        }
    }
}

function addSources(sources) {
    const sourcesDiv = document.createElement('div');
    sourcesDiv.className = 'sources-section';
    sourcesDiv.innerHTML = `<h4><i class="bi bi-journal-text"></i> المصادر المستخدمة:</h4>`;

    sources.slice(0, 4).forEach(source => {
        const item = document.createElement('div');
        item.className = 'source-item';

        const isFullSong = source.chunk_type === 'full_song';

        if (isFullSong) {
            item.innerHTML = `
                <div class="line-text" style="color:var(--olive-medium); font-style:normal;">
                    <i class="bi bi-book"></i> القصيدة كاملة
                </div>
                <div class="metadata">
                    <span><strong>${source.title}</strong> — ${source.singer}</span>
                </div>
            `;
        } else {
            const line = source.line || '';
            const rhyme = source.rhyme_ending || '';
            const year = source.year_composed || '';
            item.innerHTML = `
                <div class="line-text">"${line}"</div>
                <div class="metadata">
                    <span><strong>${source.title}</strong> — ${source.singer} (${year})</span>
                    ${rhyme && rhyme !== '_bio_' && rhyme !== '_hist_' && rhyme !== '_theme_' ? 
                        `<span class="rhyme-badge" style="font-size:1.1rem; padding:4px 14px;">قافية: ${rhyme}</span>` : ''}
                </div>
            `;
        }
        sourcesDiv.appendChild(item);
    });

    chatMessages.appendChild(sourcesDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showError(message) {
    resultsContainer.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">⚠️</div>
            <h3 class="empty-title">خطأ في الاتصال</h3>
            <p class="empty-subtitle">${message}</p>
            <p style="margin-top:15px; color:var(--terracotta); font-weight:600;">
                تأكد من أن الخادم يعمل على http://localhost:8000
            </p>
        </div>
    `;
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
window.addEventListener('load', () => {

    const adjustChatHeight = () => {
        if (chatView.classList.contains('active')) {
            const headerH = document.querySelector('.chat-header')?.offsetHeight || 80;
            const inputH = document.querySelector('.chat-input-area')?.offsetHeight || 80;
            chatMessages.style.height = `calc(100vh - ${headerH + inputH + 60}px)`;
        }
    };
    adjustChatHeight();
    window.addEventListener('resize', adjustChatHeight);
});


// ─────────────────────────────────────────────
// AUDIO PLAYER
// ─────────────────────────────────────────────
let currentAudio = null;
let currentPlayBtn = null;

function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
}

function buildAudioPlayer(songId, singer, title) {
    const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(singer + ' ' + title)}`;
    const container = document.createElement('div');

    fetch(`/audio/${songId}`)
        .then(r => r.json())
        .then(data => {
            if (data.available) {
                container.innerHTML = `
                    <div class="audio-player">
                        <button class="audio-play-btn" id="playbtn_${songId}">
                            <i class="bi bi-play-fill"></i>
                        </button>
                        <div class="audio-progress-wrap">
                            <input type="range" class="audio-progress" id="prog_${songId}" value="0" min="0" step="0.1">
                            <span class="audio-time" id="time_${songId}">0:00 / 0:00</span>
                        </div>
                    </div>`;

                const audio = new Audio(data.url);
                const playBtn = container.querySelector(`#playbtn_${songId}`);
                const prog = container.querySelector(`#prog_${songId}`);
                const timeEl = container.querySelector(`#time_${songId}`);

                audio.addEventListener('loadedmetadata', () => {
                    prog.max = audio.duration;
                    timeEl.textContent = `0:00 / ${formatTime(audio.duration)}`;
                });

                audio.addEventListener('timeupdate', () => {
                    prog.value = audio.currentTime;
                    timeEl.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
                });

                audio.addEventListener('ended', () => {
                    playBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
                    audio.currentTime = 0;
                });

                prog.addEventListener('input', () => {
                    audio.currentTime = prog.value;
                });

                playBtn.addEventListener('click', () => {
                    // Pause any other playing audio
                    if (currentAudio && currentAudio !== audio) {
                        currentAudio.pause();
                        if (currentPlayBtn) currentPlayBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
                    }
                    if (audio.paused) {
                        audio.play();
                        playBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
                        currentAudio = audio;
                        currentPlayBtn = playBtn;
                    } else {
                        audio.pause();
                        playBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
                    }
                });

            } else {
                // No local file — show YouTube only
                container.innerHTML = `
                    <div style="margin-top:14px;">
                        <a href="${ytUrl}" target="_blank" class="audio-yt-btn">
                            <i class="bi bi-youtube"></i> استمع على يوتيوب
                        </a>
                    </div>`;
            }
        })
        .catch(() => {
            container.innerHTML = `
                <div style="margin-top:14px;">
                    <a href="${ytUrl}" target="_blank" class="audio-yt-btn">
                        <i class="bi bi-youtube"></i> استمع على يوتيوب
                    </a>
                </div>`;
        });

    return container;
}

// ─────────────────────────────────────────────
// TIMELINE
// ─────────────────────────────────────────────

const TL_POEMS = [
  { id:'rokz_015', title:'في المروج', poet:'rokz', year:1944, themes:['طبيعة','وطن'], hist:'الاستقلال اللبناني 1943 والانبعاث الوطني الثقافي', maqam:'راست', lines:['خلق لبنان بالدنيا لغاية','بلادي اسمها مهد الشطارة'] },
  { id:'rokz_005', title:'شروقي', poet:'rokz', year:1945, themes:['حب','غزل'], hist:'المرحلة الغزلية الأولى لخليل روكز وبداياته الإبداعية', maqam:'بياتي', lines:['من شوق روحي إلك يابو العيون السود','كلّفت عنّي الهوى ياخدلك رسالي'] },
  { id:'rokz_013', title:'شعرك المقصوص', poet:'rokz', year:1946, themes:['حب','رثاء'], hist:'الغزل الزجلي الكلاسيكي، لبنان الاستقلال', maqam:'حجاز', lines:['شعرك الكان يلفّني وينام','لفّة عيون الطفل بالأحلام'] },
  { id:'rokz_003', title:'يتيمة', poet:'rokz', year:1948, themes:['ظلم','مرأة'], hist:'لبنان ما بعد الحرب، الفقر الريفي واضطهاد المرأة', maqam:'نهاوند', lines:['ربيت يتيمة بكوخ متواضع حقير','وغير الله ما لها عون ونصير'] },
  { id:'rokz_008', title:'خمر الحرمان', poet:'rokz', year:1948, themes:['حب','غزل'], hist:'المرحلة الغزلية الناضجة، لبنان الاستقلال الأول', maqam:'عجم', lines:['همّي ضيّعلي صداحي بوادي النسيان','بدّي إسكب بقداحي خمر الحرمان'] },
  { id:'rokz_001', title:'قصة القمح', poet:'rokz', year:1950, themes:['عدالة','فقر'], hist:'مجاعة جبل لبنان وما بعد الحرب العالمية الثانية', maqam:'سيكا', lines:['كلّ كمشة قمح بتموّن شريد','بس الذهب ما بيطعم ولاد الزغار'] },
  { id:'rokz_006', title:'صوت لاجئ', poet:'rokz', year:1950, themes:['هجرة','وطن'], hist:'موجة الهجرة اللبنانية للبحث عن العمل', maqam:'حجاز', lines:['تركتك بعصر العمر يا امي','وحطيت في وجهي الدني وفليت'] },
  { id:'rokz_011', title:'عزة النفس', poet:'rokz', year:1950, themes:['حكمة','كرامة'], hist:'مرحلة الشعر الحكمي المكثّف لخليل روكز', maqam:'بياتي', lines:['مهما زغرت لا تقول عن غيرك كبير','بطمنّك ما في كبير بهالدني'] },
  { id:'rokz_007', title:'نهر الأردن', poet:'rokz', year:1952, themes:['وطن','فلسطين'], hist:'ما بعد نكبة فلسطين 1948 وتقسيم الأردن', maqam:'راست', lines:['بلادي قصيدة عمرها مليون جيل','الله نظمها بزوغة الفجر الأصيل'] },
  { id:'rokz_014', title:'هموم الدني', poet:'rokz', year:1953, themes:['دين','صبر'], hist:'التأمل الديني الفلسفي في مرحلة النضج', maqam:'نهاوند', lines:['من وقت ما طليت عالعالم غريب','استعرض هموم الدني وآخد وجيب'] },
  { id:'rokz_002', title:'راحو حباب القلب', poet:'rokz', year:1955, themes:['هجرة','حنين'], hist:'موجات الهجرة اللبنانية إلى أفريقيا وأمريكا الجنوبية', maqam:'حجاز', lines:['راحو حباب القلب وبقينا','نستفقد لزهوة ليالينا'] },
  { id:'rokz_009', title:'أنا والليل', poet:'rokz', year:1955, themes:['فلسفة','وحدة'], hist:'مرحلة النضج الفلسفي لخليل روكز في الخمسينيات', maqam:'نهاوند', lines:['أنا والليل إخوي من البداية','عرايا لا قناع ولا عبايي'] },
  { id:'rokz_004', title:'افتتاح في أفريقيا', poet:'rokz', year:1956, themes:['هجرة','غربة'], hist:'الجاليات اللبنانية في غرب أفريقيا في الخمسينيات', maqam:'بياتي', lines:['كنت بين القرايب والحبايب غريب','وما حدا منهم عرفني'] },
  { id:'rokz_012', title:'المقبرة', poet:'rokz', year:1957, themes:['موت','حب'], hist:'مرحلة التأمل الوجودي في شعر روكز قُرب نهاية حياته', maqam:'سابا', lines:['مازال رح تبقي ع ضعفي مكبّره','ومازال مافي عفو عند المقدره'] },
  { id:'rokz_010', title:'المواعظ', poet:'rokz', year:1958, themes:['حكمة','أخلاق'], hist:'المرحلة الحكمية الناضجة لخليل روكز قُرب نهاية مسيرته', maqam:'راست', lines:['قمح الصليبي مابيجني زوان','بتجني متل ماالأرض زارعها'] },
  { id:'zgheib_011', title:'عشرين سنة', poet:'zgheib', year:1968, themes:['فلسطين','وطن'], hist:'ذكرى النكبة الفلسطينية 1948 — العشرون من الذكرى', maqam:'حجاز', lines:['عشرين سنة وفلسطين يا فلسطين','عشرين سنة والجرح ما بيندمل'] },
  { id:'zgheib_013', title:'يا ضيعتي', poet:'zgheib', year:1968, themes:['وطن','طبيعة'], hist:'الثقافة الجبلية اللبنانية، بلدة حراجل كسروان', maqam:'راست', lines:['يا ضيعتي يا مراية وجودي','يا قنطرة بالورد معقودي'] },
  { id:'zgheib_001', title:'النهر يزرع نغم', poet:'zgheib', year:1977, themes:['طبيعة','حرب'], hist:'الحرب الأهلية اللبنانية 1975-1990', maqam:'بياتي', lines:['بهونيك ليلة شتي كان القمر نعسان','والنهر يزرع نغم والأرض غفياني'] },
  { id:'zgheib_012', title:'قناديل الزمان', poet:'zgheib', year:1977, themes:['حرب','ذاكرة'], hist:'الحرب الأهلية اللبنانية 1975-1977، المرحلة الأولى من الدمار', maqam:'نهاوند', lines:['قناديل الزمان بتضوي بظلمة الحرب','وتحكي للأجيال شو صار وشو كان'] },
  { id:'zgheib_010', title:'لا تحقروا الإنسان', poet:'zgheib', year:1996, themes:['فلسطين','مقاومة'], hist:'مجزرة قانا 1996 — القصف الإسرائيلي على مخيم الأمم المتحدة', maqam:'سابا', lines:['قانا القداسة منبت الوجدان','هي أساس النهر والمنبع'] },
  { id:'zgheib_002', title:'الأم', poet:'zgheib', year:1999, themes:['وطن','فداء'], hist:'مرحلة ما بعد الحرب الأهلية اللبنانية', maqam:'نهاوند', lines:['يا أمي بعيدك البيشعّ زيني','بقصة ماضيه بتذكريني'] },
  { id:'zgheib_003', title:'العصفور', poet:'zgheib', year:1999, themes:['حب','غزل'], hist:'المرحلة الفنية الناضجة لموسى زغيب، أواخر التسعينيات', maqam:'عجم', lines:['مرة سحرني الهوا بألب القفص عصفور','يسهر يغني لكي وتفغي عاموالو'] },
  { id:'zgheib_004', title:'زيارة', poet:'zgheib', year:1999, themes:['حب','مرارة'], hist:'بيروت ما بعد الحرب وانفتاحها الثقافي', maqam:'حجاز', lines:['زرتك فتحتي إلي وإلتي تفضل فوت','مدري بي بيت الزجل مدري بالمديني'] },
  { id:'zgheib_005', title:'أنا لا خال بالدنيا', poet:'zgheib', year:1999, themes:['هوية','حرية'], hist:'الإعلان الذاتي عن هوية الشاعر الزجلي', maqam:'بياتي', lines:['أنا لا خال بالدنيا ولا عم','أنا شاعر مالي شغلي ولا عملي'] },
  { id:'zgheib_006', title:'موعود', poet:'zgheib', year:1999, themes:['شيخوخة','حنين'], hist:'المرحلة الوجدانية الناضجة لموسى زغيب في أواخر التسعينيات', maqam:'نهاوند', lines:['موعود بدو الصبا يصقي الكبر تجديد','ويرجع شبابي ولو ايام معدودي'] },
  { id:'zgheib_007', title:'أنا والسهر', poet:'zgheib', year:1999, themes:['كتابة','حب'], hist:'مرحلة التأمل الشخصي لموسى زغيب في أواخر التسعينيات', maqam:'راست', lines:['وحدي… والقلم حدّي يغافل شرودي','ويسرق الردة والصبح تا يفيّق'] },
  { id:'zgheib_008', title:'أنا .. إنتو ..', poet:'zgheib', year:2006, themes:['تاريخ','زجل'], hist:'حفلات التحدي الكبرى في تاريخ الزجل اللبناني', maqam:'بياتي', lines:['طلقت فكري بجوانح نسر أسمر','وصارو يرفعوني ويرفعوني'] },
  { id:'zgheib_014', title:'المرأة', poet:'zgheib', year:2006, themes:['فلسفة','أنوثة'], hist:'مرحلة الشعر الفلسفي الوجودي لموسى زغيب', maqam:'بياتي', lines:['يا بنات حوا شهدو انو الزغيبي قال','انتو الشموع الما فيها الريح تطفيها'] },
  { id:'zgheib_015', title:'وصايا', poet:'zgheib', year:2006, themes:['حكمة','إرث'], hist:'مرحلة النضج الشعري لموسى زغيب وتوجيه رسالته للأجيال', maqam:'راست', lines:['يا شعرا جوقة القلعة اسمعوا وصاياي','الزجل مش فن فقط هو روح وهوية'] },
  { id:'zgheib_009', title:'إبن بالعسكر', poet:'zgheib', year:2011, themes:['وطن','سياسة'], hist:'مرحلة ما بعد 2005 والانسحاب السوري من لبنان', maqam:'سيكا', lines:['يا جيش إنت العدل والميزان','ما هزهزوك عواصف الأديان'] },
];


const TL_COLORS = {
  'وطن':'#2c7bb6','حب':'#c0392b','فلسطين':'#27ae60','طبيعة':'#8e44ad',
  'حرب':'#e74c3c','هجرة':'#d35400','حكمة':'#16a085','فلسفة':'#8e44ad',
  'غزل':'#e91e8c','ظلم':'#c0392b','عدالة':'#27ae60','دين':'#7f8c8d',
  'موت':'#555','تاريخ':'#2980b9','هوية':'#d35400','سياسة':'#e74c3c',
  'كتابة':'#9b59b6','فداء':'#e67e22','مقاومة':'#1a7a4a','شيخوخة':'#95a5a6',
  'غربة':'#e67e22','كرامة':'#27ae60','أنوثة':'#e91e8c','إرث':'#8e44ad',
  'مرأة':'#c0392b','صبر':'#7f8c8d','مرارة':'#d35400','وحدة':'#555',
  'ذاكرة':'#2980b9','رثاء':'#7f8c8d','أخلاق':'#16a085','حنين':'#d35400',
  'زجل':'#2c7bb6','حرية':'#27ae60','فقر':'#d35400'
};

function tlGetColor(themes) {
  for (const t of themes) if (TL_COLORS[t]) return TL_COLORS[t];
  return '#888';
}

const TL_MIN = 1940, TL_MAX = 2015;
let tlActivePoet = 'all';
let tlSelected = null;
let tlInited = false;

function tlPct(year) {
  return ((year - TL_MIN) / (TL_MAX - TL_MIN) * 100);
}

function tlInit() {
  if (!tlInited) {
    tlInited = true;
    document.getElementById('tlPoetFilter').addEventListener('click', e => {
      const btn = e.target.closest('.tl-poet-btn');
      if (!btn) return;
      tlActivePoet = btn.dataset.poet;
      tlSelected = null;
      document.querySelectorAll('.tl-poet-btn').forEach(b => b.classList.toggle('active', b === btn));
      tlRender();
    });
  }
  // Always re-render to pick up actual canvas width after view is visible
  setTimeout(() => tlRender(), 50);
}

function tlRender() {
  const filtered = TL_POEMS.filter(p => tlActivePoet === 'all' || p.poet === tlActivePoet);
  const canvas = document.getElementById('tlCanvas');
  const dotsLayer = document.getElementById('tlDots');
  const ticksLayer = document.getElementById('tlTicks');
  if (!dotsLayer || !ticksLayer || !canvas) return;

  const W = canvas.offsetWidth || 800;
  const H = 220;
  const PAD = 30;
  const usableW = W - PAD * 2;
  const MID = H / 2;

  function xPos(year) { return PAD + (year - TL_MIN) / (TL_MAX - TL_MIN) * usableW; }

  // Ticks — decade labels + small year lines in between
  ticksLayer.innerHTML = '';
  for (let y = 1940; y <= 2015; y++) {
    const isDecade = y % 10 === 0;
    const isFive   = y % 5 === 0 && !isDecade;
    if (!isDecade && !isFive) continue;

    const t = document.createElement('div');
    t.className = 'tl-tick';
    t.style.left = xPos(y) + 'px';

    if (isDecade) {
      t.innerHTML = `
        <div class="tl-tick-line tl-tick-decade"></div>
        <div class="tl-tick-year tl-tick-year-decade">${y}</div>`;
    } else {
      t.innerHTML = `<div class="tl-tick-line tl-tick-minor"></div>`;
    }
    ticksLayer.appendChild(t);
  }

  // Cluster dots by year bucket
  const buckets = {};
  filtered.forEach(p => {
    const bucket = Math.round(p.year / 3) * 3;
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push(p);
  });

  dotsLayer.innerHTML = '';
  filtered.forEach((p, globalIdx) => {
    const bucket = Math.round(p.year / 3) * 3;
    const idx = buckets[bucket].indexOf(p);
    const total = buckets[bucket].length;
    const spread = 28;
    const topPx = MID + (idx - (total - 1) / 2) * spread;

    const dot = document.createElement('div');
    dot.className = 'tl-dot' + (tlSelected?.id === p.id ? ' selected' : '');
    dot.style.left = xPos(p.year) + 'px';
    dot.style.top = topPx + 'px';
    dot.style.background = tlGetColor(p.themes);
    dot.style.animationDelay = (globalIdx * 0.04) + 's';

    const label = document.createElement('div');
    label.className = 'tl-dot-label';
    label.textContent = p.title;
    dot.appendChild(label);

    dot.addEventListener('click', () => {
      tlSelected = p;
      tlRender();
      tlShowDetail(p);
    });
    dotsLayer.appendChild(dot);
  });

  // Legend
  const allThemes = [...new Set(filtered.flatMap(p => p.themes))];
  const legendEl = document.getElementById('tlLegend');
  if (legendEl) {
    legendEl.innerHTML = allThemes.slice(0, 10).map((t, i) => `
      <div class="tl-legend-item" style="animation-delay:${i * 0.05}s">
        <div class="tl-legend-dot" style="background:${TL_COLORS[t]||'#888'}"></div>
        ${t}
      </div>`).join('');
  }

  // Detail
  if (!tlSelected) {
    document.getElementById('tlDetail').innerHTML = '';
  }
}

function tlShowDetail(p) {
  const poetName = p.poet === 'zgheib' ? 'موسى زغيب' : 'خليل روكز';
  const themes = p.themes.map(t => `<span class="tl-theme-tag">${t}</span>`).join('');
  const lines = p.lines.map((l, i) =>
    `<div class="tl-detail-line" style="animation-delay:${0.1 + i * 0.08}s">${l}</div>`
  ).join('');

  const detailEl = document.getElementById('tlDetail');
  detailEl.innerHTML = `
    <div class="tl-detail-card" id="tl-detail-card-inner">
      <div class="tl-detail-top">
        <div>
          <div class="tl-detail-title">${p.title}</div>
          <div class="tl-detail-poet">${poetName}</div>
        </div>
        <div class="tl-detail-badges">
          <span class="tl-badge tl-badge-year">${p.year}</span>
          <span class="tl-badge tl-badge-maqam">مقام ${p.maqam}</span>
        </div>
      </div>
      <div class="tl-detail-hist">${p.hist}</div>
      <div class="tl-detail-themes">${themes}</div>
      <div class="tl-detail-lines">${lines}</div>
      <button class="tl-ask-btn" onclick="tlAskAI('${p.title}', '${poetName}')">
        <i class="bi bi-robot"></i> اسأل الذكاء الاصطناعي
      </button>
    </div>`;
  // Append audio player to the card
  document.getElementById('tl-detail-card-inner').appendChild(buildAudioPlayer(p.id, poetName, p.title));
}

function tlAskAI(title, poet) {
  const question = `ما رمزية قصيدة "${title}" لـ${poet}؟`;
  showChatView();
  setTimeout(() => {
    document.getElementById('chatInput').value = question;
    sendMessage();
  }, 400);
}

window.addEventListener('resize', () => { if (tlInited) tlRender(); });