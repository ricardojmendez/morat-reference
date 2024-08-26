import { Elysia, t } from 'elysia';
import { createUser, userExists, getUser, User, userList } from './users';

/**
 * Basic, trivial prototype to play with the points concept.
 *
 * OK, things to do here...
 *
 * [x] Tick a new epoch
 * [x] Allow registration of a new user
 * [x] Every new user gets 1k points per epoch
 * [ ] Allow a user to transfer points to another user
 * [ ] Allow querying of current user points
 * [ ] User point refill on epoch tick
 *
 * We'll do all of these in memory for now. This is a prototype.
 *
 * If this is going to end up running on Solana, it will likely need account
 * compression in order to save on storage costs.
 *
 */

let currentEpoch = 0;

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
			params: t.Object({
				id: t.String(),
			}),
		}
	)
	.post(
		'/user/:id',
		({ params: { id }, error }) =>
			userExists(id)
				? error(409, 'User already exists')
				: createUser(id, currentEpoch),
		{
			params: t.Object({
				id: t.String(),
			}),
		}
	)
	.get('/epoch', () => currentEpoch)
	.post('/epoch/tick', () => ++currentEpoch)
	.post('/echo', ({ body }) => body)
	.listen(3000);

console.log(`Creating sample data...`);

const serverPath = `http://${app.server?.hostname}:${app.server?.port}`;
app.handle(new Request(`${serverPath}/user/alpha`, { method: 'POST' }));
app.handle(new Request(`${serverPath}/epoch/tick`, { method: 'POST' }));
app.handle(new Request(`${serverPath}/user/beta`, { method: 'POST' }));
app
	.handle(new Request(`${serverPath}/epoch/tick`, { method: 'POST' }))
	.then(console.log);

console.log(`🦊 Elysia is running at ${serverPath}`);
