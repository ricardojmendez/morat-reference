import { expect, test, describe } from 'bun:test';
import { createUser, getUser } from '../src/users';
import {
	assignPoints,
	clearPointsAndUsers,
	epochTick,
	getPoints,
	tallyPoints,
	AssignResult,
} from '../src/points';

describe('tally', () => {
	test('works as expected', () => {
		const total = tallyPoints([
			{ fromKey: 'a', points: 100, epoch: 0 },
			{ fromKey: 'b', points: 200, epoch: 1 },
		]);
		expect(total).toBe(300);
	});

	test('does not care about key or epoch', () => {
		const total = tallyPoints([
			{ fromKey: 'a', points: 100, epoch: 0 },
			{ fromKey: 'b', points: 200, epoch: 1 },
			{ fromKey: 'a', points: 33, epoch: 1 },
			{ fromKey: 'b', points: 92, epoch: 4 },
		]);
		expect(total).toBe(425);
	});
});

describe('assign - basic', () => {
	test('Ok with existing users', () => {
		const sender = createUser('sender', 0);
		createUser('receiver', 0);
		const result = assignPoints('sender', 'receiver', 20, 0);
		expect(result).toBe(AssignResult.Ok);
		expect(sender.ownPoints).toBe(980);
	});

	test('fails with same sender and receiver', () => {
		const result = assignPoints('sender', 'sender', 20, 0);
		expect(result).toBe(AssignResult.CantSendToSelf);
	});

	test('fails if receiver is missing', () => {
		clearPointsAndUsers();
		const sender = createUser('sender', 0);
		const result = assignPoints('sender', 'receiver', 20, 0);
		expect(result).toBe(AssignResult.ReceiverDoesNotExist);
		expect(sender.ownPoints).toBe(1000);
	});

	test('fails if sender is missing', () => {
		clearPointsAndUsers();
		createUser('receiver', 0);
		const result = assignPoints('sender', 'receiver', 20, 0);
		expect(result).toBe(AssignResult.SenderDoesNotExist);
	});

	test('fails for 0 points', () => {
		clearPointsAndUsers();
		createUser('sender', 0);
		createUser('receiver', 0);
		const result = assignPoints('sender', 'receiver', -1, 0);
		expect(result).toBe(AssignResult.PointsShouldBePositive);
	});

	test('fails if point amount is too large', () => {
		clearPointsAndUsers();
		const sender = createUser('sender', 0);
		createUser('receiver', 0);
		const result = assignPoints('sender', 'receiver', 1001, 0);
		expect(result).toBe(AssignResult.NotEnoughPoints);
		expect(sender.ownPoints).toBe(1000);
	});
});

