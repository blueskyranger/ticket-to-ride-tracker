// =====================================================
// TICKET TO RIDE — RICH LANDSCAPE MAP
// Targets iPad 13" and laptop (landscape).
// ViewBox 1400 × 720 — winding track left to right
// through illustrated terrain.
// =====================================================

import { initializeApp }             from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
    getFirestore,
    doc, getDoc,
    collection, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey:            "AIzaSyAwyzLorHfENmCOVr3B1q4FhUn7sI565cI",
    authDomain:        "hrb-cleaning-v2.firebaseapp.com",
    projectId:         "hrb-cleaning-v2",
    storageBucket:     "hrb-cleaning-v2.firebasestorage.app",
    messagingSenderId: "30392652789",
    appId:             "1:30392652789:web:e4c0fc5202299cc4df46bc"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const COL_CONFIG = "ttr_config";
const COL_GAMES  = "ttr_games";

// =====================================================
// TRACK GEOMETRY
// 25 hand-placed waypoints define the winding route.
// The track climbs through hills, peaks at Copper Ridge,
// descends into a river valley, rises through forest,
// then climbs again for the Thunder Pass tunnel before
// arriving at Grand Central.
// =====================================================
const RAW_PTS = [
    { x: 95,   y: 412 },
    { x: 168,  y: 400 },
    { x: 242,  y: 386 },
    { x: 318,  y: 364 },
    { x: 392,  y: 337 },
    { x: 462,  y: 308 },
    { x: 530,  y: 275 },
    { x: 568,  y: 260 },
    { x: 606,  y: 268 },
    { x: 650,  y: 305 },
    { x: 700,  y: 348 },
    { x: 742,  y: 372 },
    { x: 788,  y: 366 },
    { x: 842,  y: 350 },
    { x: 900,  y: 330 },
    { x: 960,  y: 324 },
    { x: 1020, y: 335 },
    { x: 1076, y: 347 },
    { x: 1132, y: 339 },
    { x: 1186, y: 315 },
    { x: 1228, y: 283 },
    { x: 1272, y: 281 },
    { x: 1318, y: 345 },
    { x: 1356, y: 385 },
    { x: 1382, y: 414 },
];

// Build cumulative distances so we can map score → position
function buildWaypoints(pts) {
    const out = [{ ...pts[0], d: 0 }];
    for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i-1].x;
        const dy = pts[i].y - pts[i-1].y;
        out.push({ ...pts[i], d: out[i-1].d + Math.sqrt(dx*dx + dy*dy) });
    }
    return out;
}

const WAYPOINTS  = buildWaypoints(RAW_PTS);
const TOTAL_DIST = WAYPOINTS[WAYPOINTS.length - 1].d;

// Returns {x, y} on the track for a given score value
function getPosition(score, goal) {
    const target = (Math.min(score, goal) / goal) * TOTAL_DIST;
    for (let i = 1; i < WAYPOINTS.length; i++) {
        if (target <= WAYPOINTS[i].d) {
            const t = (target - WAYPOINTS[i-1].d) / (WAYPOINTS[i].d - WAYPOINTS[i-1].d);
            return {
                x: WAYPOINTS[i-1].x + t * (WAYPOINTS[i].x - WAYPOINTS[i-1].x),
                y: WAYPOINTS[i-1].y + t * (WAYPOINTS[i].y - WAYPOINTS[i-1].y),
            };
        }
    }
    return { x: WAYPOINTS[WAYPOINTS.length-1].x, y: WAYPOINTS[WAYPOINTS.length-1].y };
}

// Smooth SVG path through all raw points using midpoint-quadratic technique
function smoothPath(pts) {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i+1].x) / 2;
        const my = (pts[i].y + pts[i+1].y) / 2;
        d += ` Q ${pts[i].x} ${pts[i].y} ${mx} ${my}`;
    }
    d += ` L ${pts[pts.length-1].x} ${pts[pts.length-1].y}`;
    return d;
}

const TRACK_PATH = smoothPath(RAW_PTS);

// =====================================================
// LANDMARKS
// =====================================================
const LANDMARK_NAMES = [
    'Departure Yard', 'Millbrook', 'Copper Ridge', 'Sallows Crossing',
    'Fort Haven',     'Ashgrove',  'Thunder Pass',  'Ironvale', 'Grand Central'
];

// Label above/below the track at each station
const LANDMARK_LABEL_SIDE = [
    'below', 'below', 'above', 'above',
    'above', 'below', 'above', 'below', 'below'
];

function generateLandmarks(goal) {
    const marks = [];
    let pts = 0, i = 0;
    while (pts < goal && i < LANDMARK_NAMES.length - 1) {
        marks.push({ pts, name: LANDMARK_NAMES[i], side: LANDMARK_LABEL_SIDE[i] });
        pts += 130;
        i++;
    }
    marks.push({ pts: goal, name: 'Grand Central', side: 'below' });
    return marks;
}

