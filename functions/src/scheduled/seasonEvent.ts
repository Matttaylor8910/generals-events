import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import * as moment from 'moment-timezone';

import {EventFormat, EventType, IDoubleElimEvent, IEvent, IGeneralsRankings, Visibility} from '../../../types';
import {getRankingsForSeason} from '../util/generals';

const HOUR = 1000 * 60 * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;
const SEASON = WEEK * 10;
const MAX_QUALIFIERS = 275;

try {
  admin.initializeApp();
} catch (e) {
  // do nothing, this is fine
}
const db = admin.firestore();
db.settings({ignoreUndefinedProperties: true});

export const updateSeasonEvent =
    functions.pubsub.schedule('every 1 hours').onRun(async (context) => {
      console.log('Updating season end event qualifiers (v 1.0.8)');

      // Pull down the generals.io/homepage doc and check the "seasonEndEvent"
      // object to get the current season
      const homepageRef = db.collection('generals.io').doc('homepage');
      const hompageSnapshot = await homepageRef.get();
      const {seasonEndEvent} = hompageSnapshot.data() ?? {};
      let {season = 0} = seasonEndEvent ?? {};

      console.log(`Getting event for season ${season}`);

      // Pull down the current season championship event doc to see if it exists
      let eventRef = getEventRef(season);
      let event = await getEvent(eventRef);

      // Assume the event for this season was successfully created when the
      // previous season ended, but if not, just error and quit
      if (event === undefined) {
        console.error(`No event exists for season ${season}`);
        return;
      }

      let description = getSeasonEndEventDescription(season, event.startTime);

      // If the start date is in the past, increment the season in the
      // generals.io/homepage doc by one and generate the new season end event
      if (event.startTime < Date.now()) {
        // new season, update the homepage doc
        season++;
        console.log(
            `Looks like season ${season - 1} is over, creating an event for ${
                season} and resetting the home page qualified modal`);

        const nextEventTime = event.startTime + SEASON;
        description = getSeasonEndEventDescription(season, nextEventTime);

        // reset the homepage qualification modal for the next season
        await homepageRef.update({
          seasonEndEvent: {
            season,
            description,
            qualified: [],
            remindLater: [],
            notInterested: [],
          },
        });

        // create a new event for the next season
        eventRef = getEventRef(season);
        event = await createNewSeasonEndEvent(season, nextEventTime);
      }

      console.log(`Getting rankings for season ${season}`);

      // Get the rankings for this season and generate a list of those that
      // qualify for this season's tournament and save their TSP in a map
      const rankings = await getRankingsForSeason(season);
      if (rankings === null) {
        console.error(`Unable to retrieve rankings for season ${season}`);
        return;
      }
      const {qualified, tsp} = await getQualifiedPlayers(rankings);

      console.log(`Found ${qualified.length} qualified players`);

      // If the list of qualified players is now longer than the previous list
      // of qualified players for this season end event, it is the start of a
      // new week of the season. If we have all 275 qualifiers at this point, 
      // clear the remindLater list so those players get notified again
      if (qualified.length > (event.qualified?.length ?? 0) && qualified.length === MAX_QUALIFIERS) {
        console.log(`The season just ended, clearing remindLater`);
        await homepageRef.update({[`seasonEndEvent.remindLater`]: []});
      }

      // pull down the players snapshot
      const playersSnapshot = await eventRef.collection('players').get();
      const registered = playersSnapshot.docs.map(doc => doc.id);
      const unregistered = qualified.filter(name => !registered.includes(name));

      console.log(`Updating the event and home page with the ${
          qualified.length} new qualifiers and ${
          Object.entries(tsp).length} tsp entries. There are ${
          unregistered.length} unregistered players that qualify!`);

      // prompt the unregistered to join the event and update the description
      await homepageRef.update({
        [`seasonEndEvent.qualified`]: unregistered,
        [`seasonEndEvent.description`]: description,
      });

      // Save those qualified players to the season end event
      await eventRef.update({qualified, tsp});
    });

/**
 * Given a season number, return a reference to its season end event
 * @param season
 * @returns
 */
function getEventRef(season: number): admin.firestore.DocumentReference {
  return db.collection('events').doc(`1v1-Season-${season}-Championship`);
}

