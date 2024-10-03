import { getPoints } from './points';

export type User = {
	key: string;
	epochSignUp: number;
	ownPoints: number;
	createDate: number;
	timestamp: number;
	optsIn: boolean;
};

export const MAX_POINTS = 1000;
export const MORAT_USER = 'morat';

const users: Map<string, User> = new Map();

const blockedUsers: Map<string, Set<string>> = new Map();

export function getUser(id: string): User | undefined {
	return users.get(id);
}

export function topUpPoints(user: User, _epoch: number): User {
	user.ownPoints = MAX_POINTS;
	users.set(user.key, user);
	return user;
}

export function createUser(
	id: string,
	currentEpoch: number,
	optsIn = true
): User {
	const user = {
		key: id,
		epochSignUp: currentEpoch,
		ownPoints: MAX_POINTS,
		createDate: Date.now(),
		timestamp: Date.now(),
		optsIn,
	};
	users.set(id, user);
	return user;
}

export function userExists(id: string): boolean {
	return users.has(id);
}

export function userList(all = true): string[] {
	const allUsers = Array.from(users.keys());
	const result = all
		? allUsers
		: allUsers.filter((user) => getPoints(user).length > 0);
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
export function clearUsers(): void {
	users.clear();
	blockedUsers.clear();
	createUser('morat', 0);
}
