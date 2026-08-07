import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getOrCreateMerchantProfile,
  listCatalogue,
  createCatalogueItem,
  updateCatalogueItem,
  deleteCatalogueItem,
} from "../care.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchantProfile(session.shop);
  const catalogue = await listCatalogue(merchant.id);
  return { catalogue };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchantProfile(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    await createCatalogueItem(merchant.id, {
      name: formData.get("name"),
      description: formData.get("description") || null,
      pricingType: formData.get("pricingType") || "fixed",
      price: formData.get("price") ? Number(formData.get("price")) : null,
      requiresPhoto: formData.get("requiresPhoto") === "on",
    });
    return { ok: true };
  }

  if (intent === "toggle_active") {
    const id = formData.get("id");
    const active = formData.get("active") === "true";
    await updateCatalogueItem(id, { active: !active });
    return { ok: true };
  }

  if (intent === "delete") {
    await deleteCatalogueItem(formData.get("id"));
    return { ok: true };
  }

  return { ok: false };
};

export default function Catalogue() {
  const { catalogue } = useLoaderData();
  const fetcher = useFetcher();

  const submit = (data) => fetcher.submit(data, { method: "POST" });

  return (
    <s-page heading="Service catalogue" backAction={{ url: "/app" }}>
      <s-section heading="Add a service">
        <s-paragraph>
          These are the services customers can choose from when they submit a request — add as
          many as you offer.
        </s-paragraph>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("intent", "create");
            fetcher.submit(fd, { method: "POST" });
            e.currentTarget.reset();
          }}
        >
          <s-stack direction="block" gap="base">
            <s-text-field name="name" label="Service name" placeholder="e.g. Ring resizing" required />
            <s-text-field name="description" label="Description" placeholder="What this service covers" />
            <s-select name="pricingType" label="Pricing type">
              <s-option value="fixed">Fixed price</s-option>
              <s-option value="starting_from">Starting from</s-option>
              <s-option value="inspection_required">Inspection required (quote later)</s-option>
              <s-option value="free">Free</s-option>
            </s-select>
            <s-text-field name="price" label="Price (leave blank for inspection-required services)" type="number" step="0.01" />
            <s-checkbox name="requiresPhoto" label="Require a photo on request" defaultChecked />
            <s-button type="submit">Add service</s-button>
          </s-stack>
        </form>
      </s-section>

      <s-section heading={`Services (${catalogue.length})`}>
        <s-stack direction="block" gap="base">
          {catalogue.map((item) => (
            <s-box key={item.id} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-stack direction="block" gap="tight">
                  <s-text weight="bold">{item.name}</s-text>
                  <s-text tone="subdued">
                    {item.pricingType === "inspection_required"
                      ? "Quote after inspection"
                      : item.pricingType === "free"
                        ? "Free"
                        : `${item.pricingType === "starting_from" ? "From " : ""}${item.currency} ${item.price ?? "—"}`}
                  </s-text>
                  {!item.active && <s-badge tone="subdued">Inactive</s-badge>}
                </s-stack>
                <s-button
                  variant="tertiary"
                  onClick={() =>
                    submit({ intent: "toggle_active", id: item.id, active: String(item.active) })
                  }
                >
                  {item.active ? "Deactivate" : "Activate"}
                </s-button>
              </s-stack>
            </s-box>
          ))}
          {catalogue.length === 0 && <s-paragraph>No services yet — add your first above.</s-paragraph>}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
