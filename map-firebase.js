// =====================================================
// MAP FIREBASE — shared data-fetching module
// Imported by map.html, map-3.html, map-4.html, map-5.html
// Reads player names and season totals directly from Firestore
// so the map always reflects live data on any device.
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

// Reuse existing Firebase app instance if one is already initialised on this page
const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

const COL_CONFIG = "ttr_config";
const COL_GAMES  = "ttr_games";

// Fetches the current season's player list and total scores from Firestore.
// Returns { players: [{name, pts}, ...], goal } or null if no config exists yet.
export async function fetchMapData() {
    await signInAnonymously(auth);

    const configSnap = await getDoc(doc(db, COL_CONFIG, "config"));
    if (!configSnap.exists()) return null;

    const { players, goal, season = 0 } = configSnap.data();

    // Pull all games then filter to the current season in memory
    // (avoids needing a composite Firestore index)
    const snap  = await getDocs(query(collection(db, COL_GAMES), orderBy("date", "asc")));
    const games = snap.docs
        .map(d => d.data())
        .filter(g => (g.season ?? 0) === season);

    // Tally each registered player's season total
    const totals = {};
    players.forEach(p => { totals[p] = 0; });
    games.forEach(game =>
        Object.entries(game.scores).forEach(([p, pts]) => {
            if (p in totals) totals[p] += pts;
        })
    );

    return {
        players: players.map(name => ({ name, pts: totals[name] })),
        goal:    Number(goal),
    };
}
