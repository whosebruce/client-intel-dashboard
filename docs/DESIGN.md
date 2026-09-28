# Dashboard design

The dashboard borrows the type and palette of the Bruce Works "Field Manual" system (mono labels, flat steel-like panels, one yellow action) without its brand marks. Keep new UI inside these rules so it reads as one product.

## Tokens

All colors are CSS custom properties in `dashboard/css/app.css`, defined twice: `:root[data-theme="night"]` (default) and `:root[data-theme="day"]`. Use the token, never a raw hex, in new CSS.

| Token | Night | Day | Job |
|---|---|---|---|
| `--ground` | `#15181C` | `#E0DBCE` | page background |
| `--panel` / `--panel-2` / `--panel-3` | `#1c2023` → `#2a3033` | `#E8E4DA` → `#F6F4EE` | panel, raised, selected |
| `--line` | `#3A4139` olive | `#b9b3a4` | 2px panel borders |
| `--text` / `--text-2` / `--text-3` | bone / mist / steel | night / ink / ink-soft | primary, body, labels |
| `--signal` | `#FEB019` | `#FEB019` | the Import button, the selection ring, focus outlines |
| `--alert` / `--alert-text` | `#C7392B` / `#F07563` | `#C7392B` / `#A92E22` | overdue follow-ups and section numbers only |
| `--paid` / `--unpaid` / `--lead` | `#199e70` / `#c98500` / `#3987e5` | `#1baf7a` / `#eda100` / `#2a78d6` | status fills |

The three status colors were run through a color-vision-deficiency validator as a set, on both grounds, with all pairs compared (map markers can sit next to any other status). Night passes every check. Day passes with a contrast warning against the light ground, which is why markers carry a dark ring and initials and every status also has a text label. If you change a status color, re-validate the set; don't eyeball it.

Status is never shown by color alone: roster rows and chips say Paid, Due or Lead, and the map has a legend.

## Type

- **Big Shoulders** 800, all caps: the app name, record name, big numbers.
- **Barlow**: body and UI text.
- **Barlow Condensed** 600, caps: buttons and chips.
- **IBM Plex Mono**, caps with letter-spacing: labels, dates, counts, section headers.

Fonts are Latin subsets vendored in `dashboard/vendor/fonts/` (OFL), so the dashboard works offline. Don't add a Google Fonts link.

## Rules

- Square corners everywhere. No border radius, no shadows, no gradients.
- No hazard or caution-tape strips. They are a Bruce Works brand mark and this dashboard keeps its own identity.
- One Signal Yellow action per screen (Import). Selection and keyboard focus also use Signal Yellow, as an outline rather than a fill.
- Section headers are a red number, a mono label and a hairline: `01 ROSTER`, `02 RECORD`, `03 FOLLOW-UP QUEUE`.
- No emoji and no icon font. Use text labels and the glyphs `▸ · // ‹ ›`.
- Copy is short and plain: "Import", "Route", "Copy sheet", "Nothing here". No hype words.

## Map

- One marker per record. No heatmap and no clustering.
- Markers are square tags filled with the status color. Below zoom 12 unselected markers shrink to plain squares; the selected one keeps its initials and a yellow ring.
- An overdue follow-up adds a red corner.
- Tiles are OpenStreetMap, recolored per theme with a CSS filter on the tile pane (`--tile-filter`). Keep the OpenStreetMap attribution visible.

## Layout

| Width | Layout |
|---|---|
| 1280px and up | Roster left, map center, record right, queue under the map and record |
| 820–1279px | Roster left, map right, record as a drawer over the map, queue under the map |
| under 820px | Map on top, Roster / Map / Record / Queue tabs, one panel below; extra actions in Menu |
