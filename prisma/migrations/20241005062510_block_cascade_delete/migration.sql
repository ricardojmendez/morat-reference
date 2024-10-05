-- DropForeignKey
ALTER TABLE "BlockList" DROP CONSTRAINT "BlockList_blockedId_fkey";

-- DropForeignKey
ALTER TABLE "BlockList" DROP CONSTRAINT "BlockList_blockerId_fkey";

-- AddForeignKey
ALTER TABLE "BlockList" ADD CONSTRAINT "BlockList_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockList" ADD CONSTRAINT "BlockList_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("key") ON DELETE CASCADE ON UPDATE CASCADE;
