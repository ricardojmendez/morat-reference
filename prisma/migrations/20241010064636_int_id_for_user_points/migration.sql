/*
  Warnings:

  - The primary key for the `UserPoints` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[ownerId,assignerId]` on the table `UserPoints` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "UserPoints" DROP CONSTRAINT "UserPoints_pkey",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "UserPoints_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "UserPoints_ownerId_assignerId_key" ON "UserPoints"("ownerId", "assignerId");
