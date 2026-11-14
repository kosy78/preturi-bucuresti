import { useEffect, useState } from 'react';
import type { MapListing, Meta } from '../../shared/types';

type Data = { state: 'loading' | 'error' | 'ready'; listings: MapListing[]; meta: Meta | null };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function useData(): Data {
  const [data, setData] = useState<Data>({ state: 'loading', listings: [], meta: null });
  useEffect(() => {
    let live = true;
    Promise.all([getJson<MapListing[]>('/data/listings.json'), getJson<Meta>('/data/meta.json')])
      .then(([listings, meta]) => live && setData({ state: 'ready', listings, meta }))
      .catch(() => live && setData({ state: 'error', listings: [], meta: null }));
    return () => {
      live = false;
    };
  }, []);
  return data;
}
