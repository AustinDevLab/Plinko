// ---------- Kick.CX embeds (player + chat) ----------
(function () {
    const form = document.getElementById('kick-search-form');
    const input = document.getElementById('kick-search-input');
    const clearBtn = document.getElementById('kick-clear-btn');
    const errEl = document.getElementById('kick-error');
    const playerSlot = document.getElementById('kick-player-slot');
    const chatSlot = document.getElementById('kick-chat-slot');
    const playerPlaceholder = playerSlot.innerHTML;
    const chatPlaceholder = chatSlot.innerHTML;

    // Accepts "xqc", "@xqc", or a kick.com/xqc link. Kick slugs use hyphens instead of underscores.
    function parseStreamer(raw) {
        let v = String(raw || '').trim().toLowerCase();
        v = v.replace(/^https?:\/\//, '').replace(/^(www\.)?kick\.com\//, '').replace(/^@/, '');
        v = v.split(/[/?#]/)[0].replace(/_/g, '-');
        return /^[a-z0-9][a-z0-9-]{0,59}$/.test(v) ? v : null;
    }

    function makeFrame(src, extra) {
        const f = document.createElement('iframe');
        f.src = src;
        f.className = 'block h-full w-full border-0';
        f.setAttribute('allowfullscreen', '');
        f.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
        f.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
        if (extra) f.title = extra;
        return f;
    }

    function load(name) {
        const slug = encodeURIComponent(name);
        playerSlot.className = 'h-full w-full';
        chatSlot.className = 'h-full w-full';
        playerSlot.replaceChildren(makeFrame(`https://player.kick.cx/${slug}`, `${name} stream`));
        chatSlot.replaceChildren(makeFrame(`https://chat.kick.cx/embed/${slug}`, `${name} chat`));
        clearBtn.classList.remove('hidden');
    }

    function clearStream() {
        const base = 'flex h-full w-full items-center justify-center px-4 text-center text-sm text-gray-500';
        playerSlot.className = base;
        chatSlot.className = base;
        playerSlot.innerHTML = playerPlaceholder;
        chatSlot.innerHTML = chatPlaceholder;
        clearBtn.classList.add('hidden');
        errEl.classList.add('hidden');
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = parseStreamer(input.value);
        if (!name) {
            errEl.textContent = 'Enter a valid Kick username (letters, numbers, - or _).';
            errEl.classList.remove('hidden');
            return;
        }
        errEl.classList.add('hidden');
        input.value = name;
        load(name);
    });

    clearBtn.addEventListener('click', clearStream);

    // Used by the Streamers popup
    window.kickWatch = (name) => {
        const slug = parseStreamer(name);
        if (!slug) return;
        errEl.classList.add('hidden');
        input.value = slug;
        load(slug);
    };
})();

// ---------- Streamers popup (only streamers who are live right now) ----------
(function () {
    const STREAMERS = [
        'iceposeidon', 'chickenandy', 'ozemi', 'tiedyez', 'twigggs', 'greatwhitemike',
        'mando', 'ryanheinz', 'stellooo', 'nickwhite', 'shoovy', 'jollyirl',
        'dtanmanb', 'nicklee', 'zuesirl', 'snoral', 'bigsiix', 'thiirty', 'blame',
        'amray', 'floridaboy', 'garydavid', 'fanos',
        'jandro', 'lordhito', 'kimmee', 'mydogjason', 'iduncle', 'feef',
        'cobbruvs', 'adrianahlee', 'alexis', 'xenathewitch', 'simianmonke', 'drago'
    ];
    const CONCURRENCY = 6;
    const TIMEOUT_MS = 8000;
    const CACHE_MS = 60000;

    const modal = document.getElementById('streamers-modal');
    const listEl = document.getElementById('streamers-list');
    const statusEl = document.getElementById('streamers-status');
    const countEl = document.getElementById('streamers-count');
    const refreshBtn = document.getElementById('streamers-refresh');

    let live = [];
    let lastLoad = 0;
    let loading = false;
    let runId = 0;

    function fmtViewers(n) {
        if (!Number.isFinite(n)) return '0';
        return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(n);
    }

    function fmtUptime(startTime) {
        if (!startTime) return '';
        let ts = String(startTime);
        if (!ts.includes('T')) ts = ts.replace(' ', 'T');
        if (!/[Zz]$/.test(ts) && !/[+-]\d{2}:?\d{2}$/.test(ts)) ts += 'Z';
        const ms = Date.now() - new Date(ts).getTime();
        if (!Number.isFinite(ms) || ms < 0) return '';
        const m = Math.floor(ms / 60000);
        return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
    }

    async function getJson(url) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(url, { credentials: 'omit', headers: { 'Accept': 'application/json' }, signal: ctrl.signal });
            if (!res.ok) throw new Error(String(res.status));
            return await res.json();
        } finally {
            clearTimeout(t);
        }
    }

    // Returns { ok:false } on failure, { ok:true, live:false } when offline, or { ok:true, live:true, ...info }
    async function checkStreamer(name) {
        const slug = encodeURIComponent(name);
        let data = null;
        for (const url of [`https://kick.com/api/v2/channels/${slug}/info`, `https://kick.com/api/v2/channels/${slug}`]) {
            try { data = await getJson(url); break; } catch (e) { data = null; }
        }
        if (!data || typeof data !== 'object') return { ok: false };
        const ls = data.livestream;
        if (!ls || ls.is_live === false) return { ok: true, live: false };
        const cat = Array.isArray(ls.categories) && ls.categories[0] ? ls.categories[0].name : (ls.category && ls.category.name) || '';
        return {
            ok: true,
            live: true,
            slug: name,
            name: (data.user && data.user.username) || data.slug || name,
            avatar: (data.user && (data.user.profile_pic || data.user.profilePic)) || '',
            title: ls.session_title || ls.title || '',
            viewers: Number(ls.viewer_count ?? ls.viewers ?? 0),
            category: cat,
            start: ls.start_time || ls.created_at || ''
        };
    }

    function makeRow(s) {
        const row = document.createElement('button');
        row.type = 'button';
        const up = fmtUptime(s.start);
        row.title = [s.title, s.category, up && `live ${up}`].filter(Boolean).join('\n');
        row.className = 'flex min-w-0 items-center gap-2.5 rounded-lg bg-white/5 px-2.5 py-2 text-left transition-colors hover:bg-white/10';

        const avatarWrap = document.createElement('div');
        avatarWrap.className = 'h-9 w-9 flex-none overflow-hidden rounded-full bg-neutral-700';
        const fallback = () => {
            avatarWrap.replaceChildren();
            avatarWrap.classList.add('flex', 'items-center', 'justify-center', 'text-sm', 'font-bold', 'text-white');
            avatarWrap.textContent = (s.name[0] || '?').toUpperCase();
        };
        if (s.avatar) {
            const img = document.createElement('img');
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            img.className = 'h-full w-full object-cover';
            img.addEventListener('error', fallback);
            img.src = s.avatar;
            avatarWrap.appendChild(img);
        } else {
            fallback();
        }

        const info = document.createElement('div');
        info.className = 'min-w-0 flex-1';

        const line1 = document.createElement('div');
        line1.className = 'flex min-w-0 items-baseline gap-1.5';
        const nameEl = document.createElement('span');
        nameEl.className = 'truncate text-[13px] font-semibold text-white';
        nameEl.textContent = s.name;
        line1.appendChild(nameEl);
        if (s.category) {
            const catEl = document.createElement('span');
            catEl.className = 'truncate text-[11px] text-gray-500';
            catEl.textContent = s.category;
            line1.appendChild(catEl);
        }

        const titleEl = document.createElement('div');
        titleEl.className = 'truncate text-xs text-gray-400';
        titleEl.textContent = s.title || 'No title';

        info.append(line1, titleEl);

        const viewersEl = document.createElement('div');
        viewersEl.className = 'flex flex-none items-center gap-1 text-xs font-medium text-gray-300';
        const dot = document.createElement('span');
        dot.className = 'inline-block h-1.5 w-1.5 rounded-full bg-red-500';
        viewersEl.append(dot, document.createTextNode(fmtViewers(s.viewers)));

        row.append(avatarWrap, info, viewersEl);
        row.addEventListener('click', () => {
            closeModal();
            if (window.kickWatch) window.kickWatch(s.slug);
        });
        return row;
    }

    function render() {
        const sorted = [...live].sort((a, b) => b.viewers - a.viewers);
        listEl.replaceChildren(...sorted.map(makeRow));
        countEl.textContent = live.length ? `${live.length} live` : '';
    }

    async function loadAll(force) {
        if (loading) return;
        if (!force && lastLoad && Date.now() - lastLoad < CACHE_MS) { return; }
        loading = true;
        const myRun = ++runId;
        refreshBtn.disabled = true;
        live = [];
        listEl.replaceChildren();
        countEl.textContent = '';

        const queue = [...STREAMERS];
        let done = 0, failed = 0;
        const setStatus = (text, isError) => {
            statusEl.textContent = text;
            statusEl.classList.toggle('text-red-400', !!isError);
            statusEl.classList.toggle('text-gray-500', !isError);
        };
        setStatus('Checking…');

        async function worker() {
            while (queue.length) {
                const name = queue.shift();
                let r;
                try { r = await checkStreamer(name); } catch (e) { r = { ok: false }; }
                if (myRun !== runId) return;
                done++;
                if (!r.ok) failed++;
                else if (r.live) { live.push(r); render(); }
                if (done < STREAMERS.length) setStatus(`Checking ${done}/${STREAMERS.length}…`);
            }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        if (myRun !== runId) return;

        loading = false;
        refreshBtn.disabled = false;
        lastLoad = Date.now();

        if (failed === STREAMERS.length) {
            lastLoad = 0;
            setStatus("Couldn't reach Kick (blocked or failed). Try refresh.", true);
        } else if (live.length === 0) {
            setStatus(`Nobody on your list is live.${failed ? ` ${failed} couldn't be checked.` : ''}`);
        } else {
            setStatus(failed ? `${failed} couldn't be checked` : '');
        }
    }

    function openModal() {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        loadAll(false);
    }
    function closeModal() {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    document.getElementById('streamers-btn').addEventListener('click', openModal);
    document.getElementById('streamers-close').addEventListener('click', closeModal);
    refreshBtn.addEventListener('click', () => loadAll(true));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
})();
