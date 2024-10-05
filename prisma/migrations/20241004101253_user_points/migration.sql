-- CreateTable
CREATE TABLE "BlockList" (
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,

    CONSTRAINT "BlockList_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "UserPoints" (
    "points" INTEGER NOT NULL,
    "epoch" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assignerId" TEXT NOT NULL,

    CONSTRAINT "UserPoints_pkey" PRIMARY KEY ("ownerId","assignerId")
);

-- AddForeignKey
ALTER TABLE "BlockList" ADD CONSTRAINT "BlockList_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockList" ADD CONSTRAINT "BlockList_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPoints" ADD CONSTRAINT "UserPoints_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPoints" ADD CONSTRAINT "UserPoints_assignerId_fkey" FOREIGN KEY ("assignerId") REFERENCES "User"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