describe('assign - transfer', () => {
	test('simple deduct and credit', () => {
		clearPointsAndUsers();
		const sender = createUser('sender', 0);
		const receiver = createUser('receiver', 0);
		const result = assignPoints('sender', 'receiver', 20, 1);
		expect(result).toBe(AssignResult.Ok);
		// Sender gets everything deducted from his own points
		expect(sender.ownPoints).toBe(980);
		// Own points of the receiver do not change
		expect(receiver.ownPoints).toBe(1000);
		// Receiver points are tagged as from the sender
		const receiverPoints = getPoints('receiver');
		const fromSender = receiverPoints[0];
		expect(fromSender).toEqual({ fromKey: 'sender', points: 20, epoch: 1 });
		// Point tally is 20, because we only got one transfer
		const tally = tallyPoints(receiverPoints);
		expect(tally).toBe(20);
	});

	test('can assign a single point', () => {
		clearPointsAndUsers();
		const sender = createUser('sender', 0);
		createUser('receiver', 0);
		const result = assignPoints('sender', 'receiver', 1, 0);
		expect(result).toBe(AssignResult.Ok);
		expect(sender.ownPoints).toBe(999);
		const receiverPoints = getPoints('receiver');
		const tally = tallyPoints(receiverPoints);
		expect(receiverPoints).toHaveLength(1);
		expect(receiverPoints[0]).toEqual({
			fromKey: 'sender',
			points: 1,
			epoch: 0,
		});
		expect(tally).toBe(1);
	});

	test('can receive points from many users', () => {
		clearPointsAndUsers();
		const alice = createUser('alice', 0);
		const bob = createUser('bob', 0);
		const charlie = createUser('charlie', 0);
		expect(assignPoints('alice', 'bob', 20, 1)).toBe(AssignResult.Ok);
		expect(assignPoints('charlie', 'bob', 31, 3)).toBe(AssignResult.Ok);
		// Sender gets everything deducted from his own points
		expect(alice.ownPoints).toBe(980);
		expect(charlie.ownPoints).toBe(969);
		// Own points of the receiver do not change
		expect(bob.ownPoints).toBe(1000);
		// Bob's point tally adds up
		const bobsPoints = getPoints('bob');
		const tally = tallyPoints(bobsPoints);
		expect(tally).toBe(51);
		// Bob's received points have the right tags
		const receiverPoints = getPoints('bob');
		const fromAlice = receiverPoints.find((p) => p.fromKey === 'alice');
		expect(fromAlice).toEqual({ fromKey: 'alice', points: 20, epoch: 1 });
		const fromCharlie = receiverPoints.find((p) => p.fromKey === 'charlie');
		expect(fromCharlie).toEqual({ fromKey: 'charlie', points: 31, epoch: 3 });
	});

	test('points stream forward proportionally', () => {
		clearPointsAndUsers();
		createUser('alice', 0);
		const bob = createUser('bob', 0);
		createUser('charlie', 0);
		const zeno = createUser('zeno', 0);
		expect(assignPoints('alice', 'bob', 50, 1)).toBe(AssignResult.Ok);
		expect(assignPoints('charlie', 'bob', 100, 3)).toBe(AssignResult.Ok);
		// Bob's point tally adds up
		const bobsPoints = getPoints('bob');
		expect(bob.ownPoints).toBe(1000);
		const preTally = tallyPoints(bobsPoints);
		expect(preTally).toBe(149); // Got one point less because it went to Morat
		expect(assignPoints('bob', 'zeno', 200, 4)).toBe(AssignResult.Ok);
		// Bob's points got deducted proportionally across the spectrum, with
		// 174 coming from his own points, 8 from alice, and 17 from charlie
		expect(bob.ownPoints).toBe(825);
		const bobsFinalPoints = getPoints('bob');
		expect(bobsFinalPoints).toHaveLength(2);
		expect(bobsFinalPoints).toContainEqual({
			fromKey: 'alice',
			points: 41,
			epoch: 4,
		});
		expect(bobsFinalPoints).toContainEqual({
			fromKey: 'charlie',
			points: 82,
			epoch: 4,
		});
		expect(tallyPoints(bobsFinalPoints)).toBe(123);
		// Zeno got a total of 197 points, proportionally taken from Bob's points
		// and the points Bob got from Alice and Charlie. Three points went to Morat.
		expect(zeno.ownPoints).toBe(1000);
		const zenosFinalPoints = getPoints('zeno');
		expect(zenosFinalPoints).toHaveLength(3);
		expect(zenosFinalPoints).toContainEqual({
			fromKey: 'alice',
			points: 8,
			epoch: 4,
		});
		expect(zenosFinalPoints).toContainEqual({
			fromKey: 'bob',
			points: 173,
			epoch: 4,
		});
		expect(zenosFinalPoints).toContainEqual({
			fromKey: 'charlie',
			points: 16,
			epoch: 4,
		});
		// Morat got its share
		const moratsFinalPoints = getPoints('morat');
		expect(moratsFinalPoints).toHaveLength(2);
		expect(moratsFinalPoints).toContainEqual({
			fromKey: 'bob',
			points: 2,
			epoch: 4,
		});
		expect(moratsFinalPoints).toContainEqual({
			fromKey: 'charlie',
			points: 1,
			epoch: 3,
		});
	});

	test('points sent back are lost', () => {
		clearPointsAndUsers();
		const alice = createUser('alice', 0);
		const bob = createUser('bob', 0);
		// Alice sends points to Bob, who then sends some points to Alice, but
		// Alice should not get any of her own cred back
		assignPoints('alice', 'bob', 20, 1);
		const result = assignPoints('bob', 'alice', 100, 1);
		expect(result).toBe(AssignResult.Ok);
		// Sender's own points did not get altered after the initial assign
		expect(alice.ownPoints).toBe(980); // Alice only got
		// Bob needs to have 1000 points deducted, proportional to the shares he
		// has on the different buckets. This means 99 points will come from his own,
		// and 1 from the ones he got from Alice.
		expect(bob.ownPoints).toBe(901);
		// Receiver points are tagged as from the sender
		const bobPoints = getPoints('bob');
		const fromAlice = bobPoints.find((p) => p.fromKey === 'alice');
		expect(fromAlice).toEqual({ fromKey: 'alice', points: 19, epoch: 1 });
		// Bob's point tally is 19 after deducting the 1 point that got wiped
		const bobTally = tallyPoints(bobPoints);
		expect(bobTally).toBe(19);
		// Alice's tally is only 99, because she didn't get her point back
		const alicePoints = getPoints('alice');
		const aliceTally = tallyPoints(alicePoints);
		expect(aliceTally).toBe(98); // 1 point went to Morat
	});
});

