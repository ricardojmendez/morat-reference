export type User = {
	key: string;
	epochSignUp: number;
	ownPoints: number;
	createDate: number;
	timestamp: number;
	optsIn: boolean;
};

export const MAX_POINTS = 1000;

const users: Map<string, User> = new Map();

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
		ownPoints: 1000,
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

export function userList(): string[] {
	return Array.from(users.keys());
}

/**
 * Clear all users from the system. Used since the state is shared between tests.
 */
export function clearUsers(): void {
	users.clear();
	createUser('morat', 0);
}
