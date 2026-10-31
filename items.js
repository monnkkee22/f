// Vercel Serverless Function: holt Roblox-Katalogdaten serverseitig (kein CORS-Problem im Browser)
const HOSTS = ['catalog.roblox.com', 'catalog.roproxy.com'];
const THUMB_HOSTS = ['thumbnails.roblox.com', 'thumbnails.roproxy.com'];

async function getJson(hosts, path) {
  let lastErr;
  for (const host of hosts) {
    try {
      const r = await fetch(`https://${host}${path}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'rbx-drops/1.0' },
      });
      if (r.ok) return await r.json();
      lastErr = new Error(`${host} -> ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export default async function handler(req, res) {
  const mode = req.query.mode === 'new' ? 'new' : 'limited';

  const params = new URLSearchParams({
    SortType: '3', // zuletzt aktualisiert / neu
    Limit: '30',
    IncludeNotForSale: 'false',
  });
  if (mode === 'limited') params.set('Category', '2'); // Collectibles (Limiteds)

  try {
    const catalog = await getJson(HOSTS, `/v1/search/items/details?${params}`);
    let items = catalog.data || [];

    if (mode === 'limited') {
      items = items.filter((i) =>
        (i.itemRestrictions || []).some((r) => /limited|collectible/i.test(r)) ||
        i.collectibleItemId
      );
    }

    // Thumbnails (Assets und Bundles getrennt)
    const assetIds = items.filter((i) => i.itemType === 'Asset').map((i) => i.id);
    const bundleIds = items.filter((i) => i.itemType === 'Bundle').map((i) => i.id);
    const thumbs = {};

    const jobs = [];
    if (assetIds.length) {
      jobs.push(
        getJson(
          THUMB_HOSTS,
          `/v1/assets?assetIds=${assetIds.join(',')}&returnPolicy=PlaceHolder&size=150x150&format=Png`
        ).then((d) => (d.data || []).forEach((t) => (thumbs[`Asset:${t.targetId}`] = t.imageUrl)))
      );
    }
    if (bundleIds.length) {
      jobs.push(
        getJson(
          THUMB_HOSTS,
          `/v1/bundles/thumbnails?bundleIds=${bundleIds.join(',')}&size=150x150&format=Png`
        ).then((d) => (d.data || []).forEach((t) => (thumbs[`Bundle:${t.targetId}`] = t.imageUrl)))
      );
    }
    await Promise.allSettled(jobs);

    const out = items.map((i) => {
      const limited = (i.itemRestrictions || []).some((r) => /limited|collectible/i.test(r));
      return {
        id: i.id,
        type: i.itemType,
        name: i.name,
        creator: i.creatorName || '',
        verified: !!i.creatorHasVerifiedBadge,
        price: i.lowestPrice ?? i.price ?? null,
        free: i.priceStatus === 'Free' || i.price === 0,
        limited,
        total: i.totalQuantity ?? null,
        left: i.unitsAvailableForConsumption ?? null,
        thumb: thumbs[`${i.itemType}:${i.id}`] || '',
        url:
          i.itemType === 'Bundle'
            ? `https://www.roblox.com/bundles/${i.id}`
            : `https://www.roblox.com/catalog/${i.id}`,
      };
    });

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    res.status(200).json({ mode, fetchedAt: Date.now(), items: out });
  } catch (e) {
    res.status(502).json({ error: 'Roblox-API nicht erreichbar', detail: String(e.message || e) });
  }
}
