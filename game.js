function validateBet(cents) {
    if (!Number.isInteger(cents) || cents <= 0)
        throw new RangeError(`bet must be a positive integer number of cents, got ${cents}`);
}

function validateSeed(seed) {
    if (!Number.isInteger(seed) || seed < 0)
        throw new RangeError(`seed must be a non-negative integer, got ${seed}`);
}

const MIN_ROWS = 8;
const MAX_ROWS = 16;
const DEFAULT_RTP = 0.99;
const RISKS = ["low", "medium", "high"];
const VOLATILITY_TARGETS = {
    low: 1.88,
    medium: 2.68,
    high: 4.21
};

function validateRtp(rtp) {
    if (!Number.isFinite(rtp) || rtp <= 0 || rtp > 1)
        throw new RangeError(`rtp must be a finite number in (0, 1], got ${rtp}`);
}

function nCr(n, k) {
    let r = 1;
    for (let s = 0; s < k; s++) {
        r = (r * (n - s)) / (s + 1);
    }
    return r;
}

function getNormalDistribution(rows) {
    const totalPaths = 2 ** rows;
    const dist = [];
    for (let s = 0; s <= rows; s++) {
        dist.push(nCr(rows, s) / totalPaths);
    }
    return dist;
}

function getBaseMultipliers(rows, volatilityTarget) {
    const mid = rows / 2;
    const mults = [];
    for (let c = 0; c <= rows; c++) {
        mults.push(volatilityTarget ** Math.abs(c - mid));
    }
    return mults;
}

function calculateMultipliers(rows, risk, rtp = DEFAULT_RTP) {
    validateRtp(rtp);
    const dist = getNormalDistribution(rows);
    const base = getBaseMultipliers(rows, VOLATILITY_TARGETS[risk]);

    let expectedReturn = 0;
    for (let i = 0; i <= rows; i++) {
        expectedReturn += dist[i] * base[i];
    }

    const scale = rtp / expectedReturn;
    return base.map(i => i * scale);
}

const multiplierCache = new Map();

function getMemoizedMultipliers(rows, risk, rtp = DEFAULT_RTP) {
    const key = `${rows}|${risk}|${rtp}`;
    const cached = multiplierCache.get(key);
    if (cached) return cached;
    const calculated = Object.freeze(calculateMultipliers(rows, risk, rtp));
    multiplierCache.set(key, calculated);
    return calculated;
}

function createRNG(seed) {
    let state = seed >>> 0;
    const next = () => {
        state = (state + 1831565813) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0);
    };
    return {
        nextU32: next,
        nextFloat: () => next() / 4294967296,
        nextBit: () => next() >>> 31
    };
}

function validateRows(rows) {
    if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS)
        throw new RangeError(`rows must be an integer within [${MIN_ROWS}, ${MAX_ROWS}], got ${rows}`);
}

function validateRisk(risk) {
    if (!RISKS.includes(risk))
        throw new RangeError(`risk must be one of ${RISKS.join(", ")}, got ${String(risk)}`);
}

function simulateDrop(params) {
    const { bet, seed, rows, risk } = params;
    const rtp = params.rtp ?? DEFAULT_RTP;

    validateBet(bet);
    validateSeed(seed);
    validateRows(rows);
    validateRisk(risk);
    validateRtp(rtp);

    const rng = createRNG(seed);
    const path = [];
    let bucket = 0;

    for (let j = 0; j < rows; j++) {
        const direction = rng.nextBit();
        path.push(direction);
        bucket += direction;
    }

    const multiplier = getMemoizedMultipliers(rows, risk, rtp)[bucket];
    const payout = Math.floor(bet * multiplier);

    return {
        seed,
        rows,
        risk,
        rtp,
        path,
        bucket,
        multiplier,
        bet,
        payout,
        profit: payout - bet,
        won: payout > bet
    };
}

const PEG_MARGIN_TOP_RATIO = 0.18;
const PEG_MARGIN_BOTTOM_RATIO = 0.28;

function getPegCountForRow(row) {
    return row + 3;
}

