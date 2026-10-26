import * as admin from 'firebase-admin';

import {canonicalTeamMembers, isUnassigned, isValidTeamMembers, isValidTeamSize, teamIdentity} from '../../../teams';
import {EventFormat, EventType, ILeaderboardPlayer, PartnerStatus} from '../../../types';

const MAX_TEAM_NAME = 20;
const MAX_INVITES = 16;

/**
 * Backend Big Team (non-arena) roster operations. Invitation-based
 * consent: a captain may only INVITE players; the invited player accepts
 * to join, so nobody is conscripted. Caller is the authenticated username;
 * organizer authority comes from the generals.io/admins doc.
 */
export class TeamBracketOperations {
  constructor(
      private readonly db: admin.firestore.Firestore,
      private readonly caller: string,
      private readonly organizer: boolean,
  ) {}

  private eventRef(eventId: string) {
    return this.db.collection('events').doc(eventId);
  }

  private assertMutable(event: {[key: string]: any} | undefined):
      asserts event is {[key: string]: any} {
    if (!event || event.type !== EventType.BIG_TEAM) {
      throw new Error('This is not a Big Team event');
    }
    if (event.format === EventFormat.ARENA) {
      throw new Error('Arena events use the team arena flow');
    }
    // the original settled lifecycle guard: any bracket, rounds, or an
    // endTime ever being set means the event has started
    if (event.bracket || event.rounds || event.endTime) {
      throw new Error('The event has already started');
    }
  }

  private assertEligible(
      event: {[key: string]: any},
      doc: admin.firestore.DocumentSnapshot | undefined,
      name: string) {
    const player = doc?.data() as ILeaderboardPlayer | undefined;
    if (!doc || !doc.exists || !player || player.name !== name ||
        player.name !== doc.id || player.withdrawn) {
      throw new Error(`${name} is not registered for this event`);
    }
    if (!event.checkedInPlayers?.includes(name)) {
      throw new Error(`${name} is not checked in`);
    }
    if (player.dq) {
      throw new Error(`${name} is disqualified`);
    }
    return player;
  }

  /**
   * Invite an unassigned player. Caller may be unassigned (an implicit
   * solo captain) or the captain of a real reciprocal roster with room.
   * The invite never forms or grows a team — only acceptInvite does.
   */
  sendInvite(eventId: string, target: string): Promise<void> {
    return this.db.runTransaction(async tx => {
      const eventRef = this.eventRef(eventId);
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data();
      this.assertMutable(event);
      if (!isValidTeamSize(event.teamSize)) {
        throw new Error('This event has an invalid team size');
      }
      const targetRef = eventRef.collection('players').doc(target);
      const callerRef = eventRef.collection('players').doc(this.caller);
      const [callerDoc, targetDoc] =
          await Promise.all([tx.get(callerRef), tx.get(targetRef)]);
      const caller = this.assertEligible(event, callerDoc, this.caller);
      const targetPlayer = this.assertEligible(event, targetDoc, target);
      if (target === this.caller) {
        throw new Error('You cannot invite yourself');
      }
      if (!isUnassigned(targetPlayer.teamMembers)) {
        throw new Error(`${target} is already on a team`);
      }

      // caller is either unassigned or the captain of a reciprocal roster
      // with an open slot
      const roster: any = caller.teamMembers;
      if (!isUnassigned(roster)) {
        if (!isValidTeamMembers(roster) ||
            caller.teamCaptain !== this.caller ||
            !roster.includes(this.caller)) {
          throw new Error('Only the team captain can invite players');
        }
        const members = canonicalTeamMembers(roster);
        const memberRefs = members.map(name =>
            eventRef.collection('players').doc(name));
        const memberDocs =
            await Promise.all(memberRefs.map(ref => tx.get(ref)));
        const identity = teamIdentity(members);
        for (const doc of memberDocs) {
          const member = this.assertEligible(event, doc, doc.id);
          if (!isValidTeamMembers(member.teamMembers) ||
              teamIdentity(member.teamMembers) !== identity ||
              member.teamCaptain !== this.caller) {
            throw new Error('Team data is inconsistent, please refresh');
          }
        }
        if (members.length >= event.teamSize) {
          throw new Error(`Teams are limited to ${event.teamSize} players`);
        }
      }

      const invites = Array.isArray(targetPlayer.bigTeamInvites) ?
          targetPlayer.bigTeamInvites : [];
      if (invites.includes(this.caller)) {
        return; // a repeat invite is idempotent
      }
      if (invites.length >= MAX_INVITES) {
        throw new Error(`${target} has too many pending invites`);
      }
      const outgoing = await tx.get(eventRef.collection('players')
          .where('bigTeamInvites', 'array-contains', this.caller)
          .limit(MAX_INVITES + 1));
      if (outgoing.docs.length >= MAX_INVITES) {
        throw new Error('Cancel a pending invitation before sending another');
      }
      tx.update(targetRef, {
        bigTeamInvites: [...invites, this.caller]});
    });
  }