/**
 * Given a document reference to the season end event for some season, get the
 * event and return a promise of that event
 * @param eventRef
 * @returns
 */
async function getEvent(eventRef: admin.firestore.DocumentReference):
    Promise<IDoubleElimEvent> {
  const eventSnapshot = await eventRef.get();
  return eventSnapshot.data() as IDoubleElimEvent;
}

/**
 * Given a season number and a unix timestamp of when the season's event should
 * take place, generate a new event in firestore and return that event
 * @param season
 * @param nextEventTime
 * @returns
 */
async function createNewSeasonEndEvent(
    season: number, nextEventTime: number): Promise<IDoubleElimEvent> {
  const eventRef = getEventRef(season);

  const event: IDoubleElimEvent = {
    name: `1v1 Season ${season} Championship`,
    format: EventFormat.DOUBLE_ELIM,
    type: EventType.ONE_VS_ONE,
    visibility: Visibility.PUBLIC,
    startTime: nextEventTime,
    checkedInPlayers: [],
    options: {},
    checkInTime: nextEventTime - (15 * 60 * 1000),  // 15 mins before
    playerCount: 0,
    replays: [],
    winners: [],
    winningSets: {
      winners: 4,
      losers: 3,
      semifinals: 4,
      finals: 4,
    },
    qualified: [],
    tsp: {},
  };

  await eventRef.set(event);

  return event;
}

/**
 * Given a season number and a unix timestamp of when the season's event should
 * take place, return a generic description to show in the qualification modal
 * calling out the season and the start time of the event
 * @param season
 * @param nextEventTime
 * @returns
 */
function getSeasonEndEventDescription(
    season: number, nextEventTime: number): string {
  const date = new Date(nextEventTime);
  const timezone = 'America/New_York';
  const datetimeFormat = 'dddd, MMMM Do [at] h:mma z';
  const dateString = moment(date).tz(timezone).format(datetimeFormat);
  return `Register to compete in the 1v1 bracket on ${
      dateString} for your chance to win prizes and become the Season ${
      season} champion!`;
}

/**
 * Given the rankings response from the generals.io API, determine the list of
 * qualified players and their total seed points (TSP)
 * @param rankings
 * @returns
 */
async function getQualifiedPlayers(rankings: IGeneralsRankings) {
  const qualified = new Set<string>();
  const tsp: {[username: string]: number} = {};
  const champions = await getChampions(EventType.ONE_VS_ONE);

  // find 25 qualifiers per week
  for (const week of rankings.weeks) {
    const {duel} = week;
    let added = 0;
    let index = 0;

    // find the next 25 top players that have not already qualified
    while (added < 25 && duel[index]) {
      const {username} = duel[index++];
      if (username && !qualified.has(username)) {
        qualified.add(username);
        added++;
      }
    }
  }

  // build the overall tsp map and add the final 25 qualifiers by overall TSP at
  // the end of the season if necessary
  let addedByTSP = 0;
  for (const player of rankings.tsp) {
    const key = `PLAYER${player.username}`;

    // build up the map of players already added to the overall tsp and add in the event champions
    if (qualified.has(player.username) || champions.includes(player.username)) {
      tsp[key] = player.tsp;
    }

    // if all 10 weeks in a season are done, add the next 25 by overall TSP
    else if (rankings.weeks.length === 10 && addedByTSP < 25) {
      qualified.add(player.username);
      tsp[key] = player.tsp;
      addedByTSP++;
    }
  }

  return {qualified: Array.from(qualified), tsp};
}

/**
 * Return a list of the event champions for a given type
 * @param eventType
 * @returns
 */
async function getChampions(eventType: EventType): Promise<string[]> {
  const champions: string[] = [];

  // get all events of the given type
  const snapshot = await db.collection('events')
                    .where('type', '==', eventType)
                    .get();

  // collect the names of all of the winners of this type
  snapshot.docs.forEach(doc => {
    const {winners = []} = doc.data() as IEvent;
    winners.forEach(winner => {
      if (!champions.includes(winner)) {
        champions.push(winner);
      }
    })
  });

  return champions;
}