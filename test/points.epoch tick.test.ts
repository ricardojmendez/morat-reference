import { expect, test, describe } from 'bun:test';
import { createUser, getUser, MORAT_USER } from '../src/users';
import {
	assignPoints,
	clearPointsAndUsers,
	claimPoints,
	epochTick,
	getPoints,
	getQueuedPoints,
	tallyAssignedPoints,
	AssignResult,
	UserPointAssignment,
	collapsePoints,
} from '../src/points';
import {
	createEpochRecord,
	getAllEpochs,
	getCurrentEpoch,
} from '../src/epochs';
import { prisma } from '../src/prisma';

const sortPoints = (p: UserPointAssignment) => ({
	assignerId: p.assignerId,
	epoch: p.epoch,
	points: p.points.sort((a, b) => a.assignerId.localeCompare(b.assignerId)),
});

const getUserName = (i: number) => `user${i.toString().padStart(3, '0')}`;

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
		// Users's epoch update matches the latest one
		expect(alice!.epochUpdate).toBe(1n);
		expect(bob!.epochUpdate).toBe(1n);
		// The epoch record got created
		expect(await getCurrentEpoch()).toBe(1n);
	});

	test('we can tick in batches', async () => {
		await clearPointsAndUsers();
		const totalUsers = 100;

		for (let i = 0; i < totalUsers; i++) {
			await createUser(getUserName(i), 0n);
		}
		for (let i = 0; i < totalUsers - 1; i++) {
			await assignPoints(getUserName(i + 1), getUserName(i), 50n, 0n);
		}
		// Verify the points before the epoch tick
		const ownPointsPre = await prisma.user
			.findMany({
				orderBy: [{ key: 'asc' }],
				select: { ownPoints: true },
				where: { key: { not: MORAT_USER } },
			})
			.then((users) => users.map((u) => u.ownPoints));
		expect(ownPointsPre[0]).toBe(1000n);
		for (let i = 1; i < totalUsers; i++) {
			expect(ownPointsPre[i]).toBe(950n);
		}
		// Tick the epoch in batches
		await epochTick(1n, 7);
		// Verify the points after the epoch tick
		const ownPointsPost = await prisma.user
			.findMany({
				select: { ownPoints: true },
				where: { key: { not: MORAT_USER } },
			})
			.then((users) => users.map((u) => u.ownPoints));
		for (let i = 0; i < totalUsers; i++) {
			expect(ownPointsPost[i]).toBe(1000n);
		}
		// The epoch record got created
		expect(await getCurrentEpoch()).toBe(1n);
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
		expect(await tallyAssignedPoints('alice')).toBe(1n);
		expect(await tallyAssignedPoints('bob')).toBe(19n);
		expect(await tallyAssignedPoints('charlie')).toBe(139n); // Morat got 1 point
		// Tick the epoch and decay
		await epochTick(1n);
		const alicePoints = await getPoints('alice');
		expect(alicePoints).toBeEmpty(); // Empty elements are removed
		expect(await tallyAssignedPoints('alice')).toBe(0n);
		expect(await tallyAssignedPoints('bob')).toBe(17n);
		expect(await tallyAssignedPoints('charlie')).toBe(124n); // Morat got 1 point
		// Tick the epoch and decay
		await epochTick(2n);
		expect(alicePoints).toBeEmpty(); // Empty elements are removed
		expect(await tallyAssignedPoints('alice')).toBe(0n);
		expect(await tallyAssignedPoints('bob')).toBe(15n);
		expect(await tallyAssignedPoints('charlie')).toBe(111n);
		// All user epochs match the latest one
		const epochs = await prisma.user
			.findMany()
			.then((users) => users.map((u) => u.epochUpdate));
		expect(epochs).toContainAllValues([2n, 2n, 2n, 2n, 2n]);
		// The epoch record got created
		expect(await getCurrentEpoch()).toBe(2n);
	});

	test('we get an epoch record for every epoch ticked', async () => {
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
		// Tick the epoch and decay
		await epochTick(1n);
		await epochTick(2n);
		await epochTick(7n);
		// The epoch record got created
		const epochs = await getAllEpochs();
		expect(epochs).toHaveLength(3);
		expect(epochs.map((e) => e.id)).toEqual([1n, 2n, 7n]);
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
		const awaitingAntiEpoch1 = await getQueuedPoints('anti').map(sortPoints);
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
		const awaitingAntiEpoch2 = await getQueuedPoints('anti').map(sortPoints);
		expect(awaitingAntiEpoch2).toContainAllValues(awaitingAntiEpoch1);

		expect(await assignPoints('charlie', 'anti', 150n, 2n)).toBe(
			AssignResult.Ok
		);
		await epochTick(3n);
		const antiPoints = await getPoints('anti');
		expect(antiPoints).toBeEmpty();
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

describe('epoch tick - keep top N', () => {
	const createCollapsibleUserSet = async function (totalTestUsers: number) {
		await clearPointsAndUsers();
		await createEpochRecord(0n);

		await createUser('alice', 0n);
		await createUser('bob', 0n);

		// Create a series of test users, and assign points from them to
		// alice and bob, but in different orders - that way, when we collapse
		// the points, we will end up with different point assign sets for them
		for (let i = 0; i < totalTestUsers; i++) {
			const username = getUserName(i);
			await createUser(username, 0n);
			await assignPoints(username, 'alice', 200n - 5n * BigInt(i), 0n);
			await assignPoints(username, 'bob', BigInt(i + 1) * 10n, 0n);
		}
	};

	test('We only keep top N point assignments after collapsing points', async () => {
		const keepTopN = 5;
		const totalTestUsers = keepTopN * 3;
		await createCollapsibleUserSet(totalTestUsers);

		// Check that the assignment succeeded. Notice the amounts do not equal
		// the sum of assigned points because some ended up with morat
		const alicePointsPre = await getPoints('alice');
		expect(alicePointsPre).toHaveLength(totalTestUsers);
		expect(await tallyAssignedPoints('alice')).toBe(2459n);
		const bobPointsPre = await getPoints('bob');
		expect(bobPointsPre).toHaveLength(totalTestUsers);
		expect(await tallyAssignedPoints('bob')).toBe(1194n);
		expect(await tallyAssignedPoints(MORAT_USER)).toBe(22n);

		// Collapse the points for all users
		await collapsePoints(['alice', 'bob'], keepTopN);

		// The total point value should remain the same, because we only
		// collapsed points but did not tick the epoch
		expect(await tallyAssignedPoints('bob')).toBe(1194n);
		expect(await tallyAssignedPoints('alice')).toBe(2459n);
		expect(await tallyAssignedPoints(MORAT_USER)).toBe(22n);

		// Check that we are only keeping the top N points for alice
		// But that alice got point assigned to others
		const alice = await getUser('alice', undefined, { points: true });
		const alicePoints = alice!.points!;
		expect(alicePoints).toHaveLength(keepTopN);
		expect(alice!.othersPoints).toEqual(1515n);

		// Alice only keeps the first 5 assigners, because they were the ones that
		// assigned the most points to her
		const aliceAssigners = alicePoints.map((p) => p.assignerId);
		const expectedAliceAssigners = Array.from({ length: 5 }, (_, i) =>
			getUserName(i)
		);
		expect(aliceAssigners).toContainAllValues(expectedAliceAssigners);

		// Check that we are only keeping the top N points for alice
		// But that alice got point assigned to others
		const bob = await getUser('bob', undefined, { points: true });
		expect(bob!.othersPoints).toEqual(549n);
		const bobPoints = bob!.points!;
		expect(bobPoints).toHaveLength(keepTopN);

		// Bob only keeps the last 5 assigners, because they were the ones that
		// assigned the most points to him
		const bobAssigners = bobPoints.map((p) => p.assignerId);
		const expectedBobAssigners = Array.from({ length: 5 }, (_, i) =>
			getUserName(10 + i)
		);
		expect(bobAssigners).toContainAllValues(expectedBobAssigners);
	});

	test('Epock tick collapses the user points', async () => {
		const keepTopN = 5;
		const totalTestUsers = keepTopN * 3;
		await createCollapsibleUserSet(totalTestUsers);

		await epochTick(1n, 100, keepTopN);

		const alice = await getUser('alice', undefined, { points: true });
		const bob = await getUser('bob', undefined, { points: true });
        // We have collapsed the point assignments
        expect(alice!.points).toHaveLength(keepTopN);
        expect(bob!.points).toHaveLength(keepTopN);
		// Alice and bob have others' points, but they have decayed
		expect(alice?.othersPoints).toBe(1363n);
		expect(bob?.othersPoints).toBe(494n);        
		// The total point value has decayed
		expect(await tallyAssignedPoints('bob')).toBe(1074n);
		expect(await tallyAssignedPoints('alice')).toBe(2211n);
		expect(await tallyAssignedPoints(MORAT_USER)).toBe(15n);
	});
});
