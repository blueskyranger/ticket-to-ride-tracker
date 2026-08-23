// =====================================================
// TICKET TO RIDE — SCORE TRACKER
// app.js — All application logic
//
// Architecture:
//   - Firebase Firestore stores config and game results
//   - All screens live in index.html; JS shows/hides them
//   - state{} is the single source of truth in memory
//   - listenToGames() keeps state.games in sync in real time
// =====================================================

import { initializeApp }       from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
    getFirestore,
    doc, getDoc, setDoc, deleteDoc,
    collection, addDoc, getDocs,
    query, orderBy, onSnapshot,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// --- Firebase config (dedicated project) ---
const firebaseConfig = {
    apiKey:            "AIzaSyBIRumuNvUAAHz4-idXDMia7-OVY4_9UeY",
    authDomain:        "ticket-to-ride-tracker-3072f.firebaseapp.com",
    projectId:         "ticket-to-ride-tracker-3072f",
    storageBucket:     "ticket-to-ride-tracker-3072f.firebasestorage.app",
    messagingSenderId: "967305312959",
    appId:             "1:967305312959:web:e2b4c63ae4998d269ea40a"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

// Firestore collection names — completely separate from HRB Cleaning
const COL_CONFIG = "ttr_config";   // single doc: "config"
const COL_GAMES  = "ttr_games";    // one doc per game
const COL_GROUPS = "ttr_groups";   // one doc per player group per season (holds the group's goal)

// Key used in sessionStorage to remember a correct PIN entry.
// sessionStorage survives page navigation (e.g. map view and back)
// but is cleared when the browser tab is closed.
const PIN_SESSION_KEY = "ttr_pin_ok";

// Pool of train-themed names randomly assigned to each saved game,
// so history entries read like "Kevin won 'The Midnight Express'"
// instead of just a bare date.
const GAME_NAMES = [
    "The Midnight Express", "The Great Route Heist", "Iron Horse Gambit",
    "The Last Spike", "Boxcar Bonanza", "The Whistle-Stop Sprint",
    "Tunnel Vision", "The Ticket Heist", "Rail Baron's Revenge",
    "The Grand Junction", "Steel Wheels Sprint", "The Overnight Express",
    "The Freight Frenzy", "Depot Duel", "The Long Haul",
    "Switchback Showdown", "The Golden Spike Gambit", "The Scenic Route Scramble",
    "All Aboard Ambush", "The Caboose Comeback", "The Sleeper Car Shuffle",
    "Trans-Continental Tussle", "The Coal Car Clash", "Signal Box Standoff",
    "The Platform Standoff", "Junction Jitters", "The Timetable Tangle",
    "Derailed Ambitions", "The Silver Rail Showdown", "Track Record",
    "The Cross-Country Clash", "Full Steam Ahead", "The Branch Line Brawl",
    "Coupling Chaos", "The Terminus Tangle", "Night Train Nerves",
    "The Locomotion Duel", "Rails and Rivals", "The Border Crossing",
    "Whistle Blown"
];

function pickGameName() {
    return GAME_NAMES[Math.floor(Math.random() * GAME_NAMES.length)];
}

// Returns the name(s) of the top scorer(s) in a single game, joined
// with " & " in the (rare) case of a tie.
function gameWinner(game) {
    const entries = Object.entries(game.scores);
    const top     = Math.max(...entries.map(([, pts]) => pts));
    return entries.filter(([, pts]) => pts === top).map(([name]) => name).join(" & ");
}

// =====================================================
// APP STATE — single source of truth
// =====================================================
const state = {
    config:        null,   // { pin, goal (default for new groups), players[], season }
    games:         [],     // all game docs from Firestore for current season
    groups:        [],     // all group docs (goal per player group) for current season
    authenticated: false
};

// =====================================================
// STARTUP
// Called once when the page loads
// =====================================================
async function init() {
    showScreen("screen-loading");

    // Anonymous sign-in is required to read/write Firestore
    try {
        await signInAnonymously(auth);
    } catch (err) {
        alert("Could not connect to the database. Please check your internet connection and try again.");
        return;
    }

    // Check whether first-time setup has been completed
    const configSnap = await getDoc(doc(db, COL_CONFIG, "config"));

    if (!configSnap.exists()) {
        // No config found — show setup wizard
        showScreen("screen-setup");
        renderSetupPlayers();
    } else {
        state.config = configSnap.data();

        // Skip the PIN screen if it was already entered correctly
        // in this browser session (e.g. coming back from the map view)
        if (sessionStorage.getItem(PIN_SESSION_KEY) === String(state.config.pin)) {
            state.authenticated = true;
            enterMainApp();
        } else {
            showScreen("screen-pin");
            setupPinInputs();
        }
    }
}

// =====================================================
// SCREEN MANAGEMENT
// Only one screen visible at a time
// =====================================================
function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

// =====================================================
// PIN SCREEN
// =====================================================

// Wires up the 4 digit inputs: auto-advance, backspace, auto-submit
function setupPinInputs() {
    const digits = [...document.querySelectorAll(".pin-digit")];

    digits.forEach((input, i) => {
        input.addEventListener("focus", () => { input.value = ""; });

        input.addEventListener("input", () => {
            // Keep only the last character typed
            if (input.value.length > 1) input.value = input.value.slice(-1);
            // Advance to next box
            if (input.value && i < digits.length - 1) digits[i + 1].focus();
            // Auto-submit when the last box is filled
            if (i === digits.length - 1 && input.value) checkPin();
        });

        input.addEventListener("keydown", e => {
            // Backspace on empty box goes back to previous
            if (e.key === "Backspace" && !input.value && i > 0) digits[i - 1].focus();
        });
    });

    digits[0].focus();
}

// Compares entered PIN against stored value
function checkPin() {
    const digits  = [...document.querySelectorAll(".pin-digit")];
    const entered = digits.map(d => d.value).join("");
    const error   = document.getElementById("pin-error");

    if (entered === String(state.config.pin)) {
        state.authenticated = true;
        // Remember the PIN for this browser session so navigating
        // away (e.g. to the map) and back doesn't ask for it again.
        // Storing the PIN value (not just a flag) means a PIN change
        // in Settings automatically invalidates old sessions.
        sessionStorage.setItem(PIN_SESSION_KEY, entered);
        error.classList.add("hidden");
        enterMainApp();
    } else {
        error.classList.remove("hidden");
        digits.forEach(d => { d.value = ""; });
        digits[0].focus();
    }
}

// =====================================================
// MAIN APP
// =====================================================

function enterMainApp() {
    showScreen("screen-main");
    updateGoalDisplay();
    listenToGroups();  // real-time listener for per-group goals
    listenToGames();   // real-time listener for game results
}

// Updates the default goal number shown in the banner
// (this is the goal offered to NEW groups; each group has its own)
function updateGoalDisplay() {
    document.getElementById("goal-display").textContent =
        Number(state.config.goal).toLocaleString() + " pts";
}

// =====================================================
// FIRST-TIME SETUP
// =====================================================

let setupPlayers = [];

// Renders the player tag chips in the setup form
function renderSetupPlayers() {
    document.getElementById("setup-players-list").innerHTML =
        setupPlayers.map((p, i) =>
            `<span class="player-tag">${p}
             <button onclick="removeSetupPlayer(${i})" aria-label="Remove ${p}">×</button>
             </span>`
        ).join("");
}

function addSetupPlayer() {
    const input = document.getElementById("setup-player-input");
    const name  = input.value.trim();
    if (!name) return;
    if (setupPlayers.includes(name))  { alert("That player is already in the list."); return; }
    setupPlayers.push(name);
    input.value = "";
    renderSetupPlayers();
}

function removeSetupPlayer(index) {
    setupPlayers.splice(index, 1);
    renderSetupPlayers();
}

// Validates setup form and saves config to Firestore
async function saveSetup() {
    const pin  = document.getElementById("setup-pin").value.trim();
    const goal = parseInt(document.getElementById("setup-goal").value) || 1000;

    if (!pin || pin.length !== 4 || isNaN(pin))  { alert("Please enter a 4-digit PIN."); return; }
    if (setupPlayers.length < 2)                  { alert("Please add at least 2 players."); return; }

    const config = { pin, goal, players: setupPlayers, season: 0 };
    await setDoc(doc(db, COL_CONFIG, "config"), config);

    state.config        = config;
    state.authenticated = true;
    enterMainApp();
}

// =====================================================
// GROUP GOALS
// Each player group has its own season goal, stored as
// one document per group per season in COL_GROUPS.
// =====================================================

// Finds the group doc for a groupKey in the current season
// Returns undefined if this group hasn't set a goal yet
function findGroup(groupKey) {
    return state.groups.find(g => g.groupKey === groupKey);
}

// Returns the goal for a group.
// Groups created before this feature have no group doc,
// so they fall back to the global default goal in config.
function groupGoal(groupKey) {
    const group = findGroup(groupKey);
    return group ? Number(group.goal) : Number(state.config.goal);
}

// True once the first groups snapshot has arrived.
// Prevents checkForWinners() running against fallback goals
// before the real per-group goals have loaded.
let groupsLoaded = false;

// Real-time listener that keeps state.groups in sync
function listenToGroups() {
    onSnapshot(collection(db, COL_GROUPS), snap => {
        const currentSeason = state.config.season ?? 0;
        state.groups = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(g => (g.season ?? 0) === currentSeason);
        groupsLoaded = true;
        renderGroups();
    });
}

// =====================================================
// ADD GAME MODAL
// =====================================================

function openAddGame() {
    const modal = document.getElementById("modal-add-game");
    modal.classList.remove("hidden");

    // Default to today's date
    document.getElementById("game-date").value = todayISO();

    // Render one checkbox per player
    document.getElementById("game-player-checkboxes").innerHTML =
        state.config.players.map(p =>
            `<div class="player-check-item">
               <input type="checkbox" id="chk-${p}" value="${p}" onchange="updateScoreInputs()">
               <label for="chk-${p}">${p}</label>
             </div>`
        ).join("");

    document.getElementById("game-score-inputs").innerHTML = "";

    // Reset the new-group goal field (hidden until a new combo is picked)
    document.getElementById("game-goal").value = state.config.goal;
    document.getElementById("game-goal-section").classList.add("hidden");
}

function closeAddGame() {
    document.getElementById("modal-add-game").classList.add("hidden");
}

// Renders a score input for each checked player
function updateScoreInputs() {
    const checked   = checkedPlayers();
    const container = document.getElementById("game-score-inputs");

    if (checked.length === 0) { container.innerHTML = ""; }
    else {
        container.innerHTML =
            `<p class="score-section-label">Enter final scores</p>` +
            checked.map(p =>
                `<div class="score-row">
                   <label for="score-${p}">${p}</label>
                   <input type="number" id="score-${p}" placeholder="0" min="0" inputmode="numeric">
                 </div>`
            ).join("");
    }

    updateGoalInput();
}

// Shows the season-goal field only when the selected players
// are a NEW group (no goal stored yet for this season)
function updateGoalInput() {
    const checked = checkedPlayers();
    const section = document.getElementById("game-goal-section");
    const isNewGroup =
        checked.length >= 2 &&
        !findGroup([...checked].sort().join(","));

    section.classList.toggle("hidden", !isNewGroup);
}

// Returns names of currently checked players
function checkedPlayers() {
    return [...document.querySelectorAll("#game-player-checkboxes input:checked")]
        .map(cb => cb.value);
}

// Validates inputs and saves the game to Firestore
async function submitGame() {
    const players = checkedPlayers();
    if (players.length < 2) { alert("Select at least 2 players."); return; }

    const scores = {};
    for (const p of players) {
        const val = parseInt(document.getElementById(`score-${p}`).value);
        if (isNaN(val) || val < 0) { alert(`Enter a valid score for ${p}.`); return; }
        scores[p] = val;
    }

    const date     = document.getElementById("game-date").value || todayISO();
    // groupKey is a sorted comma-separated player list — used to identify unique groups
    const groupKey = [...players].sort().join(",");

    // First game for this group this season? Save their chosen goal first.
    let goalVal = null;
    if (!findGroup(groupKey)) {
        goalVal = parseInt(document.getElementById("game-goal").value);
        if (isNaN(goalVal) || goalVal < 1) {
            alert("Enter a valid season goal for this new group.");
            return;
        }
    }

    // Disable the button and show progress so a slow/failed save is never
    // silently invisible to the user (previously an error here just left
    // the modal sitting there with no feedback at all).
    const saveBtn = document.getElementById("btn-save-game");
    saveBtn.disabled    = true;
    saveBtn.textContent = "Saving…";

    try {
        if (goalVal !== null) {
            await addDoc(collection(db, COL_GROUPS), {
                groupKey,
                goal:      goalVal,
                season:    state.config.season ?? 0,
                createdAt: serverTimestamp()
            });
        }

        await addDoc(collection(db, COL_GAMES), {
            date,
            players,
            scores,
            groupKey,
            gameName: pickGameName(),
            season: state.config.season ?? 0,
            createdAt: serverTimestamp()
        });

        closeAddGame();
    } catch (err) {
        console.error("Failed to save game:", err);
        alert("Could not save this game — check your internet connection and try again.\n\n" + err.message);
    } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = "Save Result";
    }
}

