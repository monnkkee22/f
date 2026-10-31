# Drop Radar – Roblox Limiteds & neue Items

## Deploy auf Vercel
1. Ordner in ein GitHub-Repo pushen (oder `npx vercel` im Ordner ausführen).
2. Auf vercel.com "Add New Project" -> Repo wählen -> Deploy. Keine Einstellungen nötig.
3. Seite öffnen, "Benachrichtigungen aktivieren" klicken, Chrome-Abfrage bestätigen.

## Wichtig
- Benachrichtigungen kommen, solange die Seite in einem Chrome-Tab offen ist (auch im Hintergrund-Tab).
- Ist der Tab komplett geschlossen, gibt es keine Meldung (dafür wäre Web Push + Cron + Datenbank nötig).
- Struktur: `public/` (Seite + Service Worker), `api/items.js` (Serverless-Proxy zur Roblox-API).
