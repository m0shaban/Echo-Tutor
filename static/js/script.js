/* static/js/script.js */

document.addEventListener('DOMContentLoaded', () => {
    // --- 1. DOM Element Selection ---
    const micBtn = document.getElementById('mic-btn');
    const micIcon = document.getElementById('mic-icon');
    const muteBtn = document.getElementById('mute-btn');
    const endBtn = document.getElementById('end-btn');
    const sendBtn = document.getElementById('send-btn');
    const textInput = document.getElementById('text-input');
    const messagesDiv = document.getElementById('messages');
    const tutorMouth = document.getElementById('tutor-mouth');
    const tutorAvatar = document.getElementById('tutor-avatar');
    const stateIndicator = document.getElementById('state-indicator');
    const tutorFace = document.querySelector('.tutor-face');
    const tutorEyes = document.querySelectorAll('.tutor-eye');

    // --- 2. State Management ---
    let conversationHistory = [];
    let recognizing = false;
    let recognition;
    let autoListen = true;
    let ended = false;
    let turn = 'user'; // متغير جديد: من المتحدث الحالي؟

    // --- 3. Speech Recognition (STT) Setup ---
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.continuous = false; // Process speech after a pause

        recognition.onresult = (event) => {
            setIdle();
            if (turn === 'user') {
                const transcript = event.results[0][0].transcript;
                addMessage(transcript, 'user');
                turn = 'ai';
                sendMessage();
            }
        };

        recognition.onend = () => {
            recognizing = false;
            // إذا لم يكن الوضع منتهيًا وautoListen مفعّل ودور المستخدم، أعد فتح المايك
            if (autoListen && !ended && turn === 'user') {
                openMic();
            } else {
                setIdle();
            }
        };

        recognition.onstart = () => {
            recognizing = true;
            setListening();
        };
        
        recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            setIdle();
        };

    } else {
        micBtn.disabled = true;
        micBtn.title = "Speech recognition not supported in this browser.";
    }
    
    // --- 4. Conversation History Persistence ---
    function saveHistory() {
        sessionStorage.setItem('conversationHistory', JSON.stringify(conversationHistory));
    }

    function loadHistory() {
        const savedHistory = sessionStorage.getItem('conversationHistory');
        if (savedHistory && savedHistory !== '[]') {
            conversationHistory = JSON.parse(savedHistory);
            messagesDiv.innerHTML = ''; // Clear any existing messages
            conversationHistory.forEach(msg => {
                const senderClass = msg.role === 'user' ? 'user' : 'ai';
                addMessageToDOM(msg.content, senderClass);
            });
        } else {
            // If no history, start with a welcome message
            const initialMessage = "Hello! I'm Echo, your English tutor. Let's start a conversation!";
            addMessage(initialMessage, 'assistant'); // Adds to DOM and history
        }
    }

    // --- 5. UI and Avatar State Functions ---
    function setAvatarState(state) {
        tutorEyes.forEach(eye => { eye.className = 'tutor-eye ' + state; });
        tutorMouth.className = 'tutor-mouth ' + state;
        setBrows(state);
        // Tongue and teeth for speaking
        if (state === 'speaking') {
            document.getElementById('tutor-tongue').style.transform = 'translateX(-50%) scaleY(1)';
            document.getElementById('tutor-teeth').style.transform = 'translateX(-50%) scaleY(1)';
        } else {
            document.getElementById('tutor-tongue').style.transform = 'translateX(-50%) scaleY(0)';
            document.getElementById('tutor-teeth').style.transform = 'translateX(-50%) scaleY(0)';
        }
        if (state === 'idle') {
            tutorFace.classList.add('smile');
        } else {
            tutorFace.classList.remove('smile');
        }
    }

    function setListening() {
        tutorAvatar.className = 'tutor-avatar listening';
        stateIndicator.textContent = 'Listening...';
        stateIndicator.className = 'state-indicator listening';
        setAvatarState('listening');
    }

    function setSpeaking() {
        tutorAvatar.className = 'tutor-avatar speaking';
        stateIndicator.textContent = 'Speaking...';
        stateIndicator.className = 'state-indicator speaking';
        setAvatarState('speaking');
    }

    function setIdle() {
        tutorAvatar.className = 'tutor-avatar';
        stateIndicator.textContent = ended ? 'Ended' : 'Idle';
        stateIndicator.className = 'state-indicator idle';
        setAvatarState('idle');
    }

    // --- 6. Core Logic Functions ---
    function addMessageToDOM(text, senderClass) {
        const msg = document.createElement('div');
        msg.className = 'message ' + senderClass;
        msg.textContent = text;
        messagesDiv.appendChild(msg);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function addMessage(text, role) {
        const senderClass = role === 'user' ? 'user' : 'ai';
        addMessageToDOM(text, senderClass);
        conversationHistory.push({ role, content: text });
        saveHistory();
    }

    function showTypingIndicator() {
        const typingMsg = document.createElement('div');
        typingMsg.className = 'message ai typing-indicator';
        typingMsg.innerHTML = '<span></span><span></span><span></span>';
        messagesDiv.appendChild(typingMsg);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        return typingMsg;
    }

    async function sendMessage() {
        if (turn !== 'ai') return; // لا ترسل إلا إذا كان دور الذكاء الاصطناعي
        const typingIndicator = showTypingIndicator();
        closeMic(); // المايك مغلق أثناء تفكير الذكاء الاصطناعي
        try {
            const res = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ history: conversationHistory })
            });
            messagesDiv.removeChild(typingIndicator);
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || `Server error: ${res.statusText}`);
            }
            const data = await res.json();
            addMessage(data.response, 'assistant');
            turn = 'ai-speaking'; // الآن الذكاء الاصطناعي يتحدث
            speak(data.response);
        } catch (error) {
            console.error('Fetch Error:', error);
            if (document.body.contains(typingIndicator)) {
                messagesDiv.removeChild(typingIndicator);
            }
            addMessageToDOM(error.message, 'ai-error');
            turn = 'user';
            openMic();
        }
    }

    function speak(text) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        setSpeaking();
        closeMic(); // المايك مغلق أثناء تحدث الذكاء الاصطناعي
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = /[\u0600-\u06FF]/.test(text) ? 'ar-SA' : 'en-US';
        utter.rate = 1.05;
        utter.onend = () => {
            setIdle();
            // بعد انتهاء الذكاء الاصطناعي من التحدث، دور المستخدم
            if (!ended && autoListen) {
                turn = 'user';
                openMic();
            }
        };
        utter.onerror = (event) => {
            console.error("Speech synthesis error:", event.error);
            setIdle();
            turn = 'user';
            openMic();
        };
        window.speechSynthesis.speak(utter);
    }

    function handleSend() {
        if (turn !== 'user') return; // لا ترسل إلا إذا كان دور المستخدم
        const text = textInput.value.trim();
        if (text) {
            addMessage(text, 'user');
            textInput.value = '';
            turn = 'ai'; // الآن دور الذكاء الاصطناعي
            sendMessage();
        }
    }

    // --- 7. Mic Control ---
    function openMic() {
        if (!recognizing && !ended && autoListen && recognition && turn === 'user') {
            micBtn.classList.add('active');
            micIcon.textContent = '🛑';
            try { recognition.start(); } catch (e) { /* ignore if already started */ }
        }
    }

    function closeMic() {
        if (recognizing && recognition) {
            micBtn.classList.remove('active');
            micIcon.textContent = '🎤';
            recognition.stop();
        }
        setIdle();
    }

    // --- 8. Event Listeners ---
    micBtn.addEventListener('click', () => {
        if (recognizing) {
            closeMic();
        } else {
            ended = false;
            autoListen = true;
            turn = 'user';
            openMic();
        }
    });

    muteBtn.addEventListener('click', () => {
        autoListen = !autoListen;
        muteBtn.textContent = autoListen ? '🔇' : '🔊';
        muteBtn.title = autoListen ? 'Mute' : 'Unmute';
        if (!autoListen) {
            closeMic();
        } else if (!recognizing && !ended && turn === 'user') {
            openMic();
        }
    });
    
    endBtn.addEventListener('click', () => {
        ended = true;
        autoListen = false;
        closeMic();
        window.speechSynthesis.cancel();
        sessionStorage.removeItem('conversationHistory');
        conversationHistory = [];
        messagesDiv.innerHTML = '';
        turn = 'user';
        addMessageToDOM("Conversation ended. Start a new one anytime!", 'ai');
    });

    sendBtn.addEventListener('click', handleSend);

    textInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // --- 9. Initial Application Load ---
    loadHistory();
    setIdle();
    turn = 'user';

    // --- 10. Speech Recognition/TTSEvent Hooks for Continuous Conversation ---
    if (recognition) {
        recognition.onend = () => {
            recognizing = false;
            // إذا لم يكن الوضع منتهيًا وautoListen مفعّل، أعد فتح المايك
            if (autoListen && !ended) {
                openMic();
            } else {
                setIdle();
            }
        };
    }

    // --- 11. Natural Face Animation ---
    function randomBlink() {
        const leftEyelid = document.getElementById('eyelid-left');
        const rightEyelid = document.getElementById('eyelid-right');
        leftEyelid.style.opacity = '1';
        rightEyelid.style.opacity = '1';
        setTimeout(() => {
            leftEyelid.style.opacity = '0';
            rightEyelid.style.opacity = '0';
        }, 120 + Math.random() * 80);
        setTimeout(randomBlink, 2200 + Math.random() * 2000);
    }
    setTimeout(randomBlink, 2000);

    function idleSmileAnim() {
        const mouth = document.getElementById('tutor-mouth');
        if (tutorAvatar.className === 'tutor-avatar') {
            mouth.classList.toggle('smile');
        }
        setTimeout(idleSmileAnim, 3500 + Math.random() * 2000);
    }
    setTimeout(idleSmileAnim, 3000);

    // Brows movement for attention/listening
    function setBrows(state) {
        const leftBrow = document.querySelector('.tutor-brow.left');
        const rightBrow = document.querySelector('.tutor-brow.right');
        if (state === 'listening') {
            leftBrow.style.transform = 'rotate(-2deg) translateY(-4px)';
            rightBrow.style.transform = 'rotate(2deg) translateY(-4px)';
        } else if (state === 'speaking') {
            leftBrow.style.transform = 'rotate(-10deg)';
            rightBrow.style.transform = 'rotate(10deg)';
        } else {
            leftBrow.style.transform = 'rotate(-10deg)';
            rightBrow.style.transform = 'rotate(10deg)';
        }
    }

    // --- 12. Register Service Worker for PWA ---
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
            navigator.serviceWorker.register('/static/service-worker.js')
                .then(function(reg) { console.log('Service Worker registered!', reg); })
                .catch(function(err) { console.log('Service Worker registration failed:', err); });
        });
    }
});