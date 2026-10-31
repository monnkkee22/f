// Vercel Serverless Function: holt Roblox-Katalogdaten serverseitig (kein CORS-Problem im Browser)
const CATALOG_HOSTS = ['catalog.roblox.com', 'catalog.roproxy.com'];
const THUMB_HOSTS = ['thumbnails.roblox.com', 'thumbnails.roproxy.com'];
const HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; rbx-drops/1.1)',
};

const lastGood = {}; // pro Instanz zwischengespeichert, falls Roblox kurz ausfällt

async function request(url, init = {}) {
  const r = await fetch(url, {
    ...init,
    headers: { ...HEADERS, ...(init.headers || {}) },
    signal: AbortSignal.timeout(8000),
  });
  return r;
}

async function getJson(hosts, path, errors) {
  for (const host of hosts) {
    try {
      const r = await request(`https://${host}${path}`);
      if (r.ok) return await r.json();
      errors.push(`${host}${path.split('?')[0]} -> HTTP ${r.status}`);
    } catch (e) {
      errors.push(`${host} -> ${e.name === 'TimeoutError' ? 'Timeout' : e.message}`);
    }
  }
  return null;
}

// Methode B: erst IDs suchen, dann Details per POST holen (mit CSRF-Handshake)
async function postDetails(host, items, errors) {
  const url = `https://${host}/v1/catalog/items/details`;
  const body = JSON.stringify({ items });
  const headers = { 'Content-Type': 'application/json' };
  try {
    let r = await request(url, { method: 'POST', headers, body });
    if (r.status === 403) {
      const token = r.headers.get('x-csrf-token');
      if (token) r = await request(url, { method: 'POST', headers: { ...headers, 'x-csrf-token': token }, body });
    }
    if (r.ok) return (await r.json()).data || [];
    errors.push(`${host}/details(POST) -> HTTP ${r.status}`);
  } catch (e) {
    errors.push(`${host}/details(POST) -> ${e.message}`);
  }
  return null;
}

async function loadCatalog(mode, errors) {
  const base = new URLSearchParams({ SortType: '3', Limit: '30' });
  if (mode === 'limited') base.set('Category', '2');

  // Methode A: Detail-Suche
  const a = await getJson(CATALOG_HOSTS, `/v1/search/items/details?${base}`, errors);
  if (a && Array.isArray(a.data)) return a.data;

  // Methode B: ID-Suche + POST
  const ids = await getJson(CATALOG_HOSTS, `/v1/search/items?${base}`, errors);
  if (ids && Array.isArray(ids.data) && ids.data.length) {
    const items = ids.data.map((d) => ({ itemType: d.itemType, id: d.id }));
    for (const host of CATALOG_HOSTS) {
      const det = await postDetails(host, items, errors);
      if (det) return det;
    }
  }
  return null;
}

export default async function handler(req, res) {
  const mode = req.query.mode === 'new' ? 'new' : 'limited';
  const errors = [];

  let items = await loadCatalog(mode, errors);

  if (!items) {
    if (lastGood[mode]) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ...lastGood[mode], stale: true, errors });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Roblox-API nicht erreichbar', errors });
  }

  if (mode === 'limited') {
    items = items.filter(
      (i) => (i.itemRestrictions || []).some((r) => /limited|collectible/i.test(r)) || i.collectibleItemId
    );
  }

  // Thumbnails (Fehler hier dürfen die Liste nicht kaputt machen)
  const thumbs = {};
  const assetIds = items.filter((i) => i.itemType === 'Asset').map((i) => i.id);
  const bundleIds = items.filter((i) => i.itemType === 'Bundle').map((i) => i.id);
  const thumbErrors = [];
  await Promise.allSettled([
    assetIds.length &&
      getJson(
        THUMB_HOSTS,
        `/v1/assets?assetIds=${assetIds.join(',')}&returnPolicy=PlaceHolder&size=150x150&format=Png`,
        thumbErrors
      ).then((d) => (d?.data || []).forEach((t) => (thumbs[`Asset:${t.targetId}`] = t.imageUrl))),
    bundleIds.length &&
      getJson(
        THUMB_HOSTS,
        `/v1/bundles/thumbnails?bundleIds=${bundleIds.join(',')}&size=150x150&format=Png`,
        thumbErrors
      ).then((d) => (d?.data || []).forEach((t) => (thumbs[`Bundle:${t.targetId}`] = t.imageUrl))),
  ]);

  const out = items.map((i) => ({
    id: i.id,
    type: i.itemType,
    name: i.name,
    creator: i.creatorName || '',
    verified: !!i.creatorHasVerifiedBadge,
    price: i.lowestPrice ?? i.price ?? null,
    free: i.priceStatus === 'Free' || i.price === 0,
    limited: (i.itemRestrictions || []).some((r) => /limited|collectible/i.test(r)) || !!i.collectibleItemId,
    total: i.totalQuantity ?? null,
    left: i.unitsAvailableForConsumption ?? null,
    thumb: thumbs[`${i.itemType}:${i.id}`] || '',
    url: i.itemType === 'Bundle' ? `https://www.roblox.com/bundles/${i.id}` : `https://www.roblox.com/catalog/${i.id}`,
  }));

  const payload = { mode, fetchedAt: Date.now(), items: out };
  lastGood[mode] = payload;
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
  res.status(200).json(payload);
}