describe('assign - morat', () => {
	test('morat gets 1% of the transfers', () => {
		clearPointsAndUsers();
		const sender = createUser('sender', 0);
		const receiver = createUser('receiver', 0);
		const result = assignPoints('sender', 'receiver', 10, 1);
		expect(result).toBe(AssignResult.Ok);
		// Sender gets everything deducted from his own points
		expect(sender.ownPoints).toBe(990);
		// Own points of the receiver do not change
		expect(receiver.ownPoints).toBe(1000);
		// Receiver points are tagged as from the sender
		const receiverPoints = getPoints('receiver');
		const fromSender = receiverPoints[0];
		expect(fromSender).toEqual({ fromKey: 'sender', points: 10, epoch: 1 });
		// Point tally is 99, because 1% goes to Morat
		const tally = tallyPoints(receiverPoints);
		expect(tally).toBe(10);
		// Morat has one point
		const moratPoints = getPoints('morat');
		expect(moratPoints).toBeEmpty();
	});

	test('morat gets nothing on small transfers', () => {
		clearPointsAndUsers();
		createUser('receiver', 0);
		const result = assignPoints('morat', 'receiver', 10, 1);
		expect(result).toBe(AssignResult.SenderDoesNotExist);
	});

	test('morat gets a percentage of the transfered points', () => {
		clearPointsAndUsers();
		const sender = createUser('sender', 0);
		const receiver = createUser('receiver', 0);
		const result = assignPoints('sender', 'receiver', 100, 1);
		expect(result).toBe(AssignResult.Ok);
		// Sender gets everything deducted from his own points
		expect(sender.ownPoints).toBe(900);
		// Own points of the receiver do not change
		expect(receiver.ownPoints).toBe(1000);
		// Receiver points are tagged as from the sender
		const receiverPoints = getPoints('receiver');
		const fromSender = receiverPoints[0];
		expect(fromSender).toEqual({ fromKey: 'sender', points: 99, epoch: 1 });
		// Point tally is 99, because 1% goes to Morat
		const tally = tallyPoints(receiverPoints);
		expect(tally).toBe(99);
		// Morat has one point
		const moratPoints = getPoints('morat');
		expect(moratPoints[0]).toEqual({ fromKey: 'sender', points: 1, epoch: 1 });
		expect(tallyPoints(moratPoints)).toBe(1);
	});
});

describe('epoch tick', () => {
	test('points are replenished', () => {
		clearPointsAndUsers();
		let alice = createUser('alice', 0);
		let bob = createUser('bob', 0);
		assignPoints('alice', 'bob', 20, 1);
		assignPoints('bob', 'alice', 150, 1);
		expect(alice.ownPoints).toBe(980);
		expect(bob.ownPoints).toBe(852);
		// Tick the epoch
		epochTick(1);
		alice = getUser('alice')!;
		bob = getUser('bob')!;
		expect(alice.ownPoints).toBe(1000);
		expect(bob.ownPoints).toBe(1000);
	});

	test('points decay', () => {
		clearPointsAndUsers();
		createUser('alice', 0);
		createUser('bob', 0);
		createUser('charlie', 0);
		createUser('drew', 0);
		// If alice transfers to charlie after having received points from drew,
		// then she'll end up with fewer assigned points
		assignPoints('alice', 'bob', 20, 1);
		assignPoints('alice', 'charlie', 40, 1);
		assignPoints('bob', 'charlie', 100, 1);
		assignPoints('drew', 'alice', 1, 1);
		// Check the points before decay
		expect(tallyPoints(getPoints('alice'))).toBe(1);
		const bobPointsPre = getPoints('bob');
		expect(tallyPoints(bobPointsPre)).toBe(19);
		const charliePointsPre = getPoints('charlie');
		expect(tallyPoints(charliePointsPre)).toBe(139); // Morat got 1 point
		// Tick the epoch and decay
		epochTick(1);
		const alicePoints = getPoints('alice');
		expect(alicePoints).toBeEmpty(); // Empty elements are removed
		expect(tallyPoints(alicePoints)).toBe(0);
		expect(tallyPoints(getPoints('bob'))).toBe(17);
		expect(tallyPoints(getPoints('charlie'))).toBe(124); // Morat got 1 point
		// Tick the epoch and decay
		epochTick(2);
		expect(alicePoints).toBeEmpty(); // Empty elements are removed
		expect(tallyPoints(getPoints('alice'))).toBe(0);
		expect(tallyPoints(getPoints('bob'))).toBe(15);
		const charliePointsPost = getPoints('charlie');
		expect(tallyPoints(charliePointsPost)).toBe(111);
	});
});
