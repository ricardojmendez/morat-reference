import { prisma } from './prisma';
import { Prisma } from '@prisma/client';

export async function getCurrentEpoch() {
	const result = await prisma.epoch.aggregate({
		_max: {
			id: true,
		},
	});

	return result._max.id;
}

export async function createEpochRecord(
	epoch: bigint,
	tx?: Prisma.TransactionClient
) {
	const client = tx ?? prisma;
	await client.epoch.create({
		data: {
			id: epoch,
		},
	});
}

/**
 * Clear all epochs from the system. Shared since the state is shared between tests.
 */
export async function clearEpochs() {
	await prisma.epoch.deleteMany({});
}

export async function getAllEpochs() {
	return await prisma.epoch.findMany({ orderBy: [{ id: 'asc' }] });
}
