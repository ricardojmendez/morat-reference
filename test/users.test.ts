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
	test('getting a non-existent user is undefined', async () => {
		await clearUsers();
		const user = await getUser('non-existent');
		expect(user).toBeNull();
	});

	test('validating user existence', async () => {
		await clearUsers();
		const result = await userExists('non-existent');
		expect(result).toBeFalse();
	});

	test('create a user', async () => {
		const user = await createUser('test-user', 1n);
		expect(user).toBeDefined();
		expect(user?.epochSignUp).toBe(1n);
		expect(user?.ownPoints).toBe(1000n);
		expect(user?.key).toBe('test-user');
	});

	test('obtain user after creation', async () => {
		await createUser('get-after', 1n);
		const user = await getUser('get-after');
		expect(user).toBeDefined();
		expect(user!.epochSignUp).toBe(1n);
		expect(user!.ownPoints).toBe(1000n);
		expect(user!.key).toBe('get-after');
	});
});

describe('list', () => {
	test('returns only morat if no users', async () => {
		await clearUsers();
		const users = await userList();
		expect(users).toBeArrayOfSize(1);
		expect(users).toContain('morat');
	});

	test('single user after addition', async () => {
		await clearUsers();
		await createUser('alpha', 1n);
		const users = await userList();
		expect(users).toContain('alpha');
		expect(users).toBeArrayOfSize(2);
	});

	test('list returns all users', async () => {
		await createUser('beta', 1n);
		await createUser('gamma', 2n);
		const users = await userList();
		expect(users).toContain('alpha');
		expect(users).toContain('beta');
		expect(users).toContain('gamma');
		expect(users).toBeArrayOfSize(4);
	});
});

describe('blocking', () => {
	test('no blocked users by default', async () => {
		await clearUsers();
		await createUser('jane', 1n);
		const blocked = await getBlockedUsers('jane');
		expect(blocked).toBeEmpty();
	});

	test('block a user', async () => {
		await clearUsers();
		await createUser('jane', 1n);
		await createUser('troll', 0n);
		await createUser('nazi', 2n);
		await blockUser('jane', 'troll');
		await blockUser('jane', 'nazi');
		const blocked = await getBlockedUsers('jane');
		expect(blocked).toHaveLength(2);
		expect(blocked).toContain('troll');
		expect(blocked).toContain('nazi');
	});

	test('cannot block Morat', async () => {
		await clearUsers();
		await createUser('troll', 0n);
		await createUser('jane', 1n);
		await blockUser('jane', 'troll');
		await blockUser('jane', 'morat');
		const blocked = await getBlockedUsers('jane');
		expect(blocked).toHaveLength(1);
		expect(blocked).not.toContain('morat');
	});

	test('unblock a user', async () => {
		await clearUsers();
		await createUser('jane', 1n);
		await createUser('troll', 0n);
		await createUser('mistake', 2n);
		await blockUser('jane', 'troll');
		await blockUser('jane', 'mistake');
		const blockedPre = await getBlockedUsers('jane');
		expect(blockedPre).toHaveLength(2);
		await unblockUser('jane', 'mistake');
		// Yeah, we could just keep the const because it's altered in-place, but let's not assume
		const blockedPost = await getBlockedUsers('jane');
		expect(blockedPost).toHaveLength(1);
		expect(blockedPost).not.toContain('mistake');
	});

	test('unblocking works even if the user had never been blocked', async () => {
		await clearUsers();
		await createUser('jane', 1n);
		await createUser('troll', 0n);
		await createUser('mistake', 2n);
		await blockUser('jane', 'troll');
		await blockUser('jane', 'mistake');
		const blockedPre = await getBlockedUsers('jane');
		expect(blockedPre).toHaveLength(2);
		expect(blockedPre).not.toContain('jill');
		await unblockUser('jane', 'jill');
		const blockedPost = await getBlockedUsers('jane');
		expect(blockedPost).toHaveLength(2);
		expect(blockedPost).not.toContain('jill');
	});
});
