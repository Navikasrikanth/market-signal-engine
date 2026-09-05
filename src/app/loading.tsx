import { PageSkeleton } from '@/components/Skeleton'

/**
 * The brief is the slowest page — it builds the whole sitrep server-side — so
 * it is the one that most needs the layout to already be there when it lands.
 */
export default function Loading() {
  return <PageSkeleton rows={5} hero />
}
