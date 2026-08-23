# Improvements: native app store release

Notes from a planning discussion (2026-08-23) about turning this from a
personal-use static site into a commercial iOS/Android app. Nothing here
is implemented yet — this is a record of decisions and open questions for
when this work actually gets picked up.

## Goal

Long term: publish on the Apple App Store and Google Play Store. Free to
use, with a paid unlock for power users (see Monetization below).

## Current state (why this is a bigger change than it sounds)

- Static HTML/CSS/vanilla-JS site, no build step, no bundler, no
  `package.json`. `app.js`/`map.js` are loaded as ES modules directly.
- Single shared Firestore project, single `config` doc (`ttr_config`)
  holding one player roster, one 4-digit PIN, one season goal.
- The PIN check is entirely client-side (`checkPin()` in `app.js`) — no
  server-side enforcement. There's no `firestore.rules` file committed to
  this repo, so whatever rules exist live only in the Firebase console.
- The existing "groups" concept (`ttr_groups` collection) is **not** a
  tenant/household boundary — it's just games auto-bucketed by which
  subset of the one shared roster played together. Everyone with the PIN
  sees every player and every group's scores today.
- Everyone authenticates via Firebase anonymous auth — fine for a single
  household, not a basis for real multi-tenant isolation.

## Decisions made

1. **Packaging: Capacitor.** Wrap the existing HTML/CSS/JS in a native
   shell rather than rewriting in React Native/Flutter. Produces a real
   Xcode project (iOS) and Gradle project (Android) that can be submitted
   to both stores like any native app — reuses the current codebase
   almost as-is.

2. **Distribution accounts needed:**
   - Apple Developer Program — $99/year (required for any persistent iOS
     distribution, not just public listing; TestFlight also needs this).
   - Google Play Console — $25 one-time.

3. **Multi-tenancy / isolation model: one shared Firebase project, real
   per-group data isolation.** Every document tagged with a `groupId`;
   Firestore security rules enforce that a user can only read/write their
   own group's data. (Rejected: a separate Firebase project per group —
   doesn't scale, requires manual setup per customer.)

4. **Monetization: freemium, one-time purchase, no trial.**
   - Free forever: 1 group, unlimited players in that group.
   - $9.99 one-time in-app purchase: unlocks additional groups on the
     same account (e.g. tracking a family's games *and* a separate
     friend group).
   - Rejected: 30-day trial then paywall (awkward for infrequent/casual
     play; requires account-tied trial-clock enforcement to prevent
     reinstall abuse). Rejected: capping free tier by *player count*
     (would immediately hit normal-sized groups — this project's own
     group already has 6 players — and reintroduces the player cap we
     just fixed as a bug, now as a paywall, which risks feeling like a
     bait-and-switch).
   - Purchases must go through Apple's/Google's in-app purchase systems
     (App Store Review Guideline 3.1.1 and Google's equivalent) — can't
     use Stripe or similar directly for unlocking in-app features.
   - **RevenueCat** to sit on top of StoreKit/Google Play Billing:
     handles receipt validation, restores, and cross-platform sync;
     maintained Capacitor plugin available; free up to $2.5k/mo tracked
     revenue. Webhooks flip a `purchased`/entitlement flag on the
     account's record in Firestore.

## Open question (unresolved)

**Auth model for group members.** Proposed split, not yet confirmed:

- **Group owner** (the person who'd make the purchase): real Firebase
  Auth login — Sign in with Apple + Sign in with Google. Needs to
  persist across reinstalls/new devices so RevenueCat can restore their
  purchase and they don't lose ownership of their group. (Apple
  effectively requires offering Sign in with Apple if any other
  third-party login is offered — App Store Guideline 4.8.)
- **Other group members** (casual family players): join via a per-group
  join code, signed in anonymously (as today), added to the group's
  `members` list via a Cloud Function. Lower friction, but their
  identity resets if they uninstall/reinstall — would need to re-enter
  the join code.
- Alternative considered: give every member a real login too, for
  consistency, at the cost of onboarding friction for casual/non-technical
  players (kids, grandparents).

## Follow-up work implied by the above (not yet scoped)

- Design the actual Firestore schema/security rules for `groupId`-scoped
  collections, replacing the single shared `ttr_config` doc.
  Write and commit an actual `firestore.rules` file (none exists today).
- Build the group-creation / join-code / membership Cloud Function(s).
- Wire up Firebase Auth (Apple + Google sign-in) in the Capacitor shell.
- Integrate RevenueCat, define the actual IAP product(s) in App Store
  Connect and Google Play Console.
- Decide what happens to existing production data (single shared
  config/games/groups collections) when migrating to the multi-tenant
  schema.
- App icons, splash screen, and other store-listing assets — none exist
  in this repo currently.