// =====================================================
// PLAYER COLOURS (one per player index)
// =====================================================
const PLAYER_COLOURS = [
    { fill: '#c0392b', dark: '#7f1d1d', gold: '#d4a017' },
    { fill: '#1b2a4a', dark: '#0d1826', gold: '#d4a017' },
    { fill: '#27ae60', dark: '#145a32', gold: '#f0c040' },
    { fill: '#8e44ad', dark: '#5b2c6f', gold: '#f0c040' },
    { fill: '#e67e22', dark: '#935116', gold: '#fff' },
    { fill: '#16a085', dark: '#0e6655', gold: '#f0c040' },
];

// =====================================================
// TOKEN OFFSET — spread players that are within 30pts
// =====================================================
function applyOffsets(players, goal) {
    const sorted = [...players].sort((a, b) => a.score - b.score);
    const buckets = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
        const last = sorted[i-1];
        sorted[i].score - last.score <= 30
            ? buckets[buckets.length-1].push(sorted[i])
            : buckets.push([sorted[i]]);
    }
    buckets.forEach(bucket => {
        bucket.forEach((p, i) => {
            p.yOffset = (i - (bucket.length - 1) / 2) * 52;
        });
    });
    return players;
}

// =====================================================
// STATE
// =====================================================
const state = { config: null, allGames: [], selectedGroup: null };

// =====================================================
// STARTUP
// =====================================================
async function init() {
    try { await signInAnonymously(auth); }
    catch { showMsg("Cannot connect — check internet."); return; }

    const snap = await getDoc(doc(db, COL_CONFIG, "config"));
    if (!snap.exists()) { showMsg("No tracker data found. Set up the app first."); return; }
    state.config = snap.data();

    const q = query(collection(db, COL_GAMES), orderBy("date", "asc"));
    onSnapshot(q, s => {
        const season = state.config.season ?? 0;
        state.allGames = s.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(g => (g.season ?? 0) === season);
        onData();
    });
}

function onData() {
    const groups = buildGroups(state.allGames);
    if (!Object.keys(groups).length) {
        showMsg("🚂 No games yet — add results on the scoreboard.");
        document.getElementById("group-bar").style.visibility = "hidden";
        return;
    }
    populateSelector(groups);
    render(groups);
}

// =====================================================
// GROUP SELECTOR
// =====================================================
function buildGroups(games) {
    const g = {};
    games.forEach(gm => { if (!g[gm.groupKey]) g[gm.groupKey] = []; g[gm.groupKey].push(gm); });
    return g;
}

function populateSelector(groups) {
    const bar = document.getElementById("group-bar");
    const sel = document.getElementById("group-selector");
    const keys = Object.keys(groups);
    bar.style.visibility = keys.length > 1 ? "visible" : "hidden";

    const cur = [...sel.options].map(o => o.value);
    if (JSON.stringify(cur) !== JSON.stringify(keys)) {
        sel.innerHTML = keys.map(k => `<option value="${k}">${k.split(",").join(" · ")}</option>`).join("");
        if (!keys.includes(state.selectedGroup)) state.selectedGroup = keys[0];
        sel.value = state.selectedGroup;
    }
}

function selectGroup(key) {
    state.selectedGroup = key;
    render(buildGroups(state.allGames));
}

// =====================================================
// RENDER
// =====================================================
function render(groups) {
    const key     = state.selectedGroup || Object.keys(groups)[0];
    if (!key || !groups[key]) return;

    const games   = groups[key];
    const players = key.split(",");
    const goal    = Number(state.config.goal);
    const totals  = calcTotals(players, games);
    applyOffsets(totals, goal);

    const landmarks = generateLandmarks(goal);
    document.getElementById("map-wrapper").innerHTML = buildSVG(totals, landmarks, goal);
}

// =====================================================
// MASTER SVG BUILDER
// =====================================================
function buildSVG(players, landmarks, goal) {
    return `
<svg id="track-svg" viewBox="0 0 1400 720"
     xmlns="http://www.w3.org/2000/svg"
     preserveAspectRatio="xMidYMid meet">

  <defs>${defs()}</defs>

  ${sky()}
  ${distantMountains()}
  ${groundLayer()}
  ${mountainsCopperRidge()}
  ${mountainsThunderPass()}
  ${river()}
  ${forest()}
  ${bridge()}
  ${track()}
  ${tunnelPortals()}
  ${clouds()}
  ${stations(landmarks, goal)}
  ${playerTokens(players, landmarks, goal)}
  ${compassRose()}
  ${legend(players)}
  ${titleBox(goal)}
  ${border()}

</svg>`;
}

