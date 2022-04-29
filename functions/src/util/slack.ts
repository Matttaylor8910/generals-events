// firebase functions:config:set slack.url="your://url.here"
import * as functions from 'firebase-functions';
import axios from 'axios';

const SLACK_URL = functions.config().slack.url;
const SLACK_BOT = {
  username: 'Generals Events',
  channel: '#generals'
};

// currently unused, but this is how we would post data to slack
export async function postToSlack(text: string) {
  const message: any = {
    ...SLACK_BOT,
    text
  };

  console.log('Posting the following to slack: ', message);
  console.log('Using this URL: ', SLACK_URL);
  return axios.post(SLACK_URL, {json: message});
}