// =====================================================
// REAL-TIME GAMES LISTENER
// Firestore triggers this whenever game data changes
// =====================================================
function listenToGames() {
    const q = query(collection(db, COL_GAMES), orderBy("date", "asc"));

    onSnapshot(q, snap => {
        // Only show games from the current season number
        const currentSeason = state.config.season ?? 0;
        state.games = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(g => (g.season ?? 0) === currentSeason);

        renderGroups();
    });
}

// =====================================================
// RENDER GROUPS & LEADERBOARDS
// =====================================================

function renderGroups() {
    const container = document.getElementById("groups-container");

    if (state.games.length === 0) {
        container.innerHTML =
            `<div class="empty-state"><p>🚂 No games yet — add your first result!</p></div>`;
        return;
    }

    // Bucket games by groupKey
    const groups = {};
    state.games.forEach(game => {
        if (!groups[game.groupKey]) groups[game.groupKey] = [];
        groups[game.groupKey].push(game);
    });

    container.innerHTML = Object.entries(groups)
        .map(([groupKey, games]) => renderGroupSection(groupKey, games))
        .join("");

    checkForWinners();
}

// Builds the HTML for one group card (header + leaderboard + history)
function renderGroupSection(groupKey, games) {
    const players = groupKey.split(",");
    const totals  = calcTotals(players, games);
    const sorted  = [...totals].sort((a, b) => b.total - a.total);
    const goal    = groupGoal(groupKey);   // each group has its own goal
    const count   = games.length;

    const rows = sorted.map((entry, i) => renderRow(entry, i, goal)).join("");
    const hist = renderHistory(games);

    // JSON.stringify safely escapes the groupKey so player names with
    // special characters don't break the onclick attribute
    const escapedKey = JSON.stringify(groupKey);

    return `
        <div class="group-section">
          <div class="group-header">
            <span class="group-title">🚂 ${players.join("  ·  ")}</span>
            <div class="group-header-right">
              <span class="group-goal">🏆 ${goal.toLocaleString()}</span>
              <span class="group-count">${count} game${count !== 1 ? "s" : ""}</span>
              <button class="btn-group-reset"
                      onclick='resetGroup(${escapedKey})'
                      title="Reset group scores"
                      aria-label="Reset scores for ${players.join(" and ")}">🗑</button>
            </div>
          </div>
          <div class="leaderboard">${rows}</div>
          <button class="history-toggle" onclick="toggleHistory(this)">
            <span>Game History</span>
            <span class="history-arrow">▼</span>
          </button>
          <div class="history-list">${hist}</div>
        </div>`;
}

