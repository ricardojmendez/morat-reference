export type User = {
	key: string;
	epochSignUp: number;
	currentPoints: number;
	createDate: number;
	timestamp: number;
};

const users: Map<string, User> = new Map();

export function getUser(id: string): User | undefined {
	return users.get(id);
}

export function createUser(id: string, currentEpoch: number): User {
	const user = {
		key: id,
		epochSignUp: currentEpoch,
		currentPoints: 1000,
		createDate: Date.now(),
		timestamp: Date.now(),
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
