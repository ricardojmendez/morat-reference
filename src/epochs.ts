import { prisma } from './prisma';
import { Prisma } from '@prisma/client';

export async function getCurrentEpochDetails() {
	const result = await prisma.epoch.aggregate({
		_max: {
			id: true,
			timestamp: true,
		},
	});

	return result;
}

export async function getCurrentEpoch() {
	const result = await getCurrentEpochDetails();
	return result._max.id;
}

export async function createEpochRecord(
	epoch: bigint,
	tx: Prisma.TransactionClient = prisma
) {
	await tx.epoch.create({
		data: {
			id: epoch,
		},
	});
}

export async function epochExists(
	epoch: bigint,
	tx: Prisma.TransactionClient = prisma
) {
	const epochInstance = await getEpoch(epoch, tx);
	return epochInstance !== null;
}

export async function getEpoch(
	epoch: bigint,
	tx: Prisma.TransactionClient = prisma
) {
	return await tx.epoch.findFirst({ where: { id: epoch } });
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
