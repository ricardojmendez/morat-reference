import { expect, test, describe } from 'bun:test';
import { createUser, blockUser, getUser } from '../src/users';
import {
	assignPoints,
	clearPointsAndUsers,
	claimPoints,
	epochTick,
	getPoints,
	getQueuedPoints,
	tallyPoints,
	AssignResult,
	UserPointAssignment,
} from '../src/points';

const sortPoints = (p: UserPointAssignment) => ({
	assignerId: p.assignerId,
	epoch: p.epoch,
	points: p.points.sort((a, b) => a.assignerId.localeCompare(b.assignerId)),
});

describe('tally', () => {
	test('works as expected', () => {
		const total = tallyPoints([
			{ assignerId: 'a', points: 100n, epoch: 0n },
			{ assignerId: 'b', points: 200n, epoch: 1n },
		]);
		expect(total).toBe(300n);
	});

	test('does not care about key or epoch', () => {
		const total = tallyPoints([
			{ assignerId: 'a', points: 100n, epoch: 0n },
			{ assignerId: 'b', points: 200n, epoch: 1n },
			{ assignerId: 'a', points: 33n, epoch: 1n },
			{ assignerId: 'b', points: 92n, epoch: 4n },
		]);
		expect(total).toBe(425n);
	});
});

describe('assign - basic', async () => {
	test('Ok with existing users', async () => {
		await clearPointsAndUsers();
		await createUser('sender', 0n);
		await createUser('receiver', 0n);
		const result = await assignPoints('sender', 'receiver', 20n, 0n);
		const sender = await getUser('sender');
		expect(result).toBe(AssignResult.Ok);
		expect(sender!.ownPoints).toBe(980n);
	});

	test('fails with same sender and receiver', async () => {
		const result = await assignPoints('sender', 'sender', 20n, 0n);
		expect(result).toBe(AssignResult.CantSendToSelf);
	});

	test('fails if receiver is missing', async () => {
		await clearPointsAndUsers();
		await createUser('sender', 0n);
		const result = await assignPoints('sender', 'receiver', 20n, 0n);
		expect(result).toBe(AssignResult.ReceiverDoesNotExist);
		const sender = await getUser('sender');
		expect(sender!.ownPoints).toBe(1000n);
	});

	test('fails if sender is missing', async () => {
		await clearPointsAndUsers();
		createUser('receiver', 0n);
		const result = await assignPoints('sender', 'receiver', 20n, 0n);
		expect(result).toBe(AssignResult.SenderDoesNotExist);
	});

	test('fails for 0 points', async () => {
		await clearPointsAndUsers();
		await createUser('sender', 0n);
		await createUser('receiver', 0n);
		const result = await assignPoints('sender', 'receiver', -1n, 0n);
		expect(result).toBe(AssignResult.PointsShouldBePositive);
	});

	test('fails if point amount is too large', async () => {
		await clearPointsAndUsers();
		await createUser('sender', 0n);
		await createUser('receiver', 0n);
		const result = await assignPoints('sender', 'receiver', 1001n, 0n);
		expect(result).toBe(AssignResult.NotEnoughPoints);
		const sender = await getUser('sender');
		expect(sender!.ownPoints).toBe(1000n);
	});
});

