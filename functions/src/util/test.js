const simulator = require('./simulator');

// Get the replayId from the command line arguments
const replayId = process.argv[2];
const server = process.argv[3] || 'na';

if (replayId) {
  simulator.getReplayStats(replayId, server).then(stats => {
    console.log(stats);
  });
} else {
  console.log('No replayId, pass a replayId like:\n\nnode test.js lKpAZLqcM\n');
}