// Sums each player's scores across a list of games
function calcTotals(players, games) {
    const map = {};
    players.forEach(p => { map[p] = 0; });
    games.forEach(game =>
        Object.entries(game.scores).forEach(([p, pts]) => {
            if (p in map) map[p] += pts;
        })
    );
    return Object.entries(map).map(([name, total]) => ({ name, total }));
}

// Renders one leaderboard row
function renderRow(entry, index, goal) {
    const rank     = index + 1;
    const medal    = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
    const pct      = Math.min((entry.total / goal) * 100, 100).toFixed(1);
    const isFirst  = index === 0;

    return `
        <div class="leaderboard-row ${isFirst ? "rank-1" : ""}">
          <div class="row-rank ${isFirst ? "gold" : ""}">${medal}</div>
          <div class="row-name">${entry.name}</div>
          <div class="row-progress">
            <div class="progress-track">
              <div class="progress-fill" style="width: ${pct}%"></div>
            </div>
          </div>
          <div class="row-score">${entry.total.toLocaleString()}</div>
        </div>`;
}

// Renders game history list (newest first), each with a delete button
function renderHistory(games) {
    return [...games].reverse().map(game => {
        const chips = Object.entries(game.scores)
            .sort((a, b) => b[1] - a[1])
            .map(([name, pts]) => `<span class="score-chip">${name}: ${pts}</span>`)
            .join("");
        // Older games saved before this feature don't have a gameName.
        const winnerLine = game.gameName
            ? `<div class="history-winner">🏆 <strong>${gameWinner(game)}</strong> in the lead — “${game.gameName}”</div>`
            : "";
        return `
            <div class="history-game">
              ${winnerLine}
              <div class="history-row">
                <span class="history-date">${formatDate(game.date)}</span>
                ${chips}
                <button class="btn-delete-game"
                        onclick="deleteGame('${game.id}')"
                        title="Delete this game"
                        aria-label="Delete game from ${formatDate(game.date)}">✕</button>
              </div>
            </div>`;
    }).join("");
}