describe('assign - transfer', () => {
	test('simple deduct and credit', async () => {
		await clearPointsAndUsers();
		await createUser('sender', 0n);
		await createUser('receiver', 0n);
		const result = await assignPoints('sender', 'receiver', 20n, 1n);
		expect(result).toBe(AssignResult.Ok);
		// Sender gets everything deducted from his own points
		const sender = await getUser('sender');
		const receiver = await getUser('receiver');
		expect(sender!.ownPoints).toBe(980n);
		// Own points of the receiver do not change
		expect(receiver!.ownPoints).toBe(1000n);
		// Receiver points are tagged as from the sender
		const receiverPoints = await getPoints('receiver');
		const fromSender = receiverPoints[0];
		expect(fromSender).toEqual({
			assignerId: 'sender',
			points: 20n,
			epoch: 1n,
		});
		// Point tally is 20, because we only got one transfer
		const tally = tallyPoints(receiverPoints);
		expect(tally).toBe(20n);
	});

	test('can assign a single point', async () => {
		await clearPointsAndUsers();
		await createUser('sender', 0n);
		await createUser('receiver', 0n);
		const result = await assignPoints('sender', 'receiver', 1n, 0n);
		expect(result).toBe(AssignResult.Ok);
		const sender = await getUser('sender');
		expect(sender!.ownPoints).toBe(999n);
		const receiverPoints = await getPoints('receiver');
		const tally = tallyPoints(receiverPoints);
		expect(receiverPoints).toHaveLength(1);
		expect(receiverPoints[0]).toEqual({
			assignerId: 'sender',
			points: 1n,
			epoch: 0n,
		});
		expect(tally).toBe(1n);
	});

	test('can receive points from many users', async () => {
		await clearPointsAndUsers();
		let alice = await createUser('alice', 0n);
		let bob = await createUser('bob', 0n);
		let charlie = await createUser('charlie', 0n);
		expect(await assignPoints('alice', 'bob', 20n, 1n)).toBe(AssignResult.Ok);
		expect(await assignPoints('charlie', 'bob', 31n, 3n)).toBe(AssignResult.Ok);
		// Reload users
		alice = await getUser('alice');
		bob = await getUser('bob');
		charlie = await getUser('charlie');
		// Sender gets everything deducted from his own points
		expect(alice!.ownPoints).toBe(980n);
		expect(charlie!.ownPoints).toBe(969n);
		// Own points of the receiver do not change
		expect(bob!.ownPoints).toBe(1000n);
		// Bob's point tally adds up
		const bobsPoints = await getPoints('bob');
		const tally = tallyPoints(bobsPoints);
		expect(tally).toBe(51n);
		// Bob's received points have the right tags
		const receiverPoints = await getPoints('bob');
		const fromAlice = receiverPoints.find((p) => p.assignerId === 'alice');
		expect(fromAlice).toEqual({ assignerId: 'alice', points: 20n, epoch: 1n });
		const fromCharlie = receiverPoints.find((p) => p.assignerId === 'charlie');
		expect(fromCharlie).toEqual({
			assignerId: 'charlie',
			points: 31n,
			epoch: 3n,
		});
	});

	test('we can request points when we get the user', async () => {
		await clearPointsAndUsers();
		let alice = await createUser('alice', 0n);
		let bob = await createUser('bob', 0n);
		let charlie = await createUser('charlie', 0n);
		expect(await assignPoints('alice', 'bob', 20n, 1n)).toBe(AssignResult.Ok);
		expect(await assignPoints('charlie', 'bob', 31n, 3n)).toBe(AssignResult.Ok);
		// Reload users
		alice = await getUser('alice');
		bob = await getUser('bob');
		charlie = await getUser('charlie');
		// Sender gets everything deducted from his own points
		expect(alice!.ownPoints).toBe(980n);
		expect(charlie!.ownPoints).toBe(969n);
		// Own points of the receiver do not change
		expect(bob!.ownPoints).toBe(1000n);
		// Bob's point tally adds up
		bob = await getUser('bob', undefined, { points: true });
		const bobPoints = bob!.points!;
		const tally = tallyPoints(bobPoints);
		expect(tally).toBe(51n);
		const fromAlice = bobPoints.find((p) => p.assignerId === 'alice');
		expect(fromAlice?.points).toEqual(20n);
		expect(fromAlice?.epoch).toEqual(1n);
		const fromCharlie = bobPoints.find((p) => p.assignerId === 'charlie');
		expect(fromCharlie?.points).toEqual(31n);
		expect(fromCharlie?.epoch).toEqual(3n);
	});

	test('points stream forward proportionally', async () => {
		await clearPointsAndUsers();
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		await createUser('charlie', 0n);
		await createUser('zeno', 0n);
		expect(await assignPoints('alice', 'bob', 50n, 1n)).toBe(AssignResult.Ok);
		expect(await assignPoints('charlie', 'bob', 100n, 3n)).toBe(
			AssignResult.Ok
		);
		// Bob's point tally adds up
		let bob = await getUser('bob');
		const bobsPoints = await getPoints('bob');
		expect(bob!.ownPoints).toBe(1000n);
		const preTally = tallyPoints(bobsPoints);
		expect(preTally).toBe(149n); // Got one point less because it went to Morat
		expect(await assignPoints('bob', 'zeno', 200n, 4n)).toBe(AssignResult.Ok);
		// Bob's points got deducted proportionally across the spectrum, with
		// 174 coming from his own points, 8 from alice, and 17 from charlie
		bob = await getUser('bob', undefined, { points: true });
		expect(bob!.ownPoints).toBe(825n);
		const bobsFinalPoints = await getPoints('bob');
		expect(bobsFinalPoints).toHaveLength(2);
		expect(bobsFinalPoints).toContainEqual({
			assignerId: 'alice',
			points: 41n,
			epoch: 4n,
		});
		expect(bobsFinalPoints).toContainEqual({
			assignerId: 'charlie',
			points: 82n,
			epoch: 4n,
		});
		expect(tallyPoints(bobsFinalPoints)).toBe(123n);
		// Zeno got a total of 197 points, proportionally taken from Bob's points
		// and the points Bob got from Alice and Charlie. Three points went to Morat.
		const zeno = await getUser('zeno');
		expect(zeno!.ownPoints).toBe(1000n);
		const zenosFinalPoints = await getPoints('zeno');
		expect(zenosFinalPoints).toHaveLength(3);
		expect(zenosFinalPoints).toContainEqual({
			assignerId: 'alice',
			points: 8n,
			epoch: 4n,
		});
		expect(zenosFinalPoints).toContainEqual({
			assignerId: 'bob',
			points: 173n,
			epoch: 4n,
		});
		expect(zenosFinalPoints).toContainEqual({
			assignerId: 'charlie',
			points: 16n,
			epoch: 4n,
		});
		// Morat got its share
		const moratsFinalPoints = await getPoints('morat');
		expect(moratsFinalPoints).toHaveLength(2);
		expect(moratsFinalPoints).toContainEqual({
			assignerId: 'bob',
			points: 2n,
			epoch: 4n,
		});
		expect(moratsFinalPoints).toContainEqual({
			assignerId: 'charlie',
			points: 1n,
			epoch: 3n,
		});
	});

	test('points sent back are lost', async () => {
		await clearPointsAndUsers();
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		// Alice sends points to Bob, who then sends some points to Alice, but
		// Alice should not get any of her own cred back
		await assignPoints('alice', 'bob', 20n, 1n);
		const result = await assignPoints('bob', 'alice', 100n, 1n);
		expect(result).toBe(AssignResult.Ok);
		// Load users
		const alice = await getUser('alice');
		const bob = await getUser('bob');
		// Sender's own points did not get altered after the initial assign
		expect(alice!.ownPoints).toBe(980n); // Alice only got
		// Bob needs to have 1000 points deducted, proportional to the shares he
		// has on the different buckets. This means 99 points will come from his own,
		// and 1 from the ones he got from Alice.
		expect(bob!.ownPoints).toBe(901n);
		// Receiver points are tagged as from the sender
		const bobPoints = await getPoints('bob');
		const fromAlice = bobPoints.find((p) => p.assignerId === 'alice');
		expect(fromAlice).toEqual({ assignerId: 'alice', points: 19n, epoch: 1n });
		// Bob's point tally is 19 after deducting the 1 point that got wiped
		const bobTally = tallyPoints(bobPoints);
		expect(bobTally).toBe(19n);
		// Alice's tally is only 99, because she didn't get her point back
		const alicePoints = await getPoints('alice');
		const aliceTally = tallyPoints(alicePoints);
		expect(aliceTally).toBe(98n); // 1 point went to Morat
	});
});

