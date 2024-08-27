import { Elysia, t } from 'elysia';
import { createUser, userExists, getUser, userList } from './users';
import { assignPoints, AssignResult, getPoints, tallyPoints } from './points';

/**
 * Basic, trivial prototype to play with the points concept.
 *
 * OK, things to do here...
 *
 * [x] Tick a new epoch
 * [x] Allow registration of a new user
 * [x] Every new user gets 1k points per epoch
 * [x] Allow a user to transfer points to another user
 * [x] Allow querying of current user points
 * [ ] User's own points refill on epoch tick
 * [ ] User's assigned points decay on epoch tick
 *
 * We'll do all of these in memory for now. This is a prototype.
 *
 * If this is going to end up running on Solana, it will likely need account
 * compression in order to save on storage costs.
 *
 */

const EPOCH_SECONDS = 5;

let currentEpoch = 0;

const StringID = t.Object({
	id: t.String(),
});

const app = new Elysia()
	.get('/', () => 'Hello Elysia')
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
				return Array.from(userPoints.values());
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
	.post('/epoch/tick', () => ++currentEpoch)
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
