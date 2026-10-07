<?xml version="1.0" encoding="UTF-8"?>
<!--
  The stylesheet the sitemap names in its own `<?xml-stylesheet?>` instruction.

  A crawler never runs this - it reads the tags. A browser does, and instead of a wall of markup
  it gets the site's own dark table: the address of every page, the languages each page exists
  in as badges that lead to the copy in that language, and the day the page was last seen. The
  XML a crawler is served is left exactly as a sitemap has to be; only the presentation lives
  here, which is why a changed table can never move a crawler's reading of the file.

  The sitemap's own namespace is bound to the `s` prefix rather than left as the default, so the
  `html`, `table` and `a` this file writes stay in no namespace - the elements a browser knows -
  while `s:url`, `s:loc` and `s:lastmod` still address the sitemap.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  exclude-result-prefixes="s xhtml">

  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="color-scheme" content="dark"/>
        <title>Hero of Azeroth · sitemap</title>
        <style><![CDATA[
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  min-height: 100vh;
  background:
    radial-gradient(ellipse at 15% -12%, rgba(248, 183, 0, 0.10), transparent 55%),
    radial-gradient(ellipse at 92% -4%, rgba(59, 130, 246, 0.10), transparent 50%),
    #080a0f;
  color: #e2e8f0;
  font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  padding: 42px 20px 64px;
}
.wrap { max-width: 1040px; margin: 0 auto; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0 0 10px; }
h1 {
  margin: 0; font-size: 30px; font-weight: 800; letter-spacing: 0.02em;
  display: inline-flex; align-items: center; gap: 12px;
}
h1 .brand { color: #f8b700; text-shadow: 0 0 28px rgba(248, 183, 0, 0.35); }
h1 .tag {
  font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
  color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.30); border-radius: 999px;
  padding: 4px 11px;
}
.lead { margin: 0 0 26px; color: #94a3b8; font-size: 15px; }
.lead b { color: #ffe395; font-weight: 700; font-size: 17px; }
.lead .dot { color: #475569; margin: 0 9px; }
.lead a { color: #f8b700; text-decoration: none; }
.lead a:hover { text-decoration: underline; }
.card {
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(255, 255, 255, 0.045);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 18px 50px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px) saturate(140%);
}
table { width: 100%; border-collapse: collapse; }
thead th {
  text-align: left; padding: 15px 18px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  color: #94a3b8; background: rgba(0, 0, 0, 0.28);
  border-bottom: 1px solid rgba(255, 255, 255, 0.10);
}
tbody td { padding: 13px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: rgba(248, 183, 0, 0.055); }
td.url { width: auto; }
td.url a {
  color: #e2e8f0; text-decoration: none; font-weight: 600; font-size: 14.5px;
  word-break: break-word;
}
td.url a:hover { color: #f8b700; }
td.lang { width: 1%; white-space: nowrap; }
.badge {
  display: inline-block; min-width: 42px; text-align: center; margin-right: 6px;
  font-size: 11px; font-weight: 800; letter-spacing: 0.08em; padding: 4px 9px;
  border-radius: 8px; text-decoration: none;
  border: 1px solid rgba(148, 163, 184, 0.35); color: #cbd5e1; background: rgba(15, 23, 42, 0.6);
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.badge:hover { border-color: rgba(248, 183, 0, 0.7); color: #f8b700; background: rgba(248, 183, 0, 0.12); }
.badge.en { border-color: rgba(56, 189, 248, 0.5); color: #7dd3fc; }
.badge.ru { border-color: rgba(244, 114, 182, 0.5); color: #f9a8d4; }
.badge.en:hover { border-color: rgba(56, 189, 248, 0.9); color: #bae6fd; }
.badge.ru:hover { border-color: rgba(244, 114, 182, 0.9); color: #fbcfe8; }
td.date { width: 1%; white-space: nowrap; color: #94a3b8; font-variant-numeric: tabular-nums; }
td.date .none { color: #475569; }
footer { margin-top: 22px; text-align: center; color: #64748b; font-size: 13px; }
footer a { color: #94a3b8; text-decoration: none; }
footer a:hover { color: #f8b700; }
@media (max-width: 620px) {
  thead { display: none; }
  tbody tr { display: block; border-bottom: 1px solid rgba(255, 255, 255, 0.07); padding: 12px 0; }
  tbody tr:last-child { border-bottom: 0; }
  tbody td { display: block; border-bottom: 0; padding: 5px 16px; }
  tbody tr:hover td { background: transparent; }
  td.lang, td.date { width: auto; }
}
        ]]></style>
      </head>
<body>
        <div class="wrap">
          <header>
            <h1>
              <span class="brand">Hero of Azeroth</span>
              <span class="tag">sitemap</span>
            </h1>
          </header>

          <!-- The one figure worth stating up front: how much the map holds. -->
          <p class="lead">
            <b><xsl:value-of select="count(//s:url)"/></b> pages
            <span class="dot">·</span>
            <a href="https://heroofazeroth.com">heroofazeroth.com</a>
          </p>

          <div class="card">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Languages</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                <xsl:apply-templates select="//s:url"/>
              </tbody>
            </table>
          </div>

          <footer>
            Generated by <a href="https://heroofazeroth.com">Hero of Azeroth</a> · sitemap.xml
          </footer>
        </div>

        <script><![CDATA[
          // The addresses are percent-encoded, which is exactly what a crawler wants to read and
          // exactly what nobody wants to look at. Each label is decoded back to the name it spells
          // - %D0%BD%D0%B5... becomes нейромаск - while the href it points at is left untouched.
          (function () {
            var links = document.querySelectorAll('td.url a');
            for (var i = 0; i < links.length; i++) {
              var anchor = links[i];
              var raw = anchor.getAttribute('href') || anchor.textContent || '';
              try {
                var decoded = decodeURIComponent(raw).replace(/^[a-z]+:\/\/[^/]+/i, '');
                if (decoded.charAt(0) !== '/') decoded = '/' + decoded;
                anchor.textContent = decoded;
              } catch (error) {
                // A stray percent sign is not worth breaking a page over: the address stays as it is.
              }
            }
          })();
        ]]></script>
      </body>
    </html>
  </xsl:template>

  <!-- One row per page: its address, the languages it exists in, the day it was last seen. -->
  <xsl:template match="s:url">
    <tr>
      <td class="url">
        <a href="{s:loc}"><xsl:value-of select="s:loc"/></a>
      </td>
      <td class="lang">
        <xsl:if test="xhtml:link[@hreflang='en']">
          <a class="badge en" href="{xhtml:link[@hreflang='en']/@href}" title="English version">EN</a>
        </xsl:if>
        <xsl:if test="xhtml:link[@hreflang='ru']">
          <a class="badge ru" href="{xhtml:link[@hreflang='ru']/@href}" title="Русская версия">RU</a>
        </xsl:if>
      </td>
      <td class="date">
        <xsl:choose>
          <xsl:when test="s:lastmod">
            <xsl:value-of select="s:lastmod"/>
          </xsl:when>
          <xsl:otherwise>
            <span class="none">—</span>
          </xsl:otherwise>
        </xsl:choose>
      </td>
    </tr>
  </xsl:template>
</xsl:stylesheet>