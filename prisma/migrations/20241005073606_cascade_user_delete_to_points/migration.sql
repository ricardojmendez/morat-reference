-- DropForeignKey
ALTER TABLE "UserPoints" DROP CONSTRAINT "UserPoints_assignerId_fkey";

-- DropForeignKey
ALTER TABLE "UserPoints" DROP CONSTRAINT "UserPoints_ownerId_fkey";

-- AddForeignKey
ALTER TABLE "UserPoints" ADD CONSTRAINT "UserPoints_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPoints" ADD CONSTRAINT "UserPoints_assignerId_fkey" FOREIGN KEY ("assignerId") REFERENCES "User"("key") ON DELETE CASCADE ON UPDATE CASCADE;
