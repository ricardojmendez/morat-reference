-- CreateTable
CREATE TABLE "PointAssignIntent" (
    "id" SERIAL NOT NULL,
    "points" BIGINT NOT NULL,
    "epoch" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT NOT NULL,
    "assignerId" TEXT NOT NULL,

    CONSTRAINT "PointAssignIntent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PointAssignIntent" ADD CONSTRAINT "PointAssignIntent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAssignIntent" ADD CONSTRAINT "PointAssignIntent_assignerId_fkey" FOREIGN KEY ("assignerId") REFERENCES "User"("key") ON DELETE CASCADE ON UPDATE CASCADE;