// =====================================================
// DEFS  — gradients, filters, animations
// =====================================================
function defs() { return `
  <linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#6ab0d8"/>
    <stop offset="55%"  stop-color="#b8d9f0"/>
    <stop offset="100%" stop-color="#dfd0a8"/>
  </linearGradient>

  <linearGradient id="gGround" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#5a8c3e"/>
    <stop offset="50%"  stop-color="#4a7832"/>
    <stop offset="100%" stop-color="#2c4820"/>
  </linearGradient>

  <linearGradient id="gMtn" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#8a8e9e"/>
    <stop offset="65%"  stop-color="#6a6878"/>
    <stop offset="100%" stop-color="#4e4050"/>
  </linearGradient>

  <linearGradient id="gMtnFar" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#9aafc5" stop-opacity="0.45"/>
    <stop offset="100%" stop-color="#b8c8d8" stop-opacity="0.1"/>
  </linearGradient>

  <linearGradient id="gRiver" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%"   stop-color="#3a78c0"/>
    <stop offset="45%"  stop-color="#60a8e8"/>
    <stop offset="100%" stop-color="#3a78c0"/>
  </linearGradient>

  <radialGradient id="gVignette" cx="50%" cy="50%" r="72%">
    <stop offset="45%"  stop-color="transparent"/>
    <stop offset="100%" stop-color="rgba(10,14,28,0.55)"/>
  </radialGradient>

  <radialGradient id="gHeadlamp" cx="40%" cy="40%" r="60%">
    <stop offset="0%"   stop-color="#fff9c0"/>
    <stop offset="100%" stop-color="#d4a017"/>
  </radialGradient>

  <filter id="fShadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="2" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.45"/>
  </filter>

  <filter id="fGlow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="5" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>

  <filter id="fPaper" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="4" stitchTiles="stitch" result="noise"/>
    <feColorMatrix type="saturate" values="0" in="noise" result="grey"/>
    <feBlend in="SourceGraphic" in2="grey" mode="multiply" result="blend"/>
    <feComponentTransfer in="blend">
      <feFuncA type="linear" slope="1"/>
    </feComponentTransfer>
  </filter>

  <style>
    @keyframes cloudDrift {
      from { transform: translateX(-250px); }
      to   { transform: translateX(1650px); }
    }
    @keyframes riverShimmer {
      0%,100% { opacity: 0.78; }
      50%      { opacity: 0.98; }
    }
    @keyframes smokePuff {
      0%   { transform: translateY(0)   scale(1);   opacity: 0.75; }
      100% { transform: translateY(-38px) scale(2.2); opacity: 0; }
    }
    .cl1 { animation: cloudDrift 38s linear infinite; }
    .cl2 { animation: cloudDrift 52s linear infinite 9s; }
    .cl3 { animation: cloudDrift 44s linear infinite 19s; }
    .cl4 { animation: cloudDrift 60s linear infinite 30s; }
    .rs  { animation: riverShimmer 3.5s ease-in-out infinite; }
  </style>
`; }

// =====================================================
// SKY
// =====================================================
function sky() { return `
  <rect width="1400" height="720" fill="url(#gSky)"/>
  <!-- Warm horizon haze -->
  <ellipse cx="700" cy="390" rx="860" ry="90" fill="#f0d898" opacity="0.22"/>
`; }

// =====================================================
// DISTANT MOUNTAINS (hazy, far background)
// =====================================================
function distantMountains() { return `
  <g opacity="1">
    <polygon fill="url(#gMtnFar)"
      points="0,370 60,318 130,340 200,295 285,262 360,292 430,258
              510,238 585,262 648,278 710,305 780,292 848,312 920,288
              990,308 1060,284 1130,300 1200,272 1268,288 1330,308
              1400,298 1400,420 0,420"/>
  </g>
`; }

// =====================================================
// GROUND LAYER  (main landmass polygon)
// =====================================================
function groundLayer() { return `
  <polygon fill="url(#gGround)"
    points="0,432 82,422 168,412 248,398 328,378 400,354 468,324
            520,295 568,278 604,285 640,310 680,342 722,375 758,392
            800,385 848,368 904,348 960,342 1020,352 1078,365
            1134,357 1188,334 1232,300 1278,298 1328,364 1362,404
            1400,432 1400,720 0,720"/>
  <!-- Slightly lighter strip at ground top edge for separation -->
  <polygon fill="#6aaa48" opacity="0.28"
    points="0,432 82,422 168,412 248,398 328,378 400,354 468,324
            520,295 568,278 604,285 640,310 680,342 722,375 758,392
            800,385 848,368 904,348 960,342 1020,352 1078,365
            1134,357 1188,334 1232,300 1278,298 1328,364 1362,404
            1400,432 1400,455 0,455"/>
`; }

// =====================================================
// MOUNTAINS — COPPER RIDGE (x ≈ 390–660)
// =====================================================
function mountainsCopperRidge() { return `
  <!-- Far range behind main peaks -->
  <g opacity="0.6">
    <polygon fill="#828898"
      points="360,378 395,308 430,338 468,262 502,210 530,182 556,198
              582,236 610,268 640,295 668,318 688,355 688,378"/>
  </g>
  <!-- Main near range -->
  <polygon fill="url(#gMtn)"
    points="378,378 415,302 448,335 480,252 512,194 538,162 558,148
            576,160 596,188 620,228 648,262 670,295 685,338 692,378"/>
  <!-- Left peak shadow -->
  <polygon fill="#2e2838" opacity="0.28"
    points="556,200 598,278 640,330 658,378 580,378 555,295 542,230"/>
  <!-- Rock facets (lighter) -->
  <polygon fill="#a0a4b4" opacity="0.5"
    points="538,162 524,190 542,208 560,190 556,168"/>
  <polygon fill="#9698a8" opacity="0.4"
    points="512,215 498,240 520,255 535,238 525,218"/>
  <!-- Snow caps -->
  <polygon fill="white" points="558,148 540,185 576,185"/>
  <polygon fill="white" points="512,194 498,225 530,222"/>
  <!-- Snow shading -->
  <polygon fill="#d8e8f4" opacity="0.7" points="558,158 548,180 568,178"/>
  <polygon fill="#d8e8f4" opacity="0.6" points="512,204 504,222 522,220"/>
`; }