  /**
   * Accept a pending invitation: the caller is the invitee, unassigned,
   * and the captain's invite must still be present. Forms the captain's
   * roster atomically with canonical mirrored metadata on every member.
   */
  acceptInvite(eventId: string, captain: string): Promise<void> {
    return this.db.runTransaction(async tx => {
      const eventRef = this.eventRef(eventId);
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data();
      this.assertMutable(event);
      if (!isValidTeamSize(event.teamSize)) {
        throw new Error('This event has an invalid team size');
      }

      const callerRef = eventRef.collection('players').doc(this.caller);
      const captainRef = eventRef.collection('players').doc(captain);
      const [callerDoc, captainDoc] =
          await Promise.all([tx.get(callerRef), tx.get(captainRef)]);
      const caller = this.assertEligible(event, callerDoc, this.caller);
      const captainPlayer = this.assertEligible(event, captainDoc, captain);

      const invites = Array.isArray(caller.bigTeamInvites) ?
          caller.bigTeamInvites : [];
      if (!invites.includes(captain)) {
        throw new Error(`${captain} has not invited you`);
      }
      // owning any explicit roster, even a singleton, requires leaving
      // first
      if (!isUnassigned(caller.teamMembers)) {
        throw new Error('You are already on a team');
      }

      // the captain's actual reciprocal roster (or [captain] when strictly
      // unassigned) read fresh — a stale invite from a transferred captain
      // can never pull anybody
      const roster: any = captainPlayer.teamMembers;
      let members: string[];
      if (isUnassigned(roster)) {
        members = [captain];
      } else {
        if (!isValidTeamMembers(roster) ||
            captainPlayer.teamCaptain !== captain ||
            !roster.includes(captain)) {
          throw new Error('That invitation is no longer valid');
        }
        members = canonicalTeamMembers(roster);
      }
      if (members.length + 1 > event.teamSize) {
        throw new Error(`Teams are limited to ${event.teamSize} players`);
      }

      // read every actual member doc before writing. When the captain
      // already has an explicit roster every member must carry the
      // identical reciprocal roster and captain; an unassigned captain
      // has no reciprocal roster to validate yet
      const memberRefs = members.map(name =>
          eventRef.collection('players').doc(name));
      const memberDocs =
          await Promise.all(memberRefs.map(ref => tx.get(ref)));
      if (!isUnassigned(roster)) {
        const identity = teamIdentity(members);
        for (const doc of memberDocs) {
          const member = this.assertEligible(event, doc, doc.id);
          if (!isValidTeamMembers(member.teamMembers) ||
              teamIdentity(member.teamMembers) !== identity ||
              member.teamCaptain !== captain ||
              !(event.checkedInPlayers || []).includes(member.name) ||
              member.dq) {
            throw new Error('Team data is inconsistent, please refresh');
          }
        }
      }

      const teamMembers =
          canonicalTeamMembers([...members, this.caller]);
      const teamName =
          (captainPlayer.teamName || '').slice(0, MAX_TEAM_NAME);
      for (const ref of [...memberRefs, callerRef]) {
        tx.update(ref, {
          partner: '',
          partnerStatus: PartnerStatus.NONE,
          teamCaptain: captain,
          teamMembers,
          teamName,
        });
      }
      tx.update(callerRef, {bigTeamInvites: []});
    });
  }