function getBoardLayout(rows) {
    const pegSpacing = 1 / (rows + 2);
    const rowSpacing = 1 / (rows + 1);
    const pegs = [];

    for (let r = 0; r < rows; r++) {
        const pegsInRow = getPegCountForRow(r);
        const y = (r + 1) * rowSpacing;
        for (let p = 0; p < pegsInRow; p++) {
            pegs.push({
                x: 0.5 + (p - (pegsInRow - 1) / 2) * pegSpacing,
                y
            });
        }
    }

    const buckets = [];
    for (let b = 0; b <= rows; b++) {
        buckets.push({
            x: 0.5 + (b - rows / 2) * pegSpacing,
            y: 1
        });
    }

    return { rows, pegSpacing, pegs, buckets };
}

function getPathCoordinates(rows, path) {
    const xSpacing = 1 / (rows + 2);
    const ySpacing = 1 / (rows + 1);
    const coords = [{ x: 0.5, y: 0 }];

    let currentXOffset = 0;
    for (let i = 0; i < rows; i++) {
        currentXOffset += path[i] === 1 ? 0.5 : -0.5;
        coords.push({
            x: 0.5 + currentXOffset * xSpacing,
            y: (i + 1) * ySpacing
        });
    }

    const finalBucket = path.reduce((sum, p) => sum + p, 0);
    coords.push({
        x: 0.5 + (finalBucket - rows / 2) * xSpacing,
        y: 1
    });

    return coords;
}

function interpolatePosition(rows, path, progress) {
    const coords = getPathCoordinates(rows, path);
    const segments = coords.length - 1;
    const clampedProgress = (!Number.isFinite(progress) || progress <= 0) ? 0 : (progress >= 1 ? 1 : progress);
    const scaledProgress = clampedProgress * segments;
    const currentSegment = Math.min(segments - 1, Math.floor(scaledProgress));
    const segmentProgress = scaledProgress - currentSegment;

    const start = coords[currentSegment];
    const end = coords[currentSegment + 1];

    // Add an arc/bounce effect
    const bounce = Math.sin(segmentProgress * Math.PI) * (end.y - start.y) * 0.22;

    return {
        x: start.x + (end.x - start.x) * segmentProgress,
        y: start.y + (end.y - start.y) * segmentProgress - bounce
    };
}