// =====================================================
// MOUNTAINS — THUNDER PASS (x ≈ 1150–1310)
// =====================================================
function mountainsThunderPass() { return `
  <!-- Far layer -->
  <g opacity="0.55">
    <polygon fill="#828898"
      points="1140,378 1172,308 1200,268 1225,215 1248,182 1268,198
              1290,238 1310,275 1330,320 1352,378"/>
  </g>
  <!-- Main range -->
  <polygon fill="url(#gMtn)"
    points="1155,378 1185,298 1212,232 1238,185 1258,162 1278,178
            1302,228 1322,278 1345,345 1365,378"/>
  <!-- Shadow -->
  <polygon fill="#2e2838" opacity="0.28"
    points="1262,200 1302,275 1342,358 1295,358 1264,275 1252,210"/>
  <!-- Rock facets -->
  <polygon fill="#a0a4b4" opacity="0.45"
    points="1258,162 1245,192 1262,210 1278,192 1272,168"/>
  <!-- Snow cap -->
  <polygon fill="white" points="1258,162 1240,198 1275,198"/>
  <polygon fill="#d8e8f4" opacity="0.7" points="1258,172 1248,195 1266,192"/>

  <!-- TUNNEL INTERIOR (dark fill covers track between portals) -->
  <!-- This sits under the portals and mountain to simulate darkness -->
  <rect x="1218" y="268" width="60" height="22" fill="#0d0808" rx="2"/>
`; }

// =====================================================
// RIVER  (Sallows Crossing, x ≈ 700–790)
// =====================================================
function river() { return `
  <!-- River body -->
  <path class="rs"
    d="M 698 155 C 708 225 716 278 722 338 C 726 362 736 378 742 404
       C 750 438 758 495 764 570 C 768 638 770 690 772 720"
    stroke="url(#gRiver)" stroke-width="32" fill="none" stroke-linecap="round"/>
  <!-- Highlight stripe -->
  <path
    d="M 705 165 C 713 232 720 282 724 342 C 728 364 738 380 743 406"
    stroke="rgba(180,225,255,0.55)" stroke-width="10" fill="none" stroke-linecap="round"/>
  <!-- Shoreline shadows -->
  <path
    d="M 686 160 C 695 220 706 272 710 332 C 714 358 724 378 730 402"
    stroke="rgba(20,50,100,0.28)" stroke-width="6" fill="none" stroke-linecap="round"/>
`; }

// =====================================================
// FOREST  (Fort Haven, x ≈ 840–1060)
// =====================================================
function forest() {
    const treeData = [
        // x, y, scale, fill
        [848,350,1.0,'#2d6e2d'],[862,338,1.2,'#256025'],[878,346,0.9,'#347a34'],
        [892,334,1.1,'#2d6e2d'],[906,342,1.0,'#286028'],[920,330,1.3,'#347a34'],
        [935,340,0.9,'#256025'],[948,328,1.2,'#2d6e2d'],[960,334,1.0,'#347a34'],
        [975,342,1.1,'#256025'],[988,332,0.9,'#2d6e2d'],[1002,337,1.2,'#347a34'],
        [1016,329,1.0,'#286028'],[1030,340,0.8,'#256025'],[1044,332,1.1,'#2d6e2d'],
        [1058,342,1.0,'#347a34'],
        // Back row (darker, smaller)
        [852,318,1.0,'#1e501e'],[872,308,1.2,'#205020'],[898,310,1.0,'#1e501e'],
        [924,304,1.2,'#205020'],[950,308,1.0,'#1e501e'],[976,313,1.0,'#205020'],
        [1002,309,1.2,'#1e501e'],[1028,306,1.0,'#205020'],[1054,314,1.0,'#1e501e'],
    ];

    return treeData.map(([x,y,sc,fill]) => {
        const h = 32 * sc, w = 20 * sc;
        const fill2 = fill === '#256025' ? '#347a34' : '#2d6e2d';
        return `
  <!-- Tree at ${x},${y} -->
  <rect x="${x-2}" y="${y}" width="4" height="12" fill="#5c3a18"/>
  <polygon points="${x},${y-h} ${x-w/2},${y+4} ${x+w/2},${y+4}" fill="${fill}"/>
  <polygon points="${x},${y-h*0.62} ${x-w*0.62},${y-h*0.1} ${x+w*0.62},${y-h*0.1}" fill="${fill2}"/>`;
    }).join('');
}

