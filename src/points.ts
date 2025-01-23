import {
	MORAT_USER,
	clearUsers,
	getBlockedUsers,
	getUser,
	topUpPoints,
	User,
} from './users';
import { clearEpochs, createEpochRecord, epochExists } from './epochs';
import { prisma } from './prisma';
import { Prisma } from '@prisma/client';

export type UserPoints = {
	id?: number;
	assignerId: string;
	points: bigint;
	epoch: bigint;
};

export type UserPointAssignment = {
	assignerId: string;
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
	await clearEpochs();
	queuedAssignments.clear();
}

/**
 * Returns the total user points assigned to a user.
 *
 * @param ownerId Owner to query for.
 * @returns Total accumulated points or 0n if it can find no assigned points.
 */
export async function tallyAssignedPoints(
	ownerId: string,
	client: Prisma.TransactionClient = prisma
): Promise<bigint> {
	const result = await client.$queryRaw<
		[{ tally_assigned_points: bigint }]
	>`SELECT tally_assigned_points(${ownerId});`;

	return result[0].tally_assigned_points;
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
	const senderOthersPoints = Number(user.othersPoints);
	// We assume the user points were loaded before, or the operation will fail - this helps reduce queries
	const senderPoints = user.points ?? [];
	const senderPointTally = Number(await tallyAssignedPoints(user.key));

	const senderTotalPoints = senderPointTally + senderOwnPoints;

	if (senderTotalPoints < total) {
		return [];
	}

	const fromOwnPointsPct = senderOwnPoints / senderTotalPoints;
	const fromOthersPointsPct = senderOthersPoints / senderTotalPoints;

	// We do a ceiling on own points because this will skew towards transfering
	// own points instead of received, so we keep more of what we've been sent,
	// and subtract those that get replenished every epoch.
	const totalNum = Number(total);
	const fromOwnPointsTransfer = Math.ceil(totalNum * fromOwnPointsPct);
	const fromOthersPointsTransfer = Math.ceil(totalNum * fromOthersPointsPct);

	const fromAssignedPointsTransfer =
		totalNum - fromOwnPointsTransfer - fromOthersPointsTransfer;

	const pointsResult = [];
	if (total > 0n) {
		const pointsAfterDeduct = [];
		const pointsToDelete = [];

		const assignedPoints = senderPointTally - senderOthersPoints;

		for (const userPoints of senderPoints) {
			const pointSegment =
				(Number(userPoints.points) / assignedPoints) *
				fromAssignedPointsTransfer;
			const pointsToTransfer = BigInt(Math.floor(pointSegment));
			const pointsToWithdraw = BigInt(Math.ceil(pointSegment));

			if (pointsToWithdraw <= 0 && pointsToTransfer <= 0) {
				pointsAfterDeduct.push({
					id: userPoints.id!,
					points: userPoints.points,
					epoch,
				});
				continue;
			}

			const afterDeduct = userPoints.points - pointsToWithdraw;
			if (afterDeduct > 0) {
				pointsAfterDeduct.push({
					id: userPoints.id!,
					points: afterDeduct,
					epoch,
				});
			} else {
				pointsToDelete.push(userPoints.id!);
			}

			// We don't allow points transfer from one user to the themselves, or a transfer below the minimum,
			// but the sender can lose the points.
			if (pointsToTransfer < MIN_POINT_TRANSFER) {
				continue;
			}

			pointsResult.push({
				assignerId: userPoints.assignerId,
				points: pointsToTransfer,
				epoch,
			});
		}

		await tx.user.update({
			where: { key: user.key },
			data: {
				ownPoints: user.ownPoints - BigInt(fromOwnPointsTransfer),
				othersPoints: user.othersPoints - BigInt(fromOthersPointsTransfer),
				points: {
					deleteMany: {
						id: { in: pointsToDelete },
					},
					updateMany: pointsAfterDeduct.map((p) => ({
						where: { id: p.id },
						data: { points: p.points, epoch: p.epoch },
					})),
				},
			},
		});
	}

	pointsResult.push({
		assignerId: user.key,
		points: BigInt(fromOwnPointsTransfer + fromOthersPointsTransfer),
		epoch,
	});
	return pointsResult;
}

