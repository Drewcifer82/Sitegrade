# SiteGrade — Website SEO Report Card

A free SEO audit tool. Visitor enters a URL, a Netlify serverless function scans
the site and runs 16 checks, and the page renders a graded inspection report
(with a "Save as PDF" button for prospecting).

## Files
- `index.html` — the whole frontend (no build step)
- `netlify/functions/audit.js` — the scanner (zero dependencies)
- `netlify.toml` — tells Netlify where the function lives

## Deploy (your usual pipeline)
1. Create a new GitHub repo, push these three files.
2. In Netlify: Add new site → Import from GitHub → pick the repo.
3. No build command needed. Publish directory: `.` (already set in netlify.toml).
4. Deploy. Done — the function is live at `/.netlify/functions/audit` automatically.

## Local test of the scanner (optional)
node -e "require('./netlify/functions/audit.js').handler({queryStringParameters:{url:'example.com'}}).then(r=>console.log(r.body))"

## The 16 checks
Essentials: title tag, meta description, H1, HTTPS, mobile viewport
Content: image alt text, word count, internal/external links, lang attribute
Social: Open Graph tags, favicon
Technical: canonical, robots.txt, sitemap.xml, page weight, noindex
Plus: Google PageSpeed mobile score (fetched directly by the browser).

## Prospecting workflow
1. Run a scan on a local business's site.
2. Click "Save report as PDF" (it prints clean — no UI chrome).
3. Email the PDF: "I ran a free inspection on your site — here's what I found."

## Rename it
"SiteGrade" is a placeholder. Search-and-replace in index.html to rebrand.