// =====================================================
// RAILWAY BRIDGE  (over river, x ≈ 710–795)
// =====================================================
function bridge() {
    const bY = 370, x1 = 708, x2 = 796;
    const pilings = [714, 733, 752, 771, 790];
    const braces  = [720, 741, 762, 783];

    return `
  <!-- Bridge horizontal beams -->
  <rect x="${x1}" y="${bY-6}" width="${x2-x1}" height="12" fill="#6b4820" rx="2"/>
  <rect x="${x1+4}" y="${bY-3}" width="${x2-x1-8}" height="5" fill="#8b6914" opacity="0.5"/>
  <!-- Top railing -->
  <line x1="${x1}" y1="${bY-14}" x2="${x2}" y2="${bY-14}" stroke="#8b6914" stroke-width="2.5"/>
  ${pilings.map(px => `<line x1="${px}" y1="${bY-14}" x2="${px}" y2="${bY-4}" stroke="#8b6914" stroke-width="2"/>`).join('')}
  <!-- Trestle X-braces -->
  ${braces.map(px => `
  <line x1="${px-9}" y1="${bY+6}" x2="${px+9}" y2="${bY+55}" stroke="#5c3a18" stroke-width="3"/>
  <line x1="${px+9}" y1="${bY+6}" x2="${px-9}" y2="${bY+55}" stroke="#5c3a18" stroke-width="3"/>`).join('')}
  <!-- Vertical pilings -->
  ${pilings.map(px => `<rect x="${px-3}" y="${bY+6}" width="6" height="56" fill="#4a2e12" rx="1"/>`).join('')}
  <!-- Horizontal cross-beams -->
  <line x1="${x1+6}" y1="${bY+30}" x2="${x2-6}" y2="${bY+30}" stroke="#5c3a18" stroke-width="2.5"/>
  <line x1="${x1+6}" y1="${bY+53}" x2="${x2-6}" y2="${bY+53}" stroke="#5c3a18" stroke-width="2.5"/>
`;
}

// =====================================================
// TRACK  (rails + ballast + ties)
// =====================================================
function track() { return `
  <!-- Ballast (wide, warm brown) -->
  <path d="${TRACK_PATH}" stroke="#7a5a20" stroke-width="20"
        fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Ties (dashed) -->
  <path d="${TRACK_PATH}" stroke="#5a3c10" stroke-width="16"
        stroke-dasharray="5 15" fill="none"
        stroke-linecap="butt" stroke-linejoin="round"/>
  <!-- Left rail -->
  <path d="${TRACK_PATH}" stroke="#c8a830" stroke-width="4"
        fill="none" stroke-linecap="round" stroke-linejoin="round"
        transform="translate(-4.5,0)"/>
  <!-- Right rail -->
  <path d="${TRACK_PATH}" stroke="#c8a830" stroke-width="4"
        fill="none" stroke-linecap="round" stroke-linejoin="round"
        transform="translate(4.5,0)"/>
  <!-- Rail sheen -->
  <path d="${TRACK_PATH}" stroke="rgba(255,235,120,0.35)" stroke-width="1.5"
        fill="none" stroke-linecap="round" transform="translate(-4.5,-1.5)"/>
  <path d="${TRACK_PATH}" stroke="rgba(255,235,120,0.35)" stroke-width="1.5"
        fill="none" stroke-linecap="round" transform="translate(4.5,-1.5)"/>
`; }

// =====================================================
// TUNNEL PORTALS  (at Thunder Pass entry & exit)
// =====================================================
function tunnelPortals() {
    // Entry: track at ≈ (1228, 283)  Exit: ≈ (1272, 281)
    function portal(cx, cy, label) {
        return `
  <!-- Tunnel portal ${label} -->
  <g transform="translate(${cx},${cy})">
    <!-- Stone surround -->
    <path d="M -30 62 L -30 8 A 30 34 0 0 1 30 8 L 30 62"
          fill="#4a4244" stroke="#2e2830" stroke-width="2"/>
    <!-- Keystone -->
    <polygon points="0,-28 -8,-8 8,-8" fill="#3a3240"/>
    <!-- Stone courses (horizontal lines) -->
    <line x1="-30" y1="20" x2="-24" y2="20" stroke="#2e2830" stroke-width="1.5"/>
    <line x1="24"  y1="20" x2="30"  y2="20" stroke="#2e2830" stroke-width="1.5"/>
    <line x1="-30" y1="38" x2="-24" y2="38" stroke="#2e2830" stroke-width="1.5"/>
    <line x1="24"  y1="38" x2="30"  y2="38" stroke="#2e2830" stroke-width="1.5"/>
    <!-- Dark interior -->
    <path d="M -22 62 L -22 14 A 22 26 0 0 1 22 14 L 22 62" fill="#100808"/>
    <!-- Slight ambient light inside (just at opening) -->
    <path d="M -16 62 L -16 18 A 16 20 0 0 1 16 18 L 16 62"
          fill="rgba(60,20,10,0.7)"/>
  </g>`;
    }
    return portal(1228, 220) + portal(1272, 218);
}

// =====================================================
// CLOUDS  (animated, drift across sky)
// =====================================================
function cloud(cx, cy, scale, cls) {
    const s = scale;
    return `
  <g class="${cls}" transform="translate(${cx},${cy})">
    <ellipse cx="0"        cy="0"    rx="${38*s}" ry="${22*s}" fill="white" opacity="0.88"/>
    <ellipse cx="${28*s}"  cy="${4*s}"  rx="${30*s}" ry="${18*s}" fill="white" opacity="0.88"/>
    <ellipse cx="${-28*s}" cy="${5*s}"  rx="${26*s}" ry="${16*s}" fill="white" opacity="0.88"/>
    <ellipse cx="${10*s}"  cy="${-10*s}" rx="${22*s}" ry="${15*s}" fill="white" opacity="0.9"/>
  </g>`;
}

