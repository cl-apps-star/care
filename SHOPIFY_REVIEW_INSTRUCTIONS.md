# Shopify review instructions

## Access

No separate Care account, external login, or app-specific credentials are required. Install the app on the review store, then open **Care** from **Shopify Admin > Apps**. The app uses the reviewer's authenticated Shopify Admin session and its complete feature set is available there.

## Functional test

1. Open **Branding & setup** and save a brand name, colours, and a support email. The preview updates on the same page.
2. Open **Services & pricing** and add a service such as “General repair”.
3. Return to **Home** and choose **Create a demo case**. This creates a safe sample care case and sends the customer-facing confirmation to the authenticated admin user's email.
4. Open **Cases**, then open the demo case to view its details and copy the private customer tracking link.
5. Move the case to **Assessment**, enter one or more quote amounts, and choose **Save & send quote**.
6. Open the private customer tracking link. Confirm the quote breakdown, then choose **Approve quote** or **Decline quote**.
7. Return to the case in Shopify Admin and continue moving it through the remaining care stages.
8. Open **Billing** to view the free allowance and paid Studio plan. Choosing the paid plan opens Shopify's own subscription approval screen; no payment is collected inside Care.

## Public customer request test

The merchant's public request link is shown on the **Cases** page. A customer may verify a Shopify storefront order with its order number and matching email address, or continue with manual item details if the order cannot be found. The order lookup uses Shopify's GraphQL Admin API and read-only order access.

## Checkout requirement 1.1.2

Care does not create Shopify orders, Draft Orders, transactions, invoices, or payment links. Its quote feature is an estimate and approval workflow only. After a customer approves a quote, Care records the approval, emails the merchant, and continues the repair-tracking workflow. Payment is not collected or registered by Care.

The previously reviewed Draft Order/payment path has been removed from both the interface and server code. All paid app-plan upgrades are handled by Shopify's Billing API and Shopify's hosted subscription approval screen.
