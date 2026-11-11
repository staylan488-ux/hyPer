import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/**
 * hyPer's public pages (site/ in the repo, published to GitHub Pages). The
 * App Store listing names the same addresses (docs/app-store-listing.md);
 * if the site moves, change them together.
 */
const SITE = 'https://staylan488-ux.github.io/hyPer';
export const PRIVACY_URL = `${SITE}/privacy/`;
export const TERMS_URL = `${SITE}/terms/`;
export const SUPPORT_URL = `${SITE}/support/`;

/**
 * The App Store's number for hyPer, known once the listing exists in App
 * Store Connect (App Information, Apple ID). Until then the update screen
 * opens the App Store's search for hyPer.
 */
export const APP_STORE_ID: string | null = null;

export function appStoreUrl(): string {
  return APP_STORE_ID
    ? `itms-apps://apps.apple.com/app/id${APP_STORE_ID}`
    : 'itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=hyPer';
}

/** A page of ours, in Safari's sheet over the app, so closing it comes straight back. */
export async function openPage(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
  } catch {
    await Linking.openURL(url).catch(() => {});
  }
}
