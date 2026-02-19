/* ============================================
   ECHO TUTOR PRO — Phase 3 Features Module
   Theme, Gamification, Exercises, PDF, Whisper
   ============================================ */

window.EchoFeatures = (function () {
  const $ = (id) => document.getElementById(id);

  // ─── THEME TOGGLE ───
  const Theme = {
    init() {
      const saved = localStorage.getItem('echo_theme') || 'dark';
      document.documentElement.setAttribute('data-theme', saved);
      const btn = $('theme-btn');
      if (btn) btn.addEventListener('click', () => this.toggle());
    },
    toggle() {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('echo_theme', next);
    },
  };

  // ─── XP & GAMIFICATION ───
  const XP = {
    data: {
      totalXP: 0,
      streak: 0,
      lastDay: '',
      messages: 0,
      corrections: 0,
      vocab: 0,
      exercises: 0,
      perfect_pronun: 0,
      badges: [],
    },
    load() {
      try {
        const saved = localStorage.getItem('echo_xp');
        if (saved) this.data = { ...this.data, ...JSON.parse(saved) };
        this.updateStreak();
        this.render();
      } catch (e) {}
    },
    save() {
      try {
        localStorage.setItem('echo_xp', JSON.stringify(this.data));
      } catch (e) {}
    },
    add(amount, reason) {
      this.data.totalXP += amount;
      this.save();
      this.render();
      this.showPopup(amount, reason);
      this.checkBadges();
    },
    getLevel() {
      return Math.floor(this.data.totalXP / 100) + 1;
    },
    getLevelProgress() {
      return this.data.totalXP % 100;
    },
    updateStreak() {
      const today = new Date().toISOString().slice(0, 10);
      if (this.data.lastDay === today) return;
      const yesterday = new Date(Date.now() - 86400000)
        .toISOString()
        .slice(0, 10);
      if (this.data.lastDay === yesterday) {
        this.data.streak++;
      } else if (this.data.lastDay !== today) {
        this.data.streak = 1;
      }
      this.data.lastDay = today;
      this.save();
    },
    render() {
      const lvl = this.getLevel();
      const prog = this.getLevelProgress();
      const el = (id, val) => {
        const e = $(id);
        if (e) e.textContent = val;
      };
      el('xp-level', `Lv.${lvl}`);
      el('xp-value', `${this.data.totalXP} XP`);
      el('streak-count', `🔥 ${this.data.streak}`);
      const fill = $('xp-bar-fill');
      if (fill) fill.style.width = prog + '%';
    },
    showPopup(amount, reason) {
      const popup = $('xp-popup');
      if (!popup) return;
      popup.textContent = `+${amount} XP${reason ? ' · ' + reason : ''}`;
      popup.classList.remove('show');
      void popup.offsetWidth;
      popup.classList.add('show');
      setTimeout(() => popup.classList.remove('show'), 1600);
    },
    trackMessage() {
      this.data.messages++;
      this.add(5, 'Message');
      this.save();
    },
    trackCorrection() {
      this.data.corrections++;
      this.add(3, 'Learning');
      this.save();
    },
    trackVocab() {
      this.data.vocab++;
      this.add(2, 'New Word');
      this.save();
    },
    trackExercise(correct) {
      this.data.exercises++;
      this.add(correct ? 10 : 2, correct ? 'Correct!' : 'Practice');
      this.save();
    },
    trackPronunciation(score) {
      if (score >= 10) {
        this.data.perfect_pronun++;
        this.add(15, 'Perfect!');
      }
      this.save();
    },
    checkBadges() {
      const d = this.data;
      const checks = {
        first_chat: d.messages >= 1,
        ten_messages: d.messages >= 10,
        fifty_messages: d.messages >= 50,
        first_correction: d.corrections >= 1,
        vocab_10: d.vocab >= 10,
        streak_3: d.streak >= 3,
        streak_7: d.streak >= 7,
        streak_30: d.streak >= 30,
        exercise_10: d.exercises >= 10,
        level_5: d.totalXP >= 500,
        level_10: d.totalXP >= 1000,
        perfect_pronun: d.perfect_pronun >= 1,
      };
      let newBadge = false;
      Object.entries(checks).forEach(([id, met]) => {
        if (met && !d.badges.includes(id)) {
          d.badges.push(id);
          newBadge = true;
        }
      });
      if (newBadge) this.save();
      return newBadge;
    },
    renderBadges(containerId, allBadges) {
      const grid = $(containerId);
      if (!grid || !allBadges) return;
      grid.innerHTML = '';
      allBadges.forEach((b) => {
        const earned = this.data.badges.includes(b.id);
        grid.innerHTML += `<div class="badge-item ${earned ? 'earned' : 'locked'}"><span class="badge-icon">${b.icon}</span><span class="badge-label">${b.label}</span><span class="badge-desc">${b.description}</span></div>`;
      });
    },
    getSessionXP() {
      return this.data.totalXP;
    },
  };

  // ─── EXERCISES ENGINE ───
  const Exercises = {
    pool: [],
    current: null,
    index: 0,
    score: 0,
    total: 0,
    type: 'fill_blank',
    async load(level, type) {
      this.type = type;
      if (type === 'ai_generated') return this.loadAI(level);
      try {
        const res = await fetch(
          `/exercises?level=${level}&type=${type}&count=10`,
        );
        const data = await res.json();
        this.pool = data.exercises || [];
        this.index = 0;
        this.score = 0;
        this.total = this.pool.length;
        if (this.pool.length) this.show();
        else this.showEmpty();
      } catch (e) {
        this.showEmpty();
      }
    },
    async loadAI(level) {
      const corrections = JSON.parse(
        localStorage.getItem('echo_corrections') || '[]',
      );
      if (!corrections.length) {
        this.showEmpty('Chat first to get personalized exercises!');
        return;
      }
      $('exercise-question').textContent =
        'Generating exercises from your mistakes...';
      try {
        const res = await fetch('/exercises/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ errors: corrections.slice(-10), level }),
        });
        const data = await res.json();
        this.pool = (data.exercises || []).map((e, i) => ({
          ...e,
          id: 'ai_' + i,
          type: 'fill_blank',
        }));
        this.index = 0;
        this.score = 0;
        this.total = this.pool.length;
        if (this.pool.length) this.show();
        else this.showEmpty('Could not generate exercises.');
      } catch (e) {
        this.showEmpty('Error generating exercises.');
      }
    },
    show() {
      if (this.index >= this.pool.length) {
        this.showComplete();
        return;
      }
      this.current = this.pool[this.index];
      const q = $('exercise-question');
      const opts = $('exercise-options');
      const result = $('exercise-result');
      const explain = $('exercise-explain');
      const inputArea = $('exercise-input-area');
      if (result) {
        result.classList.add('hidden');
        result.className = 'exercise-result hidden';
      }
      if (explain) explain.classList.add('hidden');
      if (inputArea) inputArea.classList.add('hidden');
      $('exercise-progress').textContent = `${this.index + 1}/${this.total}`;
      $('exercise-score').textContent = `Score: ${this.score}/${this.index}`;

      const ex = this.current;
      if (!ex) return;

      // Determine exercise type from data
      const exType = ex.type || this.type;
      if (exType === 'sentence_reorder' || (ex.words && !ex.options)) {
        this.showReorder(ex);
      } else if (exType === 'translation') {
        this.showTranslation(ex);
      } else {
        // fill_blank or word_match — multiple choice
        if (q) q.innerHTML = ex.q || ex.word || '';
        if (ex.type === 'synonym')
          q.innerHTML +=
            '<br><small style="color:var(--text-muted)">Find the synonym</small>';
        if (ex.type === 'antonym')
          q.innerHTML +=
            '<br><small style="color:var(--text-muted)">Find the antonym</small>';
        opts.innerHTML = '';
        opts.classList.remove('hidden');
        (ex.options || []).forEach((opt) => {
          const btn = document.createElement('button');
          btn.className = 'exercise-option';
          btn.textContent = opt;
          btn.addEventListener('click', () =>
            this.checkAnswer(opt, ex.answer, btn),
          );
          opts.appendChild(btn);
        });
      }
    },
    showReorder(ex) {
      const q = $('exercise-question');
      const opts = $('exercise-options');
      q.innerHTML =
        '<span style="color:var(--text-muted)">Arrange the words in correct order:</span>';
      opts.innerHTML = '';
      const words = [...ex.words].sort(() => Math.random() - 0.5);
      const selected = [];
      const answerArea = document.createElement('div');
      answerArea.className = 'reorder-area';
      answerArea.innerHTML =
        '<span style="color:var(--text-hint);font-size:0.8rem">Click words to build the sentence</span>';
      opts.appendChild(answerArea);
      const wordPool = document.createElement('div');
      wordPool.style.cssText =
        'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px';
      words.forEach((w) => {
        const chip = document.createElement('span');
        chip.className = 'reorder-word';
        chip.textContent = w;
        chip.addEventListener('click', () => {
          if (chip.classList.contains('placed')) {
            chip.classList.remove('placed');
            const idx = selected.indexOf(w);
            if (idx >= 0) selected.splice(idx, 1);
          } else {
            chip.classList.add('placed');
            selected.push(w);
          }
          answerArea.innerHTML =
            selected.join(' ') ||
            '<span style="color:var(--text-hint);font-size:0.8rem">Click words</span>';
          if (selected.length === words.length) {
            const userAns = selected.join(' ');
            const correct = userAns.toLowerCase() === ex.answer.toLowerCase();
            if (correct) this.score++;
            this.showResult(correct, ex.answer);
          }
        });
        wordPool.appendChild(chip);
      });
      opts.appendChild(wordPool);
    },
    showTranslation(ex) {
      const q = $('exercise-question');
      const opts = $('exercise-options');
      const inputArea = $('exercise-input-area');
      q.innerHTML = `<span style="color:var(--text-muted)">Translate to ${ex.target_lang === 'en' ? 'English' : ex.target_lang}:</span><br><br>"${ex.source}"`;
      opts.innerHTML = '';
      if (inputArea) {
        inputArea.classList.remove('hidden');
        const inp = $('exercise-input');
        const checkBtn = $('exercise-check');
        if (inp) inp.value = '';
        if (checkBtn) {
          const handler = () => {
            const userAns = (inp?.value || '')
              .trim()
              .toLowerCase()
              .replace(/[?.!,]/g, '');
            const correct = [ex.answer, ...(ex.alternatives || [])].some(
              (a) => userAns === a.toLowerCase().replace(/[?.!,]/g, ''),
            );
            if (correct) this.score++;
            this.showResult(correct, ex.answer);
            checkBtn.removeEventListener('click', handler);
          };
          checkBtn.addEventListener('click', handler);
        }
      }
    },
    checkAnswer(selected, correct, btn) {
      const opts = $('exercise-options');
      const isCorrect = selected === correct;
      if (isCorrect) this.score++;
      btn.classList.add(isCorrect ? 'correct' : 'wrong');
      opts.querySelectorAll('.exercise-option').forEach((b) => {
        b.classList.add('disabled');
        if (b.textContent === correct) b.classList.add('correct');
      });
      this.showResult(isCorrect, correct);
    },
    showResult(correct, answer) {
      const result = $('exercise-result');
      const explain = $('exercise-explain');
      if (result) {
        result.classList.remove('hidden');
        result.className = `exercise-result ${correct ? 'correct' : 'wrong'}`;
        result.textContent = correct
          ? 'Correct! Well done!'
          : `Incorrect. Answer: ${answer}`;
      }
      if (explain && this.current?.explain) {
        explain.classList.remove('hidden');
        explain.textContent = this.current.explain;
      }
      XP.trackExercise(correct);
      $('exercise-score').textContent =
        `Score: ${this.score}/${this.index + 1}`;
    },
    next() {
      this.index++;
      if (this.index >= this.pool.length) this.showComplete();
      else this.show();
    },
    showComplete() {
      const q = $('exercise-question');
      const opts = $('exercise-options');
      if (q)
        q.innerHTML = `<div style="text-align:center;padding:20px"><h3 style="margin-bottom:10px">Exercise Complete!</h3><p style="color:var(--text-muted)">Score: ${this.score}/${this.total}</p><p style="margin-top:10px">${this.score === this.total ? 'Perfect score! Amazing!' : this.score >= this.total * 0.7 ? 'Great job!' : 'Keep practicing!'}</p></div>`;
      if (opts) opts.innerHTML = '';
    },
    showEmpty(msg) {
      const q = $('exercise-question');
      if (q)
        q.textContent = msg || 'No exercises available for this type/level.';
      $('exercise-options').innerHTML = '';
    },
  };

  // ─── PDF EXPORT ───
  const PDF = {
    export(sessionData) {
      const { duration, messages, corrections, vocab, avgPronun, xp } =
        sessionData;
      const lines = [
        'ECHO TUTOR PRO — Session Report',
        '═'.repeat(40),
        `Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        `Duration: ${duration}`,
        `Messages: ${messages}`,
        `Corrections: ${corrections}`,
        `New Words: ${vocab}`,
        `Avg Pronunciation: ${avgPronun}`,
        `XP Earned: +${xp}`,
        '',
        '─'.repeat(40),
        'CONVERSATION:',
        '─'.repeat(40),
        '',
      ];
      const msgEls = document.querySelectorAll('#messages .message');
      msgEls.forEach((m) => {
        const role = m.classList.contains('user') ? 'YOU' : 'ECHO';
        lines.push(`[${role}] ${m.textContent.trim()}`);
        lines.push('');
      });
      if (corrections > 0) {
        lines.push('─'.repeat(40), 'CORRECTIONS:', '─'.repeat(40), '');
        const stored = JSON.parse(
          localStorage.getItem('echo_corrections') || '[]',
        );
        stored.forEach((c) => lines.push(`✗ ${c.wrong}  →  ✓ ${c.right}`));
      }
      const text = lines.join('\n');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `echo-session-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    },
  };

  // ─── WHISPER STT ───
  const Whisper = {
    recorder: null,
    chunks: [],
    recording: false,
    mimeType: 'audio/webm',
    fileExt: 'webm',
    pickMimeType() {
      try {
        if (!window.MediaRecorder?.isTypeSupported) return '';
        const candidates = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4',
          'audio/mpeg',
        ];
        for (const mimeType of candidates) {
          if (window.MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
          }
        }
      } catch (e) {}
      return '';
    },
    async start(lang) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const mimeType = this.pickMimeType();
        this.mimeType = mimeType || 'audio/webm';
        this.fileExt = this.mimeType.includes('mp4')
          ? 'm4a'
          : this.mimeType.includes('mpeg')
            ? 'mp3'
            : 'webm';
        this.recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        this.chunks = [];
        this.recorder.ondataavailable = (e) => {
          if (e.data.size > 0) this.chunks.push(e.data);
        };
        this.recorder.start(250);
        this.recording = true;
        return stream;
      } catch (e) {
        console.error('Whisper mic error:', e);
        return null;
      }
    },
    stop() {
      return new Promise((resolve) => {
        if (!this.recorder || !this.recording) {
          resolve(null);
          return;
        }
        this.recorder.onstop = () => {
          if (!this.chunks.length) {
            this.recording = false;
            this.recorder.stream?.getTracks().forEach((t) => t.stop());
            resolve(null);
            return;
          }
          const blob = new Blob(this.chunks, {
            type: this.mimeType || this.chunks[0]?.type || 'audio/webm',
          });
          this.recording = false;
          this.recorder.stream?.getTracks().forEach((t) => t.stop());
          resolve(blob);
        };
        this.recorder.stop();
      });
    },
    async transcribe(blob, lang) {
      const form = new FormData();
      form.append('audio', blob, `recording.${this.fileExt || 'webm'}`);
      form.append('language', lang || 'en');
      try {
        const controller =
          typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = controller
          ? setTimeout(() => controller.abort(), 45000)
          : null;

        const res = await fetch('/transcribe', {
          method: 'POST',
          body: form,
          signal: controller?.signal,
        });
        if (timeout) clearTimeout(timeout);
        let payload = null;
        try {
          payload = await res.json();
        } catch (e) {}

        if (!res.ok) {
          return {
            ok: false,
            error:
              payload?.error || `Transcription request failed (${res.status})`,
          };
        }

        if (!payload?.text) {
          return {
            ok: false,
            error: payload?.error || 'No transcript returned from Whisper',
          };
        }

        return {
          ok: true,
          text: payload.text,
          language: payload.language || lang || 'en',
        };
      } catch (e) {
        if (e?.name === 'AbortError') {
          return {
            ok: false,
            error: 'Transcription timed out. Try again.',
          };
        }
        return {
          ok: false,
          error: 'Could not reach transcription service',
        };
      }
    },
  };

  // ─── SCENARIO HELPERS ───
  const Scenarios = {
    data: [],
    render(containerId) {
      const grid = $(containerId);
      if (!grid || !this.data.length) return;
      grid.innerHTML = '';
      this.data.forEach((s) => {
        const card = document.createElement('button');
        card.className = 'scenario-card';
        card.dataset.scenario = s.id;
        card.innerHTML = `<span class="scenario-icon">${s.icon}</span><span class="scenario-name">${s.label}</span><span class="scenario-desc">${s.description}</span>`;
        grid.appendChild(card);
      });
    },
  };

  // ─── INIT ───
  function init() {
    Theme.init();
    XP.load();

    // Exercise modal controls
    $('exercises-btn')?.addEventListener('click', () => {
      $('exercises-modal')?.classList.toggle('hidden');
      Exercises.load('intermediate', 'fill_blank');
    });
    $('exercises-close')?.addEventListener('click', () =>
      $('exercises-modal')?.classList.add('hidden'),
    );
    $('exercise-next')?.addEventListener('click', () => Exercises.next());

    // Exercise type tabs
    document.querySelectorAll('.ex-type-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document
          .querySelectorAll('.ex-type-btn')
          .forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const level = window._echoLevel || 'intermediate';
        Exercises.load(level, btn.dataset.type);
      });
    });

    // XP display click -> badges
    $('xp-display')?.addEventListener('click', () =>
      $('badges-modal')?.classList.toggle('hidden'),
    );
    $('badges-close')?.addEventListener('click', () =>
      $('badges-modal')?.classList.add('hidden'),
    );

    // PDF export
    $('summary-pdf')?.addEventListener('click', () => {
      PDF.export({
        duration: $('sum-time')?.textContent || '0:00',
        messages: $('sum-msgs')?.textContent || '0',
        corrections: $('sum-corrections')?.textContent || '0',
        vocab: $('sum-vocab')?.textContent || '0',
        avgPronun: $('sum-pronun')?.textContent || '-',
        xp: $('sum-xp')?.textContent || '0',
      });
    });
  }

  // Auto-init on DOMContentLoaded (may already have fired)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { Theme, XP, Exercises, PDF, Whisper, Scenarios };
})();
