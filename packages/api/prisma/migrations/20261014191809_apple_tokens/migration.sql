-- CreateTable
CREATE TABLE "apple_tokens" (
    "user_id" UUID NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apple_tokens_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "apple_tokens" ADD CONSTRAINT "apple_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