async function getUserPointsForUpdate(
	user: User,
	assignerIds: string[],
	tx: Prisma.TransactionClient
) {
	return await tx.$queryRaw<UserPoints[]>`
                    SELECT * FROM "UserPoints" WHERE "ownerId" = ${user.key}
                    AND "assignerId" IN (${Prisma.join(assignerIds)})
                    FOR UPDATE
                `;
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
	const assignerIds = points.map((p) => p.assignerId);
	const userPoints = await getUserPointsForUpdate(user, assignerIds, tx);
	const finalPoints =
		userPoints.map((point) => ({
			id: point.id,
			assignerId: point.assignerId,
			points: point.points,
			epoch: point.epoch,
		})) ?? [];
	for (const toCredit of points) {
		// User will not receive points from themselves
		if (
			user.key == toCredit.assignerId ||
			toCredit.points < MIN_POINT_TRANSFER
		) {
			continue;
		}

		const pointRecord = finalPoints.find(
			(point) => point.assignerId == toCredit.assignerId
		);
		if (!pointRecord) {
			finalPoints.push({
				id: undefined,
				assignerId: toCredit.assignerId,
				points: toCredit.points,
				epoch,
			});
		} else {
			pointRecord.points += toCredit.points;
			pointRecord.epoch = epoch;
		}
	}
	// We just update the points once. If we decide to cache the result as
	// represented in finalPoints above, we need to keep in mind that the
	// new elements will not have an id, which would be a problem for future
	// updates.
	//
	// The alternative is to re-query after saving, which will get us the
	// query hit cost anyway.
	//
	// This is a problem for when we do optimization, not for right now.
	// It may be that a document store is the best way to keep these things
	// in the end, that way we stop worrying about things like if indices for
	// a sub-element have been updated and just query for the document.
	//
	// Then again, I could also just make my life easier and remove the ID
	// altogether, using the assignerId/ownerId pair as the primary key (like
	// I had it before) and just update based on assigner, or simply save the
	// points as JSON directly on Postgres.
	await tx.user.update({
		where: { key: user.key },
		data: {
			points: {
				updateMany: finalPoints
					.filter((p) => p.id)
					.map((p) => ({
						where: { id: p.id },
						data: { points: p.points, epoch: p.epoch },
					})),
				create: finalPoints.filter((p) => !p.id),
			},
		},
	});
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
	const user = await getUser(userKey, undefined, { points: true });
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
					assignerId: point.assignerId,
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

	if (points <= 0n) {
		return AssignResult.PointsShouldBePositive;
	}

	const sender = await getUser(senderKey, tx, { points: true });
	// We don't need to get the receiver within the transaction because we don't modify it.
	const receiver = await getUser(receiverKey);

	if (!sender) {
		return AssignResult.SenderDoesNotExist;
	}
	if (!receiver) {
		return AssignResult.ReceiverDoesNotExist;
	}

	const senderOwnPoints = sender.ownPoints;
	const senderPointTally = await tallyAssignedPoints(sender.key);

	const senderTotalPoints = senderPointTally + senderOwnPoints;

	if (senderTotalPoints < points) {
		return AssignResult.NotEnoughPoints;
	}

	const toCredit = await debitPoints(tx, sender, points, epoch);

	if (toCredit.length == 0) {
		return AssignResult.DeductFailed;
	}
	const blockedUsers = await getBlockedUsers(receiverKey, tx);
	if (receiver.optsIn && !blockedUsers.has(senderKey)) {
		await creditPoints(tx, receiver, toCredit, epoch);
	} else {
		const queued = getQueuedPoints(receiverKey);
		queued.push({ assignerId: senderKey, epoch, points: toCredit });
		queuedAssignments.set(receiverKey, queued);
	}
	return AssignResult.Ok;
}