function clouds() { return `
  ${cloud(-200, 80,  1.0, 'cl1')}
  ${cloud(400,  55,  0.8, 'cl2')}
  ${cloud(850,  70,  1.1, 'cl3')}
  ${cloud(1200, 48,  0.75,'cl4')}
`; }

// =====================================================
// STATION BUILDINGS  (at each landmark)
// =====================================================
function stationBuilding(x, y, side, isEnd, isStart) {
    // dy: how far above/below the track to place the building
    const dy = side === 'above' ? -52 : 30;
    const bx = x, by = y + dy;
    const w  = isEnd || isStart ? 38 : 26;
    const h  = isEnd || isStart ? 26 : 18;
    const rh = isEnd || isStart ? 18 : 13; // roof height

    return `
  <g transform="translate(${bx},${by})" filter="url(#fShadow)">
    <!-- Building body -->
    <rect x="${-w/2}" y="${-h}" width="${w}" height="${h}" fill="#e8d5a3" stroke="#5c3d2e" stroke-width="1.2" rx="1"/>
    <!-- Roof -->
    <polygon points="${-w/2-4},${-h} ${w/2+4},${-h} 0,${-h-rh}" fill="#c0392b" stroke="#5c3d2e" stroke-width="1"/>
    <!-- Door -->
    <rect x="-5" y="${-10}" width="10" height="10" fill="#5c3d2e" rx="1"/>
    <!-- Windows -->
    <rect x="${-w/2+3}" y="${-h+4}" width="8" height="6" fill="#a8d0e8" stroke="#5c3d2e" stroke-width="0.8"/>
    ${w > 26 ? `<rect x="${w/2-11}" y="${-h+4}" width="8" height="6" fill="#a8d0e8" stroke="#5c3d2e" stroke-width="0.8"/>` : ''}
    <!-- Chimney -->
    <rect x="${w/2-8}" y="${-h-rh+4}" width="5" height="${rh-2}" fill="#8b6914" stroke="#5c3d2e" stroke-width="0.8"/>
    <!-- Platform -->
    <rect x="${-w/2-4}" y="0" width="${w+8}" height="4" fill="#d4a017" fill-opacity="0.5"/>
  </g>`;
}

function stationLabel(x, y, side, name, pts) {
    const dy   = side === 'above' ? -82 : 58;
    const lx = x, ly = y + dy;
    const tw = Math.max(name.length * 6.5, 70);
    return `
  <g transform="translate(${lx},${ly})">
    <rect x="${-tw/2}" y="-16" width="${tw}" height="28" rx="4"
          fill="#fff8e7" fill-opacity="0.95" stroke="#1b2a4a" stroke-width="1.5"/>
    <rect x="${-tw/2+3}" y="-13" width="${tw-6}" height="22" rx="2"
          fill="none" stroke="#d4a017" stroke-width="0.8" opacity="0.6"/>
    <text y="-3" text-anchor="middle"
          font-family="Oswald, sans-serif" font-size="11" font-weight="600"
          fill="#1b2a4a">${name}</text>
    <text y="8" text-anchor="middle"
          font-family="Lato, sans-serif" font-size="9" fill="#5c3d2e">${pts.toLocaleString()} pts</text>
  </g>`;
}

function stations(landmarks, goal) {
    return landmarks.map((lm, i) => {
        const pos     = getPosition(lm.pts, goal);
        const isStart = i === 0;
        const isEnd   = i === landmarks.length - 1;
        return stationBuilding(pos.x, pos.y, lm.side, isEnd, isStart)
             + stationLabel(pos.x, pos.y, lm.side, lm.name, lm.pts);
    }).join('');
}

// =====================================================
// PLAYER TOKENS  (detailed vintage locomotives)
// =====================================================
function smokeSVG(id) { return `
  <circle id="s${id}a" cx="10" cy="-22" r="4" fill="rgba(90,90,90,0.75)">
    <animate attributeName="cy"      values="-22;-48;-62" dur="2.8s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.75;0.4;0"  dur="2.8s" repeatCount="indefinite"/>
    <animate attributeName="r"       values="4;7;10"       dur="2.8s" repeatCount="indefinite"/>
  </circle>
  <circle cx="14" cy="-25" r="3" fill="rgba(110,110,110,0.6)">
    <animate attributeName="cy"      values="-25;-52;-68" dur="3.4s" repeatCount="indefinite" begin="1s"/>
    <animate attributeName="opacity" values="0.6;0.3;0"   dur="3.4s" repeatCount="indefinite" begin="1s"/>
    <animate attributeName="r"       values="3;6;9"        dur="3.4s" repeatCount="indefinite" begin="1s"/>
  </circle>
`; }

