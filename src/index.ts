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
	assignPoints,
	claimPoints,
	AssignResult,
	epochTick,
	getPoints,
	tallyPoints,
} from './points';
import { html } from '@elysiajs/html';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Basic, trivial prototype to play with the points concept.
 *
 */

const EPOCH_SECONDS = 10;

let currentEpoch = 0;

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
	.get('/user', () => userList())
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
		({ body, params: { encodedId }, error }) => {
			const id = decodeURIComponent(encodedId);
			const { optsIn } = body ?? {};
			return userExists(id)
				? error(409, 'User already exists')
				: createUser(id, currentEpoch, optsIn ?? true);
		},
		{
			params: StringID,
			body: t.Optional(UserBody),
		}
	)
	.get('/block/:encodedId', ({ params: { encodedId }, error }) => {
		const blocker = decodeURIComponent(encodedId);
		return !userExists(blocker)
			? error(404, 'User not found')
			: Array.from(getBlockedUsers(blocker));
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
		({ params: { encodedId }, error }) => {
			const id = decodeURIComponent(encodedId);
			const user = getUser(id);
			if (!user) {
				return error(404, 'User not found');
			}
			const userPoints = getPoints(id);
			const tally = userPoints
				? tallyPoints(Array.from(userPoints.values()))
				: 0;
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
		({ params: { encodedFrom, encodedTo, points }, error }) => {
			const from = decodeURIComponent(encodedFrom);
			const to = decodeURIComponent(encodedTo);
			const success = assignPoints(from, to, points, currentEpoch);
			if (success != AssignResult.Ok) {
				return error(400, `Invalid points transfer: ${success}`);
			}
			return { success: true };
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
		({ params: { encodedId }, body, error }) => {
			const id = decodeURIComponent(encodedId);
			const { index } = body;
			const result = claimPoints(id, index, currentEpoch);
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
	.post('/epoch/tick', () => {
		++currentEpoch;
		epochTick(currentEpoch);
		return currentEpoch;
	})
	.post('/echo', ({ body }) => body)
	.listen(3000);

console.log(`Creating sample data...`);

const serverPath = `http://${app.server?.hostname}:${app.server?.port}`;
app.handle(new Request(`${serverPath}/user/morat`, { method: 'POST' }));

console.log(`🦊 Elysia is running at ${serverPath}`);

setInterval(() => {
	app.handle(new Request(`${serverPath}/epoch/tick`, { method: 'POST' }));
}, EPOCH_SECONDS * 1000);