describe('assign - morat', () => {
	test('morat gets 1% of the transfers', async () => {
		await clearPointsAndUsers();
		await createUser('sender', 0n);
		await createUser('receiver', 0n);
		const result = await assignPoints('sender', 'receiver', 10n, 1n);
		expect(result).toBe(AssignResult.Ok);
		// Loads users
		const sender = await getUser('sender');
		const receiver = await getUser('receiver');
		// Sender gets everything deducted from his own points
		expect(sender!.ownPoints).toBe(990n);
		// Own points of the receiver do not change
		expect(receiver!.ownPoints).toBe(1000n);
		// Receiver points are tagged as from the sender
		const receiverPoints = await getPoints('receiver');
		const fromSender = receiverPoints[0];
		expect(fromSender).toEqual({
			assignerId: 'sender',
			points: 10n,
			epoch: 1n,
		});
		// Point tally is 99, because 1% goes to Morat
		const tally = tallyPoints(receiverPoints);
		expect(tally).toBe(10n);
		// Morat has one point
		const moratPoints = await getPoints('morat');
		expect(moratPoints).toBeEmpty();
	});

	test('morat gets nothing on small transfers', async () => {
		await clearPointsAndUsers();
		await createUser('receiver', 0n);
		const result = await assignPoints('morat', 'receiver', 10n, 1n);
		expect(result).toBe(AssignResult.SenderDoesNotExist);
	});

	test('morat gets a percentage of the transferred points', async () => {
		await clearPointsAndUsers();
		await createUser('sender', 0n);
		await createUser('receiver', 0n);
		const result = await assignPoints('sender', 'receiver', 100n, 1n);
		expect(result).toBe(AssignResult.Ok);
		// Load users
		const sender = await getUser('sender');
		const receiver = await getUser('receiver');
		// Sender gets everything deducted from his own points
		expect(sender!.ownPoints).toBe(900n);
		// Own points of the receiver do not change
		expect(receiver!.ownPoints).toBe(1000n);
		// Receiver points are tagged as from the sender
		const receiverPoints = await getPoints('receiver');
		const fromSender = receiverPoints[0];
		expect(fromSender).toEqual({
			assignerId: 'sender',
			points: 99n,
			epoch: 1n,
		});
		// Point tally is 99, because 1% goes to Morat
		const tally = tallyPoints(receiverPoints);
		expect(tally).toBe(99n);
		// Morat has one point
		const moratPoints = await getPoints('morat');
		expect(moratPoints[0]).toEqual({
			assignerId: 'sender',
			points: 1n,
			epoch: 1n,
		});
		expect(tallyPoints(moratPoints)).toBe(1n);
	});
});