const CURRENCY_SYMBOL = "₡";
function formatMoney(cents) {
    return `${cents < 0 ? "-" : ""}${CURRENCY_SYMBOL}${(Math.abs(cents) / 100).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

const CANVAS_ASPECT_RATIO = 1.04;
const DROP_SPEED_MS_PER_ROW = 200;
const BOTTOM_DELAY_MS = 120;
const FLOATING_TEXT_DURATION_MS = 1100;
const BUCKET_HIGHLIGHT_DURATION_MS = 450;
const MAX_SEED = 2147483647;

function formatMultiplier(mult) {
    return mult >= 1000 ? `${(mult / 1000).toFixed(mult >= 10000 ? 0 : 1)}k` :
           mult >= 100 ? String(Math.round(mult)) :
           mult >= 10 ? mult.toFixed(1) : mult.toFixed(2);
}

function getBucketColor(bucketIndex, totalRows) {
    const mid = totalRows / 2;
    const distance = mid === 0 ? 0 : Math.min(1, Math.abs(bucketIndex - mid) / mid);
    return `hsl(${50 * (1 - distance)}, 92%, 54%)`;
}

function renderCanvas(ctx, width, height, rows, multipliers, activeDrops, floatingTexts, time) {
    const paddingX = width * 0.04;
    const paddingY = height * 0.04;
    const bucketHeight = Math.min(height * 0.1, 34);
    const boardHeight = height - paddingY - bucketHeight - 6;

    const layout = getBoardLayout(rows);
    const activeWidth = width - paddingX * 2;

    const toScreenX = (x) => paddingX + x * activeWidth;
    const toScreenY = (y) => paddingY + y * boardHeight;

    const pegRadius = Math.max(1.5, layout.pegSpacing * activeWidth * PEG_MARGIN_TOP_RATIO);
    const ballRadius = Math.max(3, layout.pegSpacing * activeWidth * PEG_MARGIN_BOTTOM_RATIO);
    const bucketWidth = layout.pegSpacing * activeWidth;
    const bucketY = paddingY + boardHeight + 6;

    ctx.clearRect(0, 0, width, height);

    // Draw Pegs
    ctx.fillStyle = "rgba(120,130,150,0.55)";
    for (const peg of layout.pegs) {
        ctx.beginPath();
        ctx.arc(toScreenX(peg.x), toScreenY(peg.y), pegRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    // Draw Buckets
    for (let b = 0; b <= rows; b++) {
        const xCenter = toScreenX(layout.buckets[b].x);
        let scale = 1;

        // Highlight animation
        for (const drop of floatingTexts) {
            if (drop.bucket !== b) continue;
            const elapsed = time - drop.start;
            if (elapsed >= 0 && elapsed < BUCKET_HIGHLIGHT_DURATION_MS) {
                scale = Math.max(scale, 1 + 0.32 * Math.sin((elapsed / BUCKET_HIGHLIGHT_DURATION_MS) * Math.PI));
            }
        }

        const bw = bucketWidth * 0.88 * scale;
        const bh = bucketHeight * 0.82 * scale;
        const by = bucketY + (bucketHeight * 0.82 - bh) / 2;

        ctx.fillStyle = getBucketColor(b, rows);
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(xCenter - bw / 2, by, bw, bh, Math.min(6, bw * 0.28));
        } else {
            ctx.rect(xCenter - bw / 2, by, bw, bh); // Fallback
        }
        ctx.fill();

        // Draw Multiplier Text
        const text = `${formatMultiplier(multipliers[b])}x`;
        let fontSize = Math.min(bh * 0.5, 13) * scale;

        ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        while (fontSize > 5 && ctx.measureText(text).width > bw * 0.9) {
            fontSize -= 0.5;
            ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        }

        if (fontSize >= 5) {
            ctx.fillStyle = "rgba(20,12,0,0.85)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(text, xCenter, by + bh / 2);
        }
    }

    // Draw Balls
    for (const drop of activeDrops) {
        const dropDuration = (drop.path.length + 1) * DROP_SPEED_MS_PER_ROW;
        const progress = dropDuration > 0 ? (time - drop.start) / dropDuration : 1;
        const pos = interpolatePosition(drop.rows, drop.path, progress);

        ctx.fillStyle = "#f5f3ff";
        ctx.beginPath();
        ctx.arc(toScreenX(pos.x), toScreenY(pos.y), ballRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    // Draw Floating Text
    for (const ft of floatingTexts) {
        const elapsed = time - ft.start;
        if (elapsed < 0 || elapsed >= FLOATING_TEXT_DURATION_MS) continue;

        const progress = elapsed / FLOATING_TEXT_DURATION_MS;
        const xCenter = toScreenX(getBoardLayout(ft.rows).buckets[ft.bucket].x);

        ctx.globalAlpha = Math.max(0, 1 - progress);
        ctx.fillStyle = ft.color;
        ctx.font = `800 ${Math.max(12, width * 0.03)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(ft.text, xCenter, bucketY - 4 - progress * boardHeight * 0.16);
        ctx.globalAlpha = 1;
    }
}

// State
let balance = 10000;
let wagerStr = "1.00";
let rows = 16;
let risk = "low";

// ---------- Saved progress (balance, stats, risk, rows) ----------
const STATE_KEY = 'plinko-state';
const savedState = (() => {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || null; } catch (e) { return null; }
})();
if (savedState) {
    if (Number.isInteger(savedState.balance) && savedState.balance >= 0 && savedState.balance <= Number.MAX_SAFE_INTEGER) balance = savedState.balance;
    if (Number.isInteger(savedState.rows) && savedState.rows >= MIN_ROWS && savedState.rows <= MAX_ROWS) rows = savedState.rows;
    if (RISKS.includes(savedState.risk)) risk = savedState.risk;
}
let activeDropsCount = 0;
let configLoaded = false;
let config = {
    rtp: DEFAULT_RTP,
    minWagerCents: 10,
    maxWagerCents: Number.MAX_SAFE_INTEGER,
    plinkoEnabled: true,
    gamblingEnabled: true
};

let canvasW = 0;
let canvasH = 0;
let activeDrops = [];
let floatingTexts = [];
let animationFrameId = null;
let dropIdCounter = 0;