function locomotiveSVG(c, name, score, yOff, idx) {
    const { fill, dark, gold } = c;
    return `
  <g transform="translate(0,${yOff})" filter="url(#fShadow)">
    ${smokeSVG(idx)}
    <!-- Tender car -->
    <rect x="34" y="-8" width="24" height="14" rx="2" fill="${fill}"/>
    <rect x="35" y="-6" width="22" height="8" rx="1" fill="${dark}" opacity="0.55"/>
    <!-- Engine body -->
    <rect x="0" y="-10" width="36" height="18" rx="3" fill="${fill}"/>
    <!-- Boiler (darker cylinder) -->
    <ellipse cx="5" cy="-1" rx="11" ry="10" fill="${dark}"/>
    <!-- Chimney -->
    <rect x="10" y="-20" width="7" height="11" rx="2" fill="${dark}"/>
    <rect x="8"  y="-22" width="11" height="3" rx="2" fill="${dark}"/>
    <!-- Cab -->
    <rect x="28" y="-15" width="12" height="12" rx="1" fill="${dark}"/>
    <rect x="30" y="-13" width="8"  height="8"  rx="1" fill="rgba(160,220,255,0.72)"/>
    <!-- Drive wheels -->
    <circle cx="11" cy="11" r="10" fill="${dark}" stroke="${gold}" stroke-width="1.8"/>
    <circle cx="27" cy="11" r="10" fill="${dark}" stroke="${gold}" stroke-width="1.8"/>
    <!-- Tender wheels -->
    <circle cx="41" cy="11" r="7"  fill="${dark}" stroke="${gold}" stroke-width="1.5"/>
    <circle cx="53" cy="11" r="7"  fill="${dark}" stroke="${gold}" stroke-width="1.5"/>
    <!-- Hubs -->
    <circle cx="11" cy="11" r="3.5" fill="${gold}"/>
    <circle cx="27" cy="11" r="3.5" fill="${gold}"/>
    <circle cx="41" cy="11" r="2.5" fill="${gold}"/>
    <circle cx="53" cy="11" r="2.5" fill="${gold}"/>
    <!-- Connecting rod -->
    <line x1="11" y1="11" x2="27" y2="11" stroke="${gold}" stroke-width="2.2"/>
    <!-- Headlamp -->
    <circle cx="-5" cy="-1" r="6" fill="url(#gHeadlamp)" filter="url(#fGlow)"/>
    <circle cx="-5" cy="-1" r="3.5" fill="white" opacity="0.9"/>
    <!-- Cowcatcher -->
    <polygon points="-4,-5 -15,5 -4,5" fill="${dark}"/>
    <!-- Name label -->
    <rect x="-4" y="-38" width="${Math.max(name.length*7.5, 65)}" height="16" rx="3"
          fill="white" fill-opacity="0.95" stroke="${fill}" stroke-width="1.5"/>
    <text x="${Math.max(name.length*7.5, 65)/2 - 4}" y="-27"
          text-anchor="middle" font-family="Oswald,sans-serif"
          font-size="11" font-weight="600" fill="${fill}">${name}</text>
    <!-- Score label -->
    <rect x="2" y="28" width="54" height="16" rx="3" fill="${fill}" fill-opacity="0.92"/>
    <text x="29" y="39" text-anchor="middle" font-family="Oswald,sans-serif"
          font-size="11" fill="white">${score.toLocaleString()} pts</text>
  </g>`;
}

function playerTokens(players, landmarks, goal) {
    return players.map((p, i) => {
        const pos = getPosition(p.score, goal);
        const c   = PLAYER_COLOURS[i % PLAYER_COLOURS.length];
        return `<g transform="translate(${pos.x.toFixed(1)},${(pos.y - 14).toFixed(1)})">`
             + locomotiveSVG(c, p.name, p.score, p.yOffset || 0, i)
             + `</g>`;
    }).join('');
}

// =====================================================
// COMPASS ROSE
// =====================================================
function compassRose() { return `
  <g transform="translate(1348, 638)">
    <circle r="38" fill="#fff8e7" fill-opacity="0.92" stroke="#1b2a4a" stroke-width="2"/>
    <circle r="38" fill="none" stroke="#d4a017" stroke-width="0.8" stroke-dasharray="4 4"/>
    <!-- Cardinal pointers -->
    <polygon points="0,-32 4,-16 0,-22 -4,-16" fill="#c0392b"/>
    <polygon points="0,32  4,16  0,22  -4,16"  fill="#1b2a4a"/>
    <polygon points="-32,0 -16,4 -22,0 -16,-4" fill="#1b2a4a"/>
    <polygon points="32,0  16,4  22,0  16,-4"  fill="#1b2a4a"/>
    <!-- Intercardinal ticks -->
    <line x1="22" y1="-22" x2="18" y2="-18" stroke="#1b2a4a" stroke-width="1.5"/>
    <line x1="-22" y1="-22" x2="-18" y2="-18" stroke="#1b2a4a" stroke-width="1.5"/>
    <line x1="22" y1="22" x2="18" y2="18" stroke="#1b2a4a" stroke-width="1.5"/>
    <line x1="-22" y1="22" x2="-18" y2="18" stroke="#1b2a4a" stroke-width="1.5"/>
    <!-- Centre -->
    <circle r="7" fill="#1b2a4a"/>
    <circle r="4" fill="#d4a017"/>
    <!-- Labels -->
    <text y="-36" text-anchor="middle" font-family="Oswald,sans-serif" font-size="11" font-weight="600" fill="#1b2a4a">N</text>
    <text y="46"  text-anchor="middle" font-family="Oswald,sans-serif" font-size="11" fill="#1b2a4a">S</text>
    <text x="-44" y="4" text-anchor="middle" font-family="Oswald,sans-serif" font-size="11" fill="#1b2a4a">W</text>
    <text x="44"  y="4" text-anchor="middle" font-family="Oswald,sans-serif" font-size="11" fill="#1b2a4a">E</text>
  </g>
`; }

