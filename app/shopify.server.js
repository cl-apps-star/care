import "@shopify/shopify-app-react-router/adapters/node";
import {
    ApiVersion,
    AppDistribution,
    BillingInterval,
    shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { STUDIO_PLAN, STUDIO_PLAN_PRICE } from "./planConstants";

// Re-exported for back-compat with any file still importing this from here
// — new code should import from ./planConstants directly, since this file
// is server-only and anything imported from it outside a route's
// loader/action gets flagged by React Router's client bundle check.
export { STUDIO_PLAN };

const shopify = shopifyApp({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
    apiVersion: ApiVersion.October25,
    scopes: process.env.SCOPES?.split(","),
    appUrl: process.env.SHOPIFY_APP_URL || "",
    authPathPrefix: "/auth",
    sessionStorage: new PrismaSessionStorage(prisma),
    distribution: AppDistribution.AppStore,
    future: {
          expiringOfflineAccessTokens: true,
    },
    billing: {
        // No trialDays — the 3 free cases a month already serve as the
        // trial, same reasoning as the rest of the suite.
        [STUDIO_PLAN]: {
            lineItems: [
                {
                    amount: STUDIO_PLAN_PRICE,
                    currencyCode: "USD",
                    interval: BillingInterval.Every30Days,
                },
            ],
        },
    },
    ...(process.env.SHOP_CUSTOM_DOMAIN
            ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
            : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
