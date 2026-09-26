import { AutomationsComponent } from '@gitroom/frontend/components/automations/automations.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Automations`,
  description: '',
};
export default async function Index() {
  return <AutomationsComponent />;
}