describe('assign - opt-in', async () => {
	test('users who opted in get their points immediately', async () => {
		await clearPointsAndUsers();
		await createUser('sender', 0n, false);
		await createUser('receiver', 0n, true);
		const result = await assignPoints('sender', 'receiver', 25n, 1n);
		expect(result).toBe(AssignResult.Ok);
		// Load users
		const sender = await getUser('sender');
		const receiver = await getUser('receiver');
		// Sender gets everything deducted from his own points
		expect(sender!.ownPoints).toBe(975n);
		// Own points of the receiver do not change
		expect(receiver!.ownPoints).toBe(1000n);
		// Receiver points are tagged as from the sender
		const receiverPoints = await getPoints('receiver');
		const fromSender = receiverPoints[0];
		expect(fromSender).toEqual({
			assignerId: 'sender',
			points: 25n,
			epoch: 1n,
		});
		// Point tally is 25, because we only got one transfer
		const tally = tallyPoints(receiverPoints);
		expect(tally).toBe(25n);
	});

	test('users who did not opt in get their points held up', async () => {
		await clearPointsAndUsers();
		await createUser('sender', 0n, true);
		await createUser('receiver', 0n, false);
		const result = await assignPoints('sender', 'receiver', 25n, 1n);
		expect(result).toBe(AssignResult.Ok);
		// Load users
		const sender = await getUser('sender');
		const receiver = await getUser('receiver');
		// Sender gets everything deducted from his own points, even if the receiver hasn't claimed them
		expect(sender!.ownPoints).toBe(975n);
		// Own points of the receiver do not change
		expect(receiver!.ownPoints).toBe(1000n);
		// Receiver points are tagged as from the sender
		const receiverPoints = await getPoints('receiver');
		expect(receiverPoints).toBeEmpty();
		const tally = tallyPoints(receiverPoints);
		expect(tally).toBe(0n);
	});

	test('unclaimed points end up assigned by user', async () => {
		await clearPointsAndUsers();
		// Create a few users
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		await createUser('charlie', 0n);
		await assignPoints('alice', 'bob', 20n, 1n);
		await assignPoints('bob', 'charlie', 150n, 1n);

		const charliePointsPre = await getPoints('charlie');
		expect(charliePointsPre).toContainValues([
			{ assignerId: 'alice', points: 2n, epoch: 1n },
			{ assignerId: 'bob', points: 147n, epoch: 1n },
		]);

		// Anti refuses to opt into point assignments
		await createUser('anti', 1n, false);
		const awaitingAntiPre = await getQueuedPoints('anti');
		expect(awaitingAntiPre).toBeEmpty();

		const result = await assignPoints('charlie', 'anti', 100n, 1n);
		expect(result).toBe(AssignResult.Ok);
		// Sender gets everything deducted from his own points, even if the receiver hasn't claimed them
		const charlie = await getUser('charlie');
		expect(charlie!.ownPoints).toBe(912n);
		const charliePointsPost = await getPoints('charlie');
		expect(charliePointsPost).toContainValues([
			{ assignerId: 'alice', points: 1n, epoch: 1n },
			{ assignerId: 'bob', points: 135n, epoch: 1n },
		]);

		// Own points of the receiver do not change
		const anti = await getUser('anti');
		expect(anti!.ownPoints).toBe(1000n);
		// Receiver points are tagged as from the sender
		const antiPoints = await getPoints('anti');
		expect(antiPoints).toBeEmpty();

		const awaitingAntiPost = await getQueuedPoints('anti');
		expect(awaitingAntiPost).toContainValues([
			{
				assignerId: 'charlie',
				epoch: 1n,
				points: [
					// Notice that the fractional deducted point from alice gets lost
					{ assignerId: 'bob', points: 11n, epoch: 1n },
					{ assignerId: 'charlie', points: 87n, epoch: 1n },
				],
			},
		]);
	});

	test('multiple unclaimed points get tracked independently', async () => {
		await clearPointsAndUsers();
		// Create a few users
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		await createUser('charlie', 0n);
		await assignPoints('alice', 'bob', 20n, 1n);
		await assignPoints('bob', 'charlie', 150n, 1n);

		const charliePointsPre = await getPoints('charlie');
		expect(charliePointsPre).toContainValues([
			{ assignerId: 'alice', points: 2n, epoch: 1n },
			{ assignerId: 'bob', points: 147n, epoch: 1n },
		]);

		// Anti refuses to opt into point assignments
		await createUser('anti', 1n, false);

		expect(await assignPoints('charlie', 'anti', 100n, 1n)).toBe(
			AssignResult.Ok
		);
		expect(await assignPoints('charlie', 'anti', 150n, 2n)).toBe(
			AssignResult.Ok
		);
		// Sender gets everything deducted from his own points, even if the receiver hasn't claimed them
		const charlie = await getUser('charlie');
		expect(charlie!.ownPoints).toBe(781n);
		const charliePointsPost = await getPoints('charlie');
		expect(charliePointsPost).toContainValues([
			{ assignerId: 'bob', points: 116n, epoch: 2n },
		]);

		// Own points of the receiver do not change
		const anti = await getUser('anti');
		expect(anti!.ownPoints).toBe(1000n);
		// Receiver points are tagged as from the sender
		const antiPoints = await getPoints('anti');
		expect(antiPoints).toBeEmpty();

		const awaitingAntiPost = await getQueuedPoints('anti');
		expect(awaitingAntiPost).toHaveLength(2);
		expect(awaitingAntiPost).toContainAllValues([
			{
				assignerId: 'charlie',
				epoch: 1n,
				points: [
					{ assignerId: 'bob', points: 11n, epoch: 1n },
					{ assignerId: 'charlie', points: 87n, epoch: 1n },
				],
			},
			{
				assignerId: 'charlie',
				epoch: 2n,
				points: [
					{
						assignerId: 'bob',
						points: 18n,
						epoch: 2n,
					},
					{
						assignerId: 'charlie',
						points: 130n,
						epoch: 2n,
					},
				],
			},
		]);
	});
});

