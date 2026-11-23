-- The singleton is provisioned out of band after target-database audit.
-- Never insert a marker automatically: service startup must fail closed until
-- an operator explicitly binds the isolated database and Firebase project.
CREATE TABLE "DeploymentNamespace" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "namespaceId" TEXT NOT NULL,
    "firebaseProjectId" TEXT NOT NULL,

    CONSTRAINT "DeploymentNamespace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeploymentNamespace_namespaceId_key" ON "DeploymentNamespace"("namespaceId");