// Deletes ONE game document after confirmation.
// Each game is its own Firestore doc, so nothing else is affected;
// the live listener re-renders totals automatically.
async function deleteGame(id) {
    const game = state.games.find(g => g.id === id);
    if (!game) return;

    const summary = Object.entries(game.scores)
        .map(([name, pts]) => `${name}: ${pts}`)
        .join(", ");

    const confirmed = confirm(
        `Delete this game?\n\n${formatDate(game.date)} — ${summary}\n\n` +
        "This cannot be undone."
    );
    if (!confirmed) return;

    await deleteDoc(doc(db, COL_GAMES, id));
}

// Toggles the history panel open/closed
function toggleHistory(btn) {
    const panel = btn.nextElementSibling;
    const arrow = btn.querySelector(".history-arrow");
    panel.classList.toggle("open");
    arrow.classList.toggle("open");
}

// =====================================================
// WINNER DETECTION & CELEBRATION
// =====================================================

// Checks each group separately against that group's own goal.
// (Previously all groups were merged, so a player in two groups
// could "win" without any single group reaching its goal.)
function checkForWinners() {
    // Wait until real per-group goals have loaded (see groupsLoaded)
    if (!groupsLoaded) return;

    // Track who we've already celebrated this session so it doesn't
    // re-fire. Stored as a JSON array of "groupKey|player" strings.
    const celebrated = JSON.parse(sessionStorage.getItem("ttr_celebrated") || "[]");

    // Bucket games by group, same as the scoreboard does
    const groups = {};
    state.games.forEach(game => {
        if (!groups[game.groupKey]) groups[game.groupKey] = [];
        groups[game.groupKey].push(game);
    });

    Object.entries(groups).forEach(([groupKey, games]) => {
        const goal   = groupGoal(groupKey);
        const totals = calcTotals(groupKey.split(","), games);

        totals.forEach(({ name, total }) => {
            const celebrationKey = `${groupKey}|${name}`;
            if (total >= goal && !celebrated.includes(celebrationKey)) {
                celebrated.push(celebrationKey);
                sessionStorage.setItem("ttr_celebrated", JSON.stringify(celebrated));
                showCelebration(name, total);
            }
        });
    });
}

