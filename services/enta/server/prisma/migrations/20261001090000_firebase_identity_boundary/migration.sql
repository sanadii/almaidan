CREATE TABLE "FirebaseIdentity" (
    "id" TEXT NOT NULL,
    "firebaseProjectId" TEXT NOT NULL,
    "firebaseUid" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FirebaseIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FirebaseAdminScope" (
    "id" TEXT NOT NULL,
    "firebaseProjectId" TEXT NOT NULL,
    "firebaseUid" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    CONSTRAINT "FirebaseAdminScope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FirebaseIdentity_userId_key" ON "FirebaseIdentity"("userId");
CREATE UNIQUE INDEX "FirebaseIdentity_firebaseProjectId_firebaseUid_key" ON "FirebaseIdentity"("firebaseProjectId", "firebaseUid");
CREATE INDEX "FirebaseIdentity_firebaseUid_idx" ON "FirebaseIdentity"("firebaseUid");
CREATE UNIQUE INDEX "FirebaseAdminScope_firebaseProjectId_firebaseUid_scope_key" ON "FirebaseAdminScope"("firebaseProjectId", "firebaseUid", "scope");
CREATE INDEX "FirebaseAdminScope_firebaseProjectId_firebaseUid_idx" ON "FirebaseAdminScope"("firebaseProjectId", "firebaseUid");

ALTER TABLE "FirebaseIdentity"
ADD CONSTRAINT "FirebaseIdentity_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FirebaseAdminScope"
ADD CONSTRAINT "FirebaseAdminScope_firebaseProjectId_firebaseUid_fkey"
FOREIGN KEY ("firebaseProjectId", "firebaseUid") REFERENCES "FirebaseIdentity"("firebaseProjectId", "firebaseUid") ON DELETE CASCADE ON UPDATE CASCADE;
