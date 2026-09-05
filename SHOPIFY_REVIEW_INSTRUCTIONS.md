# Shopify review instructions

## Access

No separate Care account or app-specific credentials are required. Install the app on the review store, then open **Care** from Shopify Admin > Apps. The app uses the reviewer's authenticated Shopify Admin session.

## Functional test

1. Open **Branding** and save a brand name, colours, and a support email.
2. Open **Service catalogue** and add a service such as “General repair”.
3. Return to **Home** and choose **Create a demo case**. This creates a safe sample care case and sends the customer-facing confirmation to the authenticated admin user's email.
4. Open **Cases**, then open the demo case to view its details and customer tracking link.
5. Move the case through Assessment, enter quote amounts, and choose **Save & send quote**.
6. Open the customer tracking link. Confirm the quote breakdown and choose **Approve quote** or **Decline**.
7. Return to the case in Shopify Admin and continue moving it through the remaining care stages.

## Checkout requirement 1.1.2

Care does not create Shopify orders, Draft Orders, transactions, invoices, or payment links. Its quote feature is an estimate and approval workflow only. After a customer approves a quote, Care records the approval, emails the merchant, and continues the repair-tracking workflow. Payment is not collected or registered by Care.
