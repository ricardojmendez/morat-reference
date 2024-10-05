import {
	MORAT_USER,
	clearUsers,
	getBlockedUsers,
	getUser,
	topUpPoints,
	User,
} from './users';
import { prisma } from './prisma';

export type UserPoints = {
	fromKey: string;
	points: bigint;
	epoch: bigint;
};

/**
 * Maps users to an array of points that others users have assigned to them.
 */
export type UserPointsMap = Map<string, UserPoints>;

type UserPointAssignment = {
	fromKey: string;
	epoch: bigint;
	points: UserPoints[];
};

export const DECAY_RATE = 0.1; // Every epoch, 10% of the assigned points are lost.
export const MAX_EPOCHS_QUEUED = 1 / DECAY_RATE; // How long we will hold points for.

const MIN_POINT_TRANSFER = 1n;
const MORAT_PCT = 0.01;

const pointMap: Map<string, UserPointsMap> = new Map();

const queuedAssignments: Map<string, UserPointAssignment[]> = new Map();

/**
 * Clear all users and points from the system. Used since the state is shared between tests.
 */
export async function clearPointsAndUsers() {
	await clearUsers();
	pointMap.clear();
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
	user: User,
	total: bigint,
	epoch: bigint
): UserPoints[] {
	const senderOwnPoints = Number(user.ownPoints);
	const senderPoints = getPoints(user.key);
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

	const fromPoints = pointMap.get(user.key) ?? new Map();
	const pointsResult: UserPoints[] = [];

	if (total > 0n) {
		const keysToDelete = new Set<string>();
		for (const [fromKey, userPoints] of fromPoints.entries()) {
			const pointSegment =
				(Number(userPoints.points) / senderPointTally) *
				fromAssignedPointsTransfer;
			const pointsToTransfer = BigInt(Math.floor(pointSegment));
			const pointsToWithdraw = BigInt(Math.ceil(pointSegment));

			if (pointsToWithdraw <= 0 && pointsToTransfer <= 0) {
				continue;
			}

			const newUserPoints = {
				fromKey,
				points: userPoints.points - pointsToWithdraw,
				epoch,
			};
			if (newUserPoints.points > 0) {
				fromPoints.set(fromKey, newUserPoints);
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

		// Let's not modify the map while iterating over it.
		for (const key of keysToDelete) {
			fromPoints.delete(key);
		}
	}
	pointMap.set(user.key, fromPoints);

	await prisma.user.update({
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
 * @param user User to credit the points to.
 * @param points Array containing the points and their sources.
 * @param epoch Epoch that the assignment is taking place.
 */
function creditPoints(user: User, points: UserPoints[], epoch: bigint) {
	const userPoints = pointMap.get(user.key) ?? new Map();
	for (const userPoint of points) {
		// User will not receive points from themselves
		if (
			user.key == userPoint.fromKey ||
			userPoint.points < MIN_POINT_TRANSFER
		) {
			continue;
		}

		const result = userPoints.get(userPoint.fromKey) ?? {
			fromKey: userPoint.fromKey,
			points: 0n,
			epoch: 0n,
		};
		result.points += userPoint.points;
		result.epoch = epoch;
		userPoints.set(userPoint.fromKey, result);
	}
	pointMap.set(user.key, userPoints);
}

export enum AssignResult {
	Ok,
	CantSendToSelf,
	SenderDoesNotExist,
	ReceiverDoesNotExist,
	NotEnoughPoints,
	PointsShouldBePositive,
	DeductFailed,
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

	if (epochDecay < 1) {
		const decayed = toAssign.points
			.map((point) => ({
				fromKey: point.fromKey,
				points: BigInt(Math.floor(Number(point.points) * (1 - epochDecay))),
				epoch: point.epoch,
			}))
			.filter((point) => point.points > 0n);
		toAssign.points = decayed;
		creditPoints(user, toAssign.points, epoch);
	}

	unclaimedPoints.splice(pointClaimIdx, 1);
	if (unclaimedPoints.length == 0) {
		queuedAssignments.delete(userKey);
	} else {
		queuedAssignments.set(userKey, unclaimedPoints);
	}

	return AssignResult.Ok;
}

async function assignPointsWorker(
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

	const sender = await getUser(senderKey);
	const receiver = await getUser(receiverKey);

	if (!sender) {
		return AssignResult.SenderDoesNotExist;
	}
	if (!receiver) {
		return AssignResult.ReceiverDoesNotExist;
	}

	const senderOwnPoints = sender.ownPoints;
	const senderPoints = getPoints(senderKey);
	const senderPointTally = tallyPoints(senderPoints);

	const senderTotalPoints = senderPointTally + senderOwnPoints;

	if (senderTotalPoints < points) {
		return AssignResult.NotEnoughPoints;
	}

	const toCredit = await debitPoints(sender, points, epoch);

	if (toCredit.length == 0) {
		return AssignResult.DeductFailed;
	}
	if (receiver.optsIn && !getBlockedUsers(receiverKey).has(senderKey)) {
		creditPoints(receiver, toCredit, epoch);
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

	const senderPoints = pointMap.get(sender) ?? new Map();
	const senderAssignedPoints = tallyPoints(Array.from(senderPoints.values()));
	const fromTotalPoints = senderAssignedPoints + senderUser.ownPoints;
	if (fromTotalPoints < points) {
		return AssignResult.NotEnoughPoints;
	}

	// Now we can transfer
	const pointsToReceiver = BigInt(Math.ceil(Number(points) * (1 - MORAT_PCT)));
	const pointsToMorat = points - pointsToReceiver;

	const result = await assignPointsWorker(
		sender,
		receiver,
		pointsToReceiver,
		epoch
	);
	if (result != AssignResult.Ok) {
		return result;
	}
	if (pointsToMorat > 0) {
		return assignPointsWorker(sender, MORAT_USER, pointsToMorat, epoch);
	}
	return AssignResult.Ok;
}

/**
 * Decays the points of all users by DECAY_RATE, using a floor - this means
 * that we will not keep less than 1 point for a specific user assignment.
 *
 * @param epoch Epoch to assign for the update
 */
export function decayPoints(epoch: bigint) {
	const keysToDelete = new Set<string>();
	for (const [key, userPointsMap] of pointMap.entries()) {
		const sendersToDelete = new Set<string>();
		for (const [fromKey, userPoints] of userPointsMap.entries()) {
			const newPoints = Math.floor(
				Number(userPoints.points) * (1 - DECAY_RATE)
			);
			if (newPoints > 0) {
				userPoints.points = BigInt(newPoints);
				userPoints.epoch = epoch;
			} else {
				sendersToDelete.add(fromKey);
			}
		}
		for (const key of sendersToDelete) {
			userPointsMap.delete(key);
		}
		if (userPointsMap.size == 0) {
			keysToDelete.add(key);
		}
	}
	for (const key of keysToDelete) {
		pointMap.delete(key);
	}
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
	await topUpPoints(epoch);
	decayPoints(epoch);
	pruneQueuedPoints(epoch);
}

export function getPoints(id: string): UserPoints[] {
	const values = pointMap.get(id)?.values();
	return values ? Array.from(values) : [];
}

export function getQueuedPoints(id: string): UserPointAssignment[] {
	return queuedAssignments.get(id) ?? [];
}
