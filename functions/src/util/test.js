const simulator = require('./simulator');

// Get the replayId from the command line arguments
const replayId = process.argv[2];

if (replayId) {
  simulator.getReplayStats(replayId).then(stats => {
    console.log(stats);
  });
} else {
  console.log('No replayId, pass a replayId like:\n\nnode test.js lKpAZLqcM\n');
}