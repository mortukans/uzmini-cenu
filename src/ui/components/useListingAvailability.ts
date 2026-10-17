/**
 * Current availability of the listings a finished session reviewed, keyed by
 * listing id. One `get_listing_status` call per id set; any failure (offline,
 * unconfigured env) yields an empty map, which the review UI shows as
 * "availability unknown". Never carries prices.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getListingStatus } from '../../api/rpc';
import type { ListingAvailability } from '../../api/types';
import { isConfigured } from '../../env';

export type AvailabilityMap = Record<number, ListingAvailability | undefined>;

/** `get_listing_status` caps at 50 ids; sessions are far shorter, but never send more. */
const MAX_IDS = 50;

export function useListingAvailability(ids: number[]): AvailabilityMap {
  const unique = useMemo(() => Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0))).slice(0, MAX_IDS), [ids]);
  const q = useQuery({
    queryKey: ['listingStatus', unique],
    queryFn: () => getListingStatus(unique),
    enabled: unique.length > 0 && isConfigured,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  return useMemo(() => {
    const out: AvailabilityMap = {};
    for (const row of q.data ?? []) out[row.id] = row;
    return out;
  }, [q.data]);
}
