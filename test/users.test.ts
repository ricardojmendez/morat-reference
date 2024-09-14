import { expect, test, describe } from 'bun:test';
import {
	blockUser,
	clearUsers,
	createUser,
	getBlockedUsers,
	getUser,
	unblockUser,
	userExists,
	userList,
} from '../src/users';

describe('creation', () => {
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

describe('list', () => {
	test('returns only morat if no users', () => {
		clearUsers();
		const users = userList();
		expect(users).toBeArrayOfSize(1);
		expect(users).toContain('morat');
	});

	test('single user after addition', () => {
		clearUsers();
		createUser('alpha', 1);
		const users = userList();
		expect(users).toContain('alpha');
		expect(users).toBeArrayOfSize(2);
	});

	test('list returns all users', () => {
		createUser('beta', 1);
		createUser('gamma', 2);
		const users = userList();
		expect(users).toContain('alpha');
		expect(users).toContain('beta');
		expect(users).toContain('gamma');
		expect(users).toBeArrayOfSize(4);
	});
});

describe('blocking', () => {
	test('no blocked users by default', () => {
		clearUsers();
		createUser('jane', 1);
		const blocked = getBlockedUsers('jane');
		expect(blocked).toBeEmpty();
	});

	test('block a user', () => {
		clearUsers();
		createUser('jane', 1);
		createUser('troll', 0);
		blockUser('jane', 'troll');
		blockUser('jane', 'nazi');
		const blocked = getBlockedUsers('jane');
		expect(blocked).toHaveLength(2);
		expect(blocked).toContain('troll');
		expect(blocked).toContain('nazi');
	});

	test('cannot block Morat', () => {
		clearUsers();
		createUser('jane', 1);
		createUser('morat', 0);
		blockUser('jane', 'troll');
		blockUser('jane', 'morat');
		const blocked = getBlockedUsers('jane');
		expect(blocked).toHaveLength(1);
		expect(blocked).not.toContain('morat');
	});

	test('unblock a user', () => {
		clearUsers();
		createUser('jane', 1);
		createUser('troll', 0);
		blockUser('jane', 'troll');
		blockUser('jane', 'mistake');
		const blockedPre = getBlockedUsers('jane');
		expect(blockedPre).toHaveLength(2);
		unblockUser('jane', 'mistake');
		// Yeah, we could just keep the const because it's altered in-place, but let's not assume
		const blockedPost = getBlockedUsers('jane');
		expect(blockedPost).toHaveLength(1);
		expect(blockedPost).not.toContain('mistake');
	});

	test('unblocking works even if the user had never been blocked', () => {
		clearUsers();
		createUser('jane', 1);
		createUser('troll', 0);
		blockUser('jane', 'troll');
		blockUser('jane', 'mistake');
		const blockedPre = getBlockedUsers('jane');
		expect(blockedPre).toHaveLength(2);
		expect(blockedPre).not.toContain('jill');
		unblockUser('jane', 'jill');
		const blockedPost = getBlockedUsers('jane');
		expect(blockedPost).toHaveLength(2);
		expect(blockedPost).not.toContain('jill');
	});
});
