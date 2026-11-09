/**
 * Parse the device-code instructions the `pushtodisplay` CLI prints.
 *
 * The CLI writes (to stderr):
 *
 *   To sign in, open this URL in a browser:
 *     https://idp.pushtodisplay.com/device
 *
 *   Then enter the code: ABCD-EFGH
 *
 *   Or open this link directly:
 *     https://idp.pushtodisplay.com/device?user_code=ABCD-EFGH
 *
 * The parser is intentionally tolerant: it accepts either form, ANSI colour
 * codes, and a complete URL that already contains the code.
 */

// eslint-disable-next-line no-control-regex -- ANSI escape stripping is the point.
const ANSI = new RegExp("\\u001b\\[[0-9;]*m", "g");

/**
 * @param {string} text
 * @returns {{url: string, completeUrl: string, code: string}}
 */
export function parseDeviceAuth(text) {
  const clean = String(text ?? "").replace(ANSI, "");
  const urls = clean.match(/https?:\/\/[^\s<>"']+/g) ?? [];

  let completeUrl = "";
  let url = "";
  for (const candidate of urls) {
    const trimmed = candidate.replace(/[),.;]+$/, "");
    if (/[?&]user_code=/i.test(trimmed)) {
      completeUrl ||= trimmed;
    } else if (!url) {
      url = trimmed;
    }
  }

  let code = "";
  const fromUrl = clean.match(/[?&]user_code=([A-Za-z0-9-]+)/i);
  if (fromUrl?.[1]) code = fromUrl[1];
  if (!code) {
    const labelled = clean.match(
      /(?:enter the code|user code|code)[:\s]+([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})?)/i,
    );
    if (labelled?.[1]) code = labelled[1];
  }
  if (!code) {
    const bare = clean.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/);
    if (bare?.[1]) code = bare[1];
  }

  return { url, completeUrl, code };
}

/** The URL a person should open, preferring the one with the code baked in. */
export function bestDeviceUrl(parsed) {
  return parsed.completeUrl || parsed.url;
}
