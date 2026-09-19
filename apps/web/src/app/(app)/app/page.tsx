import { redirect } from 'next/navigation';

/** /app is not a page of its own; it is where My Companions lives. */
export default function AppIndex() {
  redirect('/app/companions');
}
