import { expect, test, describe } from 'bun:test';
import {
	clearUsers,
	createUser,
	getUser,
	userExists,
	userList,
} from '../src/users';

describe('user creation', () => {
	test('getting a non-existent user is undefined', () => {
		clearUsers();
		const user = getUser('non-existent');
		expect(user).toBeUndefined();
	});

	test('validating user existence', () => {
		clearUsers();
		const result = userExists('non-existent');
		expect(result).toBeFalse();
	});

	test('create a user', () => {
		const user = createUser('test-user', 1);
		expect(user.epochSignUp).toBe(1);
		expect(user.ownPoints).toBe(1000);
		expect(user.key).toBe('test-user');
	});

	test('obtain user after creation', () => {
		createUser('get-after', 1);
		const user = getUser('get-after');
		expect(user).toBeDefined();
		expect(user!.epochSignUp).toBe(1);
		expect(user!.ownPoints).toBe(1000);
		expect(user!.key).toBe('get-after');
	});
});

describe('user list', () => {
	test('returns empty if no users', () => {
		clearUsers();
		const users = userList();
		expect(users).toBeEmpty();
	});

	test('single user after addition', () => {
		clearUsers();
		createUser('alpha', 1);
		const users = userList();
		expect(users).toContain('alpha');
		expect(users).toBeArrayOfSize(1);
	});

	test('list returns all users', () => {
		createUser('beta', 1);
		createUser('gamma', 2);
		const users = userList();
		expect(users).toContain('alpha');
		expect(users).toContain('beta');
		expect(users).toContain('gamma');
		expect(users).toBeArrayOfSize(3);
	});
});
