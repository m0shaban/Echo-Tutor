/* ============================================
   ECHO TUTOR PRO — Main Application Engine
   v4.0 — Multi-lang, Scenarios, Gamification
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  // ─── DOM ELEMENTS ───
  const $ = (id) => document.getElementById(id);
  const onboardingScreen = $('onboarding-screen');
  const appContainer = $('app-container');
  const startBtn = $('start-btn');
  const levelCards = $('level-cards');
  const topicGrid = $('topic-grid');
  const messagesDiv = $('messages');
  const textInput = $('text-input');
  const sendBtn = $('send-btn');
  const micBtn = $('mic-btn');
  const sttBtn = $('stt-btn');
  const muteBtn = $('mute-btn');
  const endBtn = $('end-btn');
  const avatarContainer = $('avatar-container');
  const stateLabel = $('state-label');
  const headerStatus = $('header-status');
  const statTime = $('stat-time');
  const statMsgs = $('stat-msgs');
  const settingsBtn = $('settings-btn');
  const particlesCanvas = $('particles-canvas');
  const waveformCanvas = $('waveform-canvas');
  const toastEl = $('toast');
  const emotionIndicator = $('emotion-indicator');
  const authBtn = $('auth-btn');
  const authUserLabel = $('auth-user-label');

  // ─── STATE ───
  let conversationHistory = [];
  let selectedLevel = 'intermediate';
  let selectedTopic = 'free';
  let selectedLanguage = 'en';
  let selectedScenario = null;
  let selectedMode = 'topic'; // 'topic' or 'scenario'
  let recognizing = false;
  let recognition = null;
  let browserSpeechAvailable = false;
  let whisperRecording = false;
  let useWhisperFallback = false;
  const savedSttMode = localStorage.getItem('echo_stt_mode');
  let sttMode = savedSttMode || 'auto';
  let whisperServerAvailable = null;
  let speechSessionId = 0;
  let autoListen = true;
  let isMuted = false;
  let ended = false;
  let turn = 'user';
  let autoMicRetryCount = 0;
  let autoMicBlockedUntil = 0;
  let lastAutoMicAt = 0;

  // ─── UI TRANSLATIONS ───
  const uiTranslations = {
    en: {
      app_title: "ECHO <span class='accent'>TUTOR</span>",
      app_subtitle: 'Your AI-Powered Language Tutor',
      choose_lang: 'Choose Language',
      choose_level: 'Choose Your Level',
      choose_mode: 'Choose Mode',
      pick_topic: 'Pick a Topic',
      pick_scenario: 'Pick a Scenario',
      start_btn: 'Start Conversation',
      chat_tab: 'Chat',
      stories_tab: 'Stories',
      cards_tab: 'Cards',
      progress_tab: 'Progress',
      settings_title: 'Settings',
      close_btn: 'Close',
      type_msg: 'Type a message...',
      ready: 'Ready',
      listening: 'Listening...',
      thinking: 'Thinking...',
      speaking: 'Speaking...',
      streak: '🔥 Streak',
      xp: 'XP',
      level: 'Lv.',
    },
    ar: {
      app_title: "إيكو <span class='accent'>تيوتر</span>",
      app_subtitle: 'معلم اللغات الذكي الخاص بك',
      choose_lang: 'اختر لغة التعلم',
      choose_level: 'اختر مستواك',
      choose_mode: 'اختر النمط',
      pick_topic: 'اختر موضوعاً',
      pick_scenario: 'اختر سيناريو',
      start_btn: 'ابدأ المحادثة',
      chat_tab: 'الدردشة',
      stories_tab: 'القصص',
      cards_tab: 'البطاقات',
      progress_tab: 'التقدم',
      settings_title: 'الإعدادات',
      close_btn: 'إغلاق',
      type_msg: 'اكتب رسالة...',
      ready: 'مستعد',
      listening: 'يستمع...',
      thinking: 'يفكر...',
      speaking: 'يتحدث...',
      streak: '🔥 أيام متتالية',
      xp: 'نقطة',
      level: 'مستوى ',
    },
  };

  let currentUILang = localStorage.getItem('echo_ui_lang') || 'en';

  window.setUILanguage = function (lang) {
    currentUILang = lang;
    localStorage.setItem('echo_ui_lang', lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;

    const t = uiTranslations[lang];
    if (!t) return;

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.placeholder = t[key];
        } else {
          el.innerHTML = t[key];
        }
      }
    });

    // Update toggle button text
    const toggleBtn = $('ui-lang-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = lang === 'ar' ? 'English' : 'عربي';
    }
    const toggleChatBtn = $('ui-lang-toggle-chat');
    if (toggleChatBtn) {
      toggleChatBtn.textContent = lang === 'ar' ? 'EN' : 'عربي';
    }
  };

  // ─── STREAK LOGIC ───
  function updateStreak() {
    const today = new Date().toDateString();
    let lastVisit = localStorage.getItem('echo_last_visit');
    let streak = parseInt(localStorage.getItem('echo_streak') || '0');

    if (lastVisit !== today) {
      if (lastVisit) {
        const lastDate = new Date(lastVisit);
        const diffTime = Math.abs(new Date() - lastDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          streak++;
        } else if (diffDays > 1) {
          streak = 1; // Reset streak
        }
      } else {
        streak = 1;
      }
      localStorage.setItem('echo_last_visit', today);
      localStorage.setItem('echo_streak', streak);
    }

    const streakEl = $('streak-count');
    if (streakEl) {
      streakEl.innerHTML = `🔥 ${streak}`;
    }
  }

  // Initialize UI Lang and Streak
  setTimeout(() => {
    window.setUILanguage(currentUILang);
    updateStreak();
  }, 100);

  // Mobile detection
  const isMobile =
    /Android|iPhone|iPad|iPod|Mobile|webOS/i.test(navigator.userAgent) ||
    ('ontouchstart' in window && window.innerWidth < 1024);
  const mobileWhisperOnly = isMobile;

  // On first run on mobile, prefer Whisper (Groq) over browser STT.
  // Keep user preference untouched if already saved.
  if (!savedSttMode && isMobile) {
    sttMode = 'whisper';
  }
  if (mobileWhisperOnly) {
    sttMode = 'whisper';
  }

  // iOS Safari doesn't support SpeechSynthesis reliably — skip TTS entirely
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Safety: unlock turn much faster on mobile (12s), 25s on desktop
  let turnStuckTimer = null;
  function resetTurnStuckTimer() {
    if (turnStuckTimer) clearTimeout(turnStuckTimer);
    if (turn === 'user' || turn === 'done') return;
    const stuckMs = isMobile ? 12000 : 25000;
    turnStuckTimer = setTimeout(() => {
      if (turn !== 'user' && turn !== 'done' && !ended) {
        console.warn('[Echo] turn stuck at', turn, '— forcing unlock');
        try {
          window.speechSynthesis?.cancel();
        } catch (e) {}
        stopLipSync();
        turn = 'user';
        setAvatarState('idle');
        // showToast('Ready — tap to chat', '');
        // On mobile, hanging often means the audio context needs a user gesture.
        // We can't auto-start it here reliably, but we can reset to let the user tap.
      }
    }, stuckMs);
  }
  let sessionStart = null;
  let sessionTimer = null;
  let msgCount = 0;
  let sessionXPStart = 0;
  let userScrolledUp = false;
  let audioContext = null;
  let analyser = null;
  let micStream = null;
  let lipSyncInterval = null;
  let allBadges = [];
  let voiceProfiles = [];
  let activeVoiceProfileId = null;
  let editingVoiceProfileId = null;
  let currentUser = null;
  const GUEST_TRIAL_MAX_USER_MESSAGES = 4;
  const GUEST_TRIAL_MAX_SECONDS = 180;
  const guestQueryEnabled =
    new URLSearchParams(window.location.search).get('guest') === '1';
  let isGuestTrial =
    guestQueryEnabled || sessionStorage.getItem('echo_guest_trial') === '1';
  let guestUserMessages = 0;
  if (guestQueryEnabled) {
    sessionStorage.setItem('echo_guest_trial', '1');
  }
  const DEFAULT_APP_SETTINGS = {
    autoListen: true,
    autoSpeak: true,
    particles: true,
    animations: true,
    waveform: true,
    compactUI: false,
  };

  // Disable autoSpeak & autoListen only on iOS by default (gesture restrictions)
  if (isIOS) {
    DEFAULT_APP_SETTINGS.autoSpeak = false;
    DEFAULT_APP_SETTINGS.autoListen = false;
  }

  let appSettings = { ...DEFAULT_APP_SETTINGS };

  // Expose level for exercises
  window._echoLevel = selectedLevel;

  // ─── TOPICS FALLBACK ───
  let topics = [
    { id: 'free', label: 'Free Talk', icon: '💬' },
    { id: 'travel', label: 'Travel', icon: '✈️' },
    { id: 'food', label: 'Food & Cooking', icon: '🍳' },
    { id: 'tech', label: 'Technology', icon: '💻' },
    { id: 'movies', label: 'Movies & Shows', icon: '🎬' },
    { id: 'sports', label: 'Sports', icon: '⚽' },
    { id: 'work', label: 'Work & Career', icon: '💼' },
    { id: 'daily', label: 'Daily Life', icon: '🏠' },
  ];

  function getLanguageVoiceCode() {
    return selectedLanguage === 'fr'
      ? 'fr-FR'
      : selectedLanguage === 'es'
        ? 'es-ES'
        : selectedLanguage === 'de'
          ? 'de-DE'
          : 'en-US';
  }

  function getSttLanguageCode() {
    return selectedLanguage === 'fr'
      ? 'fr'
      : selectedLanguage === 'es'
        ? 'es'
        : selectedLanguage === 'de'
          ? 'de'
          : 'en';
  }

  function getVoices() {
    if (!('speechSynthesis' in window)) return [];
    return window.speechSynthesis.getVoices() || [];
  }

  function saveVoiceProfiles() {
    try {
      localStorage.setItem(
        'echo_voice_profiles',
        JSON.stringify(voiceProfiles),
      );
      localStorage.setItem(
        'echo_active_voice_profile',
        activeVoiceProfileId || '',
      );
    } catch (e) {}
  }

  function getDefaultVoiceProfiles() {
    const lang = getLanguageVoiceCode();
    return [
      {
        id: 'coach',
        name: 'Coach',
        voiceName: '',
        rate: 0.95,
        pitch: 1.0,
        volume: 1,
        lang,
      },
      {
        id: 'friendly',
        name: 'Friendly',
        voiceName: '',
        rate: 1.0,
        pitch: 1.1,
        volume: 1,
        lang,
      },
      {
        id: 'formal',
        name: 'Formal',
        voiceName: '',
        rate: 0.9,
        pitch: 0.95,
        volume: 1,
        lang,
      },
    ];
  }

  function ensureVoiceProfilesLoaded() {
    if (voiceProfiles.length) return;
    try {
      const saved = JSON.parse(
        localStorage.getItem('echo_voice_profiles') || '[]',
      );
      if (Array.isArray(saved) && saved.length) {
        voiceProfiles = saved;
      } else {
        voiceProfiles = getDefaultVoiceProfiles();
      }
    } catch (e) {
      voiceProfiles = getDefaultVoiceProfiles();
    }
    activeVoiceProfileId =
      localStorage.getItem('echo_active_voice_profile') ||
      voiceProfiles[0]?.id ||
      null;
    if (!voiceProfiles.find((p) => p.id === activeVoiceProfileId)) {
      activeVoiceProfileId = voiceProfiles[0]?.id || null;
    }
    editingVoiceProfileId = activeVoiceProfileId;
  }

  function getActiveVoiceProfile() {
    ensureVoiceProfilesLoaded();
    return (
      voiceProfiles.find((p) => p.id === activeVoiceProfileId) ||
      voiceProfiles[0] ||
      null
    );
  }

  function renderVoiceSelect(selectedVoiceName = '') {
    const select = $('voice-select');
    if (!select) return;
    const voices = getVoices();
    select.innerHTML = '<option value="">Auto voice</option>';
    voices.forEach((v) => {
      const option = document.createElement('option');
      option.value = v.name;
      option.textContent = `${v.name} (${v.lang})`;
      select.appendChild(option);
    });
    select.value = selectedVoiceName || '';
  }

  function loadVoiceEditor(profile) {
    const p = profile || getActiveVoiceProfile();
    if (!p) return;
    $('voice-profile-name').value = p.name || '';
    $('voice-rate').value = String(p.rate ?? 0.95);
    $('voice-pitch').value = String(p.pitch ?? 1.05);
    $('voice-volume').value = String(p.volume ?? 1);
    renderVoiceSelect(p.voiceName || '');
  }

  function renderVoiceProfiles() {
    const container = $('voice-profiles-list');
    if (!container) return;
    container.innerHTML = '';
    voiceProfiles.forEach((profile) => {
      const chip = document.createElement('button');
      chip.className =
        'voice-profile-chip' +
        (profile.id === activeVoiceProfileId ? ' active' : '');
      chip.textContent = profile.name;
      chip.addEventListener('click', () => {
        activeVoiceProfileId = profile.id;
        editingVoiceProfileId = profile.id;
        saveVoiceProfiles();
        renderVoiceProfiles();
        loadVoiceEditor(profile);
      });
      container.appendChild(chip);
    });
  }

  function canUseWhisperClient() {
    return Boolean(
      window.EchoFeatures?.Whisper &&
      window.MediaRecorder &&
      navigator.mediaDevices?.getUserMedia,
    );
  }

  async function refreshWhisperAvailability() {
    try {
      const res = await fetch('/health');
      if (!res.ok) return;
      const data = await res.json();
      whisperServerAvailable = Boolean(data.whisper_available);
    } catch (e) {}
  }

  function updateSttButton() {
    if (!sttBtn) return;
    // User doesn't need to know the engine.
    // We just hide it or show a simple indicator if debugging is needed.
    // For production/user-facing, we hide the text content or set it to blank.
    sttBtn.style.display = 'none';
  }

  function setSttMode(mode) {
    if (mobileWhisperOnly && mode !== 'whisper') {
      mode = 'whisper';
    }

    sttMode = mode;
    try {
      localStorage.setItem('echo_stt_mode', sttMode);
    } catch (e) {}

    if (sttMode === 'whisper') {
      useWhisperFallback = true;
      autoListen = Boolean(appSettings.autoListen);
    } else if (sttMode === 'browser') {
      useWhisperFallback = false;
      autoListen = Boolean(appSettings.autoListen);
    } else {
      useWhisperFallback = !browserSpeechAvailable && canUseWhisperClient();
      autoListen = Boolean(appSettings.autoListen) && !useWhisperFallback;
    }

    updateSttButton();
    if (mobileWhisperOnly && sttBtn) {
      sttBtn.title = 'Whisper-only on mobile';
      sttBtn.style.opacity = '0.95';
    }
  }

  function applyVoiceProfileToUtterance(utterance) {
    const profile = getActiveVoiceProfile();
    const fallbackLang = getLanguageVoiceCode();

    utterance.lang = profile?.lang || fallbackLang;
    utterance.rate = profile?.rate ?? 0.95;
    utterance.pitch = profile?.pitch ?? 1.05;
    utterance.volume = profile?.volume ?? 1;

    const voices = getVoices();
    let selectedVoice = null;
    if (profile?.voiceName) {
      selectedVoice = voices.find((v) => v.name === profile.voiceName) || null;
    }
    if (!selectedVoice) {
      selectedVoice =
        voices.find(
          (v) =>
            v.lang &&
            v.lang
              .toLowerCase()
              .startsWith(
                (utterance.lang || fallbackLang).toLowerCase().split('-')[0],
              ),
        ) || null;
    }
    if (selectedVoice) utterance.voice = selectedVoice;
  }

  function loadAppSettings() {
    try {
      const saved = JSON.parse(
        localStorage.getItem('echo_app_settings') || '{}',
      );
      appSettings = { ...DEFAULT_APP_SETTINGS, ...(saved || {}) };

      // One-time migration: older builds forced mobile autoSpeak/autoListen off.
      // Restore sane defaults for non-iOS mobile users.
      const migrated = localStorage.getItem('echo_mobile_defaults_migrated_v2');
      if (!migrated && isMobile && !isIOS) {
        if (
          appSettings.autoSpeak === false &&
          appSettings.autoListen === false
        ) {
          appSettings.autoSpeak = true;
          appSettings.autoListen = true;
          localStorage.setItem(
            'echo_app_settings',
            JSON.stringify(appSettings),
          );
        }
        localStorage.setItem('echo_mobile_defaults_migrated_v2', '1');
      }
    } catch (e) {
      appSettings = { ...DEFAULT_APP_SETTINGS };
    }
  }

  function saveAppSettings() {
    try {
      localStorage.setItem('echo_app_settings', JSON.stringify(appSettings));
    } catch (e) {}
  }

  function renderAppSettingsControls() {
    const map = {
      'setting-auto-listen': 'autoListen',
      'setting-auto-speak': 'autoSpeak',
      'setting-particles': 'particles',
      'setting-animations': 'animations',
      'setting-waveform': 'waveform',
      'setting-compact': 'compactUI',
    };
    Object.entries(map).forEach(([id, key]) => {
      const input = $(id);
      if (!input) return;
      input.checked = Boolean(appSettings[key]);
    });
  }

  function applyAppSettings() {
    document.body.classList.toggle(
      'ui-compact',
      Boolean(appSettings.compactUI),
    );
    document.body.classList.toggle(
      'ui-reduced-motion',
      !appSettings.animations,
    );
    document.body.classList.toggle('no-particles', !appSettings.particles);
    document.body.classList.toggle('no-waveform', !appSettings.waveform);

    if (particlesCanvas)
      particlesCanvas.style.display = appSettings.particles ? '' : 'none';
    if (waveformCanvas)
      waveformCanvas.style.display = appSettings.waveform ? '' : 'none';

    setSttMode(sttMode);
  }

  function bindAppSettingsControls() {
    const map = {
      'setting-auto-listen': 'autoListen',
      'setting-auto-speak': 'autoSpeak',
      'setting-particles': 'particles',
      'setting-animations': 'animations',
      'setting-waveform': 'waveform',
      'setting-compact': 'compactUI',
    };
    Object.entries(map).forEach(([id, key]) => {
      const input = $(id);
      if (!input) return;
      input.addEventListener('change', () => {
        appSettings[key] = Boolean(input.checked);
        saveAppSettings();
        applyAppSettings();
      });
    });
  }

  // ============================================
  // A. PRONUNCIATION SCORING
  // ============================================
  const pronunScores = []; // per-session scores

  function showPronunciationScore(confidence) {
    const bar = $('pronunciation-bar');
    if (!bar) return;

    // Convert 0-1 confidence to 1-10 scale with curve
    const raw = Math.max(0, Math.min(1, confidence));
    const score = Math.round(raw * 10);
    pronunScores.push(score);

    bar.classList.remove('hidden');

    // Stars
    const starsEl = $('pronun-stars');
    let starsHTML = '';
    for (let i = 1; i <= 10; i++) {
      starsHTML += `<span class="pronun-star ${i <= score ? 'filled' : 'empty'}">★</span>`;
    }
    starsEl.innerHTML = starsHTML;

    // Number
    $('pronun-score-num').textContent = `${score}/10`;

    // Bar fill
    $('pronun-bar-fill').style.width = score * 10 + '%';

    // Label
    const labels = [
      '',
      'Keep practicing!',
      'Getting there!',
      'Not bad!',
      'Good effort!',
      'Nice!',
      'Very good!',
      'Great!',
      'Excellent!',
      'Outstanding!',
      'Perfect!',
    ];
    $('pronun-label').textContent = labels[score] || '';

    // XP tracking for pronunciation
    if (window.EchoFeatures) window.EchoFeatures.XP.trackPronunciation(score);

    // Auto-hide after 5 seconds
    setTimeout(() => {
      if (!recognizing) bar.classList.add('hidden');
    }, 5000);
  }

  function getAvgPronunciation() {
    if (pronunScores.length === 0) return '-';
    const avg = pronunScores.reduce((a, b) => a + b, 0) / pronunScores.length;
    return avg.toFixed(1) + '/10';
  }

  // ============================================
  // B. GRAMMAR TRACKER
  // ============================================
  const corrections = []; // { wrong, right, timestamp }

  function parseCorrections(aiText) {
    // Pattern: "instead of X, say/use Y" or "X → Y"
    const patterns = [
      /instead of ["'](.+?)["'],?\s*(?:you could|you can|try|say|use)\s+["'](.+?)["']/gi,
      /rather than ["'](.+?)["'],?\s*(?:say|use)\s+["'](.+?)["']/gi,
      /["'](.+?)["']\s*(?:should be|→|->)\s*["'](.+?)["']/gi,
      /not ["'](.+?)["']\s*but\s*["'](.+?)["']/gi,
    ];

    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(aiText)) !== null) {
        const wrong = match[1].trim();
        const right = match[2].trim();
        if (wrong && right && wrong !== right) {
          corrections.push({ wrong, right, timestamp: Date.now() });
          renderCorrections();
          if (window.EchoFeatures) window.EchoFeatures.XP.trackCorrection();
        }
      }
    });
    try {
      localStorage.setItem('echo_corrections', JSON.stringify(corrections));
    } catch (e) {}
  }

  function renderCorrections() {
    const list = $('corrections-list');
    const empty = $('grammar-empty');
    if (!list) return;
    if (corrections.length > 0 && empty) empty.classList.add('hidden');

    list.innerHTML = '';
    corrections
      .slice()
      .reverse()
      .forEach((c) => {
        const card = document.createElement('div');
        card.className = 'correction-card';
        card.innerHTML = `
        <span class="correction-wrong">${c.wrong}</span>
        <span class="correction-arrow">→</span>
        <span class="correction-right">${c.right}</span>
      `;
        list.appendChild(card);
      });
  }

  // ============================================
  // C. VOCABULARY BUILDER
  // ============================================
  let vocabWords = []; // { word, context, added }
  let fcIndex = 0;

  function parseVocab(aiText) {
    // Extract bold words as vocab suggestions
    const boldWords = aiText.match(/\*\*(.+?)\*\*/g);
    if (boldWords) {
      boldWords.forEach((bw) => {
        const word = bw.replace(/\*\*/g, '').trim();
        // Only add if it's a single word or short phrase, not a label
        if (
          word.length >= 3 &&
          word.length <= 30 &&
          word.split(' ').length <= 4
        ) {
          if (
            !vocabWords.find((v) => v.word.toLowerCase() === word.toLowerCase())
          ) {
            // Extract surrounding context sentence
            const idx = aiText.indexOf(bw);
            const contextStart = Math.max(0, aiText.lastIndexOf('.', idx) + 1);
            const contextEnd = aiText.indexOf('.', idx + bw.length);
            const context = aiText
              .slice(contextStart, contextEnd > 0 ? contextEnd + 1 : undefined)
              .trim()
              .slice(0, 80);
            vocabWords.push({ word, context, added: Date.now() });
          }
        }
      });
    }

    // Extract quoted suggestions
    const quotedWords = aiText.match(/"([^"]{3,25})"/g);
    if (quotedWords) {
      quotedWords.forEach((qw) => {
        const word = qw.replace(/"/g, '').trim();
        if (
          word.length >= 3 &&
          !vocabWords.find((v) => v.word.toLowerCase() === word.toLowerCase())
        ) {
          vocabWords.push({ word, context: '', added: Date.now() });
        }
      });
    }

    renderVocabList();
    saveVocab();
  }

  function renderVocabList() {
    const list = $('vocab-list');
    const empty = $('vocab-empty');
    if (!list) return;
    if (vocabWords.length > 0 && empty) empty.classList.add('hidden');

    // Clear only word items, keep empty state
    list.querySelectorAll('.vocab-item').forEach((el) => el.remove());

    vocabWords
      .slice()
      .reverse()
      .forEach((v, ri) => {
        const i = vocabWords.length - 1 - ri;
        const item = document.createElement('div');
        item.className = 'vocab-item';
        item.innerHTML = `
        <div>
          <div class="vocab-word">${v.word}</div>
          ${v.context ? `<div class="vocab-context">${v.context}</div>` : ''}
        </div>
        <button class="vocab-remove" data-idx="${i}">×</button>
      `;
        list.appendChild(item);
      });

    // Remove buttons
    list.querySelectorAll('.vocab-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        vocabWords.splice(idx, 1);
        renderVocabList();
        saveVocab();
      });
    });
  }

  // Flashcard system
  function showFlashcard(index) {
    if (vocabWords.length === 0) return;
    fcIndex =
      ((index % vocabWords.length) + vocabWords.length) % vocabWords.length;
    const v = vocabWords[fcIndex];
    $('flashcard-front').textContent = v.word;
    $('flashcard-back').textContent = v.context || 'No context available';
    $('fc-counter').textContent = `${fcIndex + 1}/${vocabWords.length}`;
    const fc = $('flashcard');
    if (fc) fc.classList.remove('flipped');
  }

  // Quiz system
  let quizWordIndex = -1;
  function startQuiz() {
    if (vocabWords.length < 2) {
      $('quiz-question').textContent = 'Need at least 2 words to quiz!';
      $('quiz-options').innerHTML = '';
      return;
    }
    quizWordIndex = Math.floor(Math.random() * vocabWords.length);
    const correct = vocabWords[quizWordIndex];

    // Build question
    $('quiz-question').textContent =
      `Which word matches: "${correct.context || correct.word}"?`;

    // Build options (1 correct + 2-3 wrong)
    const opts = [correct.word];
    const others = vocabWords.filter((_, i) => i !== quizWordIndex);
    const shuffled = others
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(3, others.length));
    shuffled.forEach((o) => opts.push(o.word));

    // Shuffle options
    opts.sort(() => Math.random() - 0.5);

    const optsEl = $('quiz-options');
    const resultEl = $('quiz-result');
    const nextBtn = $('quiz-next');
    optsEl.innerHTML = '';
    resultEl.classList.add('hidden');
    nextBtn.classList.add('hidden');

    opts.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        // Disable all buttons
        optsEl.querySelectorAll('.quiz-option').forEach((b) => {
          b.style.pointerEvents = 'none';
        });

        if (opt === correct.word) {
          btn.classList.add('correct');
          resultEl.textContent = 'Correct! 🎉';
          resultEl.style.color = '#48bb78';
        } else {
          btn.classList.add('wrong');
          // Highlight correct answer
          optsEl.querySelectorAll('.quiz-option').forEach((b) => {
            if (b.textContent === correct.word) b.classList.add('correct');
          });
          resultEl.textContent = `The answer was: "${correct.word}"`;
          resultEl.style.color = '#fc8181';
        }
        resultEl.classList.remove('hidden');
        nextBtn.classList.remove('hidden');
      });
      optsEl.appendChild(btn);
    });
  }

  function saveVocab() {
    try {
      localStorage.setItem('echo_vocab', JSON.stringify(vocabWords));
      // Sync new words to flashcard deck (echo_vocab_deck)
      if (window.echoSaveVocabWord) {
        vocabWords.forEach((v) => {
          window.echoSaveVocabWord(
            v.word,
            v.translation || '',
            v.context || '',
          );
        });
      }
    } catch (e) {}
  }
  function loadVocab() {
    try {
      const saved = localStorage.getItem('echo_vocab');
      if (saved) vocabWords = JSON.parse(saved);
    } catch (e) {}
  }

  // ============================================
  // D. SESSION SUMMARY & PROGRESS
  // ============================================
  function showSessionSummary() {
    const modal = $('summary-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    // Populate stats
    if (sessionStart) {
      const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      $('sum-time').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    $('sum-msgs').textContent = msgCount;
    $('sum-corrections').textContent = corrections.length;
    $('sum-vocab').textContent = vocabWords.length;
    $('sum-pronun').textContent = getAvgPronunciation();

    // XP earned this session
    const xpEarned = window.EchoFeatures
      ? window.EchoFeatures.XP.data.totalXP - sessionXPStart
      : 0;
    const sumXp = $('sum-xp');
    if (sumXp) sumXp.textContent = `+${xpEarned}`;

    // Save today's progress
    saveProgress();
    renderWeeklyProgress();

    // Render badges in summary
    if (window.EchoFeatures && allBadges.length) {
      window.EchoFeatures.XP.renderBadges('badges-grid', allBadges);
    }
  }

  function saveProgress() {
    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const progress = JSON.parse(
        localStorage.getItem('echo_progress') || '{}',
      );
      if (!progress[today])
        progress[today] = { minutes: 0, messages: 0, corrections: 0, vocab: 0 };
      const elapsed = sessionStart
        ? Math.floor((Date.now() - sessionStart) / 60000)
        : 0;
      progress[today].minutes += elapsed;
      progress[today].messages += msgCount;
      progress[today].corrections += corrections.length;
      progress[today].vocab += vocabWords.length;
      localStorage.setItem('echo_progress', JSON.stringify(progress));
    } catch (e) {}
  }

  function renderWeeklyProgress() {
    const barsEl = $('progress-bars');
    if (!barsEl) return;
    barsEl.innerHTML = '';

    const progress = JSON.parse(localStorage.getItem('echo_progress') || '{}');
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    const maxMins = 30; // scale: 30 min = 100%

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayData = progress[key] || { minutes: 0 };
      const height = Math.min(100, (dayData.minutes / maxMins) * 100);

      const dayEl = document.createElement('div');
      dayEl.className = 'progress-bar-day';
      dayEl.innerHTML = `
        <div class="progress-bar-fill" style="height:${Math.max(4, height)}%"></div>
        <span class="progress-bar-label">${days[d.getDay()]}</span>
      `;
      barsEl.appendChild(dayEl);
    }
  }

  // ============================================
  // 1. PARTICLE SYSTEM
  // ============================================
  const particles = [];
  const PARTICLE_COUNT = 60;
  let pCtx = null;

  function initParticles() {
    pCtx = particlesCanvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * particlesCanvas.width,
        y: Math.random() * particlesCanvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.3 + 0.05,
        color: Math.random() > 0.5 ? '99,179,237' : '159,122,234',
      });
    }
    animateParticles();
  }

  function resizeCanvas() {
    particlesCanvas.width = window.innerWidth;
    particlesCanvas.height = window.innerHeight;
  }

  function animateParticles() {
    if (!pCtx) return;
    const w = particlesCanvas.width,
      h = particlesCanvas.height;
    if (!appSettings.particles) {
      pCtx.clearRect(0, 0, w, h);
      requestAnimationFrame(animateParticles);
      return;
    }
    pCtx.clearRect(0, 0, w, h);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
      pCtx.beginPath();
      pCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      pCtx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
      pCtx.fill();
    });
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          pCtx.beginPath();
          pCtx.moveTo(particles[i].x, particles[i].y);
          pCtx.lineTo(particles[j].x, particles[j].y);
          pCtx.strokeStyle = `rgba(99, 179, 237, ${0.04 * (1 - dist / 120)})`;
          pCtx.lineWidth = 0.5;
          pCtx.stroke();
        }
      }
    }
    requestAnimationFrame(animateParticles);
  }

  // ============================================
  // 2. WAVEFORM VISUALIZER
  // ============================================
  function initWaveform() {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
    } catch (e) {}
  }

  function connectMicToWaveform(stream) {
    if (!audioContext || !analyser) return;
    micStream = audioContext.createMediaStreamSource(stream);
    micStream.connect(analyser);
    drawWaveform();
  }

  function drawWaveform() {
    if (!analyser || !recognizing || !appSettings.waveform) return;
    const ctx = waveformCanvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    const w = waveformCanvas.width,
      h = waveformCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const barWidth = (w / bufferLength) * 2.5;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * h * 0.8;
      const gradient = ctx.createLinearGradient(x, h, x, h - barHeight);
      gradient.addColorStop(0, 'rgba(72, 187, 120, 0.1)');
      gradient.addColorStop(1, 'rgba(72, 187, 120, 0.6)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, h - barHeight, barWidth - 1, barHeight);
      x += barWidth;
    }
    requestAnimationFrame(drawWaveform);
  }

  // ============================================
  // 3. ONBOARDING
  // ============================================
  function renderTopics() {
    topicGrid.innerHTML = '';
    topics.forEach((t) => {
      const card = document.createElement('button');
      card.className = 'topic-card' + (t.id === selectedTopic ? ' active' : '');
      card.dataset.topic = t.id;
      card.innerHTML = `<span class="topic-icon">${t.icon}</span><span class="topic-name">${t.label}</span>`;
      card.addEventListener('click', () => {
        selectedTopic = t.id;
        topicGrid
          .querySelectorAll('.topic-card')
          .forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
      });
      topicGrid.appendChild(card);
    });
  }

  levelCards.addEventListener('click', (e) => {
    const card = e.target.closest('.level-card');
    if (!card) return;
    selectedLevel = card.dataset.level;
    levelCards
      .querySelectorAll('.level-card')
      .forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
  });

  fetch('/topics')
    .then((r) => r.json())
    .then((data) => {
      if (data.topics) topics = data.topics;
      if (data.scenarios && window.EchoFeatures) {
        window.EchoFeatures.Scenarios.data = data.scenarios;
        window.EchoFeatures.Scenarios.render('scenario-grid');
      }
      if (data.badges) {
        allBadges = data.badges;
        if (window.EchoFeatures)
          window.EchoFeatures.XP.renderBadges('badges-full-grid', allBadges);
      }
      renderTopics();
    })
    .catch(() => renderTopics());

  // Language selection
  document.querySelectorAll('.lang-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedLanguage = card.dataset.lang;
      if (recognition) recognition.lang = getLanguageVoiceCode();
      document
        .querySelectorAll('.lang-card')
        .forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
    });
  });

  // Mode toggle (Topics vs Scenarios)
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('.mode-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMode = btn.dataset.mode;
      $('topic-section')?.classList.toggle('hidden', selectedMode !== 'topic');
      $('scenario-section')?.classList.toggle(
        'hidden',
        selectedMode !== 'scenario',
      );
      if (selectedMode === 'topic') selectedScenario = null;
    });
  });

  // Scenario selection (delegated)
  $('scenario-grid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.scenario-card');
    if (!card) return;
    selectedScenario = card.dataset.scenario;
    $('scenario-grid')
      .querySelectorAll('.scenario-card')
      .forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
  });

  startBtn.addEventListener('click', () => {
    if (!currentUser && !isGuestTrial) {
      showToast('Please login first', 'error');
      setTimeout(() => {
        window.location.href = '/login';
      }, 300);
      return;
    }
    if (!currentUser && isGuestTrial) {
      showToast(
        'Guest mode: 4 messages or 3 minutes, then signup is required.',
        '',
      );
    }
    onboardingScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');
    document.body.classList.add('in-chat'); // lock body scroll on mobile
    window._echoLevel = selectedLevel;
    window._echoLanguage = selectedLanguage;
    if (window.EchoFeatures)
      sessionXPStart = window.EchoFeatures.XP.data.totalXP;
    // Show bottom nav for Stories / Flashcards / Progress
    if (window.echoShowNav) window.echoShowNav();
    startSession();
  });

  function startSession() {
    sessionStart = Date.now();
    msgCount = 0;
    guestUserMessages = 0;
    conversationHistory = [];
    ended = false;
    turn = 'user';
    updateStats();
    sessionTimer = setInterval(updateStats, 1000);
    const displayName =
      (currentUser?.full_name || currentUser?.email || '')
        .trim()
        .split('@')[0] || 'friend';
    const topicLabel =
      selectedMode === 'topic'
        ? topics.find((t) => t.id === selectedTopic)?.label ||
          selectedTopic ||
          'free talk'
        : selectedScenario || 'practice';
    const instantGreeting =
      currentUILang === 'ar'
        ? `مرحباً ${displayName}! جاهز نبدأ الآن؟ اخترت ${topicLabel}.`
        : `Welcome ${displayName}! Ready to start now? You chose ${topicLabel}.`;
    addMessage(instantGreeting, 'assistant');
    setAvatarState('idle');
    if (autoListen && !ended) {
      scheduleAutoMic(260);
    }
  }

  function updateStats() {
    if (!sessionStart) return;
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    statTime.textContent = `⏱ ${mins}:${secs.toString().padStart(2, '0')}`;
    statMsgs.textContent = `💬 ${msgCount}`;
  }

  // ============================================
  // 4. AVATAR STATE MANAGEMENT
  // ============================================
  let currentChar = localStorage.getItem('echo_char') || 'orb';
  const avatarOrb = document.getElementById('avatar-orb');

  // Setup character buttons
  document.querySelectorAll('.char-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('.char-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentChar = btn.dataset.char;
      localStorage.setItem('echo_char', currentChar);
      applyCharacter(currentChar);
    });
  });

  // Apply saved character on load
  const savedCharBtn = document.querySelector(
    `.char-btn[data-char="${currentChar}"]`,
  );
  if (savedCharBtn) {
    document
      .querySelectorAll('.char-btn')
      .forEach((b) => b.classList.remove('active'));
    savedCharBtn.classList.add('active');
  }
  if (avatarOrb) applyCharacter(currentChar);

  function applyCharacter(char) {
    if (!avatarOrb) return;
    avatarOrb.classList.remove('char-robot', 'char-owl', 'char-star');
    if (char !== 'orb') avatarOrb.classList.add(`char-${char}`);
    // Hide orb face elements for non-orb characters
    const orbFace = avatarOrb.querySelector('.orb-face');
    if (orbFace) {
      orbFace.style.opacity = char === 'orb' ? '1' : '0';
    }
  }

  function setAvatarState(state) {
    avatarContainer.classList.remove(
      'idle',
      'listening',
      'speaking',
      'thinking',
      'happy',
    );
    avatarContainer.classList.add(state);
    if (avatarOrb) {
      avatarOrb.classList.toggle('speaking', state === 'speaking');
    }
    const t = uiTranslations[currentUILang] || uiTranslations.en;
    const labels = {
      idle: currentUILang === 'ar' ? 'اضغط للدردشة' : 'Tap to chat',
      listening: t.listening || 'Listening...',
      speaking: t.speaking || 'Speaking...',
      thinking: t.thinking || 'Thinking...',
      happy: '✨',
    };
    stateLabel.textContent = labels[state] || t.ready || 'Ready';
    headerStatus.textContent = labels[state] || t.ready || 'Ready';
  }

  function resetAutoMicGuard() {
    autoMicRetryCount = 0;
    autoMicBlockedUntil = 0;
  }

  function registerAutoMicRetry() {
    autoMicRetryCount += 1;
    if (autoMicRetryCount >= 3) {
      autoMicBlockedUntil = Date.now() + 2500;
      autoMicRetryCount = 0;
    }
  }

  function scheduleAutoMic(delayMs = 320) {
    if (!autoListen || ended || turn !== 'user') return;
    if (Date.now() < autoMicBlockedUntil) return;

    setTimeout(
      () => {
        if (!autoListen || ended || turn !== 'user') return;
        if (Date.now() < autoMicBlockedUntil) return;
        if (recognizing || whisperRecording) return;

        const now = Date.now();
        if (now - lastAutoMicAt < 450) return;
        lastAutoMicAt = now;
        openMic();
      },
      Math.max(220, delayMs),
    );
  }

  // Eye blink
  function blink() {
    const eL = $('eyelid-left'),
      eR = $('eyelid-right');
    if (!eL || !eR) return;
    eL.style.top = '0';
    eR.style.top = '0';
    setTimeout(
      () => {
        eL.style.top = '-100%';
        eR.style.top = '-100%';
      },
      100 + Math.random() * 60,
    );
  }
  function randomBlink() {
    blink();
    if (Math.random() < 0.2) setTimeout(blink, 200);
    setTimeout(randomBlink, 2000 + Math.random() * 4000);
  }
  setTimeout(randomBlink, 1500);

  // Pupil tracking
  (function initPupilTracking() {
    const orb = $('avatar-orb');
    if (!orb) return;
    document.addEventListener('mousemove', (e) => {
      const rect = orb.getBoundingClientRect();
      const cx = rect.left + rect.width / 2,
        cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx,
        dy = e.clientY - cy;
      const angle = Math.atan2(dy, dx);
      const dist = Math.min(Math.sqrt(dx * dx + dy * dy), 150);
      const m = (3 * dist) / 150;
      document.querySelectorAll('.orb-pupil').forEach((p) => {
        p.style.transform = `translate(${m * Math.cos(angle)}px, ${m * Math.sin(angle)}px)`;
      });
    });
  })();

  // Lip-sync
  const mouthBars = [1, 2, 3, 4, 5]
    .map((i) => $('mouth-bar-' + i))
    .filter(Boolean);
  function startLipSync() {
    stopLipSync();
    lipSyncInterval = setInterval(() => {
      mouthBars.forEach((bar, i) => {
        bar.style.height =
          (i === 2 ? 8 : 4) + Math.random() * (i === 2 ? 6 : 4) + 'px';
      });
    }, 80);
  }
  function stopLipSync() {
    if (lipSyncInterval) {
      clearInterval(lipSyncInterval);
      lipSyncInterval = null;
    }
    [3, 4, 5, 4, 3].forEach((h, i) => {
      if (mouthBars[i]) mouthBars[i].style.height = h + 'px';
    });
  }

  // Emotion system
  function showEmotion(emoji, dur = 2000) {
    if (!emotionIndicator) return;
    emotionIndicator.textContent = emoji;
    emotionIndicator.classList.add('visible');
    setTimeout(() => emotionIndicator.classList.remove('visible'), dur);
  }

  function reactToEmotion(text) {
    const l = text.toLowerCase();
    if (
      /great job|well done|excellent|perfect|fantastic|awesome|well said/i.test(
        l,
      )
    ) {
      showEmotion('🌟', 2500);
      setTimeout(() => {
        avatarContainer.classList.add('happy');
        setTimeout(() => avatarContainer.classList.remove('happy'), 2000);
      }, 500);
    } else if (/instead of|should be|not quite|correction/i.test(l)) {
      showEmotion('✏️', 2000);
    } else if (/welcome|hello|hey|hi there/i.test(l)) {
      showEmotion('👋', 2500);
      setTimeout(() => {
        avatarContainer.classList.add('happy');
        setTimeout(() => avatarContainer.classList.remove('happy'), 2000);
      }, 300);
    }
  }

  // ============================================
  // 5. SPEECH RECOGNITION (STT) + Pronunciation
  // ============================================
  async function startWhisperRecording() {
    if (
      !window.EchoFeatures?.Whisper ||
      whisperRecording ||
      ended ||
      turn !== 'user'
    )
      return;
    if (whisperServerAvailable === false) {
      showToast('Whisper server unavailable. Check API keys.', 'error');
      return;
    }

    // Safety timeout to prevent infinite "Listening..." state if mic fails
    const safetyTimer = setTimeout(() => {
      if (recognizing && whisperRecording) {
        console.warn('Whisper start timeout - resetting');
        whisperRecording = false;
        recognizing = false;
        micBtn.classList.remove('active');
        setAvatarState('idle');
        showToast('Microphone error — tap to retry', 'error');
      }
    }, 5000);

    try {
      const stream =
          await window.EchoFeatures.Whisper.start(getSttLanguageCode(), () => {
            if (whisperRecording) {
              console.log('Silence detected, auto-stopping Whisper');
              stopWhisperRecordingAndSend();
            }
          });
      if (!stream) {
        showToast('Microphone unavailable', 'error');
        setAvatarState('idle');
        return;
      }
      whisperRecording = true;
      recognizing = true;
      micBtn.classList.add('active');
      setAvatarState('listening');
      connectMicToWaveform(stream);
    } catch (e) {
      clearTimeout(safetyTimer);
      showToast('Microphone permission blocked', 'error');
      setAvatarState('idle');
    }
  }

  async function stopWhisperRecordingAndSend() {
    if (!window.EchoFeatures?.Whisper || !whisperRecording) return;

    whisperRecording = false;
    recognizing = false;
    micBtn.classList.remove('active');
    setAvatarState('thinking');

    const blob = await window.EchoFeatures.Whisper.stop();
    if (!blob) {
      setAvatarState('idle');
      if (autoListen && !ended && turn === 'user') {
        registerAutoMicRetry();
        scheduleAutoMic(520);
      }
      return;
    }

    const result = await window.EchoFeatures.Whisper.transcribe(
      blob,
      getSttLanguageCode(),
    );
    if (!result?.ok) {
      setAvatarState('idle');
      showToast(result?.error || 'Whisper transcription failed', 'error');
      if (autoListen && !ended && turn === 'user') {
        registerAutoMicRetry();
        scheduleAutoMic(620);
      }
      return;
    }
    const transcript = result?.text?.trim();
    if (!transcript) {
      setAvatarState('idle');
      if (autoListen && !ended && turn === 'user') {
        registerAutoMicRetry();
        scheduleAutoMic(560);
      }
      return;
    }

    resetAutoMicGuard();

    if (enforceGuestTrialLimit()) {
      setAvatarState('idle');
      return;
    }

    addMessage(transcript, 'user');
    turn = 'ai';
    resetTurnStuckTimer();
    fetchStreamingResponse(conversationHistory);
  }

  if (
    !mobileWhisperOnly &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
  ) {
    browserSpeechAvailable = true;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = getLanguageVoiceCode();
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      if (turn === 'user') {
        if (enforceGuestTrialLimit()) return;
        resetAutoMicGuard();
        const result = event.results[0][0];
        const transcript = result.transcript;
        const confidence = result.confidence; // 0-1

        // Show pronunciation score
        showPronunciationScore(confidence);

        addMessage(transcript, 'user');
        turn = 'ai';
        resetTurnStuckTimer();
        fetchStreamingResponse(conversationHistory);
      }
    };

    recognition.onstart = () => {
      recognizing = true;
      setAvatarState('listening');
      micBtn.classList.add('active');
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((stream) => connectMicToWaveform(stream))
          .catch(() => {});
      }
    };

    recognition.onend = () => {
      recognizing = false;
      micBtn.classList.remove('active');
      if (autoListen && !ended && turn === 'user') scheduleAutoMic(320);
      else if (turn === 'user') setAvatarState('idle');
    };

    recognition.onerror = (event) => {
      recognizing = false;
      micBtn.classList.remove('active');
      if (event.error === 'no-speech') registerAutoMicRetry();
      else resetAutoMicGuard();
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        showToast('Mic error: ' + event.error, 'error');
      }
      if (turn === 'user') setAvatarState('idle');
    };
  } else {
    browserSpeechAvailable = false;
  }

  setSttMode(sttMode);
  refreshWhisperAvailability();

  sttBtn?.addEventListener('click', () => {
    if (mobileWhisperOnly) {
      setSttMode('whisper');
      showToast('Mobile uses Whisper only', '');
      return;
    }

    const order = ['auto', 'whisper', 'browser'];
    const idx = order.indexOf(sttMode);
    const nextMode = order[(idx + 1) % order.length];
    setSttMode(nextMode);

    if (nextMode === 'whisper' && !canUseWhisperClient()) {
      showToast('Whisper unsupported in this browser', 'error');
    } else if (nextMode === 'browser' && !browserSpeechAvailable) {
      showToast('Browser STT unavailable', 'error');
    } else {
      showToast(`STT mode: ${nextMode}`, 'success');
    }
  });

  // ============================================
  // 6. CORE MESSAGING
  // ============================================
  function addMessageToDOM(text, cls, isStreaming = false) {
    const msg = document.createElement('div');
    msg.className = 'message ' + cls + (isStreaming ? ' streaming' : '');
    msg.innerHTML = formatMessage(text);
    messagesDiv.appendChild(msg);
    smartScroll();
    return msg;
  }

  function addMessage(text, role) {
    addMessageToDOM(text, role === 'user' ? 'user' : 'ai');
    conversationHistory.push({ role, content: text });
    if (role === 'user') guestUserMessages++;
    msgCount++;
    updateStats();
    saveHistory();
  }

  function isGuestTrialExpired() {
    if (!isGuestTrial || currentUser) return false;
    const elapsedSeconds = sessionStart
      ? Math.floor((Date.now() - sessionStart) / 1000)
      : 0;
    return (
      guestUserMessages >= GUEST_TRIAL_MAX_USER_MESSAGES ||
      elapsedSeconds >= GUEST_TRIAL_MAX_SECONDS
    );
  }

  function enforceGuestTrialLimit() {
    if (!isGuestTrialExpired()) return false;
    ended = true;
    turn = 'done';
    closeMic();
    speechSessionId += 1;
    window.speechSynthesis.cancel();
    stopLipSync();
    if (sessionTimer) clearInterval(sessionTimer);
    setAvatarState('idle');
    addMessageToDOM(
      'Guest trial ended. Please create an account from /signup or login from /login to continue.',
      'ai',
    );
    showToast('Guest trial ended — please sign up to continue.', 'error');
    return true;
  }

  function formatMessage(text) {
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    text = text.replace(
      /`(.*?)`/g,
      '<code style="background:rgba(99,179,237,0.15);padding:1px 5px;border-radius:4px;font-size:0.85em;">$1</code>',
    );
    text = text.replace(/\n/g, '<br>');
    return text;
  }

  function showTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'message ai typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesDiv.appendChild(div);
    smartScroll();
    return div;
  }

  function smartScroll() {
    if (!userScrolledUp) messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  async function fetchNonStreamingResponse(history, { signal } = {}) {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history,
        level: selectedLevel,
        topic: selectedTopic,
        language: selectedLanguage,
        scenario: selectedScenario,
        user_name: currentUser?.full_name || currentUser?.email || '',
      }),
      signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Server error ${res.status}`);
    }

    const text = (data.response || '').trim();
    if (!text) {
      throw new Error('Empty response from AI service');
    }

    return text;
  }

  messagesDiv.addEventListener('scroll', () => {
    userScrolledUp =
      messagesDiv.scrollHeight -
        messagesDiv.scrollTop -
        messagesDiv.clientHeight >
      60;
  });

  // ============================================
  // 7. STREAMING FETCH (SSE)
  // ============================================
  async function fetchStreamingResponse(history) {
    closeMic();
    setAvatarState('thinking');
    const typingEl = showTypingIndicator();

    try {
      const supportsStreamReader =
        !isMobile &&
        typeof ReadableStream !== 'undefined' &&
        typeof TextDecoder !== 'undefined' &&
        typeof AbortController !== 'undefined';

      if (!supportsStreamReader) {
        const text = await fetchNonStreamingResponse(history);
        if (typingEl.parentNode) typingEl.remove();
        const streamMsg = addMessageToDOM(text, 'ai');
        const fullText = text;
        streamMsg.classList.remove('streaming');
        conversationHistory.push({ role: 'assistant', content: fullText });
        msgCount++;
        updateStats();
        saveHistory();
        reactToEmotion(fullText);
        parseCorrections(fullText);
        parseVocab(fullText);
        if (window.EchoFeatures) window.EchoFeatures.XP.trackMessage();
        if (appSettings.autoSpeak && !isMuted) {
          turn = 'ai-speaking';
          speak(fullText);
        } else {
          stopLipSync();
          setAvatarState('idle');
          turn = 'user';
          if (autoListen && !ended) setTimeout(() => openMic(), 300);
        }
        return;
      }

      const streamController = new AbortController();
      const hardTimeout = setTimeout(() => {
        streamController.abort();
      }, 90000);

      const res = await fetch('/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history,
          level: selectedLevel,
          topic: selectedTopic,
          language: selectedLanguage,
          scenario: selectedScenario,
          user_name: currentUser?.full_name || currentUser?.email || '',
        }),
        signal: streamController.signal,
      });

      if (!res.ok) {
        clearTimeout(hardTimeout);
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      if (!res.body || !res.body.getReader) {
        clearTimeout(hardTimeout);
        throw new Error('Streaming unsupported on this browser');
      }

      if (typingEl.parentNode) typingEl.remove();
      const streamMsg = addMessageToDOM('', 'ai', true);
      let fullText = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let firstTokenSeen = false;
      let firstTokenTimeout = setTimeout(() => {
        try {
          streamController.abort();
        } catch (e) {}
      }, 20000);

      setAvatarState('speaking');
      startLipSync();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload);
            if (data.error) throw new Error(data.error);
            if (data.token) {
              if (!firstTokenSeen) {
                firstTokenSeen = true;
                clearTimeout(firstTokenTimeout);
              }
              fullText += data.token;
              streamMsg.innerHTML = formatMessage(fullText);
              smartScroll();
            }
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }

      clearTimeout(firstTokenTimeout);
      clearTimeout(hardTimeout);

      if (!fullText.trim()) {
        throw new Error('Empty streaming response');
      }

      streamMsg.classList.remove('streaming');
      conversationHistory.push({ role: 'assistant', content: fullText });
      msgCount++;
      updateStats();
      saveHistory();

      // ─── Process AI response for features ───
      reactToEmotion(fullText);
      parseCorrections(fullText);
      parseVocab(fullText);

      // XP tracking
      if (window.EchoFeatures) window.EchoFeatures.XP.trackMessage();

      if (appSettings.autoSpeak && !isMuted) {
        turn = 'ai-speaking';
        speak(fullText);
      } else {
        stopLipSync();
        setAvatarState('idle');
        turn = 'user';
        if (autoListen && !ended) setTimeout(() => openMic(), 300);
      }
    } catch (error) {
      const canFallbackToJson =
        error?.name === 'AbortError' ||
        /Streaming unsupported|Empty streaming response|Failed to fetch|NetworkError/i.test(
          error?.message || '',
        );

      if (canFallbackToJson) {
        try {
          if (typingEl.parentNode) typingEl.remove();
          const fallbackTyping = showTypingIndicator();
          const text = await fetchNonStreamingResponse(history);
          if (fallbackTyping.parentNode) fallbackTyping.remove();
          addMessageToDOM(text, 'ai');
          conversationHistory.push({ role: 'assistant', content: text });
          msgCount++;
          updateStats();
          saveHistory();
          reactToEmotion(text);
          parseCorrections(text);
          parseVocab(text);
          if (window.EchoFeatures) window.EchoFeatures.XP.trackMessage();
          if (appSettings.autoSpeak && !isMuted) {
            turn = 'ai-speaking';
            speak(text);
          } else {
            stopLipSync();
            setAvatarState('idle');
            turn = 'user';
            if (autoListen && !ended) setTimeout(() => openMic(), 300);
          }
          return;
        } catch (fallbackError) {
          if (typingEl.parentNode) typingEl.remove();
          addMessageToDOM(
            fallbackError.message || 'Connection error',
            'ai-error',
          );
          setAvatarState('idle');
          stopLipSync();
          turn = 'user';
          showToast(fallbackError.message || 'Connection error', 'error');
          if (autoListen && !ended) openMic();
          return;
        }
      }

      if (typingEl.parentNode) typingEl.remove();
      addMessageToDOM(error.message || 'Connection error', 'ai-error');
      setAvatarState('idle');
      stopLipSync();
      turn = 'user';
      showToast(error.message, 'error');
      if (autoListen && !ended) openMic();
    }
  }

  // ============================================
  // 8. TEXT-TO-SPEECH (TTS)
  // ============================================
  function cleanTextForSpeech(text) {
    let c = text;
    c = c.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
    c = c.replace(/[\u{1F300}-\u{1F5FF}]/gu, '');
    c = c.replace(/[\u{1F680}-\u{1F6FF}]/gu, '');
    c = c.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '');
    c = c.replace(/[\u{2600}-\u{26FF}]/gu, '');
    c = c.replace(/[\u{2700}-\u{27BF}]/gu, '');
    c = c.replace(/[\u{FE00}-\u{FE0F}]/gu, '');
    c = c.replace(/[\u{1F900}-\u{1F9FF}]/gu, '');
    c = c.replace(/[\u{1FA00}-\u{1FAFF}]/gu, '');
    c = c.replace(/[\u{200D}]/gu, '');
    c = c.replace(/\*\*(.*?)\*\*/g, '$1');
    c = c.replace(/\*(.*?)\*/g, '$1');
    c = c.replace(/`(.*?)`/g, '$1');
    c = c.replace(/#{1,6}\s/g, '');
    c = c.replace(/\b(Correction|Suggestion|Note|Tip|Example|Hint)\s*:/gi, '');
    c = c.replace(/[—–•·]/g, ', ');
    c = c.replace(/[""]/g, '');
    c = c.replace(/['']/g, "'");
    c = c.replace(/\n+/g, '. ');
    c = c.replace(/\s{2,}/g, ' ');
    c = c.replace(/^[,.\s]+/, '').replace(/[,\s]+$/, '');
    return c.trim();
  }

  function speak(text) {
    speechSessionId += 1;
    const sessionId = speechSessionId;

    // iOS Safari TTS is completely unreliable (needs gesture, often fires no onend)
    // Skip TTS on iOS entirely — just finish speaking immediately
    if (isIOS || !('speechSynthesis' in window) || isMuted) {
      stopLipSync();
      finishSpeaking(sessionId);
      return;
    }
    window.speechSynthesis.cancel();
    setAvatarState('speaking');
    startLipSync();
    const clean = cleanTextForSpeech(text);
    if (!clean) {
      stopLipSync();
      finishSpeaking(sessionId);
      return;
    }

    // On mobile, use short safety timeout (8s max) to avoid getting stuck
    const ttsSafetyMs = isMobile
      ? Math.max(2000, Math.min(clean.length * 50, 8000))
      : Math.max(5000, Math.min(clean.length * 60, 40000));
    const ttsWatchdog = setTimeout(() => {
      if (sessionId !== speechSessionId) return;
      console.warn('[Echo] TTS watchdog fired — forcing finishSpeaking');
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
      stopLipSync();
      finishSpeaking(sessionId);
    }, ttsSafetyMs);

    function doneSpeaking() {
      clearTimeout(ttsWatchdog);
      if (sessionId !== speechSessionId) return;
      stopLipSync();
      finishSpeaking(sessionId);
    }

    if (clean.length > 200) {
      speakChunked(clean, sessionId, ttsWatchdog);
      return;
    }

    const utter = new SpeechSynthesisUtterance(clean);
    applyVoiceProfileToUtterance(utter);
    utter.onend = doneSpeaking;
    utter.onerror = doneSpeaking;
    window.speechSynthesis.speak(utter);
  }

  function speakChunked(text, sessionId, externalWatchdog) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let idx = 0;
    function next() {
      if (sessionId !== speechSessionId) {
        if (externalWatchdog) clearTimeout(externalWatchdog);
        return;
      }
      if (idx >= sentences.length) {
        if (externalWatchdog) clearTimeout(externalWatchdog);
        stopLipSync();
        finishSpeaking(sessionId);
        return;
      }
      const s = sentences[idx].trim();
      if (!s) {
        idx++;
        next();
        return;
      }
      const u = new SpeechSynthesisUtterance(s);
      applyVoiceProfileToUtterance(u);
      u.onend = () => {
        if (sessionId !== speechSessionId) return;
        idx++;
        next();
      };
      u.onerror = () => {
        if (sessionId !== speechSessionId) return;
        idx++;
        next();
      };
      window.speechSynthesis.speak(u);
    }
    next();
  }

  function finishSpeaking(sessionId = speechSessionId) {
    if (sessionId !== speechSessionId) return;
    if (turnStuckTimer) clearTimeout(turnStuckTimer);
    stopLipSync();
    setAvatarState('idle');
    turn = 'user';
    if (autoListen && !ended) setTimeout(() => openMic(), 300);
  }

  // ============================================
  // 9. MIC CONTROLS
  // ============================================
  function openMic() {
    if (useWhisperFallback) {
      if (!canUseWhisperClient()) {
        if (browserSpeechAvailable) {
          setSttMode('browser');
        } else {
          showToast('Whisper unsupported in this browser', 'error');
          return;
        }
      }
      startWhisperRecording();
      return;
    }
    if (!recognition && canUseWhisperClient()) {
      setSttMode('whisper');
      startWhisperRecording();
      return;
    }
    if (!recognition || recognizing || ended || turn !== 'user') {
      if (!recognition && !canUseWhisperClient() && !ended) {
        showToast('Microphone not supported in this browser', 'error');
      }
      return;
    }
    try {
      if (audioContext && audioContext.state === 'suspended')
        audioContext.resume();
      recognition.start();
    } catch (e) {
      if (canUseWhisperClient()) {
        setSttMode('whisper');
        startWhisperRecording();
      } else {
        // Silent failure or blocked permission often happens here on mobile auto-start
        // Reset state so user can manually tap
        setAvatarState('idle');
        // Only show toast if it's a clear error, otherwise it's just spammy
        if (e.name !== 'NotAllowedError') {
          // Common on mobile without gesture
          console.log('Mic start failed (gesture required?)', e);
        }
      }
    }
  }
  function closeMic() {
    if (useWhisperFallback) {
      if (window.EchoFeatures?.Whisper && whisperRecording) {
        whisperRecording = false;
        recognizing = false;
        micBtn.classList.remove('active');
        window.EchoFeatures.Whisper.stop().catch?.(() => null);
      }
      return;
    }
    if (recognition && recognizing)
      try {
        recognition.abort();
      } catch (e) {}
  }

  function handleMicTap() {
    // On mobile: tap mic while AI is stuck → force unlock then start listening
    if (turn !== 'user' && !ended) {
      try {
        window.speechSynthesis?.cancel();
      } catch (e) {}
      stopLipSync();
      speechSessionId += 1;
      if (turnStuckTimer) clearTimeout(turnStuckTimer);
      turn = 'user';
      setAvatarState('idle');
    }
    if (useWhisperFallback) {
      if (whisperRecording) {
        stopWhisperRecordingAndSend();
      } else if (!ended) {
        startWhisperRecording();
      }
      return;
    }
    if (recognizing) {
      closeMic();
      return;
    }
    if (ended) return;
    openMic();
  }

  // touchend fires before click → use preventDefault to suppress the synthetic click
  micBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    handleMicTap();
  });
  micBtn.addEventListener('click', handleMicTap); // desktop fallback

  // ============================================
  // 10. SEND TEXT
  // ============================================
  // touchend fires before click on mobile — preventDefault suppresses synthetic click
  sendBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    sendText();
  });
  sendBtn.addEventListener('click', () => sendText()); // desktop fallback
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendText();
    }
  });

  function sendText() {
    if (enforceGuestTrialLimit()) return;
    const text = textInput.value.trim();
    if (!text || ended) return;
    resetAutoMicGuard();
    // Always allow interrupt: cancel any ongoing TTS/STT and take control
    if (turn !== 'user') {
      try {
        window.speechSynthesis?.cancel();
      } catch (e) {}
      if (recognition && recognizing) {
        try {
          recognition.abort();
        } catch (e) {}
      }
      stopLipSync();
      speechSessionId += 1;
      if (turnStuckTimer) clearTimeout(turnStuckTimer);
      turn = 'user';
      setAvatarState('idle');
    }
    textInput.value = '';
    textInput.style.height = 'auto';
    addMessage(text, 'user');
    turn = 'ai';
    resetTurnStuckTimer();
    fetchStreamingResponse(conversationHistory);
  }

  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 100) + 'px';
  });

  // Mute
  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    muteBtn.classList.toggle('muted', isMuted);
    const svg = document.getElementById('mute-svg');
    if (isMuted) {
      speechSessionId += 1;
      svg.innerHTML =
        '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
      window.speechSynthesis.cancel();
      stopLipSync();
      showToast('TTS muted', '');
    } else {
      svg.innerHTML =
        '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';
      showToast('TTS unmuted', 'success');
    }
  });

  // ============================================
  // 11. END CONVERSATION → SHOW SUMMARY
  // ============================================
  endBtn.addEventListener('click', () => {
    ended = true;
    closeMic();
    speechSessionId += 1;
    window.speechSynthesis.cancel();
    stopLipSync();
    if (sessionTimer) clearInterval(sessionTimer);
    setAvatarState('idle');
    turn = 'done';
    addMessageToDOM(
      'Session ended. Great practice! Refresh to start a new conversation.',
      'ai',
    );
    showSessionSummary();
  });

  // Summary modal controls
  $('summary-close')?.addEventListener('click', () =>
    $('summary-modal')?.classList.add('hidden'),
  );
  $('summary-restart')?.addEventListener('click', () => {
    $('summary-modal')?.classList.add('hidden');
    sessionStorage.removeItem('echo_history');
    location.reload();
  });

  // ============================================
  // 12. SIDE PANEL (Grammar + Vocab)
  // ============================================
  // Toggle panel with settings button
  settingsBtn.addEventListener('click', () => {
    const panel = $('side-panel');
    panel.classList.toggle('hidden');
    panel.classList.toggle('open');
  });

  $('panel-close')?.addEventListener('click', () => {
    const panel = $('side-panel');
    panel.classList.remove('open');
    setTimeout(() => panel.classList.add('hidden'), 350);
  });

  // Tab switching
  document.querySelectorAll('.panel-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document
        .querySelectorAll('.panel-tab')
        .forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      $('panel-grammar').classList.toggle('hidden', target !== 'grammar');
      $('panel-vocab').classList.toggle('hidden', target !== 'vocab');
      $('panel-voices').classList.toggle('hidden', target !== 'voices');
      $('panel-settings').classList.toggle('hidden', target !== 'settings');
    });
  });

  // Voice profiles controls
  $('voice-new')?.addEventListener('click', () => {
    editingVoiceProfileId = null;
    $('voice-profile-name').value = '';
    $('voice-rate').value = '0.95';
    $('voice-pitch').value = '1.05';
    $('voice-volume').value = '1';
    renderVoiceSelect('');
  });

  $('voice-save')?.addEventListener('click', () => {
    const name = ($('voice-profile-name').value || '').trim() || 'Custom Voice';
    const payload = {
      id: editingVoiceProfileId || `voice_${Date.now()}`,
      name,
      voiceName: $('voice-select').value || '',
      rate: parseFloat($('voice-rate').value || '0.95'),
      pitch: parseFloat($('voice-pitch').value || '1.05'),
      volume: parseFloat($('voice-volume').value || '1'),
      lang: getLanguageVoiceCode(),
    };

    const index = voiceProfiles.findIndex((v) => v.id === payload.id);
    if (index >= 0) voiceProfiles[index] = payload;
    else voiceProfiles.push(payload);

    activeVoiceProfileId = payload.id;
    editingVoiceProfileId = payload.id;
    saveVoiceProfiles();
    renderVoiceProfiles();
    loadVoiceEditor(payload);
    showToast('Voice profile saved', 'success');
  });

  $('voice-delete')?.addEventListener('click', () => {
    const targetId = editingVoiceProfileId || activeVoiceProfileId;
    if (!targetId) return;

    if (voiceProfiles.length <= 1) {
      showToast('At least one voice profile is required', 'error');
      return;
    }

    voiceProfiles = voiceProfiles.filter((v) => v.id !== targetId);
    activeVoiceProfileId = voiceProfiles[0].id;
    editingVoiceProfileId = activeVoiceProfileId;
    saveVoiceProfiles();
    renderVoiceProfiles();
    loadVoiceEditor(getActiveVoiceProfile());
    showToast('Voice profile deleted', 'success');
  });

  // Vocab mode switching
  document.querySelectorAll('.vocab-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('.vocab-mode-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      $('vocab-list').classList.toggle('hidden', mode !== 'list');
      $('flashcard-view').classList.toggle('hidden', mode !== 'cards');
      $('quiz-view').classList.toggle('hidden', mode !== 'quiz');
      if (mode === 'cards') showFlashcard(0);
      if (mode === 'quiz') startQuiz();
    });
  });

  // Flashcard controls
  $('flashcard')?.addEventListener('click', () =>
    $('flashcard')?.classList.toggle('flipped'),
  );
  $('fc-prev')?.addEventListener('click', () => showFlashcard(fcIndex - 1));
  $('fc-next')?.addEventListener('click', () => showFlashcard(fcIndex + 1));
  $('quiz-next')?.addEventListener('click', () => startQuiz());

  // ============================================
  // 13. KEYBOARD SHORTCUTS
  // ============================================
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'm') {
      e.preventDefault();
      micBtn.click();
    }
    if (e.key === 'Escape' && !ended) endBtn.click();
  });

  // ============================================
  // 14. TOAST NOTIFICATIONS
  // ============================================
  let toastTimeout = null;
  function showToast(msg, type = '') {
    if (!toastEl) return;
    // Add icon based on type
    const icons = { error: '⚠️', success: '✅', info: 'ℹ️', warning: '⚡' };
    const icon = icons[type] || '💬';
    toastEl.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
    toastEl.className = 'toast' + (type ? ' ' + type : '');
    toastEl.classList.add('visible');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toastEl.classList.remove('visible'), 3500);
  }

  // ============================================
  // 15. AUTH INTEGRATION
  // ============================================
  function setAuthUI(user) {
    currentUser = user || null;
    if (currentUser) {
      isGuestTrial = false;
      sessionStorage.removeItem('echo_guest_trial');
    }
    if (authUserLabel) {
      authUserLabel.textContent = currentUser
        ? (currentUser.full_name || currentUser.email || 'U')
            .slice(0, 1)
            .toUpperCase()
        : '👤';
    }

    const currentEl = $('auth-current');
    if (currentEl) {
      currentEl.textContent = currentUser
        ? `Signed in as ${currentUser.full_name || currentUser.email}`
        : 'Not signed in';
    }

    $('auth-logout')?.classList.toggle('hidden', !currentUser);
  }

  async function authRequest(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch (e) {}

    if (!res.ok) {
      throw new Error(payload?.detail || payload?.error || 'Request failed');
    }
    return payload || {};
  }

  async function refreshCurrentUser() {
    try {
      const me = await authRequest('/auth/me', { method: 'GET' });
      setAuthUI(me || null);
    } catch (e) {
      setAuthUI(null);
    }
  }

  function bindAuthUI() {
    authBtn?.addEventListener('click', () => {
      window.location.href = '/login';
    });

    $('auth-close')?.addEventListener('click', () => {
      $('auth-modal')?.classList.add('hidden');
    });

    document.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document
          .querySelectorAll('.auth-tab')
          .forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const isLogin = tab.dataset.authTab === 'login';
        $('auth-login-panel')?.classList.toggle('hidden', !isLogin);
        $('auth-signup-panel')?.classList.toggle('hidden', isLogin);
      });
    });

    $('auth-login-submit')?.addEventListener('click', async () => {
      try {
        const email = ($('auth-login-email')?.value || '').trim();
        const password = $('auth-login-password')?.value || '';
        await authRequest('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        await refreshCurrentUser();
        $('auth-modal')?.classList.add('hidden');
        showToast('Login successful', 'success');
      } catch (e) {
        showToast(e.message || 'Login failed', 'error');
      }
    });

    $('auth-signup-submit')?.addEventListener('click', async () => {
      try {
        const full_name = ($('auth-signup-name')?.value || '').trim();
        const email = ($('auth-signup-email')?.value || '').trim();
        const phone = ($('auth-signup-phone')?.value || '').trim();
        const password = $('auth-signup-password')?.value || '';
        await authRequest('/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ full_name, email, phone, password }),
        });
        $('auth-otp-email').value = email;
        showToast('Account created. Verify with OTP', 'success');
      } catch (e) {
        showToast(e.message || 'Signup failed', 'error');
      }
    });

    $('auth-otp-request')?.addEventListener('click', async () => {
      try {
        const email = ($('auth-otp-email')?.value || '').trim();
        await authRequest('/auth/request-otp', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        showToast('OTP sent. Check Telegram bot', 'success');
      } catch (e) {
        showToast(e.message || 'OTP request failed', 'error');
      }
    });

    $('auth-otp-verify')?.addEventListener('click', async () => {
      try {
        const email = ($('auth-otp-email')?.value || '').trim();
        const code = ($('auth-otp-code')?.value || '').trim();
        await authRequest('/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ email, code }),
        });
        await refreshCurrentUser();
        showToast('Account verified', 'success');
      } catch (e) {
        showToast(e.message || 'OTP verification failed', 'error');
      }
    });

    $('auth-logout')?.addEventListener('click', async () => {
      try {
        await authRequest('/auth/logout', { method: 'POST' });
      } catch (e) {}
      setAuthUI(null);
      showToast('Logged out', 'success');
    });
  }

  // ============================================
  // 16. PERSISTENCE
  // ============================================
  function saveHistory() {
    try {
      sessionStorage.setItem(
        'echo_history',
        JSON.stringify(conversationHistory),
      );
      sessionStorage.setItem('echo_level', selectedLevel);
      sessionStorage.setItem('echo_topic', selectedTopic);
      sessionStorage.setItem('echo_language', selectedLanguage);
      sessionStorage.setItem('echo_scenario', selectedScenario || '');
    } catch (e) {}
  }

  function loadHistory() {
    try {
      const saved = sessionStorage.getItem('echo_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          conversationHistory = parsed;
          selectedLevel = sessionStorage.getItem('echo_level') || selectedLevel;
          selectedTopic = sessionStorage.getItem('echo_topic') || selectedTopic;
          selectedLanguage =
            sessionStorage.getItem('echo_language') || selectedLanguage;
          selectedScenario = sessionStorage.getItem('echo_scenario') || null;
          conversationHistory.forEach((msg) => {
            addMessageToDOM(msg.content, msg.role === 'user' ? 'user' : 'ai');
          });
          onboardingScreen.classList.add('hidden');
          appContainer.classList.remove('hidden');
          sessionStart = Date.now();
          msgCount = conversationHistory.length;
          sessionTimer = setInterval(updateStats, 1000);
          updateStats();
          turn = 'user';
          setAvatarState('idle');
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  // ============================================
  // 16. INIT
  // ============================================
  initParticles();
  initWaveform();
  loadAppSettings();
  bindAppSettingsControls();
  renderAppSettingsControls();
  applyAppSettings();
  ensureVoiceProfilesLoaded();
  renderVoiceProfiles();
  loadVoiceEditor(getActiveVoiceProfile());
  updateSttButton();
  loadVocab();
  renderVocabList();
  bindAuthUI();
  refreshCurrentUser();

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      renderVoiceSelect(
        $('voice-select')?.value || getActiveVoiceProfile()?.voiceName || '',
      );
    };
  }

  if (!loadHistory()) setAvatarState('idle');
});