function showCelebration(name, total) {
    document.getElementById("winner-name").textContent    = name;
    document.getElementById("winner-message").textContent =
        `reached ${total.toLocaleString()} points — Season Champion! 🎉`;
    document.getElementById("celebration").classList.remove("hidden");
    startConfetti();
}

function closeCelebration() {
    document.getElementById("celebration").classList.add("hidden");
    stopConfetti();
}

// =====================================================
// CONFETTI ANIMATION
// Simple canvas-based coloured rectangles
// =====================================================
const CONFETTI_COLOURS = ["#c0392b", "#d4a017", "#1b2a4a", "#fff8e7", "#f0c040", "#ffffff"];
let confettiId         = null;
let particles          = [];

function startConfetti() {
    const canvas = document.getElementById("confetti-canvas");
    const ctx    = canvas.getContext("2d");
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    particles = Array.from({ length: 160 }, () => ({
        x:     Math.random() * canvas.width,
        y:     Math.random() * -canvas.height,
        w:     Math.random() * 10 + 5,
        h:     Math.random() * 5  + 3,
        color: CONFETTI_COLOURS[Math.floor(Math.random() * CONFETTI_COLOURS.length)],
        speed: Math.random() * 3  + 2,
        drift: (Math.random() - 0.5) * 2,
        angle: Math.random() * Math.PI * 2,
        spin:  (Math.random() - 0.5) * 0.15
    }));

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.y     += p.speed;
            p.x     += p.drift;
            p.angle += p.spin;
            // Loop back to top when off-screen
            if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });
        confettiId = requestAnimationFrame(draw);
    }

    draw();
}

