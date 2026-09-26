import { AutopilotComponent } from '@gitroom/frontend/components/autopilot/autopilot.component';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Autopilot`,
  description: '',
};
export default async function Index() {
  return <AutopilotComponent />;
}
