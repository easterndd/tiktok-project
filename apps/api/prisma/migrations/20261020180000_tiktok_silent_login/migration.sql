CREATE TABLE "TikTokCredential" (
    "userId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT,
    "tokenType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TikTokCredential_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "TikTokCredential" ADD CONSTRAINT "TikTokCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
