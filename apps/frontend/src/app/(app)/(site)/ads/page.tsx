import { AdsComponent } from '@gitroom/frontend/components/ads/ads.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Ads`,
  description: '',
};
export default async function Index() {
  return <AdsComponent />;
}