  /** Remove only the given inviter's invitation from the caller's doc. */
  declineInvite(eventId: string, captain: string): Promise<void> {
    return this.db.runTransaction(async tx => {
      const eventRef = this.eventRef(eventId);
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data();
      this.assertMutable(event);
      const callerRef = eventRef.collection('players').doc(this.caller);
      const callerDoc = await tx.get(callerRef);
      const caller = this.assertEligible(event, callerDoc, this.caller);
      const invites = Array.isArray(caller.bigTeamInvites) ?
          caller.bigTeamInvites : [];
      if (!invites.includes(captain)) {
        return; // already gone
      }
      tx.update(callerRef, {
        bigTeamInvites: invites.filter(name => name !== captain)});
    });
  }

  /** Remove the caller's own invitation from the indicated target's doc. */
  cancelInvite(eventId: string, target: string): Promise<void> {
    return this.db.runTransaction(async tx => {
      const eventRef = this.eventRef(eventId);
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data();
      this.assertMutable(event);
      const callerRef = eventRef.collection('players').doc(this.caller);
      const targetRef = eventRef.collection('players').doc(target);
      const [callerDoc, targetDoc] =
          await Promise.all([tx.get(callerRef), tx.get(targetRef)]);
      this.assertEligible(event, callerDoc, this.caller);
      const targetPlayer =
          this.assertEligible(event, targetDoc, target);
      const invites = Array.isArray(targetPlayer.bigTeamInvites) ?
          targetPlayer.bigTeamInvites : [];
      if (!invites.includes(this.caller)) {
        return;
      }
      tx.update(targetRef, {
        bigTeamInvites: invites.filter(name => name !== this.caller)});
    });
  }

  /**
   * Remove the caller from their big team. Mirrors the legacy
   * updateBigTeamRoster(false) semantics exactly: self only, captaincy
   * transfers to the first canonical member, a lone remainder clears.
   */
  leaveTeam(eventId: string): Promise<void> {
    return this.removeMembership(eventId, this.caller, false);
  }

  /** Captain-only rename mirrored atomically across the real roster. */
  renameTeam(eventId: string, teamName: string): Promise<void> {
    const name = this.caller;
    return this.db.runTransaction(async tx => {
      const eventRef = this.eventRef(eventId);
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data();
      this.assertMutable(event);
      const playerRef = eventRef.collection('players').doc(name);
      const playerDoc = await tx.get(playerRef);
      const player = this.assertEligible(event, playerDoc, name);

      const roster: any = player.teamMembers;
      if (!isValidTeamMembers(roster) || !roster.includes(name) ||
          player.teamCaptain !== name) {
        throw new Error('Only the team captain can rename the team');
      }
      const members = canonicalTeamMembers(roster);
      const identity = teamIdentity(members);
      const memberRefs = members.map(member =>
          eventRef.collection('players').doc(member));
      const memberDocs =
          await Promise.all(memberRefs.map(ref => tx.get(ref)));
      for (const doc of memberDocs) {
        const member = this.assertEligible(event, doc, doc.id);
        if (!isValidTeamMembers(member.teamMembers) ||
            teamIdentity(member.teamMembers) !== identity ||
            member.teamCaptain !== name) {
          throw new Error('Team data is inconsistent, please refresh');
        }
      }
      const update = {teamName: (teamName || '').slice(0, MAX_TEAM_NAME)};
      for (const ref of memberRefs) {
        tx.update(ref, update);
      }
    });
  }

