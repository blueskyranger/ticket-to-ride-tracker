// =====================================================
// MAP FIREBASE — shared data-fetching module
// Imported by map.html, map-3.html, map-4.html, map-5.html
// =====================================================

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, signInAnonymously }      from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
    getFirestore,
    doc, getDoc, setDoc,
    collection, getDocs,
    query, orderBy,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { bucketKeyFor, findGroupByBucketKey } from "./group-utils.js";

const firebaseConfig = {
    apiKey:            "AIzaSyBIRumuNvUAAHz4-idXDMia7-OVY4_9UeY",
    authDomain:        "ticket-to-ride-tracker-3072f.firebaseapp.com",
    projectId:         "ticket-to-ride-tracker-3072f",
    storageBucket:     "ticket-to-ride-tracker-3072f.firebasestorage.app",
    messagingSenderId: "967305312959",
    appId:             "1:967305312959:web:e2b4c63ae4998d269ea40a"
};

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

const COL_CONFIG = "ttr_config";
const COL_GAMES  = "ttr_games";
const COL_GROUPS = "ttr_groups";

// Shared helper: sign in + fetch config + fetch season games + fetch season groups
async function loadBase() {
    await signInAnonymously(auth);
    const configSnap = await getDoc(doc(db, COL_CONFIG, "config"));
    if (!configSnap.exists()) return null;
    const config = configSnap.data();
    const season = config.season ?? 0;

    const gamesSnap  = await getDocs(query(collection(db, COL_GAMES), orderBy("date", "asc")));
    const games      = gamesSnap.docs.map(d => d.data()).filter(g => (g.season ?? 0) === season);

    const groupsSnap = await getDocs(collection(db, COL_GROUPS));
    const groups     = groupsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(g => (g.season ?? 0) === season);

    return { config, games, groups };
}

// Returns all active groups in the current season with their player lists,
// game counts, and names. Used by map.html to build the group-selection screen.
export async function fetchGroups() {
    const base = await loadBase();
    if (!base) return { groups: [] };
    const { games, groups } = base;

    // Bucket games the same way the main scoreboard does (see group-utils.js)
    // so two groups sharing a roster show up as two separate entries here,
    // not merged into one.
    const buckets = {};
    games.forEach(game => {
        const key = bucketKeyFor(game);
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(game);
    });

    const result = Object.entries(buckets).map(([bucketKey, bucketGames]) => {
        const group = findGroupByBucketKey(groups, bucketKey);
        return {
            bucketKey,
            players:   bucketGames[0].groupKey.split(","),
            name:      (group && group.name) ? group.name : null,
            gameCount: bucketGames.length,
        };
    });

    // Only groups the map pages support (3–5 players)
    return { groups: result.filter(g => g.players.length >= 3 && g.players.length <= 5) };
}

// Fetches scores for a specific group (by bucket key — see group-utils.js)
// or for all registered players if no bucket key is provided (used by the
// map-3/4/5 fallback flow before any groups exist).
export async function fetchMapData(bucketKey = null) {
    const base = await loadBase();
    if (!base) return null;
    const { config, games, groups } = base;

    if (!bucketKey) {
        const totals = {};
        config.players.forEach(p => { totals[p] = 0; });
        games.forEach(game =>
            Object.entries(game.scores).forEach(([p, pts]) => { if (p in totals) totals[p] += pts; })
        );
        return {
            players:      config.players.map(name => ({ name, pts: totals[name] })),
            goal:         Number(config.goal),
            groupId:      null,
            groupName:    null,
            mapRoutes:    null,
            mapColours:   null,
            orderedGames: [],
        };
    }

    const group          = findGroupByBucketKey(groups, bucketKey);
    const relevantGames  = games
        .filter(g => bucketKeyFor(g) === bucketKey)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const playerList = relevantGames.length ? relevantGames[0].groupKey.split(",") : bucketKey.split(",");
    const totals = {};
    playerList.forEach(p => { totals[p] = 0; });
    relevantGames.forEach(game =>
        Object.entries(game.scores).forEach(([p, pts]) => { if (p in totals) totals[p] += pts; })
    );

    return {
        players:      playerList.map(name => ({ name, pts: totals[name] })),
        goal:         group ? Number(group.goal) : Number(config.goal),
        groupId:      group ? group.id : null,
        groupName:    (group && group.name) ? group.name : null,
        mapRoutes:    (group && group.mapRoutes)  || null,
        mapColours:   (group && group.mapColours) || null,
        orderedGames: relevantGames,
    };
}

// Persists the map's route and/or colour assignment onto the group's own
// Firestore doc, so the same journey (and colour choices) show up again
// next time anyone opens this group's map, instead of re-randomizing.
export async function saveGroupMapSettings(groupId, { routes, colours } = {}) {
    if (!groupId) return;
    const updates = {};
    if (routes)  updates.mapRoutes  = routes;
    if (colours) updates.mapColours = colours;
    if (Object.keys(updates).length === 0) return;
    await setDoc(doc(db, COL_GROUPS, groupId), updates, { merge: true });
}
