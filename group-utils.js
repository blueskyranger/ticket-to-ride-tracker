// =====================================================
// GROUP UTILS — shared bucketing logic
// Used by BOTH app.js (scoreboard) and map-firebase.js (season map)
// so the two can't drift apart. They drifting apart is exactly how
// the map ended up merging two same-roster groups together.
// =====================================================

// The bucket key a given game belongs on the scoreboard/map under:
//   - games saved with named groups carry their group's own Firestore
//     doc id (groupId)
//   - older games saved before groups had ids fall back to groupKey
//     (the sorted player list they were saved with)
export function bucketKeyFor(game) {
    return game.groupId || game.groupKey;
}

// Finds the matching group doc for a bucket key, out of a list of
// group docs (each shaped like { id, groupKey, name?, goal, ... }).
// New-style bucket keys are a group's own Firestore id — exact match.
// Legacy bucket keys (a raw groupKey string) only match against groups
// saved under the OLD schema (no `name` field at all) — otherwise,
// once a named group shares a roster with a legacy group, this could
// resolve to the wrong one.
export function findGroupByBucketKey(groups, bucketKey) {
    const byId = groups.find(g => g.id === bucketKey);
    if (byId) return byId;
    return groups.find(g => g.groupKey === bucketKey && g.name === undefined);
}

// The label for a group: its chosen name, or the player list if it
// was never named (or predates named groups).
export function groupDisplayName(group, players) {
    return (group && group.name) ? group.name : players.join("  ·  ");
}
