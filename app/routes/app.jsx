import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      {/* ui-nav-menu registers these links in Shopify's own admin sidebar.
          It renders nothing visible itself — it's not a Polaris component,
          just App Bridge's navigation registration element. */}
      <ui-nav-menu>
        <a href="/app" rel="home">
          Home
        </a>
        <a href="/app/products">Products</a>
        <a href="/app/billing">Billing</a>
        <a href="/app/settings">Settings</a>
      </ui-nav-menu>

      <div className="lwi-admin lwi-admin-shell">
        <header className="lwi-admin-brandbar">
          <div className="lwi-admin-brand">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-[#070A12]">
              <img
                src="/lwi-logo.png"
                alt="LetsWearIt"
                className="h-auto w-auto object-contain flex items-center justify-center"
              />
            </div>
            <div>
              <strong>LetsWearIt</strong>
              <span>AI virtual try-on</span>
            </div>
          </div>
          <div className="lwi-admin-brand-status">
            <i aria-hidden="true" />
            Store connected
          </div>
        </header>
        <Outlet />
      </div>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
