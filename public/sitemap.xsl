<?xml version="1.0" encoding="UTF-8"?>
<!--
  The stylesheet the sitemap names in its own `<?xml-stylesheet?>` instruction.

  A crawler never runs this - it reads the tags. A browser does, and instead of a wall of markup it
  gets the page the map doubles as: the characters the site has been asked about, and what they were
  when they were asked for. The XML a crawler is served stays a sitemap; only the presentation lives
  here, which is why a changed page can never move a crawler's reading of the file.

  Two namespaces are read: the sitemap's own (`s:`), which carries the addresses and the days, and the
  site's (`hoa:`, see `server/routes/sitemap.xml.ts`), which carries what a sitemap has no room for -
  the level, the class, the item level, the mounts. `html`, `table` and `a` are written in no
  namespace, so they stay the elements a browser knows. Every field a record may be missing is asked
  for with `xsl:if`, so a map written before a field existed still paints.

  Everything the page states is read off the map itself - the counts, the groups, the first and last
  day - so the page can never disagree with the file a crawler is handed.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  xmlns:hoa="https://heroofazeroth.com/sitemap"
  exclude-result-prefixes="s xhtml hoa">

  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <!-- One key per breakdown the page paints: a group is the value itself, so the distinct values of
       an element are the groups, and `key()` counts and colours each one. -->
  <xsl:key name="byLevel" match="hoa:level" use="."/>
  <xsl:key name="byClass" match="hoa:class" use="."/>
  <xsl:key name="byRealm" match="hoa:realm" use="."/>
  <xsl:key name="byDay" match="s:lastmod" use="."/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="color-scheme" content="dark"/>
        <meta name="robots" content="noindex"/>
        <title>Hero of Azeroth · who has been looked up</title>
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
.wrap { max-width: 1100px; margin: 0 auto; }
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
.lead { margin: 0 0 22px; color: #94a3b8; }
.lead b { color: #ffe395; font-weight: 700; font-size: 17px; }
.lead .dot { color: #475569; margin: 0 9px; }
.lead a { color: #f8b700; text-decoration: none; }
.lead a:hover { text-decoration: underline; }
/* The figures: one card each, so the page is read at a glance before it is read at all. */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(152px, 1fr)); gap: 12px; margin: 0 0 26px; }
.stat {
  border: 1px solid rgba(255, 255, 255, 0.10); background: rgba(255, 255, 255, 0.045);
  border-radius: 14px; padding: 14px 16px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 10px 30px rgba(0, 0, 0, 0.35);
}
.stat .n { display: block; font-size: 26px; font-weight: 800; line-height: 1.15; color: #fff; }
.stat .k {
  display: block; margin-top: 3px; font-size: 11px; font-weight: 700;
  letter-spacing: 0.13em; text-transform: uppercase; color: #94a3b8;
}
.stat .s { display: block; margin-top: 5px; font-size: 12px; color: #64748b; }
.stat.gold .n { color: #f8b700; text-shadow: 0 0 22px rgba(248, 183, 0, 0.3); }

/* One panel per breakdown, and one bar per group: the row is what makes a shelf of numbers a shape. */
.panel {
  border: 1px solid rgba(255, 255, 255, 0.10); background: rgba(255, 255, 255, 0.045);
  border-radius: 16px; padding: 16px 18px 18px; margin: 0 0 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 18px 50px rgba(0, 0, 0, 0.5);
}
.panel h2 {
  margin: 0 0 14px; font-size: 12px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: #94a3b8;
}
.panel h2 span { color: #475569; font-weight: 500; letter-spacing: 0; text-transform: none; }
.row { display: grid; grid-template-columns: 118px 1fr 54px; align-items: center; gap: 12px; padding: 5px 0; }
.row .label {
  font-weight: 600; color: #e2e8f0; font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.row .track {
  height: 10px; border-radius: 999px; background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.06); overflow: hidden;
}
.row .fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #059669, #34d399); }
.row .count { text-align: right; color: #94a3b8; font-variant-numeric: tabular-nums; }
.row.gold .fill { background: linear-gradient(90deg, #b45309, #f8b700); }

/* A class wears its own colour, the one the game prints it in. */
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12); background: rgba(0, 0, 0, 0.28);
  border-radius: 999px; font-size: 13px; font-weight: 600;
}
.chip .dot { width: 9px; height: 9px; border-radius: 999px; background: currentColor; box-shadow: 0 0 10px currentColor; }
.chip .n { color: #94a3b8; font-variant-numeric: tabular-nums; }

/* The table: the map itself, one row per page. */
.card {
  border: 1px solid rgba(255, 255, 255, 0.10); background: rgba(255, 255, 255, 0.045);
  border-radius: 16px; overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 18px 50px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px) saturate(140%);
}
table { width: 100%; border-collapse: collapse; }
thead th {
  text-align: left; padding: 14px 16px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
  color: #94a3b8; background: rgba(0, 0, 0, 0.28);
  border-bottom: 1px solid rgba(255, 255, 255, 0.10);
}
tbody td { padding: 12px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: rgba(248, 183, 0, 0.055); }
td.who { min-width: 210px; }
td.who .name { display: block; font-weight: 700; color: #fff; }
td.who .name a { color: inherit; text-decoration: none; }
td.who .name a:hover { color: #ffe395; }
td.who .addr { display: block; margin-top: 2px; font-size: 12px; color: #64748b; word-break: break-all; }
td.num { color: #e2e8f0; font-variant-numeric: tabular-nums; }
td.num b { color: #ffe395; }
td.cls { white-space: nowrap; font-weight: 600; }
td.lang { width: 96px; white-space: nowrap; }
td.date { width: 118px; color: #94a3b8; white-space: nowrap; font-variant-numeric: tabular-nums; }
.badge {
  display: inline-block; min-width: 30px; margin-right: 4px; padding: 3px 7px; border-radius: 8px;
  font-size: 11px; font-weight: 700; text-align: center; text-decoration: none;
  border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(0, 0, 0, 0.35); color: #cbd5e1;
}
.badge:hover { border-color: rgba(248, 183, 0, 0.6); color: #ffe395; }
.none { color: #475569; }
footer { margin: 26px 0 0; color: #64748b; font-size: 12px; text-align: center; }
footer a { color: #94a3b8; text-decoration: none; }
footer a:hover { color: #ffe395; }
@media (max-width: 720px) {
  .row { grid-template-columns: 92px 1fr 44px; }
  thead { display: none; }
  tbody tr { display: block; border-bottom: 1px solid rgba(255, 255, 255, 0.07); padding: 10px 0; }
  tbody tr:last-child { border-bottom: 0; }
  tbody td { display: block; border-bottom: 0; padding: 4px 16px; }
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
              <span class="tag">sitemap &amp; stats</span>
            </h1>
          </header>

          <p class="lead">
            <b><xsl:value-of select="count(//s:url) - 1"/></b> characters looked up
            <span class="dot">·</span>
            <xsl:if test="//s:lastmod">
              <xsl:for-each select="//s:lastmod">
                <xsl:sort select="."/>
                <xsl:if test="position() = 1">since <xsl:value-of select="."/></xsl:if>
              </xsl:for-each>
              <span class="dot">·</span>
            </xsl:if>
            <a href="https://heroofazeroth.com">heroofazeroth.com</a>
          </p>
          <!-- Everything the page states is counted off the map itself, so the page and the file a
               crawler reads can never disagree. The levels are held as a node-set because XPath 1.0 has
               no `min()`: the smallest and the largest are taken by sorting the set and keeping the
               first, and the first day the same way. -->
          <xsl:variable name="levels" select="//hoa:level"/>
          <xsl:variable name="firstDay">
            <xsl:for-each select="//s:lastmod"><xsl:sort select="."/><xsl:if test="position() = 1"><xsl:value-of select="."/></xsl:if></xsl:for-each>
          </xsl:variable>
          <xsl:variable name="lowestLevel">
            <xsl:for-each select="$levels"><xsl:sort select="." data-type="number"/><xsl:if test="position() = 1"><xsl:value-of select="."/></xsl:if></xsl:for-each>
          </xsl:variable>
          <xsl:variable name="highestLevel">
            <xsl:for-each select="$levels"><xsl:sort select="." data-type="number" order="descending"/><xsl:if test="position() = 1"><xsl:value-of select="."/></xsl:if></xsl:for-each>
          </xsl:variable>

          <div class="stats">
            <div class="stat gold">
              <span class="n"><xsl:value-of select="count(//s:url) - 1"/></span>
              <span class="k">characters</span>
              <xsl:if test="string($firstDay) != ''">
                <span class="s">since <xsl:value-of select="$firstDay"/></span>
              </xsl:if>
            </div>

            <div class="stat">
              <span class="n"><xsl:value-of select="count(//s:url) * 2"/></span>
              <span class="k">pages</span>
              <span class="s">English &amp; Russian</span>
            </div>

            <div class="stat">
              <span class="n"><xsl:value-of select="count(//hoa:realm[generate-id() = generate-id(key('byRealm', .)[1])])"/></span>
              <span class="k">realms</span>
            </div>

            <div class="stat">
              <span class="n"><xsl:value-of select="count(//hoa:class[generate-id() = generate-id(key('byClass', .)[1])])"/></span>
              <span class="k">classes</span>
            </div>

            <xsl:if test="$levels">
              <div class="stat">
                <span class="n">
                  <xsl:choose>
                    <xsl:when test="$lowestLevel = $highestLevel"><xsl:value-of select="$highestLevel"/></xsl:when>
                    <xsl:otherwise><xsl:value-of select="$lowestLevel"/>–<xsl:value-of select="$highestLevel"/></xsl:otherwise>
                  </xsl:choose>
                </span>
                <span class="k">levels</span>
              </div>
            </xsl:if>

            <xsl:if test="//hoa:ilvl">
              <div class="stat">
                <span class="n"><xsl:value-of select="format-number(sum(//hoa:ilvl) div count(//hoa:ilvl), '0')"/></span>
                <span class="k">average item level</span>
                <span class="s">best <xsl:for-each select="//hoa:ilvl"><xsl:sort select="." data-type="number" order="descending"/><xsl:if test="position() = 1"><xsl:value-of select="."/></xsl:if></xsl:for-each></span>
              </div>
            </xsl:if>

            <xsl:if test="//hoa:mplus">
              <div class="stat">
                <span class="n"><xsl:for-each select="//hoa:mplus"><xsl:sort select="." data-type="number" order="descending"/><xsl:if test="position() = 1"><xsl:value-of select="."/></xsl:if></xsl:for-each></span>
                <span class="k">best M+ rating</span>
              </div>
            </xsl:if>

            <xsl:if test="//hoa:mounts">
              <div class="stat">
                <span class="n"><xsl:value-of select="sum(//hoa:mounts)"/></span>
                <span class="k">mounts gathered</span>
                <span class="s">across every character</span>
              </div>
            </xsl:if>
          </div>
          <xsl:if test="$levels">
            <!-- The largest group of the distribution, which is what a bar is drawn against: the counts
                 are sorted and the first is kept, for the same reason the levels are. -->
            <xsl:variable name="mostAtLevel">
              <xsl:for-each select="//hoa:level[generate-id() = generate-id(key('byLevel', .)[1])]">
                <xsl:sort select="count(key('byLevel', .))" data-type="number" order="descending"/>
                <xsl:if test="position() = 1"><xsl:value-of select="count(key('byLevel', .))"/></xsl:if>
              </xsl:for-each>
            </xsl:variable>

            <section class="panel">
              <h2>By level <span>— the level a character was at when the site met it</span></h2>
              <xsl:for-each select="//hoa:level[generate-id() = generate-id(key('byLevel', .)[1])]">
                <xsl:sort select="." data-type="number" order="descending"/>
                <div class="row">
                  <span class="label"><xsl:value-of select="."/></span>
                  <span class="track"><span class="fill" style="width: {count(key('byLevel', .)) * 100 div number($mostAtLevel)}%"/></span>
                  <span class="count"><xsl:value-of select="count(key('byLevel', .))"/></span>
                </div>
              </xsl:for-each>
            </section>
          </xsl:if>

          <xsl:if test="//hoa:class">
            <section class="panel">
              <h2>By class <span>— each in the colour the game prints it in</span></h2>
              <div class="chips">
                <xsl:for-each select="//hoa:class[generate-id() = generate-id(key('byClass', .)[1])]">
                  <xsl:sort select="count(key('byClass', .))" data-type="number" order="descending"/>
                  <span class="chip">
                    <xsl:if test="key('byClass', .)[1]/../hoa:classcolor">
                      <xsl:attribute name="style">color: <xsl:value-of select="key('byClass', .)[1]/../hoa:classcolor"/></xsl:attribute>
                    </xsl:if>
                    <span class="dot"/>
                    <xsl:value-of select="."/>
                    <span class="n"><xsl:value-of select="count(key('byClass', .))"/></span>
                  </span>
                </xsl:for-each>
              </div>
            </section>
          </xsl:if>
          <xsl:if test="//hoa:realm">
            <xsl:variable name="mostInRealm">
              <xsl:for-each select="//hoa:realm[generate-id() = generate-id(key('byRealm', .)[1])]">
                <xsl:sort select="count(key('byRealm', .))" data-type="number" order="descending"/>
                <xsl:if test="position() = 1"><xsl:value-of select="count(key('byRealm', .))"/></xsl:if>
              </xsl:for-each>
            </xsl:variable>

            <section class="panel">
              <h2>By realm <span>— where the characters are played</span></h2>
              <xsl:for-each select="//hoa:realm[generate-id() = generate-id(key('byRealm', .)[1])]">
                <xsl:sort select="count(key('byRealm', .))" data-type="number" order="descending"/>
                <div class="row">
                  <span class="label"><xsl:value-of select="."/></span>
                  <span class="track"><span class="fill" style="width: {count(key('byRealm', .)) * 100 div number($mostInRealm)}%"/></span>
                  <span class="count"><xsl:value-of select="count(key('byRealm', .))"/></span>
                </div>
              </xsl:for-each>
            </section>
          </xsl:if>

          <xsl:if test="//s:lastmod">
            <xsl:variable name="busiestDay">
              <xsl:for-each select="//s:lastmod[generate-id() = generate-id(key('byDay', .)[1])]">
                <xsl:sort select="count(key('byDay', .))" data-type="number" order="descending"/>
                <xsl:if test="position() = 1"><xsl:value-of select="count(key('byDay', .))"/></xsl:if>
              </xsl:for-each>
            </xsl:variable>

            <section class="panel">
              <h2>The last two weeks <span>— the days characters were looked up, newest first</span></h2>
              <xsl:for-each select="//s:lastmod[generate-id() = generate-id(key('byDay', .)[1])]">
                <xsl:sort select="." order="descending"/>
                <xsl:if test="position() &lt;= 14">
                  <div class="row gold">
                    <span class="label"><xsl:value-of select="."/></span>
                    <span class="track"><span class="fill" style="width: {count(key('byDay', .)) * 100 div number($busiestDay)}%"/></span>
                    <span class="count"><xsl:value-of select="count(key('byDay', .))"/></span>
                  </div>
                </xsl:if>
              </xsl:for-each>
            </section>
          </xsl:if>

          <xsl:if test="//hoa:mounts">
            <xsl:variable name="mostMounts">
              <xsl:for-each select="//hoa:mounts"><xsl:sort select="." data-type="number" order="descending"/><xsl:if test="position() = 1"><xsl:value-of select="."/></xsl:if></xsl:for-each>
            </xsl:variable>

            <section class="panel">
              <h2>The collectors <span>— the most mounts on a single character</span></h2>
              <xsl:for-each select="//s:url[hoa:mounts]">
                <xsl:sort select="hoa:mounts" data-type="number" order="descending"/>
                <xsl:if test="position() &lt;= 5">
                  <div class="row">
                    <span class="label"><xsl:value-of select="hoa:name"/></span>
                    <span class="track"><span class="fill" style="width: {hoa:mounts * 100 div number($mostMounts)}%"/></span>
                    <span class="count"><xsl:value-of select="hoa:mounts"/></span>
                  </div>
                </xsl:if>
              </xsl:for-each>
            </section>
          </xsl:if>
          <div class="card">
            <table>
              <thead>
                <tr>
                  <th>Character</th>
                  <th>Level</th>
                  <th>Class</th>
                  <th>Item level</th>
                  <th>M+</th>
                  <th>Languages</th>
                  <th>Seen</th>
                </tr>
              </thead>
              <tbody>
                <xsl:apply-templates select="//s:url"/>
              </tbody>
            </table>
          </div>

          <footer>
            Generated by <a href="https://heroofazeroth.com">Hero of Azeroth</a> · sitemap.xml ·
            rebuilt as the site is searched
          </footer>
        </div>

        <script><![CDATA[
          // The addresses are percent-encoded, which is exactly what a crawler wants to read and
          // exactly what nobody wants to look at. The line under each name is decoded back to the
          // address it spells - %D0%BD%D0%B5... becomes нейромаск - while the href it points at is
          // left untouched, because that is the address a browser has to be handed.
          (function () {
            var lines = document.querySelectorAll('td.who .addr');
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i];
              var raw = line.textContent || '';
              try {
                var decoded = decodeURIComponent(raw).replace(/^[a-z]+:\/\/[^/]+/i, '');
                if (decoded.charAt(0) !== '/') decoded = '/' + decoded;
                line.textContent = decoded;
              } catch (error) {
                // A stray percent sign is not worth breaking a page over: the address stays as it is.
              }
            }
          })();
        ]]></script>
      </body>
    </html>
  </xsl:template>

  <!-- One row per page: who the character is, what it was when the site met it, the languages its
       page exists in and the day it was last seen. A record written before a field was kept simply
       has nothing to say in that cell, and the cell says so rather than the row breaking. -->
  <xsl:template match="s:url">
    <tr>
      <td class="who">
        <span class="name">
          <a href="{s:loc}">
            <xsl:choose>
              <xsl:when test="hoa:name"><xsl:value-of select="hoa:name"/></xsl:when>
              <xsl:otherwise><xsl:value-of select="s:loc"/></xsl:otherwise>
            </xsl:choose>
          </a>
        </span>
        <span class="addr"><xsl:value-of select="s:loc"/></span>
      </td>

      <td class="num">
        <xsl:choose>
          <xsl:when test="hoa:level"><b><xsl:value-of select="hoa:level"/></b></xsl:when>
          <xsl:otherwise><span class="none">—</span></xsl:otherwise>
        </xsl:choose>
      </td>

      <td class="cls">
        <xsl:if test="hoa:classcolor">
          <xsl:attribute name="style">color: <xsl:value-of select="hoa:classcolor"/></xsl:attribute>
        </xsl:if>
        <xsl:choose>
          <xsl:when test="hoa:class"><xsl:value-of select="hoa:class"/></xsl:when>
          <xsl:otherwise><span class="none">—</span></xsl:otherwise>
        </xsl:choose>
      </td>

      <td class="num">
        <xsl:choose>
          <xsl:when test="hoa:ilvl"><xsl:value-of select="hoa:ilvl"/></xsl:when>
          <xsl:otherwise><span class="none">—</span></xsl:otherwise>
        </xsl:choose>
      </td>

      <td class="num">
        <xsl:choose>
          <xsl:when test="hoa:mplus"><xsl:value-of select="hoa:mplus"/></xsl:when>
          <xsl:otherwise><span class="none">—</span></xsl:otherwise>
        </xsl:choose>
      </td>

      <td class="lang">
        <xsl:if test="xhtml:link[@hreflang='en']">
          <a class="badge" href="{xhtml:link[@hreflang='en']/@href}" title="English version">EN</a>
        </xsl:if>
        <xsl:if test="xhtml:link[@hreflang='ru']">
          <a class="badge" href="{xhtml:link[@hreflang='ru']/@href}" title="Русская версия">RU</a>
        </xsl:if>
      </td>

      <td class="date">
        <xsl:choose>
          <xsl:when test="s:lastmod"><xsl:value-of select="s:lastmod"/></xsl:when>
          <xsl:otherwise><span class="none">—</span></xsl:otherwise>
        </xsl:choose>
      </td>
    </tr>
  </xsl:template>
</xsl:stylesheet>