// DOM Elements
const canvas = document.getElementById('plinko-canvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('canvas-container');
const balanceDisplay = document.getElementById('balance-display');
const wagerInput = document.getElementById('wager-input');
const dropButton = document.getElementById('drop-button');
const errorMsgElement = document.getElementById('error-message');
const limitsDisplay = document.getElementById('limits-display');
const settingsPanel = document.getElementById('settings-panel');
const riskControls = document.getElementById('risk-controls');
const rowControls = document.getElementById('row-controls');

// Initialize Row Controls
for (let i = MIN_ROWS; i <= MAX_ROWS; i++) {
    const btn = document.createElement('button');
    btn.className = `segmented-btn flex-1 min-w-0 rounded-md px-0 py-1.5 text-center text-sm font-medium text-neutral-400 ${i === rows ? 'active' : ''}`;
    btn.dataset.value = i;
    btn.textContent = i;
    rowControls.appendChild(btn);
}

Array.from(riskControls.children).forEach(b => b.classList.toggle('active', b.dataset.value === risk));

// Event Listeners for UI
riskControls.addEventListener('click', (e) => {
    if(e.target.tagName === 'BUTTON') {
        Array.from(riskControls.children).forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        risk = e.target.dataset.value;
        saveState();
        updateCanvas();
    }
});

rowControls.addEventListener('click', (e) => {
    if(e.target.tagName === 'BUTTON') {
        Array.from(rowControls.children).forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        rows = parseInt(e.target.dataset.value);
        saveState();
        updateCanvas();
    }
});

wagerInput.addEventListener('input', (e) => {
    wagerStr = e.target.value;
    updateUIState();
});

dropButton.addEventListener('click', handleDrop);

function updateBalance(newBal) {
    balance = newBal;
    balanceDisplay.textContent = formatMoney(balance);
    saveState();
}

function updateUIState() {
    const wagerCents = Math.round(Number(wagerStr) * 100);
    const isValidWager = Number.isFinite(wagerCents) && wagerCents > 0;
    const isWithinLimits = isValidWager && wagerCents >= config.minWagerCents && wagerCents <= config.maxWagerCents;
    const hasBalance = balance != null && balance >= wagerCents;
    const isGameEnabled = config.gamblingEnabled && config.plinkoEnabled;
    const canDrop = configLoaded && isGameEnabled && isWithinLimits && hasBalance;
    const isSettingsLocked = activeDropsCount > 0;

    if (isSettingsLocked) {
        settingsPanel.classList.add('pointer-events-none', 'opacity-60');
    } else {
        settingsPanel.classList.remove('pointer-events-none', 'opacity-60');
    }

    dropButton.disabled = !canDrop;

    if (!configLoaded) {
        dropButton.textContent = "Loading…";
    } else if (!isGameEnabled) {
        dropButton.textContent = "Plinko is disabled";
    } else if (!isWithinLimits) {
        dropButton.textContent = "Enter a valid wager";
    } else {
        dropButton.textContent = `Drop for ${formatMoney(wagerCents)}`;
    }
    updateAutoButton();
}

function handleResize() {
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    if (width <= 0) return;

    const height = rect.height; // Using container height determined by aspect ratio
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    canvasW = width;
    canvasH = height;

    updateCanvas();
}

function updateCanvas(time = performance.now()) {
    if (canvasW <= 0 || canvasH <= 0) return;
    const multipliers = getMemoizedMultipliers(rows, risk, config.rtp);
    renderCanvas(ctx, canvasW, canvasH, rows, multipliers, activeDrops, floatingTexts, time);
}

function gameLoop(time) {
    updateCanvas(time);
    const remainingDrops = [];

    for (const drop of activeDrops) {
        const dropDuration = (drop.path.length + 1) * DROP_SPEED_MS_PER_ROW + BOTTOM_DELAY_MS;

        // Pin tick: one per row the ball reaches
        const pinsPassed = Math.min(drop.rows, Math.floor((time - drop.start) / DROP_SPEED_MS_PER_ROW));
        if (pinsPassed > (drop.ticksPlayed || 0)) {
            drop.ticksPlayed = pinsPassed;
            playTick();
        }

        if (time - drop.start >= dropDuration) {
            playLand(drop);
            if (drop.creditCents != null) {
                drop.credited = true;
                updateBalance(balance + drop.creditCents);
            }
            recordResult(drop);
            floatingTexts.push({
                id: dropIdCounter++,
                rows: drop.rows,
                bucket: drop.bucket,
                text: drop.profitCents > 0 ? `+${formatMoney(drop.profitCents)}` : formatMoney(drop.profitCents),
                color: drop.profitCents > 0 ? "#34d399" : drop.profitCents < 0 ? "#f87171" : "#cbd5e1",
                start: time
            });
        } else {
            remainingDrops.push(drop);
        }
    }

    if (remainingDrops.length !== activeDrops.length) {
        activeDrops = remainingDrops;
        activeDropsCount = remainingDrops.length;
        updateUIState();
    }

    floatingTexts = floatingTexts.filter((ft) => time - ft.start < FLOATING_TEXT_DURATION_MS);

    if (activeDrops.length > 0 || floatingTexts.length > 0) {
        animationFrameId = requestAnimationFrame(gameLoop);
    } else {
        animationFrameId = null;
        updateCanvas(time);
    }
}

function startAnimation() {
    if (animationFrameId == null) {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}

function pushDrop(r, path, bucket, profit, credit) {
    activeDrops.push({
        id: dropIdCounter++,
        rows: r,
        path,
        bucket,
        profitCents: profit,
        creditCents: credit,
        start: performance.now()
    });
    activeDropsCount = activeDrops.length;
    updateUIState();
    startAnimation();
}

// Mock API
function mockApiPlay(wager, currentRows, currentRisk) {
    return new Promise(resolve => {
        setTimeout(() => {
            const result = simulateDrop({
                bet: wager,
                seed: Math.floor(Math.random() * MAX_SEED),
                rows: currentRows,
                risk: currentRisk,
                rtp: config.rtp
            });
            resolve({
                result: { kind: "plinko", rows: result.rows, path: result.path, bucket: result.bucket },
                profit_cents: result.profit,
                payout_cents: result.payout
            });
        }, 50); 
    });
}

async function handleDrop() {
    const wagerCents = Math.round(Number(wagerStr) * 100);

    if (!configLoaded || !config.gamblingEnabled || !config.plinkoEnabled) return;
    if (balance < wagerCents) return;

    errorMsgElement.classList.add('hidden');
    updateBalance(balance - wagerCents);

    const res = await mockApiPlay(wagerCents, rows, risk);

    if ("error" in res || res.result.kind !== "plinko") {
        updateBalance(balance + wagerCents);
        if ("error" in res) {
            errorMsgElement.textContent = res.error;
            errorMsgElement.classList.remove('hidden');
        }
        return;
    }

    recordDrop(wagerCents);
    pushDrop(res.result.rows, res.result.path, res.result.bucket, res.profit_cents, res.payout_cents);
}

// ---------- Add $ + Stats (additive; does not touch game logic) ----------
const ADD_MONEY_CENTS = 2500000; // ₡25,000
const freshStats = () => ({
    dropped: 0, wagered: 0, payout: 0, wins: 0, losses: 0, pushes: 0,
    biggestWin: 0, bestMult: 0, deposited: 0, winStreak: 0, bestStreak: 0
});
let stats = freshStats();
if (savedState && savedState.stats) {
    for (const k of Object.keys(stats)) {
        const v = savedState.stats[k];
        if (Number.isFinite(v) && v >= 0) stats[k] = v;
    }
}

function saveState() {
    try {
        // Balls still in the air haven't paid out yet; count their payout so a reload never eats it
        const pending = activeDrops.reduce((sum, d) => d.credited ? sum : sum + (d.creditCents || 0), 0);
        localStorage.setItem(STATE_KEY, JSON.stringify({
            balance: balance + pending,
            rows,
            risk,
            stats: { ...stats, payout: stats.payout + pending }
        }));
    } catch (e) {}
}
window.addEventListener('pagehide', saveState);

const statsModal = document.getElementById('stats-modal');
const statsBody = document.getElementById('stats-body');

function recordDrop(wagerCents) {
    stats.dropped++;
    stats.wagered += wagerCents;
    saveState();
    renderStats();
}

function recordResult(drop) {
    const payout = drop.creditCents || 0;
    const bet = payout - drop.profitCents;
    stats.payout += payout;
    if (drop.profitCents > 0) {
        stats.wins++;
        stats.winStreak++;
        stats.bestStreak = Math.max(stats.bestStreak, stats.winStreak);
        stats.biggestWin = Math.max(stats.biggestWin, drop.profitCents);
    } else if (drop.profitCents < 0) {
        stats.losses++;
        stats.winStreak = 0;
    } else {
        stats.pushes++;
    }
    if (bet > 0) stats.bestMult = Math.max(stats.bestMult, payout / bet);
    saveState();
    renderStats();
}

function renderStats() {
    if (statsModal.classList.contains('hidden')) return;
    const net = stats.payout - stats.wagered;
    const resolved = stats.wins + stats.losses + stats.pushes;
    const winRate = resolved ? (stats.wins / resolved) * 100 : 0;
    const avgBet = stats.dropped ? Math.round(stats.wagered / stats.dropped) : 0;
    const rtp = stats.wagered ? (stats.payout / stats.wagered) * 100 : 0;
    const netColor = net > 0 ? 'text-emerald-400' : net < 0 ? 'text-red-400' : 'text-gray-200';
    const rowsData = [
        ['Total Balls Dropped', stats.dropped.toLocaleString('en-US')],
        ['Total Wagered', formatMoney(stats.wagered)],
        ['Total Payout', formatMoney(stats.payout)],
        ['Net Profit / Loss', `<span class="${netColor}">${net > 0 ? '+' : ''}${formatMoney(net)}</span>`],
        ['Wins', stats.wins.toLocaleString('en-US')],
        ['Losses', stats.losses.toLocaleString('en-US')],
        ['Win Rate', `${winRate.toFixed(1)}%`],
        ['Return (RTP)', `${rtp.toFixed(1)}%`],
        ['Average Bet', formatMoney(avgBet)],
        ['Biggest Win', formatMoney(stats.biggestWin)],
        ['Best Multiplier', `${formatMultiplier(stats.bestMult)}x`],
        ['Best Win Streak', stats.bestStreak.toLocaleString('en-US')],
        ['Total Added', formatMoney(stats.deposited)]
    ];
    statsBody.innerHTML = rowsData.map(([label, val]) =>
        `<div class="flex items-center justify-between border-b border-white/5 py-1"><span class="text-gray-400">${label}</span><span class="font-mono font-semibold text-white">${val}</span></div>`
    ).join('');
}

function openStats() {
    statsModal.classList.remove('hidden');
    statsModal.classList.add('flex');
    initSimInputs();
    renderStats();
}
function closeStats() {
    statsModal.classList.add('hidden');
    statsModal.classList.remove('flex');
}

document.getElementById('add-money-btn').addEventListener('click', () => {
    updateBalance(balance + ADD_MONEY_CENTS);
    stats.deposited += ADD_MONEY_CENTS;
    saveState();
    updateUIState();
    renderStats();
});
document.getElementById('reset-balance-btn').addEventListener('click', () => {
    updateBalance(0);
    updateUIState();
});
// ---------- Simulated drops (added on top of the stats; balance is not touched) ----------
const SIM_MAX_DROPS = 100000000;
const SIM_CHUNK = 100000;
const simBet = document.getElementById('sim-bet');
const simDrops = document.getElementById('sim-drops');
const simRisk = document.getElementById('sim-risk');
const simRows = document.getElementById('sim-rows');
const simRun = document.getElementById('sim-run');
const simStatus = document.getElementById('sim-status');
const statsResetBtn = document.getElementById('stats-reset');
let simRunning = false;
let simInputsReady = false;

for (let i = MIN_ROWS; i <= MAX_ROWS; i++) {
    const o = document.createElement('option');
    o.value = i; o.textContent = i;
    simRows.appendChild(o);
}

// First time the panel opens, start the sim inputs from the current game settings
function initSimInputs() {
    if (simInputsReady) return;
    simInputsReady = true;
    simBet.value = wagerStr;
    simRisk.value = risk;
    simRows.value = rows;
}

function simMsg(text, isError) {
    simStatus.textContent = text;
    simStatus.classList.toggle('text-red-400', !!isError);
    simStatus.classList.toggle('text-gray-400', !isError);
}

function runSimulation() {
    if (simRunning) return;
    const bet = Math.round(Number(simBet.value) * 100);
    const simRiskVal = simRisk.value;
    const simRowsVal = parseInt(simRows.value, 10);
    const total = Math.round(Number(simDrops.value));
    if (!Number.isInteger(bet) || bet <= 0 || bet < config.minWagerCents || bet > config.maxWagerCents) {
        simMsg(`Enter a valid bet (min ${formatMoney(config.minWagerCents)}).`, true);
        return;
    }
    if (!Number.isInteger(total) || total < 1 || total > SIM_MAX_DROPS) {
        simMsg(`Drops must be a whole number from 1 to ${SIM_MAX_DROPS.toLocaleString('en-US')}.`, true);
        return;
    }
    const mults = getMemoizedMultipliers(simRowsVal, simRiskVal, config.rtp);
    const payouts = mults.map(m => Math.floor(bet * m));
    const rng = createRNG(Math.floor(Math.random() * MAX_SEED));
    const shift = 32 - simRowsVal;
    let done = 0;
    let winRun = stats.winStreak; // continue the current streak

    simRunning = true;
    simRun.disabled = true;
    statsResetBtn.disabled = true;

    function step() {
        const end = Math.min(total, done + SIM_CHUNK);
        const n = end - done;
        let wagered = 0, payout = 0, wins = 0, losses = 0, pushes = 0;
        let biggestWin = 0, bestPayout = 0, bestRun = 0;

        for (; done < end; done++) {
            // Each ball = `rows` fair left/right bits; bucket = number of rights
            let x = rng.nextU32() >>> shift;
            let b = 0;
            while (x) { b += x & 1; x >>>= 1; }
            const p = payouts[b];
            const profit = p - bet;
            wagered += bet;
            payout += p;
            if (p > bestPayout) bestPayout = p;
            if (profit > 0) {
                wins++;
                if (profit > biggestWin) biggestWin = profit;
                winRun++;
                if (winRun > bestRun) bestRun = winRun;
            } else if (profit < 0) {
                losses++;
                winRun = 0;
            } else {
                pushes++;
                winRun = 0;
            }
        }

        // Add this chunk on top of the real stats
        stats.dropped += n;
        stats.wagered += wagered;
        stats.payout += payout;
        stats.wins += wins;
        stats.losses += losses;
        stats.pushes += pushes;
        stats.biggestWin = Math.max(stats.biggestWin, biggestWin);
        stats.bestMult = Math.max(stats.bestMult, bestPayout / bet);
        stats.bestStreak = Math.max(stats.bestStreak, bestRun);
        stats.winStreak = winRun;
        renderStats();

        if (done < total) {
            simMsg(`Running… ${done.toLocaleString('en-US')} / ${total.toLocaleString('en-US')}`);
            setTimeout(step, 0);
            return;
        }
        saveState();
        simMsg(`Added ${total.toLocaleString('en-US')} drops (${formatMoney(bet)}, ${simRiskVal} risk, ${simRowsVal} rows) to your stats.`);
        simRunning = false;
        simRun.disabled = false;
        statsResetBtn.disabled = false;
    }
    simMsg('Running…');
    setTimeout(step, 0);
}

simRun.addEventListener('click', runSimulation);

// ---------- Hide / show Kick chat ----------
const kickGrid = document.getElementById('kick-grid');
const kickChatBox = document.getElementById('kick-chat-box');
const chatToggleBtn = document.getElementById('kick-chat-toggle');
let chatHidden = false;
try { chatHidden = localStorage.getItem('plinko-chat-hidden') === '1'; } catch (e) {}

function applyChatVisibility() {
    kickChatBox.classList.toggle('hidden', chatHidden);
    kickGrid.style.gridTemplateColumns = chatHidden ? 'minmax(0, 1fr)' : '';
    chatToggleBtn.textContent = chatHidden ? 'Show chat' : 'Hide chat';
}
chatToggleBtn.addEventListener('click', () => {
    chatHidden = !chatHidden;
    try { localStorage.setItem('plinko-chat-hidden', chatHidden ? '1' : '0'); } catch (e) {}
    applyChatVisibility();
});
applyChatVisibility();

// ---------- Sound (low-pitched pin ticks + landing thud) ----------
let soundOn = true;
try { soundOn = localStorage.getItem('plinko-sound') !== 'off'; } catch (e) {}
let audioCtx = null;
let audioOut = null;
let lastTickAt = 0;
const soundBtn = document.getElementById('sound-btn');

function updateSoundBtn() {
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.classList.toggle('text-gray-500', !soundOn);
}

function ensureAudio() {
    if (!soundOn) return null;
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
        // Low-pass keeps everything dull and deep (nothing high-pitched gets through)
        audioOut = audioCtx.createBiquadFilter();
        audioOut.type = 'lowpass';
        audioOut.frequency.value = 500;
        audioOut.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function thump(freq, peak, dur) {
    const ac = ensureAudio();
    if (!ac || ac.state !== 'running') return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(audioOut);
    osc.start(t);
    osc.stop(t + dur + 0.02);
}

function playTick() {
    if (!soundOn) return;
    const now = performance.now();
    if (now - lastTickAt < 30) return; // avoid a wall of sound with many balls
    lastTickAt = now;
    thump(150 + Math.random() * 50, 0.14, 0.05);
}

function playLand(drop) {
    if (!soundOn) return;
    thump(drop.profitCents > 0 ? 120 : 85, 0.3, 0.16);
}

soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    try { localStorage.setItem('plinko-sound', soundOn ? 'on' : 'off'); } catch (e) {}
    updateSoundBtn();
    if (soundOn) { ensureAudio(); thump(150, 0.14, 0.05); }
});
// Browsers only allow audio after a user gesture
document.addEventListener('pointerdown', ensureAudio);
document.addEventListener('keydown', ensureAudio);
updateSoundBtn();

document.getElementById('stats-btn').addEventListener('click', openStats);
document.getElementById('stats-close').addEventListener('click', closeStats);
statsModal.addEventListener('click', (e) => { if (e.target === statsModal) closeStats(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStats(); });
document.getElementById('stats-reset').addEventListener('click', () => {
    stats = freshStats();
    saveState();
    renderStats();
});

// ---------- 2x wager + Auto Drop ----------
document.getElementById('half-btn').addEventListener('click', () => {
    const cur = Number(wagerStr);
    if (!Number.isFinite(cur) || cur <= 0) return;
    // Halve, but never drop below the minimum wager
    wagerStr = Math.max(cur / 2, config.minWagerCents / 100).toFixed(2);
    wagerInput.value = wagerStr;
    updateUIState();
});
document.getElementById('double-btn').addEventListener('click', () => {
    const cur = Number(wagerStr);
    if (!Number.isFinite(cur) || cur <= 0) return;
    if (!(balance > 0)) return;
    // Double, but never past the current balance
    wagerStr = Math.min(cur * 2, balance / 100).toFixed(2);
    wagerInput.value = wagerStr;
    updateUIState();
});

const AUTO_DROP_INTERVAL_MS = 500;
const autoButton = document.getElementById('auto-button');
let autoOn = false;
let autoTimer = null;
let autoBusy = false;

function updateAutoButton() {
    autoButton.disabled = !configLoaded && !autoOn;
    autoButton.textContent = autoOn ? 'Stop Auto Drop' : 'Auto Drop';
    autoButton.classList.toggle('bg-red-600', autoOn);
    autoButton.classList.toggle('text-white', autoOn);
    autoButton.classList.toggle('hover:bg-red-500', autoOn);
    autoButton.classList.toggle('bg-neutral-800', !autoOn);
    autoButton.classList.toggle('text-gray-200', !autoOn);
    autoButton.classList.toggle('hover:bg-neutral-700', !autoOn);
}

function stopAuto(message) {
    autoOn = false;
    clearInterval(autoTimer);
    autoTimer = null;
    if (message) {
        errorMsgElement.textContent = message;
        errorMsgElement.classList.remove('hidden');
    }
    updateAutoButton();
}

async function autoTick() {
    if (!autoOn || autoBusy) return;
    const wagerCents = Math.round(Number(wagerStr) * 100);
    const valid = Number.isFinite(wagerCents) && wagerCents >= config.minWagerCents && wagerCents <= config.maxWagerCents;
    if (!configLoaded || !config.gamblingEnabled || !config.plinkoEnabled || !valid) {
        stopAuto('Auto drop stopped: enter a valid wager.');
        return;
    }
    if (balance < wagerCents) {
        stopAuto('Auto drop stopped: not enough balance.');
        return;
    }
    autoBusy = true;
    try { await handleDrop(); } finally { autoBusy = false; }
}

autoButton.addEventListener('click', () => {
    if (autoOn) {
        stopAuto();
        return;
    }
    autoOn = true;
    errorMsgElement.classList.add('hidden');
    updateAutoButton();
    autoTick();
    autoTimer = setInterval(autoTick, AUTO_DROP_INTERVAL_MS);
});

window.addEventListener('resize', handleResize);

// Initial setup
updateBalance(balance);
handleResize();

// Simulate config load
setTimeout(() => {
    configLoaded = true;
    limitsDisplay.textContent = `Min ${formatMoney(config.minWagerCents)} • Max ${formatMoney(config.maxWagerCents)}`;
    limitsDisplay.classList.remove('opacity-0');
    updateUIState();
}, 300);
