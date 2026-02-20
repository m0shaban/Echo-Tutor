/* ============================================================
   ECHO TUTOR PRO — Stories · Flashcards · Progress Module
   Pollinations.ai image generation (free, no API key)
   ============================================================ */

window.EchoExtra = (function () {
  const $ = (id) => document.getElementById(id);

  // ─── NAVIGATION ──────────────────────────────────────────
  const Nav = {
    current: 'chat',

    init() {
      document.querySelectorAll('.nav-tab').forEach((btn) => {
        btn.addEventListener('click', () => this.go(btn.dataset.screen));
      });
    },

    go(screen) {
      this.current = screen;

      // Update tabs
      document.querySelectorAll('.nav-tab').forEach((b) => {
        b.classList.toggle('active', b.dataset.screen === screen);
      });

      // Show/hide main chat container
      const chat = $('app-container');
      if (chat) chat.classList.toggle('has-bottom-nav', true);

      // Show/hide screens
      ['stories-screen', 'flashcards-screen', 'progress-screen'].forEach(
        (id) => {
          const el = $(id);
          if (!el) return;
          const name = id.replace('-screen', '');
          el.classList.toggle('hidden', name !== screen);
        }
      );

      if (chat) {
        chat.classList.toggle('hidden', screen !== 'chat');
      }

      // Lazy-init screens on first open
      if (screen === 'progress') Progress.refresh();
      if (screen === 'flashcards') SRS.init();
    },
  };

  // ─── POLLINATIONS IMAGE URL ──────────────────────────────
  function pollinationsUrl(prompt, seed) {
    const encoded = encodeURIComponent(
      prompt + ', digital art, cinematic lighting, high quality illustration'
    );
    const s = seed || Math.floor(Math.random() * 999999);
    return `https://image.pollinations.ai/prompt/${encoded}?width=800&height=420&nologo=true&seed=${s}&model=flux`;
  }

  // ─── STORIES ─────────────────────────────────────────────
  const Stories = {
    currentLevel: 'beginner',
    currentTopic: 'daily life',
    currentStory: null,
    generating: false,

    init() {
      // Level buttons
      document.querySelectorAll('.story-lvl-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.story-lvl-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          this.currentLevel = btn.dataset.level;
        });
      });

      // Topic chips
      document.querySelectorAll('.story-topic-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          document.querySelectorAll('.story-topic-chip').forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
          this.currentTopic = chip.dataset.topic;
        });
      });

      // Generate button
      $('story-generate-btn')?.addEventListener('click', () => this.generate());

      // New story button
      $('story-new-btn')?.addEventListener('click', () => this.generate());

      // Listen button
      $('story-listen-btn')?.addEventListener('click', () => this.listenToStory());

      // Practice button
      $('story-practice-btn')?.addEventListener('click', () => this.practiceStory());
    },

    async generate() {
      if (this.generating) return;
      this.generating = true;

      // Show loading state
      const btn = $('story-generate-btn');
      const label = $('story-gen-label');
      if (label) label.textContent = '⏳ Generating...';
      if (btn) btn.disabled = true;

      // Show shimmer for image area
      const imgEl = $('story-image');
      const shimmer = $('story-shimmer');
      const placeholder = $('story-placeholder');
      const card = $('story-card');

      if (placeholder) placeholder.classList.add('hidden');
      if (card) card.classList.add('hidden');
      if (imgEl) imgEl.classList.add('hidden');
      if (shimmer) shimmer.classList.remove('hidden');

      try {
        // Get current language from global state (set by script.js)
        const language = window._echoLanguage || 'en';

        const res = await fetch('/story/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: language,
            level: this.currentLevel,
            topic: this.currentTopic,
          }),
        });

        if (!res.ok) throw new Error('Server error');
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        this.currentStory = data;
        this.render(data);

        // XP reward
        if (window.EchoFeatures?.XP) {
          window.EchoFeatures.XP.add(8, '📖 Story Read!');
        }
      } catch (err) {
        console.error('Story generation failed:', err);
        if (shimmer) shimmer.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        if (label)
          label.textContent = '❌ Failed. Try again?';
      } finally {
        this.generating = false;
        if (btn) btn.disabled = false;
        if (label && label.textContent === '⏳ Generating...')
          label.textContent = '✨ Generate Story';
      }
    },

    render(data) {
      const imgEl = $('story-image');
      const shimmer = $('story-shimmer');
      const card = $('story-card');
      const titleEl = $('story-title');
      const bodyEl = $('story-body');
      const vocabGrid = $('story-vocab-grid');

      // Title
      if (titleEl) titleEl.textContent = data.title || '';

      // Story body — highlight vocabulary words
      if (bodyEl && data.story) {
        let storyText = data.story;
        const vocabWords = (data.vocabulary || []).map((v) => v.word);
        vocabWords.forEach((w) => {
          if (!w) return;
          const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          storyText = storyText.replace(
            new RegExp(`\\b(${escaped})\\b`, 'gi'),
            `<span class="story-word-highlight" title="${w}">$1</span>`
          );
        });
        bodyEl.innerHTML = storyText;

        // Click highlighted words to show tooltip
        bodyEl.querySelectorAll('.story-word-highlight').forEach((el) => {
          el.addEventListener('click', () => {
            const word = el.textContent.trim().toLowerCase();
            const entry = (data.vocabulary || []).find(
              (v) => v.word?.toLowerCase() === word
            );
            if (entry) {
              showToast(`${entry.word} → ${entry.translation}`);
            }
          });
        });
      }

      // Vocabulary grid
      if (vocabGrid) {
        vocabGrid.innerHTML = '';
        (data.vocabulary || []).forEach((v) => {
          const item = document.createElement('div');
          item.className = 'story-vocab-item';
          item.innerHTML = `
            <div class="story-vocab-word">${v.word || ''}</div>
            <div class="story-vocab-translation">${v.translation || ''}</div>
            <div class="story-vocab-example">${v.example || ''}</div>`;
          item.addEventListener('click', () => {
            // Add to session vocab
            saveVocabWord(v.word, v.translation, v.example);
            item.style.borderColor = 'var(--success)';
            setTimeout(() => (item.style.borderColor = ''), 1500);
          });
          vocabGrid.appendChild(item);
        });
      }

      // Image via backend (Unsplash → Pexels → Pollinations fallback)
      if (imgEl && (data.image_prompt || this.currentTopic)) {
        fetch('/story/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: this.currentTopic,
            image_prompt: data.image_prompt || data.title || this.currentTopic,
          }),
        })
          .then((r) => r.json())
          .then((imgData) => {
            const url = imgData.url || pollinationsUrl(data.image_prompt || this.currentTopic);
            imgEl.alt = data.title || 'Story illustration';
            imgEl.onload = () => {
              if (shimmer) shimmer.classList.add('hidden');
              imgEl.classList.remove('hidden');
            };
            imgEl.onerror = () => {
              if (shimmer) shimmer.classList.add('hidden');
            };
            imgEl.src = url;
          })
          .catch(() => {
            // Pollinations client-side fallback on network error
            const url = pollinationsUrl(data.image_prompt || this.currentTopic);
            imgEl.alt = data.title || 'Story illustration';
            imgEl.onload = () => {
              if (shimmer) shimmer.classList.add('hidden');
              imgEl.classList.remove('hidden');
            };
            imgEl.onerror = () => { if (shimmer) shimmer.classList.add('hidden'); };
            imgEl.src = url;
          });
      } else {
        if (shimmer) shimmer.classList.add('hidden');
      }

      // Show card
      if (card) card.classList.remove('hidden');

      // Save vocab to localStorage for flashcards
      (data.vocabulary || []).forEach((v) => {
        saveVocabWord(v.word, v.translation, v.example);
      });
    },

    listenToStory() {
      if (!this.currentStory?.story) return;
      speechSynthesis.cancel();
      const lang = window._echoLanguage || 'en';
      const langVoiceMap = {
        en: 'en-US', fr: 'fr-FR', es: 'es-ES',
        de: 'de-DE', ar: 'ar-SA', it: 'it-IT',
        pt: 'pt-BR', ja: 'ja-JP', zh: 'zh-CN',
      };
      const utter = new SpeechSynthesisUtterance(this.currentStory.story);
      utter.lang = langVoiceMap[lang] || 'en-US';
      utter.rate = 0.9;
      speechSynthesis.speak(utter);
    },

    practiceStory() {
      // Switch to chat and inject a practice prompt
      Nav.go('chat');
      setTimeout(() => {
        const input = $('text-input');
        if (input && this.currentStory?.title) {
          input.value = `Let's practice vocabulary from the story "${this.currentStory.title}"`;
          input.focus();
        }
      }, 300);
    },
  };

  // ─── FLASHCARDS / SRS ────────────────────────────────────
  const SRS = {
    deck: [],
    index: 0,
    flipped: false,
    initialized: false,

    init() {
      if (!this.initialized) {
        $('srs-main-card')?.addEventListener('click', () => this.flip());
        $('srs-speak-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.speak();
        });
        document.querySelectorAll('.srs-rate-btn').forEach((btn) => {
          btn.addEventListener('click', () =>
            this.rate(parseInt(btn.dataset.rating))
          );
        });
        document.querySelectorAll('.fc-deck-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('.fc-deck-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            this.loadDeck(btn.dataset.deck);
          });
        });
        this.initialized = true;
      }
      this.loadDeck('session');
    },

    loadDeck(type) {
      const all = loadVocabWords();
      if (type === 'session') {
        // Words added this session (last 20)
        this.deck = all.slice(-20).reverse();
      } else {
        // All saved words sorted by difficulty
        this.deck = all.sort((a, b) => (a.srs_interval || 1) - (b.srs_interval || 1));
      }
      this.index = 0;
      this.flipped = false;
      this.updateStats(all);
      this.showCard();
    },

    updateStats(all) {
      const el = (id) => $(id);
      const mastered = all.filter((w) => (w.srs_interval || 1) >= 5).length;
      const due = all.filter((w) => {
        if (!w.next_review) return true;
        return new Date(w.next_review) <= new Date();
      }).length;
      if (el('fc-total-count')) el('fc-total-count').textContent = all.length;
      if (el('fc-mastered-count')) el('fc-mastered-count').textContent = mastered;
      if (el('fc-due-count')) el('fc-due-count').textContent = due;
    },

    showCard() {
      const card = $('srs-main-card');
      const empty = $('srs-empty');
      const ratingRow = $('srs-rating-row');

      if (!this.deck.length) {
        if (card) card.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
        if (ratingRow) ratingRow.classList.add('hidden');
        return;
      }

      if (this.index >= this.deck.length) {
        // Session complete
        if (card) card.classList.add('hidden');
        if (empty) {
          empty.classList.remove('hidden');
          empty.innerHTML = `
            <span style="font-size:3rem">🎉</span>
            <h3>Session Complete!</h3>
            <p>You reviewed ${this.deck.length} cards. Come back tomorrow for more!</p>`;
        }
        if (ratingRow) ratingRow.classList.add('hidden');
        return;
      }

      const w = this.deck[this.index];
      if (empty) empty.classList.add('hidden');
      if (card) {
        card.classList.remove('hidden');
        card.classList.remove('flipped');
      }
      if (ratingRow) ratingRow.classList.add('hidden');

      this.flipped = false;

      const wordEl = $('srs-word');
      const translEl = $('srs-translation');
      const exEl = $('srs-example');
      const tagEl = $('srs-lang-tag');

      if (wordEl) wordEl.textContent = w.word || '';
      if (translEl) translEl.textContent = w.translation || '';
      if (exEl) exEl.textContent = w.example ? `"${w.example}"` : '';
      if (tagEl) tagEl.textContent = (window._echoLanguage || 'en').toUpperCase();

      // Progress dots
      const dots = $('srs-dots');
      if (dots) {
        dots.innerHTML = '';
        const visible = Math.min(this.deck.length, 8);
        const start = Math.max(0, this.index - 3);
        for (let i = start; i < start + visible && i < this.deck.length; i++) {
          const dot = document.createElement('div');
          dot.className = 'srs-dot' + (i === this.index ? ' active' : i < this.index ? ' done' : '');
          dots.appendChild(dot);
        }
      }
    },

    flip() {
      const card = $('srs-main-card');
      const ratingRow = $('srs-rating-row');
      if (!card || this.flipped) return;
      this.flipped = true;
      card.classList.add('flipped');
      if (ratingRow) ratingRow.classList.remove('hidden');
    },

    speak() {
      if (!this.deck[this.index]) return;
      speechSynthesis.cancel();
      const lang = window._echoLanguage || 'en';
      const languageMap = {
        en: 'en-US', fr: 'fr-FR', es: 'es-ES',
        de: 'de-DE', ar: 'ar-SA', it: 'it-IT',
        pt: 'pt-BR', ja: 'ja-JP', zh: 'zh-CN',
      };
      const utter = new SpeechSynthesisUtterance(this.deck[this.index].word);
      utter.lang = languageMap[lang] || 'en-US';
      utter.rate = 0.85;
      speechSynthesis.speak(utter);
    },

    rate(rating) {
      const w = this.deck[this.index];
      if (!w) return;

      // SRS interval update
      const current = w.srs_interval || 1;
      const intervalMap = {
        1: 1,    // Again → repeat tomorrow
        2: Math.max(1, current),     // Hard → no increase
        3: current * 2,              // Good → double
        4: current * 4,              // Easy → 4x
      };
      w.srs_interval = Math.min(intervalMap[rating] || current, 60);
      w.next_review = new Date(
        Date.now() + w.srs_interval * 24 * 60 * 60 * 1000
      ).toISOString();

      // Save updated word
      updateVocabWord(w);

      this.index++;
      this.showCard();

      // XP
      if (rating >= 3 && window.EchoFeatures?.XP) {
        window.EchoFeatures.XP.add(2, '🃏');
      }
    },
  };

  // ─── PROGRESS ────────────────────────────────────────────
  const Progress = {
    refresh() {
      const xp = window.EchoFeatures?.XP?.data || {};
      const totalXP = xp.totalXP || 0;
      const level = Math.floor(totalXP / 100) + 1;
      const levelPct = (totalXP % 100) + '%';

      const setVal = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      setVal('prog-xp', totalXP.toLocaleString());
      setVal('prog-streak', xp.streak || 0);
      setVal('prog-msgs', xp.messages || 0);
      setVal('prog-vocab', xp.vocab || 0);
      setVal('prog-corrections', xp.corrections || 0);
      setVal('prog-exercises', xp.exercises || 0);

      const fill = $('prog-xp-fill');
      if (fill) fill.style.width = levelPct;

      this.loadLeaderboard();
      this.renderBadges();
    },

    async loadLeaderboard() {
      const lb = $('lb-list');
      if (!lb) return;
      lb.innerHTML = '<div class="lb-loading">Loading...</div>';

      try {
        const token = localStorage.getItem('echo_access_token') || '';
        const res = await fetch('/leaderboard', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) {
          lb.innerHTML = '<div class="lb-loading">No data yet. Chat to earn XP and appear here!</div>';
          return;
        }
        lb.innerHTML = '';
        const rankClasses = ['gold', 'silver', 'bronze'];
        data.forEach((entry, i) => {
          const row = document.createElement('div');
          row.className = 'lb-row';
          row.innerHTML = `
            <div class="lb-rank ${rankClasses[i] || ''}">${i < 3 ? ['🥇','🥈','🥉'][i] : i + 1}</div>
            <div class="lb-flag">${entry.flag || '🌍'}</div>
            <div class="lb-info">
              <div class="lb-name">${escapeHtml(entry.name || 'Anonymous')}</div>
              <div class="lb-level">Level ${entry.level || 1}</div>
            </div>
            <div class="lb-xp">${(entry.xp || 0).toLocaleString()} XP</div>`;
          lb.appendChild(row);
        });
      } catch (e) {
        lb.innerHTML = '<div class="lb-loading">Could not load leaderboard.</div>';
      }
    },

    renderBadges() {
      const ALL_BADGES = [
        { id: 'first_chat', icon: '💬', label: 'First Chat', description: 'Send your first message' },
        { id: 'ten_messages', icon: '🗣️', label: 'Chatterbox', description: '10 messages sent' },
        { id: 'fifty_messages', icon: '📢', label: 'Conversationalist', description: '50 messages' },
        { id: 'first_correction', icon: '✏️', label: 'Learning Mindset', description: 'Received a correction' },
        { id: 'vocab_10', icon: '📚', label: 'Word Collector', description: '10 vocabulary words' },
        { id: 'streak_3', icon: '🔥', label: '3-Day Streak', description: 'Practice 3 days in a row' },
        { id: 'streak_7', icon: '🏆', label: 'Weekly Warrior', description: '7-day streak' },
        { id: 'streak_30', icon: '👑', label: 'Monthly Master', description: '30-day streak' },
        { id: 'exercise_10', icon: '🎯', label: 'Exercise Pro', description: '10 exercises done' },
        { id: 'level_5', icon: '⭐', label: 'Rising Star', description: 'Reach Level 5' },
        { id: 'level_10', icon: '🌟', label: 'Expert', description: 'Reach Level 10' },
        { id: 'perfect_pronun', icon: '🎙️', label: 'Perfect Pronunciation', description: 'Score 10/10 pronunciation' },
      ];
      const grid = $('badges-progress-grid');
      if (!grid || !window.EchoFeatures?.XP) return;
      window.EchoFeatures.XP.renderBadges('badges-progress-grid', ALL_BADGES);
    },
  };

  // ─── VOCAB STORAGE HELPERS ──────────────────────────────
  function loadVocabWords() {
    try {
      return JSON.parse(localStorage.getItem('echo_vocab_deck') || '[]');
    } catch {
      return [];
    }
  }

  function saveVocabWord(word, translation, example) {
    if (!word || !translation) return;
    const deck = loadVocabWords();
    const exists = deck.find((w) => w.word?.toLowerCase() === word.toLowerCase());
    if (!exists) {
      deck.push({ word, translation, example: example || '', srs_interval: 1, added: new Date().toISOString() });
      localStorage.setItem('echo_vocab_deck', JSON.stringify(deck));
    }
  }

  function updateVocabWord(updated) {
    const deck = loadVocabWords();
    const idx = deck.findIndex((w) => w.word?.toLowerCase() === updated.word?.toLowerCase());
    if (idx >= 0) deck[idx] = { ...deck[idx], ...updated };
    else deck.push(updated);
    localStorage.setItem('echo_vocab_deck', JSON.stringify(deck));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    const t = $('toast') || document.createElement('div');
    t.className = 'toast show';
    t.textContent = msg;
    if (!t.parentNode) document.body.appendChild(t);
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.classList.remove('show'), 2500);
  }

  // ─── LEADERBOARD REFRESH BUTTON ─────────────────────────
  function initLeaderboardRefreshBtn() {
    $('lb-refresh-btn')?.addEventListener('click', () => {
      const btn = $('lb-refresh-btn');
      if (btn) { btn.style.transform = 'rotate(360deg)'; setTimeout(() => btn.style.transform = '', 400); }
      Progress.loadLeaderboard();
    });
  }

  // ─── INTEGRATE VOCAB WORDS FROM CHAT ────────────────────
  // Called from script.js when a new word is detected
  window.echoSaveVocabWord = saveVocabWord;

  // ─── INIT ────────────────────────────────────────────────
  function init() {
    Nav.init();
    Stories.init();
    initLeaderboardRefreshBtn();

    // Show bottom nav only when app is active (triggered by script.js)
    // We expose a hook: window.echoShowNav()
    window.echoShowNav = function () {
      const nav = $('bottom-nav');
      if (nav) nav.classList.remove('hidden');
      const chat = $('app-container');
      if (chat) chat.classList.add('has-bottom-nav');
    };

    window.echoHideNav = function () {
      const nav = $('bottom-nav');
      if (nav) nav.classList.add('hidden');
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { Nav, Stories, SRS, Progress, saveVocabWord };
})();