  /**
   * Withdraw a registration atomically with roster cleanup, mirroring the
   * legacy leave+remove order: the caller (or an organizer for others) is
   * removed from their roster with canonical mirroring before the
   * registration is deleted, so no doc is left pointing at a ghost.
   */
  async withdrawPlayer(eventId: string, name: string): Promise<void> {
    if (name !== this.caller && !this.organizer) {
      throw new Error('You can only remove yourself from an event');
    }
    return this.removeMembership(eventId, name, true);
  }

  private removeMembership(
      eventId: string, name: string, removeRegistration: boolean):
      Promise<void> {
    const eventRef = this.eventRef(eventId);
    return this.db.runTransaction(async tx => {
      const eventDoc = await tx.get(eventRef);
      const event = eventDoc.data();
      this.assertMutable(event);
      const playerRef = eventRef.collection('players').doc(name);
      const playerDoc = await tx.get(playerRef);
      const player = playerDoc.data() as ILeaderboardPlayer | undefined;
      if (!playerDoc.exists && removeRegistration) {
        return;
      }
      if (!player || player.name !== name || playerDoc.id !== name) {
        throw new Error('Player data is inconsistent, please refresh');
      }
      if (!removeRegistration) {
        this.assertEligible(event, playerDoc, name);
      }

      const roster: any = player.teamMembers;
      let memberDocs: admin.firestore.DocumentSnapshot[] = [];
      let remaining: string[] = [];
      let captain = '';
      let teamName = '';
      if (!isUnassigned(roster)) {
        if (!isValidTeamMembers(roster) || !roster.includes(name) ||
            !player.teamCaptain || !roster.includes(player.teamCaptain)) {
          throw new Error('Team data is inconsistent, please refresh');
        }
        const members = canonicalTeamMembers(roster);
        captain = player.teamCaptain;
        const identity = teamIdentity(members);
        const memberRefs = members.map(member =>
            eventRef.collection('players').doc(member));
        memberDocs = await Promise.all(memberRefs.map(ref => tx.get(ref)));
        for (const doc of memberDocs) {
          const member = doc.data() as ILeaderboardPlayer;
          if (!doc.exists || member?.name !== doc.id ||
              !isValidTeamMembers(member.teamMembers) ||
              teamIdentity(member.teamMembers) !== identity ||
              member.teamCaptain !== captain) {
            throw new Error('Team data is inconsistent, please refresh');
          }
        }
        remaining = members.filter(member => member !== name);
        teamName = memberDocs[members.indexOf(captain)].data()?.teamName || '';
      } else if (!removeRegistration) {
        throw new Error('You are not on a team');
      }

      // Query before writing: invitation revocation and roster removal must
      // commit together, including when a concurrent invitation is accepted.
      const outgoing = await tx.get(eventRef.collection('players')
          .where('bigTeamInvites', 'array-contains', name).limit(401));
      if (outgoing.docs.length > 400) {
        throw new Error('Too many pending invitations; contact an organizer');
      }
      const cleared = {
        partner: '',
        partnerStatus: PartnerStatus.NONE,
        teamCaptain: '',
        teamMembers: [] as string[],
        teamName: '',
      };
      const newCaptain = remaining.includes(captain) ? captain : remaining[0];
      for (const doc of memberDocs) {
        if (doc.id !== name) {
          tx.update(doc.ref, remaining.length <= 1 ? cleared : {
            teamCaptain: newCaptain, teamMembers: remaining, teamName,
          });
        }
      }
      if (removeRegistration) {
        tx.update(eventRef, {
          checkedInPlayers: admin.firestore.FieldValue.arrayRemove(name),
        });
        tx.delete(playerRef);
      } else {
        tx.update(playerRef, cleared);
      }
      for (const doc of outgoing.docs) {
        if (!removeRegistration || doc.id !== name) {
          tx.update(doc.ref, {
            bigTeamInvites: admin.firestore.FieldValue.arrayRemove(name),
          });
        }
      }
    });
  }
}
