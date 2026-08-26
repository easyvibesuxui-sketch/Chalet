#!/usr/bin/env bash
# Download the CHALET section imagery from Unsplash and write it into assets/img/.
#
# Usage:
#   tools/fetch-unsplash.sh                 # download what photos.txt names
#   UNSPLASH_ACCESS_KEY=… tools/fetch-unsplash.sh --search
#                                           # fill the blank slots by search first
#
# --search needs an Unsplash Access Key (the public, client-side one from
# https://unsplash.com/oauth/applications). It never needs the Secret Key.
set -euo pipefail

cd "$(dirname "$0")/.."
LIST=tools/photos.txt
OUT=assets/img
CREDITS=CREDITS.md
SEARCH=0
[[ "${1:-}" == "--search" ]] && SEARCH=1

command -v ffmpeg >/dev/null || { echo "ffmpeg is required (brew install ffmpeg / apt install ffmpeg)"; exit 1; }
command -v curl   >/dev/null || { echo "curl is required"; exit 1; }
command -v jq     >/dev/null || { echo "jq is required (brew install jq / apt install jq)"; exit 1; }

if (( SEARCH )) && [[ -z "${UNSPLASH_ACCESS_KEY:-}" ]]; then
  echo "--search needs UNSPLASH_ACCESS_KEY in the environment." >&2; exit 1
fi

api() { curl -fsS -H "Authorization: Client-ID $UNSPLASH_ACCESS_KEY" -H "Accept-Version: v1" "$@"; }

{ echo "# Photo credits"; echo; echo "Section imagery from [Unsplash](https://unsplash.com)."; echo; } > "$CREDITS"

while read -r slot crop id hint; do
  [[ -z "${slot:-}" || "$slot" == \#* ]] && continue
  hint="${hint#\# }"

  # --- resolve the photo id -------------------------------------------------
  if [[ "$id" == "-" ]]; then
    if (( SEARCH )); then
      echo "search  $slot  <- \"$hint\""
      id=$(api "https://api.unsplash.com/search/photos?per_page=1&orientation=$(
             [[ $crop == 3:4 || $crop == 4:5 ]] && echo portrait || echo landscape
           )&query=$(printf %s "$hint" | jq -sRr @uri)" | jq -r '.results[0].id // empty')
      [[ -z "$id" ]] && { echo "  no result — keeping the existing $slot.webp"; continue; }
    else
      echo "skip    $slot  (no photo given)"; continue
    fi
  fi
  id="${id##*-}"; id="${id%%\?*}"          # accept a full photo URL or a bare id

  # --- fetch metadata, honour the API download trigger, then pull the file --
  if [[ -n "${UNSPLASH_ACCESS_KEY:-}" ]]; then
    meta=$(api "https://api.unsplash.com/photos/$id")
    raw=$(jq -r '.urls.raw'          <<<"$meta")
    who=$(jq -r '.user.name'         <<<"$meta")
    link=$(jq -r '.links.html'       <<<"$meta")
    api "$(jq -r '.links.download_location' <<<"$meta")" >/dev/null   # required by the API guidelines
    printf -- '- %s — [%s](%s) on Unsplash\n' "$slot" "$who" "$link" >> "$CREDITS"
  else
    raw="https://images.unsplash.com/photo-$id"
    printf -- '- %s — https://unsplash.com/photos/%s\n' "$slot" "$id" >> "$CREDITS"
  fi

  # --- crop to the slot's aspect and encode ---------------------------------
  w=${crop%%:*}; h=${crop##*:}
  tmp=$(mktemp /tmp/chalet-XXXXXX.jpg)
  curl -fsS "${raw}&w=2000&q=85&fm=jpg" -o "$tmp"
  ffmpeg -hide_banner -loglevel error -y -i "$tmp" \
    -vf "crop='min(iw,ih*$w/$h)':'min(ih,iw*$h/$w)',scale=w=1280:h=1280:force_original_aspect_ratio=decrease:flags=lanczos" \
    -q:v 74 -c:v libwebp "$OUT/$slot.webp"
  rm -f "$tmp"
  echo "ok      $slot  ($crop)  $id"
done < "$LIST"

echo
echo "Done. Credits written to $CREDITS."
echo "Review the images, then: git add -A && git commit -m 'Swap section imagery for Unsplash photography'"
