import { Elysia, t } from 'elysia';

/**
 * Basic, trivial prototype to play with the points concept.
 * 
 * OK, things to do here...
 * 
 * [x] Tick a new epoch
 * [ ] Allow registration of a new user
 * [ ] Every new user gets 1k points per epoch
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

const users: Map<number, { name: string; address: string }> = new Map([
	[1, { name: 'Joe', address: '1234' }],
	[2, { name: 'Jane', address: '5678' }],
]);

const app = new Elysia()
	.get('/', () => 'Hello Elysia')
	.get('/user/:id', ({ params: { id } }) => users.get(id), {
		params: t.Object({
			id: t.Numeric(),
		}),
	})
    .get('/epoch', () => currentEpoch)
    .post('/epoch/tick', () => currentEpoch++)
	.post('/echo', ({ body }) => body)
	.onError(({ code }) => {
		if (code === 'NOT_FOUND') return 'Route not found :(';
	})
	.listen(3000);

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
