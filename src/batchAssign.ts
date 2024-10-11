import { processIntents } from './points';

const currentEpoch = 0n;

let itemCount = 0;
let loopTime = 0;

const pointAssignLoop = async () => {
	console.log('Processing intents...', currentEpoch);
	try {
		const start = Date.now();
		const result = await processIntents(currentEpoch, 20);
		const took = Date.now() - start;
		loopTime += took;
		itemCount += result.length;
		console.log(
			`Took ${took}ms avg ${(loopTime / itemCount).toFixed(2)}ms per item`,
			result
		);
	} catch (e) {
		console.error(`Update loop error`, e);
	}
	setTimeout(pointAssignLoop, 5);
};

setTimeout(pointAssignLoop, 150);
