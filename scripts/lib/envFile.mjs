/**
 * Two `.env` files, compared by what they say.
 *
 * The deploy only re-uploads the host's configuration when it has actually changed, and this comparison is
 * the whole rule. A file that differs from the host's copy by a line ending, by the blank line an editor
 * left at the end, or by the `\r` of a Windows-style file has not changed in any way a running site can
 * observe - and calling that a change would rotate `.env.previous` and report a restart nobody needs, on a
 * file that is edited a few times a year.
 *
 * Nothing else is forgiven: a value edited, a key added, a line reordered and a comment rewritten are all
 * things the host's copy of the file would no longer say, and each of them is worth an upload.
 */

/** The file's text without the shape of its edges: the line endings, and the blank lines around it. */
const said = (text) => text.replace(/\r\n?/g, '\n').trim()

export function sameEnv(one, other) {
  return said(one) === said(other)
}
