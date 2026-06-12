// SEO Audit serverless function — zero dependencies, runs on Netlify (Node 18+)

const TIMEOUT_MS = 12000;

function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeout || TIMEOUT_MS);
  return fetch(url, {
    redirect: "follow",
    signal: controller.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SiteAuditBot/1.0; +https://example.com)",
      Accept: "text/html,application/xhtml+xml",
    },
  }).finally(() => clearTimeout(t));
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");
}

function getTag(html, regex) {
  const m = html.match(regex);
  return m ? decodeEntities(m[1].trim()) : null;
}

function getMetaContent(html, nameValue) {
  // matches <meta name="x" content="y"> and <meta content="y" name="x">, single/double quotes
  const re1 = new RegExp(
    `<meta[^>]+(?:name|property)\\s*=\\s*["']${nameValue}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    "i"
  );
  const re2 = new RegExp(
    `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:name|property)\\s*=\\s*["']${nameValue}["']`,
    "i"
  );
  return getTag(html, re1) || getTag(html, re2);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  let raw = (event.queryStringParameters && event.queryStringParameters.url) || "";
  raw = raw.trim();
  if (!raw) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing url parameter" }) };
  }
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

  let target;
  try {
    target = new URL(raw);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "That doesn't look like a valid URL" }) };
  }

  // Fetch the page
  let res, html, finalUrl, responseMs;
  try {
    const start = Date.now();
    res = await fetchWithTimeout(target.href);
    html = await res.text();
    responseMs = Date.now() - start;
    finalUrl = new URL(res.url || target.href);
  } catch (e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: "Couldn't reach that site. Check the address and try again.",
      }),
    };
  }

  if (!res.ok) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: `The site responded with status ${res.status}. The page may be down or blocking scanners.`,
      }),
    };
  }

  const origin = finalUrl.origin;
  const checks = [];
  const add = (id, category, label, status, detail, fix, weight) =>
    checks.push({ id, category, label, status, detail, fix, weight });

  // ---------- ESSENTIALS ----------
  const title = getTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!title) {
    add("title", "Essentials", "Title tag", "fail", "No <title> tag found.", "Add a unique, descriptive title (30–60 characters) — it's the headline Google shows.", 10);
  } else if (title.length < 30 || title.length > 60) {
    add("title", "Essentials", "Title tag", "warn", `Title is ${title.length} characters: “${title.slice(0, 80)}”`, "Aim for 30–60 characters so it doesn't get cut off in search results.", 10);
  } else {
    add("title", "Essentials", "Title tag", "pass", `“${title}” (${title.length} characters)`, null, 10);
  }

  const desc = getMetaContent(html, "description");
  if (!desc) {
    add("desc", "Essentials", "Meta description", "fail", "No meta description found.", "Add a 70–160 character summary — this is the text under your link in Google.", 10);
  } else if (desc.length < 70 || desc.length > 160) {
    add("desc", "Essentials", "Meta description", "warn", `Description is ${desc.length} characters.`, "Aim for 70–160 characters for full display in search results.", 10);
  } else {
    add("desc", "Essentials", "Meta description", "pass", `${desc.length} characters — good length.`, null, 10);
  }

  const h1s = html.match(/<h1[\s>]/gi) || [];
  if (h1s.length === 0) {
    add("h1", "Essentials", "H1 heading", "fail", "No H1 heading found.", "Add exactly one H1 that says what the page is about.", 8);
  } else if (h1s.length > 1) {
    add("h1", "Essentials", "H1 heading", "warn", `${h1s.length} H1 headings found.`, "Use a single H1 per page; demote the rest to H2.", 8);
  } else {
    add("h1", "Essentials", "H1 heading", "pass", "Exactly one H1 — correct.", null, 8);
  }

  const https = finalUrl.protocol === "https:";
  add("https", "Essentials", "HTTPS", https ? "pass" : "fail",
    https ? "Site is served over a secure connection." : "Site is not using HTTPS.",
    https ? null : "Install an SSL certificate — browsers mark HTTP sites as 'Not secure' and Google penalizes them.", 8);

  const viewport = getMetaContent(html, "viewport");
  add("viewport", "Essentials", "Mobile viewport", viewport ? "pass" : "fail",
    viewport ? "Viewport tag present — page can scale on phones." : "No viewport meta tag.",
    viewport ? null : 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> so the site works on phones.', 8);

  // ---------- CONTENT ----------
  const imgs = html.match(/<img[^>]*>/gi) || [];
  const imgsNoAlt = imgs.filter((i) => !/alt\s*=\s*["'][^"']+["']/i.test(i));
  if (imgs.length === 0) {
    add("alt", "Content", "Image alt text", "pass", "No images on this page.", null, 6);
  } else if (imgsNoAlt.length > 0) {
    const sev = imgsNoAlt.length / imgs.length > 0.5 ? "fail" : "warn";
    add("alt", "Content", "Image alt text", sev, `${imgsNoAlt.length} of ${imgs.length} images missing alt text.`, "Add descriptive alt attributes — they help Google understand images and improve accessibility.", 6);
  } else {
    add("alt", "Content", "Image alt text", "pass", `All ${imgs.length} images have alt text.`, null, 6);
  }

  const text = stripHtml(html);
  const wordCount = text ? text.split(" ").length : 0;
  if (wordCount < 150) {
    add("words", "Content", "Page content", "warn", `Only ~${wordCount} words of visible text.`, "Thin pages rarely rank. Aim for 300+ words of useful, specific content.", 6);
  } else {
    add("words", "Content", "Page content", "pass", `~${wordCount} words of visible text.`, null, 6);
  }

  const anchors = html.match(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi) || [];
  let internal = 0, external = 0;
  for (const a of anchors) {
    const href = a.match(/href\s*=\s*["']([^"']+)["']/i)[1];
    try {
      const u = new URL(href, origin);
      if (u.origin === origin) internal++; else if (/^https?:/.test(u.protocol)) external++;
    } catch { /* ignore */ }
  }
  add("links", "Content", "Links", internal > 0 ? "pass" : "warn",
    `${internal} internal, ${external} external links found.`,
    internal > 0 ? null : "Add links between your pages so visitors and Google can find everything.", 4);

  const lang = getTag(html, /<html[^>]*\slang\s*=\s*["']([^"']+)["']/i);
  add("lang", "Content", "Language attribute", lang ? "pass" : "warn",
    lang ? `Page language declared: ${lang}` : "No lang attribute on <html>.",
    lang ? null : 'Add lang="en" to the <html> tag.', 2);

  // ---------- SOCIAL ----------
  const ogTitle = getMetaContent(html, "og:title");
  const ogDesc = getMetaContent(html, "og:description");
  const ogImage = getMetaContent(html, "og:image");
  const ogCount = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
  if (ogCount === 3) {
    add("og", "Social", "Social sharing tags", "pass", "Open Graph title, description, and image all present.", null, 5);
  } else if (ogCount > 0) {
    add("og", "Social", "Social sharing tags", "warn", `${ogCount} of 3 Open Graph tags present (title/description/image).`, "Complete the set so links look right when shared on Facebook, LinkedIn, and texts.", 5);
  } else {
    add("og", "Social", "Social sharing tags", "fail", "No Open Graph tags found.", "Without og:title, og:description, and og:image, shared links show up blank or ugly.", 5);
  }

  const favicon = /<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(html);
  add("favicon", "Social", "Favicon", favicon ? "pass" : "warn",
    favicon ? "Favicon declared." : "No favicon link found.",
    favicon ? null : "Add a favicon — it shows in browser tabs and search results.", 2);

  // ---------- TECHNICAL ----------
  const canonical = getTag(html, /<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i)
    || getTag(html, /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']canonical["']/i);
  add("canonical", "Technical", "Canonical tag", canonical ? "pass" : "warn",
    canonical ? `Canonical set to ${canonical}` : "No canonical tag found.",
    canonical ? null : "Add a canonical tag so Google knows the preferred version of each page.", 4);

  // robots.txt + sitemap — check robots.txt first (it may declare the sitemap location, like Google does)
  let robotsOk = false, robotsBody = "";
  try {
    const r = await fetchWithTimeout(origin + "/robots.txt", { timeout: 6000 });
    robotsOk = r.ok;
    if (r.ok) robotsBody = await r.text();
  } catch { /* unreachable */ }

  let sitemapOk = false, sitemapLoc = null;
  const declared = robotsBody.match(/^\s*sitemap:\s*(\S+)/im);
  const candidates = [];
  if (declared) candidates.push(declared[1]);
  candidates.push(origin + "/sitemap.xml", origin + "/sitemap_index.xml", origin + "/sitemap-index.xml", origin + "/wp-sitemap.xml");
  for (const loc of candidates) {
    try {
      const r = await fetchWithTimeout(loc, { timeout: 6000 });
      if (r.ok) { sitemapOk = true; sitemapLoc = loc; break; }
    } catch { /* try next */ }
  }

  add("robots", "Technical", "robots.txt", robotsOk ? "pass" : "warn",
    robotsOk ? "robots.txt found." : "No robots.txt found.",
    robotsOk ? null : "Add a robots.txt file so crawlers know what to index.", 3);
  add("sitemap", "Technical", "XML sitemap", sitemapOk ? "pass" : "warn",
    sitemapOk ? `Sitemap found at ${sitemapLoc}` : "No XML sitemap found (checked robots.txt and common locations).",
    sitemapOk ? null : "Add an XML sitemap, declare it in robots.txt, and submit it in Google Search Console.", 4);

  const sizeKb = Math.round(Buffer.byteLength(html, "utf8") / 1024);
  add("size", "Technical", "Page weight (HTML)", sizeKb < 300 ? "pass" : "warn",
    `HTML document is ${sizeKb} KB. Server responded in ${responseMs} ms.`,
    sizeKb < 300 ? null : "Large HTML often means inlined bloat — slim it down for faster loads.", 3);

  const noindex = /<meta[^>]+name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*noindex/i.test(html);
  add("noindex", "Technical", "Indexability", noindex ? "fail" : "pass",
    noindex ? "Page has a NOINDEX tag — Google is told to ignore it!" : "Page is indexable.",
    noindex ? "Remove the noindex directive unless this page is intentionally hidden." : null, 10);

  // Compression (from response headers)
  const enc = (res.headers.get("content-encoding") || "").toLowerCase();
  const compressed = /gzip|br|deflate|zstd/.test(enc);
  add("compress", "Technical", "Text compression", compressed ? "pass" : "warn",
    compressed ? `Compression enabled (${enc}).` : "Page is served uncompressed.",
    compressed ? null : "Enable gzip or Brotli compression on the server — pages load noticeably faster.", 3);

  // Caching header
  const cache = res.headers.get("cache-control") || "";
  add("cache", "Technical", "Browser caching", cache ? "pass" : "warn",
    cache ? `Cache-Control set: ${cache.slice(0, 60)}` : "No Cache-Control header on the page.",
    cache ? null : "Set caching headers so repeat visitors load the site faster.", 2);

  // Mixed content (http resources on an https page)
  if (https) {
    const mixed = (html.match(/(?:src|href)\s*=\s*["']http:\/\//gi) || []).length;
    add("mixed", "Technical", "Mixed content", mixed === 0 ? "pass" : "fail",
      mixed === 0 ? "No insecure (http://) resources loaded on this secure page." : `${mixed} insecure http:// resources referenced on an https page.`,
      mixed === 0 ? null : "Load all scripts, styles, and images over https:// — browsers block or flag mixed content.", 5);
  }

  // Structured data
  const hasLdJson = /<script[^>]+type\s*=\s*["']application\/ld\+json["']/i.test(html);
  add("schema", "Technical", "Structured data", hasLdJson ? "pass" : "warn",
    hasLdJson ? "Schema.org structured data found." : "No structured data (schema.org) found.",
    hasLdJson ? null : "Add LocalBusiness structured data — it powers rich results like hours, reviews, and location in Google.", 4);

  // Twitter card
  const twCard = getMetaContent(html, "twitter:card");
  add("twitter", "Social", "Twitter/X card", twCard ? "pass" : "warn",
    twCard ? `Twitter card set (${twCard}).` : "No Twitter/X card tags.",
    twCard ? null : "Add twitter:card meta tags so links look right when shared on X.", 2);

  // Deprecated HTML
  const deprecated = html.match(/<(font|center|marquee|blink)[\s>]/gi) || [];
  add("deprecated", "Technical", "Outdated HTML", deprecated.length === 0 ? "pass" : "warn",
    deprecated.length === 0 ? "No deprecated HTML tags." : `${deprecated.length} deprecated tags found (e.g. ${deprecated[0].replace(/[<>\s]/g,"")}) — a sign of a very old site.`,
    deprecated.length === 0 ? null : "Rebuild with modern HTML/CSS — deprecated tags signal an outdated site to both users and Google.", 2);

  // Render-blocking scripts in <head>
  const headHtml = (html.match(/<head[\s\S]*?<\/head>/i) || [""])[0];
  const blockingScripts = (headHtml.match(/<script[^>]+src=/gi) || []).filter(s => !/async|defer|type\s*=\s*["']module["']/i.test(s)).length;
  add("blocking", "Technical", "Render-blocking scripts", blockingScripts <= 2 ? "pass" : "warn",
    `${blockingScripts} render-blocking scripts in the page head.`,
    blockingScripts <= 2 ? null : "Add defer/async to script tags — blocking scripts delay how fast the page appears.", 3);

  // ---------- SCORE ----------
  let earned = 0, possible = 0;
  for (const c of checks) {
    possible += c.weight;
    if (c.status === "pass") earned += c.weight;
    else if (c.status === "warn") earned += c.weight * 0.5;
  }
  const score = Math.round((earned / possible) * 100);
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : "F";

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      url: finalUrl.href,
      scannedAt: new Date().toISOString(),
      score,
      grade,
      responseMs,
      checks,
    }),
  };
};