function stopConfetti() {
    if (confettiId) { cancelAnimationFrame(confettiId); confettiId = null; }
}

// =====================================================
// SETTINGS MODAL
// =====================================================

let settingsPlayers = [];

function openSettings() {
    document.getElementById("modal-settings").classList.remove("hidden");
    document.getElementById("settings-goal").value = state.config.goal;
    document.getElementById("settings-pin").value  = "";
    settingsPlayers = [...state.config.players];
    renderSettingsPlayers();
}

function closeSettings() {
    document.getElementById("modal-settings").classList.add("hidden");
}

function renderSettingsPlayers() {
    document.getElementById("settings-players-list").innerHTML =
        settingsPlayers.map((p, i) =>
            `<span class="player-tag">${p}
             <button onclick="removeSettingsPlayer(${i})" aria-label="Remove ${p}">×</button>
             </span>`
        ).join("");
}

function addSettingsPlayer() {
    const input = document.getElementById("settings-player-input");
    const name  = input.value.trim();
    if (!name) return;
    if (settingsPlayers.includes(name)) { alert("Player already exists."); return; }
    settingsPlayers.push(name);
    input.value = "";
    renderSettingsPlayers();
}

function removeSettingsPlayer(index) {
    settingsPlayers.splice(index, 1);
    renderSettingsPlayers();
}

// Saves updated settings to Firestore
async function saveSettings() {
    const goal   = parseInt(document.getElementById("settings-goal").value);
    const newPin = document.getElementById("settings-pin").value.trim();

    if (isNaN(goal) || goal < 1)    { alert("Enter a valid goal."); return; }
    if (settingsPlayers.length < 2) { alert("Keep at least 2 players."); return; }

    const updated = { ...state.config, goal, players: settingsPlayers };

    if (newPin) {
        if (newPin.length !== 4 || isNaN(newPin)) { alert("PIN must be exactly 4 digits."); return; }
        updated.pin = newPin;
    }

    await setDoc(doc(db, COL_CONFIG, "config"), updated);
    state.config = updated;
    updateGoalDisplay();
    closeSettings();
}

// =====================================================
// RESET ALL DATA
// Permanently deletes every game document from Firestore.
// Two-step confirmation to prevent accidental use.
// =====================================================
async function resetAllData() {
    // First warning
    const first = confirm(
        "⚠️ RESET ALL DATA\n\n" +
        "This will permanently delete every game result from the database.\n\n" +
        "Are you sure you want to continue?"
    );
    if (!first) return;

    // Second warning — requires typing RESET
    const second = prompt(
        "Last chance — this cannot be undone.\n\nType  RESET  to confirm:"
    );
    if (second === null || second.trim() !== "RESET") {
        alert("Reset cancelled.");
        return;
    }

    // Fetch and delete all game AND group documents
    // Firestore has no bulk delete — we delete each doc individually
    const gamesSnap  = await getDocs(collection(db, COL_GAMES));
    const groupsSnap = await getDocs(collection(db, COL_GROUPS));
    await Promise.all([
        ...gamesSnap.docs.map(d => deleteDoc(d.ref)),
        ...groupsSnap.docs.map(d => deleteDoc(d.ref))
    ]);

    // Clear the season start so nothing is filtered
    const updated = { ...state.config, seasonStart: null };
    await setDoc(doc(db, COL_CONFIG, "config"), updated);
    state.config = updated;

    sessionStorage.removeItem("ttr_celebrated");
    closeSettings();
    alert("All game data has been reset.");
}