/**
 * Assigns a number of points from a sender to a receiver.
 * @param sender User assigning the points
 * @param receiver Point receiver
 * @param points Total number of points
 * @param epoch Epoch that the point assignment takes place on
 * @returns AssignResult status
 */
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

	const senderAssignedPoints = await tallyAssignedPoints(senderUser.key);
	const fromTotalPoints = senderAssignedPoints + senderUser.ownPoints;
	if (fromTotalPoints < points) {
		return AssignResult.NotEnoughPoints;
	}

	// Now we can transfer
	const pointsToReceiver = BigInt(Math.ceil(Number(points) * (1 - MORAT_PCT)));
	const pointsToMorat = points - pointsToReceiver;

	try {
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
				isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
				maxWait: 50,
				timeout: 100000,
			}
		);

		return result ?? AssignResult.UnknownError;
	} catch {
		// console.error(`Error sending from ${sender} to ${receiver}`, e);
		return AssignResult.UnknownError;
	}
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
	tx?: Prisma.TransactionClient,
	userIds: string[] = []
) {
	const client = tx ?? prisma;

	await client.$executeRaw`CALL decay_points(${epoch}, ${userIds});`;
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

/**
 * Gets through a list of user ids and, for each user, keeps only the top N
 * point contributors while collaprasing the rest into a single "others"
 * assignment. We do this once per epoch, instead of on every assignment,
 * because otherwise users who just starting assigning them points would
 * always end up in that bucket.
 * @param ids User ids to collapse points for
 * @param keepTop Maximum number of top contributors to keep
 * @param client Prisma client, in case we have an open transaction
 */
export async function collapsePoints(
	ids: string[],
	keepTop = 1000,
	deleteBatchSize = 10000,
	client: Prisma.TransactionClient = prisma
) {
	for (const id of ids) {
		const user = await getUser(id, client, { points: true });
		if (!user) {
			continue;
		}
		const userPoints = user.points ?? [];

		const sortedPoints = userPoints.sort((a, b) => Number(b.points - a.points));

		const pointsToCollapse = sortedPoints.slice(keepTop);
		if (pointsToCollapse.length > 0) {
			// Add the points to the "others" user or create a new record
			const pointsToCollapseSum = pointsToCollapse.reduce(
				(acc, p) => acc + p.points,
				0n
			);
			const pointsToDelete = pointsToCollapse.map((p) => p.id!);

			// Separate these in two calls, because we may have too many points
			// to delete when collapsing and Postgres could barf.
			await client.user.update({
				where: {
					key: id,
				},
				data: {
					othersPoints: user.othersPoints + pointsToCollapseSum,
				},
			});
			// ... and yes, we could do an if and have one of the calls act
			// entirely on user like I had before, but this will likely be
			// split in two calls on the back end anyway, and it reads much
			// cleaner this way.
			for (let i = 0; i < pointsToDelete.length; i += deleteBatchSize) {
				const deleteSlice = pointsToDelete.slice(i, i + deleteBatchSize);
				await client.userPoints.deleteMany({
					where: {
						id: { in: deleteSlice },
					},
				});
			}
		}
	}
}

export async function epochTick(
	epoch: bigint,
	userBatchSize = 100,
	keepTopN = 1000
) {
	let pendingUserIds = [];
	do {
		/*
            We will do periodic commits of the changes, because if we do it all
            inside a single transaction we are effectively locking up the entire
            set of users and user points.            
         */
		await prisma.$transaction(
			async (tx) => {
				const exists = await epochExists(epoch, tx);
				if (!exists) {
					await createEpochRecord(epoch, tx);
				}
				pendingUserIds = await tx.user.findMany({
					where: {
						epochUpdate: {
							lt: epoch,
						},
					},
					select: {
						key: true,
					},
					orderBy: [{ epochUpdate: 'asc' }],
					skip: 0,
					take: userBatchSize,
				});

				if (pendingUserIds.length > 0) {
					// console.log(`Processing ${pendingUserIds.length} users`);
					const ids = pendingUserIds.map((u) => u.key);
					await topUpPoints(epoch, tx, ids);
					await collapsePoints(ids, keepTopN, 10000, tx);
					await decayPoints(epoch, tx, ids);
				}
			},
			{
				isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
				maxWait: 5000,
				timeout: 100000,
			}
		);
	} while (pendingUserIds.length > 0);
	pruneQueuedPoints(epoch);

	return epoch;
}

export async function getPoints(
	id: string,
	client: Prisma.TransactionClient = prisma,
	includePointIds = false
): Promise<UserPoints[]> {
	const userPointsFromDB = await client.userPoints.findMany({
		where: { ownerId: id },
	});
	const points: UserPoints[] = includePointIds
		? userPointsFromDB
		: userPointsFromDB.map((point) => ({
				assignerId: point.assignerId,
				points: point.points,
				epoch: point.epoch,
			}));
	return points;
}

export function getQueuedPoints(id: string): UserPointAssignment[] {
	return queuedAssignments.get(id) ?? [];
}

export async function registerIntent(
	sender: string,
	receiver: string,
	points: bigint,
	epoch: bigint
) {
	try {
		return await prisma.pointAssignIntent.create({
			data: { assignerId: sender, ownerId: receiver, points, epoch },
		});
	} catch {
		return undefined;
	}
}

export async function getPendingIntents(startAt = 0, maxCount = 20) {
	// I could add a distinct to this query, to make sure we don't
	// get rows that might conflict, but that seems to make the process
	// slower. It's cleaner to expect processIntents to skip or handle
	// them serially.
	return await prisma.pointAssignIntent.findMany({
		orderBy: [{ id: 'asc' }],
		skip: startAt,
		take: maxCount,
	});
}

/**
 * Processes all pending point assign intents, up to a maximum count.
 * @param epoch Current epoch
 * @param maxCount Max number of itents to process
 * @returns IDs for the intents that were successfully processed
 */
export async function processIntents(epoch: bigint, maxCount = 20) {
	try {
		const pendingIntents = await getPendingIntents(0, maxCount);

		const successfulIdx = [];
		const irrecoverableErrorIdx = [];
		const retrySerially = [];
		const knownIds = new Set();

		const tryParallel = [];
		for (const intent of pendingIntents) {
			let known = false;
			for (const id of [intent.ownerId, intent.assignerId]) {
				if (!knownIds.has(id)) {
					knownIds.add(id);
				} else {
					known = true;
				}
			}
			if (!known) {
				tryParallel.push(intent);
			} else {
				retrySerially.push(intent);
			}
		}

		// We use the current epoch and discard the original one
		const assignResults = await Promise.all(
			tryParallel.map((p) =>
				assignPoints(p.assignerId, p.ownerId, p.points, epoch)
			)
		);

		for (let i = 0; i < assignResults.length; i++) {
			const result = assignResults[i];
			if (result === AssignResult.Ok) {
				successfulIdx.push(pendingIntents[i].id);
			} else if (result != AssignResult.UnknownError) {
				irrecoverableErrorIdx.push(pendingIntents[i].id);
			} else {
				retrySerially.push(pendingIntents[i]);
			}
		}

		for (const p of retrySerially) {
			const result = await assignPoints(
				p.assignerId,
				p.ownerId,
				p.points,
				epoch
			);
			if (result === AssignResult.Ok) {
				successfulIdx.push(p.id);
			} else if (result != AssignResult.UnknownError) {
				irrecoverableErrorIdx.push(p.id);
			}
		}

		await prisma.pointAssignIntent.deleteMany({
			where: {
				id: { in: [...successfulIdx, ...irrecoverableErrorIdx] },
			},
		});

		return successfulIdx.sort((a, b) => a - b);
	} catch (e) {
		console.error(`Error processing intents: ${e}`);
		return [];
	}
}
