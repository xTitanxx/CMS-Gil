-- AlterEnum
ALTER TYPE "Platform" ADD VALUE 'THREADS';
ALTER TYPE "Platform" ADD VALUE 'SUBSTACK';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "substackPublicationUrl" TEXT;
