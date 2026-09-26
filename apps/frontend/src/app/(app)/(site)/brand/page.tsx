import { BrandComponent } from '@gitroom/frontend/components/brand/brand.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Brand`,
  description: '',
};
export default async function Index() {
  return <BrandComponent />;
}
