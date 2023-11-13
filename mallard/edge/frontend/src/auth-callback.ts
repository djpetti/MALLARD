/**
 * This is a stand-alone module that exclusively handles the callback
 * portion of the authentication flow.
 */
import { browser, Fief } from "@fief/fief";

// This hack is to deal with the fact that Rollup currently doesn't want
// to work with the fief package. I guess this is one of the joys of using
// beta software...
declare const fief: any;
const FiefClient = fief.Fief as typeof Fief;
const FiefAuth = fief.browser.FiefAuth as typeof browser.FiefAuth;

// Base URL for Fief authentication.
declare const AUTH_BASE_URL: string;
// Client ID for Fief authentication.
declare const AUTH_CLIENT_ID: string;

window.onload = function () {
  const fiefClient = new FiefClient({
    baseURL: AUTH_BASE_URL,
    clientId: AUTH_CLIENT_ID,
  });
  const fiefAuth = new FiefAuth(fiefClient as Fief);
  const location = window.location.href.split("?")[0];
  fiefAuth.authCallback(new URL(location).href).then(() => {
    // Redirect to the original page.
    const preAuthLocation = window.localStorage.getItem("pre_auth_location");
    window.location.href = new URL(preAuthLocation ?? "../", location).href;
  });
};
