-- CreateTable
CREATE TABLE "User" (
    "key" TEXT NOT NULL,
    "epochSignUp" INTEGER NOT NULL,
    "ownPoints" INTEGER NOT NULL,
    "createDate" INTEGER NOT NULL,
    "timestamp" INTEGER NOT NULL,
    "optsIn" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("key")
);
