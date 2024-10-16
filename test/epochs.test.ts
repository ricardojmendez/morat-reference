import { expect, test, describe } from 'bun:test';
import {
	getAllEpochs,
	getCurrentEpoch,
	clearEpochs,
	createEpochRecord,
} from '../src/epochs';

describe('creation', () => {
	test('getting an epoch without any created returns null', async () => {
		await clearEpochs();
		const epoch = await getCurrentEpoch();
		expect(epoch).toBeNull();
	});

	test('we can get an epoch after creating it', async () => {
		await clearEpochs();
		await createEpochRecord(0n);
		const epoch = await getCurrentEpoch();
		expect(epoch).toEqual(0n);
	});

	test('creating multiple epochs always returns the latest', async () => {
		await clearEpochs();
		await createEpochRecord(0n);
		await createEpochRecord(1n);
		await createEpochRecord(2n);
		await createEpochRecord(4n);
		await createEpochRecord(8n);
		const epoch = await getCurrentEpoch();
		expect(epoch).toEqual(8n);
	});

	test('we can retrieve all epochs created', async () => {
		await clearEpochs();
		await createEpochRecord(0n);
		await createEpochRecord(1n);
		await createEpochRecord(2n);
		await createEpochRecord(3n);
		await createEpochRecord(5n);
		await createEpochRecord(7n);
		const epochs = await getAllEpochs();
		expect(epochs).toHaveLength(6);
		expect(epochs.map((e) => e.id)).toEqual([0n, 1n, 2n, 3n, 5n, 7n]);
	});
});