// =====================================================
// LEGEND  (player colour key, bottom-left)
// =====================================================
function legend(players) {
    const lw = 185, lh = 28 + players.length * 22;
    const rows = players.map((p, i) => {
        const c = PLAYER_COLOURS[i % PLAYER_COLOURS.length];
        return `
    <g transform="translate(18, ${22 + i * 22})">
      <circle r="7" fill="${c.fill}" stroke="white" stroke-width="1.2"/>
      <text x="14" y="4" font-family="Oswald,sans-serif" font-size="11" fill="#1b2a4a">${p.name}</text>
      <text x="${lw - 22}" y="4" text-anchor="end" font-family="Oswald,sans-serif" font-size="11" fill="#c0392b" font-weight="600">${p.score.toLocaleString()}</text>
    </g>`;
    }).join('');

    return `
  <g transform="translate(18, ${720 - lh - 18})">
    <rect width="${lw}" height="${lh}" rx="5"
          fill="#fff8e7" fill-opacity="0.94" stroke="#1b2a4a" stroke-width="2"/>
    <rect x="3" y="3" width="${lw-6}" height="${lh-6}" rx="3"
          fill="none" stroke="#d4a017" stroke-width="0.8"/>
    <text x="${lw/2}" y="15" text-anchor="middle"
          font-family="Oswald,sans-serif" font-size="10" letter-spacing="2"
          fill="#1b2a4a" text-decoration="none">PASSENGERS</text>
    ${rows}
  </g>`;
}

// =====================================================
// TITLE BOX  (top-left)
// =====================================================
function titleBox(goal) { return `
  <g transform="translate(20,18)">
    <rect width="285" height="78" rx="5"
          fill="#fff8e7" fill-opacity="0.94" stroke="#1b2a4a" stroke-width="2.5"/>
    <rect x="4" y="4" width="277" height="70" rx="3"
          fill="none" stroke="#d4a017" stroke-width="1"/>
    <text x="142" y="30" text-anchor="middle"
          font-family="Playfair Display,serif" font-size="21" font-weight="700"
          fill="#c0392b">TICKET TO RIDE</text>
    <text x="142" y="47" text-anchor="middle"
          font-family="Oswald,sans-serif" font-size="10" letter-spacing="3.5"
          fill="#1b2a4a">SEASON ROUTE MAP</text>
    <line x1="20" y1="54" x2="265" y2="54" stroke="#d4a017" stroke-width="0.8" opacity="0.7"/>
    <text x="142" y="67" text-anchor="middle"
          font-family="Lato,sans-serif" font-size="9" fill="#5c3d2e">
      Goal: ${Number(goal).toLocaleString()} pts
    </text>
  </g>
`; }

// =====================================================
// DECORATIVE BORDER + VIGNETTE
// =====================================================
function border() { return `
  <!-- Vignette -->
  <rect width="1400" height="720" fill="url(#gVignette)"/>
  <!-- Outer frame -->
  <rect x="6" y="6" width="1388" height="708" rx="6"
        fill="none" stroke="#1b2a4a" stroke-width="3" opacity="0.7"/>
  <!-- Inner gold line -->
  <rect x="12" y="12" width="1376" height="696" rx="4"
        fill="none" stroke="#d4a017" stroke-width="1.2" opacity="0.55"/>
  <!-- Corner ornaments -->
  ${['translate(18,18)','translate(1382,18) scale(-1,1)',
     'translate(18,702) scale(1,-1)','translate(1382,702) scale(-1,-1)'].map(t => `
  <g transform="${t}">
    <polygon points="0,0 18,0 0,18" fill="#d4a017" opacity="0.55"/>
    <polygon points="4,4 14,4 4,14" fill="#1b2a4a" opacity="0.4"/>
  </g>`).join('')}
`; }

// =====================================================
// UTILITIES
// =====================================================
function calcTotals(players, games) {
    const map = {};
    players.forEach(p => { map[p] = 0; });
    games.forEach(gm =>
        Object.entries(gm.scores).forEach(([p, pts]) => {
            if (p in map) map[p] += pts;
        })
    );
    return Object.entries(map).map(([name, score]) => ({ name, score, yOffset: 0 }));
}

function showMsg(msg) {
    document.getElementById("map-wrapper").innerHTML =
        `<div class="map-message">${msg}</div>`;
}

// =====================================================
// EXPOSE + BOOT
// =====================================================
window.selectGroup = selectGroup;
init();
