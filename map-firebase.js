// =====================================================
// MAP FIREBASE — shared data-fetching module
// Imported by map.html, map-3.html, map-4.html, map-5.html
// =====================================================

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, signInAnonymously }      from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
    getFirestore,
    doc, getDoc,
    collection, getDocs,
    query, orderBy,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey:            "AIzaSyAwyzLorHfENmCOVr3B1q4FhUn7sI565cI",
    authDomain:        "hrb-cleaning-v2.firebaseapp.com",
    projectId:         "hrb-cleaning-v2",
    storageBucket:     "hrb-cleaning-v2.firebasestorage.app",
    messagingSenderId: "30392652789",
    appId:             "1:30392652789:web:e4c0fc5202299cc4df46bc"
};

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

const COL_CONFIG = "ttr_config";
const COL_GAMES  = "ttr_games";

// Shared helper: sign in + fetch config + fetch season games
async function loadBase() {
    await signInAnonymously(auth);
    const configSnap = await getDoc(doc(db, COL_CONFIG, "config"));
    if (!configSnap.exists()) return null;
    const config = configSnap.data();
    const season = config.season ?? 0;
    const snap   = await getDocs(query(collection(db, COL_GAMES), orderBy("date", "asc")));
    const games  = snap.docs.map(d => d.data()).filter(g => (g.season ?? 0) === season);
    return { config, games };
}

// Returns all active groups in the current season with their player lists and game counts.
// Used by map.html to build the group-selection screen.
export async function fetchGroups() {
    const base = await loadBase();
    if (!base) return { groups: [], goal: 1000 };

    const { config, games } = base;
    const groupMap = {};
    games.forEach(g => {
        if (!groupMap[g.groupKey]) {
            groupMap[g.groupKey] = {
                groupKey:  g.groupKey,
                players:   g.groupKey.split(','),
                gameCount: 0,
            };
        }
        groupMap[g.groupKey].gameCount++;
    });

    return {
        groups: Object.values(groupMap),
        goal:   Number(config.goal),
    };
}

// Fetches scores for a specific group (by groupKey) or for all registered players
// if no groupKey is provided.
// Returns { players: [{name, pts}, ...], goal } or null if no config exists.
export async function fetchMapData(groupKey = null) {
    const base = await loadBase();
    if (!base) return null;

    const { config, games } = base;

    // Scope the player list and games to the chosen group, or use all registered players
    const playerList    = groupKey ? groupKey.split(',') : config.players;
    const relevantGames = groupKey
        ? games.filter(g => g.groupKey === groupKey)
        : games;

    const totals = {};
    playerList.forEach(p => { totals[p] = 0; });
    relevantGames.forEach(game =>
        Object.entries(game.scores).forEach(([p, pts]) => {
            if (p in totals) totals[p] += pts;
        })
    );

    return {
        players: playerList.map(name => ({ name, pts: totals[name] })),
        goal:    Number(config.goal),
    };
}
