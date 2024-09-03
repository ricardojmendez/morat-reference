import { clearUsers, getUser, userList, topUpPoints } from './users';

export type UserPoints = {
	fromKey: string;
	points: number;
	epoch: number;
};

/**
 * Maps users to an array of points that others users have assigned to them.
 */
export type UserPointsMap = Map<string, UserPoints>;

export const DECAY_RATE = 0.1; // Every epoch, 10% of the assigned points are lost.

const minPointTransfer = 1;

const pointMap: Map<string, UserPointsMap> = new Map();

/**
 * Clear all users and points from the system. Used since the state is shared between tests.
 */
export function clearPointsAndUsers() {
	clearUsers();
	pointMap.clear();
}

export function tallyPoints(userPoints: UserPoints[]): number {
	return userPoints.reduce((acc, { points }) => acc + points, 0);
}

function transferPoints(
	toKey: string,
	total: number,
	fromPoints: UserPointsMap,
	toPoints: UserPointsMap,
	epoch: number
): [UserPointsMap, UserPointsMap] {
	if (total > 0) {
		const keysToDelete = new Set<string>();
		const tally = tallyPoints(Array.from(fromPoints.values()));
		for (const [fromKey, userPoints] of fromPoints.entries()) {
			const pointSegment = (userPoints.points / tally) * total;
			const pointsToTransfer = Math.floor(pointSegment);
			const pointsToWithdraw = Math.ceil(pointSegment);

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

			// We don't allow points transfer from one user to the themselves, but the original can
			// lose the points.
			if (pointsToTransfer < minPointTransfer || fromKey == toKey) {
				continue;
			}

			let targetPoints = toPoints.get(fromKey);
			if (!targetPoints) {
				targetPoints = { fromKey, points: 0, epoch: 0 };
			}
			targetPoints.epoch = epoch;
			targetPoints.points += pointsToTransfer;
			toPoints.set(fromKey, targetPoints);
		}

		// Let's not modify the map while iterating over it.
		for (const key of keysToDelete) {
			fromPoints.delete(key);
		}
	}
	return [fromPoints, toPoints];
}

export enum AssignResult {
	Ok,
	CantSendToSelf,
	SenderDoesNotExist,
	ReceiverDoesNotExist,
	NotEnoughPoints,
	PointsShouldBePositive,
}

export function assignPoints(
	fromKey: string,
	toKey: string,
	points: number,
	epoch: number
): AssignResult {
	if (fromKey == toKey) {
		return AssignResult.CantSendToSelf;
	}

	if (points <= 0) {
		return AssignResult.PointsShouldBePositive;
	}

	const fromUser = getUser(fromKey);
	const toUser = getUser(toKey);

	if (!fromUser) {
		return AssignResult.SenderDoesNotExist;
	}
	if (!toUser) {
		return AssignResult.ReceiverDoesNotExist;
	}

	const fromUserPoints = pointMap.get(fromKey) ?? new Map();
	const fromAssignedPoints = tallyPoints(Array.from(fromUserPoints.values()));
	const fromOwnPoints = fromUser.ownPoints;
	const fromTotalPoints = fromAssignedPoints + fromOwnPoints;

	if (fromTotalPoints < points) {
		return AssignResult.NotEnoughPoints;
	}

	const fromOwnPointsPct = fromOwnPoints / fromTotalPoints;

	// We do a ceiling on own points because this will skew towards transfering
	// own points instead of received, so we keep more of what we've been sent,
	// and subtract those that get replenished every epoch.
	const fromOwnPointsTransfer = Math.ceil(points * fromOwnPointsPct);
	const fromAssignedPointsTransfer = points - fromOwnPointsTransfer;

	const toUserPoints = pointMap.get(toKey) ?? new Map();
	const [fromPointsResult, toPointsResult] = transferPoints(
		toKey,
		fromAssignedPointsTransfer,
		fromUserPoints,
		toUserPoints,
		epoch
	);
	fromUser.ownPoints -= fromOwnPointsTransfer;
	const fromKeyPoints = toPointsResult.get(fromKey) ?? {
		fromKey,
		points: 0,
		epoch,
	};
	fromKeyPoints.points += fromOwnPointsTransfer;
	toPointsResult.set(fromKey, fromKeyPoints);

	pointMap.set(fromKey, fromPointsResult);
	pointMap.set(toKey, toPointsResult);

	return AssignResult.Ok;
}

/**
 * Decays the points of all users by DECAY_RATE, using a floor - this means
 * that we will not keep less than 1 point for a specific user assignment.
 *
 * @param epoch Epoch to assign for the update
 */
export function decayPoints(epoch: number) {
	const keysToDelete = new Set<string>();
	for (const [key, userPointsMap] of pointMap.entries()) {
		const sendersToDelete = new Set<string>();
		for (const [fromKey, userPoints] of userPointsMap.entries()) {
			const newPoints = Math.floor(userPoints.points * (1 - DECAY_RATE));
			if (newPoints > 0) {
				userPoints.points = newPoints;
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

export function epochTick(epoch: number): void {
	for (const key of userList()) {
		const user = getUser(key);
		if (user) {
			topUpPoints(user, epoch);
		}
	}
	decayPoints(epoch);
}

export function getPoints(id: string): UserPoints[] {
	const values = pointMap.get(id)?.values();
	return values ? Array.from(values) : [];
}
