import { authenticate } from "../shopify.server";

// Mandatory GDPR compliance webhook - a customer or Shopify has requested
// the data this app stores about a customer. We only key CareCase rows by
// name/email (no separate Customer table), so log for manual export today;
// automate a lookup-by-email export before public launch.
export const action = async ({ request }) => {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`, payload);
    return new Response();
};
