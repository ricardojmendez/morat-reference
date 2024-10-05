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

const blockedUsers: Map<string, Set<string>> = new Map();

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

export function blockUser(blocker: string, blockee: string): void {
	if (blockee != 'morat') {
		const blocked = blockedUsers.get(blocker) ?? new Set();
		blocked.add(blockee);
		blockedUsers.set(blocker, blocked);
	}
}

export function unblockUser(blocker: string, blockee: string): void {
	const blocked = blockedUsers.get(blocker) ?? new Set();
	blocked.delete(blockee);
	blockedUsers.set(blocker, blocked);
}

export function getBlockedUsers(blocker: string): Set<string> {
	return blockedUsers.get(blocker) ?? new Set();
}

/**
 * Clear all users from the system. Used since the state is shared between tests.
 */
export async function clearUsers() {
	await prisma.user.deleteMany({});
	blockedUsers.clear();
	await createUser('morat', 0n);
}
