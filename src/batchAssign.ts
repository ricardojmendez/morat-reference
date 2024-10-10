import { processIntents } from './points';

const currentEpoch = 0n;

const pointAssignLoop = async () => {
	console.log('Processing intents...', currentEpoch);
	try {
		const start = Date.now();
		const result = await processIntents(currentEpoch, 20);
		console.log(`Took ${Date.now() - start}`, result);
	} catch (e) {
		console.error(`Update loop error`, e);
	}
	setTimeout(pointAssignLoop, 1);
};

setTimeout(pointAssignLoop, 150);
