import { getPoints, UserPoints } from './points';
import { prisma } from './prisma';
import { Prisma } from '@prisma/client';

export type User = {
	key: string;
	epochSignUp: bigint;
	epochUpdate: bigint;
	ownPoints: bigint;
	createDate: bigint;
	timestamp: bigint;
	optsIn: boolean;
	othersPoints: bigint;
	points?: UserPoints[];
};

export const MAX_POINTS = 1000n;
export const MORAT_USER = 'morat';

export async function getUser(
	id: string,
	tx?: Prisma.TransactionClient,
	include = {}
): Promise<User | null> {
	const client = tx ?? prisma;
	if (!tx) {
		return await client.user.findUnique({ where: { key: id }, include });
	} else {
		const result = await client.$queryRaw<
			User[]
		>`SELECT * FROM "User" WHERE "key" = ${id} FOR UPDATE`;
		const user = result.length > 0 ? result[0] : null;

		if (user && Object.keys(include).length > 0) {
			const includedData: any = {};

			// @ts-ignore
			if (include.points) {
				includedData.points = await client.$queryRaw<UserPoints[]>`
                    SELECT * FROM "UserPoints" WHERE "ownerId" = ${id} FOR UPDATE
                `;
			}

			// @ts-ignore
			if (include.assigned) {
				includedData.assigned = await client.$queryRaw<UserPoints[]>`
                    SELECT * FROM "UserPoints" WHERE "assignerId" = ${id} FOR UPDATE
                `;
			}

			return { ...user, ...includedData };
		}
		return user;
	}
}

export async function topUpPoints(
	epoch: bigint,
	tx?: Prisma.TransactionClient,
	userIds: string[] = []
) {
	const client = tx ?? prisma;
	await client.$executeRaw`CALL top_up_points(${epoch},  ${MAX_POINTS}, ${userIds});`;
}

export async function createUser(
	id: string,
	currentEpoch: bigint,
	optsIn = true
): Promise<User | null> {
	const user = {
		key: id,
		epochSignUp: currentEpoch,
		epochUpdate: currentEpoch,
		ownPoints: MAX_POINTS,
		createDate: BigInt(Date.now()),
		timestamp: BigInt(Date.now()),
		optsIn,
	};
	let result: User | null = null;
	try {
		result = await prisma.user.create({ data: user });
		// console.log(createUser);
	} catch (e) {
		// console.error(e);
	}
	return result;
}

export async function userExists(id: string): Promise<boolean> {
	return (
		(await prisma.user.count({
			where: { key: id },
		})) > 0
	);
}

export async function userList(all = true): Promise<string[]> {
	const allUsers = (await prisma.user.findMany({ select: { key: true } })).map(
		(user) => user.key
	);
	const result = all
		? allUsers
		: allUsers.filter(async (key) => (await getPoints(key)).length > 0);
	return result;
}

export async function blockUser(blocker: string, blockee: string) {
	if (blockee != MORAT_USER) {
		const blockerUser = await getUser(blocker);
		const blockedUser = await getUser(blockee);
		if (!blockerUser || !blockedUser) {
			return;
		}

		const existingBlock = await prisma.blockList.findFirst({
			where: {
				blockerId: blocker,
				blockedId: blockee,
			},
		});
		if (!existingBlock) {
			await prisma.blockList.create({
				data: {
					blockerId: blocker,
					blockedId: blockee,
				},
			});
		}
	}
}

export async function unblockUser(blocker: string, blockee: string) {
	await prisma.blockList.deleteMany({
		where: { blockerId: blocker, blockedId: blockee },
	});
}

export async function getBlockedUsers(
	blocker: string,
	tx?: Prisma.TransactionClient
): Promise<Set<string>> {
	const client = tx ?? prisma;
	const list = (
		await client.blockList.findMany({
			where: { blockerId: blocker },
			select: { blockedId: true },
		})
	).map((block) => block.blockedId);
	return new Set(list);
}

/**
 * Clear all users from the system. Used since the state is shared between tests.
 */
export async function clearUsers() {
	await prisma.user.deleteMany({});
	await createUser('morat', 0n);
}
