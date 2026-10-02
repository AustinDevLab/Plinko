// ---------- Music player (custom controls over a hidden audio widget) ----------
(function () {
    const $ = (id) => document.getElementById(id);
    const frame = $('mp-frame');
    const ORIGIN = 'https://w.soundcloud.com';
    const I = 'class="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const ICON = {
        play: `<svg ${I} fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
        pause: `<svg ${I} fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`,
        repeat: `<svg ${I} fill="none"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`
    };
    let sounds = [], queue = [], qi = 0, cur = 0, dur = 0, pos = 0;
    let shuffle = true, repeat = 0; // repeat: 0 off, 1 all, 2 one
    let hooked = false, seeking = false, playing = false, started = false;
    let lastProg = 0, playAt = 0, lastGoTo = 0, userPausedAt = 0, token = 0;
    const waiting = {};

    const send = (method, value) => {
        try { frame.contentWindow.postMessage(JSON.stringify({ method, value }), ORIGIN); } catch (e) {}
    };
    const ask = (method, cb) => { waiting[method] = cb; send(method); };
    const fmt = (ms) => {
        const t = Math.max(0, Math.floor((ms || 0) / 1000));
        return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    };

    function setPlaying(on) {
        playing = on;
        $('mp-play').innerHTML = on ? ICON.pause : ICON.play;
        $('mp-play').title = on ? 'Pause' : 'Play';
        $('mp-play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    }
    function paintModes() {
        $('mp-shuffle').classList.toggle('text-indigo-400', shuffle);
        $('mp-shuffle').setAttribute('aria-pressed', String(shuffle));
        const r = $('mp-repeat');
        r.innerHTML = ICON.repeat + (repeat === 2 ? '<span class="ml-0.5 text-[10px] font-bold">1</span>' : '');
        r.classList.toggle('text-indigo-400', repeat > 0);
        r.title = ['Repeat: off', 'Repeat: all', 'Repeat: one'][repeat];
    }
    function updateBar(ms, rel) {
        pos = ms || 0;
        if (seeking) return;
        const r = rel != null ? rel : (dur ? pos / dur : 0);
        $('mp-seek').value = Math.min(1, Math.max(0, r)) * 1000;
        $('mp-cur').textContent = fmt(pos);
    }

    // 30-second previews (paywalled tracks) are left out of the queue
    function isPreview(t) {
        if (!t) return false;
        if (t.policy === 'SNIPPET') return true;
        if (t.full_duration && t.duration && t.full_duration - t.duration > 1000) return true;
        return t.duration >= 29000 && t.duration <= 31000;
    }

    // Play order: shuffled by default, otherwise playlist order. `first` stays the current track.
    function buildQueue(first) {
        const ok = sounds.map((t, k) => k).filter((k) => !isPreview(sounds[k]));
        if (shuffle) {
            for (let k = ok.length - 1; k > 0; k--) {
                const j = Math.floor(Math.random() * (k + 1));
                [ok[k], ok[j]] = [ok[j], ok[k]];
            }
            const at = ok.indexOf(first);
            if (at > 0) { ok.splice(at, 1); ok.unshift(first); }
        }
        queue = ok;
        qi = Math.max(0, queue.indexOf(first));
    }

    function setCover(t) {
        const c = $('mp-cover');
        const url = t && (t.artwork_url || (t.user && t.user.avatar_url));
        if (!url) { c.textContent = '\u266A'; return; }
        const img = new Image();
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.className = 'h-full w-full object-cover';
        img.onload = () => c.replaceChildren(img);
        img.onerror = () => { c.textContent = '\u266A'; };
        img.src = String(url).replace('-large', '-t200x200');
    }

    function render(i, keepBar) {
        cur = i;
        const t = sounds[i];
        if (!t) return;
        $('mp-title').textContent = t.title || (started ? 'Loading\u2026' : 'Press play');
        $('mp-artist').textContent = (t.user && t.user.username) || '';
        setCover(t);
        dur = t.duration || 0;
        $('mp-dur').textContent = fmt(dur);
        if (!keepBar) updateBar(0, 0);
    }

    // The playlist list can hold bare entries, so the real info comes from the track that is playing
    function handleSound(i, t) {
        if (!t) return;
        if (i !== cur && Date.now() - lastGoTo < 1500) return; // stale message from before a skip
        sounds[i] = Object.assign({}, sounds[i], t);
        if (isPreview(sounds[i])) {
            const old = queue, at = old.indexOf(i);
            queue = old.filter((k) => !isPreview(sounds[k]));
            if (!queue.length) { token++; send('pause'); setPlaying(false); $('mp-title').textContent = 'Music unavailable'; return; }
            qi = queue.filter((k) => old.indexOf(k) < at).length - 1;
            cur = i;
            move(1, true);
            return;
        }
        const at = queue.indexOf(i);
        if (at >= 0) qi = at;
        render(i, true);
    }

    // Jump to a track right away (UI updates instantly) and make sure it actually starts
    function goTo(i) {
        render(i);
        lastGoTo = Date.now();
        const my = ++token;
        const t0 = Date.now();
        setPlaying(true);
        send('skip', i);
        send('seekTo', 0);
        [150, 900, 2200].forEach((ms) => setTimeout(() => {
            if (my === token && playAt < t0) send('play');
        }, ms));
    }

    function move(dirn, manual) {
        if (!queue.length) return;
        if (repeat === 2 && !manual) { goTo(cur); return; }
        let n = qi + dirn;
        if (n < 0 || n >= queue.length) {
            if (!manual && repeat === 0) { token++; send('pause'); setPlaying(false); return; }
            if (dirn > 0) {
                if (shuffle) {
                    buildQueue(null);
                    if (queue.length > 1 && queue[0] === cur) [queue[0], queue[1]] = [queue[1], queue[0]];
                }
                n = 0;
            } else {
                n = queue.length - 1;
            }
        }
        qi = n;
        goTo(queue[qi]);
    }

    function hook() {
        if (hooked) return;
        hooked = true;
        ['play', 'pause', 'finish', 'playProgress'].forEach((ev) => send('addEventListener', ev));
        send('setVolume', Number($('mp-vol').value));
        ask('getSounds', (list) => {
            sounds = Array.isArray(list) ? list : [];
            buildQueue(null);
            if (!queue.length) { $('mp-title').textContent = 'Music unavailable'; return; }
            render(queue[qi]);
        });
    }

    window.addEventListener('message', (e) => {
        if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
        let d;
        try { d = JSON.parse(e.data); } catch (x) { return; }
        if (!d || !d.method) return;
        if (d.method === 'ready') { hook(); return; }
        if (waiting[d.method]) { const cb = waiting[d.method]; delete waiting[d.method]; cb(d.value); return; }
        if (d.method === 'play') {
            if (Date.now() - userPausedAt < 600) return;
            playAt = Date.now();
            setPlaying(true);
            ask('getCurrentSoundIndex', (i) => ask('getCurrentSound', (t) => handleSound(i || 0, t)));
        }
        else if (d.method === 'pause') { if (Date.now() - lastGoTo > 700) setPlaying(false); }
        else if (d.method === 'finish') move(1, false);
        else if (d.method === 'playProgress' && d.value) {
            lastProg = Date.now();
            updateBar(d.value.currentPosition, d.value.relativePosition);
        }
    });
    frame.addEventListener('load', () => setTimeout(hook, 2500));
    setTimeout(() => { if (!queue.length) $('mp-title').textContent = 'Music unavailable'; }, 10000);

    $('mp-play').addEventListener('click', () => {
        if (!queue.length) return;
        if (!started) { started = true; goTo(queue[qi]); return; }
        token++; // cancel any pending start retries
        if (playing) { userPausedAt = Date.now(); setPlaying(false); send('pause'); }
        else { setPlaying(true); send('play'); }
    });
    $('mp-next').addEventListener('click', () => { started = true; move(1, true); });
    $('mp-prev').addEventListener('click', () => {
        if (started && pos > 3000) { send('seekTo', 0); return; }
        started = true;
        move(-1, true);
    });
    $('mp-shuffle').addEventListener('click', () => {
        shuffle = !shuffle;
        buildQueue(cur);
        paintModes();
    });
    $('mp-repeat').addEventListener('click', () => { repeat = (repeat + 1) % 3; paintModes(); });
    $('mp-seek').addEventListener('input', (e) => {
        seeking = true;
        $('mp-cur').textContent = fmt((e.target.value / 1000) * dur);
    });
    $('mp-seek').addEventListener('change', (e) => {
        send('seekTo', Math.round((e.target.value / 1000) * dur));
        seeking = false;
    });
    $('mp-vol').addEventListener('input', (e) => send('setVolume', Number(e.target.value)));

    // Backup in case progress events stall: ask for the position directly
    setInterval(() => {
        if (!playing || !hooked || Date.now() - lastProg < 1500) return;
        ask('getPosition', (ms) => updateBar(ms));
    }, 500);

    setPlaying(false);
    paintModes();
})();