describe('assign - blocking', () => {
	test('points from directly blocked users remain unclaimed, even if opted in', async () => {
		await clearPointsAndUsers();
		// Create a few users
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		await createUser('stalin', 0n);
		await assignPoints('alice', 'bob', 20n, 1n);
		await assignPoints('bob', 'stalin', 150n, 1n);

		// Anti opts in, but hates Stalin
		await createUser('anti', 1n, true);
		await blockUser('anti', 'stalin');
		const awaitingAntiPre = await getQueuedPoints('anti');
		expect(awaitingAntiPre).toBeEmpty();

		await assignPoints('bob', 'anti', 50n, 1n);
		const result = await assignPoints('stalin', 'anti', 100n, 1n);
		expect(result).toBe(AssignResult.Ok);
		// Sender gets everything deducted from his own points, even if the receiver hasn't claimed them
		const stalin = await getUser('stalin');
		expect(stalin!.ownPoints).toBe(912n);
		const stalinPointsPost = await getPoints('stalin');
		expect(stalinPointsPost).toContainValues([
			{ assignerId: 'alice', points: 1n, epoch: 1n },
			{ assignerId: 'bob', points: 135n, epoch: 1n },
		]);

		// Own points of the receiver do not change
		const anti = await getUser('anti');
		expect(anti!.ownPoints).toBe(1000n);
		const antiPoints = await getPoints('anti');
		// Anti only has the points bob assigned to them
		expect(antiPoints).toContainAllValues([
			{
				assignerId: 'alice',
				points: 1n,
				epoch: 1n,
			},
			{
				assignerId: 'bob',
				points: 49n,
				epoch: 1n,
			},
		]);

		const awaitingAntiPost = await getQueuedPoints('anti');
		expect(awaitingAntiPost).toContainValues([
			{
				assignerId: 'stalin',
				epoch: 1n,
				points: [
					// Notice that the fractional deducted point from alice gets lost
					{ assignerId: 'bob', points: 11n, epoch: 1n },
					{ assignerId: 'stalin', points: 87n, epoch: 1n },
				],
			},
		]);
	});

	test('user does get points from blocked users if they are coming from other source', async () => {
		await clearPointsAndUsers();
		// Create a few users
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		await createUser('stalin', 0n);
		await createUser('svetlana', 0n);
		await assignPoints('alice', 'bob', 20n, 1n);
		await assignPoints('bob', 'stalin', 300n, 1n);
		await assignPoints('stalin', 'svetlana', 200n, 1n);

		// Anti opts in, but hates Stalin
		await createUser('anti', 1n, true);
		await blockUser('anti', 'stalin');
		const awaitingAntiPre = await getQueuedPoints('anti');
		expect(awaitingAntiPre).toBeEmpty();

		await assignPoints('svetlana', 'anti', 25n, 1n);
		const result = await assignPoints('stalin', 'anti', 200n, 1n);
		expect(result).toBe(AssignResult.Ok);
		// Sender gets everything deducted from his own points, even if the receiver hasn't claimed them
		const stalin = await getUser('stalin');
		expect(stalin!.ownPoints).toBe(690n);
		const stalinPointsPost = await getPoints('stalin');
		expect(stalinPointsPost).toContainValues([
			{ assignerId: 'alice', points: 3n, epoch: 1n },
			{ assignerId: 'bob', points: 202n, epoch: 1n },
		]);

		// Own points of the receiver do not change
		const anti = await getUser('anti');
		expect(anti!.ownPoints).toBe(1000n);
		const antiPoints = await getPoints('anti');
		// Anti does have a smattering of points from Stalin, because he got them through Svetlana
		// The only way to not get points from Stalin would be to not associate yourself with
		// anyone who associates themselves with him.
		expect(antiPoints).toContainAllValues([
			{
				assignerId: 'stalin',
				points: 3n,
				epoch: 1n,
			},
			{
				assignerId: 'svetlana',
				points: 21n,
				epoch: 1n,
			},
		]);

		const awaitingAntiPost = await getQueuedPoints('anti');
		expect(awaitingAntiPost).toContainValues([
			{
				assignerId: 'stalin',
				epoch: 1n,
				points: [
					// Notice that the fractional deducted point from alice gets lost
					{ assignerId: 'bob', points: 44n, epoch: 1n },
					{ assignerId: 'stalin', points: 153n, epoch: 1n },
				],
			},
		]);
	});
});

