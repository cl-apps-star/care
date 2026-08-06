import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Care — service tracking for handmade &amp; luxury goods</h1>
        <p className={styles.text}>
          Give customers a branded tracking page for repairs, cleaning, and restoration requests.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Service catalogue</strong>. Define the repairs, cleaning, and
            restoration services you offer, with pricing or "quote after inspection".
          </li>
          <li>
            <strong>Case tracking</strong>. Customers see a branded page showing
            exactly where their piece is in the service pipeline.
          </li>
          <li>
            <strong>Quote &amp; approval</strong>. Build a quote, send it, and let
            customers approve or decline right from their tracking page.
          </li>
        </ul>
      </div>
    </div>
  );
}
