import { Elysia, t } from 'elysia';
import {
	blockUser,
	createUser,
	userExists,
	getUser,
	userList,
	getBlockedUsers,
} from './users';
import {
	getCurrentEpoch,
	createEpochRecord,
	getCurrentEpochDetails,
} from './epochs';
import {
	claimPoints,
	AssignResult,
	epochTick,
	getPoints,
	processIntents,
	registerIntent,
	tallyAssignedPoints,
} from './points';
import { html } from '@elysiajs/html';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Basic, trivial prototype to play with the points concept.
 *
 */

async function shouldTickEpoch() {
	const epochDetails = await getCurrentEpochDetails();
	const lastEpochDate = epochDetails._max.timestamp!;
	const currentDate = new Date();
	const deltaSeconds = (currentDate.getTime() - lastEpochDate.getTime()) / 1000;
	return deltaSeconds > EPOCH_SECONDS;
}

async function tickEpoch() {
	console.log(`Ticking epoch...`);
	currentEpoch = ((await getCurrentEpoch()) ?? 0n) + 1n;
	await epochTick(currentEpoch, 50, 500);
	return currentEpoch;
}

const EPOCH_SECONDS = 4 * 60 * 60;

let currentEpoch = (await getCurrentEpoch()) ?? -1n;
if (currentEpoch < 0n) {
	await createEpochRecord(0n);
	currentEpoch = 0n;
}

const StringID = t.Object({
	encodedId: t.String(),
});

const UserBody = t.Object({
	optsIn: t.Optional(t.Boolean()),
});

const ClaimBody = t.Object({
	index: t.Number(),
});

const app = new Elysia()
	.use(html())
	.get('/', async () => {
		let htmlContent = '';
		try {
			const filePath = path.join(__dirname, '../html/index.html');
			htmlContent = await fs.readFile(filePath, 'utf-8');
		} catch (error) {
			console.error('Error reading template file:', error);
		}
		return htmlContent;
	})
	.get('/user', ({ query }) => {
		const { all } = query;
		return userList(all === 'true');
	})
	.get(
		'/user/:encodedId',
		({ params: { encodedId }, error }) => {
			const id = decodeURIComponent(encodedId);
			const user = getUser(id);
			if (!user) {
				return error(404, 'User not found');
			} else {
				return user;
			}
		},
		{
			params: StringID,
		}
	)
	.post(
		'/user/:encodedId',
		async ({ body, params: { encodedId }, error }) => {
			try {
				const id = decodeURIComponent(encodedId);
				const { optsIn } = body ?? {};
				return (await userExists(id))
					? error(409, 'User already exists')
					: await createUser(id, currentEpoch, optsIn ?? true);
			} catch {
				return error(500, `Unknown exception`);
			}
		},
		{
			params: StringID,
			body: t.Optional(UserBody),
		}
	)
	.get('/block/:encodedId', async ({ params: { encodedId }, error }) => {
		const blocker = decodeURIComponent(encodedId);
		return !userExists(blocker)
			? error(404, 'User not found')
			: Array.from(await getBlockedUsers(blocker));
	})
	.put(
		'/block/:encodedBlocker/:encodedBlockee',
		({ params: { encodedBlocker, encodedBlockee }, error }) => {
			const blocker = decodeURIComponent(encodedBlocker);
			const blockee = decodeURIComponent(encodedBlockee);
			return !userExists(blocker)
				? error(404, 'Blocker not found')
				: !userExists(blockee)
					? error(404, 'Blockee not found')
					: blockUser(blocker, blockee);
		}
	)
	.get(
		'/points/:encodedId/detail',
		({ params: { encodedId }, error }) => {
			const id = decodeURIComponent(encodedId);
			const userPoints = getPoints(id);
			if (!userPoints) {
				return error(404, 'User not found or they have no points');
			} else {
				return userPoints;
			}
		},
		{
			params: StringID,
		}
	)
	.get(
		'/points/:encodedId/tally',
		async ({ params: { encodedId }, error }) => {
			const id = decodeURIComponent(encodedId);
			const user = await getUser(id);
			if (!user) {
				return error(404, 'User not found');
			}
			const tally = await tallyAssignedPoints(id);
			return {
				own: user.ownPoints,
				assigned: tally,
				total: tally + user.ownPoints,
			};
		},
		{
			params: StringID,
		}
	)
	.put(
		'/points/transfer/:encodedFrom/:encodedTo/:points',
		async ({ params: { encodedFrom, encodedTo, points }, error }) => {
			try {
				const from = decodeURIComponent(encodedFrom);
				const to = decodeURIComponent(encodedTo);
				const success = await registerIntent(
					from,
					to,
					BigInt(points),
					currentEpoch
				);
				if (!success) {
					return error(400, `Could not register point assignment`);
				}
				return { success: true };
			} catch (e) {
				console.error(`Exception with points transfer: ${e}`);
				return error(500, `Unknown exception`);
			}
		},
		{
			params: t.Object({
				encodedFrom: t.String(),
				encodedTo: t.String(),
				points: t.Number(),
			}),
		}
	)
	.put(
		'/points/claim/:encodedId',
		async ({ params: { encodedId }, body, error }) => {
			const id = decodeURIComponent(encodedId);
			const { index } = body;
			const result = await claimPoints(id, index, currentEpoch);
			return result == AssignResult.Ok
				? { success: true }
				: error(400, `Invalid points claim: ${result}`);
		},
		{
			params: StringID,
			body: ClaimBody,
		}
	)
	.get('/epoch', () => currentEpoch)
	.post('/epoch/tick', async () => {
		const currentEpoch = await tickEpoch();
		return currentEpoch;
	})
	.post('/echo', ({ body }) => body)
	.listen(3000);

console.log(`Creating sample data...`);

const serverPath = `http://${app.server?.hostname}:${app.server?.port}`;
app.handle(new Request(`${serverPath}/user/morat`, { method: 'POST' }));

console.log(`🦊 Elysia is running at ${serverPath}`);

const shouldTick = await shouldTickEpoch();
if (shouldTick) {
	tickEpoch();
}

setInterval(() => {
	tickEpoch();
}, EPOCH_SECONDS * 1000);

let itemCount = 0;
let loopTime = 0;

const pointAssignLoop = async () => {
	try {
		const start = Date.now();
		const result = await processIntents(currentEpoch, 40);
		const took = Date.now() - start;
		if (result.length > 0) {
			loopTime += took;
			itemCount += result.length;
			console.log(
				`Took ${took}ms avg ${(loopTime / itemCount).toFixed(2)}ms per item`,
				result
			);
		}
	} catch (e) {
		console.error(`Update loop error`, e);
	}
	setTimeout(pointAssignLoop, 5);
};

setTimeout(pointAssignLoop, 150);
