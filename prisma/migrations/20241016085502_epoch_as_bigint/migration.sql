/*
  Warnings:

  - The primary key for the `Epoch` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "Epoch" DROP CONSTRAINT "Epoch_pkey",
ALTER COLUMN "id" SET DATA TYPE BIGINT,
ADD CONSTRAINT "Epoch_pkey" PRIMARY KEY ("id");
