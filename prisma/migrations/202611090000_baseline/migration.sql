-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantProfile" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "brandName" TEXT,
    "logoUrl" TEXT,
    "primaryColor" TEXT DEFAULT '#1a1a1a',
    "accentColor" TEXT DEFAULT '#8a7758',
    "supportEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planStatus" TEXT,
    "shopifyChargeId" TEXT,
    "casePeriodCount" INTEGER NOT NULL DEFAULT 0,
    "casePeriodStart" TIMESTAMP(3),

    CONSTRAINT "MerchantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCatalogueItem" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricingType" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT true,
    "productTypes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCatalogueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareCase" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "shopifyProductId" TEXT,
    "productTitle" TEXT,
    "productImageUrl" TEXT,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "catalogueItemId" TEXT,
    "serviceName" TEXT NOT NULL,
    "issueDescription" TEXT,
    "photos" TEXT,
    "videos" TEXT,
    "status" TEXT NOT NULL DEFAULT 'request_received',
    "quoteLabourCost" DOUBLE PRECISION,
    "quotePartsCost" DOUBLE PRECISION,
    "quoteShippingCost" DOUBLE PRECISION,
    "quoteTax" DOUBLE PRECISION,
    "quoteTaxPercent" DOUBLE PRECISION,
    "quoteTotal" DOUBLE PRECISION,
    "quoteCurrency" TEXT DEFAULT 'GBP',
    "quoteNote" TEXT,
    "quoteSentAt" TIMESTAMP(3),
    "quoteApprovedAt" TIMESTAMP(3),
    "quoteDeclinedAt" TIMESTAMP(3),
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "shopifyOrderIdForPayment" TEXT,
    "shopifyDraftOrderId" TEXT,
    "shopifyInvoiceUrl" TEXT,
    "warrantyClaim" BOOLEAN NOT NULL DEFAULT false,
    "nextServiceDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CareCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "orderNumber" TEXT,
    "productTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareUpdate" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "status" TEXT,
    "note" TEXT,
    "media" TEXT,
    "visibleToCustomer" BOOLEAN NOT NULL DEFAULT true,
    "customerNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CareUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resourceId" TEXT,
    "updateId" TEXT,
    "dedupeKey" TEXT,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailRecipient" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "eventAt" TIMESTAMP(3),

    CONSTRAINT "EmailRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDeliveryEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailResource" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,

    CONSTRAINT "EmailResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantProfile_shop_key" ON "MerchantProfile"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "CareCase_token_key" ON "CareCase"("token");

-- CreateIndex
CREATE UNIQUE INDEX "CareInvite_token_key" ON "CareInvite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_dedupeKey_key" ON "EmailMessage"("dedupeKey");

-- CreateIndex
CREATE INDEX "EmailMessage_shop_createdAt_idx" ON "EmailMessage"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_shop_resourceId_idx" ON "EmailMessage"("shop", "resourceId");

-- CreateIndex
CREATE INDEX "EmailMessage_status_updatedAt_idx" ON "EmailMessage"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_provider_providerMessageId_key" ON "EmailMessage"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "EmailRecipient_email_idx" ON "EmailRecipient"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailRecipient_messageId_email_key" ON "EmailRecipient"("messageId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDeliveryEvent_eventKey_key" ON "EmailDeliveryEvent"("eventKey");

-- CreateIndex
CREATE INDEX "EmailDeliveryEvent_messageId_idx" ON "EmailDeliveryEvent"("messageId");

-- CreateIndex
CREATE INDEX "EmailResource_resourceId_idx" ON "EmailResource"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailResource_messageId_resourceId_key" ON "EmailResource"("messageId", "resourceId");

-- AddForeignKey
ALTER TABLE "ServiceCatalogueItem" ADD CONSTRAINT "ServiceCatalogueItem_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCase" ADD CONSTRAINT "CareCase_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareCase" ADD CONSTRAINT "CareCase_catalogueItemId_fkey" FOREIGN KEY ("catalogueItemId") REFERENCES "ServiceCatalogueItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareInvite" ADD CONSTRAINT "CareInvite_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareUpdate" ADD CONSTRAINT "CareUpdate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CareCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailRecipient" ADD CONSTRAINT "EmailRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDeliveryEvent" ADD CONSTRAINT "EmailDeliveryEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailResource" ADD CONSTRAINT "EmailResource_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