// =====================================================
// RESET ONE GROUP
// Deletes all games for a single player group in the current season.
// The Firestore listener re-renders automatically once docs are removed.
// =====================================================
async function resetGroup(groupKey) {
    const groupGames = state.games.filter(g => g.groupKey === groupKey);
    const players    = groupKey.split(",").join(" · ");
    const count      = groupGames.length;

    const confirmed = confirm(
        `Reset scores for ${players}?\n\n` +
        `This will delete ${count} game${count !== 1 ? "s" : ""} for this group.\n\n` +
        "The group will set a fresh season goal on their next game.\n\n" +
        "This cannot be undone."
    );
    if (!confirmed) return;

    // Delete the group's games AND its goal doc, so the goal
    // is asked again when this group starts playing again
    const groupDoc = findGroup(groupKey);
    await Promise.all([
        ...groupGames.map(g => deleteDoc(doc(db, COL_GAMES, g.id))),
        ...(groupDoc ? [deleteDoc(doc(db, COL_GROUPS, groupDoc.id))] : [])
    ]);
}

// =====================================================
// NEW SEASON
// Records a seasonStart date in config.
// Games before that date are hidden from the scoreboard.
// Old data is never deleted from Firestore.
// =====================================================
async function newSeason() {
    const confirmed = confirm(
        "Start a new season?\n\n" +
        "The current scoreboard will reset. All previous game history " +
        "is safely kept in the database but won't appear on the board."
    );
    if (!confirmed) return;

    // Increment the season number — old games stay in Firestore but won't show
    const updated = { ...state.config, season: (state.config.season ?? 0) + 1 };
    await setDoc(doc(db, COL_CONFIG, "config"), updated);

    state.config = updated;
    sessionStorage.removeItem("ttr_celebrated");
    closeSettings();
    // Manually re-filter and re-render — the Firestore listener won't fire
    // on its own because no game documents changed, only the config did.
    // Groups are filtered too, so every group sets a fresh goal next season.
    const currentSeason = updated.season;
    state.games  = state.games.filter(g => (g.season ?? 0) === currentSeason);
    state.groups = state.groups.filter(g => (g.season ?? 0) === currentSeason);
    renderGroups();
}

// =====================================================
// UTILITIES
// =====================================================

// Returns today's date as "YYYY-MM-DD"
function todayISO() {
    return new Date().toISOString().split("T")[0];
}

// Formats "YYYY-MM-DD" as "12 Jun 2026"
function formatDate(str) {
    if (!str) return "";
    // Append T00:00:00 to avoid UTC off-by-one on some browsers
    const d = new Date(str + "T00:00:00");
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// =====================================================
// EXPOSE FUNCTIONS TO HTML onclick HANDLERS
// ES modules don't attach to window automatically
// =====================================================
window.checkPin             = checkPin;
window.addSetupPlayer       = addSetupPlayer;
window.removeSetupPlayer    = removeSetupPlayer;
window.saveSetup            = saveSetup;
window.openAddGame          = openAddGame;
window.closeAddGame         = closeAddGame;
window.updateScoreInputs    = updateScoreInputs;
window.submitGame           = submitGame;
window.deleteGame           = deleteGame;
window.toggleHistory        = toggleHistory;
window.closeCelebration     = closeCelebration;
window.openSettings         = openSettings;
window.closeSettings        = closeSettings;
window.addSettingsPlayer    = addSettingsPlayer;
window.removeSettingsPlayer = removeSettingsPlayer;
window.saveSettings         = saveSettings;
window.newSeason            = newSeason;
window.resetAllData         = resetAllData;
window.resetGroup           = resetGroup;

// =====================================================
// BOOT
// =====================================================
init();
