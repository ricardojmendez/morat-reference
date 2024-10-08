import {
	MORAT_USER,
	clearUsers,
	getBlockedUsers,
	getUser,
	topUpPoints,
	User,
} from './users';
import { prisma } from './prisma';
import { Prisma } from '@prisma/client';

export type UserPoints = {
	fromKey: string;
	points: bigint;
	epoch: bigint;
};

type UserPointAssignment = {
	fromKey: string;
	epoch: bigint;
	points: UserPoints[];
};

export const DECAY_RATE = 0.1; // Every epoch, 10% of the assigned points are lost.
export const MAX_EPOCHS_QUEUED = 1 / DECAY_RATE; // How long we will hold points for.

const MIN_POINT_TRANSFER = 1n;
const MORAT_PCT = 0.01;

const queuedAssignments: Map<string, UserPointAssignment[]> = new Map();

/**
 * Clear all users and points from the system. Used since the state is shared between tests.
 */
export async function clearPointsAndUsers() {
	await clearUsers();
	queuedAssignments.clear();
}

/**
 * Adds up all points from a UserPoints array
 * @param userPoints UserPoints to tally up
 * @returns Total accumulated points
 */
export function tallyPoints(userPoints: UserPoints[]): bigint {
	return userPoints.reduce((acc, { points }) => acc + points, 0n);
}

/**
 * Debits points from a user account by altering it in place and returning a map of the deducted points.
 * @param user User to deduct points from
 * @param total Total number of points to deduct
 * @param epoch Epoch to assign for the update
 * @returns A vector with the user points map that were deducted from the user (and can potentially be assigned to a new one).
 */
async function debitPoints(
	tx: Prisma.TransactionClient,
	user: User,
	total: bigint,
	epoch: bigint
): Promise<UserPoints[]> {
	const senderOwnPoints = Number(user.ownPoints);
	const senderPoints = await getPoints(user.key, tx);
	const senderPointTally = Number(tallyPoints(senderPoints));

	const senderTotalPoints = senderPointTally + senderOwnPoints;

	if (senderTotalPoints < total) {
		return [];
	}

	const fromOwnPointsPct = Number(senderOwnPoints) / Number(senderTotalPoints);

	// We do a ceiling on own points because this will skew towards transfering
	// own points instead of received, so we keep more of what we've been sent,
	// and subtract those that get replenished every epoch.
	const totalNum = Number(total);
	const fromOwnPointsTransfer = Math.ceil(totalNum * fromOwnPointsPct);
	const fromAssignedPointsTransfer = totalNum - fromOwnPointsTransfer;

	const fromPoints = await getPoints(user.key, tx);
	const pointsResult: UserPoints[] = [];

	if (total > 0n) {
		const keysToDelete = new Set<string>();
		for (const userPoints of fromPoints) {
			const pointSegment =
				(Number(userPoints.points) / senderPointTally) *
				fromAssignedPointsTransfer;
			const pointsToTransfer = BigInt(Math.floor(pointSegment));
			const pointsToWithdraw = BigInt(Math.ceil(pointSegment));

			if (pointsToWithdraw <= 0 && pointsToTransfer <= 0) {
				continue;
			}

			const fromKey = userPoints.fromKey;
			const newUserPoints = {
				fromKey,
				points: userPoints.points - pointsToWithdraw,
				epoch,
			};
			if (newUserPoints.points > 0) {
				await tx.userPoints.update({
					where: {
						ownerId_assignerId: { assignerId: fromKey, ownerId: user.key },
					},
					data: {
						points: newUserPoints.points,
						epoch,
					},
				});
			} else {
				keysToDelete.add(fromKey);
			}

			// We don't allow points transfer from one user to the themselves, or a transfer below the minimum,
			// but the sender can lose the points.
			if (pointsToTransfer < MIN_POINT_TRANSFER) {
				continue;
			}

			pointsResult.push({
				fromKey,
				points: pointsToTransfer,
				epoch,
			});
		}

		// Let's not modify the group while iterating over it.
		await tx.userPoints.deleteMany({
			where: {
				ownerId: user.key,
				assignerId: { in: Array.from(keysToDelete) },
			},
		});
	}

	await tx.user.update({
		where: { key: user.key },
		data: { ownPoints: user.ownPoints - BigInt(fromOwnPointsTransfer) },
	});

	pointsResult.push({
		fromKey: user.key,
		points: BigInt(fromOwnPointsTransfer),
		epoch,
	});
	return pointsResult;
}

