// Proxies Google PageSpeed Insights (Lighthouse) — all 4 categories.
// Set PSI_KEY in Netlify environment variables (free key, 25k queries/day)
// to avoid the tiny shared keyless quota. Works without a key at low volume.

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const url = (event.queryStringParameters && event.queryStringParameters.url) || "";
  if (!url) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing url" }) };

  const key = process.env.PSI_KEY ? `&key=${process.env.PSI_KEY}` : "";
  const api =
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=" + encodeURIComponent(url) +
    "&strategy=mobile&category=performance&category=accessibility&category=best-practices&category=seo" + key;

  try {
    const r = await fetch(api);
    const d = await r.json();
    if (d.error) {
      const quota = /quota/i.test(d.error.message || "");
      return { statusCode: 502, headers, body: JSON.stringify({
        error: quota
          ? "Google's free analysis quota is used up for now. Add a free API key (see README) or try again later."
          : "Google couldn't analyze this page right now."
      }) };
    }
    const lr = d.lighthouseResult;
    const cats = {};
    for (const k of ["performance", "accessibility", "best-practices", "seo"]) {
      if (lr.categories[k]) cats[k] = { title: lr.categories[k].title, score: Math.round(lr.categories[k].score * 100) };
    }
    // Top failed audits — the specific problems Google found
    const issues = [];
    const seen = new Set();
    for (const catKey of Object.keys(lr.categories)) {
      for (const ref of lr.categories[catKey].auditRefs || []) {
        const a = lr.audits[ref.id];
        if (!a || a.score === null || a.score >= 0.9 || seen.has(ref.id)) continue;
        if (a.scoreDisplayMode === "informative" || a.scoreDisplayMode === "notApplicable") continue;
        seen.add(ref.id);
        issues.push({
          category: lr.categories[catKey].title,
          title: a.title,
          value: a.displayValue || null,
          score: Math.round(a.score * 100),
        });
      }
    }
    issues.sort((a, b) => a.score - b.score);
    return { statusCode: 200, headers, body: JSON.stringify({ categories: cats, issues: issues.slice(0, 12) }) };
  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Couldn't reach Google's analysis service." }) };
  }
};
