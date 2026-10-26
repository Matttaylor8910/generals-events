'use strict';

// Unit tests for ../firestore.rules. Run with `npm test` in this folder, which
// starts the Firestore emulator and runs this file against it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  setLogLevel,
  updateDoc,
  where,
  writeBatch,
} = require('firebase/firestore');

const PROJECT_ID = 'generals-tournaments-rules-test';
const EVENT = 'Test-Event';
const ARENA = {
  name: 'Test Event',
  format: 'Arena',
  type: 'FFA',
  visibility: 'Public',
  startTime: 1,
  endTime: 2,
  playerCount: 0,
  replays: [],
  winners: [],
  queue: [],
  checkedInPlayers: [],
  options: {},
  chatBlocklist: ['troll'],
};

function newPlayer(name) {
  return {name, rank: 0, points: 0, currentStreak: 0, dq: false, record: []};
}

// a context may only create its Firestore instance once, so cache them
const instances = new WeakMap();
function db(ctx) {
  if (!instances.has(ctx)) instances.set(ctx, ctx.firestore());
  return instances.get(ctx);
}

describe('firestore.rules', function () {
  let env;
  let anon;    // not logged in
  let alice;   // a regular player
  let bob;     // another regular player
  let admin;   // an event organizer, listed in generals.io/admins

  function eventDoc(ctx) { return doc(db(ctx), 'events', EVENT); }
  function playerDoc(ctx, name) { return doc(db(ctx), 'events', EVENT, 'players', name); }
  function messages(ctx) { return collection(db(ctx), 'events', EVENT, 'messages'); }
  function redirectDoc(ctx, id) { return doc(db(ctx), 'events', EVENT, 'redirect', id); }

  before(async function () {
    setLogLevel('error');
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')},
    });
    anon = env.unauthenticatedContext();
    alice = env.authenticatedContext('alice', {username: 'alice'});
    bob = env.authenticatedContext('bob', {username: 'bob'});
    admin = env.authenticatedContext('matt', {username: 'matt'});
  });

  after(async function () {
    await env.cleanup();
  });

  beforeEach(async function () {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'events', EVENT), ARENA);
      await setDoc(doc(db, 'events', EVENT, 'players', 'alice'), newPlayer('alice'));
      await setDoc(doc(db, 'events', EVENT, 'players', 'bob'), newPlayer('bob'));
      await setDoc(doc(db, 'events', EVENT, 'players', 'cheater'), {...newPlayer('cheater'), dq: true});
      await setDoc(doc(db, 'generals.io', 'homepage'), {
        eventInfo: {eventId: EVENT},
        seasonEndEvent: {season: 1, qualified: ['alice'], remindLater: [], notInterested: []},
      });
      await setDoc(doc(db, 'generals.io', 'admins'), {names: ['matt']});
      await setDoc(doc(db, 'players', 'alice'), {status: 'LOADED', totalGames: 1});
    });
  });

  describe('events', function () {
    it('anyone can read events', async function () {
      await assertSucceeds(getDoc(eventDoc(anon)));
      await assertSucceeds(getDocs(query(collection(db(anon), 'events'), where('startTime', '>', 0))));
    });

    it('only admins create and delete events', async function () {
      await assertFails(setDoc(doc(db(anon), 'events', 'Anon-Event'), ARENA));
      await assertFails(setDoc(doc(db(alice), 'events', 'Alice-Event'), ARENA));
      await assertSucceeds(setDoc(doc(db(admin), 'events', 'Admin-Event'), ARENA));
      await assertFails(deleteDoc(eventDoc(alice)));
      await assertSucceeds(deleteDoc(eventDoc(admin)));
    });

    it('only admins change results, settings, and brackets', async function () {
      await assertFails(updateDoc(eventDoc(anon), {winners: ['anon']}));
      await assertFails(updateDoc(eventDoc(alice), {winners: ['alice']}));
      await assertFails(updateDoc(eventDoc(alice), {endTime: 99999}));
      await assertFails(updateDoc(eventDoc(alice), {bracket: {winners: []}}));
      await assertFails(updateDoc(eventDoc(alice), {'results.1.team1': 3}));
      await assertFails(updateDoc(eventDoc(alice), {chatBlocklist: []}));
      await assertSucceeds(updateDoc(eventDoc(admin), {winners: ['alice'], endTime: 99999}));
    });

    it('players join and leave the queue themselves only', async function () {
      await assertSucceeds(updateDoc(eventDoc(alice), {queue: arrayUnion('alice')}));
      // joining twice is a no-op and still allowed
      await assertSucceeds(updateDoc(eventDoc(alice), {queue: arrayUnion('alice')}));
      await assertFails(updateDoc(eventDoc(alice), {queue: arrayUnion('bob')}));
      await assertFails(updateDoc(eventDoc(bob), {queue: arrayRemove('alice')}));
      await assertFails(updateDoc(eventDoc(alice), {queue: arrayUnion('alice', 'bob')}));
      await assertFails(updateDoc(eventDoc(anon), {queue: arrayUnion('alice')}));
      await assertSucceeds(updateDoc(eventDoc(alice), {queue: arrayRemove('alice')}));
    });

    it('queue changes cannot smuggle other fields', async function () {
      await assertFails(updateDoc(eventDoc(alice), {queue: arrayUnion('alice'), winners: ['alice']}));
    });

    it('only registered, non-disqualified players use the queue and check in', async function () {
      const stranger = env.authenticatedContext('stranger', {username: 'stranger'});
      const cheater = env.authenticatedContext('cheater', {username: 'cheater'});
      await assertFails(updateDoc(eventDoc(stranger), {queue: arrayUnion('stranger')}));
      await assertFails(updateDoc(eventDoc(cheater), {queue: arrayUnion('cheater')}));
      await assertFails(updateDoc(eventDoc(cheater), {checkedInPlayers: arrayUnion('cheater')}));
    });

    it('players check themselves in but cannot check out or check others in', async function () {
      await assertSucceeds(updateDoc(eventDoc(alice), {checkedInPlayers: arrayUnion('alice')}));
      await assertFails(updateDoc(eventDoc(alice), {checkedInPlayers: arrayUnion('bob')}));
      await assertFails(updateDoc(eventDoc(alice), {checkedInPlayers: arrayRemove('alice')}));
      await assertSucceeds(updateDoc(eventDoc(admin), {checkedInPlayers: arrayUnion('bob')}));
    });
  });

  describe('players (leaderboard)', function () {
    it('anyone can read the leaderboard', async function () {
      await assertSucceeds(getDocs(collection(db(anon), 'events', EVENT, 'players')));
    });

    it('players register themselves with a blank record', async function () {
      const carol = env.authenticatedContext('carol', {username: 'carol'});
      await assertSucceeds(setDoc(playerDoc(carol, 'carol'), newPlayer('carol')));
    });

    it('players cannot register with points, as someone else, or anonymously', async function () {
      const carol = env.authenticatedContext('carol', {username: 'carol'});
      await assertFails(setDoc(playerDoc(carol, 'carol'), {...newPlayer('carol'), points: 100}));
      await assertFails(setDoc(playerDoc(carol, 'carol'), {...newPlayer('carol'), record: [{points: 5}]}));
      await assertFails(setDoc(playerDoc(carol, 'carol'), {...newPlayer('carol'), stats: {eventWins: 9}}));
      await assertFails(setDoc(playerDoc(carol, 'carol'), {...newPlayer('carol'), name: 'alice'}));
      await assertFails(setDoc(playerDoc(carol, 'dave'), newPlayer('dave')));
      await assertFails(setDoc(playerDoc(anon, 'anon'), newPlayer('anon')));
    });

    it('registration closes when disableJoin is set, except for admins', async function () {
      await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'events', EVENT), {disableJoin: true}));
      const carol = env.authenticatedContext('carol', {username: 'carol'});
      await assertFails(setDoc(playerDoc(carol, 'carol'), newPlayer('carol')));
      await assertSucceeds(setDoc(playerDoc(admin, 'carol'), newPlayer('carol')));
    });

    it('nobody but admins edits points, records, rank, or dq', async function () {
      await assertFails(updateDoc(playerDoc(alice, 'alice'), {points: 1000}));
      await assertFails(updateDoc(playerDoc(alice, 'alice'), {record: [{points: 5}]}));
      await assertFails(updateDoc(playerDoc(alice, 'alice'), {rank: 1}));
      await assertFails(updateDoc(playerDoc(alice, 'bob'), {dq: true}));
      await assertFails(updateDoc(playerDoc(anon, 'alice'), {points: 1000}));
      await assertSucceeds(updateDoc(playerDoc(admin, 'bob'), {dq: true, points: 0}));
    });

    it('players leave themselves, admins remove anyone', async function () {
      await assertFails(deleteDoc(playerDoc(alice, 'bob')));
      await assertFails(deleteDoc(playerDoc(anon, 'alice')));
      await assertSucceeds(deleteDoc(playerDoc(alice, 'alice')));
      await assertSucceeds(deleteDoc(playerDoc(admin, 'bob')));
    });

    it('2v2 partner selection follows the app flow', async function () {
      // alice asks bob
      await assertSucceeds(updateDoc(playerDoc(alice, 'alice'), {partner: 'bob', partnerStatus: 'PENDING', teamName: ''}));
      // bob cannot be forced into it by alice
      await assertFails(updateDoc(playerDoc(alice, 'bob'), {partner: 'alice', partnerStatus: 'CONFIRMED', teamName: ''}));
      // bob confirms, writing both docs
      await assertSucceeds(updateDoc(playerDoc(bob, 'bob'), {partner: 'alice', partnerStatus: 'CONFIRMED', teamName: ''}));
      await assertSucceeds(updateDoc(playerDoc(bob, 'alice'), {partner: 'bob', partnerStatus: 'CONFIRMED', teamName: ''}));
      // team name on both docs
      await assertSucceeds(updateDoc(playerDoc(alice, 'alice'), {teamName: 'Team A'}));
      await assertSucceeds(updateDoc(playerDoc(alice, 'bob'), {teamName: 'Team A'}));
      // a third player cannot touch the pair
      const carol = env.authenticatedContext('carol', {username: 'carol'});
      await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'events', EVENT, 'players', 'carol'), newPlayer('carol')));
      await assertFails(updateDoc(playerDoc(carol, 'alice'), {teamName: 'hijacked'}));
      await assertFails(updateDoc(playerDoc(carol, 'alice'), {partner: 'carol', partnerStatus: 'CONFIRMED', teamName: ''}));
      // alice cannot repoint bob at somebody else
      await assertFails(updateDoc(playerDoc(alice, 'bob'), {partner: 'carol'}));
      // alice clears the partnership, bob gets bounced back to pending with alice
      await assertSucceeds(updateDoc(playerDoc(alice, 'alice'), {partner: '', partnerStatus: '', teamName: ''}));
      await assertSucceeds(updateDoc(playerDoc(alice, 'bob'), {partner: 'alice', partnerStatus: 'PENDING', teamName: ''}));
    });
  });

  describe('chat', function () {
    it('anyone reads, logged in players send as themselves', async function () {
      await assertSucceeds(getDocs(messages(anon)));
      await assertSucceeds(setDoc(doc(messages(alice)), {sender: 'alice', text: 'gg', timestamp: serverTimestamp()}));
    });

    it('rejects spoofed senders, anonymous posts, bad shapes, and client timestamps', async function () {
      await assertFails(setDoc(doc(messages(alice)), {sender: 'matt', text: 'i am the admin', timestamp: serverTimestamp()}));
      await assertFails(setDoc(doc(messages(alice)), {sender: 'Automated Message', text: 'hi', timestamp: serverTimestamp()}));
      await assertFails(setDoc(doc(messages(anon)), {sender: 'anon', text: 'hi', timestamp: serverTimestamp()}));
      await assertFails(setDoc(doc(messages(alice)), {sender: 'alice', text: 'hi', timestamp: 1}));
      await assertFails(setDoc(doc(messages(alice)), {sender: 'alice', text: '', timestamp: serverTimestamp()}));
      await assertFails(setDoc(doc(messages(alice)), {sender: 'alice', text: 'x'.repeat(1001), timestamp: serverTimestamp()}));
      await assertFails(setDoc(doc(messages(alice)), {sender: 'alice', text: 'hi', timestamp: serverTimestamp(), color: 'red'}));
    });

    it('respects the blocklist and disableChat', async function () {
      const troll = env.authenticatedContext('troll', {username: 'troll'});
      await assertFails(setDoc(doc(messages(troll)), {sender: 'troll', text: 'hi', timestamp: serverTimestamp()}));
      await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'events', EVENT), {disableChat: true}));
      await assertFails(setDoc(doc(messages(alice)), {sender: 'alice', text: 'hi', timestamp: serverTimestamp()}));
    });

    it('messages are immutable except for admin deletes', async function () {
      let id;
      await env.withSecurityRulesDisabled(async ctx => {
        const ref = doc(collection(ctx.firestore(), 'events', EVENT, 'messages'));
        id = ref.id;
        await setDoc(ref, {sender: 'bob', text: 'hi', timestamp: serverTimestamp()});
      });
      await assertFails(updateDoc(doc(messages(bob), id), {text: 'edited'}));
      await assertFails(deleteDoc(doc(messages(bob), id)));
      await assertSucceeds(deleteDoc(doc(messages(admin), id)));
    });
  });

  describe('redirects', function () {
    beforeEach(async function () {
      await env.withSecurityRulesDisabled(ctx =>
        setDoc(doc(ctx.firestore(), 'events', EVENT, 'redirect', 'r1'), {lobby: 'abcd', players: ['alice', 'bob']}));
    });

    it('players only see redirects meant for them', async function () {
      const mine = query(collection(db(alice), 'events', EVENT, 'redirect'), where('players', 'array-contains', 'alice'));
      await assertSucceeds(getDocs(mine));
      const theirs = query(collection(db(alice), 'events', EVENT, 'redirect'), where('players', 'array-contains', 'bob'));
      await assertFails(getDocs(theirs));
      await assertFails(getDocs(collection(db(alice), 'events', EVENT, 'redirect')));
      await assertFails(getDocs(collection(db(anon), 'events', EVENT, 'redirect')));
    });

    it('players clear only themselves from a redirect', async function () {
      await assertFails(updateDoc(redirectDoc(alice, 'r1'), {players: arrayRemove('bob')}));
      await assertFails(updateDoc(redirectDoc(alice, 'r1'), {lobby: 'zzzz'}));
      await assertFails(setDoc(redirectDoc(alice, 'r2'), {lobby: 'evil', players: ['bob']}));
      await assertSucceeds(updateDoc(redirectDoc(alice, 'r1'), {players: arrayRemove('alice')}));
    });
  });

  describe('results written by functions', function () {
    it('games, matches, and dyp matches are read only for players', async function () {
      for (const sub of ['games', 'matches', 'dyp-matches']) {
        await assertSucceeds(getDocs(collection(db(anon), 'events', EVENT, sub)));
        await assertFails(setDoc(doc(db(alice), 'events', EVENT, sub, 'g1'), {status: 'FINISHED'}));
        await assertFails(setDoc(doc(db(anon), 'events', EVENT, sub, 'g1'), {status: 'FINISHED'}));
      }
      // admins can clean up match tracking docs from the bracket editor
      await assertSucceeds(deleteDoc(doc(db(admin), 'events', EVENT, 'matches', 'm1')));
    });

    it('records are hidden from players and never writable from clients', async function () {
      await assertFails(getDocs(collection(db(alice), 'events', EVENT, 'records')));
      await assertFails(setDoc(doc(db(admin), 'events', EVENT, 'records', 'r1'), {name: 'matt', points: 50}));
    });
  });

  describe('player profiles', function () {
    it('are public and read only', async function () {
      await assertSucceeds(getDoc(doc(db(anon), 'players', 'alice')));
      await assertSucceeds(getDocs(collection(db(anon), 'players', 'alice', 'replays')));
      await assertFails(updateDoc(doc(db(alice), 'players', 'alice'), {totalGames: 9999}));
      await assertFails(setDoc(doc(db(admin), 'players', 'alice', 'replays', 'chunk_0'), {replays: []}));
    });
  });

  describe('generals.io homepage', function () {
    it('is readable by the game client without logging in', async function () {
      await assertSucceeds(getDoc(doc(db(anon), 'generals.io', 'homepage')));
    });

    it('admin status comes from the admins doc, which only admins can change', async function () {
      // nobody can make themselves an admin
      await assertFails(updateDoc(doc(db(alice), 'generals.io', 'admins'), {names: arrayUnion('alice')}));
      await assertFails(setDoc(doc(db(anon), 'generals.io', 'admins'), {names: ['anon']}));
      // claims inside the auth token mean nothing, only the doc counts
      const pretender = env.authenticatedContext('pretender', {username: 'pretender', admin: true});
      await assertFails(updateDoc(eventDoc(pretender), {winners: ['pretender']}));
      // an admin can add another admin, who then has admin powers
      await assertSucceeds(updateDoc(doc(db(admin), 'generals.io', 'admins'), {names: arrayUnion('bob')}));
      await assertSucceeds(updateDoc(eventDoc(bob), {winners: ['bob']}));
    });

    it('is only writable by admins', async function () {
      await assertFails(updateDoc(doc(db(anon), 'generals.io', 'homepage'), {eventInfo: {eventId: 'x'}}));
      await assertFails(updateDoc(doc(db(alice), 'generals.io', 'homepage'), {'seasonEndEvent.notInterested': arrayUnion('alice')}));
      await assertFails(updateDoc(doc(db(alice), 'generals.io', 'homepage'), {eventInfo: {timerIframeUrl: 'javascript:alert(1)'}}));
      await assertSucceeds(updateDoc(doc(db(admin), 'generals.io', 'homepage'), {eventInfo: {eventId: EVENT}}));
    });
  });

  describe('everything else', function () {
    it('unknown collections are locked', async function () {
      await assertFails(setDoc(doc(db(admin), 'whatever', 'abc'), {}));
      await assertFails(getDoc(doc(db(anon), 'whatever', 'abc')));
    });

    it('admin batches work end to end', async function () {
      const batch = writeBatch(db(admin));
      batch.update(eventDoc(admin), {'bracket.done': true});
      batch.delete(doc(db(admin), 'events', EVENT, 'matches', 'm1'));
      await assertSucceeds(batch.commit());
    });
  });

  describe('team arena restrictions', function () {
    const TEAM_EVENT = 'Team-Event';
    const TEAM_ARENA = {
      ...ARENA,
      type: 'Big Team',
      teamSize: 2,
      playersPerGame: 4,
      doublesPairingStrategy: 'BYP',
      arenaTeams: [],
      arenaReady: {},
      arenaPlaying: [],
    };
    const teamDoc = ctx => doc(db(ctx), 'events', TEAM_EVENT);
    const teamPlayer = (ctx, name) =>
        doc(db(ctx), 'events', TEAM_EVENT, 'players', name);

    beforeEach(async function () {
      await env.withSecurityRulesDisabled(async ctx => {
        const db2 = ctx.firestore();
        await setDoc(doc(db2, 'events', TEAM_EVENT), TEAM_ARENA);
        await setDoc(doc(db2, 'events', TEAM_EVENT, 'players', 'alice'),
            newPlayer('alice'));
        await setDoc(doc(db2, 'events', TEAM_EVENT, 'players', 'bob'),
            newPlayer('bob'));
      });
    });

    it('clients cannot self-register on a team arena', async function () {
      // carol writing her own doc is still denied — registration goes
      // through the backend so roster invariants hold
      const carol = env.authenticatedContext('carol',
          {username: 'carol'});
      await assertFails(
          setDoc(teamPlayer(carol, 'carol'), newPlayer('carol')));
      // a withdrawn-shaped doc does not bypass the restriction either
      await assertFails(setDoc(teamPlayer(carol, 'carol'),
          {...newPlayer('carol'), withdrawn: true}));
      // and of course writing somebody else's doc is denied too
      await assertFails(
          setDoc(teamPlayer(alice, 'carol'), newPlayer('carol')));
      // admins can still write registrations
      await assertSucceeds(
          setDoc(teamPlayer(admin, 'carol'), newPlayer('carol')));
    });

    it('players cannot delete their own doc on a team arena', async function () {
      // deleting a scored registration would orphan roster/in-flight state
      await assertFails(deleteDoc(teamPlayer(alice, 'alice')));
      await assertSucceeds(deleteDoc(teamPlayer(admin, 'alice')));
    });

    it('partner writes do not apply to team arenas', async function () {
      await assertFails(updateDoc(teamPlayer(alice, 'alice'),
          {partner: 'bob', partnerStatus: 'PENDING', teamName: 'x'}));
    });

    it('the legacy queue write is forbidden but check-in still works',
        async function () {
          await assertFails(updateDoc(teamDoc(alice),
              {queue: arrayUnion('alice'),
                  checkedInPlayers: arrayUnion('alice')}));
          await assertSucceeds(updateDoc(teamDoc(alice),
              {checkedInPlayers: arrayUnion('alice')}));
          // arena internals are never client-writable
          await assertFails(updateDoc(teamDoc(alice),
              {arenaTeams: [{id: 't1'}]}));
          await assertFails(updateDoc(teamDoc(alice),
              {arenaReady: {alice: 1}}));
        });

    it('big team roster fields are never client-writable', async function () {
      // non-arena Big Team rosters mutate through the backend only
      const BIG_EVENT = 'Big-Event';
      const bigPlayer = (ctx, name) =>
          doc(db(ctx), 'events', BIG_EVENT, 'players', name);
      await env.withSecurityRulesDisabled(async ctx => {
        const db2 = ctx.firestore();
        await setDoc(doc(db2, 'events', BIG_EVENT),
            {...ARENA, type: 'Big Team', format: 'Double Elim',
                teamSize: 4});
        await setDoc(doc(db2, 'events', BIG_EVENT, 'players', 'alice'),
            newPlayer('alice'));
        await setDoc(doc(db2, 'events', BIG_EVENT, 'players', 'bob'),
            newPlayer('bob'));
      });
      await assertFails(updateDoc(bigPlayer(alice, 'alice'),
          {teamMembers: ['alice', 'bob']}));
      await assertFails(updateDoc(bigPlayer(alice, 'alice'),
          {teamCaptain: 'alice'}));
      await assertFails(updateDoc(bigPlayer(bob, 'bob'),
          {bigTeamInvites: ['alice']}));
      // deleting your own registration would orphan a roster — backend only
      await assertFails(deleteDoc(bigPlayer(alice, 'alice')));
      await assertSucceeds(deleteDoc(bigPlayer(admin, 'alice')));
    });

    it('ordinary events keep the old behavior', async function () {
      // the same writes still work on the normal arena fixture
      await assertSucceeds(updateDoc(eventDoc(alice),
          {queue: arrayUnion('alice'),
              checkedInPlayers: arrayUnion('alice')}));
      // only OWN-doc self registration is legal on ordinary events
      const carol = env.authenticatedContext('carol',
          {username: 'carol'});
      await assertSucceeds(
          setDoc(playerDoc(carol, 'carol'), newPlayer('carol')));
      await assertFails(
          setDoc(playerDoc(alice, 'dave'), newPlayer('dave')));
      await assertFails(
          setDoc(playerDoc(anon, 'eve'), newPlayer('eve')));
      await assertSucceeds(deleteDoc(playerDoc(alice, 'alice')));
    });
  });
});
