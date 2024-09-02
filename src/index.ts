import { Elysia, t } from 'elysia';
import { createUser, userExists, getUser, userList } from './users';
import {
	assignPoints,
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
	id: t.String(),
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
		'/user/:id',
		({ params: { id }, error }) => {
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
		'/user/:id',
		({ params: { id }, error }) =>
			userExists(id)
				? error(409, 'User already exists')
				: createUser(id, currentEpoch),
		{
			params: StringID,
		}
	)
	.get(
		'/points/:id/detail',
		({ params: { id }, error }) => {
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
		'/points/:id/tally',
		({ params: { id }, error }) => {
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
		'/points/transfer/:from/:to/:points',
		({ params: { from, to, points }, error }) => {
			const success = assignPoints(from, to, points, currentEpoch);
			if (success != AssignResult.Ok) {
				return error(400, `Invalid points transfer: ${success}`);
			}
			return { success: true };
		},
		{
			params: t.Object({
				from: t.String(),
				to: t.String(),
				points: t.Number(),
			}),
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
app.handle(new Request(`${serverPath}/user/alice`, { method: 'POST' }));
app.handle(new Request(`${serverPath}/epoch/tick`, { method: 'POST' }));
app.handle(new Request(`${serverPath}/user/bob`, { method: 'POST' }));
app.handle(new Request(`${serverPath}/epoch/tick`, { method: 'POST' }));
app.handle(new Request(`${serverPath}/user/charlie`, { method: 'POST' }));
app.handle(
	new Request(`${serverPath}/points/transfer/charlie/alice/20`, {
		method: 'PUT',
	})
);
app.handle(
	new Request(`${serverPath}/points/transfer/alice/bob/10`, { method: 'PUT' })
);
app
	.handle(new Request(`${serverPath}/epoch/tick`, { method: 'POST' }))
	.then(console.log);

console.log(`🦊 Elysia is running at ${serverPath}`);

setInterval(() => {
	app.handle(new Request(`${serverPath}/epoch/tick`, { method: 'POST' }));
}, EPOCH_SECONDS * 1000);
