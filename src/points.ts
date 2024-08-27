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

	// We do a cailing on own points because this will skew towards transfering
	// own points instead of received, so we keep more of what we've been sent,
	// and subtract those that get replenished every epoch.
	const fromOwnPointsTransfer = Math.floor(points * fromOwnPointsPct);
	const fromAssignedPointsTransfer = points - fromOwnPointsTransfer;

	const toUserPoints = pointMap.get(toKey) ?? new Map();
	const [fromPointsResult, toPointsResult] = transferPoints(
		toKey,
		fromAssignedPointsTransfer,
		fromUserPoints,
		toUserPoints,
		epoch
	);
	pointMap.set(fromKey, fromPointsResult);
	pointMap.set(toKey, toPointsResult);

	fromUser.ownPoints -= fromOwnPointsTransfer;
	const fromKeyPoints = toUserPoints.get(fromKey) ?? {
		fromKey,
		points: 0,
		epoch,
	};
	fromKeyPoints.points += fromOwnPointsTransfer;
	toUserPoints.set(fromKey, fromKeyPoints);

	return AssignResult.Ok;
}

export function epochTick(currentEpoch: number): void {
	for (const key of userList()) {
		const user = getUser(key);
		if (user) {
			topUpPoints(user, currentEpoch);
		}
	}
}

export function getPoints(id: string): UserPointsMap | undefined {
	return pointMap.get(id);
}
