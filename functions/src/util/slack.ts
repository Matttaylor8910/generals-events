// firebase functions:config:set slack.url="your://url.here"
import * as functions from 'firebase-functions';
import * as request from 'request';

const SLACK_URL = functions.config().slack.url;
const SLACK_BOT = {
  username: 'Generals Events',
  channel: '#generals'
};

export async function postToSlack(text: string) {
  const message: any = {
    ...SLACK_BOT,
    text
  };

  console.log('Posting the following to slack: ', message);
  console.log('Using this URL: ', SLACK_URL);
  return request.post(SLACK_URL, {json: message});
}
