// firebase functions:secrets:set SLACK_WEBHOOK_URL
// Functions that post to slack must declare the secret with
// functions.runWith({secrets: [SLACK_SECRET]})
import * as request from 'request';

export const SLACK_SECRET = 'SLACK_WEBHOOK_URL';

const SLACK_BOT = {
  username: 'Generals Events',
  channel: '#generals'
};

export async function postToSlack(text: string) {
  const url = process.env[SLACK_SECRET];
  const message: any = {
    ...SLACK_BOT,
    text
  };

  if (!url) {
    console.warn('SLACK_WEBHOOK_URL is not set, not posting: ', message);
    return;
  }

  console.log('Posting the following to slack: ', message);
  return request.post(url, {json: message});
}
