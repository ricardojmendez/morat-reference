import { getPoints } from './points';
import { prisma } from './prisma';

export type User = {
	key: string;
	epochSignUp: bigint;
	ownPoints: bigint;
	createDate: bigint;
	timestamp: bigint;
	optsIn: boolean;
};

export const MAX_POINTS = 1000n;
export const MORAT_USER = 'morat';

export async function getUser(id: string): Promise<User | null> {
	return await prisma.user.findUnique({ where: { key: id } });
}

export async function topUpPoints(_epoch: bigint) {
	await prisma.user.updateMany({
		data: { ownPoints: MAX_POINTS },
	});
}

export async function createUser(
	id: string,
	currentEpoch: bigint,
	optsIn = true
): Promise<User | null> {
	const user = {
		key: id,
		epochSignUp: currentEpoch,
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
		console.error(e);
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
		: allUsers.filter((key) => getPoints(key).length > 0);
	return result;
}

export async function blockUser(blocker: string, blockee: string) {
	if (blockee != 'morat') {
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

export async function getBlockedUsers(blocker: string): Promise<Set<string>> {
	const list = (
		await prisma.blockList.findMany({
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
