#!/bin/sh
# Writes the gallery index.html from every apps/<name>/README.md:
# its first "# " line is the card title, its first plain paragraph line the summary.
set -eu
apps_dir="$1"
out="$2"

escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'; }

cards=""
for readme in "$apps_dir"/*/README.md; do
  [ -f "$readme" ] || continue
  name=$(basename "$(dirname "$readme")")
  title=$(sed -n 's/^# //p' "$readme" | head -n 1 | escape)
  summary=$(awk 'NR>1 && /^[A-Za-z]/ { print; exit }' "$readme" | escape)
  cards="$cards
      <li><a class=\"card\" href=\"/$name/\"><h2>${title:-$name}</h2><p>$summary</p><span>Open &rarr;</span></a></li>"
done

cat > "$out" <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Excalibase Examples</title>
  <meta name="description" content="Small, dependency-free apps built on Excalibase.">
  <link rel="stylesheet" href="/gallery.css">
</head>
<body>
  <header>
    <h1>Excalibase Examples</h1>
    <p>Small, dependency-free apps that run on one Excalibase project. Each one is a plain HTML page talking to the project's REST and GraphQL APIs with a publishable key.</p>
    <p><a href="https://github.com/excalibase/examples">Source on GitHub</a></p>
  </header>
  <main>
    <ul class="grid">$cards
    </ul>
  </main>
</body>
</html>
HTML