/**
 * Credits a bundle of points to a user account.
 * @param tx Transaction to run the credit in.
 * @param user User to credit the points to.
 * @param points Array containing the points and their sources.
 * @param epoch Epoch that the assignment is taking place.
 */
async function creditPoints(
	tx: Prisma.TransactionClient,
	user: User,
	points: UserPoints[],
	epoch: bigint
) {
	for (const userPoint of points) {
		// User will not receive points from themselves
		if (
			user.key == userPoint.fromKey ||
			userPoint.points < MIN_POINT_TRANSFER
		) {
			continue;
		}

		const pointRecord = await tx.userPoints.findUnique({
			where: {
				ownerId_assignerId: {
					assignerId: userPoint.fromKey,
					ownerId: user.key,
				},
			},
		});
		if (!pointRecord) {
			await tx.userPoints.create({
				data: {
					assignerId: userPoint.fromKey,
					ownerId: user.key,
					points: userPoint.points,
					epoch,
				},
			});
		} else {
			await tx.userPoints.update({
				where: {
					ownerId_assignerId: {
						assignerId: userPoint.fromKey,
						ownerId: user.key,
					},
				},
				data: {
					points: pointRecord.points + userPoint.points,
					epoch,
				},
			});
		}
	}
}

export enum AssignResult {
	Ok,
	CantSendToSelf,
	SenderDoesNotExist,
	ReceiverDoesNotExist,
	NotEnoughPoints,
	PointsShouldBePositive,
	DeductFailed,
	UnknownError,
}

/**
 * Credits an unclaimed bundle of points to a user account and modifies the pending claim collection.
 * @param user User to credit the points to.
 * @param pointClaimIdx Index on the unclaimed point array to claim
 * @param epoch Epoch that the assignment is taking place.
 * @returns AssignResult.DeductFailed if the point claim index is invalid, otherwise AssignResult.Ok
 */
export async function claimPoints(
	userKey: string,
	pointClaimIdx: number,
	epoch: bigint
): Promise<AssignResult> {
	const user = await getUser(userKey);
	if (!user) {
		return AssignResult.ReceiverDoesNotExist;
	}

	const unclaimedPoints = getQueuedPoints(userKey);
	if (pointClaimIdx < 0 || pointClaimIdx >= unclaimedPoints.length) {
		return AssignResult.DeductFailed;
	}

	const toAssign = unclaimedPoints[pointClaimIdx];

	// Decay the points
	// Note that this is a quick-and-dirty implementation for testing purposes,
	// because reducing a value by 40% is not the same as reducing it by 10% four times
	// applying a floor every time.
	const epochDecay = Math.min(1, Number(epoch - toAssign.epoch) * DECAY_RATE);

	await prisma.$transaction(async (tx) => {
		if (epochDecay < 1) {
			const decayed = toAssign.points
				.map((point) => ({
					fromKey: point.fromKey,
					points: BigInt(Math.floor(Number(point.points) * (1 - epochDecay))),
					epoch: point.epoch,
				}))
				.filter((point) => point.points > 0n);
			toAssign.points = decayed;
			await creditPoints(tx, user, toAssign.points, epoch);
		}

		unclaimedPoints.splice(pointClaimIdx, 1);
		if (unclaimedPoints.length == 0) {
			queuedAssignments.delete(userKey);
		} else {
			queuedAssignments.set(userKey, unclaimedPoints);
		}
	});

	return AssignResult.Ok;
}

async function assignPointsWorker(
	tx: Prisma.TransactionClient,
	senderKey: string,
	receiverKey: string,
	points: bigint,
	epoch: bigint
): Promise<AssignResult> {
	if (senderKey == receiverKey) {
		return AssignResult.CantSendToSelf;
	}

	if (points <= 0) {
		return AssignResult.PointsShouldBePositive;
	}

	const sender = await getUser(senderKey, tx);
	// We don't need to get the receiver within the transaction because we don't modify it.
	const receiver = await getUser(receiverKey);

	if (!sender) {
		return AssignResult.SenderDoesNotExist;
	}
	if (!receiver) {
		return AssignResult.ReceiverDoesNotExist;
	}

	const senderOwnPoints = sender.ownPoints;
	const senderPoints = await getPoints(senderKey, tx);
	const senderPointTally = tallyPoints(senderPoints);

	const senderTotalPoints = senderPointTally + senderOwnPoints;

	if (senderTotalPoints < points) {
		return AssignResult.NotEnoughPoints;
	}

	const toCredit = await debitPoints(tx, sender, points, epoch);

	if (toCredit.length == 0) {
		return AssignResult.DeductFailed;
	}
	const blockedUsers = await getBlockedUsers(receiverKey);
	if (receiver.optsIn && !blockedUsers.has(senderKey)) {
		await creditPoints(tx, receiver, toCredit, epoch);
	} else {
		const queued = getQueuedPoints(receiverKey);
		queued.push({ fromKey: senderKey, epoch, points: toCredit });
		queuedAssignments.set(receiverKey, queued);
	}
	return AssignResult.Ok;
}

