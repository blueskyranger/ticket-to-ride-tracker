// =====================================================
// TICKET TO RIDE — TRAIN MAP
// map.js — Graphical serpentine track with player tokens
//
// Track layout: 5 horizontal rows connected by 4 semicircular
// curves, winding down the screen. Players are positioned along
// the track based on their cumulative score vs the season goal.
// =====================================================

import { initializeApp }        from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
    getFirestore,
    doc, getDoc,
    collection, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// --- Firebase (same project, same isolated collections) ---
const firebaseConfig = {
    apiKey:            "AIzaSyAwyzLorHfENmCOVr3B1q4FhUn7sI565cI",
    authDomain:        "hrb-cleaning-v2.firebaseapp.com",
    projectId:         "hrb-cleaning-v2",
    storageBucket:     "hrb-cleaning-v2.firebasestorage.app",
    messagingSenderId: "30392652789",
    appId:             "1:30392652789:web:e4c0fc5202299cc4df46bc"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

const COL_CONFIG = "ttr_config";
const COL_GAMES  = "ttr_games";

// =====================================================
// TRACK GEOMETRY
// 5 horizontal rows + 4 semicircular curves (r=70)
// ViewBox: 0 0 360 720
//
// Row y-coords:  100, 240, 380, 520, 660
// Track x range: 70 (left) to 290 (right)
// Curve radius:  70  →  arc length ≈ 220 per semicircle
// =====================================================

// Waypoints define the centreline of the track for interpolation.
// 'd' is cumulative distance along the path from the start.
// Curve midpoints are approximated for smoother positioning.
const WAYPOINTS = [
    { x: 70,  y: 100, d: 0    },   // Start
    { x: 290, y: 100, d: 220  },   // End row 1
    { x: 360, y: 170, d: 330  },   // Midpoint right curve 1
    { x: 290, y: 240, d: 440  },   // End right curve 1
    { x: 70,  y: 240, d: 660  },   // End row 2
    { x: 0,   y: 310, d: 770  },   // Midpoint left curve 1
    { x: 70,  y: 380, d: 880  },   // End left curve 1
    { x: 290, y: 380, d: 1100 },   // End row 3
    { x: 360, y: 450, d: 1210 },   // Midpoint right curve 2
    { x: 290, y: 520, d: 1320 },   // End right curve 2
    { x: 70,  y: 520, d: 1540 },   // End row 4
    { x: 0,   y: 590, d: 1650 },   // Midpoint left curve 2
    { x: 70,  y: 660, d: 1760 },   // End left curve 2
    { x: 290, y: 660, d: 1980 },   // End — Grand Central
];
const TOTAL_DIST = 1980;

// SVG path string for the visual track (arcs are true semicircles)
const TRACK_PATH =
    "M 70 100 L 290 100 " +
    "A 70 70 0 0 1 290 240 " +   // right curve
    "L 70 240 " +
    "A 70 70 0 0 0 70 380 " +    // left curve
    "L 290 380 " +
    "A 70 70 0 0 1 290 520 " +   // right curve
    "L 70 520 " +
    "A 70 70 0 0 0 70 660 " +    // left curve
    "L 290 660";

// =====================================================
// LANDMARK DEFINITIONS
// Names assigned in railway order, goal-adjustable.
// Grand Central always sits at the goal point.
// =====================================================
const LANDMARK_NAMES = [
    'Departure Yard',
    'Millbrook',
    'Copper Ridge',
    'Sallows Crossing',
    'Fort Haven',
    'Ashgrove',
    'Thunder Pass',
    'Ironvale',
    'Grand Central'
];

// Builds the landmark list for a given goal
function generateLandmarks(goal) {
    const marks = [];
    let pts = 0;
    let i   = 0;
    while (pts < goal && i < LANDMARK_NAMES.length - 1) {
        marks.push({ pts, name: LANDMARK_NAMES[i] });
        pts += 130;
        i++;
    }
    // Grand Central always at the goal
    marks.push({ pts: goal, name: 'Grand Central' });
    return marks;
}

// =====================================================
// PLAYER TOKEN COLOURS (one per player index)
// =====================================================
const TOKEN_COLOURS = [
    { fill: '#c0392b', dark: '#7f1d1d' },   // Red
    { fill: '#1b2a4a', dark: '#0f1a2e' },   // Navy
    { fill: '#27ae60', dark: '#145a32' },   // Green
    { fill: '#8e44ad', dark: '#5b2c6f' },   // Purple
    { fill: '#e67e22', dark: '#935116' },   // Orange
    { fill: '#16a085', dark: '#0e6655' },   // Teal
];

// =====================================================
// STATE
// =====================================================
let state = {
    config:       null,
    allGames:     [],
    selectedGroup: null
};

// =====================================================
// STARTUP
// =====================================================
async function init() {
    try {
        await signInAnonymously(auth);
    } catch {
        showMessage("Could not connect. Check your internet connection.");
        return;
    }

    const configSnap = await getDoc(doc(db, COL_CONFIG, "config"));
    if (!configSnap.exists()) {
        showMessage("No tracker data found. Set up the app first.");
        return;
    }
    state.config = configSnap.data();

    // Listen to game updates in real time
    const q = query(collection(db, COL_GAMES), orderBy("date", "asc"));
    onSnapshot(q, snap => {
        const currentSeason = state.config.season ?? 0;
        state.allGames = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(g => (g.season ?? 0) === currentSeason);

        onDataChanged();
    });
}

// Called whenever game data or group selection changes
function onDataChanged() {
    const groups = buildGroups(state.allGames);

    if (Object.keys(groups).length === 0) {
        showMessage("🚂 No games yet — add results on the scoreboard.");
        document.getElementById("group-bar").style.display = "none";
        document.getElementById("score-strip").innerHTML   = "";
        return;
    }

    populateGroupSelector(groups);
    renderMap(groups);
}

// =====================================================
// GROUP SELECTOR
// =====================================================

// Groups games by groupKey (sorted player list)
function buildGroups(games) {
    const groups = {};
    games.forEach(g => {
        if (!groups[g.groupKey]) groups[g.groupKey] = [];
        groups[g.groupKey].push(g);
    });
    return groups;
}

function populateGroupSelector(groups) {
    const bar      = document.getElementById("group-bar");
    const selector = document.getElementById("group-selector");
    const keys     = Object.keys(groups);

    bar.style.display = keys.length > 1 ? "flex" : "none";

    // Only rebuild options if they changed
    const currentOptions = [...selector.options].map(o => o.value);
    if (JSON.stringify(currentOptions) === JSON.stringify(keys)) return;

    selector.innerHTML = keys
        .map(k => `<option value="${k}">${k.split(",").join(" · ")}</option>`)
        .join("");

    // Keep selection if still valid, otherwise pick first
    if (!keys.includes(state.selectedGroup)) {
        state.selectedGroup = keys[0];
    }
    selector.value = state.selectedGroup;
}

// Called when the user picks a different group from the dropdown
function selectGroup(groupKey) {
    state.selectedGroup = groupKey;
    const groups = buildGroups(state.allGames);
    renderMap(groups);
}

// =====================================================
// MAP RENDERING
// =====================================================

function renderMap(groups) {
    const wrapper = document.getElementById("map-wrapper");
    const groupKey = state.selectedGroup || Object.keys(groups)[0];

    if (!groupKey || !groups[groupKey]) {
        showMessage("Select a group to view the map.");
        return;
    }

    const games   = groups[groupKey];
    const players = groupKey.split(",");
    const goal    = Number(state.config.goal);

    // Calculate total scores per player for this group
    const totals = calcTotals(players, games);

    // Apply offsets so overlapping tokens don't stack directly
    applyOffsets(totals, goal);

    const landmarks = generateLandmarks(goal);

    // Build the full SVG
    const svg = buildSVG(totals, landmarks, goal);
    wrapper.innerHTML = svg;

    // Render the score strip below
    renderScoreStrip(totals, goal, players);
}

// =====================================================
// SVG BUILDER
// =====================================================

function buildSVG(players, landmarks, goal) {
    return `
        <svg id="track-svg" viewBox="-10 60 380 660"
             xmlns="http://www.w3.org/2000/svg"
             role="img" aria-label="Train map showing player progress">

            <!-- Background paper texture -->
            <rect x="-10" y="60" width="380" height="660" fill="#fdf3dc" rx="8"/>

            <!-- Terrain decorations -->
            ${terrainSVG()}

            <!-- Track ballast (wide) and rails (narrow) -->
            <path d="${TRACK_PATH}"
                  stroke="#8b6914" stroke-width="18" fill="none"
                  stroke-linecap="round" stroke-linejoin="round"/>

            <!-- Railroad ties (dashed pattern on ballast) -->
            <path d="${TRACK_PATH}"
                  stroke="#6b4f12" stroke-width="14" fill="none"
                  stroke-dasharray="3 12"
                  stroke-linecap="round" stroke-linejoin="round"/>

            <!-- Left rail -->
            <path d="${TRACK_PATH}"
                  stroke="#c0a020" stroke-width="3" fill="none"
                  stroke-linecap="round" stroke-linejoin="round"
                  transform="translate(-3, 0)"/>
            <!-- Right rail -->
            <path d="${TRACK_PATH}"
                  stroke="#c0a020" stroke-width="3" fill="none"
                  stroke-linecap="round" stroke-linejoin="round"
                  transform="translate(3, 0)"/>

            <!-- Landmark markers -->
            ${landmarks.map(lm => landmarkSVG(lm, goal)).join("")}

            <!-- Player tokens -->
            ${players.map((p, i) => tokenSVG(p, i, goal)).join("")}

        </svg>`;
}

// =====================================================
// TERRAIN DECORATIONS
// Simple shapes to give the map a landscape feel
// =====================================================
function terrainSVG() {
    return `
        <!-- Mountain range (top right) -->
        <g opacity="0.18" fill="#1b2a4a">
            <polygon points="295,80 315,55 335,80"/>
            <polygon points="310,80 335,50 360,80"/>
            <polygon points="325,80 350,58 375,80"/>
        </g>
        <!-- Hills (bottom left) -->
        <g opacity="0.13" fill="#27ae60">
            <ellipse cx="30"  cy="680" rx="40" ry="20"/>
            <ellipse cx="70"  cy="685" rx="30" ry="16"/>
            <ellipse cx="-10" cy="690" rx="35" ry="18"/>
        </g>
        <!-- River (middle section) -->
        <path d="M 0 295 Q 50 305 100 295 Q 150 285 200 295 Q 250 305 290 295"
              stroke="#4a90d9" stroke-width="4" fill="none" opacity="0.25"
              stroke-linecap="round"/>
        <!-- Forest dots (right side, row 3) -->
        <g opacity="0.15" fill="#27ae60">
            <circle cx="330" cy="370" r="10"/>
            <circle cx="345" cy="362" r="8"/>
            <circle cx="355" cy="373" r="9"/>
        </g>
    `;
}

// =====================================================
// LANDMARK SVG
// Gold diamond marker with station name and point value
// =====================================================
function landmarkSVG(landmark, goal) {
    const pos  = getPosition(landmark.pts, goal);
    const side = pos.x < 180 ? 'right' : 'left';
    const dx   = side === 'right' ? 14 : -14;
    const anchor = side === 'right' ? 'start' : 'end';

    const isStart = landmark.pts === 0;
    const isEnd   = landmark.pts >= goal;
    const iconSize = isEnd ? 11 : isStart ? 9 : 7;
    const iconFill = isEnd ? '#d4a017' : isStart ? '#c0392b' : '#d4a017';

    return `
        <g class="landmark" transform="translate(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})">
            <!-- Marker diamond -->
            <polygon
                points="0,${-iconSize} ${iconSize},0 0,${iconSize} ${-iconSize},0"
                fill="${iconFill}" stroke="#1b2a4a" stroke-width="1.2"/>
            <!-- Station name -->
            <text x="${dx}" y="-2"
                  text-anchor="${anchor}"
                  font-family="Oswald, sans-serif" font-size="10"
                  font-weight="600" fill="#1b2a4a">${landmark.name}</text>
            <!-- Points label -->
            <text x="${dx}" y="10"
                  text-anchor="${anchor}"
                  font-family="Lato, sans-serif" font-size="8.5"
                  fill="#5c3d2e">${landmark.pts.toLocaleString()} pts</text>
        </g>`;
}

// =====================================================
// PLAYER TOKEN SVG
// Coloured circle with initials, score tag below
// =====================================================
function tokenSVG(player, index, goal) {
    const pos    = getPosition(player.score, goal);
    const colour = TOKEN_COLOURS[index % TOKEN_COLOURS.length];
    const initials = playerInitials(player.name);
    const yOff  = player.yOffset || 0;

    // Direction hint: are we on a left-to-right row or right-to-left row?
    // Used to decide which side to put the score tag
    const onLeftRow = isLeftToRightRow(pos.y);
    const tagDx    = onLeftRow ? 0 : 0;   // centred for now

    return `
        <g class="player-token"
           transform="translate(${pos.x.toFixed(1)}, ${(pos.y + yOff).toFixed(1)})"
           role="img" aria-label="${player.name}: ${player.score} points">

            <!-- Drop shadow -->
            <circle r="17" cx="2" cy="3" fill="rgba(0,0,0,0.25)"/>

            <!-- Token circle -->
            <circle r="17" fill="${colour.fill}" stroke="white" stroke-width="2.5"/>

            <!-- Inner ring detail -->
            <circle r="12" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>

            <!-- Player initials -->
            <text y="5" text-anchor="middle"
                  font-family="Oswald, sans-serif"
                  font-size="${initials.length > 2 ? 9 : 11}"
                  font-weight="600" fill="white"
                  letter-spacing="0.05em">${initials}</text>

            <!-- Score tag -->
            <g transform="translate(0, 26)">
                <rect x="-22" y="-9" width="44" height="16" rx="4"
                      fill="${colour.fill}" fill-opacity="0.9" stroke="white" stroke-width="1.5"/>
                <text y="4" text-anchor="middle"
                      font-family="Oswald, sans-serif" font-size="10"
                      fill="white">${player.score.toLocaleString()}</text>
            </g>

        </g>`;
}

// =====================================================
// SCORE STRIP (below the SVG)
// Quick reference showing rank, name, score
// =====================================================
function renderScoreStrip(players, goal, allPlayers) {
    const strip  = document.getElementById("score-strip");
    const sorted = [...players].sort((a, b) => b.score - a.score);

    if (sorted.length === 0) { strip.innerHTML = ""; return; }

    strip.innerHTML = sorted.map((p, i) => {
        const idx    = allPlayers.indexOf(p.name);
        const colour = TOKEN_COLOURS[idx % TOKEN_COLOURS.length].fill;
        const pct    = Math.min(Math.round((p.score / goal) * 100), 100);
        const medal  = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i+1}`;
        return `
            <div class="score-strip-row">
                <span style="font-size:1rem">${medal}</span>
                <span class="strip-swatch" style="background:${colour}"></span>
                <span class="strip-name">${p.name}</span>
                <span class="strip-score">${p.score.toLocaleString()}</span>
                <span class="strip-pct">${pct}%</span>
            </div>`;
    }).join("");
}

// =====================================================
// POSITION CALCULATION
// Linear interpolation along the waypoint path
// =====================================================
function getPosition(score, goal) {
    const target = (Math.min(score, goal) / goal) * TOTAL_DIST;

    for (let i = 1; i < WAYPOINTS.length; i++) {
        if (target <= WAYPOINTS[i].d) {
            const t = (target - WAYPOINTS[i-1].d) / (WAYPOINTS[i].d - WAYPOINTS[i-1].d);
            return {
                x: WAYPOINTS[i-1].x + t * (WAYPOINTS[i].x - WAYPOINTS[i-1].x),
                y: WAYPOINTS[i-1].y + t * (WAYPOINTS[i].y - WAYPOINTS[i-1].y)
            };
        }
    }
    // At or beyond goal: return last waypoint
    const last = WAYPOINTS[WAYPOINTS.length - 1];
    return { x: last.x, y: last.y };
}

// Returns true if the track is moving left→right at the given y level
function isLeftToRightRow(y) {
    // Rows 1, 3, 5 (y ≈ 100, 380, 660) go left→right
    // Rows 2, 4   (y ≈ 240, 520) go right→left
    const rowY = [100, 240, 380, 520, 660];
    const nearest = rowY.reduce((prev, cur) =>
        Math.abs(cur - y) < Math.abs(prev - y) ? cur : prev);
    return nearest === 100 || nearest === 380 || nearest === 660;
}

// =====================================================
// OFFSET LOGIC
// Spreads players vertically when they are close together
// (within 30 pts). Modifies player.yOffset in place.
// =====================================================
function applyOffsets(players, goal) {
    const PROXIMITY_PTS = 30;
    const SPREAD_PX     = 38;

    // Sort by score ascending for grouping
    const sorted = [...players].sort((a, b) => a.score - b.score);

    // Bucket players that are within PROXIMITY_PTS of each other
    const buckets = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
        const last = sorted[i - 1];
        if (sorted[i].score - last.score <= PROXIMITY_PTS) {
            buckets[buckets.length - 1].push(sorted[i]);
        } else {
            buckets.push([sorted[i]]);
        }
    }

    // Spread each bucket symmetrically
    buckets.forEach(bucket => {
        const n = bucket.length;
        bucket.forEach((p, i) => {
            p.yOffset = (i - (n - 1) / 2) * SPREAD_PX;
        });
    });
}

// =====================================================
// UTILITIES
// =====================================================

// Sums each player's scores across a list of games
function calcTotals(players, games) {
    const map = {};
    players.forEach(p => { map[p] = 0; });
    games.forEach(game =>
        Object.entries(game.scores).forEach(([p, pts]) => {
            if (p in map) map[p] += pts;
        })
    );
    return Object.entries(map).map(([name, score]) => ({ name, score, yOffset: 0 }));
}

// Returns up to 3 uppercase initials from a name
function playerInitials(name) {
    return name
        .split(/\s+/)
        .map(w => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 3);
}

// Replaces the map wrapper with a plain text message
function showMessage(msg) {
    document.getElementById("map-wrapper").innerHTML =
        `<div class="map-message">${msg}</div>`;
}

// =====================================================
// EXPOSE TO HTML onclick (selectGroup is on the <select>)
// =====================================================
window.selectGroup = selectGroup;

// =====================================================
// BOOT
// =====================================================
init();
