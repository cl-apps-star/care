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
import styles from "../styles/care-admin.module.css";

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
    <s-page heading="Services & pricing" backAction={{ url: "/app" }} inlineSize="large">
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Your service menu</p>
            <h1>Make choosing help feel simple</h1>
            <p className={styles.lede}>Add the repairs, cleaning or maintenance your customers can request.</p>
          </div>
        </header>

        <div className={styles.catalogueLayout}>
          <section className={styles.formPanel}>
            <div className={styles.cardHeader}><div><p className={styles.eyebrow}>Add new</p><h2>A service</h2></div></div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("intent", "create");
            fetcher.submit(fd, { method: "POST" });
            e.currentTarget.reset();
          }}
        >
          <div className={styles.formGrid}>
            <s-text-field name="name" label="Service name" placeholder="e.g. Ring resizing" required />
            <s-text-field name="description" label="Short description (optional)" placeholder="What this service covers" />
            <s-select name="pricingType" label="Pricing type">
              <s-option value="fixed">Fixed price</s-option>
              <s-option value="starting_from">Starting from</s-option>
              <s-option value="inspection_required">Inspection required (quote later)</s-option>
              <s-option value="free">Free</s-option>
            </s-select>
            <s-text-field name="price" label="Price (optional)" type="number" step="0.01" />
            <s-checkbox name="requiresPhoto" label="Require a photo on request" defaultChecked />
            <s-button type="submit">Add service</s-button>
          </div>
        </form>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div><p className={styles.eyebrow}>Customer choices</p><h2>Your services</h2></div>
              <span>{catalogue.length}</span>
            </div>
            <div className={styles.serviceList}>
          {catalogue.map((item) => (
            <div key={item.id} className={`${styles.serviceRow} ${!item.active ? styles.serviceMuted : ""}`}>
              <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.pricingType === "inspection_required"
                      ? "Quote after inspection"
                      : item.pricingType === "free"
                        ? "Free"
                        : `${item.pricingType === "starting_from" ? "From " : ""}${item.currency} ${item.price ?? "—"}`}
                  </small>
                  {!item.active && <s-badge tone="subdued">Inactive</s-badge>}
              </div>
                <s-button
                  variant="tertiary"
                  onClick={() =>
                    submit({ intent: "toggle_active", id: item.id, active: String(item.active) })
                  }
                >
                  {item.active ? "Deactivate" : "Activate"}
                </s-button>
            </div>
          ))}
          {catalogue.length === 0 && <div className={styles.empty}>Your first service will appear here.</div>}
            </div>
          </section>
        </div>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