describe('epoch tick', () => {
	test('points are replenished', async () => {
		await clearPointsAndUsers();
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		await assignPoints('alice', 'bob', 20n, 1n);
		await assignPoints('bob', 'alice', 150n, 1n);
		// Verify the points before the epoch tick
		let alice = await getUser('alice');
		let bob = await getUser('bob');
		expect(alice!.ownPoints).toBe(980n);
		expect(bob!.ownPoints).toBe(852n);
		// Tick the epoch
		await epochTick(1n);
		alice = await getUser('alice');
		bob = await getUser('bob');
		expect(alice!.ownPoints).toBe(1000n);
		expect(bob!.ownPoints).toBe(1000n);
	});

	test('points decay', async () => {
		await clearPointsAndUsers();
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		await createUser('charlie', 0n);
		await createUser('drew', 0n);
		// If alice transfers to charlie after having received points from drew,
		// then she'll end up with fewer assigned points
		await assignPoints('alice', 'bob', 20n, 1n);
		await assignPoints('alice', 'charlie', 40n, 1n);
		await assignPoints('bob', 'charlie', 100n, 1n);
		await assignPoints('drew', 'alice', 1n, 1n);
		// Check the points before decay
		expect(tallyPoints(await getPoints('alice'))).toBe(1n);
		const bobPointsPre = await getPoints('bob');
		expect(tallyPoints(bobPointsPre)).toBe(19n);
		const charliePointsPre = await getPoints('charlie');
		expect(tallyPoints(charliePointsPre)).toBe(139n); // Morat got 1 point
		// Tick the epoch and decay
		await epochTick(1n);
		const alicePoints = await getPoints('alice');
		expect(alicePoints).toBeEmpty(); // Empty elements are removed
		expect(tallyPoints(alicePoints)).toBe(0n);
		expect(tallyPoints(await getPoints('bob'))).toBe(17n);
		expect(tallyPoints(await getPoints('charlie'))).toBe(124n); // Morat got 1 point
		// Tick the epoch and decay
		await epochTick(2n);
		expect(alicePoints).toBeEmpty(); // Empty elements are removed
		expect(tallyPoints(await getPoints('alice'))).toBe(0n);
		expect(tallyPoints(await getPoints('bob'))).toBe(15n);
		const charliePointsPost = await getPoints('charlie');
		expect(tallyPoints(charliePointsPost)).toBe(111n);
	});

	test('unclaimed points do not decay per epoch', async () => {
		await clearPointsAndUsers();
		// Create a few users
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		await createUser('charlie', 0n);
		await assignPoints('alice', 'bob', 100n, 1n);
		await assignPoints('bob', 'charlie', 150n, 1n);

		const charliePointsPre = await getPoints('charlie');
		expect(charliePointsPre).toContainValues([
			{ assignerId: 'alice', points: 13n, epoch: 1n },
			{ assignerId: 'bob', points: 136n, epoch: 1n },
		]);

		// Anti refuses to opt into point assignments
		await createUser('anti', 1n, false);

		expect(await assignPoints('charlie', 'anti', 100n, 1n)).toBe(
			AssignResult.Ok
		);
		const awaitingAntiEpoch1 = await getQueuedPoints('anti');
		expect(awaitingAntiEpoch1).toHaveLength(1);
		expect(awaitingAntiEpoch1).toContainAllValues([
			{
				assignerId: 'charlie',
				epoch: 1n,
				points: [
					{ assignerId: 'alice', points: 1n, epoch: 1n },
					{ assignerId: 'bob', points: 10n, epoch: 1n },
					{ assignerId: 'charlie', points: 87n, epoch: 1n },
				],
			},
		]);
		await epochTick(2n);
		const awaitingAntiEpoch2 = await getQueuedPoints('anti');
		expect(awaitingAntiEpoch2).toContainAllValues(awaitingAntiEpoch1);

		expect(await assignPoints('charlie', 'anti', 150n, 2n)).toBe(
			AssignResult.Ok
		);
		await epochTick(3n);
		const antiPoints = await getPoints('anti');
		expect(antiPoints).toBeEmpty();
		const awaitingAntiEpoch3 = await getQueuedPoints('anti');

		expect(awaitingAntiEpoch3).toHaveLength(2);
		expect(awaitingAntiEpoch3).toContainAllValues([
			{
				assignerId: 'charlie',
				epoch: 1n,
				points: [
					{ assignerId: 'alice', points: 1n, epoch: 1n },
					{ assignerId: 'bob', points: 10n, epoch: 1n },
					{ assignerId: 'charlie', points: 87n, epoch: 1n },
				],
			},
			{
				assignerId: 'charlie',
				epoch: 2n,
				points: [
					{ assignerId: 'alice', points: 1n, epoch: 2n },
					{ assignerId: 'bob', points: 14n, epoch: 2n },
					{ assignerId: 'charlie', points: 133n, epoch: 2n },
				],
			},
		]);
	});

	test('points are decayed if claimed on a later epoch', async () => {
		await clearPointsAndUsers();
		// Create a few users
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		await createUser('charlie', 0n);
		await assignPoints('alice', 'bob', 100n, 1n);
		await assignPoints('bob', 'charlie', 150n, 1n);

		const charliePointsPre = await getPoints('charlie');
		expect(charliePointsPre).toContainValues([
			{ assignerId: 'alice', points: 13n, epoch: 1n },
			{ assignerId: 'bob', points: 136n, epoch: 1n },
		]);

		// Anti refuses to opt into point assignments
		await createUser('anti', 1n, false);

		expect(await assignPoints('charlie', 'anti', 100n, 1n)).toBe(
			AssignResult.Ok
		);
		await epochTick(2n);
		expect(await assignPoints('charlie', 'anti', 150n, 2n)).toBe(
			AssignResult.Ok
		);
		await epochTick(3n);
		const antiPoints = await getPoints('anti');
		expect(antiPoints).toBeEmpty();
		// Sort them to make sure we getthem on easy-to-copare order
		const awaitingAntiEpoch3 = await getQueuedPoints('anti').map(sortPoints);

		expect(awaitingAntiEpoch3).toHaveLength(2);
		expect(awaitingAntiEpoch3).toContainAllValues([
			{
				assignerId: 'charlie',
				epoch: 1n,
				points: [
					{ assignerId: 'alice', points: 1n, epoch: 1n },
					{ assignerId: 'bob', points: 10n, epoch: 1n },
					{ assignerId: 'charlie', points: 87n, epoch: 1n },
				],
			},
			{
				assignerId: 'charlie',
				epoch: 2n,
				points: [
					{ assignerId: 'alice', points: 1n, epoch: 2n },
					{ assignerId: 'bob', points: 14n, epoch: 2n },
					{ assignerId: 'charlie', points: 133n, epoch: 2n },
				],
			},
		]);

		// Attempting to claim non-existent index fails
		expect(await claimPoints('anti', 3, 3n)).toEqual(AssignResult.DeductFailed);

		// Claim the second set of points on epoch 4
		expect(await claimPoints('anti', 1, 4n)).toEqual(AssignResult.Ok);
		// Since they were claimed quickly, they have only decayed 20%
		expect(await getPoints('anti')).toContainAllValues([
			{ assignerId: 'bob', points: 11n, epoch: 4n },
			{ assignerId: 'charlie', points: 106n, epoch: 4n },
		]);
		const awaitingAntiEpoch4 = await getQueuedPoints('anti');
		expect(awaitingAntiEpoch4).toHaveLength(1);
		expect(awaitingAntiEpoch4).toContainAllValues([
			{
				assignerId: 'charlie',
				epoch: 1n,
				points: [
					{ assignerId: 'alice', points: 1n, epoch: 1n },
					{ assignerId: 'bob', points: 10n, epoch: 1n },
					{ assignerId: 'charlie', points: 87n, epoch: 1n },
				],
			},
		]);

		// Claim the first set of points on epoch 8
		expect(await claimPoints('anti', 0, 8n)).toEqual(AssignResult.Ok);
		// Since they were claimed quickly, they have only decayed 20%
		expect(await getPoints('anti')).toContainAllValues([
			{ assignerId: 'bob', points: 13n, epoch: 8n },
			{ assignerId: 'charlie', points: 132n, epoch: 8n },
		]);
		// No unclaimed points left
		expect(await getQueuedPoints('anti')).toBeEmpty();
	});

	test('unclaimed points are pruned after a configured number of epochs', async () => {
		await clearPointsAndUsers();
		// Create a few users
		await createUser('alice', 0n);
		await createUser('bob', 0n);
		await createUser('charlie', 0n);
		await assignPoints('alice', 'bob', 100n, 1n);
		await assignPoints('bob', 'charlie', 150n, 1n);

		const charliePointsPre = await getPoints('charlie');
		expect(charliePointsPre).toContainValues([
			{ assignerId: 'alice', points: 13n, epoch: 1n },
			{ assignerId: 'bob', points: 136n, epoch: 1n },
		]);

		// Anti refuses to opt into point assignments
		await createUser('anti', 1n, false);

		expect(await assignPoints('charlie', 'anti', 100n, 1n)).toBe(
			AssignResult.Ok
		);
		await epochTick(2n);
		expect(await assignPoints('charlie', 'anti', 150n, 2n)).toBe(
			AssignResult.Ok
		);
		await epochTick(3n);
		const antiPoints = await getPoints('anti');
		expect(antiPoints).toBeEmpty();
		const awaitingAntiEpoch3 = await getQueuedPoints('anti');

		expect(awaitingAntiEpoch3).toHaveLength(2);
		expect(awaitingAntiEpoch3).toContainAllValues([
			{
				assignerId: 'charlie',
				epoch: 1n,
				points: [
					{ assignerId: 'alice', points: 1n, epoch: 1n },
					{ assignerId: 'bob', points: 10n, epoch: 1n },
					{ assignerId: 'charlie', points: 87n, epoch: 1n },
				],
			},
			{
				assignerId: 'charlie',
				epoch: 2n,
				points: [
					{ assignerId: 'alice', points: 1n, epoch: 2n },
					{ assignerId: 'bob', points: 14n, epoch: 2n },
					{ assignerId: 'charlie', points: 133n, epoch: 2n },
				],
			},
		]);

		// Start ticking epochs and see if they go away
		await epochTick(11n);
		const awaitingAntiEpoch11 = await getQueuedPoints('anti');
		expect(awaitingAntiEpoch11).toContainAllValues(awaitingAntiEpoch3);
		await epochTick(12n);
		const awaitingAntiEpoch12 = await getQueuedPoints('anti');
		expect(awaitingAntiEpoch12).toHaveLength(1);
		expect(awaitingAntiEpoch12).toContainAllValues(awaitingAntiEpoch3.slice(1));
		await epochTick(13n);
		expect(await getQueuedPoints('anti')).toBeEmpty();
	});
});