export async function assignPoints(
	sender: string,
	receiver: string,
	points: bigint,
	epoch: bigint
): Promise<AssignResult> {
	if (sender == MORAT_USER) {
		return AssignResult.SenderDoesNotExist;
	}
	/*
        This duplicates some of the validations from assignPointsWorker because we need to 
        verify the point amount before we deduct Morat's points.
     */
	const senderUser = await getUser(sender);
	if (!senderUser) {
		return AssignResult.SenderDoesNotExist;
	}

	const senderPoints = await getPoints(sender);
	const senderAssignedPoints = tallyPoints(Array.from(senderPoints.values()));
	const fromTotalPoints = senderAssignedPoints + senderUser.ownPoints;
	if (fromTotalPoints < points) {
		return AssignResult.NotEnoughPoints;
	}

	// Now we can transfer
	const pointsToReceiver = BigInt(Math.ceil(Number(points) * (1 - MORAT_PCT)));
	const pointsToMorat = points - pointsToReceiver;

	const result = await prisma.$transaction(
		async (tx) => {
			const result = await assignPointsWorker(
				tx,
				sender,
				receiver,
				pointsToReceiver,
				epoch
			);
			if (result != AssignResult.Ok) {
				return result;
			}
			if (pointsToMorat > 0) {
				return await assignPointsWorker(
					tx,
					sender,
					MORAT_USER,
					pointsToMorat,
					epoch
				);
			}
			return AssignResult.Ok;
		},
		{
			isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
		}
	);

	return result ?? AssignResult.UnknownError;
}

/**
 * Decays the points of all users by DECAY_RATE, using a floor - this means
 * that we will not keep less than 1 point for a specific user assignment.
 *
 * @param epoch Epoch to assign for the update
 * @param tx Optional transaction to run the process on
 */
export async function decayPoints(
	epoch: bigint,
	tx?: Prisma.TransactionClient
) {
	const client = tx ?? prisma;
	const allPoints = await client.userPoints.findMany({});

	const pairsToDelete = [];
	for (const point of allPoints) {
		const newPoints = Math.floor(Number(point.points) * (1 - DECAY_RATE));
		if (newPoints > 0) {
			await client.userPoints.update({
				where: {
					ownerId_assignerId: {
						ownerId: point.ownerId,
						assignerId: point.assignerId,
					},
				},
				data: {
					points: BigInt(newPoints),
					epoch,
				},
			});
		} else {
			pairsToDelete.push({
				ownerId: point.ownerId,
				assignerId: point.assignerId,
			});
		}
	}
	await client.userPoints.deleteMany({
		where: {
			OR: pairsToDelete.map((pair) => ({
				ownerId: pair.ownerId,
				assignerId: pair.assignerId,
			})),
		},
	});
}

function pruneQueuedPoints(epoch: bigint) {
	const keysToDelete = new Set<string>();
	for (const [key, queued] of queuedAssignments.entries()) {
		const pruned = queued.filter(
			(assignment) => epoch - assignment.epoch <= MAX_EPOCHS_QUEUED
		);
		if (pruned.length == 0) {
			keysToDelete.add(key);
		} else {
			queuedAssignments.set(key, pruned);
		}
	}
	for (const key of keysToDelete) {
		queuedAssignments.delete(key);
	}
}

export async function epochTick(epoch: bigint) {
	await prisma.$transaction(async (tx) => {
		await topUpPoints(epoch, tx);
		await decayPoints(epoch, tx);
		pruneQueuedPoints(epoch);
	});
}

export async function getPoints(
	id: string,
	tx?: Prisma.TransactionClient
): Promise<UserPoints[]> {
	const client = tx ?? prisma;
	const dbPoints = await client.userPoints.findMany({
		where: { ownerId: id },
	});
	const points: UserPoints[] = dbPoints.map((point) => ({
		fromKey: point.assignerId,
		points: point.points,
		epoch: point.epoch,
	}));
	return points;
}

export function getQueuedPoints(id: string): UserPointAssignment[] {
	return queuedAssignments.get(id) ?? [];
}
